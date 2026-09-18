const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource, readFrontendSource } = require('./source-text');

/**
 * 请求队列界面守卫（方案 4.2 / 4.5 / 4.6 / 8.10，施工单 B4 + B6）。
 *
 * 队列界面只讲人话，且四态各有说法：等待接单 / agent 正在理解 / 需要你 / 就绪。
 * 「需要你」必须**就地能答**（不离开画布、不丢圈选指代）；「说一句」必须**足够自由**
 * （绝不是从下拉里选模板，否则用户没法指定 skill）。
 */

async function model() {
  return import('../../web/src/request-queue-model.mjs');
}

test('请求卡片四态各有说法：等待 / 处理中 / 需要你 / 就绪，并区分撤回与拒单', async () => {
  const { requestCardPresentation } = await model();
  assert.equal(requestCardPresentation({ status: 'pending' }).kind, 'waiting');
  assert.equal(requestCardPresentation({ status: 'pending' }).canWithdraw, true, '还没人接的单可以撤回');
  assert.equal(requestCardPresentation({ status: 'accepted' }).kind, 'working');
  assert.equal(requestCardPresentation({ status: 'accepted' }).canWithdraw, false, '被接单后不能撤回');
  assert.equal(requestCardPresentation({ status: 'failed' }).kind, 'failed');

  const needsInput = requestCardPresentation({ status: 'done', resultJson: JSON.stringify({ needsInput: '要多大的画幅？' }) });
  assert.equal(needsInput.kind, 'needs-input');
  assert.equal(needsInput.canAnswer, true, '追问必须就地能答');
  assert.equal(needsInput.question, '要多大的画幅？');

  const reply = requestCardPresentation({ status: 'done', resultJson: JSON.stringify({ reply: '这批偏暗。' }) });
  assert.equal(reply.kind, 'reply');
  assert.equal(reply.reply, '这批偏暗。');

  const ready = requestCardPresentation({ status: 'done', resultJson: JSON.stringify({ resultRoundId: 'rnd_1' }) });
  assert.equal(ready.kind, 'ready', '写好了计划就是「就绪 · 待确认」');

  const withdrawn = requestCardPresentation({ status: 'rejected', resultJson: JSON.stringify({ withdrawn: true }) });
  assert.equal(withdrawn.kind, 'withdrawn');
  const rejected = requestCardPresentation({ status: 'rejected', resultJson: JSON.stringify({ reason: '目前只能出图片。' }) });
  assert.equal(rejected.kind, 'rejected');
  assert.equal(rejected.text, '目前只能出图片。');
});

test('催什么取决于下一步该做什么：不在场→去唤起；在场没接→去说一声', async () => {
  const { queueAttention } = await model();
  const now = Date.parse('2026-09-18T00:00:00.000Z');
  const pendingAgo = (msAgo) => ({ status: 'pending', createdAt: new Date(now - msAgo).toISOString() });

  // 不在场：等 2 分钟或积压 3 条 → 催「去唤起」。
  assert.equal(queueAttention({ requests: [pendingAgo(10_000)], now }).attention, false, '刚发出去不催');
  assert.equal(queueAttention({ requests: [pendingAgo(3 * 60 * 1000)], now }).reason, 'waiting', '不在场等久了 → 去唤起');
  assert.equal(queueAttention({ requests: [pendingAgo(1000), pendingAgo(1000), pendingAgo(1000)], now }).reason, 'backlog', '不在场积压 → 去唤起');

  // ⚠️ 在场但没人接：这**不是**「不在场」，要说的是「去说一声」（agent 入场才会读队列）。
  // 之前这里直接不提示，用户看到「agent 在场」+「还没人接」两句话互相矛盾、不知道该做什么。
  assert.equal(queueAttention({ requests: [pendingAgo(10 * 60 * 1000)], now, present: true }).reason, 'present-waiting', '在场但没接 → 去说一声');
  assert.equal(queueAttention({ requests: [pendingAgo(1000), pendingAgo(1000), pendingAgo(1000)], now, present: true }).reason, 'present-waiting');
  // 在场 + 刚发出去：不用催，等一等就是了。
  assert.equal(queueAttention({ requests: [pendingAgo(5000)], now, present: true }).attention, false);
  assert.equal(queueAttention({ requests: [{ status: 'done', createdAt: new Date(now - 10 * 60 * 1000).toISOString() }], now }).attention, false, '已结束的不算');
});

test('被领过但没完成时，不许再说「还没人接」（否则与卡片自相矛盾）', async () => {
  const { queueAttention } = await model();
  const now = Date.parse('2026-09-18T00:00:00.000Z');
  const requeued = queueAttention({ requests: [{ status: 'pending', attempts: 1, createdAt: new Date(now - 10 * 60 * 1000).toISOString() }], now });
  assert.equal(requeued.reason, 'requeued');
  const dock = readSource('web/src/request-queue.jsx');
  assert.match(dock, /requeued'\s*\)\s*return '这一条之前被接过/, '要说清「接过但没完成」');
  // 那一句里不许出现「还没人接」。
  const requeuedLine = dock.slice(dock.indexOf("attention.reason === 'requeued'"), dock.indexOf("=== 'backlog'"));
  assert.doesNotMatch(requeuedLine, /还没人接/, '被领过就不能说「还没人接」');
});

test('三种提示三句话，且在场那句不许说「不在场」', () => {
  const dock = readSource('web/src/request-queue.jsx');
  assert.match(dock, /attentionMessage/, '提示文案必须按情形分派');
  assert.match(dock, /present-waiting'\s*\)\s*return '这一条已经排上了；去会话里说一声/, '在场但没接 → 去说一声');
  assert.match(dock, /backlog'\s*\)\s*return '已经积了几条，agent 可能不在场/, '积压 → 唤起');
  // 在场那句绝不能出现「不在场」三个字（这正是原来那个自相矛盾的来源）。
  const presentLine = dock.slice(dock.indexOf("attention.reason === 'present-waiting'"), dock.indexOf("=== 'backlog'"));
  assert.doesNotMatch(presentLine, /不在场/, '在场时的提示不许说「不在场」');
});

