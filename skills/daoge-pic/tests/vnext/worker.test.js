const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { configureProvider } = require('./provider-test-helper');
const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const { cancelGenerationRun, createDryRunPreview, queueGenerationRun, getGenerationRun, listGenerationRunItems } = require('../../dist/vnext/runner/run-commands');
const { GenerationWorker } = require('../../dist/vnext/runner/worker');
const { StudioGeneratedAssetPersister } = require('../../dist/vnext/media/generated-assets');
const { assetFilePath, importStudioAsset, setStudioAssetShared } = require('../../dist/vnext/domain/assets');
const { StudioAssetResolver } = require('../../dist/vnext/media/asset-resolver');



const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-worker-'));
}

function setupRun(itemCount = 1) {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const { config, status } = configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'memory-only-key' });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'worker test', idempotencyKey: 'project' });
  const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.value.id, name: 'image', idempotencyKey: 'task' });
  const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.value.id, purpose: 'exploration', idempotencyKey: 'round' });
  const prepared = prepareRoundForConfirmation(db, { studioId: initialized.manifest.studioId, roundId: round.value.id, plan: { operation: 'generate', itemCount, prompt: 'single clean image' }, expectedVersion: round.value.version, idempotencyKey: 'prepare' });
  const confirmed = confirmRoundPlan(db, { studioId: initialized.manifest.studioId, roundId: round.value.id, expectedVersion: prepared.value.version, idempotencyKey: 'confirm' });
  const dryRun = createDryRunPreview(db, { studioId: initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'dry-run' });
  const run = queueGenerationRun(db, { studioId: initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'run' });
  return { workspaceRoot, initialized, db, config, run, projectId: project.value.id };
}

function cleanup(fixture) {
  closeStudioDatabase(fixture.db);
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

function attachManagedAssets(fixture, input) {
  const item = fixture.db.prepare('SELECT id, prompt_payload_json FROM run_items WHERE run_id = ?').get(fixture.run.value.id);
  const payload = JSON.parse(item.prompt_payload_json);
  fixture.db.prepare('UPDATE run_items SET prompt_payload_json = ? WHERE id = ?').run(JSON.stringify({ ...payload, ...input }), item.id);
}

function attachManagedAssetsToAllItems(fixture, input) {
  const items = fixture.db.prepare('SELECT id, prompt_payload_json FROM run_items WHERE run_id = ?').all(fixture.run.value.id);
  for (const item of items) fixture.db.prepare('UPDATE run_items SET prompt_payload_json = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(item.prompt_payload_json), ...input }), item.id);
}

function largePng(fill = 0x41) {
  return Buffer.concat([png, Buffer.alloc(192 * 1024 - png.length, fill)]);
}

function sameSizeReplacement(bytes, fill = 0x42) {
  return Buffer.concat([bytes.subarray(0, 16), Buffer.alloc(bytes.length - 16, fill)]);
}

function mutateAfterAsyncRead(filePath, mutate) {
  const originalOpen = fs.promises.open;
  let mutated = false;
  fs.promises.open = async function (openedPath, ...args) {
    const handle = await originalOpen.call(fs.promises, openedPath, ...args);
    if (openedPath === filePath && (args[0] & fs.constants.O_ACCMODE) === fs.constants.O_RDONLY) {
      const read = handle.read.bind(handle);
      handle.read = async function (...readArgs) {
        const result = await read(...readArgs);
        if (!mutated && result.bytesRead && readArgs[3] === 0) {
          mutated = true;
          mutate();
        }
        return result;
      };
    }
    return handle;
  };
  return { get mutated() { return mutated; }, restore() { fs.promises.open = originalOpen; } };
}

function fakeProvider(generate, classifyError) {
  return {
    id: 'openai-images',
    validateConfig: () => ({ valid: true, missing: [] }),
    capabilities: () => ({ textToImage: true, referenceEdit: true, maskEdit: true, cancellation: false, reconciliation: false, idempotency: false, acceptedReferenceMediaTypes: ['image/png'] }),
    generate,
    classifyError
  };
}

test('worker persists a successful Provider result and completes its run', async () => {
  const fixture = setupRun();
  try {
    const persisted = [];
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-success',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => ({ bytes: png, mediaType: 'image/png', externalRequestId: 'remote-success', safeMeta: { model: 'safe' } }), () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetPersister: { persistGeneratedImage: async ({ result }) => { persisted.push(result); return { assetId: 'asset-output', mediaType: result.mediaType, byteSize: result.bytes.length, contentHash: 'content-hash' }; } },
      now: () => new Date('2026-01-01T00:00:00.000Z')
    });
    const result = await worker.processOnce();
    assert.deepEqual(result, { claimed: 1, succeeded: 1, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 });
    assert.equal(persisted.length, 1);
    assert.equal(getGenerationRun(fixture.db, fixture.run.value.id).status, 'completed');
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].status, 'succeeded');
    const storedResult = fixture.db.prepare('SELECT result_json FROM run_items WHERE run_id = ?').get(fixture.run.value.id).result_json;
    assert.equal(storedResult.includes('memory-only-key'), false);
  } finally {
    cleanup(fixture);
  }
});

