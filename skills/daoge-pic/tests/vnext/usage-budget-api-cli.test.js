const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { recordUsageEvent } = require('../../dist/vnext/usage/ledger');
const { createProject, createTaskDraft, createRoundDraft } = require('../../dist/vnext/domain/studio-commands');
const { parseCommand } = require('../../dist/vnext/cli/daoge');
const { configureProvider } = require('./provider-test-helper');
const { requestJson, requestJsonAsWorkbench } = require('./local-studio-test-helper');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-usage-api-'));
}

function seedRun(db, roundId, profileId, configVersion) {
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, provider_profile_id, provider_config_version, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)').run('run-usage-api', roundId, 'running', '{}', '{}', profileId, configVersion, 1, 'default', timestamp, timestamp);
  db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('item-usage-api', 'run-usage-api', 1, 'outcome_unknown', '{}', 'request-usage-api', timestamp, timestamp);
  return { runId: 'run-usage-api', itemId: 'item-usage-api' };
}

async function fixture() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const configured = configureProvider(initialized, { name: 'Usage API Provider', apiKey: 'usage-api-secret-never-returned' });
  const started = await startLocalStudioService({ hardenAccess: false, workspaceRoot, ssePollMs: 20 });
  const studioId = initialized.manifest.studioId;
  const db = started.service.db;
  const project = createProject(db, { studioId, name: 'Usage API project', idempotencyKey: 'usage-api-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'Usage API task', idempotencyKey: 'usage-api-task' }).value;
  const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'usage-api-round' }).value;
  const run = seedRun(db, round.id, configured.config.profileId, configured.config.configVersion);
  recordUsageEvent(db, {
    studioId,
    runItemId: run.itemId,
    estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 25, costUnit: 'USD_minor', source: 'provider' },
    billingState: 'billed',
    idempotencyKey: 'usage-api-known'
  });
  recordUsageEvent(db, {
    studioId,
    projectId: project.id,
    estimate: { unit: 'image', quantity: 1, estimatedCostMinor: null, costUnit: null, source: 'unknown' },
    billingState: 'possibly_billed',
    idempotencyKey: 'usage-api-unknown'
  });
  return { workspaceRoot, started, studioId, project, task, round, run, profileId: configured.config.profileId };
}

async function dispose(value) {
  await value.started.service.close();
  fs.rmSync(value.workspaceRoot, { recursive: true, force: true });
}

test('usage and budget API is scoped, filterable, idempotent, and preserves unknown cost', async () => {
  const value = await fixture();
  try {
    const projectId = encodeURIComponent(value.project.id);
    const itemId = encodeURIComponent(value.run.itemId);
    const listed = await requestJson(value.started, '/api/usage?projectId=' + projectId);
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    assert.equal(listed.body.data.events.length, 2);
    assert.deepEqual(listed.body.data.events.map((event) => event.estimatedCostMinor).sort((a, b) => (a === null ? -1 : b === null ? 1 : a - b)), [null, 25]);
    assert.equal(listed.body.data.events.some((event) => event.billingState === 'billed'), true);
    assert.equal(listed.body.data.summary.eventCount, 2);
    assert.equal(listed.body.data.summary.unknownEventCount, 1);
    const limited = await requestJson(value.started, '/api/usage?projectId=' + projectId + '&limit=1');
    assert.equal(limited.status, 200, JSON.stringify(limited.body));
    assert.equal(limited.body.data.events.length, 1);

    const item = await requestJson(value.started, '/api/usage?runItemId=' + itemId);
    assert.equal(item.status, 200, JSON.stringify(item.body));
    assert.deepEqual(item.body.data.events.map((event) => event.runItemId), [value.run.itemId]);
    assert.equal(item.body.data.summary.knownCostMinor, 25);

    const summary = await requestJson(value.started, '/api/usage/summary?projectId=' + projectId);
    assert.equal(summary.status, 200, JSON.stringify(summary.body));
    assert.deepEqual(summary.body.data.summary, { quantity: 2, knownCostMinor: 25, unknownEventCount: 1, eventCount: 2, costUnits: ['USD_minor'] });

    const initialBudget = await requestJson(value.started, '/api/budget?profileId=' + encodeURIComponent(value.profileId));
    assert.equal(initialBudget.status, 200, JSON.stringify(initialBudget.body));
    assert.equal(initialBudget.body.data.policy, null);
    assert.equal(initialBudget.body.data.usage.knownCostMinor, 25);

    const body = { profileId: value.profileId, limitCostMinor: 0, costUnit: 'USD_minor' };
    const configured = await requestJson(value.started, '/api/budget', { method: 'POST', idempotencyKey: 'usage-api-budget', body });
    assert.equal(configured.status, 200, JSON.stringify(configured.body));
    assert.equal(configured.body.data.value.limitCostMinor, 0);
    assert.equal(configured.body.data.value.profileId, value.profileId);
    assert.equal(JSON.stringify(configured.body).includes('usage-api-secret-never-returned'), false);

    const replay = await requestJson(value.started, '/api/budget', { method: 'POST', idempotencyKey: 'usage-api-budget', body });
    assert.equal(replay.status, 200, JSON.stringify(replay.body));
    assert.equal(replay.body.data.replayed, true);
    assert.deepEqual(replay.body.data.value, configured.body.data.value);

    const conflict = await requestJson(value.started, '/api/budget', { method: 'POST', idempotencyKey: 'usage-api-budget', body: { ...body, limitCostMinor: 1 } });
    assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
    assert.equal(conflict.body.error.code, 'version_conflict');

    const nullLimit = await requestJson(value.started, '/api/budget', { method: 'POST', idempotencyKey: 'usage-api-null-limit', body: { limitCostMinor: null, costUnit: 'USD_minor' } });
    assert.equal(nullLimit.status, 400, JSON.stringify(nullLimit.body));
    const stringLimit = await requestJson(value.started, '/api/budget', { method: 'POST', idempotencyKey: 'usage-api-string-limit', body: { limitCostMinor: '0', costUnit: 'USD_minor' } });
    assert.equal(stringLimit.status, 400, JSON.stringify(stringLimit.body));

    const budget = await requestJson(value.started, '/api/budget?profileId=' + encodeURIComponent(value.profileId));
    assert.equal(budget.status, 200, JSON.stringify(budget.body));
    assert.equal(budget.body.data.policy.limitCostMinor, 0);
    assert.equal(budget.body.data.usage.unknownEventCount, 0);

    const missingProfile = await requestJson(value.started, '/api/usage?profileId=profile-does-not-exist');
    assert.equal(missingProfile.status, 404);
    assert.equal(missingProfile.body.error.code, 'not_found');
  } finally {
    await dispose(value);
  }
});

