const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson, requestJsonAsWorkbench } = require('./local-studio-test-helper');

/**
 * 请求队列的 HTTP 层（方案 4.2 / 7.1，施工单 B2）。
 *
 * 「说一句被接单」需要三件事同时成立：
 *   ① 用户说的话进了队列（cookie 就能发起）；
 *   ② agent 能原子领单，且**两个 agent 不会重复消费同一单**；
 *   ③ `accepted` 立刻经由事件推送出去（界面显示「agent 正在理解…」，不静默）。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-queue-api-'));
}

test('请求队列：发起、列表、领单、结单、拒单、撤单走同一条 HTTP 队列', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'queue-project', body: { name: '队列项目' } });

    // ① 用户说话（cookie 发起），自带上下文。
    const created = await requestJsonAsWorkbench(started, '/api/requests', { key: 'queue-create-1', body: { text: '把夜景调亮，背景换成暖光', projectId: project.body.data.value.id, flow: 'daoge-pic-plan' } });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const requestId = created.body.data.id;
    assert.equal(created.body.data.status, 'pending');
    assert.equal(created.body.data.text, '把夜景调亮，背景换成暖光');
    assert.equal(created.body.data.projectId, project.body.data.value.id, '请求必须自带项目上下文（不依赖 session）');

    const listed = await requestJson(started, '/api/requests?status=pending');
    assert.equal(listed.body.data.requests.some((request) => request.id === requestId), true);

    // ② agent 原子领单；第二个 agent 领不到同一单。
    const firstClaim = await requestJson(started, '/api/requests/' + requestId + '/accept', { method: 'POST', idempotencyKey: 'queue-accept-1', body: { agentId: 'agent-a' } });
    assert.equal(firstClaim.body.data.claimed, true);
    assert.equal(firstClaim.body.data.request.status, 'accepted');
    const secondClaim = await requestJson(started, '/api/requests/' + requestId + '/accept', { method: 'POST', idempotencyKey: 'queue-accept-2', body: { agentId: 'agent-b' } });
    assert.equal(secondClaim.body.data.claimed, false, '同一单不能被两个 agent 同时领走');

    // ③ accepted 事件立刻可读（SSE 的推送源），界面据此显示「正在理解」。
    const events = await requestJson(started, '/api/events');
    assert.equal(events.body.data.events.some((event) => event.eventType === 'request.accepted' && event.entityId === requestId), true, 'accepted 必须产生可推送的事件');

    // 结单带回回复（非出图类请求的答复就显示在发起处）。
    const done = await requestJson(started, '/api/requests/' + requestId + '/done', { method: 'POST', idempotencyKey: 'queue-done-1', body: { reply: '这一批整体偏暗，建议下一批把背景补光。' } });
    assert.equal(done.body.data.status, 'done');
    assert.equal(JSON.parse(done.body.data.resultJson).reply, '这一批整体偏暗，建议下一批把背景补光。');

    // 追问形态：needsInput 也是结单的一种。
    const asked = await requestJsonAsWorkbench(started, '/api/requests', { key: 'queue-create-2', body: { text: '做一系列海报', projectId: project.body.data.value.id } });
    await requestJson(started, '/api/requests/' + asked.body.data.id + '/accept', { method: 'POST', idempotencyKey: 'queue-accept-3', body: {} });
    const needsInput = await requestJson(started, '/api/requests/' + asked.body.data.id + '/done', { method: 'POST', idempotencyKey: 'queue-done-2', body: { needsInput: '要多大的画幅？' } });
    assert.equal(JSON.parse(needsInput.body.data.resultJson).needsInput, '要多大的画幅？');

    // 拒单用人话说明原因。
    const rejectedReq = await requestJsonAsWorkbench(started, '/api/requests', { key: 'queue-create-3', body: { text: '给我出个视频' } });
    await requestJson(started, '/api/requests/' + rejectedReq.body.data.id + '/accept', { method: 'POST', idempotencyKey: 'queue-accept-4', body: {} });
    const rejected = await requestJson(started, '/api/requests/' + rejectedReq.body.data.id + '/reject', { method: 'POST', idempotencyKey: 'queue-reject-1', body: { reason: '目前只能出图片。' } });
    assert.equal(rejected.body.data.status, 'rejected');
    assert.match(JSON.parse(rejected.body.data.resultJson).reason, /只能出图片/);

    // 未被接单的可以撤回；已被接单的不能。
    const withdrawable = await requestJsonAsWorkbench(started, '/api/requests', { key: 'queue-create-4', body: { text: '算了，先不出' } });
    const withdrawn = await requestJsonAsWorkbench(started, '/api/requests/' + withdrawable.body.data.id + '/withdraw', { key: 'queue-withdraw-1', body: {} });
    assert.equal(withdrawn.body.data.status, 'rejected');

    const doneWithdraw = await requestJsonAsWorkbench(started, '/api/requests/' + requestId + '/withdraw', { key: 'queue-withdraw-2', body: {} });
    assert.equal(doneWithdraw.status, 400, '已结束的请求不能撤回');

    // 花动作走队列：重试 / 恢复按钮把 intent + runId + itemIds 写进请求，
    // 但服务端先校验它确属本 Studio——不能借队列去探测/引用不属于这里的运行。
    const badRun = await requestJsonAsWorkbench(started, '/api/requests', { key: 'queue-create-action-bad', body: { text: '重试这批里没成的项', projectId: project.body.data.value.id, intent: 'retry', runId: 'run_not_here' } });
    assert.ok(badRun.status >= 400, '引用不属于本 Studio 的运行必须被拒绝');
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('租约过期即自愈：读队列时把超期的单放回等待（或按次数失败）', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const created = await requestJsonAsWorkbench(started, '/api/requests', { key: 'expire-create-1', body: { text: '再亮一点' } });
    const requestId = created.body.data.id;
    await requestJson(started, '/api/requests/' + requestId + '/accept', { method: 'POST', idempotencyKey: 'expire-accept-1', body: { agentId: 'agent-a' } });
    // 把租约改到过去，模拟 agent 领了单却没处理。
    started.service.db.prepare('UPDATE studio_requests SET lease_expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', requestId);
    const listed = await requestJson(started, '/api/requests');
    const request = listed.body.data.requests.find((item) => item.id === requestId);
    assert.equal(request.status, 'pending', '租约过期的单必须回到等待，界面显示「等待接单」');
    assert.equal(request.attempts, 1);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
