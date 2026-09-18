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

/** 请求关联的批次：计划里记着 requestId（一个请求可以出多批，取最早那条）。 */
export function roundForRequest(request, rounds = []) {
  if (!request?.id) return null;
  const matches = (Array.isArray(rounds) ? rounds : []).filter((round) => round?.plan?.requestId === request.id);
  return matches.length ? matches[matches.length - 1] : null;
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

export function requestProgress(request, { rounds = [], runs = [], runItems = [], linked = null } = {}) {
  const status = String(request?.status || '');
  const attempts = attemptNote(request);
  // 优先用**按 id 补取的**批次事实（全局底栏拿不到当前视图之外的数据）。
  const fallback = linkedProgressFor(request, linked);
  const round = roundForRequest(request, rounds) || fallback?.round || null;

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
    const withdrawn = (() => { try { return JSON.parse(request?.resultJson || '{}')?.withdrawn === true; } catch { return false; } })();
    return { stage: 'ended', label: withdrawn ? '已撤回' : '无法处理', detail: '', roundId: null, canConfirm: false, canWatch: false };
  }
  if (status === 'done' && !round) return { stage: 'ended', label: '已完成', detail: '', roundId: null, canConfirm: false, canWatch: false };

  // 已接单（或已结单但仍关联着批次）：按批次的真实进展报状态。
  // 还在理解中：关联批次可能只是**还没取到**（全局底栏拿不到当前视图之外的数据）。
  // 请求表上的 `resultRoundId` 已经告诉我们「计划产出了哪一批」，所以先说这件事。
  if (!round) {
    if (request?.resultRoundId) return { stage: 'linked', label: '计划已写好 · 去看这一批', detail: '', roundId: request.resultRoundId, canConfirm: false, canWatch: true };
    return { stage: 'thinking', label: 'agent 正在理解…', detail: '还没有产出计划。', roundId: null, canConfirm: false, canWatch: false };
  }

  const roundId = round.id;
  // 补取来的批次自带 latestRun/tally；否则从当前视图的运行数据里算。
  const run = fallback?.round?.id === roundId ? fallback.latestRun || null : latestRunForRound(roundId, runs);
  const tally = fallback?.round?.id === roundId ? (fallback.tally ? tallyFromCounts(fallback.tally) : null) : (run ? runItemTally(run.id, runItems) : null);
  const base = { roundId, canConfirm: false, canWatch: true };

  if (round.status === 'awaiting_confirmation') {
    return { ...base, stage: 'awaiting-confirmation', label: '计划已就绪 · 待你确认', detail: '确认后才会开始出图。', canConfirm: true };
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
