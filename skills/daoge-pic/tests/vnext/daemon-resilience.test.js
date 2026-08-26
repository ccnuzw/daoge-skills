const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { loadProviderConfig, providerStatus } = require('../../dist/vnext/studio/provider-config');
const { createProject, createTaskDraft, createRoundDraft, openOrAttachStudioSession, prepareRoundForConfirmation, confirmRoundPlan, InvalidCommandError } = require('../../dist/vnext/domain/studio-commands');
const { createDryRunPreview, queueGenerationRun, claimRunItems, getGenerationRun, listGenerationRunItems, resolveUnknownRunItems, transitionRunItem, resumeGenerationRun } = require('../../dist/vnext/runner/run-commands');
const { GenerationWorker } = require('../../dist/vnext/runner/worker');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');
const daemonEntry = path.join(skillRoot, 'dist', 'vnext', 'cli', 'daemon.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-daemon-resilience-'));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, description, timeoutMs = 5000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for ' + description + '.');
    await wait(25);
  }
}

async function startCountingProvider() {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'This test Provider must never be called before user confirmation.' } }));
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return {
    baseUrl: 'http://127.0.0.1:' + address.port + '/v1',
    count: () => requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function stopDaemon(child) {
  if (!child || child.exitCode !== null || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); }, 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill('SIGTERM');
  });
}

function createQueuedHundredItemRun(workspaceRoot, providerBaseUrl) {
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  fs.writeFileSync(initialized.paths.providerEnvPath, [
    'IMAGE_PROVIDER=openai-images',
    'OPENAI_BASE_URL=' + providerBaseUrl,
    'OPENAI_API_KEY=daemon-recovery-test-key',
    'OPENAI_MODEL=gpt-image-2'
  ].join('\n') + '\n');
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const project = createProject(db, { studioId: initialized.manifest.studioId, name: '100-item restart recovery', idempotencyKey: 'project' });
  const task = createTaskDraft(db, { projectId: project.value.id, name: 'catalog images', idempotencyKey: 'task' });
  const round = createRoundDraft(db, { taskId: task.value.id, purpose: 'exploration', idempotencyKey: 'round' });
  const prepared = prepareRoundForConfirmation(db, {
    roundId: round.value.id,
    plan: { operation: 'generate', itemCount: 100, prompt: 'consistent catalog product image', output: { aspectRatio: '1:1' } },
    expectedVersion: round.value.version,
    idempotencyKey: 'prepare'
  });
  const confirmed = confirmRoundPlan(db, { roundId: round.value.id, expectedVersion: prepared.value.version, idempotencyKey: 'confirm' });
  const config = loadProviderConfig(initialized.paths);
  const status = providerStatus(initialized.paths);
  const dryRun = createDryRunPreview(db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'dry-run' });
  const queued = queueGenerationRun(db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'run' });
  return { initialized, db, config, run: queued.value };
}

function transitionToSuccess(db, item) {
  transitionRunItem(db, { itemId: item.id, leaseToken: item.leaseToken, status: 'requesting' });
  transitionRunItem(db, { itemId: item.id, leaseToken: item.leaseToken, status: 'receiving' });
  transitionRunItem(db, { itemId: item.id, leaseToken: item.leaseToken, status: 'persisting' });
  transitionRunItem(db, { itemId: item.id, leaseToken: item.leaseToken, status: 'succeeded', result: { assetId: 'historical-' + item.sequence } });
}

function countByStatus(items) {
  return items.reduce((counts, item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
    return counts;
  }, {});
}