test('worker starts every claimed batch item before waiting for a slow Provider response', async () => {
  const fixture = setupRun(2);
  try {
    let calls = 0;
    let releaseFirst;
    const firstResponse = new Promise((resolve) => { releaseFirst = resolve; });
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-concurrent-batch',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => {
        calls += 1;
        if (calls === 1) await firstResponse;
        return { bytes: png, mediaType: 'image/png', externalRequestId: 'remote-batch-' + calls };
      }, () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetPersister: { persistGeneratedImage: async ({ result }) => ({ assetId: 'asset-' + result.externalRequestId, mediaType: result.mediaType, byteSize: result.bytes.length, contentHash: 'content-hash-' + result.externalRequestId }) }
    });
    const execution = worker.processOnce(2);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 2, 'a later lease must begin before the first Provider response resolves');
    releaseFirst();
    assert.deepEqual(await execution, { claimed: 2, succeeded: 2, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 });
    assert.equal(getGenerationRun(fixture.db, fixture.run.value.id).status, 'completed');
  } finally {
    cleanup(fixture);
  }
});

test('worker shares one verified reference buffer for concurrent items in the same run and releases it after Provider use', async () => {
  const fixture = setupRun(2);
  const originalOpen = fs.promises.open;
  try {
    const reference = importStudioAsset(fixture.db, fixture.initialized.paths, { studioId: fixture.initialized.manifest.studioId, bytes: largePng(), mediaType: 'image/png', targetType: 'project', targetId: fixture.projectId });
    attachManagedAssetsToAllItems(fixture, { referenceAssetIds: [reference.id] });
    const referencePath = assetFilePath(fixture.initialized.paths, reference);
    let sourceOpenCount = 0;
    fs.promises.open = async function (openedPath, ...args) {
      if (openedPath === referencePath && (args[0] & fs.constants.O_ACCMODE) === fs.constants.O_RDONLY) sourceOpenCount += 1;
      return originalOpen.call(fs.promises, openedPath, ...args);
    };
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let bothStarted;
    const started = new Promise((resolve) => { bothStarted = resolve; });
    const buffers = [];
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-shared-media',
      providerConfig: fixture.config,
      provider: fakeProvider(async (request) => {
        calls += 1;
        buffers.push(request.referenceAssets[0].bytes);
        if (calls === 2) bothStarted();
        await gate;
        return { bytes: png, mediaType: 'image/png', externalRequestId: 'shared-' + calls };
      }, () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetResolver: new StudioAssetResolver({ db: fixture.db, paths: fixture.initialized.paths }),
      assetPersister: { persistGeneratedImage: async ({ result }) => ({ assetId: 'asset-' + result.externalRequestId, mediaType: result.mediaType, byteSize: result.bytes.length, contentHash: 'content-' + result.externalRequestId }) }
    });
    const execution = worker.processOnce(2);
    await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('concurrent Provider calls did not start')), 2000))]);
    assert.equal(calls, 2);
    assert.equal(sourceOpenCount, 1);
    assert.equal(buffers[0], buffers[1]);
    release();
    assert.equal((await execution).succeeded, 2);
    assert.deepEqual(fs.readdirSync(path.join(fixture.initialized.paths.cacheDir, 'staging')), []);
  } finally {
    fs.promises.open = originalOpen;
    cleanup(fixture);
  }
});

