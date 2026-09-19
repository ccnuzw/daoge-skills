/**
 * 「照它再来」的路径判定（方案 4.3 / 4.8-4 · 施工单 G3 · 决策 D1）。
 *
 * 编制施工单时核出两条并存路径：选片条 / 资产卡的 `openDerivedRoundDialog`（本地建草稿，能用）
 * 与节点菜单的 `canDerive: false`（禁用）。D1 拍板走**本地草稿**——
 * 方案 4.3 的原话：「复制出来的应该是**草稿，不是执行命令**」。
 *
 * 所以这个模块的职责是**只认一条路**：任何「照它再来」都走本地草稿，
 * 不再有「经队列派 agent」的第二套说法。
 */
export const DERIVE_PATH = 'draft';

/** 图与批次有「再来一批」的语义；任务这类结构节点没有。 */
export function deriveAvailability(node) {
  const entityType = node?.entityType;
  if (entityType === 'asset' || entityType === 'round') return { available: true, path: DERIVE_PATH };
  return { available: false, path: null };
}