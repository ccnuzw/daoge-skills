const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { configureProvider } = require('./provider-test-helper');
const { requestJson, requestJsonAsWorkbench } = require('./local-studio-test-helper');
const { createProject, createRoundDraft, createTaskDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const { claimRunItems, createDryRunPreview, listGenerationRunItems, queueGenerationRun, transitionRunItem } = require('../../dist/vnext/runner/run-commands');
const { providerSnapshot } = require('../../dist/vnext/studio/provider-config');
const { StudioGeneratedAssetPersister } = require('../../dist/vnext/media/generated-assets');
const { reconcileExternalRunItem } = require('../../dist/vnext/runner/external-reconciliation');
const { parseCommand } = require('../../dist/vnext/cli/daoge');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-external-reconciliation-'));
}

function setupRun() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const { config, status } = configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'reconciliation-secret' });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const project = createProject(db, { studioId, name: '对账测试', idempotencyKey: 'external-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: '恢复任务', idempotencyKey: 'external-task' }).value;
  const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'external-round' }).value;
  const prepared = prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan: { operation: 'generate', itemCount: 1, prompt: 'safe fixture prompt' }, expectedVersion: round.version, idempotencyKey: 'external-prepare' }).value;
  const confirmed = confirmRoundPlan(db, { studioId, roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'external-confirm' }).value;
  const preview = createDryRunPreview(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, idempotencyKey: 'external-dry-run' }).value.preview;
  const run = queueGenerationRun(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, preflightId: preview.id, idempotencyKey: 'external-run' }).value;
  return { workspaceRoot, initialized, db, config, run, studioId };
}
async function setupApiRun() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const { config, status } = configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'api-reconciliation-secret' });
  let started;
  try {
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot, ssePollMs: 20 });
    const db = started.service.db;
    const studioId = initialized.manifest.studioId;
    const project = createProject(db, { studioId, name: 'API 对账测试', idempotencyKey: 'api-external-project' }).value;
    const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'API 恢复任务', idempotencyKey: 'api-external-task' }).value;
    const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'api-external-round' }).value;
    const prepared = prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan: { operation: 'generate', itemCount: 1, prompt: 'safe API fixture prompt' }, expectedVersion: round.version, idempotencyKey: 'api-external-prepare' }).value;
    const confirmed = confirmRoundPlan(db, { studioId, roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'api-external-confirm' }).value;
    const preview = createDryRunPreview(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, idempotencyKey: 'api-external-dry-run' }).value.preview;
    const run = queueGenerationRun(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, preflightId: preview.id, idempotencyKey: 'api-external-run' }).value;
    return { workspaceRoot, initialized, started, db, config, run, studioId };
  } catch (error) {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

function markUnknown(fixture, externalRequestId = 'provider-request-1') {
  const [item] = claimRunItems(fixture.db, { workerId: 'external-worker', limit: 1, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') });
  transitionRunItem(fixture.db, { itemId: item.id, leaseToken: item.leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:01.000Z') });
  transitionRunItem(fixture.db, { itemId: item.id, leaseToken: item.leaseToken, status: 'outcome_unknown', externalRequestId, error: { kind: 'unknown_outcome', code: 'fixture' }, now: new Date('2026-01-01T00:00:02.000Z') });
  return item.id;
}

function providerWith(reconcile) {
  let generateCalls = 0;
  let editCalls = 0;
  let reconcileCalls = 0;
  const provider = {
    id: 'openai-images',
    validateConfig: () => ({ valid: true, missing: [] }),
    capabilities: () => ({ textToImage: true, referenceEdit: true, maskEdit: true, cancellation: false, reconciliation: true, idempotency: false, acceptedReferenceMediaTypes: ['image/png'] }),
    generate: async () => { generateCalls += 1; throw new Error('generate must not be called'); },
    edit: async () => { editCalls += 1; throw new Error('edit must not be called'); },
    reconcile: async (externalRequestId, context) => {
      reconcileCalls += 1;
      return reconcile(externalRequestId, context);
    },
    classifyError: () => ({ kind: 'unknown_outcome', code: 'fixture', message: 'fixture' })
  };
  return { provider, calls: () => ({ generate: generateCalls, edit: editCalls, reconcile: reconcileCalls }) };
}

function options(fixture, itemId, provider, idempotencyKey, assetPersister) {
  return {
    db: fixture.db,
    studioId: fixture.studioId,
    runId: fixture.run.id,
    itemId,
    idempotencyKey,
    provider,
    providerConfig: fixture.config,
    assetPersister,
    now: () => new Date('2026-01-01T00:01:00.000Z')
  };
}

function cleanup(fixture) {
  closeStudioDatabase(fixture.db);
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}
async function cleanupApi(fixture) {
  await fixture.started.service.close();
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

test('explicit reconciliation calls only reconcile, persists a safe result, and completes idempotently', async () => {
  const fixture = setupRun();
  try {
    const itemId = markUnknown(fixture);
    const calls = providerWith(async () => ({
      bytes: png,
      mediaType: 'image/png',
      externalRequestId: 'provider-request-1',
      revisedPrompt: 'must-not-be-stored-prompt',
      safeMeta: {
        responseModel: 'fixture-model',
        requestPath: '/v1/images/generations',
        providerRequestId: 'provider-returned-other-id',
        prompt: 'must-not-be-stored-prompt',
        rawResponse: { secret: 'must-not-be-stored-response' }
      }
    }));
    const result = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-once', new StudioGeneratedAssetPersister({ db: fixture.db, paths: fixture.initialized.paths, studioId: fixture.studioId })));
    assert.deepEqual(result.status, 'succeeded');
    assert.equal(result.reason, null);
    assert.equal(calls.calls().reconcile, 1);
    assert.deepEqual(calls.calls(), { generate: 0, edit: 0, reconcile: 1 });
    const row = fixture.db.prepare('SELECT status, external_request_id, result_json FROM run_items WHERE id = ?').get(itemId);
    assert.equal(row.status, 'succeeded');
    assert.equal(row.external_request_id, 'provider-request-1');
    const storedResult = JSON.parse(row.result_json);
    assert.equal(storedResult.externalRequestId, 'provider-request-1');
    assert.equal(storedResult.assetId, result.assetId);
    assert.equal(Object.hasOwn(storedResult, 'revisedPrompt'), false);
    assert.equal(JSON.stringify(storedResult).includes('must-not-be-stored-prompt'), false);
    assert.equal(JSON.stringify(storedResult).includes('must-not-be-stored-response'), false);
    const asset = fixture.db.prepare('SELECT source_json FROM assets WHERE id = ?').get(result.assetId);
    assert.equal(JSON.parse(asset.source_json).externalRequestId, 'provider-request-1');
    assert.equal(asset.source_json.includes('must-not-be-stored-prompt'), false);
    assert.equal(asset.source_json.includes('must-not-be-stored-response'), false);
    const events = fixture.db.prepare('SELECT event_type, payload_json FROM events WHERE entity_id = ? ORDER BY id').all(itemId);
    assert.equal(events.some((event) => event.event_type === 'run_item.succeeded'), true);
    assert.equal(events.map((event) => event.payload_json).join('\n').includes('provider-request-1'), false);

    const replay = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-once', { persistGeneratedImage: async () => { throw new Error('idempotent replay must not persist'); } }));
    assert.deepEqual(replay, result);
    const secondKey = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-after-success', { persistGeneratedImage: async () => { throw new Error('successful item must not persist again'); } }));
    assert.deepEqual(secondKey, result);
    assert.deepEqual(calls.calls(), { generate: 0, edit: 0, reconcile: 1 });
  } finally {
    cleanup(fixture);
  }
});

test('rejects a persisted result that is not linked to the scoped run item', async () => {
  const fixture = setupRun();
  try {
    const itemId = markUnknown(fixture, 'provider-scope-result');
    const calls = providerWith(async () => ({ bytes: png, mediaType: 'image/png', externalRequestId: 'provider-scope-result' }));
    let persistCalls = 0;
    const result = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-foreign-result', {
      persistGeneratedImage: async () => {
        persistCalls += 1;
        return { assetId: 'foreign-asset', mediaType: 'image/png', byteSize: png.length, contentHash: 'a'.repeat(64) };
      }
    }));
    assert.deepEqual(result, { runId: fixture.run.id, itemId, status: 'outcome_unknown', reason: { kind: 'persistence', code: 'persisted_asset_scope_mismatch' } });
    assert.equal(persistCalls, 1);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.id)[0].status, 'outcome_unknown');
    assert.deepEqual(calls.calls(), { generate: 0, edit: 0, reconcile: 1 });
  } finally {
    cleanup(fixture);
  }
});

test('reconciliation settles a pausing run as paused without a terminal timestamp', async () => {
  const fixture = setupRun();
  try {
    const itemId = markUnknown(fixture, 'provider-pausing-result');
    fixture.db.prepare("UPDATE generation_runs SET status = 'pausing' WHERE id = ?").run(fixture.run.id);
    const calls = providerWith(async () => ({ bytes: png, mediaType: 'image/png', externalRequestId: 'provider-pausing-result' }));
    const result = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-pausing', new StudioGeneratedAssetPersister({ db: fixture.db, paths: fixture.initialized.paths, studioId: fixture.studioId })));
    assert.equal(result.status, 'succeeded');
    const run = fixture.db.prepare('SELECT status, completed_at FROM generation_runs WHERE id = ?').get(fixture.run.id);
    assert.equal(run.status, 'paused');
    assert.equal(run.completed_at, null);
  } finally {
    cleanup(fixture);
  }
});

test('null reconciliation result keeps outcome_unknown with a structured safe reason', async () => {
  const fixture = setupRun();
  try {
    const itemId = markUnknown(fixture, 'provider-pending-1');
    const calls = providerWith(async () => null);
    let persistCalls = 0;
    const result = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-pending', { persistGeneratedImage: async () => { persistCalls += 1; throw new Error('must not persist pending result'); } }));
    assert.deepEqual(result, { runId: fixture.run.id, itemId, status: 'outcome_unknown', reason: { kind: 'unknown_outcome', code: 'provider_result_pending' } });
    assert.equal(persistCalls, 0);
    assert.deepEqual(calls.calls(), { generate: 0, edit: 0, reconcile: 1 });
    const row = fixture.db.prepare('SELECT status, error_json FROM run_items WHERE id = ?').get(itemId);
    assert.equal(row.status, 'outcome_unknown');
    assert.deepEqual(JSON.parse(row.error_json), result.reason);
  } finally {
    cleanup(fixture);
  }
});

test('rejects a reconciled image whose returned external ID does not match the unknown item', async () => {
  const fixture = setupRun();
  try {
    const itemId = markUnknown(fixture, 'provider-request-match');
    const calls = providerWith(async () => ({ bytes: png, mediaType: 'image/png', externalRequestId: 'provider-request-other' }));
    let persistCalls = 0;
    const result = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-id-mismatch', { persistGeneratedImage: async () => { persistCalls += 1; throw new Error('mismatched result must not persist'); } }));
    assert.deepEqual(result.reason, { kind: 'invalid_response', code: 'provider_reconcile_result_invalid' });
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.id)[0].status, 'outcome_unknown');
    assert.equal(persistCalls, 0);
    assert.deepEqual(calls.calls(), { generate: 0, edit: 0, reconcile: 1 });
  } finally {
    cleanup(fixture);
  }
});

