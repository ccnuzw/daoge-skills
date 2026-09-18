const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 「agent 到哪一步了」的守卫（方案 4.2 / 4.5 / 4.9）。
 *
 * 两件事一起守：
 *   ① **进度可见** —— 用户不用靠命令行查就知道 agent 在理解 / 等确认 / 在出图 / 出完了；
 *   ② **计划就绪时卡片能直达确认** —— 闸门挂在批次节点上，而批次会被画布的模式或筛选
 *      藏起来（实测「找不到该节点」）；卡片是用户正在看的地方（4.2），从这里直达才可达。
 *
 * 进度全部由**已有事实**算出来（请求状态 + 关联批次 + 运行 + 槽位），
 * 所以也顺带守住红线「前端不造影子状态」。
 */

async function model() {
  return import('../../web/src/request-progress-model.mjs');
}

const round = (over = {}) => ({ id: 'rnd_1', taskId: 'tsk_1', status: 'active', plan: {}, planVersion: 2, ...over });
const linkedRound = (over = {}) => round({ plan: { requestId: 'req_1' }, ...over });
const run = (over = {}) => ({ id: 'run_1', roundId: 'rnd_1', status: 'running', createdAt: '2026-09-18T00:00:00.000Z', ...over });
const item = (status, index = 0) => ({ id: 'itm_' + index, runId: 'run_1', status });

test('阶段跟着事实走：等待 → 理解 → 待确认 → 出图 → 出完 → 失败', async () => {
  const { requestProgress } = await model();

  assert.equal(requestProgress({ id: 'req_1', status: 'pending' }).stage, 'waiting');
  assert.equal(requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [] }).stage, 'thinking');
  assert.equal(requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound({ status: 'draft' })] }).stage, 'drafting');

  const awaiting = requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound({ status: 'awaiting_confirmation' })] });
  assert.equal(awaiting.stage, 'awaiting-confirmation');
  assert.equal(awaiting.canConfirm, true, '计划就绪必须能从卡片确认');
  assert.equal(awaiting.roundId, 'rnd_1', '要带上批次 id 才能定位');

  assert.equal(requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound()] }).stage, 'preparing');

  const generating = requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound()], runs: [run()], runItems: [item('succeeded'), item('receiving', 1)] });
  assert.equal(generating.stage, 'generating');
  assert.match(generating.label, /1 \/ 2/, '出图时要说「几张出来了 / 共几张」');

  const done = requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound()], runs: [run({ status: 'completed' })], runItems: [item('succeeded'), item('succeeded', 1)] });
  assert.equal(done.stage, 'done');
  assert.match(done.label, /2 张/);

  const failed = requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound()], runs: [run({ status: 'failed' })], runItems: [item('succeeded'), item('failed', 1), item('blocked', 2)] });
  assert.equal(failed.stage, 'failed');
  assert.match(failed.label, /1 张没成/, 'failed 与 blocked 要分开说（4.10）');
  assert.match(failed.label, /1 张被挡/);
  assert.match(failed.detail, /1 张已经出来了/, '部分成功也要说清');
});

test('四类结果分开说：出来了 / 没成 / 被挡 / 要核实——下一步各不相同（4.10）', async () => {
  const { requestProgress } = await model();
  const failed = requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound()], runs: [run({ status: 'partial' })], runItems: [item('succeeded'), item('failed', 1), item('blocked', 2)] });
  assert.match(failed.label, /1 张出来了/);
  assert.match(failed.label, /1 张没成/);
  assert.match(failed.label, /1 张被挡/);
});

test('⚠️ outcome_unknown 不许说成「没成」——它不是失败，是要人去核实', async () => {
  const { requestProgress } = await model();
  const onlyUnknown = requestProgress({ id: 'req_1', status: 'accepted' }, {
    rounds: [linkedRound()],
    runs: [run({ status: 'failed' })],
    runItems: [item('outcome_unknown'), item('outcome_unknown', 1)]
  });
  assert.equal(onlyUnknown.stage, 'verify', '只有结果未知时，阶段是「要核实」而不是「失败」');
  assert.match(onlyUnknown.label, /2 张要核实出没出/);
  assert.doesNotMatch(onlyUnknown.label, /没成/, '不许把「要核实」说成「没成」——那会让人以为系统不稳');
  // 措辞与错误文案模型同源（复用它的建议，不另写一份）。
  const { failureAttribution } = await import('../../web/src/failure-copy-model.mjs');
  assert.equal(onlyUnknown.detail, failureAttribution({ status: 'outcome_unknown' }).advice);
  assert.match(onlyUnknown.detail, /服务商后台|看一眼/);
  assert.doesNotMatch(onlyUnknown.detail, /结果未知/);
});

test('⚠️ 「被接过但没完成」必须说出来，否则用户以为压根没人理过', async () => {
  const { requestProgress } = await model();
  // 刚发出去：还没人看过。
  assert.equal(requestProgress({ id: 'req_1', status: 'pending', attempts: 0 }).label, '等待接单');
  // agent 领过、租约过期自动回队（实测就是这种：attempts=1，看着跟全新的一样）。
  const requeued = requestProgress({ id: 'req_1', status: 'pending', attempts: 1 });
  assert.equal(requeued.stage, 'requeued');
  assert.match(requeued.label, /等待重新接单/);
  assert.match(requeued.detail, /已被领取 1 次但没完成/, '要说清「有人接过」这件事');
});

