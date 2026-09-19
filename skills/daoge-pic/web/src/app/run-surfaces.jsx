import { Check, ChevronLeft, ChevronRight, Copy, Ellipsis, Eye, MessageSquareText, Pause, Play, RefreshCw, Search, Sparkles, X } from 'lucide-react';
import { assetThumbnailUrl } from '../asset-media-url.mjs';
import { RUN_ITEM_FILTER_OPTIONS, RUN_ITEM_PAGE_SIZES, normalizeRunItemFilter, normalizeRunItemPageSize, normalizeRunItemSequence, retryableRunItems, runItemFilterCount, runItemPageBounds, runItemProgress, selectableRunItemIds } from '../run-item-pagination.mjs';
import { planPresentation, planStateLabel } from '../plan-presentation.mjs';
import { AccessibleDialog } from '../accessible-dialog.jsx';
import { runHistoryOption, runItemRecovery } from '../status-presentation.mjs';
import { failureAttributionLine } from '../failure-copy-model.mjs';
import { StatusPill } from '../components/StatusPill.jsx';
import { dryRunEvidence } from '../advanced-details.mjs';
import { ROUND_PURPOSE_LABELS } from '../app/creation-model.mjs';
import { IconButton } from '../components/IconButton.jsx';
import { Component } from 'react';

const EMPTY = [];

/** 界面批 E 从 main.jsx 搬出（行为零变化）。 */

