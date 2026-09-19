/**
 * 底部槽模型（界面批 C · C4 / S1）。
 *
 * 一条硬规矩：**底部槽空闲 48px，展开不超过 min(320px, 35% 视口高)**——
 * 因为主区占比 = (视口高 − 顶部 chrome − 底栏) / 视口高，底栏的每一像素都从画布身上拿。
 *
 * 三态：
 *   - `folded`  常态：只有 composer 一行（48px）；
 *   - `expanded`用户点开记录，或有需要回话的卡片（S7：追问不折叠）；
 *   - `exclusive`选片/放大时：展开层收起（I1），composer 仍在。
 *
 * `height` 说的是**展开层（记录体）**的高度上限；底栏整体 = 空闲 48 + 提醒行（S7，有才占）+ 展开层。
 * 提醒行不折叠是刻意的：它是「少而必要」的，所以预算算在展开层上，不算在提醒头上。
 */
export const QUEUE_IDLE_PX = 48;
export const QUEUE_MAX_PX = 320;
export const QUEUE_MAX_RATIO = 0.35;

/**
 * @param {{ queue?: 'folded'|'expanded', viewportHeight?: number, selecting?: boolean }} input
 * @returns {{ state:'folded'|'expanded'|'exclusive', height:number, canExpand:boolean }}
 */
export function bottomSlotPlan({ queue = 'folded', viewportHeight, selecting = false } = {}) {
  const viewport = Number(viewportHeight);
  if (!Number.isFinite(viewport) || viewport <= 0) throw new Error('视口高不合法：' + String(viewportHeight));
  if (selecting) return { state: 'exclusive', height: QUEUE_IDLE_PX, canExpand: false };
  const state = queue === 'expanded' ? 'expanded' : 'folded';
  return { state, height: state === 'expanded' ? Math.min(QUEUE_MAX_PX, Math.round(viewport * QUEUE_MAX_RATIO)) : QUEUE_IDLE_PX, canExpand: true };
}
