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
const { openProviderDatabase, closeProviderDatabase, createProviderProfile } = require('../../dist/vnext/studio/provider-store');
const { GenerationWorker } = require('../../dist/vnext/runner/worker');
const { LocalStudioService, startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson, requestJsonAsWorkbench, workbenchCookie } = require('./local-studio-test-helper');

const skillRoot = path.resolve(__dirname, '../..');

const daemonEntry = path.join(skillRoot, 'dist', 'vnext', 'cli', 'daemon.js');
const cliEntry = path.join(skillRoot, 'dist', 'vnext', 'cli', 'daoge.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
test('media worker pool is an independently addressable child-process pool', async () => {
  const { MediaProcessPool } = require('../../dist/vnext/runtime/media-worker-pool');
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-media-pool-'));
  const initialized = initializeStudio({ workspaceRoot });
  const database = openStudioDatabase(initialized.paths, initialized.manifest);
  closeStudioDatabase(database);
  const pool = new MediaProcessPool(workspaceRoot, 1);
  try {
    assert.deepEqual(pool.processIds(), []);
    assert.equal(pool.healthSnapshot().state, 'idle');
    const reconciliation = pool.run({ type: 'reconcile', studioId: initialized.manifest.studioId });
    await waitFor(() => pool.processIds().length === 1, 'lazy media worker child');
    assert.equal((await reconciliation).type, 'reconcile');
    assert.equal(pool.healthSnapshot().state, 'ready');
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
    const database = openStudioDatabase(initialized.paths, initialized.manifest);
    closeStudioDatabase(database);
    generationPool = new WorkerProcessPool(workspaceRoot, 1);
    mediaPool = new MediaProcessPool(workspaceRoot, 1);
    assert.deepEqual(generationPool.processIds(), []);
    assert.deepEqual(mediaPool.processIds(), []);
    assert.equal(generationPool.healthSnapshot().state, 'idle');
    assert.equal(mediaPool.healthSnapshot().state, 'idle');
    await generationPool.processOnce(1);
    const initialMedia = mediaPool.run({ type: 'reconcile', studioId: initialized.manifest.studioId });
    await waitFor(() => generationPool.processIds().length === 1 && mediaPool.processIds().length === 1, 'lazy worker pool children');
    await initialMedia;
    const generationPid = generationPool.processIds()[0];
    const mediaPid = mediaPool.processIds()[0];
    process.kill(generationPid, 'SIGKILL');
    process.kill(mediaPid, 'SIGKILL');
    await waitFor(() => generationPool.processIds()[0] && generationPool.processIds()[0] !== generationPid && mediaPool.processIds()[0] && mediaPool.processIds()[0] !== mediaPid, 'respawned worker pool children');
    assert.ok(generationPool.healthSnapshot().restartCount >= 1);
    assert.ok(mediaPool.healthSnapshot().restartCount >= 1);
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

test('daemon hot-loads active Provider changes without a controlled restart', async () => {
  const workspaceRoot = temporaryWorkspace();
  const providerRequests = [];
  const providerServer = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      providerRequests.push({ url: request.url, authorization: request.headers.authorization || null, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
    });
  });
  let daemon;
  let providerDb;
  let daemonStderr = '';
  try {
    await new Promise((resolve, reject) => providerServer.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    const address = providerServer.address();
    assert.ok(address && typeof address !== 'string');
    const providerBase = 'http://127.0.0.1:' + address.port;
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { name: 'Initial Provider', baseUrl: providerBase + '/initial/v1', apiKey: 'initial-provider-key', model: 'initial-model', endpointTrustMode: 'local_proxy' });
    providerDb = openProviderDatabase(initialized.paths);
    const alternate = createProviderProfile(providerDb, { name: 'Alternate Provider', providerId: 'openai-images', model: 'alternate-model', baseUrl: providerBase + '/alternate/v1', apiKey: 'alternate-provider-key', endpointTrustMode: 'local_proxy', options: {}, active: false, idempotencyKey: 'alternate-provider-create' });
    closeProviderDatabase(providerDb);
    providerDb = null;

    assert.ok(fs.existsSync(daemonEntry), 'vNext daemon must be compiled before resilience tests run');
    daemon = spawn(process.execPath, [daemonEntry, '--workspace', workspaceRoot, '--port', '0'], { stdio: ['ignore', 'ignore', 'pipe'] });
    daemon.stderr.on('data', (chunk) => { daemonStderr += String(chunk); });
    const runtimePath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.json');
    await waitFor(() => fs.existsSync(runtimePath), 'daemon runtime record');
    const initialRuntime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const started = { url: initialRuntime.url, access: { bearerToken: initialRuntime.capability } };
    const activated = await requestJson(started, '/api/providers/' + encodeURIComponent(alternate.id) + '/activate', { method: 'POST', idempotencyKey: 'activate-alternate-provider', body: {} });
    assert.equal(activated.status, 200, JSON.stringify(activated.body));
    assert.equal(activated.body.data.impact.restartRequired, false);
    await waitFor(() => {
      const current = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
      return current.pid === initialRuntime.pid && current.provider?.profileId === alternate.id;
    }, 'daemon hot-loaded Provider identity');
    assert.equal(livePid(initialRuntime.pid), true);

    const session = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'hot-provider-session', body: { conversationId: 'hot-provider-conversation' } });
    const sessionId = session.body.data.id;
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'hot-provider-project', body: { name: 'Provider hot reload', sessionId } });
    const task = await requestJson(started, '/api/tasks', { method: 'POST', idempotencyKey: 'hot-provider-task', body: { projectId: project.body.data.value.id, name: 'Hot reload image', sessionId } });
    const round = await requestJson(started, '/api/rounds', { method: 'POST', idempotencyKey: 'hot-provider-round', body: { taskId: task.body.data.value.id, purpose: 'exploration', sessionId } });
    const prepared = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/prepare', { method: 'POST', idempotencyKey: 'hot-provider-prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'hot loaded provider image' } } });
    const challenge = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/confirmation-challenge', { method: 'POST', idempotencyKey: 'hot-provider-challenge', body: { sessionId } });
    const cookie = await workbenchCookie(started);
    const confirmed = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/confirm', { cookie, idempotencyKey: 'hot-provider-confirm', body: { expectedVersion: prepared.body.data.value.version, sessionId, challenge: challenge.body.data.challenge } });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    const preflight = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/preflight', { method: 'POST', idempotencyKey: 'hot-provider-preflight', body: { sessionId } });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.body));
    const queued = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: 'hot-provider-run', body: { roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id, confirmToken: preflight.body.data.value.confirmToken } });
    assert.equal(queued.status, 200, JSON.stringify(queued.body));
    await waitFor(() => providerRequests.some((entry) => entry.authorization === 'Bearer alternate-provider-key'), 'hot-loaded Provider request', 10000);
    assert.equal(providerRequests.some((entry) => entry.authorization === 'Bearer initial-provider-key'), false);
    assert.equal(providerRequests.some((entry) => entry.url === '/alternate/v1/images/generations'), true);
  } finally {
    if (providerDb) closeProviderDatabase(providerDb);
    await stopDaemon(daemon, workspaceRoot);
    if (providerServer.listening) await new Promise((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()));
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    if (daemonStderr) assert.equal(daemonStderr.includes('Studio daemon failed.'), false, daemonStderr);
  }
});

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-daemon-resilience-'));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, description, timeoutMs = process.platform === 'win32' ? 60000 : 5000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for ' + description + '.');
    await wait(25);
  }
}
async function fetchEventually(url, options, timeoutMs = process.platform === 'win32' ? 30000 : 5000) {
  const started = Date.now();
  let failure;
  while (Date.now() - started <= timeoutMs) {
    try { return await fetch(url, options); }
    catch (error) { failure = error; await wait(50); }
  }
  throw failure || new Error('Timed out waiting for daemon HTTP recovery.');
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


async function shutdownDaemonRuntime(workspaceRoot, expectedPid) {
  const runtimePath = path.join(workspaceRoot, 'daoge-studio', 'runtime', 'daemon.json');
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  if (runtime.pid !== expectedPid) throw new Error('Refusing to shut down a different daemon process.');
  const response = await fetch(runtime.url + '/api/shutdown', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + runtime.capability,
      'content-type': 'application/json',
      'x-daoge-operation-name': 'daemon-shutdown-test',
      'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0'
    },
    body: '{}',
    signal: AbortSignal.timeout(process.platform === 'win32' ? 30000 : 5000)
  });
  if (!response.ok) throw new Error('Daemon rejected controlled shutdown with HTTP ' + response.status + '.');
}

