// 挑图的键盘与缩放（方案 4.8）。
//
// 判据来自方案原话：「出一批 10 张，**有快捷键是 10 次按键，没有是 10 轮「点开—找—点」**」。
// 所以这里是纯逻辑——键位映射与缩放边界都不该藏在组件里，抽出来才能真跑单测。
//
// 一条重要的克制：**决策键（保留 / 不采用）只在有评审上下文的场合生效**。
// 从参考素材、拒绝原因等对话框打开预览时也看得见图，但那里没有「给这一批定去留」的语义——
// 让空格在那里也能改评审，才是真的会把用户搞糊涂。

export const REVIEW_ZOOM_MIN = 0.75;
export const REVIEW_ZOOM_MAX = 4;
export const REVIEW_ZOOM_STEP = 0.5;

/** 未知值一律回落到 1，并夹在上下限之间（浮点误差用两位小数抹平）。 */
export function clampReviewZoom(value) {
  const zoom = Number(value);
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(REVIEW_ZOOM_MAX, Math.max(REVIEW_ZOOM_MIN, Math.round(zoom * 100) / 100));
}

/** 缩放一步。direction > 0 放大，< 0 缩小。 */
export function reviewZoomStep(current, direction) {
  const base = clampReviewZoom(current);
  return clampReviewZoom(base + (direction >= 0 ? REVIEW_ZOOM_STEP : -REVIEW_ZOOM_STEP));
}

/**
 * 预览态的一次按键 → 一个动作。
 * @param {{ key?: string, index?: number, count?: number, canReview?: boolean }} [input]
 * @returns {{ action: 'prev'|'next'|'close'|'toggle-zoom'|'keep'|'reject'|'none', index?: number }}
 */
export function reviewKeyAction({ key, index = 0, count = 0, canReview = false } = {}) {
  const total = Number.isInteger(count) && count > 0 ? count : 0;
  const current = Number.isInteger(index) && index >= 0 ? Math.min(index, Math.max(0, total - 1)) : 0;
  switch (key) {
    case 'ArrowLeft':
      // 到边界就停住，不回绕——回绕会让人分不清"我到底看的是第几张"。
      return current > 0 ? { action: 'prev', index: current - 1 } : { action: 'none' };
    case 'ArrowRight':
      return current < total - 1 ? { action: 'next', index: current + 1 } : { action: 'none' };
    case 'Escape':
      return { action: 'close' };
    case 'Enter':
      return { action: 'toggle-zoom' };
    case ' ':
    case 'Spacebar':
      return canReview ? { action: 'keep' } : { action: 'none' };
    case 'x':
    case 'X':
      return canReview ? { action: 'reject' } : { action: 'none' };
    default:
      return { action: 'none' };
  }
}
