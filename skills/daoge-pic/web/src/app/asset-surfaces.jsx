import { useState } from 'react';
import { Bookmark, Check, ChevronLeft, ChevronRight, Copy, Download, Ellipsis, Eye, GitFork, MessageSquareText, RotateCcw, Share2, Trash2, X } from 'lucide-react';
import { assetThumbnailUrl } from '../asset-media-url.mjs';
import { IconButton } from '../components/IconButton.jsx';

/** 资产面（界面批 E 搬运，行为零变化）：卡片 / 已选条 / 分页。 */
export function ListPager({ page, totalPages, total, onPageChange }) {
  if (totalPages <= 1) return <span className="workspace-list-total">共 {total} 项</span>;
  return <nav className="workspace-list-pager" aria-label="列表分页"><button type="button" className="outline-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={14} />上一页</button><span>第 {page} / {totalPages} 页 · 共 {total} 项</span><button type="button" className="outline-button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页<ChevronRight size={14} /></button></nav>;
}

export function AssetCard({ asset, selected, selectionBusy, shared, previewFit = 'contain', onToggleSelect, onReview, onTrash, onRestore, onPreview, onInspect, onDownload, onCopy, onSetShared }) {
  const [annotating, setAnnotating] = useState(false);
  const [note, setNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const saveNote = () => {
    if (!note.trim()) return;
    onReview(asset.id, 'review', { note: note.trim() });
    setNote('');
    setAnnotating(false);
  };
  const runMenuAction = (callback) => {
    callback();
    setMenuOpen(false);
  };
  const assetLabel = asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材');
  const roundLabel = asset.display?.roundSequence ? (({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[asset.display.roundPurpose] || '创作') + ' · 第 ' + asset.display.roundSequence + ' 轮' : null;
  const contextLabel = asset.display?.taskName && roundLabel ? asset.display.taskName + ' · ' + roundLabel : asset.display?.taskName || roundLabel;
  const stateLabel = asset.deletedAt ? '回收站' : asset.review?.decision === 'keep' ? '已选成果' : asset.review?.decision === 'review' ? '未定' : asset.review?.decision === 'reject' ? '不采用' : asset.review?.decision === 'derive' ? '可继续' : selected ? '已选' : '未评审';
  return <article className={'asset-card is-preview-' + previewFit + ' ' + (asset.deletedAt ? 'is-trashed ' : '') + (selected ? 'is-selected' : '')}>
    <div className="asset-preview">
      {asset.deletedAt ? <div className="trash-preview"><Trash2 size={24} strokeWidth={1.4} /></div> : <button type="button" className="asset-preview-button" onClick={() => onPreview([asset])} aria-label="放大查看素材"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button>}
      {!asset.deletedAt && <label className="asset-select-control"><input type="checkbox" checked={selected} disabled={selectionBusy} onChange={() => onToggleSelect(asset)} /><span><Bookmark size={13} fill={selected ? 'currentColor' : 'none'} />{selected ? '已选成果' : '选为成果'}</span></label>}
      <div className="asset-card-tools"><IconButton label={menuOpen ? '关闭更多操作' : '更多操作'} onClick={() => setMenuOpen((value) => !value)}><Ellipsis size={17} /></IconButton></div>
    </div>
    {menuOpen && <div className="asset-action-menu">{asset.deletedAt ? <button type="button" onClick={() => runMenuAction(() => onRestore(asset.id))}><RotateCcw size={15} /><span>恢复资产</span></button> : <>
      
      <section className="asset-action-section"><p className="asset-action-label">获取图片</p><div><button type="button" onClick={() => runMenuAction(() => onPreview([asset]))}><Eye size={15} /><span>放大查看</span></button><button type="button" onClick={() => runMenuAction(() => onCopy(asset))}><Copy size={15} /><span>复制图片</span></button><button type="button" aria-label="下载原图" onClick={() => runMenuAction(() => onDownload(asset))}><Download size={15} /><span>下载原图</span></button></div></section>
      <section className="asset-action-section"><p className="asset-action-label">管理</p><div><button type="button" onClick={() => { setAnnotating(true); setMenuOpen(false); }}><MessageSquareText size={15} /><span>批注</span></button><button type="button" onClick={() => runMenuAction(() => onSetShared(asset, !shared))}><Share2 size={15} /><span>{shared ? '取消共享' : '共享素材'}</span></button><button type="button" onClick={() => runMenuAction(() => onInspect(asset.id))}><GitFork size={15} /><span>查看来源</span></button><button type="button" className="danger" role="menuitem" onClick={() => runMenuAction(() => onTrash(asset.id))}><Trash2 size={15} /><span>移入回收站</span></button></div></section>
    </>}</div>}
    <div className="asset-meta"><div><strong>{assetLabel}</strong><span className="asset-state">{stateLabel}</span></div>{contextLabel && <span className="asset-context-line" title={contextLabel}>{contextLabel}</span>}</div>
    {annotating && <div className="annotation-editor"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录本轮反馈" aria-label="本轮反馈批注" /><button type="button" className="outline-button" disabled={!note.trim()} onClick={saveNote}>保存批注</button></div>}
  </article>;
}

export function AssetSelectionStrip({ assets, deliverIntent = null, onRemove, onClear, onPreview, onDownloadArchive, onDeliver }) {
  return <section className="selection-strip">
    <header><div><p className="eyebrow">已选图片</p><h2>{String(assets.length).padStart(2, '0')} 张</h2></div>{assets.length > 0 && <div className="selection-strip-actions"><button type="button" className="outline-button" title="放大查看；挑图在创作平台" onClick={() => onPreview(assets)}><Eye size={15} />放大查看</button><button type="button" className="outline-button" disabled={deliverIntent ? !deliverIntent.canStart : false} title={deliverIntent?.copy || ''} onClick={onDeliver}><Check size={15} />去交付</button><button type="button" className="outline-button" onClick={onDownloadArchive}><Download size={15} />打包下载 {assets.length} 张</button><IconButton label="清空当前选片" onClick={onClear}><X size={15} /></IconButton></div>}</header>
    {assets.length ? <div className="selection-strip-items">{assets.map((asset) => <article className="selection-item" key={asset.id}><button type="button" className="selection-preview" onClick={() => onPreview([asset])} aria-label="放大查看已选图片"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div className="selection-item-copy"><strong title={asset.display?.label || '已选素材'}>{asset.display?.label || '已选素材'}</strong><span>{asset.review?.decision === 'keep' ? '已保留' : asset.review?.decision === 'review' ? '待复核' : asset.review?.decision === 'derive' ? '衍生方向' : asset.review?.decision === 'reject' ? '不采用' : '尚未评审'}</span></div><button type="button" className="selection-remove" title="移出当前选片" aria-label="移出当前选片" onClick={() => onRemove(asset.id)}><X size={13} /></button></article>)}</div> : <div className="selection-strip-empty"><Bookmark size={18} /><span>当前没有已选图片</span></div>}
  </section>;
}
