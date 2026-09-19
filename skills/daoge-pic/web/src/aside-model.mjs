/**
 * 右栏（Aside）模型（界面批 C · C3/C5）。
 *
 * 「一个右栏」是界面宪法批 C 的硬要求：批次、资产来源两种内容**互斥**渲染在同一容器里，
 * 无选中时不空白——顶部永远有这一批的四项指标。
 * 队列按 C4/S1 走底部槽（展开即底栏），**不是**右栏的一种内容。
 */
export const ASIDE_METRIC_KEYS = ['selected', 'undecided', 'reject', 'runs'];

/**
 * 谁在右栏里出现：显式打开（资产来源）> 选中节点 > 空态。
 * @param {{ explicit?: string|null, selectedNodes?: any[] }} input
 * @returns {{ kind:'asset'|'selection'|'empty', source:string }}
 */
export function asideSubject({ explicit = null, selectedNodes = [] } = {}) {
  if (explicit) return { kind: 'asset', source: explicit };
  if (Array.isArray(selectedNodes) && selectedNodes.length > 0) return { kind: 'selection', source: 'selectedNodes' };
  return { kind: 'empty', source: 'none' };
}

/**
 * 右栏顶部的四项指标——**只读既有事实源**（画布图数据 + 运行列表），不新增任何请求。
 * @param {{ graph?: any, runs?: any[], statusText?: (runs: any[]) => string }} input
 * @returns {{ key:string, className:string, value:number, label:string, title?:string }[]}
 */
export function asideMetrics({ graph, runs = [], statusText } = {}) {
  const metrics = graph?.metrics || {};
  const reviews = /** @type {Record<string, number>} */ (metrics.reviews || {});
  return [
    { key: 'selected', className: 'is-delivery', value: metrics.selected || reviews.keep || 0, label: '成果' },
    { key: 'undecided', className: 'is-unreviewed', value: (reviews.unreviewed || 0) + (reviews.review || 0), label: '未定' },
    { key: 'reject', className: 'is-reject', value: reviews.reject || 0, label: '不采用' },
    { key: 'runs', className: 'is-runs', value: runs.length, label: '运行', title: typeof statusText === 'function' ? statusText(runs) : undefined }
  ];
}
