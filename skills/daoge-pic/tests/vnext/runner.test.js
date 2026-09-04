const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { configureProvider } = require('./provider-test-helper');
const { createProject, createTaskDraft, createRoundDraft, openOrAttachStudioSession, updateStudioSessionContext, prepareRoundForConfirmation, confirmRoundPlan, InvalidCommandError } = require('../../dist/vnext/domain/studio-commands');
const { preflightGenerationPlan } = require('../../dist/vnext/runner/preflight');
const { createDryRunPreview, listDryRunPreviews, preflightRound, queueGenerationRun, retryGenerationRunItems, getGenerationRun, listGenerationRunItems, claimRunItems, transitionRunItem, markRunsResumePending, promoteDueRetryWaitItems, resolveUnknownRunItems, resumeGenerationRun, reconcileTerminalRuns, recoverExpiredLeases } = require('../../dist/vnext/runner/run-commands');




function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-runner-'));
}

function cleanup(workspaceRoot) {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

function configuredStudio() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const { config, status } = configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'provider-key-not-for-db' });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const project = createProject(db, { studioId: initialized.manifest.studioId, name: '运行引擎测试', idempotencyKey: 'project' });
  const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.value.id, name: '主视觉', idempotencyKey: 'task' });
  return { workspaceRoot, initialized, db, task, config, status };
}

function confirmedRound(fixture, plan, prefix = 'round') {
  const round = createRoundDraft(fixture.db, { studioId: fixture.initialized.manifest.studioId, taskId: fixture.task.value.id, purpose: 'exploration', idempotencyKey: prefix + '-draft' });
  const prepared = prepareRoundForConfirmation(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: round.value.id, plan, expectedVersion: round.value.version, idempotencyKey: prefix + '-prepare' });
  return confirmRoundPlan(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: round.value.id, expectedVersion: prepared.value.version, idempotencyKey: prefix + '-confirm' });
}

test('preflight rejects unconfigured providers and unsupported edit plans without external calls', () => {
  const plan = { operation: 'edit', itemCount: 2, prompt: 'change background', referenceAssetIds: [] };
  const unavailable = preflightGenerationPlan(plan, { providerId: null, configured: false, missing: ['api_key'], model: null, endpoint: null, capabilities: null });
  assert.equal(unavailable.valid, false);
  assert.deepEqual(unavailable.issues.map((issue) => issue.code), ['provider_not_ready', 'missing_reference']);
  const unsupported = preflightGenerationPlan(plan, { providerId: 'xai-grok-image', configured: true, missing: [], model: 'grok-imagine-image-quality', endpoint: 'https://api.x.ai', capabilities: { generate: true, edit: false, referenceImage: false, mask: false } });
  assert.equal(unsupported.valid, false);
  assert.deepEqual(unsupported.issues.map((issue) => issue.code), ['missing_reference', 'reference_edit_unsupported']);
});
test('preflight rejects malformed plan shapes without throwing or coercing operations', () => {
  const provider = { providerId: 'openai-images', configured: true, missing: [], model: 'gpt-image-2', endpoint: 'https://images.example.test', capabilities: { generate: true, edit: true, referenceImage: true, mask: true } };
  const invalidOperation = preflightGenerationPlan({ operation: 'unknown', itemCount: 1, prompt: 'safe' }, provider);
  assert.equal(invalidOperation.valid, false);
  assert.ok(invalidOperation.issues.some((issue) => issue.code === 'invalid_operation'));
  const invalidReferences = preflightGenerationPlan({ operation: 'generate', itemCount: 1, prompt: 'safe', referenceAssetIds: {} }, provider);
  assert.equal(invalidReferences.valid, false);
  assert.ok(invalidReferences.issues.some((issue) => issue.code === 'invalid_reference_assets'));
  const invalidMask = preflightGenerationPlan({ operation: 'generate', itemCount: 1, prompt: 'safe', maskAssetId: {} }, provider);
  assert.equal(invalidMask.valid, false);
  assert.ok(invalidMask.issues.some((issue) => issue.code === 'invalid_mask_asset_id'));
});


test('preflight rejects more than eight unique reference assets', () => {
  const result = preflightGenerationPlan({ operation: 'edit', itemCount: 1, prompt: 'edit', referenceAssetIds: Array.from({ length: 9 }, (_, index) => 'asset-' + index) }, { providerId: 'openai-images', configured: true, missing: [], model: 'gpt-image-2', endpoint: 'https://images.example.test', capabilities: { generate: true, edit: true, referenceImage: true, mask: true } });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'reference_asset_limit_exceeded'));
});

