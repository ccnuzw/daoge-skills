import { Check, FileCheck2, GitFork, PackageCheck, X } from 'lucide-react';

const ICONS = { unreviewed: FileCheck2, keep: Check, reject: X, derive: GitFork, delivery: PackageCheck };

export const ASSET_STATE_LEGEND_ITEMS = Object.freeze([
  { id: 'unreviewed', label: '未定', description: '尚未明确保留或不采用；可以继续评审，但不能进入交付。' },
  { id: 'keep', label: '成果 / keep', description: '已选为成果并写入 keep 评审；只有这类图片可创建交付草稿。' },
  { id: 'reject', label: '不采用', description: '记录淘汰原因；可转成反例或下一轮修正目标。' },
  { id: 'derive', label: '可继续', description: '适合作为父资产或参考；新方向必须创建新轮次。' },
  { id: 'delivery', label: '交付冻结', description: '交付从 keep 选片进入 draft → ready → exported；导出后不受源资产回收影响。' }
]);

export function AssetStateLegend({ title = '状态图例', compact = false, collapsed = false }) {
  const className = 'asset-state-legend ' + (compact ? 'is-compact ' : '') + (collapsed ? 'is-collapsed' : '');
  const items = ASSET_STATE_LEGEND_ITEMS.map((item) => { const Icon = ICONS[item.id] || FileCheck2; return <article key={item.id} className={'legend-' + item.id}><Icon size={14} /><b>{item.label}</b><span>{item.description}</span></article>; });
  if (collapsed) return <details className={className} aria-label={title}>
    <summary><FileCheck2 size={14} /><span>{title}</span></summary>
    <div className="asset-state-legend-panel">{items}</div>
  </details>;
  return <aside className={className} aria-label={title}>
    <header><p className="eyebrow">{title}</p><span>选片、评审和交付使用同一组创作者语义。</span></header>
    <div className="asset-state-legend-panel">{items}</div>
  </aside>;
}
