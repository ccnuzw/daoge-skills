// 批次质量的摘要（方案 7.10.2：质量指标跟着「看的东西」走）。
//
// 项目级的指标面板留在 project-overview（**能力只加强不删**）——
// 这里补的是另一份：人在画布上选中一个批次时，检查器直接给出**这一批**的质量，
// 不用去总览翻一张项目级的大表。
//
// 统计口径与画布原有的 reviewDecisionCounts 一致（同一套决策键 + 回收站优先），
// 只是把它收进模型，成为唯一来源——canvas 那份改为委托，两份口径就不会漂移。

/**
 * 评审分布。口径：`deletedAt` 优先（进了回收站就不看它的评审），其余按 `review.decision`，
 * 没有决策的算 `unreviewed`。
 * @param {any[]} [assets]
 * @returns {{ keep: number, review: number, reject: number, derive: number, unreviewed: number, trash: number }}
 */
export function reviewDistribution(assets) {
  return (Array.isArray(assets) ? assets : []).reduce((acc, asset) => {
    const key = asset?.deletedAt ? 'trash' : asset?.review?.decision || 'unreviewed';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { keep: 0, review: 0, reject: 0, derive: 0, unreviewed: 0, trash: 0 });
}

/**
 * 质量摘要的人话。只说有的，不说零；「待复核」与「未评审」合并成「还没定」——
 * 用户此刻只关心还有多少没处理，不关心系统里的细分。
 * @param {{ keep?: number, review?: number, reject?: number, derive?: number, unreviewed?: number, trash?: number }} [dist]
 * @param {number} [produced]
 */
export function batchQualityCopy(dist = {}, produced = 0) {
  const parts = [];
  if (Number(produced) > 0) parts.push(Number(produced) + ' 张图');
  if (Number(dist.keep) > 0) parts.push(Number(dist.keep) + ' 张已选定');
  if (Number(dist.reject) > 0) parts.push(Number(dist.reject) + ' 张不采用');
  if (Number(dist.derive) > 0) parts.push(Number(dist.derive) + ' 张可继续');
  const pending = Number(dist.review || 0) + Number(dist.unreviewed || 0);
  if (pending > 0) parts.push(pending + ' 张还没定');
  return parts.join(' · ');
}
