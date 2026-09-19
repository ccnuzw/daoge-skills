import { AccessibleDialog } from '../accessible-dialog.jsx';
import { asideSubject } from '../aside-model.mjs';
import { AssetProvenanceBody } from '../asset-provenance.jsx';
import { CreativeActionLauncher } from '../creative-action-launcher.jsx';
import { planEditIssues } from '../plan-edit-model.mjs';
import { understandingNote } from '../plan-understanding-model.mjs';
import { statusPresentation } from '../status-presentation.mjs';
import { AssetActions, GroupActions, LineageAssetGetActions, LineageInspector, NavigationActions, PlanActions, PlanEditDialog, RelationActions, ReplyHistoryPanel, SoftLinkList } from './lineage-inspector.jsx';
import { EMPTY_ARRAY, PLAN_PROMPT_PROTECTED_LABEL, RELATION_OPTIONS, assetState, contextRouteForNode, isAssetNode, listValue, mediaUnavailable, nodeTypeLabel, openNode, relationLabel, roundPlanDetails, shortId, taskForAsset, taskForAssets } from './lineage-shared.mjs';
import { Bookmark, BoxSelect, Check, Copy, Download, Eye, GitFork, Image, Pencil, Play, RefreshCw, Search, Share2, Sparkles, X } from 'lucide-react';
import { useState } from 'react';

/** 界面批 E（E2）从 creative-lineage-canvas.jsx 搬出（行为零变化）。 */