test('worker retains resolved media until an abort-ignoring Provider settles', async () => {
  const fixture = setupRun();
  try {
    let releaseProvider;
    let releaseCalls = 0;
    const gate = new Promise((resolve) => { releaseProvider = resolve; });
    const resolver = { resolve: async () => ({ assets: { referenceAssets: [{ assetId: 'asset-reference', mediaType: 'image/png', bytes: png }] }, release: () => { releaseCalls += 1; } }) };
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-media-lifetime',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => { await gate; return { bytes: png, mediaType: 'image/png' }; }, () => ({ kind: 'unknown_outcome', code: 'aborted', message: 'aborted' })),
      assetResolver: resolver,
      assetPersister: { persistGeneratedImage: async () => { throw new Error('aborted request must not persist'); } },
      leaseMs: 1000
    });
    const execution = worker.processOnce();
    await new Promise((resolve) => setImmediate(resolve));
    worker.shutdown();
    assert.equal((await execution).unknown, 1);
    assert.equal(releaseCalls, 0, 'media must remain retained while an abort-ignoring Provider can still consume it');
    releaseProvider();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(releaseCalls, 1);
  } finally {
    cleanup(fixture);
  }
});


test('worker respects each configured batch limit before starting an additional request', async () => {
  for (const limit of [1, 2, 4]) {
    const fixture = setupRun(limit + 1);
    try {
      let calls = 0;
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const worker = new GenerationWorker({
        db: fixture.db,
        workerId: 'worker-limit-' + limit,
        providerConfig: fixture.config,
        provider: fakeProvider(async () => { calls += 1; await gate; return { bytes: png, mediaType: 'image/png', externalRequestId: 'limit-' + calls }; }, () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
        assetPersister: { persistGeneratedImage: async ({ result }) => ({ assetId: 'asset-' + result.externalRequestId, mediaType: result.mediaType, byteSize: result.bytes.length, contentHash: 'content-' + result.externalRequestId }) }
      });
      const execution = worker.processOnce(limit);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, limit, 'limit ' + limit + ' must not start item N+1');
      assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id).filter((item) => item.status === 'pending').length, 1);
      release();
      assert.equal((await execution).claimed, limit);
      assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id).filter((item) => item.status === 'succeeded').length, limit);
    } finally { cleanup(fixture); }
  }
});

test('worker archives generated bytes and records a managed Studio asset', async () => {
  const fixture = setupRun();
  try {
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-archive',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => ({ bytes: png, mediaType: 'image/png', externalRequestId: 'remote-archive', safeMeta: { provider: 'openai-images' } }), () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetPersister: new StudioGeneratedAssetPersister({ db: fixture.db, paths: fixture.initialized.paths, studioId: fixture.initialized.manifest.studioId }),
      now: () => new Date('2026-01-01T00:00:00.000Z')
    });
    await worker.processOnce();
    const asset = fixture.db.prepare('SELECT storage_path, source_json, content_hash FROM assets').get();
    assert.equal(asset.storage_path.startsWith('daoge-assets/generated/asset_'), true);
    assert.equal(fs.existsSync(path.join(fixture.workspaceRoot, asset.storage_path)), true);
    assert.equal(asset.source_json.includes('memory-only-key'), false);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS total FROM asset_relations WHERE target_type = ?').get('run_item').total, 1);
  } finally {
    cleanup(fixture);
  }
});

test('worker schedules a bounded retry for rate limits without persisting an asset', async () => {
  const fixture = setupRun();
  try {
    let persistenceCalls = 0;
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-retry',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => { const error = new Error('slow down'); error.status = 429; throw error; }, (error) => ({ kind: 'rate_limited', code: '429', message: error.message, retryAfterMs: 1000 })),
      assetPersister: { persistGeneratedImage: async () => { persistenceCalls += 1; throw new Error('should not persist'); } },
      retryPolicy: { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 5000, jitterRatio: 0 },
      now: () => new Date('2026-01-01T00:00:00.000Z')
    });
    const result = await worker.processOnce();
    assert.deepEqual(result, { claimed: 1, succeeded: 0, retrying: 1, blocked: 0, unknown: 0, cancelled: 0 });
    const item = listGenerationRunItems(fixture.db, fixture.run.value.id)[0];
    assert.equal(item.status, 'retry_wait');
    assert.equal(item.retryAt, '2026-01-01T00:00:01.000Z');
    assert.equal(persistenceCalls, 0);
  } finally {
    cleanup(fixture);
  }
});


test('worker blocks local persistence failure without classifying or replaying the Provider request', async () => {
  const fixture = setupRun();
  try {
    let calls = 0;
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-local-persistence',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => { calls += 1; return { bytes: png, mediaType: 'image/png' }; }, () => { throw new Error('Provider classifier must not receive local persistence errors.'); }),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('disk full'); } },
      now: () => new Date('2026-01-01T00:00:00.000Z')
    });
    assert.deepEqual(await worker.processOnce(), { claimed: 1, succeeded: 0, retrying: 0, blocked: 1, unknown: 0, cancelled: 0 });
    assert.equal(calls, 1);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].status, 'blocked');
  } finally { cleanup(fixture); }
});