function stopDaemon(child, workspaceRoot) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { child.kill('SIGKILL'); }, process.platform === 'win32' ? 30000 : 3000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    void shutdownDaemonRuntime(workspaceRoot, child.pid).catch(() => { child.kill(process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM'); });
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
    }, process.platform === 'win32' ? 60000 : 5000);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr, pid: child.pid }); });
  });
}


function createQueuedHundredItemRun(workspaceRoot, providerBaseUrl) {
  const initialized = initializeStudio({ workspaceRoot });
  const { config, status } = configureProvider(initialized, { baseUrl: providerBaseUrl, model: 'gpt-image-2', apiKey: 'daemon-recovery-test-key', endpointTrustMode: 'local_proxy' });
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
    await stopDaemon(daemon, workspaceRoot);
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
    await stopDaemon(daemon, workspaceRoot);
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

    constructed = new LocalStudioService({ hardenAccess: false, workspaceRoot });
    assert.equal(listGenerationRunItems(constructed.db, fixture.run.id)[0].status, 'requesting');
    assert.equal(getGenerationRun(constructed.db, fixture.run.id).status, 'running');
    await constructed.close();
    constructed = null;

    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    assert.equal(listGenerationRunItems(started.service.db, fixture.run.id)[0].status, 'outcome_unknown');
    assert.equal(getGenerationRun(started.service.db, fixture.run.id).status, 'resume_pending');
    assert.equal(provider.count(), 0);
    await started.service.close();
    started = null;

    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
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
    const restart = spawnSync(process.execPath, [cliEntry, 'restart', '--workspace', workspaceRoot], { encoding: 'utf8', timeout: process.platform === 'win32' ? 45000 : 15000 });
    assert.equal(restart.status, 0, restart.stderr);
    const restartResult = JSON.parse(restart.stdout);
    assert.equal(restartResult.previousPid, first.pid);
    assert.equal(restartResult.daemon.pid, first.pid);
    const restarted = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    const restartedOwner = JSON.parse(fs.readFileSync(ownerRecordPath, 'utf8'));
    assert.equal(restarted.pid, first.pid);
    assert.equal(restarted.url, first.url);
    assert.equal(restarted.capability, first.capability);
    assert.equal(firstOwner.pid, first.pid);
    assert.equal(restartedOwner.pid, first.pid);
    assert.notEqual(restartedOwner.ownerId, firstOwner.ownerId, 'controlled restart must release and reacquire the SQLite mutex');
    assert.equal((await fetchEventually(restarted.url + '/api/studio', { headers: { cookie } })).status, 200);
    const normalClaim = await fetchEventually(restarted.url + '/api/workbench/open-claim', { method: 'POST', headers: { authorization: 'Bearer ' + restarted.capability, 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0', 'content-type': 'application/json' }, body: JSON.stringify({ claimToken: 'n'.repeat(43) }) });
    assert.deepEqual((await normalClaim.json()).data, { claimed: false, reused: true, reason: 'recent-workbench' }, 'controlled restart must retain recent Workbench presence in daemon memory');
    const forcedClaim = await fetchEventually(restarted.url + '/api/workbench/open-claim', { method: 'POST', headers: { authorization: 'Bearer ' + restarted.capability, 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0', 'content-type': 'application/json' }, body: JSON.stringify({ claimToken: 'f'.repeat(43), force: true }) });
    assert.deepEqual((await forcedClaim.json()).data, { claimed: true, reused: false, reason: 'forced-opener-claim' });
    assert.equal((await fetchEventually(restarted.url + '/api/projects', { method: 'POST', headers: { cookie, origin: 'http://127.0.0.1:9', 'content-type': 'application/json', 'idempotency-key': 'hostile-local-page' }, body: JSON.stringify({ name: 'blocked' }) })).status, 403);
    assert.equal((await fetchEventually(restarted.url + '/api/shutdown', { method: 'POST', headers: { cookie, origin: restarted.url, 'content-type': 'application/json', 'idempotency-key': 'cookie-shutdown-blocked' }, body: '{}' })).status, 403);
    await stopDaemon(daemon, workspaceRoot);
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
    await stopDaemon(daemon, workspaceRoot);
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
      try { await shutdownDaemonRuntime(workspaceRoot, daemonPid); }
      catch { try { process.kill(daemonPid, process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM'); } catch { /* daemon already stopped */ } }
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
    await stopDaemon(daemon, workspaceRoot);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
