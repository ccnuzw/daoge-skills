const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { loadProviderConfig, providerStatus } = require('../../dist/vnext/studio/provider-config');
const { getStudioRuntimeSettings } = require('../../dist/vnext/studio/runtime-settings');
const { createProject, createTaskDraft, createRoundDraft, openOrAttachStudioSession, prepareRoundForConfirmation, confirmRoundPlan, InvalidCommandError } = require('../../dist/vnext/domain/studio-commands');
const { preflightGenerationPlan } = require('../../dist/vnext/runner/preflight');
const { createDryRunPreview, listDryRunPreviews, preflightRound, queueGenerationRun, retryGenerationRunItems, getGenerationRun, listGenerationRunItems, claimRunItems, transitionRunItem, markRunsResumePending, promoteDueRetryWaitItems, resolveUnknownRunItems, resumeGenerationRun, reconcileTerminalRuns, recoverExpiredLeases } = require('../../dist/vnext/runner/run-commands');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-runner-'));
}

function cleanup(workspaceRoot) {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

function configuredStudio() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  fs.writeFileSync(initialized.paths.providerEnvPath, [
    'IMAGE_PROVIDER=openai-images',
    'OPENAI_BASE_URL=https://images.example.test/v1',
    'OPENAI_API_KEY=provider-key-not-for-db',
    'OPENAI_MODEL=gpt-image-2'
  ].join('\n') + '\n');
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const project = createProject(db, { studioId: initialized.manifest.studioId, name: '运行引擎测试', idempotencyKey: 'project' });
  const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.value.id, name: '主视觉', idempotencyKey: 'task' });
  return { workspaceRoot, initialized, db, task, runtimeSettings: getStudioRuntimeSettings(db, initialized.manifest.studioId) };
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
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
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

test('freezes bounded per-run concurrency and shares worker capacity fairly', () => {
  const fixture = configuredStudio();
  try {
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
    const first = confirmedRound(fixture, { operation: 'generate', itemCount: 3, prompt: 'first queue' }, 'first');
    const second = confirmedRound(fixture, { operation: 'generate', itemCount: 3, prompt: 'second queue' }, 'second');
    const firstDryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'first-dry-run' });
    const secondDryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'second-dry-run' });
    assert.throws(() => queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: config, providerStatus: status, runtimeSettings: fixture.runtimeSettings, requestedConcurrency: 31, preflightId: firstDryRun.value.preview.id, idempotencyKey: 'over-ceiling' }), InvalidCommandError);
    const firstRun = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: config, providerStatus: status, runtimeSettings: fixture.runtimeSettings, requestedConcurrency: 1, preflightId: firstDryRun.value.preview.id, idempotencyKey: 'first-run' });
    const secondRun = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: config, providerStatus: status, runtimeSettings: fixture.runtimeSettings, requestedConcurrency: 1, preflightId: secondDryRun.value.preview.id, idempotencyKey: 'second-run' });
    assert.equal(firstRun.value.requestedConcurrency, 1);
    assert.equal(secondRun.value.requestedConcurrency, 1);
    const claimed = claimRunItems(fixture.db, { workerId: 'fair-worker', limit: 2, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(claimed.length, 2);
    assert.deepEqual(new Set(claimed.map((item) => item.runId)), new Set([firstRun.value.id, secondRun.value.id]));
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('leases requested concurrency values 5, 12, and 30 subject to the global worker limit', () => {
  for (const [requestedConcurrency, globalLimit, expectedClaims] of [[5, 30, 5], [12, 30, 12], [30, 30, 30]]) {
    const fixture = configuredStudio();
    try {
      const config = loadProviderConfig(fixture.initialized.paths);
      const status = providerStatus(fixture.initialized.paths);
      const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 30, prompt: 'concurrency ' + requestedConcurrency }, 'concurrency-' + requestedConcurrency + '-' + globalLimit);
      const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'concurrency-dry-run-' + requestedConcurrency + '-' + globalLimit });
      const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, runtimeSettings: fixture.runtimeSettings, requestedConcurrency, preflightId: dryRun.value.preview.id, idempotencyKey: 'concurrency-run-' + requestedConcurrency + '-' + globalLimit });
      assert.equal(queued.value.requestedConcurrency, requestedConcurrency);
      assert.equal(claimRunItems(fixture.db, { workerId: 'concurrency-worker-' + requestedConcurrency, limit: globalLimit, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') }).length, expectedClaims);
    } finally {
      closeStudioDatabase(fixture.db);
      cleanup(fixture.workspaceRoot);
    }
  }
});

test('rejects requested concurrency above the current workspace limit', () => {
  const fixture = configuredStudio();
  try {
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 30, prompt: 'workspace concurrency refusal' }, 'workspace-concurrency-refusal');
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'workspace-concurrency-refusal-dry-run' });
    assert.throws(() => queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, runtimeSettings: { ...fixture.runtimeSettings, maxWorkerConcurrency: 12 }, requestedConcurrency: 30, preflightId: dryRun.value.preview.id, idempotencyKey: 'workspace-concurrency-refusal-run' }), /exceeds the current workspace limit of 12/);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('counts aggregate in-flight capacity across workers even when an earlier run has no pending items', () => {
  const fixture = configuredStudio();
  try {
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
    const first = confirmedRound(fixture, { operation: 'generate', itemCount: 2, prompt: 'first worker capacity' }, 'capacity-first');
    const firstDryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'capacity-first-dry-run' });
    const firstRun = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: first.value.id, providerConfig: config, providerStatus: status, runtimeSettings: fixture.runtimeSettings, requestedConcurrency: 2, preflightId: firstDryRun.value.preview.id, idempotencyKey: 'capacity-first-run' });
    const firstClaims = claimRunItems(fixture.db, { workerId: 'capacity-worker-one', limit: 2, leaseMs: 30000, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(firstClaims.length, 2);
    assert.equal(listGenerationRunItems(fixture.db, firstRun.value.id).filter((item) => item.status === 'pending').length, 0);
    const second = confirmedRound(fixture, { operation: 'generate', itemCount: 2, prompt: 'second worker capacity' }, 'capacity-second');
    const secondDryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'capacity-second-dry-run' });
    const secondRun = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: second.value.id, providerConfig: config, providerStatus: status, runtimeSettings: fixture.runtimeSettings, requestedConcurrency: 2, preflightId: secondDryRun.value.preview.id, idempotencyKey: 'capacity-second-run' });
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

test('projects sanitized run item error codes without Provider messages', () => {
  const fixture = configuredStudio();
  try {
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 1, prompt: 'safe error projection' }, 'safe-error');
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'safe-error-dry-run' });
    const queued = queueGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, runtimeSettings: fixture.runtimeSettings, preflightId: dryRun.value.preview.id, idempotencyKey: 'safe-error-run' });
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
    const config = loadProviderConfig(fixture.initialized.paths);
    assert.ok(config);
    const status = providerStatus(fixture.initialized.paths);
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
    assert.equal(resumeGenerationRun(fixture.db, { studioId: fixture.initialized.manifest.studioId, runId: queued.value.id, sessionId: session.id, idempotencyKey: 'resume-after-resolution' }).value.status, 'queued');
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});


test('retries only explicit safe failed items and never requeues unknown outcomes', () => {
  const fixture = configuredStudio();
  try {
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
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
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
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
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS total FROM events WHERE entity_id = ? AND event_type = 'run_item.retry_ready'").get(claimed.id).total, 1);
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
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
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
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
    const dryRun = createDryRunPreview(fixture.db, { studioId: fixture.initialized.manifest.studioId, roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'lease-dry-run' });
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
