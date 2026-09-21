const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { createProject, createTaskDraft, createRoundDraft, getRound } = require('../../dist/vnext/domain/studio-commands');
const { planShapeIssues, preflightGenerationPlan } = require('../../dist/vnext/runner/preflight');
const { configureProvider } = require('./provider-test-helper');
const { requestJson } = require('./local-studio-test-helper');

/**
 * 机器可判的错误必须在**人工确认之前**被拦下。
 *
 * `preflight` 只接受已确认的批次，所以「逐图提示词条数对不上」「超过模型提示词上限」这类
 * 纯机器判定，从前要等人点完确认才炸：用户白点一次、agent 白写一版、还要重新确认。
 * 现在它们在「准备确认」（POST /api/rounds/<id>/plan）就被拒绝，并带上逐条 issue。
 *
 * 同时钉死一条不能被这条闸门切断的工作流：**Provider 还没配**时，形状正确的计划照样能提交确认
 * —— 「先写计划、后配生成服务」是合法的。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-plan-precheck-'));
}

async function fixture({ provider = true, model = 'fixture-model' } = {}) {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  if (provider) configureProvider(initialized, { name: 'Precheck Provider', apiKey: 'precheck-secret-never-returned', model });
  const started = await startLocalStudioService({ hardenAccess: false, workspaceRoot, ssePollMs: 20 });
  const studioId = initialized.manifest.studioId;
  const db = started.service.db;
  const project = createProject(db, { studioId, name: 'Precheck project', idempotencyKey: 'precheck-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'Precheck task', idempotencyKey: 'precheck-task' }).value;
  const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'precheck-round' }).value;
  return { workspaceRoot, started, studioId, db, project, task, round };
}

async function dispose(value) {
  await value.started.service.close();
  fs.rmSync(value.workspaceRoot, { recursive: true, force: true });
}

async function submitPlan(value, plan, key = 'precheck-plan') {
  return requestJson(value.started, '/api/rounds/' + encodeURIComponent(value.round.id) + '/plan', {
    method: 'POST',
    idempotencyKey: key,
    body: { expectedVersion: getRound(value.db, value.studioId, value.round.id).version, plan }
  });
}

const VALID_PLAN = { operation: 'generate', itemCount: 2, prompt: '两位主角站在木质栈道上', itemPrompts: ['第一张：远景', '第二张：近景'], output: { aspectRatio: '1:1' } };

test('a plan whose item prompts do not match the item count is rejected before any human confirmation', async () => {
  const value = await fixture();
  try {
    const response = await submitPlan(value, { ...VALID_PLAN, itemPrompts: ['只有一条'] });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'plan_invalid');
    assert.deepEqual(response.body.error.details.issues.map((issue) => issue.code), ['item_prompt_count_mismatch']);
    assert.match(response.body.error.message, /item_prompt_count_mismatch\(itemPrompts\)/);
    const round = getRound(value.db, value.studioId, value.round.id);
    assert.equal(round.status, 'draft', '被拒绝的计划不得把批次推进到待确认');
    assert.equal(round.planVersion, 1, '被拒绝的计划不得产生新的计划版本');
  } finally {
    await dispose(value);
  }
});

test('a structurally sound plan still prepares confirmation, and the draft path stays unrestricted', async () => {
  const value = await fixture();
  try {
    const draft = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(value.round.id) + '/draft-context', {
      method: 'PUT',
      idempotencyKey: 'precheck-draft',
      body: { expectedVersion: getRound(value.db, value.studioId, value.round.id).version, plan: { ...VALID_PLAN, itemPrompts: ['半成品'] } }
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    const accepted = await submitPlan(value, VALID_PLAN, 'precheck-plan-ok');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.data.value.status, 'awaiting_confirmation');
  } finally {
    await dispose(value);
  }
});

test('planning without a configured provider still works: only the shape is enforced', async () => {
  const value = await fixture({ provider: false });
  try {
    const accepted = await submitPlan(value, VALID_PLAN, 'precheck-plan-no-provider');
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
    assert.equal(accepted.body.data.value.status, 'awaiting_confirmation');
    const broken = await submitPlan(value, { operation: 'generate', itemCount: 0, prompt: '', output: { aspectRatio: '1:1' } }, 'precheck-plan-no-provider-bad');
    assert.equal(broken.status, 400, JSON.stringify(broken.body));
    assert.deepEqual(broken.body.error.details.issues.map((issue) => issue.code).sort(), ['invalid_item_count', 'missing_prompt']);
  } finally {
    await dispose(value);
  }
});

test('a configured provider enforces its own limits at plan time, not at preflight', async () => {
  const value = await fixture({ model: 'gpt-image-2' });
  try {
    const tooLong = await submitPlan(value, { ...VALID_PLAN, prompt: '长'.repeat(32001) }, 'precheck-plan-too-long');
    assert.equal(tooLong.status, 400, JSON.stringify(tooLong.body));
    assert.deepEqual(tooLong.body.error.details.issues.map((issue) => issue.code), ['provider_prompt_too_large']);
  } finally {
    await dispose(value);
  }
});

test('plan shape issues come from the same implementation the preflight uses', () => {
  const mismatched = { ...VALID_PLAN, itemPrompts: ['只有一条'] };
  const shapeCodes = planShapeIssues(mismatched).map((issue) => issue.code);
  const preflightCodes = preflightGenerationPlan(mismatched, { configured: false }).issues.map((issue) => issue.code).filter((code) => code !== 'provider_not_ready');
  assert.deepEqual(shapeCodes, preflightCodes);
    // 未配置 Provider 时纯形状校验不得冒出 provider_not_ready：那不是形状问题。
  assert.equal(shapeCodes.includes('provider_not_ready'), false);
  assert.deepEqual(planShapeIssues(VALID_PLAN), []);
});

test('reference and mask rules are still enforced before confirmation', () => {
  const editWithoutReference = planShapeIssues({ operation: 'edit', itemCount: 1, prompt: '把背景换成海边' }).map((issue) => issue.code);
  assert.deepEqual(editWithoutReference, ['missing_reference']);
  const generateWithReference = planShapeIssues({ operation: 'generate', itemCount: 1, prompt: 'x', referenceAssetIds: ['asset_1'] }).map((issue) => issue.code);
  assert.deepEqual(generateWithReference, ['reference_requires_edit']);
});