export function evidenceDate(value) {
  if (typeof value !== 'string' || !value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN');
}

export function evidenceLabel(value) {
  if (value === true) return '支持';
  if (value === false) return '不支持';
  if (value === null || value === undefined || value === '') return '未记录';
  if (Array.isArray(value)) return value.length ? value.join('、') : '无';
  if (typeof value === 'object') {
    const record = value;
    if ((record.width || record.width === 0) && (record.height || record.height === 0)) return String(record.width) + ' × ' + String(record.height) + (record.unit ? ' ' + record.unit : '');
    return JSON.stringify(record, null, 2);
  }
  return String(value);
}

export function RunItemOutputThumbs({ assets, onInspect }) {
  if (!assets?.length) return <span className="run-item-output is-empty">暂无图像</span>;
  return <span className="run-item-output">{assets.slice(0, 3).map((asset, index) => <button type="button" key={asset.id} aria-label={'查看第 ' + (index + 1) + ' 个结果资产来源'} title="查看结果资产来源" onClick={() => void onInspect(asset.id)}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button>)}{assets.length > 3 && <em>+{assets.length - 3}</em>}</span>;
}

export function RunItemRow({ item, selected, onToggleSelected, onOpenDetail, onInspect, onRetry }) {
  const recovery = runItemRecovery(item);
  // 归因（方案 4.10 第三条）：分清「我的问题」与「系统的问题」——下一步完全不同。
  // 模型在非失败状态返回 null，所以成功的那张图旁边不会多出一句「等一等就能过」的噪音。
  const attribution = failureAttributionLine(item);
  const retryable = retryableRunItems([item]).length > 0;
  const attempts = Number.isInteger(item.attempts) ? item.attempts : 0;
  return <article className={'run-item-row ' + (selected ? 'is-selected ' : '') + (retryable ? 'is-retryable' : '')}>
    <label className="run-item-select"><input type="checkbox" checked={selected} disabled={!retryable} onChange={() => onToggleSelected(item.id)} aria-label={'选择第 ' + item.sequence + ' 项用于批量重试'} /><span aria-hidden="true"><Check size={12} /></span></label>
    <div className="run-item-summary"><b>#{String(item.sequence).padStart(3, '0')}</b><RunItemOutputThumbs assets={item.outputAssets || EMPTY} onInspect={onInspect} /></div>
    <StatusPill value={item.status} scope="run_item" />
    <div className="run-item-details"><span>尝试 {attempts} 次</span>{item.retryAt && <span>重试 {item.retryAt}</span>}{item.updatedAt && <span>更新 {new Date(item.updatedAt).toLocaleString('zh-CN')}</span>}{attribution && <span className={'run-item-attribution is-' + attribution.owner}>{attribution.label}</span>}{recovery.error && <span className="run-item-error">{recovery.error}</span>}{recovery.advice && <span className="run-item-recovery">{recovery.advice}</span>}</div>
    <div className="run-item-actions"><button type="button" className="outline-button" onClick={() => onOpenDetail(item)}><Eye size={15} />详情</button>{retryable && <button type="button" className="outline-button" onClick={() => void onRetry(item.id)}><RefreshCw size={15} />重试</button>}</div>
  </article>;
}

export function RunItemDetailDialog({ item, onDismiss, onInspect, onRetry }) {
  if (!item) return null;
  const recovery = runItemRecovery(item);
  const attribution = failureAttributionLine(item);
  const retryable = retryableRunItems([item]).length > 0;
  return <AccessibleDialog label={'第 ' + item.sequence + ' 项出图详情'} onDismiss={onDismiss} className="run-item-detail-dialog">
    <header><div><p className="eyebrow">出图详情</p><h2>第 {item.sequence} 项</h2></div><IconButton label="关闭出图详情" onClick={onDismiss}><X size={16} /></IconButton></header>
    <div className="run-item-detail-grid"><section><h3>状态</h3><StatusPill value={item.status} scope="run_item" /><p>已尝试 {Number.isInteger(item.attempts) ? item.attempts : 0} 次{item.retryAt ? '，下次重试 ' + item.retryAt : ''}。</p>{item.updatedAt && <p>最后更新：{new Date(item.updatedAt).toLocaleString('zh-CN')}</p>}</section><section><h3>恢复建议</h3>{attribution && <p className={'run-item-attribution is-' + attribution.owner}><b>{attribution.label}</b>：{attribution.advice}</p>}{recovery.error ? <p className="run-item-error">{recovery.error}</p> : <p>没有安全错误摘要。</p>}{recovery.advice && <p className="run-item-recovery">{recovery.advice}</p>}</section><section className="run-item-detail-assets"><h3>输出资产</h3>{item.outputAssets?.length ? <div>{item.outputAssets.map((asset) => <button type="button" key={asset.id} onClick={() => void onInspect(asset.id)}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /><span>{asset.mediaType || 'image'} · {asset.mediaState || 'available'}</span></button>)}</div> : <p>这一项还没有输出资产。</p>}</section></div>
    {retryable && <footer><button type="button" className="command-button" onClick={() => void onRetry(item.id)}><RefreshCw size={16} />重试此项（交给会话）</button></footer>}
  </AccessibleDialog>;
}

export function RunItemProgressBar({ page }) {
  const progress = runItemProgress(page.statusCounts);
  const total = Math.max(0, Number(page.allTotal || page.total || 0));
  const segments = [{ key: 'succeeded', label: '完成', value: progress.succeeded }, { key: 'active', label: '进行中', value: progress.active }, { key: 'waiting', label: '等待', value: progress.waiting }, { key: 'attention', label: '需处理', value: progress.attention }, { key: 'cancelled', label: '取消', value: progress.cancelled }].filter((segment) => segment.value > 0);
  return <div className="run-item-progress" role="progressbar" aria-label={'完成进度：' + progress.succeeded + ' / ' + total} aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={Math.min(progress.succeeded, total || 1)}>
    <div>{segments.length ? segments.map((segment) => <span key={segment.key} className={'is-' + segment.key} style={{ width: Math.max(2, (segment.value / Math.max(1, total)) * 100) + '%' }} />) : <span className="is-empty" />}</div>
    <p>{progress.succeeded} 完成 · {progress.active} 进行中 · {progress.attention} 需处理 · 共 {total} 项</p>
  </div>;
}

export function GenerationHistory({ selectedRound, runs, activeRunId, activeRun, runExecutionStatus, runLifecycleStatus, taskOverview, creativeRecord, visibleRunItems, runItemPage, runItemFilter, runItemPageSize, runItemSequence, selectedRunItemIds, runItemDetail, canCancelActiveRun, advancedDetails, onSelectRun, onControlRun, onRetryItem, onInspectAsset, onSetRunItemFilter, onSetRunItemPage, onSetRunItemPageSize, onSetRunItemSequence, onToggleRunItemSelection, onSelectRetryablePageItems, onRetrySelectedItems, onOpenRunItemDetail, onCloseRunItemDetail, onToggleAdvanced, onCloseAdvanced, onCopyPrompt }) {
  const plan = activeRun ? planPresentation(activeRun.planSnapshot) : null;
  const hasPrompt = Boolean(activeRun?.planSnapshot?.prompt?.trim());
  const runShortId = activeRun ? String(activeRun.id || '').slice(-8) || '未记录' : '';
  const bounds = runItemPageBounds(runItemPage);
  const normalizedFilter = normalizeRunItemFilter(runItemFilter);
  const normalizedPageSize = normalizeRunItemPageSize(runItemPageSize);
  const normalizedSequence = normalizeRunItemSequence(runItemSequence);
  const retryablePageItems = retryableRunItems(visibleRunItems);
  const selectedRetryableIds = selectableRunItemIds(visibleRunItems, selectedRunItemIds);
  const allRetryableSelected = retryablePageItems.length > 0 && selectedRetryableIds.length === retryablePageItems.length;
  return <section className="run-stage">
    <div className="run-history-layout">
      <aside className="run-history-panel" aria-label="当前批次的生成历史">
        <header><div><p className="eyebrow">当前批次</p><h2>运行记录</h2></div><span className="run-history-count">{runs.length}</span></header>
        <p className="run-history-help">{selectedRound ? '选择一条记录查看当时的提示词、结果与恢复操作。' : '先从上方选择批次。'}</p>
        {selectedRound ? runs.length ? <div className="run-history-list">{runs.map((run, index) => <button type="button" key={run.id} className={run.id === activeRunId ? 'is-active' : ''} aria-pressed={run.id === activeRunId} aria-label={runHistoryOption(run)} title={runHistoryOption(run)} onClick={() => onSelectRun(run.id)}>
          <span className="run-history-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="run-history-entry"><b>计划 v{run.planVersion ?? '?'}</b><small>{run.createdAt ? new Date(run.createdAt).toLocaleString('zh-CN') : '时间未知'} · {String(run.id || '').slice(-8) || '未知标识'}</small></span>
          <StatusPill value={run.status} scope="run" />
        </button>)}</div> : <p className="empty-copy">当前批次还没有出图。</p> : <p className="empty-copy">从上方选择一个批次后，再查看生成历史。</p>}
      </aside>

      <section className="run-detail-panel">
        <header className="run-detail-header">
          <div><p className="eyebrow">{selectedRound ? (ROUND_PURPOSE_LABELS[selectedRound.purpose] || selectedRound.purpose) + '批次' : '未选择批次'}</p><h2>{activeRun ? '生成详情' : '选择一条运行记录'}</h2>{activeRun && <span>{activeRun.createdAt ? new Date(activeRun.createdAt).toLocaleString('zh-CN') : '时间未知'} · 计划 v{activeRun.planVersion ?? '?'} · {runShortId}</span>}</div>
          {activeRun && <StatusPill presentation={runExecutionStatus} />}
        </header>

        {activeRun ? <>
          <section className="run-prompt-card">
            <header><div className="run-prompt-title"><MessageSquareText size={17} aria-hidden="true" /><div><span>本次提示词</span><small>{plan.operation} · {plan.output}</small></div></div><button type="button" className="run-copy-button" onClick={() => void onCopyPrompt(activeRun)} disabled={!hasPrompt}><Copy size={15} />复制完整提示词</button></header>
            <p>{plan.prompt}</p>
            <div className="run-plan-facts"><span>计划产出 <b>{plan.itemCount ?? '未记录'}</b></span><span>参考素材 <b>{activeRun.planSnapshot?.referenceCount ?? plan.references.length}</b></span><span>同时出图 <b>{activeRun.executionConcurrency || '未记录'}</b></span></div>
          </section>

          <section className="run-overview-strip" aria-label="运行概览">
            {taskOverview && <div className="run-task-context"><p className="eyebrow">当前任务</p><strong>{taskOverview.task?.name}</strong><span>{taskOverview.summary?.roundCount || 0} 个批次 · {taskOverview.summary?.runCount || 0} 次运行 · {taskOverview.summary?.resultCount || 0} 个结果{creativeRecord?.lineage?.rounds?.length ? ' · 承接 ' + creativeRecord.lineage.rounds.length + ' 个上游批次' : ''}</span></div>}
            <div className="run-metrics"><div><span>计划</span><b>v{activeRun.planVersion ?? creativeRecord?.round?.planVersion ?? '?'}</b></div><div><span>执行</span><b>{runExecutionStatus.label}</b></div><div><span>状态</span><b>{runLifecycleStatus.label}</b></div></div>
          </section>

          <div className="run-controls" aria-label="运行操作">
            <span className="run-controls-label">运行操作</span>
            {['queued', 'running'].includes(activeRun.status) && <button type="button" className="outline-button" onClick={() => void onControlRun('pause')}><Pause size={16} />暂停运行</button>}
            {activeRun.status === 'paused' && <button type="button" className="command-button" onClick={() => void onControlRun('resume')}><Play size={16} />继续运行（交给会话）</button>}
            {['partial', 'failed'].includes(activeRun.status) && <button type="button" className="command-button" onClick={() => void onControlRun('retry')}><RefreshCw size={16} />重试没成的项（交给会话）</button>}
            {canCancelActiveRun && <button type="button" className="danger-button" onClick={() => void onControlRun('cancel')}><X size={16} />取消运行</button>}
            <button type="button" className="run-advanced-button" aria-expanded={Boolean(advancedDetails)} onClick={onToggleAdvanced}><Ellipsis size={16} />{advancedDetails ? '收起技术详情' : '技术详情'}</button>
          </div>

          <section className="run-items-section">
            <header className="run-items-heading"><div><p className="eyebrow">生成结果</p><h3>结果队列</h3></div><span>{bounds.start ? bounds.start + '-' + bounds.end : '0'} / {runItemPage.total} 项{runItemPage.allTotal !== runItemPage.total ? ' · 总 ' + runItemPage.allTotal : ''}</span></header>
            <RunItemProgressBar page={runItemPage} />
            <div className="run-item-toolbar">
              <div className="run-item-filters" aria-label="按状态筛选">{RUN_ITEM_FILTER_OPTIONS.map((option) => <button type="button" key={option.id} className={normalizedFilter === option.id ? 'is-active' : ''} onClick={() => onSetRunItemFilter(option.id)}>{option.label}<small>{runItemFilterCount(runItemPage.statusCounts, option.id)}</small></button>)}</div>
              <label className="run-item-sequence"><Search size={14} /><span>序号</span><input type="number" min="1" inputMode="numeric" value={normalizedSequence || ''} onChange={(event) => onSetRunItemSequence(event.target.value)} placeholder="任意" />{normalizedSequence !== null && <button type="button" aria-label="清除序号筛选" onClick={() => onSetRunItemSequence(null)}><X size={13} /></button>}</label>
              <label className="run-item-page-size"><span>每页</span><select aria-label="每页数量" value={normalizedPageSize} onChange={(event) => onSetRunItemPageSize(event.target.value)}>{RUN_ITEM_PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
              <div className="run-item-bulk"><button type="button" className="outline-button" disabled={!retryablePageItems.length} onClick={() => onSelectRetryablePageItems(!allRetryableSelected)}><Check size={15} />{allRetryableSelected ? '取消本页' : '选择可重试'}</button><button type="button" className="command-button" disabled={!selectedRetryableIds.length} onClick={() => void onRetrySelectedItems(selectedRetryableIds)}><RefreshCw size={15} />重试选中的 {selectedRetryableIds.length || ''} 项（交给会话）</button></div>
            </div>
            <div className="run-item-list">{visibleRunItems.length ? visibleRunItems.map((item) => <RunItemRow key={item.id} item={item} selected={selectedRunItemIds.has(item.id)} onToggleSelected={onToggleRunItemSelection} onOpenDetail={onOpenRunItemDetail} onInspect={onInspectAsset} onRetry={onRetryItem} />) : <p className="empty-copy">当前筛选没有记录。</p>}</div>
            <nav className="run-item-pagination" aria-label="分页"><button type="button" className="outline-button" disabled={runItemPage.page <= 1} onClick={() => onSetRunItemPage(runItemPage.page - 1)}><ChevronLeft size={15} />上一页</button><span>第 {runItemPage.page} / {runItemPage.totalPages} 页</span><button type="button" className="outline-button" disabled={runItemPage.page >= runItemPage.totalPages} onClick={() => onSetRunItemPage(runItemPage.page + 1)}>下一页<ChevronRight size={15} /></button></nav>
          </section>

          {advancedDetails && <AdvancedDetailsPanel details={advancedDetails} onClose={onCloseAdvanced} />}
        </> : <div className="run-detail-empty"><Sparkles size={28} strokeWidth={1.25} /><div><h3>选择一条运行记录</h3><p>选择后会在这里集中显示提示词、执行状态、生成结果和可用操作。</p></div></div>}
      </section>
    </div>
    <RunItemDetailDialog item={runItemDetail} onDismiss={onCloseRunItemDetail} onInspect={onInspectAsset} onRetry={onRetryItem} />
  </section>;
}

export function EvidenceFacts({ items }) {
  return <dl className="advanced-fact-grid">{items.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{evidenceLabel(value)}</dd></div>)}</dl>;
}

export function AdvancedDetailsPanel({ details, onClose }) {
  return <section className="advanced-details">
    <div className="advanced-details-head"><div><p className="eyebrow">技术详情</p><h3>计划与预检证据</h3></div><IconButton label="关闭技术详情" onClick={onClose}><X size={15} /></IconButton></div>
    <div className="advanced-evidence">
      <section className="advanced-evidence-section"><h4>计划版本</h4>{details.plans.length ? <div className="advanced-plan-list">{details.plans.map((item) => <article key={item.id || item.planVersion} className="advanced-plan-row"><strong>v{item.planVersion}</strong><span>{planStateLabel?.(item.state) || item.state || '未知'}</span><small>{evidenceDate(item.createdAt)}{item.confirmedAt ? ' · 确认 ' + evidenceDate(item.confirmedAt) : ''}</small></article>)}</div> : <p>没有计划版本记录。</p>}</section>
      <section className="advanced-evidence-section is-preflight"><h4>预检</h4>{details.dryRuns.length ? <div className="advanced-dry-run-list">{details.dryRuns.map((dryRun) => <DryRunEvidenceCard key={dryRun.id} dryRun={dryRun} />)}</div> : <p>没有预检记录。</p>}</section>
    </div>
  </section>;
}

export function DryRunEvidenceCard({ dryRun }) {
  const evidence = dryRunEvidence(dryRun);
  const details = /** @type {any} */ (evidence.details || {});
  const planSnapshot = details.planSnapshot && typeof details.planSnapshot === 'object' ? details.planSnapshot : {};
  const provider = details.provider && typeof details.provider === 'object' ? details.provider : {};
  const capabilities = provider.capabilities && typeof provider.capabilities === 'object' ? provider.capabilities : {};
  const output = planSnapshot.output && typeof planSnapshot.output === 'object' ? planSnapshot.output : {};
  const capabilityItems = [['生成', capabilities.generate], ['编辑', capabilities.edit], ['参考图', capabilities.referenceImage], ['遮罩', capabilities.mask]].filter(([, value]) => value !== undefined);
  return <article className="advanced-dry-run-card">
    <header><div><strong>{evidence.status}</strong><span>计划 v{evidence.planVersion || '未知'}</span></div><time>{evidenceDate(details.createdAt)}</time></header>
    <EvidenceFacts items={[["单张出图", details.itemCount ?? planSnapshot.itemCount], ["操作", planSnapshot.operation === 'edit' ? '编辑' : '生成'], ["Provider", provider.providerId], ["模型", provider.model], ["参考素材", planSnapshot.referenceAssetIds?.length ?? planSnapshot.referenceCount], ["逐图提示词", planSnapshot.itemPrompts?.length || 0]]} />
    <div className="advanced-preflight-breakdown">
      <section><h5>输出规格</h5>{Object.keys(output).length ? <EvidenceFacts items={Object.entries(output).map(([key, value]) => [key, value])} /> : <p>由生成服务的默认能力决定。</p>}</section>
      <section><h5>能力快照</h5>{capabilityItems.length ? <div className="advanced-capability-list">{capabilityItems.map(([label, value]) => <span key={label} className={value ? 'is-on' : 'is-off'}>{label}：{value ? '支持' : '不支持'}</span>)}</div> : <p>没有能力快照。</p>}</section>
    </div>
    <details className="advanced-raw-evidence"><summary>查看原始摘要</summary><pre>{JSON.stringify(evidence.details, null, 2)}</pre></details>
  </article>;
}

