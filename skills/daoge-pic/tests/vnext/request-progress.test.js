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

test('⚠️ 视图数据优先于补取快照，且补取要随事件重取（否则进度会卡在旧值）', async () => {
  const { requestProgress } = await model();
  const req = { id: 'req_1', status: 'accepted', resultRoundId: 'rnd_1' };
  const viewRounds = [linkedRound({ id: 'rnd_1', status: 'active' })];
  const viewRuns = [run({ status: 'running' })];
  const viewItems = [item('succeeded'), item('succeeded', 1), item('requesting', 2)];
  // 补取到的是一份**旧**快照（出图还没开始时抓的）。
  const staleLinked = new Map([['rnd_1', { round: linkedRound({ id: 'rnd_1', status: 'active' }), latestRun: null, tally: null }]]);
  const p = requestProgress(req, { rounds: viewRounds, runs: viewRuns, runItems: viewItems, linked: staleLinked });
  assert.equal(p.stage, 'generating');
  assert.match(p.label, /2 \/ 3/, '必须用视图里的新数据，不能被补取的旧快照盖住（实测卡在「出图中 0 / 3」）');
  // 视图里没有这一批时，才用补取的数据。
  const p2 = requestProgress(req, { rounds: [], runs: [], runItems: [], linked: new Map([['rnd_1', { round: linkedRound({ id: 'rnd_1', status: 'active' }), latestRun: run({ status: 'running' }), tally: { succeeded: 1, requesting: 2 } }]]) });
  assert.equal(p2.stage, 'generating');
  assert.match(p2.label, /1 \/ 3/, '视图之外才用补取数据');
});