test('usage reads allow the Workbench session while budget writes require Bearer', async () => {
  const value = await fixture();
  try {
    const cookieRead = await requestJsonAsWorkbench(value.started, '/api/usage/summary');
    assert.equal(cookieRead.status, 200, JSON.stringify(cookieRead.body));
    const cookieWrite = await requestJsonAsWorkbench(value.started, '/api/budget', {
      method: 'POST',
      idempotencyKey: 'usage-api-cookie-budget',
      body: { limitCostMinor: 0, costUnit: 'USD_minor' }
    });
    assert.equal(cookieWrite.status, 403, JSON.stringify(cookieWrite.body));
    assert.equal(cookieWrite.body.error.code, 'forbidden');
  } finally {
    await dispose(value);
  }
});

test('CLI exposes encoded usage filters and accepts a zero budget limit as structured JSON', () => {
  const root = '/tmp/daoge-usage-cli';
  const listed = parseCommand(['usage-list', '--workspace', root, '--profile', 'profile a', '--project', 'project/a', '--task', 'task:x', '--round', 'round 1', '--run', 'run?1', '--item', 'item#1', '--limit', '5']);
  assert.equal(listed.request.method, 'GET');
  assert.equal(listed.request.pathname, '/api/usage?profileId=profile%20a&projectId=project%2Fa&taskId=task%3Ax&roundId=round%201&runId=run%3F1&runItemId=item%231&limit=5');
  assert.deepEqual(listed.request.body, {});
  assert.throws(() => parseCommand(['usage-list', '--workspace', root, '--limit', '10001']), /1 到 10000/);

  const summary = parseCommand(['usage-summary', '--workspace', root, '--project', 'project/a']);
  assert.equal(summary.request.pathname, '/api/usage/summary?projectId=project%2Fa');

  const budgetGet = parseCommand(['budget-get', '--workspace', root, '--profile', 'profile a']);
  assert.equal(budgetGet.request.pathname, '/api/budget?profileId=profile%20a');

  const budgetSet = parseCommand(['budget-set', '--workspace', root, '--profile', 'profile a', '--limit', '0', '--cost-unit', 'USD_minor', '--idempotency-key', 'budget-set-once']);
  assert.equal(budgetSet.request.method, 'POST');
  assert.deepEqual(budgetSet.request.body, { profileId: 'profile a', limitCostMinor: 0, costUnit: 'USD_minor' });
  assert.equal(budgetSet.request.idempotencyKey, 'budget-set-once');
  assert.throws(() => parseCommand(['budget-set', '--workspace', root, '--limit', '-1', '--cost-unit', 'USD_minor']), /非负安全整数/);
});
