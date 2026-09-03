import { useEffect, useState } from 'react';
import { Bookmark, Check, CheckSquare, Copy, Download, ImagePlus, PackageCheck, Pencil, RotateCcw, Square, X } from 'lucide-react';
import { deliveryCompletionPresentation } from './creator-delivery-model.mjs';
import { assetThumbnailUrl, deliveryThumbnailUrl } from './asset-media-url.mjs';

function deliveryFileUrl(deliveryId, sequence, download = false) { return '/api/deliveries/' + encodeURIComponent(deliveryId) + '/files/' + encodeURIComponent(sequence) + (download ? '?download=1' : ''); }
function archiveKey(asset) { return String(asset.archiveKey || asset.id); }
function deliveryState(status) { return status === 'draft' ? { label: '还可调整', body: '图片还没有被最终确认，可以替换为当前选片。' } : status === 'ready' ? { label: '等待导出', body: '这批图片已经确认，生成交付文件后即可领取。' } : { label: '已完成', body: '图片已经生成独立交付副本，可继续下载、复制或打包。' }; }
function selectionCopy(selection) {
  if (selection.state === 'ready') return { title: selection.eligibleAssets.length + ' 张图片已准备好', body: '创建草稿后会冻结名称与选片，再逐步准备和导出，不会重复创建。' };
  if (selection.state === 'needs_review') return { title: '先确认要留下的图片', body: '选片中有图片还没有标记为保留。回到项目资产，留下要交付的画面即可。' };
  if (selection.state === 'needs_project') return { title: '先打开一个项目', body: '交付会保存在项目中，方便以后继续查看和获取图片。' };
  return { title: '先挑选要交付的图片', body: '在项目资产里通过缩略图选择想留下的画面。' };
}

