const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson, requestJsonAsWorkbench } = require('./local-studio-test-helper');
const { readSource } = require('./source-text');

/**
 * 请求 ↔ 批次的闭环（方案 7.1 / 4.2，施工单 B5）。
 *
 * 三件事必须同时成立，上下文才「靠数据不靠记忆」：
 *   ① 原话住在请求表里（不复制进计划）；
 *   ② 计划只写 `requestId` 外键，且服务端校验它确属本 Studio；
 *   ③ 追问续说时上一条的原话随请求一起读得到。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-request-loop-'));
}

test('计划只留 requestId 外键：原话不复制，未知请求被拒', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'loop-project', body: { name: '闭环项目' } });
    const task = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'loop-task', body: { projectId: project.body.data.value.id, name: '闭环任务' } });

    const created = await requestJsonAsWorkbench(started, '/api/requests', { key: 'loop-request', body: { text: '把夜景调亮', projectId: project.body.data.value.id, taskId: task.body.data.value.id } });
    const requestId = created.body.data.id;

    const round = await requestJsonAsWorkbench(started, '/api/rounds', { key: 'loop-round', body: { taskId: task.body.data.value.id, purpose: 'refinement' } });
    const roundId = round.body.data.value.id;

    // 计划带上 requestId：服务端放行，且计划里只有外键，没有原话。
    const planned = await requestJsonAsWorkbench(started, '/api/rounds/' + roundId + '/plan', { method: 'POST', key: 'loop-plan', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 4, prompt: '夜景人像，暖光背景', requestId } } });
    assert.equal(planned.status, 200, JSON.stringify(planned.body));
    const storedPlan = started.service.db.prepare('SELECT plan_json FROM creative_rounds WHERE id = ?').get(roundId).plan_json;
    assert.equal(JSON.parse(storedPlan).requestId, requestId, '计划必须留下请求外键');
    assert.doesNotMatch(storedPlan, /把夜景调亮/, '原话不得复制进计划（它住在请求表里）');

    // 未知 requestId 一律拒绝。
    const otherRound = await requestJsonAsWorkbench(started, '/api/rounds', { key: 'loop-round-2', body: { taskId: task.body.data.value.id, purpose: 'variation' } });
    const bogus = await requestJsonAsWorkbench(started, '/api/rounds/' + otherRound.body.data.value.id + '/plan', { method: 'POST', key: 'loop-plan-bogus', body: { expectedVersion: otherRound.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'x', requestId: 'req_does_not_exist' } } });
    assert.equal(bogus.status, 404, '未知的 requestId 必须被拒');
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('闭环两向可查：请求带 result_round_id，计划带 requestId；追问能读回上一条原话', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'loop2-project', body: { name: '闭环项目' } });
    const task = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'loop2-task', body: { projectId: project.body.data.value.id, name: '闭环任务' } });
    const created = await requestJsonAsWorkbench(started, '/api/requests', { key: 'loop2-request', body: { text: '做一系列海报', projectId: project.body.data.value.id } });
    const requestId = created.body.data.id;
    await requestJson(started, '/api/requests/' + requestId + '/accept', { method: 'POST', idempotencyKey: 'loop2-accept', body: {} });

    // agent 追问 → 需要你
    const asked = await requestJson(started, '/api/requests/' + requestId + '/done', { method: 'POST', idempotencyKey: 'loop2-ask', body: { needsInput: '要多大的画幅？' } });
    assert.equal(asked.body.data.status, 'done');

    // 用户就地回答 → 新请求指回上一条
    const answer = await requestJsonAsWorkbench(started, '/api/requests', { key: 'loop2-answer', body: { text: '4:5', projectId: project.body.data.value.id, previousRequestId: requestId } });
    const detail = await requestJson(started, '/api/requests/' + answer.body.data.id);
    assert.equal(detail.body.data.request.id, answer.body.data.id);
    assert.equal(detail.body.data.previousRequest.id, requestId, '回答必须能读回上一条请求');
    assert.equal(detail.body.data.previousRequest.text, '做一系列海报', '读回的是上一条的原话');

    // agent 产出批次后结单：请求 → 批次
    const round = await requestJsonAsWorkbench(started, '/api/rounds', { key: 'loop2-round', body: { taskId: task.body.data.value.id, purpose: 'exploration' } });
    await requestJson(started, '/api/requests/' + answer.body.data.id + '/accept', { method: 'POST', idempotencyKey: 'loop2-accept-2', body: {} });
    const completed = await requestJson(started, '/api/requests/' + answer.body.data.id + '/done', { method: 'POST', idempotencyKey: 'loop2-done', body: { resultRoundId: round.body.data.value.id } });
    assert.equal(completed.body.data.resultRoundId, round.body.data.value.id, '请求必须记下它产出的批次');

    // 计划里带上它，闭环合拢。
    const planned = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/plan', { method: 'POST', key: 'loop2-plan', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 4, prompt: '系列海报', requestId: answer.body.data.id } } });
    assert.equal(planned.status, 200, JSON.stringify(planned.body));
    assert.equal(JSON.parse(started.service.db.prepare('SELECT plan_json FROM creative_rounds WHERE id = ?').get(round.body.data.value.id).plan_json).requestId, answer.body.data.id);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('归属查询走 studio-scope（不手写 JOIN 链），请求也在范围内', () => {
  const scope = readSource('src/vnext/domain/studio-scope.ts');
  assert.match(scope, /studio_request: scope\(/, 'studio_requests 必须有归属查询，新增表不能漏');
  const server = readSource('src/vnext/api/server.ts');
  assert.match(server, /assertPlanRequestInStudio/, '计划里的 requestId 必须被校验');
});
