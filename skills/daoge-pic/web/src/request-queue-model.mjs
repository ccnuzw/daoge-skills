/**
 * 请求队列的展示逻辑（方案 4.2 / 4.5 / 8.10）。纯函数、无副作用，所以能真跑单测。
 *
 * 队列接的是「用户说的话」，两种话都接：
 *   - 出图类：agent 写计划 → 用户确认 → 预检 → 出图（显示为「就绪」）；
 *   - 非出图类：agent 以对话回应，或需要追问（显示为「需要你」）。
 *
 * 界面只讲人话，不出现 pending / accepted 这类状态码。
 */

export const REQUEST_STATUS_LABELS = Object.freeze({
  pending: '等待接单',
  accepted: 'agent 正在理解…',
  done: '已完成',
  rejected: '无法处理',
  failed: '多次超时未处理'
});

export function requestStatusLabel(status) {
  return REQUEST_STATUS_LABELS[status] || '状态待确认';
}

/** 结单时带回的内容：回复、追问、产出的批次。 */
export function requestOutcome(request) {
  if (!request?.resultJson) return {};
  try {
    const parsed = JSON.parse(request.resultJson);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * 一张请求卡片的形态。四种（方案 4.5 的「就绪 / 需要你」+ 等待 / 结束）：
 *   - 等待接单：还没人接；
 *   - 处理中：agent 正在理解；
 *   - 需要你：agent 有话要说或要补信息（可就地回答）；
 *   - 就绪：计划已写好，等确认（去检查器看那一批）；
 *   - 结束：完成（带回应）/ 无法处理 / 已撤回。
 */
export function requestCardPresentation(request) {
  const outcome = requestOutcome(request);
  const status = request?.status;
  if (status === 'pending') return { kind: 'waiting', label: '等待接单', tone: 'quiet', canWithdraw: true, canAnswer: false };
  if (status === 'accepted') return { kind: 'working', label: 'agent 正在理解…', tone: 'live', canWithdraw: false, canAnswer: false };
  if (status === 'failed') return { kind: 'failed', label: '多次超时未处理', tone: 'danger', canWithdraw: false, canAnswer: false, text: '没人接这一条；可以重新说一次，或唤起 agent。' };
  if (status === 'rejected') {
    if (outcome.withdrawn === true) return { kind: 'withdrawn', label: '已撤回', tone: 'quiet', canWithdraw: false, canAnswer: false };
    return { kind: 'rejected', label: '无法处理', tone: 'quiet', canWithdraw: false, canAnswer: false, text: typeof outcome.reason === 'string' ? outcome.reason : '' };
  }
  // done
  if (typeof outcome.needsInput === 'string' && outcome.needsInput.trim()) return { kind: 'needs-input', label: '需要你', tone: 'warning', canWithdraw: false, canAnswer: true, question: outcome.needsInput.trim() };
  if (typeof outcome.reply === 'string' && outcome.reply.trim()) return { kind: 'reply', label: '已完成', tone: 'ready', canWithdraw: false, canAnswer: false, reply: outcome.reply.trim() };
  if (outcome.resultRoundId || request?.resultRoundId) return { kind: 'ready', label: '就绪 · 待确认', tone: 'ready', canWithdraw: false, canAnswer: false, roundId: outcome.resultRoundId || request.resultRoundId };
  return { kind: 'done', label: '已完成', tone: 'ready', canWithdraw: false, canAnswer: false };
}

/**
 * 离线/积压提示（8.10#1，B6）：等 2 分钟或积压 3 条，先到先触发。
 * 阈值做成参数，方便调整；`present === true` 时不提示（有 agent 在场就别催）。
 */
/**
 * 队列要不要催、催什么（8.10#1 的阈值 + 一个此前漏掉的情形）。
 *
 * 三种提示，因为**下一步动作完全不同**：
 *   - `backlog` / `waiting`：agent 不在场 → 要去**唤起**它；
 *   - `present-waiting`：agent 在场、但这单还没被接 → 要去**说一声**让它入场。
 *
 * ⚠️ `present-waiting` 是后来补的，它修的是一个真实困惑：
 * 「在场」只是 agent 的**登记**，不等于**有人正在消费队列**——队列是 agent
 * **入场时**才读的（方案 4.2 的「队列 + 低摩擦唤醒」）。
 * 缺了这条，用户会看到「agent 在场」和「还没人接」同时出现，而不知道该做什么。
 *
 * @param {{ requests?: any[], present?: boolean, now?: number, thresholdMs?: number, backlogThreshold?: number }} [input]
 */
export function queueAttention(input = {}) {
  const requests = Array.isArray(input.requests) ? input.requests : [];
  const present = input.present === true;
  const thresholdMs = Number.isFinite(input.thresholdMs) ? input.thresholdMs : 2 * 60 * 1000;
  const backlogThreshold = Number.isFinite(input.backlogThreshold) ? input.backlogThreshold : 3;
  const pending = requests.filter((request) => request?.status === 'pending');
  if (!pending.length) return { attention: false, reason: '', pendingCount: 0 };
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const oldest = pending.reduce((earliest, request) => {
    const at = Date.parse(request.createdAt);
    return Number.isFinite(at) && (earliest === null || at < earliest) ? at : earliest;
  }, null);
  const waitedTooLong = oldest !== null && now - oldest >= thresholdMs;
  const backlogged = pending.length >= backlogThreshold;
  // 这一条被领过、但没做完就回队了。**「还没人接」就说不通了**——
  // 不说清这件事，用户会以为压根没人理过（实测就是这种：attempts=1 却显示得像全新）。
  const wasAttempted = pending.some((request) => Number(request?.attempts) > 0);
  if (present) {
    // 在场但没人接：不说「不在场」（那是错的），说的是「去说一声」。
    return waitedTooLong || backlogged
      ? { attention: true, reason: 'present-waiting', pendingCount: pending.length }
      : { attention: false, reason: '', pendingCount: pending.length };
  }
  if (wasAttempted) return { attention: true, reason: 'requeued', pendingCount: pending.length };
  if (backlogged) return { attention: true, reason: 'backlog', pendingCount: pending.length };
  if (waitedTooLong) return { attention: true, reason: 'waiting', pendingCount: pending.length };
  return { attention: false, reason: '', pendingCount: pending.length };
}

/** 标题栏/入口上的未接单数：只数还在等的。 */
export function pendingRequestCount(requests) {
  return (Array.isArray(requests) ? requests : []).filter((request) => request?.status === 'pending').length;
}

/**
 * 发起请求时自带的上下文（方案 4.2：请求必须自带上下文，不依赖 session）。
 * 项目是容器，所以只有选了项目才允许发起（4.7）。
 */
export function requestContextFor(input = {}) {
  const projectId = input.projectId ? String(input.projectId) : '';
  const taskId = input.taskId ? String(input.taskId) : '';
  const roundId = input.roundId ? String(input.roundId) : '';
  const assetIds = [...new Set((Array.isArray(input.assetIds) ? input.assetIds : []).filter(Boolean).map(String))].slice(0, 200);
  const previousRequestId = input.previousRequestId ? String(input.previousRequestId) : null;
  // 界面上的「花动作」按钮（重试 / 恢复）把意图结构化地写进上下文：
  // agent 接单后据此精确执行，不必从一句话里猜是哪一次运行、哪几项。
  const intent = input.intent ? String(input.intent).trim().slice(0, 40) : '';
  const runId = input.runId ? String(input.runId) : '';
  const itemIds = [...new Set((Array.isArray(input.itemIds) ? input.itemIds : []).filter(Boolean).map(String))].slice(0, 200);
  return { projectId: projectId || null, taskId: taskId || null, roundId: roundId || null, previousRequestId, assetIds, intent: intent || null, runId: runId || null, itemIds, canSend: Boolean(projectId) };
}