export function LineageInspector({ tasks = EMPTY_ARRAY, runs = EMPTY_ARRAY, metrics = EMPTY_ARRAY, assetProvenance = null, onCloseAssetProvenance = null, onOpenAssetTrace = null, editing, node, selectedNodes, selectedAssetNodes, selectedTask, selectedRound, batchBusy, groupTitle, nodeLinks, onGroupTitleChange, onCreateGroup, onCreateLink, onRemoveLink, onUpdateLink, onReverseLink, onClear, onNavigate, onPreviewAsset, onInspectAsset, onToggleAsset, onBatchSelectAssets, onSetAssetShared, onDownloadAsset, onCopyAsset, onCopyContext, onCreateRound, onOpenReference, onOpenDerive, onAddReference, onReject, onOpenConfirmation, onEditPlan, onSaveRecipe, batchQuality = '' }) {
  const [inspectorTab, setInspectorTab] = useState('plan');
  // C5：指标四项在右栏顶部——**无选中也在**（常显信息减少，一个不丢）。
  const metricsStrip = metrics.length ? <section className="lineage-metrics-strip is-aside" data-block="aside-metrics" aria-label="创作决策统计">
    {metrics.map((item) => <article key={item.key} className={item.className} title={item.title || item.label}><b>{item.value}</b><span>{item.label}</span></article>)}
  </section> : null;
  // C3：显式打开的资产来源**优先**——批次与资产共用这一个右栏（不再另开浮层；判据见 aside-model.mjs）。
  if (asideSubject({ explicit: assetProvenance ? 'assetProvenance' : null, selectedNodes }).kind === 'asset') {
    return <aside className="lineage-inspector is-open" data-region="aside" data-lineage-no-zoom>
      {metricsStrip}
      <AssetProvenanceBody provenance={assetProvenance} onClose={onCloseAssetProvenance} onOpenTrace={onOpenAssetTrace} />
    </aside>;
  }
  if (!selectedNodes.length) {
    return <aside className={'lineage-inspector' + (selectedNodes.length ? ' is-open' : '')} data-region="aside" data-lineage-no-zoom>
      {metricsStrip}
      <p className="eyebrow">检查器</p>
      <h2>选择一个节点</h2>
      <p>{editing ? '编辑模式可多选、分组或添加标注。' : '单击节点查看详情；节点相关动作会在这里出现。'}</p>
      <p className="lineage-note">先点画布里的图片或批次；右侧只显示和当前选择直接相关的操作。</p>
    </aside>;
  }
  if (!node) {
    const selectedAssetIds = selectedAssetNodes.map((item) => item.entity.id).filter(Boolean);
    const selectedAssets = selectedAssetNodes.map((item) => item.entity).filter(Boolean);
    return <aside className={'lineage-inspector' + (selectedNodes.length ? ' is-open' : '')} data-region="aside" data-lineage-no-zoom>
      {metricsStrip}
      <div className="lineage-inspector-head">
        <div><p className="eyebrow">批量操作</p><h2>{selectedNodes.length} 个节点</h2></div>
        <button type="button" className="icon-button" aria-label="清除选择" onClick={onClear}><X size={15} /></button>
      </div>
      {selectedAssetIds.length ? <>
        <p className={batchBusy ? 'lineage-batch-status is-busy' : 'lineage-batch-status'}>{batchBusy ? '选片同步进行中，批量按钮暂不可用。' : '已选择 ' + selectedAssetIds.length + ' 个资产，可批量设为成果、移出成果，或作为参考继续创作。'}</p>
        <CreativeActionLauncher assets={batchBusy ? EMPTY_ARRAY : selectedAssets} selectedTask={selectedTask} fallbackTask={taskForAssets(selectedAssets, tasks)} selectedRound={selectedRound} label="继续创作" onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} />
        <div className="lineage-inspector-actions">
          <button type="button" className="outline-button" disabled={batchBusy} onClick={() => onBatchSelectAssets(selectedAssetIds, true)}><Bookmark size={15} />选为成果</button>
          <button type="button" className="outline-button" disabled={batchBusy} onClick={() => onBatchSelectAssets(selectedAssetIds, false)}><X size={15} />移出成果</button>
        </div>
      </> : <p>当前选择中没有可批量处理的资产节点。</p>}
      <div className="lineage-inspector-actions">
        <button type="button" className="command-button" onClick={() => onCopyContext('reference', selectedNodes)}><Copy size={15} />复制参考信息</button>
        <button type="button" className="outline-button" onClick={() => onCopyContext('variation', selectedNodes)}><Sparkles size={15} />复制变体要求</button>
        <button type="button" className="outline-button" onClick={() => onCopyContext('refinement', selectedNodes)}><RefreshCw size={15} />复制优化要求</button>
      </div>
      {editing && <GroupActions value={groupTitle} onChange={onGroupTitleChange} onCreate={onCreateGroup} disabled={selectedNodes.length < 2} />}
      {editing && selectedNodes.length >= 2 && <RelationActions nodes={selectedNodes} onCreate={onCreateLink} />}
    </aside>;
  }
  const entity = node.entity;
  const isAsset = isAssetNode(node);
  return <aside className={'lineage-inspector' + (selectedNodes.length ? ' is-open' : '')} data-region="aside" data-lineage-no-zoom>
    {metricsStrip}
    <div className="lineage-inspector-head">
      <div><p className="eyebrow">检查器</p><h2>{node.title}</h2></div>
      <button type="button" className="icon-button" aria-label="清除选择" onClick={onClear}><X size={15} /></button>
    </div>
    <dl>
      <div><dt>类型</dt><dd>{nodeTypeLabel(node.entityType)}</dd></div>
      <div><dt>状态</dt><dd>{isAsset ? assetState(entity, node.selectedAsset, node.sharedAsset, node.deliveredAsset, node.mediaUnavailable, node.derivedAsset) : statusPresentation(node.entityType === 'round' ? 'round' : node.entityType === 'task' ? 'task' : 'generic', node.status).label}</dd></div>
      <div><dt>短 ID</dt><dd>{shortId(node.entityId)}</dd></div>
    </dl>
    {/* 计划是批次的属性（B2 之后计划不再单独成节点）——**确认闸门也随之挂在批次上**：
        人点一下批次，右侧就能确认，不用离开画布（方案 4.5）。 */}
    {node.entityType === 'round' && <>
      {batchQuality && <p className="lineage-quality-line" aria-label="这一批的质量">{batchQuality}</p>}
      {/* B4：批次的「计划 / 生成历史」就在检查器里——看计划与看运行都不离开画布（界面宪法 §5.8）。 */}
      <div className="lineage-inspector-tabs" role="tablist" aria-label="批次信息">
        {[['plan', '计划'], ['history', '生成历史']].map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={inspectorTab === id} className={inspectorTab === id ? 'is-active' : ''} onClick={() => setInspectorTab(id)}>{label}</button>)}
      </div>
      {inspectorTab === 'plan' ? <PlanActions node={node} onNavigate={onNavigate} onCopyContext={onCopyContext} onOpenConfirmation={onOpenConfirmation} onEditPlan={onEditPlan} onSaveRecipe={onSaveRecipe} /> : <ReplyHistoryPanel node={node} runs={runs} onNavigate={onNavigate} />}
    </>}
    {isAsset ? <AssetActions tasks={tasks} node={node} selectedTask={selectedTask} selectedRound={selectedRound} onPreviewAsset={onPreviewAsset} onInspectAsset={onInspectAsset} onToggleAsset={onToggleAsset} onSetAssetShared={onSetAssetShared} onDownloadAsset={onDownloadAsset} onCopyAsset={onCopyAsset} onCopyContext={onCopyContext} onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} /> : ['task', 'round'].includes(node.entityType) ? <NavigationActions node={node} onNavigate={onNavigate} onCreateRound={onCreateRound} /> : null}
    {editing && nodeLinks.length ? <SoftLinkList links={nodeLinks} node={node} onRemove={onRemoveLink} onUpdate={onUpdateLink} onReverse={onReverseLink} /> : null}
  </aside>;
}

