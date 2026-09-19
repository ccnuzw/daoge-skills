/**
 * 状态槽（界面方案 §4 S7 / §5.1 / 批 A A4）。纯函数，可单测。
 *
 * 判据：**同一时刻只渲染一条状态**；优先级写死在这里；其余折叠为「还有 N 条」。
 *
 * 「`danger` 永不折叠」是**结构性保证**而不是额外开关：
 * `runtime-danger` 在优先级表最前 → 只要它在，它就一定是被显示的那一条，
 * 根本轮不到折叠。其余低优先级进折叠区，**且折叠摘要必须点名**（不静默）。
 */
export const STATUS_PRIORITY = Object.freeze([
  'runtime-danger',
  'provider-outage',
  'connection-error',
  'request-error',
  'cancel-undo',
  'notice'
]);

/** 顺序即优先级：不在表里的（未知 tone）排最后，但仍会被显示/折叠，不会被丢掉。 */
function rank(tone) {
  const index = STATUS_PRIORITY.indexOf(tone);
  return index === -1 ? STATUS_PRIORITY.length : index;
}

/**
 * @param {Array<{ id: string, tone: string, label?: string, content?: any }>} [items]
 */
export function statusSlotPlan(items = []) {
  const list = (Array.isArray(items) ? items : []).filter((item) => item && item.id);
  if (!list.length) return { primary: null, overflow: [], overflowCount: 0, overflowLabel: '' };
  const sorted = [...list].sort((a, b) => rank(a.tone) - rank(b.tone));
  const [head, ...rest] = sorted;
  return {
    primary: { ...head, folded: false },
    overflow: rest,
    overflowCount: rest.length,
    overflowLabel: rest.map((item) => item.label || item.tone).join('、')
  };
}