test('reconciliation fails closed for unsupported providers, stale snapshots, leases, missing IDs, and scopes', async () => {
  const cases = [
    {
      name: 'provider without reconcile',
      mutate: () => undefined,
      provider: () => {
        const instrumented = providerWith(async () => ({ bytes: png, mediaType: 'image/png' }));
        return { provider: { ...instrumented.provider, reconcile: undefined }, calls: instrumented.calls };
      },
      code: 'provider_reconciliation_unsupported'
    },
    {
      name: 'invalid provider configuration',
      mutate: () => undefined,
      provider: () => {
        const instrumented = providerWith(async () => ({ bytes: png, mediaType: 'image/png' }));
        return { provider: { ...instrumented.provider, validateConfig: () => ({ valid: false, missing: ['api_key'] }) }, calls: instrumented.calls };
      },
      code: 'provider_configuration_invalid'
    },
    {
      name: 'provider snapshot mismatch',
      mutate: (fixture) => fixture.db.prepare('UPDATE generation_runs SET provider_snapshot_json = ? WHERE id = ?').run(JSON.stringify({ ...providerSnapshot(fixture.config), model: 'different-model' }), fixture.run.id),
      provider: () => providerWith(async () => ({ bytes: png, mediaType: 'image/png' })),
      code: 'provider_snapshot_mismatch'
    },
    {
      name: 'active lease mismatch',
      mutate: (fixture, itemId) => fixture.db.prepare('UPDATE run_items SET lease_token = ? WHERE id = ?').run('unexpected-lease', itemId),
      provider: () => providerWith(async () => ({ bytes: png, mediaType: 'image/png' })),
      code: 'run_item_lease_mismatch'
    },
    {
      name: 'missing external request ID',
      mutate: (fixture, itemId) => fixture.db.prepare('UPDATE run_items SET external_request_id = NULL WHERE id = ?').run(itemId),
      provider: () => providerWith(async () => ({ bytes: png, mediaType: 'image/png' })),
      code: 'external_request_id_invalid_or_missing'
    }
  ];
  for (const entry of cases) {
    const fixture = setupRun();
    try {
      const itemId = markUnknown(fixture, entry.name === 'missing external request ID' ? 'unused-id' : 'provider-request-' + entry.name.replaceAll(' ', '-'));
      entry.mutate(fixture, itemId);
      const instrumented = entry.provider(fixture);
      const result = await reconcileExternalRunItem(options(fixture, itemId, instrumented.provider, 'external-reconcile-' + entry.name.replaceAll(' ', '-'), { persistGeneratedImage: async () => { throw new Error('must not persist rejected reconciliation'); } }));
      assert.equal(result.status, 'outcome_unknown', entry.name);
      assert.equal(result.reason.code, entry.code, entry.name);
      assert.equal(listGenerationRunItems(fixture.db, fixture.run.id)[0].status, 'outcome_unknown');
      assert.equal(JSON.stringify(result).includes(fixture.config.apiKey), false);
      assert.equal(JSON.stringify(result).includes(fixture.config.baseUrl), false);
      assert.deepEqual(instrumented.calls(), { generate: 0, edit: 0, reconcile: 0 });
    } finally {
      cleanup(fixture);
    }
  }

  const scoped = setupRun();
  try {
    const itemId = markUnknown(scoped, 'provider-scoped-id');
    const instrumented = providerWith(async () => ({ bytes: png, mediaType: 'image/png' }));
    const input = options(scoped, itemId, instrumented.provider, 'external-reconcile-wrong-run', { persistGeneratedImage: async () => { throw new Error('cross-scope must not persist'); } });
    input.runId = 'not-the-item-run';
    const result = await reconcileExternalRunItem(input);
    assert.equal(result.reason.code, 'run_item_scope_mismatch');
    assert.equal(instrumented.calls().reconcile, 0);
  } finally {
    cleanup(scoped);
  }
});

