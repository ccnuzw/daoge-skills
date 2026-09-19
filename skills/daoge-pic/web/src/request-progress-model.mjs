import { failureAttribution } from './failure-copy-model.mjs';

/**
 * 一条请求「现在到哪一步了」——纯函数，只从**已有事实**推导。
 *
 * 判据（方案第 2 节）：用户不关心内部表，只关心「现在到哪一步、要不要我动手」。
 * 所以这里**不新增任何状态**，全部由三种现成事实算出来：
 *   ① 请求自己的状态（`studio_requests.status`）
 *   ② 它关联的批次（`round.plan.requestId === request.id`，B5 建的现成外键）
 *   ③ 那个批次的运行与出图槽位（`generation_runs` / `run_items`）
 *
 * 这也满足红线「前端不造影子状态」：进度是**算出来**的，不是前端累加出来的。
 */

const MADE_STATUSES = new Set(['succeeded']);
// ⚠️ `outcome_unknown` **不是失败**（方案 4.10）：请求发出去了但没收到结果，
// 既可能是出了没记上、也可能是真没出。把它算进「没成」会让人以为系统不稳，
// 而它真正要的是「去核实一次」。所以它单列。
const FAILED_STATUSES = new Set(['failed']);
const BLOCKED_STATUSES = new Set(['blocked']);
const UNKNOWN_STATUSES = new Set(['outcome_unknown']);
const IN_FLIGHTITEM_STATUSES = new Set(['pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'cancel_requested']);

/**
 * 队列要看的批次 = **当前视图的批次** + **按 id 补取的批次**。
 *
 * ⚠️ 同一批次可能两边都有（比如你就停在这条请求关联的项目里）：这时
 * **当前视图的事实更新，必须覆盖补取回来的旧快照**。
 * 否则用户在闸门点了确认、后端已 `active`，卡片却还拿着补取时的
 * `awaiting_confirmation` 一直说「待你确认」，直到整页刷新（React 状态清空）才恢复——
 * 实测缺陷。合并规则因此是「后写的赢」，且 `rounds` 写在后面。
 */
export function queueRounds(rounds = [], linked = null) {
  const byId = new Map();
  const entries = linked ? (typeof linked.values === 'function' ? [...linked.values()] : Object.values(linked)) : [];
  for (const entry of entries) if (entry?.round?.id) byId.set(entry.round.id, entry.round);
  for (const round of (Array.isArray(rounds) ? rounds : [])) if (round?.id) byId.set(round.id, round);
  return [...byId.values()];
}

/** 运行还在进行中的状态（用来判断「此刻在跑的是哪一批」）。 */
const IN_FLIGHT_RUN_STATUSES = new Set(['queued', 'running', 'pausing', 'paused', 'resume_pending', 'interrupted']);

function newestByRun(entries) {
  return [...entries].sort((a, b) => String(b.run?.createdAt || '').localeCompare(String(a.run?.createdAt || '')))[0];
}

/**
 * 请求关联的批次：计划里记着 requestId（**一个请求可以出多批**，B5）。
 *
 * ⚠️ 这里曾经取「匹配到的最后一个」——批次数组的顺序不由模型保证，等价于**任意挑一批**。
 * 实测后果：一个链了 4 批的请求（3/3 完成、1/1 完成、0/3 失败、0/3 失败）被挑到没有运行的那一批，
 * 卡片显示「已确认 · 正在准备出图」，**与它自己的回复「三张已出齐」自相矛盾**。
 *
 * 现在的判据（全部来自已有事实）：
 *   ① `resultRoundId`——服务端写下的**权威指向**，有就听它的；
 *   ② 有**在跑**的运行的那一批——用户此刻关心的就是它；
 *   ③ 否则取**运行最新**的那一批；
 *   ④ 都没有运行：取**最近创建**的批次。
 */
export function roundForRequest(request, rounds = [], runs = []) {
  if (!request?.id) return null;
  const matches = (Array.isArray(rounds) ? rounds : []).filter((round) => round?.plan?.requestId === request.id);
  if (!matches.length) return null;
  if (request.resultRoundId) {
    const named = matches.find((round) => round.id === request.resultRoundId);
    if (named) return named;
  }
  const decorated = matches.map((round) => ({ round, run: latestRunForRound(round.id, runs) }));
  const inFlight = decorated.filter((entry) => entry.run && IN_FLIGHT_RUN_STATUSES.has(String(entry.run.status || '')));
  if (inFlight.length) return newestByRun(inFlight).round;
  const withRun = decorated.filter((entry) => entry.run);
  if (withRun.length) return newestByRun(withRun).round;
  return [...matches].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0];
}

/** 该批次最近的运行（`runs` 已按创建时间倒序，这里再取一次最稳）。 */
export function latestRunForRound(roundId, runs = []) {
  if (!roundId) return null;
  const matches = (Array.isArray(runs) ? runs : []).filter((run) => run?.roundId === roundId);
  if (!matches.length) return null;
  return matches.reduce((latest, run) => (String(run.createdAt || '') > String(latest.createdAt || '') ? run : latest));
}

/** 某个运行的槽位计数（`items` 可能不全，缺了就退回「不知道几张」）。 */
export function runItemTally(runId, runItems = []) {
  const items = (Array.isArray(runItems) ? runItems : []).filter((item) => item?.runId === runId);
  let made = 0;
  let failed = 0;
  let blocked = 0;
  let unknown = 0;
  let inFlight = 0;
  for (const item of items) {
    if (MADE_STATUSES.has(item.status)) made += 1;
    else if (FAILED_STATUSES.has(item.status)) failed += 1;
    else if (BLOCKED_STATUSES.has(item.status)) blocked += 1;
    else if (UNKNOWN_STATUSES.has(item.status)) unknown += 1;
    else if (IN_FLIGHTITEM_STATUSES.has(item.status)) inFlight += 1;
  }
  return { total: items.length, made, failed, blocked, unknown, inFlight, notMade: failed + blocked + unknown };
}

/** 「几张出来了 / 几张没成 / 几张被挡 / 几张要核实」——分开说，因为下一步各不相同（4.10）。 */
function tallySummary(tally) {
  if (!tally) return '';
  const parts = [];
  if (tally.made > 0) parts.push(tally.made + ' 张出来了');
  if (tally.failed > 0) parts.push(tally.failed + ' 张没成');
  if (tally.blocked > 0) parts.push(tally.blocked + ' 张被挡');
  if (tally.unknown > 0) parts.push(tally.unknown + ' 张要核实出没出');
  return parts.join(' · ');
}

/**
 * 一条请求的阶段。返回 `{ stage, label, detail, roundId, canConfirm, canWatch }`。
 *
 * `canConfirm` 是这一项的要害：计划就绪时，**卡片本身**要能把你送进确认闸门，
 * 而不是让你去画布上找那个批次节点（它可能被模式/筛选藏起来）。
 */
/** 这条请求被领过几次——`attempts > 0` 说明**有人接过但没完成**，界面必须说出来。 */
function attemptNote(request) {
  const attempts = Number.isInteger(request?.attempts) ? request.attempts : 0;
  if (attempts <= 0) return '';
  return '已被领取 ' + attempts + ' 次但没完成';
}

/** 结单带回来的东西（回复 / 追问 / 产出批次）——解析失败一律当空。 */
function resultOutcome(request) {
  try {
    const parsed = JSON.parse(request?.resultJson || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

/** 非出图请求的回复文本（人话结果），没有就返回空串。 */
function replyText(request) {
  const reply = resultOutcome(request).reply;
  return typeof reply === 'string' ? reply.trim() : '';
}

/** 服务端给出的「一批 + 它最近的运行 + 槽位计数」——用于当前视图之外的那些批次。 */
function linkedProgressFor(request, linked) {
  const roundId = request?.resultRoundId;
  if (!roundId || !linked) return null;
  const entry = typeof linked.get === 'function' ? linked.get(roundId) : linked[roundId];
  return entry && entry.round ? entry : null;
}

/** 把服务端的 statusCounts 归成与 runItemTally 同形的计数。 */
function tallyFromCounts(counts) {
  if (!counts) return null;
  const value = (key) => Number(counts[key] || 0);
  const made = value('succeeded');
  const failed = value('failed');
  const blocked = value('blocked');
  const unknown = value('outcome_unknown');
  const inFlight = ['pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'cancel_requested'].reduce((sum, key) => sum + value(key), 0);
  return { total: made + failed + blocked + unknown + inFlight, made, failed, blocked, unknown, inFlight, notMade: failed + blocked + unknown };
}

/**
 * 回执（方案 4.1 · 施工单 Q1）：把「我准备这么出」摆成人话。
 *
 * 它是**唯一需要人核对的判断**的载体——「有没有上一批」（结构性判断，猜错代价高）；
 * 其余（几张、什么规格、改什么保持什么）都只是**可改**的默认值。
 * 所以这里说的话里**不出现那 5 个内部术语**，也不出现裸 id。
 */
export function receiptFor(input = {}) {
  const round = input.round || {};
  const plan = input.plan || round.plan || {};
  const parentRoundId = plan.parentRoundId || round.parentRoundId || null;
  const count = Number.isFinite(Number(plan.itemCount)) ? Number(plan.itemCount) : (Number.isFinite(Number(plan.targetCount)) ? Number(plan.targetCount) : null);
  const aspect = (plan.output && typeof plan.output === 'object' ? plan.output.aspectRatio : '') || plan.aspectRatio || '';
  const changes = Array.isArray(plan.variationAxes) ? plan.variationAxes : [];
  const goals = Array.isArray(plan.refinementGoals) ? plan.refinementGoals : [];
  const keeps = Array.isArray(plan.keepConstraints) ? plan.keepConstraints : [];
  const lines = [parentRoundId ? '在上一批的基础上继续' : '从零开始（没有上一批）'];
  const size = [];
  if (count) size.push('出 ' + count + ' 张');
  if (aspect) size.push(String(aspect));
  if (size.length) lines.push(size.join(' · '));
  const changed = [...changes, ...goals];
  if (changed.length || keeps.length) {
    const parts = [];
    if (changed.length) parts.push('改：' + changed.join('、'));
    if (keeps.length) parts.push('保持：' + keeps.join('、'));
    lines.push(parts.join('　　　'));
  }
  return { ready: Boolean(round.id || round.planVersion || plan.prompt || plan.itemCount), lines };
}

/**
 * 「有没有上一批」是**必答题**（方案 4.1）：可以给建议，但必须明示、可否决。
 * 猜错代价高——它是唯一结构性判断，所以不许静默推断。
 */
export function parentDecision(input = {}) {
  return {
    required: true,
    suggested: input.parentRoundId || input.suggestedParentId || null,
    revocable: true
  };
}

export function requestProgress(request, { rounds = [], runs = [], runItems = [], linked = null } = {}) {
  const status = String(request?.status || '');
  const attempts = attemptNote(request);
  // ⚠️ 优先用**当前视图**的数据，补取的只在「视图里没有这一批」时兜底。
  // 反过来（补取优先）会读到过期快照：实测出图已经出了 2 张，卡片还说「出图中 0 / 3」——
  // 因为那一份是首次补取时抓的，之后事件不断更新视图数据，它却一直没变。
  // 三个事实各自比新鲜度（见下方注释），所以补取的条目**始终可用**，不做一刀切的闸门。
  const linkedEntry = linkedProgressFor(request, linked);
  const round = roundForRequest(request, rounds, runs) || linkedEntry?.round || null;

  if (status === 'pending') {
    // ⚠️ 「等待接单」有两种完全不同的处境，界面必须分得开：
    //  ① 刚发出去，还没人看过；
    //  ② agent 接过、但没做完就没了（租约过期自动回队）——这时只显示「等待接单」，
    //     用户会以为压根没人理过，从而一直干等。
    return attempts
      ? { stage: 'requeued', label: '等待重新接单', detail: attempts + '（时间久了会自动回队）。', roundId: null, canConfirm: false, canWatch: false }
      : { stage: 'waiting', label: '等待接单', detail: '', roundId: null, canConfirm: false, canWatch: false };
  }
  if (status === 'failed') return { stage: 'stale', label: '多次超时未处理', detail: attempts ? attempts + '。' : '重新说一次，或唤起 agent。', roundId: null, canConfirm: false, canWatch: false };
  if (status === 'rejected') {
    // 撤回与「agent 说做不了」都是 rejected，但说法必须不同（一个是你自己的决定）。
    const withdrawn = resultOutcome(request).withdrawn === true;
    return { stage: 'ended', label: withdrawn ? '已撤回' : '无法处理', detail: '', roundId: null, canConfirm: false, canWatch: false };
  }
  // 结单且**带回复**的非出图请求：回复本身就是结果，不该再叠一条批次进度——
  // 一个请求可以链多批，硬挑一批就会和回复打架（实测：回复说「三张已出齐」，
  // 进度却说「正在准备出图」）。服务端没写 `resultRoundId` 时就更没有指向。
  if (status === 'done' && !round) return { stage: 'ended', label: '已完成', detail: '', roundId: null, canConfirm: false, canWatch: false };
  if (status === 'done' && !request?.resultRoundId && replyText(request)) return { stage: 'ended', label: '已完成', detail: '', roundId: null, canConfirm: false, canWatch: false };

  // 已接单（或已结单但仍关联着批次）：按批次的真实进展报状态。
  // 还在理解中：关联批次可能只是**还没取到**（全局底栏拿不到当前视图之外的数据）。
  // 请求表上的 `resultRoundId` 已经告诉我们「计划产出了哪一批」，所以先说这件事。
  if (!round) {
    if (request?.resultRoundId) return { stage: 'linked', label: '计划已写好 · 去看这一批', detail: '', roundId: request.resultRoundId, canConfirm: false, canWatch: true };
    return { stage: 'thinking', label: 'agent 正在理解…', detail: '还没有产出计划。', roundId: null, canConfirm: false, canWatch: false };
  }

  const roundId = round.id;
  // 新鲜度要**按事实**判断，不能按批次一刀切：
  //   - 批次状态：视图里有就用视图的（事件驱动，最新）；视图里没有才用补取。
  //   - 运行与槽位：视图**未必覆盖**这一批——比如停在「生成历史」视图时，
  //     `runs` 只装了当前那一批的运行。只在视图找不到运行时才退回补取，
  //     否则会把「另一批已出好的图」误报成「正在准备出图」（实测踩到）。
  //   - 槽位计数：补取的来自服务端的精确计数，优先用它（视图里的运行项可能是分页的）。
  const viewRun = latestRunForRound(roundId, runs);
  const run = viewRun || linkedEntry?.latestRun || null;
  const tally = linkedEntry?.tally
    ? tallyFromCounts(linkedEntry.tally)
    : (viewRun ? runItemTally(viewRun.id, runItems) : null);
  const base = { roundId, canConfirm: false, canWatch: true };

  if (round.status === 'awaiting_confirmation') {
    // 4.1：不给一个「去确认」的空按钮——把**回执**摆回来，人只需要核对那一句。
    return { ...base, stage: 'awaiting-confirmation', label: '计划已就绪 · 待你确认', detail: '确认后才会开始出图。', canConfirm: true, receipt: receiptFor({ request, round, plan: round.plan }) };
  }
  if (round.status === 'draft') {
    return { ...base, stage: 'drafting', label: 'agent 正在写计划…', detail: '', canConfirm: false };
  }
  if (round.status === 'archived') {
    return { ...base, stage: 'ended', label: '这一批已归档', detail: '', canConfirm: false };
  }

  // 已确认（active / completed）：看出图进行到哪。
  if (!run) return { ...base, stage: 'preparing', label: '已确认 · 正在准备出图', detail: '', canConfirm: false };

  const runStatus = String(run.status || '');
  if (['queued', 'running', 'pausing', 'paused', 'resume_pending', 'interrupted'].includes(runStatus)) {
    const progress = tally && tally.total > 0 ? tally.made + ' / ' + tally.total : '';
    return { ...base, stage: 'generating', label: '出图中' + (progress ? ' ' + progress : '…'), detail: runStatus === 'paused' ? '已暂停' : '', canConfirm: false };
  }
  if (runStatus === 'cancelled') return { ...base, stage: 'ended', label: '你取消了这一批', detail: '', canConfirm: false };
  if (runStatus === 'completed') {
    const count = tally?.total ? tally.total : null;
    return { ...base, stage: 'done', label: count ? '出好了 ' + count + ' 张' : '出图完成', detail: '可以去挑图了。', canConfirm: false };
  }
  // partial / failed / 其它终态：把「出来了 / 没成 / 被挡 / 要核实」分开说。
  const summary = tallySummary(tally);
  // 只有 outcome_unknown 时**不要说成失败**——那是「要你去核实」，不是「坏了」。
  const onlyUnknown = Boolean(tally) && tally.unknown > 0 && tally.failed === 0 && tally.blocked === 0;
  if (onlyUnknown) {
    return {
      ...base,
      stage: 'verify',
      label: summary || tally.unknown + ' 张要核实出没出',
      detail: failureAttribution({ status: 'outcome_unknown' }).advice,
      canConfirm: false
    };
  }
  return {
    ...base,
    stage: 'failed',
    label: summary || '出图没有成功',
    detail: tally?.made ? tally.made + ' 张已经出来了。' : '',
    canConfirm: false
  };
}