test('worker never automatically replays an unknown Provider outcome', async () => {
  const fixture = setupRun();
  try {
    let calls = 0;
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-unknown',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => { calls += 1; throw new Error('connection dropped after request'); }, () => ({ kind: 'unknown_outcome', code: 'connection_lost', message: 'connection dropped after request' })),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('should not persist'); } },
      now: () => new Date('2026-01-01T00:00:00.000Z')
    });
    const first = await worker.processOnce();
    const second = await worker.processOnce();
    assert.deepEqual(first, { claimed: 1, succeeded: 0, retrying: 0, blocked: 0, unknown: 1, cancelled: 0 });
    assert.deepEqual(second, { claimed: 0, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 });
    assert.equal(calls, 1);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].status, 'outcome_unknown');
  } finally {
    cleanup(fixture);
  }
});

test('worker safely cancels when the Provider returns a definite result after cancellation', async () => {
  const fixture = setupRun();
  try {
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-cancel-returned',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => {
        cancelGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: fixture.run.value.id, idempotencyKey: 'cancel-returned' });
        return { bytes: png, mediaType: 'image/png', externalRequestId: 'cancelled-result' };
      }, () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('cancelled Provider output must not persist'); } },
      now: () => new Date('2026-01-01T00:00:00.000Z')
    });
    assert.deepEqual(await worker.processOnce(), { claimed: 1, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 1 });
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].status, 'cancelled');
  } finally { cleanup(fixture); }
});

test('worker closes an abort-ignoring in-flight cancellation as outcome unknown without leaving cancel_requested', async () => {
  const fixture = setupRun();
  try {
    let release;
    let observedSignal;
    const gate = new Promise((resolve) => { release = resolve; });
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-cancel-ignores-abort',
      providerConfig: fixture.config,
      provider: fakeProvider(async (_request, options) => { observedSignal = options.abortSignal; await gate; return { bytes: png, mediaType: 'image/png' }; }, () => ({ kind: 'unknown_outcome', code: 'aborted', message: 'aborted' })),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('unknown result must not persist'); } },
      leaseMs: 1000
    });
    const execution = worker.processOnce();
    await new Promise((resolve) => setImmediate(resolve));
    cancelGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: fixture.run.value.id, idempotencyKey: 'cancel-ignores-abort' });
    await new Promise((resolve) => setTimeout(resolve, 450));
    release();
    assert.deepEqual(await execution, { claimed: 1, succeeded: 0, retrying: 0, blocked: 0, unknown: 1, cancelled: 0 });
    assert.equal(observedSignal.aborted, true);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].status, 'outcome_unknown');
  } finally { cleanup(fixture); }
});

test('worker shutdown aborts an in-flight Provider request and settles without awaiting an abort-ignoring Provider', async () => {
  const fixture = setupRun();
  let release;
  try {
    let observedSignal;
    const gate = new Promise((resolve) => { release = resolve; });
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-daemon-shutdown',
      providerConfig: fixture.config,
      provider: fakeProvider(async (_request, options) => {
        observedSignal = options.abortSignal;
        await gate;
        return { bytes: png, mediaType: 'image/png' };
      }, () => ({ kind: 'unknown_outcome', code: 'aborted', message: 'aborted' })),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('shutdown Provider output must not persist'); } },
      leaseMs: 1000
    });
    const execution = worker.processOnce();
    await new Promise((resolve) => setImmediate(resolve));
    worker.shutdown();
    assert.deepEqual(await execution, { claimed: 1, succeeded: 0, retrying: 0, blocked: 0, unknown: 1, cancelled: 0 });
    assert.equal(observedSignal.aborted, true);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].status, 'outcome_unknown');
    assert.deepEqual(await worker.processOnce(), { claimed: 0, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 });
  } finally {
    if (release) release();
    cleanup(fixture);
  }
});