test('does not treat prototype property names as reconcilable states or media types', async () => {
  const stateFixture = setupRun();
  try {
    const itemId = markUnknown(stateFixture, 'provider-prototype-state');
    stateFixture.db.prepare("UPDATE generation_runs SET status = 'constructor' WHERE id = ?").run(stateFixture.run.id);
    const calls = providerWith(async () => ({ bytes: png, mediaType: 'image/png', externalRequestId: 'provider-prototype-state' }));
    const result = await reconcileExternalRunItem(options(stateFixture, itemId, calls.provider, 'external-reconcile-prototype-state', { persistGeneratedImage: async () => { throw new Error('invalid run state must not persist'); } }));
    assert.deepEqual(result.reason, { kind: 'invalid_state', code: 'generation_run_state_not_reconcilable' });
    assert.equal(calls.calls().reconcile, 0);
  } finally {
    cleanup(stateFixture);
  }

  const mediaFixture = setupRun();
  try {
    const itemId = markUnknown(mediaFixture, 'provider-prototype-media');
    const calls = providerWith(async () => ({ bytes: png, mediaType: 'constructor', externalRequestId: 'provider-prototype-media' }));
    let persistCalls = 0;
    const result = await reconcileExternalRunItem(options(mediaFixture, itemId, calls.provider, 'external-reconcile-prototype-media', { persistGeneratedImage: async () => { persistCalls += 1; throw new Error('prototype media type must not persist'); } }));
    assert.deepEqual(result.reason, { kind: 'invalid_response', code: 'provider_reconcile_result_invalid' });
    assert.equal(persistCalls, 0);
    assert.equal(calls.calls().reconcile, 1);
  } finally {
    cleanup(mediaFixture);
  }
});
test('does not delete an invalid Provider result path during cleanup', async () => {
  const fixture = setupRun();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-provider-reconcile-'));
  const foreignPath = path.join(directory, 'foreign.part');
  fs.writeFileSync(foreignPath, png);
  try {
    const itemId = markUnknown(fixture, 'provider-invalid-file-path');
    const calls = providerWith(async () => ({ filePath: foreignPath, byteSize: png.length, mediaType: 'image/png', externalRequestId: 'provider-invalid-file-path' }));
    const result = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-invalid-file-path', { persistGeneratedImage: async () => { throw new Error('invalid result must not persist'); } }));
    assert.deepEqual(result.reason, { kind: 'invalid_response', code: 'provider_reconcile_result_invalid' });
    assert.equal(fs.existsSync(foreignPath), true);
    assert.equal(fs.existsSync(directory), true);
    assert.equal(calls.calls().reconcile, 1);
  } finally {
    cleanup(fixture);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
test('returns a safe unknown result for malformed Provider configuration', async () => {
  const fixture = setupRun();
  try {
    const itemId = markUnknown(fixture, 'provider-malformed-config');
    const calls = providerWith(async () => ({ bytes: png, mediaType: 'image/png', externalRequestId: 'provider-malformed-config' }));
    const input = options(fixture, itemId, calls.provider, 'external-reconcile-malformed-config', { persistGeneratedImage: async () => { throw new Error('malformed config must not persist'); } });
    input.providerConfig = null;
    const result = await reconcileExternalRunItem(input);
    assert.deepEqual(result.reason, { kind: 'invalid_config', code: 'provider_configuration_invalid' });
    assert.equal(calls.calls().reconcile, 0);
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.id)[0].status, 'outcome_unknown');
  } finally {
    cleanup(fixture);
  }
});

test('reconcile and persistence failures retain unknown without leaking provider text', async () => {
  const fixture = setupRun();
  try {
    const itemId = markUnknown(fixture, 'provider-failure-id');
    const calls = providerWith(async () => { throw new Error('https://secret.example.test/v1 prompt=do-not-log api-key=never-log'); });
    const failed = await reconcileExternalRunItem(options(fixture, itemId, calls.provider, 'external-reconcile-failure', { persistGeneratedImage: async () => { throw new Error('disk failure with prompt=do-not-log'); } }));
    assert.deepEqual(failed.reason, { kind: 'unknown_outcome', code: 'provider_reconcile_failed' });
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.id)[0].status, 'outcome_unknown');
    const errorJson = fixture.db.prepare('SELECT error_json FROM run_items WHERE id = ?').get(itemId).error_json;
    const eventJson = fixture.db.prepare('SELECT payload_json FROM events WHERE entity_id = ? ORDER BY id').all(itemId).map((row) => row.payload_json).join('\n');
    for (const serialized of [JSON.stringify(failed), errorJson, eventJson]) {
      assert.equal(serialized.includes('secret.example.test'), false);
      assert.equal(serialized.includes('do-not-log'), false);
      assert.equal(serialized.includes('never-log'), false);
    }
    const persistenceProvider = providerWith(async () => ({ bytes: png, mediaType: 'image/png', safeMeta: { prompt: 'must-not-be-stored-prompt' } }));
    const persistenceFailure = await reconcileExternalRunItem(options(fixture, itemId, persistenceProvider.provider, 'external-reconcile-persistence-failure', { persistGeneratedImage: async () => { throw new Error('disk failure with prompt=do-not-log'); } }));
    assert.deepEqual(persistenceFailure.reason, { kind: 'persistence', code: 'local_persistence_failed' });
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.id)[0].status, 'outcome_unknown');
    assert.deepEqual(persistenceProvider.calls(), { generate: 0, edit: 0, reconcile: 1 });
    const persistenceError = fixture.db.prepare('SELECT error_json FROM run_items WHERE id = ?').get(itemId).error_json;
    assert.equal(persistenceError.includes('do-not-log'), false);
    assert.deepEqual(calls.calls(), { generate: 0, edit: 0, reconcile: 1 });
  } finally {
    cleanup(fixture);
  }
});
test('API exposes explicit Bearer-only reconciliation, reuses its idempotency key, and fails closed without config', async () => {
  const fixture = await setupApiRun();
  try {
    const itemId = markUnknown(fixture, 'api-provider-request');
    const pathname = '/api/runs/' + fixture.run.id + '/items/' + itemId + '/reconcile';
    fixture.db.prepare('UPDATE generation_runs SET provider_snapshot_json = ? WHERE id = ?').run(JSON.stringify({ ...providerSnapshot(fixture.config), model: 'different-model' }), fixture.run.id);
    const staleSnapshot = await requestJson(fixture.started, pathname, { method: 'POST', key: 'api-external-reconcile-stale-snapshot', body: {} });
    assert.equal(staleSnapshot.status, 200);
    assert.deepEqual(staleSnapshot.body.data, { runId: fixture.run.id, itemId, status: 'outcome_unknown', reason: { kind: 'invalid_config', code: 'provider_snapshot_mismatch' } });
    fixture.db.prepare('UPDATE generation_runs SET provider_snapshot_json = ? WHERE id = ?').run(JSON.stringify(providerSnapshot(fixture.config)), fixture.run.id);

    const unsupported = await requestJson(fixture.started, pathname, { method: 'POST', key: 'api-external-reconcile-once', body: {} });
    assert.equal(unsupported.status, 200);
    assert.deepEqual(unsupported.body.data, { runId: fixture.run.id, itemId, status: 'outcome_unknown', reason: { kind: 'unsupported', code: 'provider_reconciliation_unsupported' } });
    const replay = await requestJson(fixture.started, pathname, { method: 'POST', key: 'api-external-reconcile-once', body: {} });
    assert.deepEqual(replay.body, unsupported.body);
    const receipt = fixture.db.prepare('SELECT command_name FROM command_receipts WHERE studio_id = ? AND idempotency_key = ?').get(fixture.studioId, 'api-external-reconcile-once');
    assert.equal(receipt.command_name, 'runs.reconcile_external');

    fixture.started.service.providerDb.prepare('DELETE FROM provider_profiles WHERE id = ?').run(fixture.config.profileId);
    const missingConfig = await requestJson(fixture.started, pathname, { method: 'POST', key: 'api-external-reconcile-no-config', body: {} });
    assert.equal(missingConfig.status, 200);
    assert.deepEqual(missingConfig.body.data, { runId: fixture.run.id, itemId, status: 'outcome_unknown', reason: { kind: 'invalid_config', code: 'provider_configuration_invalid' } });
    assert.equal(listGenerationRunItems(fixture.db, fixture.run.id)[0].status, 'outcome_unknown');

    const workbench = await requestJsonAsWorkbench(fixture.started, pathname, { method: 'POST', key: 'api-external-reconcile-workbench', body: {} });
    assert.equal(workbench.status, 403);
    const responses = { staleSnapshot, unsupported, missingConfig, workbench };
    assert.equal(JSON.stringify(responses).includes(fixture.config.apiKey), false);
    assert.equal(JSON.stringify(responses).includes(fixture.config.baseUrl), false);
    assert.equal(JSON.stringify(responses).includes('api-provider-request'), false);
  } finally {
    await cleanupApi(fixture);
  }
});

