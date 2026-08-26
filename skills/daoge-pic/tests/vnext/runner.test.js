const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { loadProviderConfig, providerStatus } = require('../../dist/vnext/studio/provider-config');
const { createProject, createTaskDraft, createRoundDraft, openOrAttachStudioSession, prepareRoundForConfirmation, confirmRoundPlan, InvalidCommandError } = require('../../dist/vnext/domain/studio-commands');
const { preflightGenerationPlan } = require('../../dist/vnext/runner/preflight');
const { createDryRunPreview, listDryRunPreviews, preflightRound, queueGenerationRun, retryGenerationRunItems, getGenerationRun, listGenerationRunItems, claimRunItems, transitionRunItem, markRunsResumePending, resolveUnknownRunItems, resumeGenerationRun, recoverExpiredLeases } = require('../../dist/vnext/runner/run-commands');

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
  const task = createTaskDraft(db, { projectId: project.value.id, name: '主视觉', idempotencyKey: 'task' });
  return { workspaceRoot, initialized, db, task };
}

function confirmedRound(fixture, plan, prefix = 'round') {
  const round = createRoundDraft(fixture.db, { taskId: fixture.task.value.id, purpose: 'exploration', idempotencyKey: prefix + '-draft' });
  const prepared = prepareRoundForConfirmation(fixture.db, { roundId: round.value.id, plan, expectedVersion: round.value.version, idempotencyKey: prefix + '-prepare' });
  return confirmRoundPlan(fixture.db, { roundId: round.value.id, expectedVersion: prepared.value.version, idempotencyKey: prefix + '-confirm' });
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


test('persists a no-call dry-run preview and rejects stale Provider snapshots before queueing', () => {
  const fixture = configuredStudio();
  try {
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 3, prompt: 'dry run evidence', output: { aspectRatio: '1:1' } });
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
    const dryRun = createDryRunPreview(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'dry-run-1' });
    assert.equal(dryRun.value.preflight.valid, true);
    assert.equal(dryRun.value.preview.itemCount, 3);
    assert.equal(listDryRunPreviews(fixture.db, confirmed.value.id).length, 1);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS total FROM generation_runs').get().total, 0);
    const changedConfig = { ...config, model: config.model + '-changed' };
    assert.throws(() => queueGenerationRun(fixture.db, { roundId: confirmed.value.id, providerConfig: changedConfig, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'stale-preview' }), InvalidCommandError);
    const queued = queueGenerationRun(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'fresh-preview' });
    assert.equal(queued.value.status, 'queued');
  } finally { cleanup(fixture.workspaceRoot); }
});

test('queues a confirmed plan with a safe provider snapshot and leases durable run items', () => {
  const fixture = configuredStudio();
  try {
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 2, prompt: 'minimal studio product shot', output: { aspectRatio: '1:1' } });
    const config = loadProviderConfig(fixture.initialized.paths);
    assert.ok(config);
    const status = providerStatus(fixture.initialized.paths);
    const preflight = preflightRound(fixture.db, { roundId: confirmed.value.id, providerStatus: status });
    assert.equal(preflight.valid, true);
    assert.throws(() => queueGenerationRun(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'queue-without-dry-run' }), InvalidCommandError);
    const dryRun = createDryRunPreview(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'queue-dry-run' });
    const queued = queueGenerationRun(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'run-queue' });
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
    assert.throws(() => resumeGenerationRun(fixture.db, { runId: queued.value.id, idempotencyKey: 'resume-with-unknown' }), InvalidCommandError);
    assert.throws(() => transitionRunItem(fixture.db, { itemId: claimed[0].id, leaseToken: '', status: 'pending', now: new Date('2026-01-01T00:00:00.000Z') }), /lease/);
    const resolved = resolveUnknownRunItems(fixture.db, { runId: queued.value.id, itemIds: [claimed[0].id], idempotencyKey: 'resolve-unknown' });
    assert.deepEqual(resolved.value.resolvedItemIds, [claimed[0].id]);
    assert.throws(() => resumeGenerationRun(fixture.db, { runId: queued.value.id, idempotencyKey: 'resume-without-session' }), InvalidCommandError);
    const session = openOrAttachStudioSession(fixture.db, { studioId: fixture.initialized.manifest.studioId, conversationId: 'runner-resume-confirmation' });
    assert.equal(resumeGenerationRun(fixture.db, { runId: queued.value.id, sessionId: session.id, idempotencyKey: 'resume-after-resolution' }).value.status, 'queued');
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
    const dryRun = createDryRunPreview(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'retry-dry-run' });
    const queued = queueGenerationRun(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'retry-queue' });
    fixture.db.prepare("UPDATE generation_runs SET status = 'failed' WHERE id = ?").run(queued.value.id);
    const items = listGenerationRunItems(fixture.db, queued.value.id);
    const originalRequestId = items[0].requestId;
    fixture.db.prepare("UPDATE run_items SET status = 'failed' WHERE id = ?").run(items[0].id);
    fixture.db.prepare("UPDATE run_items SET status = 'outcome_unknown' WHERE id = ?").run(items[1].id);
    const retried = retryGenerationRunItems(fixture.db, { runId: queued.value.id, itemIds: [items[0].id], idempotencyKey: 'retry-one' });
    assert.deepEqual(retried.value.retriedItemIds, [items[0].id]);
    assert.equal(getGenerationRun(fixture.db, queued.value.id).status, 'queued');
    assert.equal(listGenerationRunItems(fixture.db, queued.value.id)[0].status, 'pending');
    assert.notEqual(listGenerationRunItems(fixture.db, queued.value.id)[0].requestId, originalRequestId);
    assert.equal(listGenerationRunItems(fixture.db, queued.value.id)[1].status, 'outcome_unknown');
    assert.throws(() => retryGenerationRunItems(fixture.db, { runId: queued.value.id, itemIds: [items[1].id], idempotencyKey: 'retry-unknown' }), InvalidCommandError);
    resolveUnknownRunItems(fixture.db, { runId: queued.value.id, itemIds: [items[1].id], idempotencyKey: 'resolve-for-retry-guard' });
    assert.throws(() => retryGenerationRunItems(fixture.db, { runId: queued.value.id, itemIds: [items[1].id], idempotencyKey: 'retry-resolved-unknown' }), InvalidCommandError);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});

test('reclaims only expired leases and leaves active leases untouched', () => {
  const fixture = configuredStudio();
  try {
    const confirmed = confirmedRound(fixture, { operation: 'generate', itemCount: 1, prompt: 'soft daylight portrait' }, 'lease');
    const config = loadProviderConfig(fixture.initialized.paths);
    const status = providerStatus(fixture.initialized.paths);
    const dryRun = createDryRunPreview(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, idempotencyKey: 'lease-dry-run' });
    const queued = queueGenerationRun(fixture.db, { roundId: confirmed.value.id, providerConfig: config, providerStatus: status, preflightId: dryRun.value.preview.id, idempotencyKey: 'lease-run' });
    const claimed = claimRunItems(fixture.db, { workerId: 'worker-lease', limit: 1, leaseMs: 1000, now: new Date('2026-01-01T00:00:00.000Z') });
    assert.equal(recoverExpiredLeases(fixture.db, new Date('2026-01-01T00:00:00.500Z')), 0);
    assert.equal(recoverExpiredLeases(fixture.db, new Date('2026-01-01T00:00:02.000Z')), 1);
    assert.equal(listGenerationRunItems(fixture.db, queued.value.id)[0].status, 'pending');
    assert.equal(claimed.length, 1);
  } finally {
    closeStudioDatabase(fixture.db);
    cleanup(fixture.workspaceRoot);
  }
});
