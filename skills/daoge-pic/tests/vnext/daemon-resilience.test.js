const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { configureProvider } = require('./provider-test-helper');
const { createProject, createTaskDraft, createRoundDraft, openOrAttachStudioSession, updateStudioSessionContext, prepareRoundForConfirmation, confirmRoundPlan, InvalidCommandError } = require('../../dist/vnext/domain/studio-commands');
const { createDryRunPreview, queueGenerationRun, claimRunItems, getGenerationRun, listGenerationRunItems, resolveUnknownRunItems, transitionRunItem, resumeGenerationRun } = require('../../dist/vnext/runner/run-commands');
const { GenerationWorker } = require('../../dist/vnext/runner/worker');
const { LocalStudioService, startLocalStudioService } = require('../../dist/vnext/api/server');

const skillRoot = path.resolve(__dirname, '../..');

const daemonEntry = path.join(skillRoot, 'dist', 'vnext', 'cli', 'daemon.js');
const cliEntry = path.join(skillRoot, 'dist', 'vnext', 'cli', 'daoge.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
test('media worker pool is an independently addressable child-process pool', async () => {
  const { MediaProcessPool } = require('../../dist/vnext/runtime/media-worker-pool');
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-media-pool-'));
  const pool = new MediaProcessPool(workspaceRoot, 1);
  try {
    for (let attempt = 0; attempt < 50 && !pool.processIds().length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(pool.processIds().length, 1);
    assert.notEqual(pool.processIds()[0], process.pid);
  } finally {
    await pool.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('generation and media worker pools respawn crashed children and drain queued work', async () => {
  const { WorkerProcessPool } = require('../../dist/vnext/runtime/worker-pool');
  const { MediaProcessPool } = require('../../dist/vnext/runtime/media-worker-pool');
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-worker-respawn-'));
  let generationPool;
  let mediaPool;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { name: 'Worker Respawn Provider' });
    generationPool = new WorkerProcessPool(workspaceRoot, 1);
    mediaPool = new MediaProcessPool(workspaceRoot, 1);
    await waitFor(() => generationPool.processIds().length === 1 && mediaPool.processIds().length === 1, 'worker pool children');
    const generationPid = generationPool.processIds()[0];
    const mediaPid = mediaPool.processIds()[0];
    process.kill(generationPid, 'SIGKILL');
    process.kill(mediaPid, 'SIGKILL');
    await waitFor(() => generationPool.processIds()[0] && generationPool.processIds()[0] !== generationPid && mediaPool.processIds()[0] && mediaPool.processIds()[0] !== mediaPid, 'respawned worker pool children');
    const generationTick = await generationPool.processOnce(1);
    assert.equal(generationTick.claimed, 0);
    const mediaResult = await mediaPool.run({ type: 'reconcile', studioId: initialized.manifest.studioId });
    assert.equal(mediaResult.type, 'reconcile');
  } finally {
    if (generationPool) await generationPool.close();
    if (mediaPool) await mediaPool.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
test('generation Worker pool can exceed four active Provider requests under a healthy target', async () => {
  const { WorkerProcessPool } = require('../../dist/vnext/runtime/worker-pool');
  const workspaceRoot = temporaryWorkspace();
  let active = 0;
  let maxActive = 0;
  const server = http.createServer(async (request, response) => {
    request.resume();
    await new Promise((resolve) => request.once('end', resolve));
    active += 1;
    maxActive = Math.max(maxActive, active);
    await wait(50);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    active -= 1;
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const fixture = createQueuedHundredItemRun(workspaceRoot, 'http://127.0.0.1:' + address.port + '/v1');
  closeStudioDatabase(fixture.db);
  fixture.db = null;
  const pool = new WorkerProcessPool(workspaceRoot, 1);
  try {
    await wait(100);
    let result = { claimed: 0 };
    for (let attempt = 0; attempt < 20 && result.claimed === 0; attempt += 1) {
      result = await pool.processOnce(100);
      if (result.claimed === 0) await wait(50);
    }
    assert.ok(result.claimed > 4);
    assert.ok(maxActive > 4, 'the Provider should receive more than four simultaneous requests');
    assert.equal(pool.concurrencySnapshot().max, 100);
  } finally {
    await pool.close();
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

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
function livePid(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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

function runChild(entry, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Timed out waiting for child process to exit.'));
    }, 5000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr, pid: child.pid }); });
  });
}


function createQueuedHundredItemRun(workspaceRoot, providerBaseUrl) {
  const initialized = initializeStudio({ workspaceRoot });
  const { config, status } = configureProvider(initialized, { baseUrl: providerBaseUrl, model: 'gpt-image-2', apiKey: 'daemon-recovery-test-key' });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const project = createProject(db, { studioId: initialized.manifest.studioId, name: '100-item restart recovery', idempotencyKey: 'project' });
  const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.value.id, name: 'catalog images', idempotencyKey: 'task' });
  const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.value.id, purpose: 'exploration', idempotencyKey: 'round' });
  const prepared = prepareRoundForConfirmation(db, { studioId: initialized.manifest.studioId, roundId: round.value.id,
  plan: { operation: 'generate', itemCount: 100, prompt: 'consistent catalog product image', output: { aspectRatio: '1:1' } },
  expectedVersion: round.value.version,
  idempotencyKey: 'prepare' });
  const confirmed = confirmRoundPlan(db, { studioId: initialized.manifest.studioId, roundId: round.value.id, expectedVersion: prepared.value.version, idempotencyKey: 'confirm' });
  assert.ok(config);
  assert.equal(status.configured, true);
  const dryRun = createDryRunPreview(db, { studioId: initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, executionConcurrency: 100, idempotencyKey: 'dry-run' });
  const queued = queueGenerationRun(db, { studioId: initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'run' });
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
    assert.throws(() => resumeGenerationRun(reopened, { studioId: fixture.initialized.manifest.studioId, runId: fixture.run.id, idempotencyKey: 'must-not-resume-unknown-outcomes' }), InvalidCommandError);
    assert.equal(provider.count(), 0);

    const unknownItems = recovered.filter((candidate) => candidate.status === 'outcome_unknown');
    resolveUnknownRunItems(reopened, { studioId: fixture.initialized.manifest.studioId, runId: fixture.run.id, itemIds: unknownItems.map((item) => item.id), idempotencyKey: 'manual-reconciliation-no-result' });
    assert.throws(() => resumeGenerationRun(reopened, { studioId: fixture.initialized.manifest.studioId, runId: fixture.run.id, idempotencyKey: 'resume-without-session' }), InvalidCommandError);
    const session = openOrAttachStudioSession(reopened, { studioId: fixture.initialized.manifest.studioId, conversationId: 'recovery-confirmation' });
    updateStudioSessionContext(reopened, { studioId: fixture.initialized.manifest.studioId, sessionId: session.id, roundId: fixture.run.roundId });
    const explicitlyResumed = resumeGenerationRun(reopened, { studioId: fixture.initialized.manifest.studioId, runId: fixture.run.id, sessionId: session.id, idempotencyKey: 'user-approved-safe-resume' });
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
    assert.deepEqual(processed, { claimed: 65, succeeded: 65, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 });
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

test('standalone service startup performs explicit idempotent recovery without constructor side effects', async () => {
  const workspaceRoot = temporaryWorkspace();
  const provider = await startCountingProvider();
  let fixture;
  let constructed;
  let started;
  try {
    fixture = createQueuedHundredItemRun(workspaceRoot, provider.baseUrl);
    const [claimed] = claimRunItems(fixture.db, { workerId: 'standalone-crash', limit: 1, leaseMs: 1000, now: new Date('2020-01-01T00:00:00.000Z') });
    transitionRunItem(fixture.db, { itemId: claimed.id, leaseToken: claimed.leaseToken, status: 'requesting', now: new Date('2020-01-01T00:00:00.500Z') });
    closeStudioDatabase(fixture.db);
    fixture.db = null;

    constructed = new LocalStudioService({ workspaceRoot });
    assert.equal(listGenerationRunItems(constructed.db, fixture.run.id)[0].status, 'requesting');
    assert.equal(getGenerationRun(constructed.db, fixture.run.id).status, 'running');
    await constructed.close();
    constructed = null;

    started = await startLocalStudioService({ workspaceRoot });
    assert.equal(listGenerationRunItems(started.service.db, fixture.run.id)[0].status, 'outcome_unknown');
    assert.equal(getGenerationRun(started.service.db, fixture.run.id).status, 'resume_pending');
    assert.equal(provider.count(), 0);
    await started.service.close();
    started = null;

    started = await startLocalStudioService({ workspaceRoot });
    assert.equal(listGenerationRunItems(started.service.db, fixture.run.id)[0].status, 'outcome_unknown');
    assert.equal(getGenerationRun(started.service.db, fixture.run.id).status, 'resume_pending');
  } finally {
    if (fixture && fixture.db) closeStudioDatabase(fixture.db);
    if (constructed) await constructed.close();
    if (started) await started.service.close();
    await provider.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});


test('controlled restart preserves its port and Workbench authorization only inside the daemon process', async () => {
  const workspaceRoot = temporaryWorkspace();
  const runtimePath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.json');
  const portPath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.port.json');
  const ownerRecordPath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.lock');
  const coordinationDatabasePath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon-lock.sqlite');
  let daemon;
  try {
    daemon = spawn(process.execPath, [daemonEntry, '--workspace', workspaceRoot], { stdio: ['ignore', 'ignore', 'pipe'] });
    await waitFor(() => fs.existsSync(runtimePath), 'first daemon runtime record');
    const first = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const firstOwner = JSON.parse(fs.readFileSync(ownerRecordPath, 'utf8'));
    assert.ok(Number.isInteger(first.port) && first.port > 0);
    assert.equal(typeof first.capability, 'string');
    assert.ok(first.capability.length >= 43);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(runtimePath).mode & 0o777, 0o600);
    }
    assert.equal((await fetch(first.url + '/api/studio')).status, 401);
    assert.equal((await fetch(first.url + '/api/studio', { headers: { authorization: 'Bearer ' + first.capability, 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0' } })).status, 200);
    const studioOutput = spawnSync(process.execPath, [cliEntry, 'studio', '--workspace', workspaceRoot], { encoding: 'utf8' });
    assert.equal(studioOutput.status, 0, studioOutput.stderr);
    assert.equal(studioOutput.stdout.includes(first.capability), false);
    assert.deepEqual(JSON.parse(studioOutput.stdout).workbench.command, ['daoge', 'open', '--workspace', workspaceRoot]);
    const statusOutput = spawnSync(process.execPath, [cliEntry, 'status', '--workspace', workspaceRoot], { encoding: 'utf8' });
    assert.equal(statusOutput.status, 0, statusOutput.stderr);
    assert.equal(statusOutput.stdout.includes(first.capability), false);
    assert.equal((await fetch(first.url + '/api/health')).status, 200);
    const bootstrap = await fetch(first.url + '/api/auth/bootstrap', { method: 'POST', headers: { origin: first.url, 'content-type': 'application/json' }, body: JSON.stringify({ capability: first.capability }) });
    assert.equal(bootstrap.status, 200);
    const setCookie = bootstrap.headers.get('set-cookie');
    assert.ok(setCookie);
    const cookie = setCookie.split(';', 1)[0];
    const restart = await fetch(first.url + '/api/restart', { method: 'POST', headers: { cookie, origin: first.url, 'content-type': 'application/json', 'idempotency-key': 'workbench-restart' }, body: '{}' });
    assert.equal(restart.status, 200);
    await waitFor(() => {
      try { return JSON.parse(fs.readFileSync(runtimePath, 'utf8')).startedAt !== first.startedAt; } catch { return false; }
    }, 'controlled daemon restart');
    const restarted = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const restartedOwner = JSON.parse(fs.readFileSync(ownerRecordPath, 'utf8'));
    assert.equal(restarted.pid, first.pid);
    assert.equal(restarted.url, first.url);
    assert.equal(restarted.capability, first.capability);
    assert.equal(firstOwner.pid, first.pid);
    assert.equal(restartedOwner.pid, first.pid);
    assert.notEqual(restartedOwner.ownerId, firstOwner.ownerId, 'controlled restart must release and reacquire the SQLite mutex');
    assert.equal((await fetch(restarted.url + '/api/studio', { headers: { cookie } })).status, 200);
    const normalClaim = await fetch(restarted.url + '/api/workbench/open-claim', { method: 'POST', headers: { authorization: 'Bearer ' + restarted.capability, 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0', 'content-type': 'application/json' }, body: JSON.stringify({ claimToken: 'n'.repeat(43) }) });
    assert.deepEqual((await normalClaim.json()).data, { claimed: false, reused: true, reason: 'recent-workbench' }, 'controlled restart must retain recent Workbench presence in daemon memory');
    const forcedClaim = await fetch(restarted.url + '/api/workbench/open-claim', { method: 'POST', headers: { authorization: 'Bearer ' + restarted.capability, 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0', 'content-type': 'application/json' }, body: JSON.stringify({ claimToken: 'f'.repeat(43), force: true }) });
    assert.deepEqual((await forcedClaim.json()).data, { claimed: true, reused: false, reason: 'forced-opener-claim' });
    assert.equal((await fetch(restarted.url + '/api/projects', { method: 'POST', headers: { cookie, origin: 'http://127.0.0.1:9', 'content-type': 'application/json', 'idempotency-key': 'hostile-local-page' }, body: JSON.stringify({ name: 'blocked' }) })).status, 403);
    await stopDaemon(daemon);
    daemon = null;
    assert.equal(fs.existsSync(runtimePath), false);
    assert.equal(fs.existsSync(ownerRecordPath), false);
    assert.equal(fs.existsSync(coordinationDatabasePath), true);

    daemon = spawn(process.execPath, [daemonEntry, '--workspace', workspaceRoot], { stdio: ['ignore', 'ignore', 'pipe'] });
    await waitFor(() => fs.existsSync(runtimePath), 'second daemon runtime record');
    const second = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    assert.equal(second.url, first.url);
    assert.equal(second.port, first.port);
    assert.notEqual(second.capability, first.capability);
    assert.equal(JSON.parse(fs.readFileSync(portPath, 'utf8')).port, first.port);
    assert.equal((await fetch(second.url + '/api/health')).status, 200);
  } finally {
    await stopDaemon(daemon);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('a stale owner record plus four concurrent first-start Studio CLIs converges on one healthy daemon owner', async () => {
  const workspaceRoot = temporaryWorkspace();
  const runtimePath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.json');
  const lockPath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.lock');
  const coordinationDatabasePath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon-lock.sqlite');
  const manifestPath = path.join(workspaceRoot, 'daoge-studio', 'studio.json');
  let daemonPid = null;
  const runtimeDir = path.dirname(runtimePath);
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ownerId: 'stale-live-unrelated-owner', acquiredAt: new Date(0).toISOString() }) + '\n', { mode: 0o600 });
  const invokeStudio = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliEntry, 'studio', '--workspace', workspaceRoot], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  try {
    const results = await Promise.all(Array.from({ length: 4 }, invokeStudio));
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const outputs = results.map((result) => JSON.parse(result.stdout));
    assert.equal(new Set(outputs.map((output) => output.daemon.pid)).size, 1);
    assert.equal(new Set(outputs.map((output) => output.daemon.url)).size, 1);
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    daemonPid = runtime.pid;
    assert.equal(runtime.pid, outputs[0].daemon.pid);
    assert.equal(runtime.workspaceRoot, path.resolve(workspaceRoot));
    assert.equal(lock.pid, runtime.pid);
    assert.equal(typeof lock.ownerId, 'string');
    assert.ok(lock.ownerId.length > 0);
    assert.equal(fs.existsSync(coordinationDatabasePath), true);
    const healthResponse = await fetch(runtime.url + '/api/health');
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.data.studioId, manifest.studioId);
    assert.equal(manifest.workspaceRoot, path.resolve(workspaceRoot));
    const initialized = initializeStudio({ workspaceRoot });
    assert.equal(initialized.manifest.studioId, manifest.studioId);
    const db = openStudioDatabase(initialized.paths, initialized.manifest);
    try {
      const studios = db.prepare('SELECT id, workspace_root FROM studios').all();
      assert.equal(studios.length, 1);
      assert.equal(studios[0].id, manifest.studioId);
      assert.equal(studios[0].workspace_root, path.resolve(workspaceRoot));
    } finally {
      closeStudioDatabase(db);
    }
  } finally {
    if (!daemonPid) {
      try { daemonPid = JSON.parse(fs.readFileSync(runtimePath, 'utf8')).pid || null; } catch { /* daemon never published runtime */ }
    }
    if (daemonPid) {
      try { process.kill(daemonPid, 'SIGTERM'); } catch { /* daemon already stopped */ }
      await waitFor(() => !livePid(daemonPid) && !fs.existsSync(runtimePath) && !fs.existsSync(lockPath), 'concurrent-start daemon process, runtime, and owner shutdown');
      await wait(250);
      assert.equal(livePid(daemonPid), false);
      assert.equal(fs.existsSync(runtimePath), false, 'no losing launcher may rebuild the runtime record');
      assert.equal(fs.existsSync(lockPath), false, 'no losing launcher may take over the owner record');
    }
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('a live unrelated PID owner record is overwritten without signaling that process, while a healthy daemon rejects a second daemon', async () => {
  const workspaceRoot = temporaryWorkspace();
  const runtimeDir = path.join(workspaceRoot, 'daoge-studio', 'runtime');
  const runtimePath = path.join(runtimeDir, 'daemon.json');
  const lockPath = path.join(runtimeDir, 'daemon.lock');
  let daemon = null;
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, ownerId: 'unrelated-live-process', acquiredAt: new Date(0).toISOString() }) + '\n', { mode: 0o600 });
  try {
    process.kill(process.pid, 0);
    daemon = spawn(process.execPath, [daemonEntry, '--workspace', workspaceRoot], { stdio: ['ignore', 'ignore', 'pipe'] });
    await waitFor(() => fs.existsSync(runtimePath), 'runtime after unrelated live PID takeover');
    const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.equal(runtime.pid, daemon.pid);
    assert.equal(lock.pid, daemon.pid);
    assert.notEqual(lock.ownerId, 'unrelated-live-process');
    process.kill(process.pid, 0);

    const duplicate = await runChild(daemonEntry, ['--workspace', workspaceRoot]);
    assert.equal(duplicate.code, 1);
    assert.match(duplicate.stderr, /already running/);
    assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).ownerId, lock.ownerId);
    assert.equal((await fetch(runtime.url + '/api/health')).status, 200);
  } finally {
    await stopDaemon(daemon);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
