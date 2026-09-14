const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { recordUsageEvent, listUsageLedger, summarizeUsage } = require('../../dist/vnext/usage/ledger');
const { configureBudget, evaluateBudgetGate } = require('../../dist/vnext/usage/budget');
const { configureProvider } = require('./provider-test-helper');
const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const { preflightRound, createDryRunPreview, queueGenerationRun, recordRunItemUsage, listGenerationRunItems, retryGenerationRunItems } = require('../../dist/vnext/runner/run-commands');

function fixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-usage-'));
  const initialized = initializeStudio({ workspaceRoot });
  return { workspaceRoot, initialized, db: openStudioDatabase(initialized.paths, initialized.manifest) };
}

test('usage ledger is scoped, idempotent, and preserves unknown billing', () => {
  const one = fixture();
  const two = fixture();
  try {
    const unknown = { unit: 'image', quantity: 1, estimatedCostMinor: null, costUnit: null, source: 'unknown' };
    const first = recordUsageEvent(one.db, { studioId: one.initialized.manifest.studioId, estimate: unknown, idempotencyKey: 'same-event', billingState: 'possibly_billed' });
    const replay = recordUsageEvent(one.db, { studioId: one.initialized.manifest.studioId, estimate: unknown, idempotencyKey: 'same-event', billingState: 'possibly_billed' });
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(listUsageLedger(one.db, { studioId: one.initialized.manifest.studioId }).length, 1);
    assert.equal(listUsageLedger(one.db, { studioId: one.initialized.manifest.studioId })[0].billingState, 'possibly_billed');
    assert.throws(() => recordUsageEvent(one.db, { studioId: two.initialized.manifest.studioId, projectId: 'foreign-project', estimate: unknown, idempotencyKey: 'foreign' }), /outside the Studio|not found/);
    assert.throws(() => recordUsageEvent(one.db, { studioId: one.initialized.manifest.studioId, estimate: { ...unknown, quantity: 2 }, idempotencyKey: 'same-event', billingState: 'possibly_billed' }), /different usage identity/);
  } finally {
    closeStudioDatabase(one.db); closeStudioDatabase(two.db);
    fs.rmSync(one.workspaceRoot, { recursive: true, force: true }); fs.rmSync(two.workspaceRoot, { recursive: true, force: true });
  }
});