function DeliveryAssetGrid({ title, hint, assets, onDownload, onCopy, onRemove, emptyAction, onArchive, disabled = false }) {
  const assetKeys = assets.map(archiveKey).join('|');
  const [chosen, setChosen] = useState([]);
  useEffect(() => { setChosen(assets.map(archiveKey)); }, [assetKeys]);
  const chosenSet = new Set(chosen);
  const selected = assets.filter((asset) => chosenSet.has(archiveKey(asset)));
  const allChosen = assets.length > 0 && selected.length === assets.length;
  const toggle = (asset) => {
    if (disabled) return;
    setChosen((current) => current.includes(archiveKey(asset)) ? current.filter((key) => key !== archiveKey(asset)) : [...current, archiveKey(asset)]);
  };
  const chooseAll = () => {
    if (disabled) return;
    setChosen(allChosen ? [] : assets.map(archiveKey));
  };
  return <section className="creator-delivery-assets" aria-busy={disabled}>
    <header><div><p className="eyebrow">{title}</p><h3>{assets.length ? assets.length + ' 张图片' : '还没有图片'}</h3><span>{hint}</span></div>{assets.length ? <div className="creator-delivery-archive-actions">{onArchive && <><button type="button" className="outline-button" disabled={disabled || !selected.length} onClick={() => onArchive(selected)}><Download size={15} />打包下载 {selected.length} 张</button><button type="button" className="outline-button" disabled={disabled} onClick={chooseAll}>{allChosen ? <CheckSquare size={16} /> : <Square size={16} />}{allChosen ? '取消全选' : '全选全部 ' + assets.length + ' 张'}</button></>}{emptyAction}</div> : emptyAction}</header>
    {assets.length ? <div className="creator-delivery-asset-grid">{assets.map((asset) => <article key={archiveKey(asset)} className={chosenSet.has(archiveKey(asset)) ? 'is-archive-selected' : ''}><img src={asset.thumbnailUrl || assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /><label className="creator-asset-archive-select" title="加入打包下载"><input type="checkbox" disabled={disabled} checked={chosenSet.has(archiveKey(asset))} onChange={() => toggle(asset)} /><span>{chosenSet.has(archiveKey(asset)) ? <CheckSquare size={15} /> : <Square size={15} />}</span></label><div><strong>{asset.display?.label || '交付图片'}</strong><span>{asset.review?.decision === 'keep' ? '已保留' : '已完成交付'}</span></div><div className="creator-asset-actions"><button type="button" disabled={disabled} title="下载原图" aria-label="下载原图" onClick={() => onDownload(asset)}><Download size={16} /></button><button type="button" disabled={disabled} title="复制图片" aria-label="复制图片" onClick={() => void onCopy(asset)}><Copy size={16} /></button>{onRemove && <button type="button" disabled={disabled} title="移出这批图片" aria-label="移出这批图片" onClick={() => onRemove(asset)}><X size={16} /></button>}</div></article>)}</div> : <div className="creator-delivery-empty"><ImagePlus size={24} strokeWidth={1.2} /><span>从项目资产选择并保留图片后，会出现在这里。</span></div>}
  </section>;
}

function CreatorDeliveryFlow({ project, selection, deliveryName, deliveryCreating, completion, frozen, onDeliveryNameChange, onCreate, onOpenAssets }) {
  const status = selectionCopy(selection);
  const phase = deliveryCompletionPresentation(completion, deliveryCreating);
  const locked = frozen || deliveryCreating;
  const ready = selection.state === 'ready' || phase.frozen;
  const selectedCount = completion?.assetIds?.length || selection.selectedAssets.length;
  const effectiveName = phase.frozen ? completion.name : deliveryName;
  return <section className="creator-delivery-flow" aria-busy={deliveryCreating}><header><div><p className="eyebrow">{project?.name || '项目交付'}</p><h2>把选好的图片交给下一位使用者</h2><p>按草稿、准备、导出三个阶段完成交付；失败会保留当前阶段，可安全重试。</p></div></header><ol><li className={selectedCount ? 'is-done' : 'is-current'}><span>1</span><div><b>挑选图片</b><small>{selectedCount ? '已选 ' + selectedCount + ' 张' : '尚未选择'}</small></div><button type="button" className="outline-button" disabled={locked} onClick={onOpenAssets}><Bookmark size={15} />查看图片</button></li><li className={phase.step === 1 || phase.step === 2 ? 'is-current' : phase.step > 2 ? 'is-done' : ''}><span>2</span><div><b>冻结交付</b><small>{phase.step === 1 ? '创建唯一草稿' : phase.step === 2 ? '准备交付' : '已准备'}</small></div></li><li className={phase.step >= 3 ? 'is-current' : ''}><span>3</span><div><b>领取图片</b><small>{phase.complete ? '导出已完成' : '导出、下载或打包'}</small></div></li></ol><section className={'creator-delivery-create ' + (ready ? 'is-ready' : '')}><div><h3>{phase.frozen ? completion.name : status.title}</h3><p>{phase.frozen ? '名称和 ' + selectedCount + ' 张选片已冻结；当前阶段失败时可用同一操作继续，不会重复。' : status.body}</p></div>{ready ? <div className="creator-delivery-create-controls"><input aria-label="这批成品名称" value={effectiveName || ''} disabled={locked} onChange={(event) => onDeliveryNameChange(event.target.value)} placeholder="例如：首轮人物成品" /><button type="button" className="command-button" disabled={deliveryCreating} onClick={onCreate}><PackageCheck size={16} />{phase.action}</button></div> : <button type="button" className="outline-button" disabled={locked} onClick={onOpenAssets}><Pencil size={15} />去选图片</button>}</section></section>;
}

function CreatorDeliveryHistory({ deliveries, assetById, selectionReady, deliveryBusyId, disabled, onAction, onOpenAssets, onDownload, onCopy, onArchiveDelivery }) {
  if (!deliveries.length) return null;
  return <section className="creator-delivery-history"><header><div><p className="eyebrow">已保存的交付</p><h2>继续处理或领取图片</h2></div><span>{deliveries.length} 批</span></header>{deliveries.map((delivery) => {
    const state = deliveryState(delivery.status);
    const frozenAssets = (delivery.items || []).map((item) => {
      const activeAsset = assetById.get(item.assetId) || assetById.get(item.id);
      return { ...(activeAsset || { id: item.assetId, kind: item.asset?.kind, review: item.review, display: { label: '第 ' + item.sequence + ' 张成品' } }), archiveKey: item.sequence, thumbnailUrl: deliveryThumbnailUrl(delivery.id, item.sequence, activeAsset), fileUrl: deliveryFileUrl(delivery.id, item.sequence), downloadUrl: deliveryFileUrl(delivery.id, item.sequence, true) };
    });
    const busy = disabled || deliveryBusyId === delivery.id;
    return <article key={delivery.id}><header><div><h3>{delivery.name}</h3><p>{state.body}</p></div><span className={'creator-delivery-state is-' + delivery.status}>{state.label}</span></header>{delivery.status === 'draft' ? <div className="creator-delivery-row-actions">{selectionReady ? <button type="button" className="outline-button" disabled={busy} onClick={() => void onAction(delivery, 'update')}><RotateCcw size={15} />换成当前选片</button> : <button type="button" className="outline-button" disabled={disabled} onClick={onOpenAssets}><Pencil size={15} />调整选片</button>}<button type="button" className="command-button" disabled={busy} onClick={() => void onAction(delivery, 'ready')}><Check size={15} />确认这批成品</button></div> : delivery.status === 'ready' ? <div className="creator-delivery-row-actions"><button type="button" className="outline-button" disabled={busy} onClick={() => void onAction(delivery, 'draft')}><Pencil size={15} />返回调整</button><button type="button" className="command-button" disabled={busy} onClick={() => void onAction(delivery, 'export')}><Download size={15} />生成交付文件</button></div> : <DeliveryAssetGrid title="可领取的图片" hint={frozenAssets.length ? '可逐张下载或复制；取消不需要的图片后可打包下载。' : '原图片已不在当前项目中，但交付记录仍被保留。'} assets={frozenAssets} disabled={disabled} onDownload={onDownload} onCopy={onCopy} onArchive={(selected) => onArchiveDelivery(delivery, selected.map((asset) => Number(asset.archiveKey)))} />}</article>;
  })}</section>;
}

function CreatorDeliveryBatches({ deliveries, batches, batchName, selectedDeliveryIds, batchBusy, frozen, onBatchNameChange, onToggleDelivery, onBatchAction }) {
  const eligible = deliveries.filter((delivery) => ['ready', 'exported'].includes(delivery.status));
  const locked = batchBusy || frozen;
  return <details className="creator-delivery-batches"><summary><span>合并多份交付</span><small>可选：一次发布需要多组图片时再使用</small></summary><section aria-busy={locked}><header><div><p className="eyebrow">发布版本</p><h3>把多批成品合为一次发布</h3><span>创建新版本不会改写已经保存的交付。</span></div><div><input aria-label="发布版本名称" value={batchName} disabled={locked} onChange={(event) => onBatchNameChange(event.target.value)} placeholder="例如：春季发布" /><button type="button" className="command-button" disabled={locked || !selectedDeliveryIds.size} onClick={() => void onBatchAction('create')}><PackageCheck size={16} />{batchBusy ? '正在保存' : '保存发布版本'}</button></div></header>{eligible.length ? <div className="creator-batch-picker">{eligible.map((delivery) => <label key={delivery.id}><input type="checkbox" disabled={locked} checked={selectedDeliveryIds.has(delivery.id)} onChange={() => onToggleDelivery(delivery.id)} /><span><b>{delivery.name}</b><small>{delivery.items?.length || 0} 张图片 · {delivery.status === 'exported' ? '已完成' : '等待导出'}</small></span></label>)}</div> : <p className="creator-batch-empty">先确认至少一批成品，才可以合并为发布版本。</p>}{batches.length ? <div className="creator-batch-history">{batches.map((batch) => <article key={batch.id}><div><b>{batch.name}</b><span>当前第 {batch.versions?.[0]?.versionNo || 0} 版 · {batch.versions?.[0]?.members?.length || 0} 批成品</span></div><div>{batch.versions?.map((version) => <section key={version.id}><span>第 {version.versionNo} 版</span>{version.status === 'draft' && <button type="button" className="outline-button" disabled={locked} onClick={() => void onBatchAction('ready', batch, version)}>确认发布版本</button>}</section>)}</div>{selectedDeliveryIds.size > 0 && <button type="button" className="outline-button" disabled={locked} onClick={() => void onBatchAction('revise', batch)}>基于当前选择新建版本</button>}</article>)}</div> : null}</section></details>;
}

export function CreatorDelivery({ project, selection, deliveryName, deliveryCreating, completion, frozen, onDeliveryNameChange, onCreate, onOpenAssets, selectedAssets, deliveries, assets = [], assetById = new Map(assets.map((asset) => [asset.id, asset])), deliveryBusyId, onDeliveryAction, onRemoveSelection, onDownload, onCopy, onArchiveProject, onArchiveDelivery, batches, batchName, selectedDeliveryIds, batchBusy, onBatchNameChange, onToggleDelivery, onBatchAction }) {
  const locked = frozen || deliveryCreating;
  return <section className="creator-delivery"><CreatorDeliveryFlow project={project} selection={selection} deliveryName={deliveryName} deliveryCreating={deliveryCreating} completion={completion} frozen={locked} onDeliveryNameChange={onDeliveryNameChange} onCreate={onCreate} onOpenAssets={onOpenAssets} /><DeliveryAssetGrid title="本次要交付的图片" hint={locked ? '当前交付选片已冻结；完成该流程后才能调整。' : selectedAssets.length ? '可逐张下载或复制；也可按当前选择直接打包下载。' : '先从项目资产中选择并保留图片。'} assets={selectedAssets} disabled={locked} onDownload={onDownload} onCopy={onCopy} onRemove={locked ? null : onRemoveSelection} onArchive={(selected) => onArchiveProject(selected.map((asset) => asset.id))} emptyAction={selectedAssets.length ? <button type="button" className="outline-button" disabled={locked} onClick={onOpenAssets}><Pencil size={15} />调整选片</button> : null} /><CreatorDeliveryHistory deliveries={deliveries} assetById={assetById} selectionReady={selection.state === 'ready'} deliveryBusyId={deliveryBusyId} disabled={locked} onAction={onDeliveryAction} onOpenAssets={onOpenAssets} onDownload={onDownload} onCopy={onCopy} onArchiveDelivery={onArchiveDelivery} /><CreatorDeliveryBatches deliveries={deliveries} batches={batches} batchName={batchName} selectedDeliveryIds={selectedDeliveryIds} batchBusy={batchBusy} frozen={locked} onBatchNameChange={onBatchNameChange} onToggleDelivery={onToggleDelivery} onBatchAction={onBatchAction} /></section>;
}