test('发起请求自带上下文，且必须选了项目（项目是容器）', async () => {
  const { requestContextFor } = await model();
  const withoutProject = requestContextFor({ taskId: 'tsk_1', assetIds: ['a1'] });
  assert.equal(withoutProject.canSend, false, '没选项目就不能说这句话');
  const scoped = requestContextFor({ projectId: 'prj_1', taskId: 'tsk_1', roundId: 'rnd_1', assetIds: ['a1', 'a1', 'a2'] });
  assert.equal(scoped.canSend, true);
  assert.deepEqual(scoped.assetIds, ['a1', 'a2'], '选中的图去重后随请求走');
  assert.equal(scoped.roundId, 'rnd_1');
  // 「花动作」按钮走队列时，意图必须结构化地跟着走：agent 据此精确执行，不靠猜。
  const action = requestContextFor({ projectId: 'prj_1', roundId: 'rnd_1', intent: 'retry', runId: 'run_1', itemIds: ['itm_1', 'itm_1', 'itm_2'] });
  assert.equal(action.intent, 'retry');
  assert.equal(action.runId, 'run_1');
  assert.deepEqual(action.itemIds, ['itm_1', 'itm_2'], '要重试哪几项必须去重后随请求走');
  const plain = requestContextFor({ projectId: 'prj_1' });
  assert.equal(plain.intent, null, '普通请求不带意图');
  assert.deepEqual(plain.itemIds, []);
});

test('重试 / 恢复按钮不直调 bearer，而是把意图写进请求队列', () => {
  const main = readSource('web/src/main.jsx');
  const control = main.slice(main.indexOf('const requestRunAction'), main.indexOf('const copyRunPrompt'));
  // 花动作必须走队列：带 intent + runId + itemIds 的 sendRequest。
  assert.match(control, /sendRequest\(/, '重试 / 恢复必须把意图写进队列');
  assert.match(control, /intent, runId: targetRunId, itemIds: uniqueIds/, '意图、运行、运行项都要随请求走');
  // 绝不直调 bearer（会重新花钱）——这里不许出现运行控制端点。
  assert.doesNotMatch(control, /\/api\/runs\/[^']*\/(retry|resume)/, '浏览器不许直调重试 / 恢复（那是 Bearer 花动作）');
  // 行内「重试」按钮要真的在，且点了会派活。
  assert.match(main, /onClick=\{\(\) => void onRetry\(item\.id\)\}><RefreshCw size=\{15\} \/>重试/, '行内要有直达的重试按钮');
  // 暂停 / 取消仍是 cookie 止损，点了就生效。
  assert.match(control, /paths\[action\]/, '止损动作仍要直达');
});

test('接线到位：输入框是自由文本、队列来自唯一事实源、追问可就地回答', () => {
  const main = readSource('web/src/main.jsx');
  assert.match(main, /RequestQueueDock/, '必须真的把队列界面渲染出来');
  assert.match(main, /use-request-queue\.mjs/, '队列状态必须走这个 hook');
  assert.match(main, /onAnswer=\{answerRequest\}/, '追问必须接上就地回答');
  assert.match(main, /previousRequestId: request\.id/, '回答要指回上一条请求，agent 才「续得上」');
  // 队列来自库，不是前端自己攒的。
  assert.match(readSource('web/src/use-request-queue.mjs'), /\/api\/requests/);
  // 输入框是自由文本：不是从模板下拉里选。
  assert.match(readFrontendSource(), /textarea/, '请求入口是自由文本输入');
  const dock = readSource('web/src/request-queue.jsx');
  assert.doesNotMatch(dock, /<select[\s\S]{0,200}(模板|skill)/, '绝不能把「说一句」做成模板下拉（方案 4.6 硬要求）');
});

test('在场只能有一个来源：在场时不出现「agent 不在场」的提示', () => {
  const dock = readSource('web/src/request-queue.jsx');
  // 这一条防的是一个真实的自相矛盾：dock 曾有独立的 `present` 属性，
  // 而 main.jsx 只传了 `presence` —— 于是 present 恒为 false，
  // 界面同时显示「agent 在场」和「agent 不在场时，唤起它就会接单」。
  assert.match(dock, /const present = presence\?\.present === true/, '在场必须由 presence 对象派生（单一来源）');
  assert.doesNotMatch(dock, /present\s*=\s*false/, '不许再有一个独立的 present 默认值（那会与 presence 打架）');
  // 调用方必须把 presence 接上（没有它，判据就无从谈起）。
  const main = readSource('web/src/main.jsx');
  assert.match(main, /<RequestQueueDock[\s\S]{0,400}presence=\{agentPresenceStatus\}/, '必须把 agent 在场传进队列 dock');
});

test('队列事件驱动界面重取（accepted 立刻可见，不静默）', async () => {
  const { studioEventRefreshPlan } = await import('../../web/src/use-studio-events.mjs');
  assert.equal(studioEventRefreshPlan([{ entityType: 'request', eventType: 'request.accepted' }]).requests, true);
  assert.equal(studioEventRefreshPlan([{ eventType: 'request.done' }]).requests, true);
  assert.equal(studioEventRefreshPlan([{ eventType: 'asset.reviewed' }]).requests, false);
  const main = readSource('web/src/main.jsx');
  assert.match(main, /eventRevision: eventRevision\.requests/, '队列必须挂到事件版本上');
});