test('preflight rejects reference and mask metadata above the aggregate byte budget', () => {
  const fixture = configuredStudio();
  try {
    const timestamp = new Date().toISOString();
    const insert = fixture.db.prepare("INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, 'import', 'image/png', ?, ?, ?, '{}', ?, ?)");
    insert.run('large-reference-a', fixture.initialized.manifest.studioId, 'daoge-assets/imports/large-a.png', 'a'.repeat(64), 40 * 1024 * 1024, timestamp, timestamp);
    insert.run('large-reference-b', fixture.initialized.manifest.studioId, 'daoge-assets/imports/large-b.png', 'b'.repeat(64), 40 * 1024 * 1024, timestamp, timestamp);
    const projectId = fixture.task.value.projectId;
    const relation = fixture.db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, 'attached_to', 'project', ?, '{}', ?)");
    relation.run('large-reference-a-relation', 'large-reference-a', projectId, timestamp);
    relation.run('large-reference-b-relation', 'large-reference-b', projectId, timestamp);
    const confirmed = confirmedRound(fixture, { operation: 'edit', itemCount: 1, prompt: 'large reference budget', referenceAssetIds: ['large-reference-a', 'large-reference-b'] }, 'large-reference');
    const result = preflightRound(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerStatus: fixture.status });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((issue) => issue.code === 'reference_media_too_large'));
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});



test('preflight validates requested aspect ratios before a Provider call', () => {
  const compatible = { providerId: 'gemini-openai-compatible', configured: true, missing: [], model: 'fixture-model', endpoint: 'https://images.example.test', capabilities: { generate: true, edit: false, referenceImage: false, mask: false } };
  assert.equal(preflightGenerationPlan({ operation: 'generate', itemCount: 1, prompt: 'wide scene', output: { aspectRatio: '16:9' } }, compatible).valid, true);
  const malformed = preflightGenerationPlan({ operation: 'generate', itemCount: 1, prompt: 'bad format', output: { aspectRatio: 'wide' } }, compatible);
  assert.deepEqual(malformed.issues.map((issue) => issue.code), ['invalid_aspect_ratio']);
  const openAi = { ...compatible, providerId: 'openai-images' };
  const explicitSize = preflightGenerationPlan({ operation: 'generate', itemCount: 1, prompt: 'exact wide scene', output: { aspectRatio: '16:9', resolution: '1K' } }, openAi);
  assert.equal(explicitSize.valid, true);
  assert.equal(explicitSize.normalizedPlan.output.size, '1024x576');
  const missingSize = preflightGenerationPlan({ operation: 'generate', itemCount: 1, prompt: 'wide scene without dimensions', output: { aspectRatio: '16:9' } }, openAi);
  assert.deepEqual(missingSize.issues.map((issue) => issue.code), ['aspect_requires_explicit_size']);
});

test('persists a no-call dry-run preview and rejects stale Provider snapshots before queueing', () => {
  const fixture = configuredStudio();
  try {
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 3, prompt: 'dry run evidence', output: { aspectRatio: '1:1' } });
    const config = fixture.config;
    const status = fixture.status;
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'dry-run-1' });
    assert.equal(dryRun.value.preflight.valid, true);
    assert.equal(dryRun.value.preview.itemCount, 3);
    assert.equal(listDryRunPreviews(fixture.db, fixture.initialized.manifest.studioId, confirmed.value.id).length, 1);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS total FROM generation_runs').get().total, 0);
    const changedConfig = { ...config, model: config.model + '-changed' };
    assert.throws(() => queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: changedConfig, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'stale-preview' }), InvalidCommandError);
    fixture.db.prepare('UPDATE dry_run_previews SET plan_snapshot_json = ? WHERE id = ?').run(JSON.stringify({ output: { aspectRatio: '1:1' }, referenceAssetIds: [], prompt: 'dry run evidence', itemCount: 3, operation: 'generate' }), dryRun.value.preview.id);
    const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'fresh-preview' });
    assert.equal(queued.value.status, 'queued');
  } finally { cleanup(fixture.workspaceRoot); }
});

