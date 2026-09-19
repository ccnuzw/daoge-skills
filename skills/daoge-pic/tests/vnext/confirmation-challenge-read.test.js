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
 * 界面必须能**按批次**读到待确认的挑战。
 *
 * 这条守卫来自一个真实回归：机制收归「会话工作指针只属于 agent」之后，
 * 界面不再往 `agent_*` 写东西，而它读挑战走的是
 * `GET /api/sessions/<自己>/plan-status` —— 必然拿到 null，
 * 于是确认按钮永远说「请先由当前智能会话发起挑战」，尽管挑战已经在了。
 *
 * 为什么此前没被抓到：既有测试只覆盖了**创建**挑战（POST）与**执行**确认，
 * 没有覆盖**界面读取**这一步。缺的正是「中间那一环」。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-challenge-read-'));
}

/** 把一批推到「待确认 + 已有挑战」，返回 { roundId, challenge }。 */
async function preparePendingChallenge(started) {
  const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'cr-project', body: { name: '挑战读取项目' } });
  const task = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'cr-task', body: { projectId: project.body.data.value.id, name: '挑战读取任务' } });
  const round = await requestJsonAsWorkbench(started, '/api/rounds', { key: 'cr-round', body: { taskId: task.body.data.value.id, purpose: 'variation' } });
  const roundId = round.body.data.value.id;
  const session = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'cr-session', body: { conversationId: 'agent-conversation-for-challenge' } });
  const sessionId = session.body.data.id;
  // 会话指针只在 agent 那侧设（界面不再写它）——正是回归发生的前提。
  await requestJson(started, '/api/sessions/' + sessionId + '/context', { method: 'POST', idempotencyKey: 'cr-context', body: { roundId } });
  await requestJson(started, '/api/rounds/' + roundId + '/plan', { method: 'POST', idempotencyKey: 'cr-plan', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: '挑战读取' } } });
  const challenge = await requestJson(started, '/api/rounds/' + roundId + '/confirmation-challenge', { method: 'POST', idempotencyKey: 'cr-challenge', body: { sessionId } });
  return { roundId, sessionId, challenge: challenge.body.data };
}

test('界面按批次读得到待确认的挑战，不需要会话工作指针', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const { roundId, challenge } = await preparePendingChallenge(started);

    // 关键：用一个**全新的、没有设置任何工作指针**的会话（模拟浏览器侧）去读。
    const browser = await requestJsonAsWorkbench(started, '/api/sessions/open', { key: 'cr-browser', body: { conversationId: 'workbench-browser-session' } });
    assert.equal(browser.body.data.agentRoundId, null, '前提：界面会话不持有工作指针');

    const read = await requestJsonAsWorkbench(started, '/api/rounds/' + roundId + '/confirmation-challenge', { key: 'cr-read' });
    assert.equal(read.status, 200, JSON.stringify(read.body));
    assert.ok(read.body.data.pendingConfirmation, '按批次必须读得到挑战（回归点：这里曾是 null）');
    assert.equal(read.body.data.pendingConfirmation.challenge, challenge.challenge);
    assert.equal(read.body.data.pendingConfirmation.sessionId, challenge.sessionId, '挑战自带它绑定的会话，界面不需要知道');
    assert.equal(read.body.data.pendingConfirmation.expectedVersion, challenge.expectedVersion);

    // 端到端：界面拿到的这份挑战必须真的能用来确认。
    const confirmed = await requestJsonAsWorkbench(started, '/api/rounds/' + roundId + '/confirm', {
      key: 'cr-confirm',
      body: { expectedVersion: read.body.data.pendingConfirmation.expectedVersion, sessionId: read.body.data.pendingConfirmation.sessionId, challenge: read.body.data.pendingConfirmation.challenge }
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.data.value.status, 'active', '确认后计划被激活');

    // 确认之后就不该再有待处理挑战（不给界面留一个点了会 400 的按钮）。
    const afterRead = await requestJsonAsWorkbench(started, '/api/rounds/' + roundId + '/confirmation-challenge', { key: 'cr-read-after' });
    assert.equal(afterRead.body.data.pendingConfirmation, null, '已确认的批次不该还有待处理挑战');
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('无挑战是「明确状态」而不是「操作结果不明确」——界面给指引，不报错', async () => {
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  // 闸门要由 agent 先发起挑战。没有挑战时若抛普通 Error，会被归一化成
  // unknown_error → 「操作结果不明确 / 不可自动重试」，那是未知故障的说法，会误导人。
  // 第 4 批 Q1：这条判断收进了**单一来源**（confirmation-entry-model），界面只负责说出来。
  assert.match(main, /confirmationEntry\(\{ hasChallenge: Boolean\(pending\)/, '「能不能开闸门」要问确认入口模型，不许自己判断');
  assert.match(main, /setNotice\(entry\.reason\)/, '模型给的指引必须说出来（不许静默）');
  const block = main.slice(main.indexOf('const openGenerationConfirmation'), main.indexOf('const dismissGenerationConfirmation'));
  assert.doesNotMatch(block, /throw new Error\('这个计划还没有可确认的挑战/, '不许把「没有挑战」当成错误抛出（会被报成「结果不明确」）');
  // 行为：模型对「没有挑战」给的是**明确指引**（说清去会话让 agent 发起），不是故障话术。
  const { confirmationEntry } = await import('../../web/src/confirmation-entry-model.mjs');
  const noChallenge = confirmationEntry({ hasChallenge: false, roundStatus: 'awaiting_confirmation' });
  assert.equal(noChallenge.open, false);
  assert.match(noChallenge.reason, /会话/, '要说清「去会话让 agent 发起」这个动作');
  assert.match(noChallenge.reason, /挑战/);
  assert.doesNotMatch(noChallenge.reason, /结果不明确|不可自动重试/, '不许用未知故障的说法');
});

test('没有挑战时按批次读返回 null（界面据此不显示确认按钮，而不是报错）', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const project = await requestJsonAsWorkbench(started, '/api/projects', { key: 'cr2-project', body: { name: '无挑战项目' } });
    const task = await requestJsonAsWorkbench(started, '/api/tasks', { key: 'cr2-task', body: { projectId: project.body.data.value.id, name: '无挑战任务' } });
    const round = await requestJsonAsWorkbench(started, '/api/rounds', { key: 'cr2-round', body: { taskId: task.body.data.value.id, purpose: 'exploration' } });
    const read = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/confirmation-challenge', { key: 'cr2-read' });
    assert.equal(read.status, 200);
    assert.equal(read.body.data.pendingConfirmation, null);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