test('worker awaits in-progress local persistence before settling cancellation', async () => {
  const fixture = setupRun();
  let releasePersistence;
  try {
    let persistenceCalls = 0;
    let markPersistenceStarted;
    const persistenceStarted = new Promise((resolve) => { markPersistenceStarted = resolve; });
    const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-cancel-persisting',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => ({ bytes: png, mediaType: 'image/png' }), () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetPersister: { persistGeneratedImage: async ({ result }) => {
        persistenceCalls += 1;
        markPersistenceStarted();
        await persistenceGate;
        return { assetId: 'asset-persisting-cancel', mediaType: result.mediaType, byteSize: result.bytes.length, contentHash: 'persisting-cancel-hash' };
      } },
      leaseMs: 1000
    });
    const execution = worker.processOnce();
    let settled = false;
    void execution.then(() => { settled = true; }, () => { settled = true; });
    await persistenceStarted;
    cancelGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: fixture.run.value.id, idempotencyKey: 'cancel-during-persistence' });
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(settled, false, 'cancellation must not detach an in-progress local persistence commit');
    assert.equal(persistenceCalls, 1);
    releasePersistence();
    releasePersistence = null;
    assert.deepEqual(await execution, { claimed: 1, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 1 });
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].status, 'cancelled');
    assert.equal(persistenceCalls, 1);
  } finally {
    if (releasePersistence) releasePersistence();
    cleanup(fixture);
  }
});

test('worker awaits in-progress local persistence after lease ownership loss', async () => {
  const fixture = setupRun();
  let releasePersistence;
  try {
    let persistenceCalls = 0;
    let markPersistenceStarted;
    const persistenceStarted = new Promise((resolve) => { markPersistenceStarted = resolve; });
    const persistenceGate = new Promise((resolve) => { releasePersistence = resolve; });
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-lease-loss-persisting',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => ({ bytes: png, mediaType: 'image/png' }), () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetPersister: { persistGeneratedImage: async ({ result }) => {
        persistenceCalls += 1;
        markPersistenceStarted();
        await persistenceGate;
        return { assetId: 'asset-persisting-lease-loss', mediaType: result.mediaType, byteSize: result.bytes.length, contentHash: 'persisting-lease-loss-hash' };
      } },
      leaseMs: 1000
    });
    const execution = worker.processOnce();
    let settled = false;
    void execution.then(() => { settled = true; }, () => { settled = true; });
    await persistenceStarted;
    const item = listGenerationRunItems(fixture.db, fixture.run.value.id)[0];
    fixture.db.prepare("UPDATE run_items SET lease_token = 'different-owner' WHERE id = ?").run(item.id);
    await new Promise((resolve) => setTimeout(resolve, 450));
    assert.equal(settled, false, 'lease loss must not detach an in-progress local persistence commit');
    assert.equal(persistenceCalls, 1);
    releasePersistence();
    releasePersistence = null;
    assert.deepEqual(await execution, { claimed: 1, succeeded: 0, retrying: 0, blocked: 0, unknown: 1, cancelled: 0 });
    const recovered = listGenerationRunItems(fixture.db, fixture.run.value.id)[0];
    assert.equal(recovered.status, 'outcome_unknown');
    assert.equal(recovered.error.code, 'lease_ownership_lost');
    assert.equal(persistenceCalls, 1);
  } finally {
    if (releasePersistence) releasePersistence();
    cleanup(fixture);
  }
});

test('worker persists lease ownership loss as an unknown outcome', async () => {
  const fixture = setupRun();
  try {
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-lease-loss',
      providerConfig: fixture.config,
      provider: fakeProvider((_request, options) => new Promise((_resolve, reject) => options.abortSignal.addEventListener('abort', () => reject(new Error('lease lost')), { once: true })), () => ({ kind: 'unknown_outcome', code: 'aborted', message: 'aborted' })),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('unknown result must not persist'); } },
      leaseMs: 1000
    });
    const execution = worker.processOnce();
    await new Promise((resolve) => setImmediate(resolve));
    const item = listGenerationRunItems(fixture.db, fixture.run.value.id)[0];
    fixture.db.prepare("UPDATE run_items SET lease_token = 'different-owner' WHERE id = ?").run(item.id);
    assert.deepEqual(await execution, { claimed: 1, succeeded: 0, retrying: 0, blocked: 0, unknown: 1, cancelled: 0 });
    const recovered = listGenerationRunItems(fixture.db, fixture.run.value.id)[0];
    assert.equal(recovered.status, 'outcome_unknown');
    assert.equal(recovered.error.code, 'lease_ownership_lost');
  } finally { cleanup(fixture); }
});