test('撤回与「agent 说做不了」都是 rejected，但说法不同', async () => {
  const { requestProgress } = await model();
  assert.equal(requestProgress({ id: 'req_1', status: 'rejected', resultJson: JSON.stringify({ withdrawn: true }) }).label, '已撤回');
  assert.equal(requestProgress({ id: 'req_1', status: 'rejected', resultJson: JSON.stringify({ reason: '只能出图片' }) }).label, '无法处理');
});

test('关联靠 plan.requestId 外键——一个请求出多批时取最后一批', async () => {
  const { roundForRequest } = await model();
  const rounds = [
    linkedRound({ id: 'rnd_1', plan: { requestId: 'req_1' } }),
    linkedRound({ id: 'rnd_2', plan: { requestId: 'req_1' } }),
    linkedRound({ id: 'rnd_other', plan: { requestId: 'req_2' } })
  ];
  assert.equal(roundForRequest({ id: 'req_1' }, rounds).id, 'rnd_2');
  assert.equal(roundForRequest({ id: 'req_3' }, rounds), null);
  assert.equal(roundForRequest({ id: 'req_1' }, []), null);
});

test('数据不全时降级，不编数字', async () => {
  const { requestProgress } = await model();
  // 没有槽位数据（比如不在画布视图）时，仍要说「在出图」，但不编 N/M。
  const generating = requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound()], runs: [run()], runItems: [] });
  assert.equal(generating.stage, 'generating');
  assert.doesNotMatch(generating.label, /\/\s*\d/, '没有计数时不许编一个进度出来');
  // 已完成但没有计数：说「出图完成」，不编张数。
  const done = requestProgress({ id: 'req_1', status: 'accepted' }, { rounds: [linkedRound()], runs: [run({ status: 'completed' })], runItems: [] });
  assert.equal(done.stage, 'done');
  assert.doesNotMatch(done.label, /\d+ 张/);
});

test('接线：卡片显示进度，且「去确认」真的定位到那一批并打开闸门', () => {
  const dock = readSource('web/src/request-queue.jsx');
  const main = readSource('web/src/main.jsx');
  // 进度由 main 算（它持有批次 / 运行 / 槽位），dock 只负责渲染 —— 单一来源，不两头算。
  assert.match(dock, /progressValue\.canConfirm/, '计划就绪时要有确认入口');
  assert.match(dock, /去确认计划/, '入口文案要说得出口');
  assert.match(main, /progressForRequest/, 'main 必须把进度算出来传给卡片');
  assert.match(main, /onOpenRound=\{openRoundFromQueue\}/, '「去确认 / 看这一批」必须接上');
  assert.match(main, /openRoundFromQueue/, '必须有「从队列定位批次」的实现');
  // 进度必须由已有事实算（禁止前端累加影子进度）；
  // 批次/运行/槽位取自「当前视图 + 按 id 补取」——补取是为了全局底栏也能算对。
  assert.match(main, /requestProgress\(request, \{[^}]*rounds: roundsForQueue[^}]*\}\)/, '进度来源必须是已有事实');
  assert.match(main, /roundsForQueue/, '缺的关联批次要按 id 补取（全局底栏拿不到当前视图之外的数据）');
  assert.match(main, /linked: linkedProgress/, '补取到的 latestRun/tally 必须交给模型（否则出图中会显示成「准备出图」）');
});

test('确认后卡片立刻更新：当前视图的事实必须覆盖补取的旧快照', async () => {
  const { queueRounds } = await model();
  // 补取时的旧快照（确认前取到的 awaiting_confirmation）。
  const linked = new Map([['rnd_1', { round: linkedRound({ status: 'awaiting_confirmation' }), latestRun: null, tally: null }]]);
  // 当前视图刷新后的事实（用户刚确认，后端已 active）。
  const fresh = linkedRound({ status: 'active' });
  const merged = queueRounds([fresh], linked);
  assert.equal(merged.length, 1, '同一批次不能出现两行');
  assert.equal(merged[0].status, 'active', '当前视图的新事实必须赢过补取的旧快照，否则要点整页刷新才更新');
  // 当前视图没有这个批次时，补取的快照仍然可用（全局底栏的用途）。
  assert.equal(queueRounds([], linked)[0].status, 'awaiting_confirmation');
  assert.deepEqual(queueRounds([], null), []);
});

test('接线：确认后卡片立刻更新（刷新会重取补取快照，合并时当前视图优先）', () => {
  const main = readSource('web/src/main.jsx');
  assert.match(main, /queueRounds\(rounds, linkedProgress\)/, '合并必须走 queueRounds（当前视图优先）');
  assert.match(main, /setProgressRevision\(\(current\) => current \+ 1\)/, '刷新要重取补取的批次快照');
  assert.match(main, /progressRevision\]/, '补取 effect 要依赖刷新版本号，否则永远拿旧快照');
});

test('提交不了永远要有一句话：确认入口不许静默返回', () => {
  const main = readSource('web/src/main.jsx');
  const block = main.slice(main.indexOf('const openGenerationConfirmation'), main.indexOf('const dismissGenerationConfirmation'));
  // 原来这里是 `if (!targetRound || targetRound.status !== 'awaiting_confirmation') return;`
  // ——点了毫无反应，用户只能猜。现在每一条出口都要给反馈。
  assert.doesNotMatch(block, /status !== 'awaiting_confirmation'\)\s*return;/, '不许静默 return');
  assert.match(block, /setNotice\('请先选择要确认的批次。'\)/, '没选批次要说');
  assert.match(block, /已经确认过了/, '已确认要说');
  assert.match(block, /还没有可确认的计划/, '没有计划要说');
});