test('dry-run command rejects an unconfirmed round without durable evidence', () => {
  const fixture = configuredStudio();
  try {
    const round = createRoundDraft(fixture.db, { studioId: fixture.initialized.manifest.studioId, taskId: fixture.task.value.id, purpose: 'exploration', idempotencyKey: 'unconfirmed-draft' });
    const prepared = prepareRoundForConfirmation(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: round.value.id, plan: { operation: 'generate', itemCount: 1, prompt: 'must confirm first' }, expectedVersion: round.value.version, idempotencyKey: 'unconfirmed-prepare' });
    assert.equal(prepared.value.status, 'awaiting_confirmation');
    assert.throws(() => createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: round.value.id, providerConfig: fixture.config, providerStatus: fixture.status, idempotencyKey: 'unconfirmed-preflight' }), /confirmed creative round/);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS total FROM dry_run_previews').get().total, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS total FROM command_receipts WHERE idempotency_key = 'unconfirmed-preflight'").get().total, 0);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('freezes default and serial concurrency during preflight and shares global capacity fairly', () => {
  const fixture = configuredStudio();
  try {
    const first = confirmedRound(fixture, { operation: 'generate', itemCount: 5, prompt: 'default queue' }, 'first');
    const second = confirmedRound(fixture, { operation: 'generate', itemCount: 3, prompt: 'serial queue' }, 'second');
    const defaultPreview = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: fixture.config, providerStatus: fixture.status, idempotencyKey: 'default-dry-run' });
    const serialPreview = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: fixture.config, providerStatus: fixture.status, executionConcurrency: 1, concurrencySource: 'serial', idempotencyKey: 'serial-dry-run' });
    assert.equal(defaultPreview.value.preview.executionConcurrency, 4);
    assert.equal(defaultPreview.value.preview.concurrencySource, 'default');
    assert.equal(serialPreview.value.preview.executionConcurrency, 1);
    assert.equal(serialPreview.value.preview.concurrencySource, 'serial');
    const firstRun = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: fixture.config, providerStatus: fixture.status, preflightId: defaultPreview.value.preview.id, idempotencyKey: 'first-run' });
    const secondRun = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: fixture.config, providerStatus: fixture.status, preflightId: serialPreview.value.preview.id, idempotencyKey: 'second-run' });
    assert.equal(firstRun.value.executionConcurrency, 4);
    assert.equal(secondRun.value.executionConcurrency, 1);
    const claimed = claimRunItems(fixture.db, { workerId: 'fair-worker', limit: 5, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(claimed.filter((item) => item.runId === firstRun.value.id).length, 4);
    assert.equal(claimed.filter((item) => item.runId === secondRun.value.id).length, 1);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('fair candidate selection includes the eleventh 1000-item Run without idling global capacity', () => {
  const fixture = configuredStudio();
  try {
    const runs = [];
    for (let index = 0; index < 11; index += 1) {
      const prefix = 'candidate-window-' + index;
      const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 1000, prompt: 'large run ' + index }, prefix);
      const preview = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: fixture.config, providerStatus: fixture.status, executionConcurrency: 1000, idempotencyKey: prefix + '-preview' });
      const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: fixture.config, providerStatus: fixture.status, preflightId: preview.value.preview.id, idempotencyKey: prefix + '-run' });
      fixture.db.prepare('UPDATE generation_runs SET created_at = ? WHERE id = ?').run(new Date(Date.UTC(2026, 0, index + 1)).toISOString(), queued.value.id);
      runs.push(queued.value.id);
    }
    const eventCursor = fixture.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events').get().id;
    const claimed = claimRunItems(fixture.db, { workerId: 'wide-fair-worker', limit: 1000, leaseMs: 30000, now: new Date('2026-02-01T00:00:00.000Z') });
    assert.equal(claimed.length, 1000, 'all available global slots must be used');
    assert.deepEqual(new Set(claimed.map((item) => item.runId)), new Set(runs));
    assert.ok(claimed.some((item) => item.runId === runs[10]), 'the newest large Run must not be excluded by a global candidate window');
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS total FROM events WHERE id > ? AND entity_type = 'run_item'").get(eventCursor).total, 0, 'leasing must invalidate each Run instead of emitting one event per item');
    assert.ok(fixture.db.prepare('SELECT COUNT(*) AS total FROM events WHERE id > ?').get(eventCursor).total <= runs.length * 2, 'a 1000-item claim must emit O(runs) events');
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('leases explicit preflight concurrency values through the fixed 1000 global ceiling', () => {
  for (const [executionConcurrency, expectedClaims] of [[5, 5], [12, 12], [30, 30], [1000, 30]]) {
    const fixture = configuredStudio();
    try {
      const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 30, prompt: 'concurrency ' + executionConcurrency }, 'concurrency-' + executionConcurrency);
      const preview = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: fixture.config, providerStatus: fixture.status, executionConcurrency, idempotencyKey: 'concurrency-preview-' + executionConcurrency });
      const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: fixture.config, providerStatus: fixture.status, preflightId: preview.value.preview.id, idempotencyKey: 'concurrency-run-' + executionConcurrency });
      assert.equal(queued.value.executionConcurrency, executionConcurrency);
      assert.equal(claimRunItems(fixture.db, { workerId: 'concurrency-worker-' + executionConcurrency, limit: 1000, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') }).length, expectedClaims);
    } finally {
      closeStudioDatabase(fixture.db);
      cleanup(fixture.workspaceRoot);
    }
  }
});