test('CLI names external reconciliation as an explicit recovery and uses one idempotency channel', () => {
  const explicitKey = parseCommand(['reconcile-external', '--workspace', '/tmp/daoge-cli-reconcile', '--run', 'run-1', '--item', 'item-1', '--idempotency-key', 'reconcile-external-once']);
  assert.equal(explicitKey.request.method, 'POST');
  assert.equal(explicitKey.request.pathname, '/api/runs/run-1/items/item-1/reconcile');
  assert.deepEqual(explicitKey.request.body, {});
  assert.equal(explicitKey.request.idempotencyKey, 'reconcile-external-once');
  assert.equal(explicitKey.request.operationName, undefined);

  const operationName = parseCommand(['reconcile-external', '--workspace', '/tmp/daoge-cli-reconcile', '--run', 'run-1', '--item', 'item-1', '--operation-name', 'runs.reconcile_external:run-1:item-1']);
  assert.equal(operationName.request.idempotencyKey, undefined);
  assert.equal(operationName.request.operationName, 'runs.reconcile_external:run-1:item-1');
  assert.throws(() => parseCommand(['reconcile-external', '--workspace', '/tmp/daoge-cli-reconcile', '--run', 'run-1', '--item', 'item-1', '--idempotency-key', 'a', '--operation-name', 'b']), /不能同时使用/);
});