test('budget gate rejects known overage and allows explicit unknown without inventing price', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    configureBudget(fixtureValue.db, { studioId, profileId: null, limitCostMinor: 100, costUnit: 'USD_minor' });
    const over = evaluateBudgetGate(fixtureValue.db, { studioId, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 101, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(over.allowed, false);
    assert.equal(over.code, 'budget_exceeded');
    const unknown = evaluateBudgetGate(fixtureValue.db, { studioId, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: null, costUnit: null, source: 'unknown' } });
    assert.equal(unknown.allowed, true);
    assert.equal(unknown.code, 'budget_unknown_estimate');
    assert.equal(unknown.estimatedCostMinor, null);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('preflight and queue reject projected known budget overage before a run is created', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const configured = configureProvider(fixtureValue.initialized, { model: 'gpt-image-2', apiKey: 'provider-key-not-for-db' });
    const project = createProject(fixtureValue.db, { studioId, name: 'Usage budget project', idempotencyKey: 'usage-project' });
    const task = createTaskDraft(fixtureValue.db, { studioId, projectId: project.value.id, name: 'Usage budget task', idempotencyKey: 'usage-task' });
    const makeRound = (prefix) => {
      const draft = createRoundDraft(fixtureValue.db, { studioId, taskId: task.value.id, purpose: 'exploration', idempotencyKey: prefix + '-draft' });
      const prepared = prepareRoundForConfirmation(fixtureValue.db, { studioId, roundId: draft.value.id, plan: { operation: 'generate', itemCount: 1, prompt: prefix }, expectedVersion: draft.value.version, idempotencyKey: prefix + '-prepare' });
      return confirmRoundPlan(fixtureValue.db, { studioId, roundId: draft.value.id, expectedVersion: prepared.value.version, idempotencyKey: prefix + '-confirm' }).value;
    };
    configureBudget(fixtureValue.db, { studioId, limitCostMinor: 100, costUnit: 'USD_minor' });
    const preflightRoundValue = makeRound('preflight-budget');
    const rejected = preflightRound(fixtureValue.db, { studioId, roundId: preflightRoundValue.id, providerStatus: configured.status, usageEstimate: { unit: 'image', quantity: 1, estimatedCostMinor: 101, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(rejected.valid, false);
    assert.ok(rejected.issues.some((issue) => issue.code === 'budget_exceeded'));
    const queuedRound = makeRound('queue-budget');
    const preview = createDryRunPreview(fixtureValue.db, { studioId, roundId: queuedRound.id, providerConfig: configured.config, providerStatus: configured.status, usageEstimate: { unit: 'image', quantity: 1, estimatedCostMinor: 60, costUnit: 'USD_minor', source: 'caller' }, idempotencyKey: 'queue-budget-preview' });
    assert.ok(preview.value.preview);
    recordUsageEvent(fixtureValue.db, { studioId, projectId: project.value.id, roundId: queuedRound.id, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 50, costUnit: 'USD_minor', source: 'caller' }, idempotencyKey: 'queue-budget-existing' });
    assert.throws(() => queueGenerationRun(fixtureValue.db, { studioId, roundId: queuedRound.id, providerConfig: configured.config, providerStatus: configured.status, preflightId: preview.value.preview.id, idempotencyKey: 'queue-budget-run' }), /budget_exceeded/);
    assert.equal(fixtureValue.db.prepare('SELECT COUNT(*) AS total FROM generation_runs').get().total, 0);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('budget gate accumulates known usage across project scopes', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const firstProject = createProject(fixtureValue.db, { studioId, name: '预算项目一', idempotencyKey: 'budget-scope-project-one' }).value;
    const secondProject = createProject(fixtureValue.db, { studioId, name: '预算项目二', idempotencyKey: 'budget-scope-project-two' }).value;
    configureBudget(fixtureValue.db, { studioId, limitCostMinor: 100, costUnit: 'USD_minor' });
    recordUsageEvent(fixtureValue.db, { studioId, projectId: firstProject.id, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 60, costUnit: 'USD_minor', source: 'caller' }, idempotencyKey: 'budget-scope-usage' });
    const gate = evaluateBudgetGate(fixtureValue.db, { studioId, projectId: secondProject.id, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 50, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, 'budget_exceeded');
    assert.equal(gate.committedCostMinor, 60);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('global Studio budget counts known usage attributed to any Provider profile', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const project = createProject(fixtureValue.db, { studioId, name: '全局预算 Provider 项目', idempotencyKey: 'global-budget-provider-project' }).value;
    const task = createTaskDraft(fixtureValue.db, { studioId, projectId: project.id, name: '全局预算 Provider 任务', idempotencyKey: 'global-budget-provider-task' }).value;
    const round = createRoundDraft(fixtureValue.db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'global-budget-provider-round' }).value;
    const timestamp = new Date().toISOString();
    fixtureValue.db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, provider_profile_id, provider_config_version, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)').run('global-budget-provider-run', round.id, 'completed', JSON.stringify({ profileId: 'provider-profile-a', configVersion: 1 }), '{}', 'provider-profile-a', 1, 1, 'default', timestamp, timestamp);
    fixtureValue.db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('global-budget-provider-item', 'global-budget-provider-run', 1, 'succeeded', '{}', 'global-budget-provider-request', timestamp, timestamp);
    recordUsageEvent(fixtureValue.db, { studioId, runItemId: 'global-budget-provider-item', estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 80, costUnit: 'USD_minor', source: 'provider' }, billingState: 'billed', idempotencyKey: 'global-budget-provider-usage' });
    configureBudget(fixtureValue.db, { studioId, profileId: null, limitCostMinor: 100, costUnit: 'USD_minor' });
    const gate = evaluateBudgetGate(fixtureValue.db, { studioId, profileId: 'provider-profile-a', projectId: project.id, roundId: round.id, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 30, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, 'budget_exceeded');
    assert.equal(gate.committedCostMinor, 80);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('run item usage attribution derives and validates its complete Studio hierarchy', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const project = createProject(fixtureValue.db, { studioId, name: '运行项归因项目', idempotencyKey: 'usage-run-item-project' }).value;
    const task = createTaskDraft(fixtureValue.db, { studioId, projectId: project.id, name: '运行项归因任务', idempotencyKey: 'usage-run-item-task' }).value;
    const round = createRoundDraft(fixtureValue.db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'usage-run-item-round' }).value;
    const timestamp = new Date().toISOString();
    fixtureValue.db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, provider_profile_id, provider_config_version, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)').run('run-usage-item', round.id, 'running', '{}', '{}', null, null, 1, 'default', timestamp, timestamp);
    fixtureValue.db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('item-usage-item', 'run-usage-item', 1, 'outcome_unknown', '{}', 'request-usage-item', timestamp, timestamp);
    const event = recordUsageEvent(fixtureValue.db, { studioId, runItemId: 'item-usage-item', estimate: { unit: 'image', quantity: 1, estimatedCostMinor: null, costUnit: null, source: 'unknown' }, billingState: 'possibly_billed', idempotencyKey: 'usage-run-item-event' });
    assert.equal(event.value.projectId, project.id);
    assert.equal(event.value.taskId, task.id);
    assert.equal(event.value.roundId, round.id);
    assert.equal(event.value.runId, 'run-usage-item');
    assert.equal(event.value.runItemId, 'item-usage-item');
    assert.equal(event.value.billingState, 'possibly_billed');
    assert.throws(() => recordUsageEvent(fixtureValue.db, { studioId, projectId: 'foreign-project', runItemId: 'item-usage-item', estimate: { unit: 'image', quantity: 1, estimatedCostMinor: null, costUnit: null, source: 'unknown' }, billingState: 'possibly_billed', idempotencyKey: 'usage-run-item-foreign' }), /does not belong/);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('a declared plan estimate reaches the ledger so the budget gate accumulates real spend', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const configured = configureProvider(fixtureValue.initialized, { model: 'gpt-image-2', apiKey: 'provider-key-not-for-db' });
    const project = createProject(fixtureValue.db, { studioId, name: '接线预算项目', idempotencyKey: 'wiring-budget-project' });
    const task = createTaskDraft(fixtureValue.db, { studioId, projectId: project.value.id, name: '接线预算任务', idempotencyKey: 'wiring-budget-task' });
    const draft = createRoundDraft(fixtureValue.db, { studioId, taskId: task.value.id, purpose: 'exploration', idempotencyKey: 'wiring-budget-round' });
    const prepared = prepareRoundForConfirmation(fixtureValue.db, { studioId, roundId: draft.value.id, plan: { operation: 'generate', itemCount: 3, prompt: 'wiring budget' }, expectedVersion: draft.value.version, idempotencyKey: 'wiring-budget-prepare' });
    const round = confirmRoundPlan(fixtureValue.db, { studioId, roundId: draft.value.id, expectedVersion: prepared.value.version, idempotencyKey: 'wiring-budget-confirm' }).value;
    const preview = createDryRunPreview(fixtureValue.db, { studioId, roundId: round.id, providerConfig: configured.config, providerStatus: configured.status, usageEstimate: { unit: 'image', quantity: 3, estimatedCostMinor: 100, costUnit: 'USD_minor', source: 'caller' }, idempotencyKey: 'wiring-budget-preview' });
    const run = queueGenerationRun(fixtureValue.db, { studioId, roundId: round.id, providerConfig: configured.config, providerStatus: configured.status, preflightId: preview.value.preview.id, idempotencyKey: 'wiring-budget-run' }).value;
    const items = listGenerationRunItems(fixtureValue.db, run.id);
    assert.equal(items.length, 3);
    for (const item of items) recordRunItemUsage(fixtureValue.db, { studioId, runItemId: item.id, requestId: 'wiring-budget-request-' + item.sequence, billingState: 'billed' });
    const known = listUsageLedger(fixtureValue.db, { studioId }).filter((row) => row.estimatedCostMinor !== null);
    assert.equal(known.length, 3);
    assert.equal(known.reduce((total, row) => total + row.estimatedCostMinor, 0), 100);
    assert.ok(known.every((row) => row.costUnit === 'USD_minor'));
    configureBudget(fixtureValue.db, { studioId, limitCostMinor: 100, costUnit: 'USD_minor' });
    const gate = evaluateBudgetGate(fixtureValue.db, { studioId, projectId: project.value.id, roundId: round.id, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 1, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, 'budget_exceeded');
    assert.equal(gate.committedCostMinor, 100);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('an undeclared plan estimate stays explicitly unknown in the ledger', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const configured = configureProvider(fixtureValue.initialized, { model: 'gpt-image-2', apiKey: 'provider-key-not-for-db' });
    const project = createProject(fixtureValue.db, { studioId, name: '未知成本项目', idempotencyKey: 'unknown-budget-project' });
    const task = createTaskDraft(fixtureValue.db, { studioId, projectId: project.value.id, name: '未知成本任务', idempotencyKey: 'unknown-budget-task' });
    const draft = createRoundDraft(fixtureValue.db, { studioId, taskId: task.value.id, purpose: 'exploration', idempotencyKey: 'unknown-budget-round' });
    const prepared = prepareRoundForConfirmation(fixtureValue.db, { studioId, roundId: draft.value.id, plan: { operation: 'generate', itemCount: 1, prompt: 'unknown budget' }, expectedVersion: draft.value.version, idempotencyKey: 'unknown-budget-prepare' });
    const round = confirmRoundPlan(fixtureValue.db, { studioId, roundId: draft.value.id, expectedVersion: prepared.value.version, idempotencyKey: 'unknown-budget-confirm' }).value;
    const preview = createDryRunPreview(fixtureValue.db, { studioId, roundId: round.id, providerConfig: configured.config, providerStatus: configured.status, idempotencyKey: 'unknown-budget-preview' });
    const run = queueGenerationRun(fixtureValue.db, { studioId, roundId: round.id, providerConfig: configured.config, providerStatus: configured.status, preflightId: preview.value.preview.id, idempotencyKey: 'unknown-budget-run' }).value;
    const items = listGenerationRunItems(fixtureValue.db, run.id);
    recordRunItemUsage(fixtureValue.db, { studioId, runItemId: items[0].id, requestId: 'unknown-budget-request', billingState: 'billed' });
    const rows = listUsageLedger(fixtureValue.db, { studioId });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].estimatedCostMinor, null);
    assert.equal(rows[0].costUnit, null);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('queue rejects malformed frozen usage estimates without creating a run', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const configured = configureProvider(fixtureValue.initialized, { model: 'gpt-image-2', apiKey: 'provider-key-not-for-db' });
    const project = createProject(fixtureValue.db, { studioId, name: '损坏估算项目', idempotencyKey: 'malformed-estimate-project' }).value;
    const task = createTaskDraft(fixtureValue.db, { studioId, projectId: project.id, name: '损坏估算任务', idempotencyKey: 'malformed-estimate-task' }).value;
    const draft = createRoundDraft(fixtureValue.db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'malformed-estimate-round' }).value;
    const prepared = prepareRoundForConfirmation(fixtureValue.db, { studioId, roundId: draft.id, plan: { operation: 'generate', itemCount: 1, prompt: 'malformed estimate' }, expectedVersion: draft.version, idempotencyKey: 'malformed-estimate-prepare' }).value;
    const round = confirmRoundPlan(fixtureValue.db, { studioId, roundId: draft.id, expectedVersion: prepared.version, idempotencyKey: 'malformed-estimate-confirm' }).value;
    const preview = createDryRunPreview(fixtureValue.db, { studioId, roundId: round.id, providerConfig: configured.config, providerStatus: configured.status, usageEstimate: { unit: 'image', quantity: 1, estimatedCostMinor: 5, costUnit: 'USD_minor', source: 'caller' }, idempotencyKey: 'malformed-estimate-preview' }).value.preview;
    assert.ok(preview);
    const malformed = ['not-json', '{"unit":"image","quantity":1}'];
    malformed.forEach((usageEstimateJson, index) => {
      fixtureValue.db.prepare('UPDATE dry_run_previews SET usage_estimate_json = ? WHERE id = ?').run(usageEstimateJson, preview.id);
      assert.throws(() => queueGenerationRun(fixtureValue.db, { studioId, roundId: round.id, providerConfig: configured.config, providerStatus: configured.status, preflightId: preview.id, idempotencyKey: 'malformed-estimate-run-' + index }), (error) => {
        assert.equal(error.message, 'Frozen usage estimate is invalid.');
        assert.ok(!error.message.includes(usageEstimateJson));
        return true;
      });
      assert.equal(fixtureValue.db.prepare('SELECT COUNT(*) AS total FROM generation_runs').get().total, 0);
    });
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('usage summary and budget aggregate more than the ledger page limit', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const insert = fixtureValue.db.prepare('INSERT INTO usage_ledger (id, studio_id, profile_id, project_id, task_id, round_id, run_id, run_item_id, unit, quantity, estimated_cost_minor, cost_unit, billing_state, estimate_source, idempotency_key, created_at) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, \'image\', 1, 1, \'USD_minor\', \'estimated\', \'caller\', ?, ?)');
    fixtureValue.db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 10001; index += 1) insert.run('usage-many-' + index, studioId, 'usage-many-key-' + index, '2026-01-01T00:00:00.000Z');
      fixtureValue.db.exec('COMMIT');
    } catch (error) {
      fixtureValue.db.exec('ROLLBACK');
      throw error;
    }
    const summary = summarizeUsage(fixtureValue.db, { studioId });
    assert.deepEqual(summary, { quantity: 10001, knownCostMinor: 10001, unknownEventCount: 0, eventCount: 10001, costUnits: ['USD_minor'] });
    configureBudget(fixtureValue.db, { studioId, limitCostMinor: 10001, costUnit: 'USD_minor' });
    const gate = evaluateBudgetGate(fixtureValue.db, { studioId, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 1, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(gate.allowed, false);
    assert.equal(gate.code, 'budget_exceeded');
    assert.equal(gate.committedCostMinor, 10001);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('global budgets include profile-backed and profile-null usage while profile budgets stay isolated', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const insert = fixtureValue.db.prepare('INSERT INTO usage_ledger (id, studio_id, profile_id, project_id, task_id, round_id, run_id, run_item_id, unit, quantity, estimated_cost_minor, cost_unit, billing_state, estimate_source, idempotency_key, created_at) VALUES (?, ?, ?, NULL, NULL, NULL, NULL, NULL, \'image\', 1, ?, \'USD_minor\', \'billed\', \'provider\', ?, ?)');
    insert.run('usage-profile-a', studioId, 'profile-a', 80, 'usage-profile-a-key', '2026-01-01T00:00:00.000Z');
    insert.run('usage-profile-b', studioId, 'profile-b', 70, 'usage-profile-b-key', '2026-01-01T00:00:01.000Z');
    const insertGlobal = fixtureValue.db.prepare('INSERT INTO usage_ledger (id, studio_id, profile_id, project_id, task_id, round_id, run_id, run_item_id, unit, quantity, estimated_cost_minor, cost_unit, billing_state, estimate_source, idempotency_key, created_at) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, \'image\', 1, ?, \'USD_minor\', \'billed\', \'caller\', ?, ?)');
    insertGlobal.run('usage-profile-null', studioId, 10, 'usage-profile-null-key', '2026-01-01T00:00:02.000Z');

    configureBudget(fixtureValue.db, { studioId, limitCostMinor: 160, costUnit: 'USD_minor' });
    const globalGate = evaluateBudgetGate(fixtureValue.db, { studioId, profileId: 'profile-a', estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 1, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(globalGate.allowed, false);
    assert.equal(globalGate.code, 'budget_exceeded');
    assert.equal(globalGate.committedCostMinor, 160);

    configureBudget(fixtureValue.db, { studioId, profileId: 'profile-a', limitCostMinor: 100, costUnit: 'USD_minor' });
    const profileGate = evaluateBudgetGate(fixtureValue.db, { studioId, profileId: 'profile-a', estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 20, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(profileGate.allowed, true);
    assert.equal(profileGate.code, 'budget_ok');
    assert.equal(profileGate.committedCostMinor, 80);
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});

test('a failed run releases its reservation and the retry path re-clears the gate with the real code', () => {
  const fixtureValue = fixture();
  try {
    const studioId = fixtureValue.initialized.manifest.studioId;
    const configured = configureProvider(fixtureValue.initialized, { model: 'gpt-image-2', apiKey: 'provider-key-not-for-db' });
    const project = createProject(fixtureValue.db, { studioId, name: '重试闸门项目', idempotencyKey: 'retry-gate-project' });
    const task = createTaskDraft(fixtureValue.db, { studioId, projectId: project.value.id, name: '重试闸门任务', idempotencyKey: 'retry-gate-task' });
    const draft = createRoundDraft(fixtureValue.db, { studioId, taskId: task.value.id, purpose: 'exploration', idempotencyKey: 'retry-gate-round' });
    const prepared = prepareRoundForConfirmation(fixtureValue.db, { studioId, roundId: draft.value.id, plan: { operation: 'generate', itemCount: 1, prompt: 'retry gate' }, expectedVersion: draft.value.version, idempotencyKey: 'retry-gate-prepare' });
    const round = confirmRoundPlan(fixtureValue.db, { studioId, roundId: draft.value.id, expectedVersion: prepared.value.version, idempotencyKey: 'retry-gate-confirm' }).value;
    configureBudget(fixtureValue.db, { studioId, limitCostMinor: 1000, costUnit: 'USD_minor' });
    const preview = createDryRunPreview(fixtureValue.db, { studioId, roundId: round.id, providerConfig: configured.config, providerStatus: configured.status, usageEstimate: { unit: 'image', quantity: 1, estimatedCostMinor: 100, costUnit: 'USD_minor', source: 'caller' }, idempotencyKey: 'retry-gate-preview' });
    const run = queueGenerationRun(fixtureValue.db, { studioId, roundId: round.id, providerConfig: configured.config, providerStatus: configured.status, preflightId: preview.value.preview.id, idempotencyKey: 'retry-gate-run' }).value;
    const item = listGenerationRunItems(fixtureValue.db, run.id)[0];

    // A failed run holds no reservation, so it cannot block unrelated work while the operator decides.
    fixtureValue.db.prepare("UPDATE generation_runs SET status = 'failed' WHERE id = ?").run(run.id);
    fixtureValue.db.prepare("UPDATE run_items SET status = 'failed' WHERE id = ?").run(item.id);
    const freeAfterFailure = evaluateBudgetGate(fixtureValue.db, { studioId, projectId: project.value.id, roundId: round.id, estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 900, costUnit: 'USD_minor', source: 'caller' } });
    assert.equal(freeAfterFailure.allowed, true);

    // Retrying that run must re-clear the gate, and a unit mismatch must surface its own code instead of `budget_exceeded`.
    configureBudget(fixtureValue.db, { studioId, limitCostMinor: 1000, costUnit: 'EUR_minor' });
    assert.throws(() => retryGenerationRunItems(fixtureValue.db, { studioId, runId: run.id, idempotencyKey: 'retry-gate-mismatch' }), /budget_cost_unit_mismatch/);

    configureBudget(fixtureValue.db, { studioId, limitCostMinor: 1000, costUnit: 'USD_minor' });
    const retried = retryGenerationRunItems(fixtureValue.db, { studioId, runId: run.id, idempotencyKey: 'retry-gate-ok' });
    assert.deepEqual(retried.value.retriedItemIds, [item.id]);
    assert.equal(fixtureValue.db.prepare('SELECT status FROM generation_runs WHERE id = ?').get(run.id).status, 'queued');
  } finally { closeStudioDatabase(fixtureValue.db); fs.rmSync(fixtureValue.workspaceRoot, { recursive: true, force: true }); }
});