test('rejects concurrency 1001 before creating preflight evidence', () => {
  const fixture = configuredStudio();
  try {
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 30, prompt: 'over global ceiling' }, 'over-ceiling');
    assert.throws(() => createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: fixture.config, providerStatus: fixture.status, executionConcurrency: 1001, idempotencyKey: 'over-ceiling-preview' }), /1 到 1000/);
    assert.equal(listDryRunPreviews(fixture.db, fixture.initialized.manifest.studioId, confirmed.value.id).length, 0);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('counts aggregate in-flight capacity across workers even when an earlier run has no pending items', () => {
  const fixture = configuredStudio();
  try {
    const config = fixture.config;
    const status = fixture.status;
    const first = confirmedRound(fixture, { operation: 'generate', itemCount: 2, prompt: 'first worker capacity' }, 'capacity-first');
    const firstDryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: config, providerStatus: status, executionConcurrency: 2, idempotencyKey: 'capacity-first-dry-run' });
    const firstRun = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: config, providerStatus: status, preflightId: firstDryRun.value.preview.id, idempotencyKey: 'capacity-first-run' });
    const firstClaims = claimRunItems(fixture.db, { workerId: 'capacity-worker-one', limit: 2, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(firstClaims.length, 2);
    assert.equal(listGenerationRunItems(fixture.db, firstRun.value.id).filter((item) => item.status === 'pending').length, 0);
    const second = confirmedRound(fixture, { operation: 'generate', itemCount: 2, prompt: 'second worker capacity' }, 'capacity-second');
    const secondDryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: config, providerStatus: status, executionConcurrency: 2, idempotencyKey: 'capacity-second-dry-run' });
    const secondRun = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: config, providerStatus: status, preflightId: secondDryRun.value.preview.id, idempotencyKey: 'capacity-second-run' });
    assert.equal(claimRunItems(fixture.db, { workerId: 'capacity-worker-two', limit: 2, leaseMs: 30000, now: new Date('2026-01-01T00:00:01.000Z') }).length, 0);
    transitionRunItem(fixture.db, { itemId: firstClaims[0].id, leaseToken: firstClaims[0].leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:01.000Z') });
    transitionRunItem(fixture.db, { itemId: firstClaims[0].id, leaseToken: firstClaims[0].leaseToken, status: 'receiving', now: new Date('2026-01-01T00:00:01.000Z') });
    transitionRunItem(fixture.db, { itemId: firstClaims[0].id, leaseToken: firstClaims[0].leaseToken, status: 'persisting', now: new Date('2026-01-01T00:00:01.000Z') });
    transitionRunItem(fixture.db, { itemId: firstClaims[0].id, leaseToken: firstClaims[0].leaseToken, status: 'succeeded', result: { assetId: 'capacity-finished' }, now: new Date('2026-01-01T00:00:01.000Z') });
    const oneAvailable = claimRunItems(fixture.db, { workerId: 'capacity-worker-two', limit: 2, leaseMs: 30000, now: new Date('2026-01-01T00:00:02.000Z') });
    assert.equal(oneAvailable.length, 1);
    assert.equal(oneAvailable[0].runId, secondRun.value.id);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS total FROM run_items WHERE status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested')").get().total, 2);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('separate worker claim batches share the configured global capacity', () => {
  const fixture = configuredStudio();
  try {
    const first = confirmedRound(fixture, { operation: 'generate', itemCount: 4, prompt: 'global batch one' }, 'global-one');
    const second = confirmedRound(fixture, { operation: 'generate', itemCount: 4, prompt: 'global batch two' }, 'global-two');
    const firstPreview = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: fixture.config, providerStatus: fixture.status, executionConcurrency: 4, idempotencyKey: 'global-one-preview' });
    const secondPreview = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: fixture.config, providerStatus: fixture.status, executionConcurrency: 4, idempotencyKey: 'global-two-preview' });
    queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: fixture.config, providerStatus: fixture.status, preflightId: firstPreview.value.preview.id, idempotencyKey: 'global-one-run' });
    queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: fixture.config, providerStatus: fixture.status, preflightId: secondPreview.value.preview.id, idempotencyKey: 'global-two-run' });
    const firstBatch = claimRunItems(fixture.db, { workerId: 'global-worker-one', limit: 2, globalLimit: 4, leaseMs: 30_000, now: new Date('2026-01-01T00:00:00.000Z') });
    const secondBatch = claimRunItems(fixture.db, { workerId: 'global-worker-two', limit: 2, globalLimit: 4, leaseMs: 30_000, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(firstBatch.length, 2);
    assert.equal(secondBatch.length, 2);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS total FROM run_items WHERE status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested')").get().total, 4);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('projects sanitized run item error codes without Provider messages', () => {
  const fixture = configuredStudio();
  try {
    const config = fixture.config;
    const status = fixture.status;
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 1, prompt: 'safe error projection' }, 'safe-error');
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'safe-error-dry-run' });
    const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'safe-error-run' });
    const [claimed] = claimRunItems(fixture.db, { workerId: 'safe-error-worker', limit: 1, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') });
    transitionRunItem(fixture.db, { itemId: claimed.id, leaseToken: claimed.leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:01.000Z') });
    transitionRunItem(fixture.db, { itemId: claimed.id, leaseToken: claimed.leaseToken, status: 'blocked', error: { kind: 'invalid_input', code: 'http_400', summary: 'Invalid size 1152x2048. Bearer sk_test_abcdefgh is rejected.' }, now: new Date('2026-01-01T00:00:02.000Z') });
    const [item] = listGenerationRunItems(fixture.db, queued.value.id);
    assert.deepEqual(item.error, { kind: 'invalid_input', code: 'http_400', summary: 'Invalid size 1152x2048. [redacted-secret] is rejected.' });
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('queues a confirmed plan with a safe provider snapshot and leases durable run items', () => {
  const fixture = configuredStudio();
  try {
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 2, prompt: 'minimal studio product shot', output: { aspectRatio: '1:1' } });
    const config = fixture.config;
    assert.ok(config);
    const status = fixture.status;
    const preflight = preflightRound(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerStatus: status });
    assert.equal(preflight.valid, true);
    assert.throws(() => queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'queue-without-dry-run' }), InvalidCommandError);
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'queue-dry-run' });
    const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'run-queue' });
    assert.equal(queued.value.status, 'queued');
    assert.equal(JSON.stringify(queued.value.providerSnapshot).includes('provider-key-not-for-db'), false);
    assert.equal(listGenerationRunItems(fixture.db, queued.value.id).length, 2);

    const claimed = claimRunItems(fixture.db, { workerId: 'worker-1', limit: 2, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(claimed.length, 2);
    assert.deepEqual(claimed.map((item) => item.status), ['leased', 'leased']);
    assert.equal(getGenerationRun(fixture.db, queued.value.id).status, 'running');
    assert.equal(claimed[0].promptPayload.prompt, 'minimal studio product shot');

    transitionRunItem(fixture.db, { itemId: claimed[0].id, leaseToken: claimed[0].leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(markRunsResumePending(fixture.db), 1);
    assert.equal(getGenerationRun(fixture.db, queued.value.id).status, 'resume_pending');
    assert.deepEqual(listGenerationRunItems(fixture.db, queued.value.id).map((item) => item.status), ['outcome_unknown', 'pending']);
    assert.throws(() => resumeGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, idempotencyKey: 'resume-with-unknown' }), InvalidCommandError);
    assert.throws(() => transitionRunItem(fixture.db, { itemId: claimed[0].id, leaseToken: '', status: 'pending', now: new Date('2026-01-01T00:00:00.000Z') }), /lease/);
    const resolved = resolveUnknownRunItems(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, itemIds: [claimed[0].id], idempotencyKey: 'resolve-unknown' });
    assert.deepEqual(resolved.value.resolvedItemIds, [claimed[0].id]);
    assert.throws(() => resumeGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, idempotencyKey: 'resume-without-session' }), InvalidCommandError);
    const session = openOrAttachStudioSession(fixture.db, { studioId: fixture.initialized.manifest.studioId, conversationId: 'runner-resume-confirmation' });
    updateStudioSessionContext(fixture.db, { studioId: fixture.initialized.manifest.studioId, sessionId: session.id, roundId: confirmed.value.id });
    assert.equal(resumeGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, sessionId: session.id, idempotencyKey: 'resume-after-resolution' }).value.status, 'queued');
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});


