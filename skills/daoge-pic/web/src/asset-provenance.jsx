import { X } from 'lucide-react';

/**
 * 资产来源与评审记录（C3：**同一份内容两个家**——画布上是右栏，其它视图是浮层）。
 * 抽出来是为了「一个右栏」不再有两套说法：批次与资产共用同一个 Aside 容器。
 */
export function AssetProvenanceBody({ provenance, onClose, onOpenTrace }) {
  if (!provenance) return null;
  return <>
<div className="asset-inspector-head"><div><p className="eyebrow">资产检查器</p><h2>{provenance.asset?.kind === 'generated' ? '生成结果来源链' : '导入素材来源链'}</h2></div><button type="button" className="icon-button" aria-label="关闭资产来源" onClick={onClose}><X size={16} /></button></div><div className="asset-inspector-section"><span>来源</span><p>{provenance.asset?.kind === 'generated' ? '由已确认批次中的出图保存' : '导入到当前 Studio 的素材'}</p>{provenance.outputs?.map((output) => <button type="button" key={output.runItem.id} className="trace-link" onClick={() => { onOpenTrace?.(output); onClose?.(); }}><span>{output.project.name} / {output.task.name}</span><b>{output.round.purpose} · 出图 {output.runItem.sequence}</b></button>)}</div><div className="asset-inspector-section"><span>评审历史</span>{provenance.reviews?.length ? provenance.reviews.map((review) => <p key={review.id}><b>{review.decision === 'keep' ? '保留' : review.decision === 'review' ? '待复核' : review.decision === 'reject' ? '不采用' : '衍生方向'}</b> · {review.createdAt}</p>) : <p>尚未记录评审。</p>}</div><div className="asset-inspector-section"><span>交付引用</span>{provenance.deliveries?.length ? provenance.deliveries.map((delivery) => <p key={delivery.id}>{delivery.name} · {delivery.status}</p>) : <p>尚未加入交付草稿。</p>}</div><div className="asset-inspector-section"><span>批次版本</span>{provenance.deliveryBatches?.length ? provenance.deliveryBatches.map((batch) => <p key={batch.versionId}>{batch.name} · v{batch.versionNo} · {batch.status === 'ready' ? '已准备' : batch.status === 'draft' ? '草稿' : '已被新修订版本替代'}</p>) : <p>尚未加入版本化交付批次。</p>}</div>
  </>;
}
