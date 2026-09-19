/**
 * 圈选发起的上下文拼装（方案 4.3 第四刀 / 4.5 · 施工单 G1）。纯函数，可单测。
 *
 * 「编排 = 选中 + 说一句」：在画布上圈住的图，和「选片」（评审 keep 的关系）是**两回事**，
 * 但都该成为这一句话的指代对象。所以这里把两条来源合并成请求上下文的 `assetIds`：
 * **画布圈选在前**（用户此刻的显式指向），选片补齐，去重，过滤脏值。
 *
 * 边界（红线 2.1）：这只影响「这句话指哪些图」，**不持久化任何选中态**——
 * 评审关系仍住在 `review_decisions` / 项目选片里。
 */
export function requestContextAssetIds(input = {}) {
  const clean = (values) => (Array.isArray(values) ? values : []).filter((value) => typeof value === 'string' && value.length > 0);
  const seen = new Set();
  const result = [];
  for (const id of [...clean(input.canvasAssetIds), ...clean(input.selectedAssetIds)]) {
    if (!seen.has(id)) { seen.add(id); result.push(id); }
  }
  return result;
}