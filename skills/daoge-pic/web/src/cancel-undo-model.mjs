/**
 * 「取消运行」的 5 秒撤销窗口（方案开放项 #21 · 施工单收尾）。
 *
 * 取消失效是止损：**点了必须立刻生效**（规格书 §2.2 / DoD 4），所以这里
 * 不延迟取消，而是给一个 5 秒内可回头的窗口——撤销走请求队列（`intent: resume`），
 * 由 agent 判断这一批还在不在、能不能继续。花动作归 agent，与 4.9 一致。
 *
 * 纯函数：窗口的开始、剩余秒数、是否还能撤销，都能单测。
 */
export const CANCEL_UNDO_WINDOW_MS = 5000;

export function beginCancelUndo(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const windowMs = Number.isFinite(input.windowMs) ? Math.max(0, input.windowMs) : CANCEL_UNDO_WINDOW_MS;
  return { runId: input.runId ? String(input.runId) : '', startedAt: now, expiresAt: now + windowMs };
}

/** 剩余整秒（向上取整）；没有窗口或已过期都是 0。 */
export function cancelUndoRemainingSeconds(undo, now = Date.now()) {
  if (!undo || !Number.isFinite(undo.expiresAt)) return 0;
  const remaining = undo.expiresAt - now;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

export function cancelUndoAvailable(undo, now = Date.now()) {
  return Boolean(undo && cancelUndoRemainingSeconds(undo, now) > 0);
}

export function cancelUndoLabel(undo, now = Date.now()) {
  const seconds = cancelUndoRemainingSeconds(undo, now);
  return seconds > 0 ? '取消运行已生效 · ' + seconds + ' 秒内可撤销' : '';
}