test('⚠️ 视图里的 runs 未必覆盖这一批——不能据此断定「没有运行」', async () => {
  const { requestProgress } = await model();
  // 场景：停在「生成历史」视图上，`runs` 只装了当前那一批；卡片上这条请求指向**另一批**。
  const req = { id: 'req_1', status: 'accepted', resultRoundId: 'rnd_done' };
  const otherRound = { id: 'rnd_other', taskId: 't', status: 'active', plan: {}, planVersion: 1 };
  const doneRound = { id: 'rnd_done', taskId: 't', status: 'completed', plan: { requestId: 'req_1' }, planVersion: 2 };
  const linked = new Map([['rnd_done', {
    round: doneRound,
    latestRun: { id: 'run_x', roundId: 'rnd_done', status: 'completed', createdAt: '2026-09-18T00:00:00.000Z' },
    tally: { succeeded: 3 }
  }]]);
  const p = requestProgress(req, { rounds: [otherRound, doneRound], runs: [], runItems: [], linked });
  assert.equal(p.stage, 'done', '视图里没有这一批的运行，必须退回补取，而不是说「正在准备出图」');
  assert.match(p.label, /3 张/, '张数要来自服务端的精确计数');
  // 反向：视图里**有**运行时，视图优先（事件驱动，最新）。
  const active = requestProgress(
    { id: 'req_2', status: 'accepted', resultRoundId: 'rnd_live' },
    { rounds: [{ id: 'rnd_live', taskId: 't', status: 'active', plan: { requestId: 'req_2' }, planVersion: 1 }],
      runs: [{ id: 'run_live', roundId: 'rnd_live', status: 'running', createdAt: '2026-09-18T01:00:00.000Z' }],
      runItems: [{ id: 'i1', runId: 'run_live', status: 'succeeded' }],
      linked: new Map([['rnd_live', { round: { id: 'rnd_live', taskId: 't', status: 'active', plan: {}, planVersion: 1 }, latestRun: null, tally: null }]]) }
  );
  assert.equal(active.stage, 'generating', '视图里有运行就用视图的');
  assert.match(active.label, /1 \//, '进度按视图里的运行项算');
});

test('关联靠 plan.requestId 外键；一个请求出多批时按「权威指向 → 在跑 → 最新运行 → 最新批次」挑', async () => {
  const { roundForRequest } = await model();
  const rounds = [
    linkedRound({ id: 'rnd_1', plan: { requestId: 'req_1' }, createdAt: '2026-09-01T00:00:00.000Z' }),
    linkedRound({ id: 'rnd_2', plan: { requestId: 'req_1' }, createdAt: '2026-09-02T00:00:00.000Z' }),
    linkedRound({ id: 'rnd_other', plan: { requestId: 'req_2' } })
  ];
  assert.equal(roundForRequest({ id: 'req_3' }, rounds), null);
  assert.equal(roundForRequest({ id: 'req_1' }, []), null);
  // ① 服务端写下的权威指向优先
  assert.equal(roundForRequest({ id: 'req_1', resultRoundId: 'rnd_1' }, rounds, []).id, 'rnd_1');
  // ② 有运行在跑的那一批优先（哪怕它不是最新创建的）
  const runs = [
    { id: 'run_a', roundId: 'rnd_1', status: 'running', createdAt: '2026-09-03T00:00:00.000Z' },
    { id: 'run_b', roundId: 'rnd_2', status: 'completed', createdAt: '2026-09-04T00:00:00.000Z' }
  ];
  assert.equal(roundForRequest({ id: 'req_1' }, rounds, runs).id, 'rnd_1');
  // ③ 没有在跑的：取运行最新的那一批
  assert.equal(roundForRequest({ id: 'req_1' }, rounds, [{ id: 'run_b', roundId: 'rnd_2', status: 'completed', createdAt: '2026-09-04T00:00:00.000Z' }]).id, 'rnd_2');
  // ④ 都没有运行：取最近创建的批次
  assert.equal(roundForRequest({ id: 'req_1' }, rounds, []).id, 'rnd_2');
});

test('结单且带回复、又没有权威指向时：卡片只报「已完成」，不叠自相矛盾的批次进度', async () => {
  const { requestProgress } = await model();
  const rounds = [
    linkedRound({ id: 'rnd_done', plan: { requestId: 'req_multi' }, status: 'active' }),
    linkedRound({ id: 'rnd_norun', plan: { requestId: 'req_multi' }, status: 'active' })
  ];
  // 没有任何运行被加载 → 旧实现会挑到 rnd_norun 并显示「已确认 · 正在准备出图」
  const progress = requestProgress(
    { id: 'req_multi', status: 'done', resultRoundId: null, resultJson: JSON.stringify({ reply: '三张变种已出齐。' }) },
    { rounds, runs: [], runItems: [] }
  );
  assert.equal(progress.stage, 'ended', '带回复的结单请求不再显示批次进度：' + JSON.stringify(progress));
  assert.equal(progress.roundId, null);
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
  // 第 4 批 Q1：入口从「去确认计划」改成回执上的「就这么出」，并多一个「改一下」。
  assert.match(dock, /就这么出/, '回执上的确认入口要说得出口');
  assert.match(dock, /改一下/, '「改一下」必须和「就这么出」成对出现（否则回执只能接受或放弃）');
  assert.match(main, /progressForRequest/, 'main 必须把进度算出来传给卡片');
  assert.match(main, /onOpenRound=\{openRoundFromQueue\}/, '「就这么出 / 看这一批」必须接上');
  assert.match(main, /onEditPlan=\{openRoundPlanEdit\}/, '「改一下」必须接上真实的计划编辑入口');
  assert.match(main, /openRoundFromQueue/, '必须有「从队列定位批次」的实现');
  // 进度必须由已有事实算（禁止前端累加影子进度）；
  // 批次/运行/槽位取自「当前视图 + 按 id 补取」——补取是为了全局底栏也能算对。
  assert.match(main, /requestProgress\(request, \{[^}]*rounds, runs, runItems: lineageRunItems, linked: linkedProgress[^}]*\}\)/, '进度必须拿视图自己的 rounds + 补取，才能判断该信哪一份');
  assert.match(main, /roundsForQueue/, '缺的关联批次要按 id 补取（全局底栏拿不到当前视图之外的数据）');
  assert.doesNotMatch(main, /requestProgress\(request, \{[^}]*rounds: roundsForQueue/, '不能把合并后的列表当视图数据传（会让补取快照永不生效）');
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

test('提交不了永远要有一句话：确认入口不许静默返回', async () => {
  const main = readSource('web/src/main.jsx');
  const block = main.slice(main.indexOf('const openGenerationConfirmation'), main.indexOf('const dismissGenerationConfirmation'));
  // 原来这里是 `if (!targetRound || targetRound.status !== 'awaiting_confirmation') return;`
  // ——点了毫无反应，用户只能猜。现在每一条出口都要给反馈。
  assert.doesNotMatch(block, /status !== 'awaiting_confirmation'\)\s*return;/, '不许静默 return');
  assert.match(block, /setNotice\('请先选择要确认的批次。'\)/, '没选批次要说');
  // 第 4 批 Q1：状态不符的理由收进单一来源，界面负责说出来。
  assert.match(block, /setNotice\(closedEntry\.reason\)/, '状态不符也要把理由说出来');
  const { confirmationEntry } = await import('../../web/src/confirmation-entry-model.mjs');
  assert.match(confirmationEntry({ hasChallenge: true, roundStatus: 'active' }).reason, /已经确认过了/, '已确认要说');
  assert.match(confirmationEntry({ hasChallenge: true, roundStatus: 'draft' }).reason, /草稿|计划/, '没有计划要说');
});