test('retries only explicit safe failed items and never requeues unknown outcomes', () => {
  const fixture = configuredStudio();
  try {
    const config = fixture.config;
    const status = fixture.status;
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 2, prompt: 'retry fixture' }, 'retry');
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'retry-dry-run' });
    const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'retry-queue' });
    fixture.db.prepare("UPDATE generation_runs SET status = 'failed' WHERE id = ?").run(queued.value.id);
    const items = listGenerationRunItems(fixture.db, queued.value.id);
    const originalRequestId = items[0].requestId;
    fixture.db.prepare("UPDATE run_items SET status = 'failed' WHERE id = ?").run(items[0].id);
    fixture.db.prepare("UPDATE run_items SET status = 'outcome_unknown' WHERE id = ?").run(items[1].id);
    const retried = retryGenerationRunItems(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, itemIds: [items[0].id], idempotencyKey: 'retry-one' });
    assert.deepEqual(retried.value.retriedItemIds, [items[0].id]);
    assert.equal(getGenerationRun(fixture.db, queued.value.id).status, 'queued');
    assert.equal(listGenerationRunItems(fixture.db, queued.value.id)[0].status, 'pending');
    assert.notEqual(listGenerationRunItems(fixture.db, queued.value.id)[0].requestId, originalRequestId);
    assert.equal(listGenerationRunItems(fixture.db, queued.value.id)[1].status, 'outcome_unknown');
    assert.throws(() => retryGenerationRunItems(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, itemIds: [items[1].id], idempotencyKey: 'retry-unknown' }), InvalidCommandError);
    resolveUnknownRunItems(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, itemIds: [items[1].id], idempotencyKey: 'resolve-for-retry-guard' });
    assert.throws(() => retryGenerationRunItems(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, itemIds: [items[1].id], idempotencyKey: 'retry-resolved-unknown' }), InvalidCommandError);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('promotes due automatic retries without changing their stable request identity', () => {
  const fixture = configuredStudio();
  try {
    const config = fixture.config;
    const status = fixture.status;
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 1, prompt: 'automatic retry identity' }, 'retry-due');
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'retry-due-dry-run' });
    const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'retry-due-run' });
    const [claimed] = claimRunItems(fixture.db, { workerId: 'retry-due-worker', limit: 1, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') });
    const requestId = claimed.requestId;
    transitionRunItem(fixture.db, { itemId: claimed.id, leaseToken: claimed.leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:01.000Z') });
    transitionRunItem(fixture.db, { itemId: claimed.id, leaseToken: claimed.leaseToken, status: 'retry_wait', retryAt: '2026-01-01T00:00:10.000Z', error: { kind: 'rate_limited', code: '429' }, now: new Date('2026-01-01T00:00:01.000Z') });
    assert.equal(promoteDueRetryWaitItems(fixture.db, new Date('2026-01-01T00:00:09.999Z')), 0);
    assert.equal(promoteDueRetryWaitItems(fixture.db, new Date('2026-01-01T00:00:10.000Z')), 1);
    const [ready] = listGenerationRunItems(fixture.db, queued.value.id);
    assert.equal(ready.status, 'pending');
    assert.equal(ready.retryAt, null);
    assert.equal(ready.requestId, requestId);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS total FROM events WHERE entity_id = ? AND event_type = 'run.retries_ready'").get(queued.value.id).total, 1);
    const [reclaimed] = claimRunItems(fixture.db, { workerId: 'retry-due-worker', limit: 1, leaseMs: 30000, now: new Date('2026-01-01T00:00:10.000Z') });
    assert.equal(reclaimed.requestId, requestId);
    assert.equal(reclaimed.attempts, 2);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('reconciles a historical running run when every item already reached a terminal state', () => {
  const fixture = configuredStudio();
  try {
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 1, prompt: 'terminal recovery' }, 'terminal-recovery');
    const config = fixture.config;
    const status = fixture.status;
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'terminal-recovery-dry-run' });
    const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'terminal-recovery-run' });
    const now = new Date('2026-01-01T00:00:00.000Z');
    const [item] = claimRunItems(fixture.db, { workerId: 'worker-terminal', limit: 1, leaseMs: 30000, now });
    transitionRunItem(fixture.db, { itemId: item.id, leaseToken: item.leaseToken, status: 'requesting', now });
    transitionRunItem(fixture.db, { itemId: item.id, leaseToken: item.leaseToken, status: 'receiving', now });
    transitionRunItem(fixture.db, { itemId: item.id, leaseToken: item.leaseToken, status: 'persisting', now });
    transitionRunItem(fixture.db, { itemId: item.id, leaseToken: item.leaseToken, status: 'succeeded', result: { assetId: 'asset-terminal' }, now });
    assert.equal(getGenerationRun(fixture.db, queued.value.id).status, 'running');
    assert.equal(reconcileTerminalRuns(fixture.db, now), 1);
    assert.equal(getGenerationRun(fixture.db, queued.value.id).status, 'completed');
    assert.equal(reconcileTerminalRuns(fixture.db, now), 0);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('recovers expired leased work as pending and every post-request phase as an unknown outcome', () => {
  const fixture = configuredStudio();
  try {
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 5, prompt: 'soft daylight portrait' }, 'lease');
    const config = fixture.config;
    const status = fixture.status;
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, executionConcurrency: 5, idempotencyKey: 'lease-dry-run' });
    const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'lease-run' });
    const claimed = claimRunItems(fixture.db, { workerId: 'worker-lease', limit: 5, leaseMs: 1000, now: new Date('2026-01-01T00:00:00.000Z') });
    const originalRequestIds = claimed.map((item) => item.requestId);
    transitionRunItem(fixture.db, { itemId: claimed[1].id, leaseToken: claimed[1].leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:00.500Z') });
    transitionRunItem(fixture.db, { itemId: claimed[2].id, leaseToken: claimed[2].leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:00.500Z') });
    transitionRunItem(fixture.db, { itemId: claimed[2].id, leaseToken: claimed[2].leaseToken, status: 'receiving', now: new Date('2026-01-01T00:00:00.500Z') });
    transitionRunItem(fixture.db, { itemId: claimed[3].id, leaseToken: claimed[3].leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:00.500Z') });
    transitionRunItem(fixture.db, { itemId: claimed[3].id, leaseToken: claimed[3].leaseToken, status: 'receiving', now: new Date('2026-01-01T00:00:00.500Z') });
    transitionRunItem(fixture.db, { itemId: claimed[3].id, leaseToken: claimed[3].leaseToken, status: 'persisting', now: new Date('2026-01-01T00:00:00.500Z') });
    transitionRunItem(fixture.db, { itemId: claimed[4].id, leaseToken: claimed[4].leaseToken, status: 'requesting', now: new Date('2026-01-01T00:00:00.500Z') });
    transitionRunItem(fixture.db, { itemId: claimed[4].id, leaseToken: claimed[4].leaseToken, status: 'cancel_requested', now: new Date('2026-01-01T00:00:00.500Z') });
    assert.equal(recoverExpiredLeases(fixture.db, new Date('2026-01-01T00:00:00.999Z')), 0);
    assert.equal(recoverExpiredLeases(fixture.db, new Date('2026-01-01T00:00:01.000Z')), 5);
    const recovered = listGenerationRunItems(fixture.db, queued.value.id);
    assert.deepEqual(recovered.map((item) => item.status), ['pending', 'outcome_unknown', 'outcome_unknown', 'outcome_unknown', 'outcome_unknown']);
    assert.deepEqual(recovered.map((item) => item.requestId), originalRequestIds);
    assert.deepEqual(recovered.slice(1).map((item) => item.error.code), ['lease_expired', 'lease_expired', 'lease_expired', 'lease_expired']);
    assert.equal(recoverExpiredLeases(fixture.db, new Date('2026-01-01T00:00:02.000Z')), 0);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});