test('worker never calls the Provider after a same-size reference replacement before snapshotting', async () => {
  const fixture = setupRun();
  try {
    const original = largePng();
    const reference = importStudioAsset(fixture.db, fixture.initialized.paths, { studioId: fixture.initialized.manifest.studioId, bytes: original, mediaType: 'image/png', targetType: 'project', targetId: fixture.projectId });
    attachManagedAssets(fixture, { referenceAssetIds: [reference.id] });
    fs.writeFileSync(assetFilePath(fixture.initialized.paths, reference), sameSizeReplacement(original));
    let providerCalls = 0;
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-reference-snapshot-rejected',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => { providerCalls += 1; return { bytes: png, mediaType: 'image/png' }; }, () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetResolver: new StudioAssetResolver({ db: fixture.db, paths: fixture.initialized.paths }),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('rejected managed assets must not persist'); } }
    });
    assert.deepEqual(await worker.processOnce(), { claimed: 1, succeeded: 0, retrying: 0, blocked: 1, unknown: 0, cancelled: 0 });
    assert.equal(providerCalls, 0);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].error.code, 'managed_asset_resolution_failed');
    assert.deepEqual(fs.readdirSync(path.join(fixture.initialized.paths.cacheDir, 'staging')), []);
  } finally {
    cleanup(fixture);
  }
});

test('worker never calls the Provider when a mask is mutated in place during snapshotting', async () => {
  const fixture = setupRun();
  let mutation;
  try {
    const original = largePng();
    const mask = importStudioAsset(fixture.db, fixture.initialized.paths, { studioId: fixture.initialized.manifest.studioId, bytes: original, mediaType: 'image/png', targetType: 'project', targetId: fixture.projectId });
    attachManagedAssets(fixture, { maskAssetId: mask.id });
    const filePath = assetFilePath(fixture.initialized.paths, mask);
    mutation = mutateAfterAsyncRead(filePath, () => fs.writeFileSync(filePath, sameSizeReplacement(original)));
    let providerCalls = 0;
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-mask-snapshot-rejected',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => { providerCalls += 1; return { bytes: png, mediaType: 'image/png' }; }, () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetResolver: new StudioAssetResolver({ db: fixture.db, paths: fixture.initialized.paths }),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('rejected managed assets must not persist'); } }
    });
    assert.deepEqual(await worker.processOnce(), { claimed: 1, succeeded: 0, retrying: 0, blocked: 1, unknown: 0, cancelled: 0 });
    assert.equal(mutation.mutated, true);
    assert.equal(providerCalls, 0);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].error.code, 'managed_asset_resolution_failed');
    assert.deepEqual(fs.readdirSync(path.join(fixture.initialized.paths.cacheDir, 'staging')), []);
  } finally {
    if (mutation) mutation.restore();
    cleanup(fixture);
  }
});

test('worker blocks an unshared asset after its shared access is revoked without calling the Provider', async () => {
  const fixture = setupRun();
  try {
    const otherProject = createProject(fixture.db, { studioId: fixture.initialized.manifest.studioId, name: 'other worker project', idempotencyKey: 'worker-other-project' }).value;
    const reference = importStudioAsset(fixture.db, fixture.initialized.paths, { studioId: fixture.initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: otherProject.id });
    setStudioAssetShared(fixture.db, { studioId: fixture.initialized.manifest.studioId, assetId: reference.id, shared: true });
    attachManagedAssets(fixture, { referenceAssetIds: [reference.id] });
    setStudioAssetShared(fixture.db, { studioId: fixture.initialized.manifest.studioId, assetId: reference.id, shared: false });
    let providerCalls = 0;
    const worker = new GenerationWorker({
      db: fixture.db,
      workerId: 'worker-unshared-reference-rejected',
      providerConfig: fixture.config,
      provider: fakeProvider(async () => { providerCalls += 1; return { bytes: png, mediaType: 'image/png' }; }, () => ({ kind: 'unknown_outcome', code: 'unexpected', message: 'unexpected' })),
      assetResolver: new StudioAssetResolver({ db: fixture.db, paths: fixture.initialized.paths }),
      assetPersister: { persistGeneratedImage: async () => { throw new Error('unshared managed assets must not persist'); } }
    });
    assert.deepEqual(await worker.processOnce(), { claimed: 1, succeeded: 0, retrying: 0, blocked: 1, unknown: 0, cancelled: 0 });
    assert.equal(providerCalls, 0);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.value.id)[0].error.code, 'managed_asset_resolution_failed');
  } finally {
    cleanup(fixture);
  }
});