test('daemon restart preserves a 100-item queue and never replays external requests before explicit recovery', async () => {
  const workspaceRoot = temporaryWorkspace();
  const provider = await startCountingProvider();
  let fixture;
  let daemon;
  let daemonStderr = '';
  try {
    fixture = createQueuedHundredItemRun(workspaceRoot, provider.baseUrl);
    const claimed = claimRunItems(fixture.db, { workerId: 'crashed-daemon', limit: 100, leaseMs: 60 * 60 * 1000, now: new Date() });
    assert.equal(claimed.length, 100);

    for (const item of claimed.slice(0, 25)) transitionToSuccess(fixture.db, item);
    for (const item of claimed.slice(25, 35)) {
      transitionRunItem(fixture.db, { itemId: item.id, leaseToken: item.leaseToken, status: 'requesting' });
    }
    assert.deepEqual(countByStatus(listGenerationRunItems(fixture.db, fixture.run.id)), { succeeded: 25, requesting: 10, leased: 65 });
    closeStudioDatabase(fixture.db);
    fixture.db = null;

    assert.ok(fs.existsSync(daemonEntry), 'vNext daemon must be compiled before resilience tests run');
    daemon = spawn(process.execPath, [daemonEntry, '--workspace', workspaceRoot, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
    daemon.stderr.on('data', (chunk) => { daemonStderr += String(chunk); });
    const runtimePath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.json');
    await waitFor(() => fs.existsSync(runtimePath), 'daemon runtime record');
    await wait(800);
    assert.equal(provider.count(), 0, 'a restarted daemon must not call the Provider for resume_pending work');
    await stopDaemon(daemon);
    daemon = null;

    const reopened = openStudioDatabase(fixture.initialized.paths, fixture.initialized.manifest);
    fixture.db = reopened;
    assert.equal(getGenerationRun(reopened, fixture.run.id).status, 'resume_pending');
    const recovered = listGenerationRunItems(reopened, fixture.run.id);
    assert.equal(recovered.length, 100);
    assert.equal(new Set(recovered.map((item) => item.id)).size, 100);
    assert.deepEqual(recovered.map((item) => item.sequence), Array.from({ length: 100 }, (_, index) => index + 1));
    assert.deepEqual(countByStatus(recovered), { succeeded: 25, outcome_unknown: 10, pending: 65 });
    assert.equal(provider.count(), 0);
    assert.throws(() => resumeGenerationRun(reopened, { runId: fixture.run.id, idempotencyKey: 'must-not-resume-unknown-outcomes' }), InvalidCommandError);
    assert.equal(provider.count(), 0);

    const unknownItems = recovered.filter((candidate) => candidate.status === 'outcome_unknown');
    resolveUnknownRunItems(reopened, { runId: fixture.run.id, itemIds: unknownItems.map((item) => item.id), idempotencyKey: 'manual-reconciliation-no-result' });
    assert.throws(() => resumeGenerationRun(reopened, { runId: fixture.run.id, idempotencyKey: 'resume-without-session' }), InvalidCommandError);
    const session = openOrAttachStudioSession(reopened, { studioId: fixture.initialized.manifest.studioId, conversationId: 'recovery-confirmation' });
    const explicitlyResumed = resumeGenerationRun(reopened, { runId: fixture.run.id, sessionId: session.id, idempotencyKey: 'user-approved-safe-resume' });
    assert.equal(explicitlyResumed.value.status, 'queued');

    let safeProviderCalls = 0;
    const worker = new GenerationWorker({
      db: reopened,
      workerId: 'confirmed-recovery-worker',
      providerConfig: fixture.config,
      provider: {
        id: 'openai-images',
        validateConfig: () => ({ valid: true, missing: [] }),
        capabilities: () => ({ textToImage: true, referenceEdit: true, maskEdit: true, cancellation: false, reconciliation: false, idempotency: false, acceptedReferenceMediaTypes: ['image/png'] }),
        generate: async () => { safeProviderCalls += 1; return { bytes: png, mediaType: 'image/png' }; },
        classifyError: () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })
      },
      assetPersister: { persistGeneratedImage: async ({ itemId }) => ({ assetId: 'recovered-' + itemId, mediaType: 'image/png', byteSize: png.length, contentHash: 'safe-' + itemId }) }
    });
    const processed = await worker.processOnce(100);
    assert.deepEqual(processed, { claimed: 65, succeeded: 65, retrying: 0, blocked: 0, unknown: 0 });
    assert.equal(safeProviderCalls, 65, 'only items known not to have reached the Provider may execute after user confirmation');
    const finalItems = listGenerationRunItems(reopened, fixture.run.id);
    assert.deepEqual(countByStatus(finalItems), { succeeded: 90, failed: 10 });
    assert.equal(getGenerationRun(reopened, fixture.run.id).status, 'partial');
    assert.equal(provider.count(), 0, 'the restarted daemon never replayed any prior external request');
  } finally {
    if (fixture && fixture.db) closeStudioDatabase(fixture.db);
    await stopDaemon(daemon);
    await provider.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    if (daemonStderr) assert.equal(daemonStderr.includes('Studio daemon failed.'), false, daemonStderr);
  }
});