export function GroupActions({ value, onChange, onCreate, disabled }) { return <div className="lineage-group-tools"><p>分组只是画布组织方式，不改变项目、运行或资产事实。</p><label><span>分组名称</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="例如：第一版探索" /></label><button type="button" className="outline-button" disabled={disabled} onClick={onCreate}><BoxSelect size={15} />组成分组</button></div>; }

export function RelationActions({ nodes, onCreate }) {
  return <div className="lineage-relation-tools"><p>软连线只做人工标注，不会创建运行或修改资产来源。默认方向：{nodes[0].title} → 其余 {nodes.length - 1} 个节点。</p>{RELATION_OPTIONS.map(([value, label]) => <button type="button" key={value} className="outline-button" onClick={() => onCreate(value, nodes[0], nodes.slice(1))}><GitFork size={15} />{label}</button>)}{nodes.length === 2 && RELATION_OPTIONS.map(([value, label]) => <button type="button" key={'reverse-' + value} className="outline-button" onClick={() => onCreate(value, nodes[0], nodes[1], 'reverse')}><GitFork size={15} />反向 {label}</button>)}</div>;
}

export function SoftLinkList({ links, node, onRemove, onUpdate, onReverse }) {
  return <div className="lineage-soft-links"><h3>人工标注</h3>{links.map((link) => <div key={link.id}><select value={link.linkType} onChange={(event) => onUpdate(link.id, { linkType: event.target.value, label: relationLabel(event.target.value) })}>{RELATION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input value={link.label} maxLength={80} onChange={(event) => onUpdate(link.id, { label: event.target.value })} aria-label="软连线标签" /><small>{link.sourceType === node.entityType && link.sourceId === node.entityId ? '指向 ' + nodeTypeLabel(link.targetType) + ' ' + shortId(link.targetId) : '来自 ' + nodeTypeLabel(link.sourceType) + ' ' + shortId(link.sourceId)}</small><button type="button" className="icon-button" aria-label="反转软连线方向" onClick={() => onReverse(link.id)}><GitFork size={13} /></button><button type="button" className="icon-button" aria-label="删除软连线" onClick={() => onRemove(link.id)}><X size={13} /></button></div>)}</div>;
}

export function ReplyHistoryPanel({ node, runs = EMPTY_ARRAY, onNavigate }) {
  const roundRuns = listValue(runs).filter((run) => run.roundId === node?.entity?.id);
  return <div className="lineage-run-history" data-block="inspector-history">
    {roundRuns.length ? <ul>{roundRuns.map((run) => <li key={run.id}>
      <button type="button" className="trace-link" onClick={() => onNavigate({ view: 'runs', taskId: node?.entity?.taskId || null, roundId: node.entity.id, compareRoundIds: [node.entity.id], runId: run.id, assetScope: 'round' })}>
        <b>计划 v{run.planVersion ?? '?'}</b>
        <span className={'lineage-status is-' + statusPresentation('run', run.status).tone}>{statusPresentation('run', run.status).label}</span>
      </button>
    </li>)}</ul> : <p className="lineage-note">这一批还没有运行记录。</p>}
    <button type="button" className="outline-button" onClick={() => onNavigate({ view: 'runs', taskId: node?.entity?.taskId || null, roundId: node?.entity?.id || null, compareRoundIds: node?.entity?.id ? [node.entity.id] : [], runId: null, assetScope: 'round' })}>打开完整生成历史</button>
  </div>;
}

export function PlanActions({ node, onNavigate, onCopyContext, onOpenConfirmation, onEditPlan, onSaveRecipe }) {
  const detail = node.planDetail || roundPlanDetails(node.entity);
  const needsConfirmation = node.entity?.status === 'awaiting_confirmation';
  return <div className="lineage-plan-details">
    <h3 className="lineage-inspector-section">过程资产</h3>
    <p className="lineage-note">这里展示已保存的、隐去隐私的计划摘要。待确认时可以在这里确认；核算和出图仍由会话执行。</p>
    <dl><div><dt>操作</dt><dd>{detail.operationLabel}</dd></div><div><dt>数量</dt><dd>{detail.itemCount || 0} 项</dd></div><div><dt>输出</dt><dd>{detail.outputSummary}</dd></div><div><dt>参考/遮罩</dt><dd>{detail.referenceCount || 0} / {detail.maskCount || 0}</dd></div><div><dt>提示词</dt><dd>{detail.promptNotice || PLAN_PROMPT_PROTECTED_LABEL}</dd></div></dl>
    {/* 9.8：它为什么这么理解——结论性说明，有就显示，没有就不显示（不硬凑）。 */}
    {understandingNote(node.entity?.plan) && <p className="lineage-understanding" aria-label="计划的自我说明">{understandingNote(node.entity?.plan)}</p>}
    {needsConfirmation && <section className="lineage-confirmation-callout"><p>当前计划正在等待人工确认。</p><button type="button" className="command-button" onClick={() => onOpenConfirmation?.(node.entity)}><Check size={15} />审阅并确认计划</button></section>}
    {/* 9.6：把这一批的可用配置存成「我的配方」（用户侧、跨项目复用；带出可改、不自动执行）。 */}
    {onSaveRecipe && <button type="button" className="outline-button lineage-save-recipe" onClick={() => onSaveRecipe(node.entity)}>存为我的配方</button>}
    <div className="lineage-inspector-actions"><button type="button" className="outline-button" onClick={() => onEditPlan?.(node)}><Pencil size={15} />编辑计划</button><button type="button" className="outline-button" onClick={() => onNavigate({ view: 'runs', taskId: node.entity?.taskId || null, roundId: node.entity?.id || null, compareRoundIds: node.entity?.id ? [node.entity.id] : [], runId: null, assetScope: 'round' })}><Play size={15} />看生成历史</button><button type="button" className="outline-button" onClick={() => openNode(node, { onNavigate, onInspectAsset: () => undefined })}><Eye size={15} />打开计划版本对比</button><button type="button" className="outline-button" onClick={() => onCopyContext('refinement', [node])}><RefreshCw size={15} />复制优化计划指令</button><button type="button" className="outline-button" onClick={() => onCopyContext('variation', [node])}><Sparkles size={15} />复制变体计划指令</button></div>
  </div>;
}

export function PlanEditDialog({ node, form, busy, error, onChange, onSave, onDismiss }) {
  const issues = planEditIssues(form);
  const detail = node?.planDetail || roundPlanDetails(node?.entity);
  return <AccessibleDialog className="plan-edit-dialog" label="编辑这一批的计划" onDismiss={onDismiss}>
    <header className="plan-edit-head"><div><p className="eyebrow">{node?.title || '这一批'}</p><h2>改计划</h2><span className="plan-edit-sub">计划 v{node?.entity?.planVersion || '—'} · 只改提示词与数量，引用素材、遮罩、输出规格照旧带过去</span></div><button type="button" className="icon-button" aria-label="关闭" onClick={onDismiss}><X size={16} /></button></header>
    <div className="plan-edit-body">
      <p className="lineage-note">改完需要<b>重新确认</b>——旧的那次确认会自动失效，保存后请在批次上重新确认。</p>
      <label className="plan-edit-field"><span>提示词</span><textarea value={form.prompt} rows={8} disabled={busy} onChange={(event) => onChange({ ...form, prompt: event.target.value })} /></label>
      <div className="plan-edit-count-row">
        <label className="plan-edit-field plan-edit-count"><span>出几张</span><input type="number" min="1" max="1000" value={form.itemCount} disabled={busy} onChange={(event) => onChange({ ...form, itemCount: Number(event.target.value) })} /></label>
        <p className="plan-edit-current">当前计划：{detail.itemCount || 0} 项 · {detail.outputSummary}</p>
      </div>
      {error && <p className="plan-edit-error" role="alert">{error}</p>}
      {!error && issues.length > 0 && <p className="plan-edit-hint">{issues.join(' ')}</p>}
    </div>
    <footer className="plan-edit-foot"><span className="plan-edit-foot-note">保存后请在批次上重新确认</span><div className="plan-edit-foot-actions"><button type="button" className="outline-button" disabled={busy} onClick={onDismiss}>取消</button><button type="button" className="command-button" disabled={busy || issues.length > 0} onClick={onSave}>{busy ? '正在保存' : '保存计划'}</button></div></footer>
  </AccessibleDialog>;
}

export function LineageAssetGetActions({ asset, onPreviewAsset, onDownloadAsset, onCopyAsset }) {
  return <section className="lineage-action-section lineage-get-actions" aria-label="获取图片">
    <header><strong>获取图片</strong><span>查看、复制或保存原图</span></header>
    <div className="lineage-utility-row">
      <button type="button" className="outline-button" onClick={() => onPreviewAsset(asset)}><Eye size={15} />放大</button>
      <button type="button" className="outline-button" onClick={() => onCopyAsset(asset)}><Copy size={15} />复制</button>
      <button type="button" className="outline-button" onClick={() => onDownloadAsset(asset)}><Download size={15} />下载</button>
    </div>
  </section>;
}

export function AssetActions({ tasks = EMPTY_ARRAY, node, selectedTask, selectedRound, onPreviewAsset, onInspectAsset, onToggleAsset, onSetAssetShared, onDownloadAsset, onCopyAsset, onCopyContext, onOpenDerive, onAddReference, onReject, onOpenReference }) {
  const asset = node.entity;
  const fallbackTask = taskForAsset(asset, tasks);
  if (node.externalSharedAsset) return <div className="lineage-inspector-stack">
    <CreativeActionLauncher assets={[asset]} selectedTask={selectedTask} fallbackTask={fallbackTask} selectedRound={selectedRound} label="继续使用" onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} />
    <LineageAssetGetActions asset={asset} onPreviewAsset={onPreviewAsset} onDownloadAsset={onDownloadAsset} onCopyAsset={onCopyAsset} />
    <details className="lineage-secondary-actions"><summary>更多信息</summary><div className="lineage-inspector-actions"><button type="button" className="outline-button" onClick={() => onInspectAsset(asset.id)}><GitFork size={15} />查看来源</button><button type="button" className="outline-button" onClick={() => onCopyContext('reference', [node])}><Copy size={15} />复制参考信息</button></div></details>
  </div>;
  return <div className="lineage-inspector-stack">
    <div className="lineage-primary-actions">
      <button type="button" className="command-button" onClick={() => onToggleAsset(asset)}><Bookmark size={15} />{node.selectedAsset ? '移出成果' : '选为成果'}</button>
      <CreativeActionLauncher assets={[asset]} selectedTask={selectedTask} fallbackTask={fallbackTask} selectedRound={selectedRound} label="继续创作" onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} />
    </div>
    <LineageAssetGetActions asset={asset} onPreviewAsset={onPreviewAsset} onDownloadAsset={onDownloadAsset} onCopyAsset={onCopyAsset} />
    <details className="lineage-secondary-actions"><summary>更多信息</summary><div className="lineage-inspector-actions"><button type="button" className="outline-button" onClick={() => onInspectAsset(asset.id)}><GitFork size={15} />查看来源</button><button type="button" className="outline-button" onClick={() => onSetAssetShared(asset, !node.sharedAsset)}><Share2 size={15} />{node.sharedAsset ? '取消共享' : '共享素材'}</button></div></details>
  </div>;
}

export function NavigationActions({ node, onNavigate, onCreateRound }) {
  const route = contextRouteForNode(node);
  const isTask = node.entityType === 'task';
  const isRound = node.entityType === 'round' || node.entityType === 'plan';
  return <div className="lineage-inspector-actions">
    {route && <button type="button" className="command-button" onClick={() => onNavigate(route)}><Search size={15} />设为当前批次</button>}
    <button type="button" className="outline-button" onClick={() => openNode(node, { onNavigate, onInspectAsset: () => undefined })}><Eye size={15} />打开详情</button>
    {isTask && <button type="button" className="outline-button" onClick={() => { onNavigate(route); onCreateRound(); }}><GitFork size={15} />为此任务新建批次</button>}
    {isRound && node.entity?.status === 'draft' && <button type="button" className="outline-button" onClick={() => onNavigate(route)}><Image size={15} />设为当前后添加参考</button>}
  </div>;
}
