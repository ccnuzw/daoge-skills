import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, Bookmark, Check, ChevronLeft, ChevronRight, CircleAlert, CloudOff, Eye, ImagePlus, Inbox, LoaderCircle, Maximize2, RefreshCw, SlidersHorizontal, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { REVIEW_ZOOM_MAX, REVIEW_ZOOM_MIN, clampReviewZoom, reviewKeyAction, reviewZoomStep, reviewZoomToggleTarget } from './image-review-keys-model.mjs';
import { DRAFT_BOUNDARY_COPY } from './boundary-copy.mjs';
import { normalizeAdvancedDetails } from './advanced-details.mjs';
import { runExecutionPresentation, statusPresentation } from './status-presentation.mjs';
import { providerOutageCopy, providerOutageKind } from './failure-copy-model.mjs';
import { ASSET_BACKSTAGE_COPY } from './asset-backstage-copy.mjs';
import { recipeDraftFrom } from './recipe-model.mjs';
import { providerRuntimeNotice } from './provider-runtime-model.mjs';
import { planStateLabel } from './plan-presentation.mjs';
import { ASSET_SCOPE_LABELS, ASSET_SCOPES, isStudioView, parseWorkbenchRoute, rendererForWorkbenchView, selectProject, selectTask, serializeWorkbenchRoute, updateWorkbenchRoute } from './workbench-route.mjs';
import { PromptWorkspace } from './prompt-workspace.jsx';
import { LearningCenter } from './learning-center.jsx';
import { AssetCard, AssetSelectionStrip } from './app/asset-surfaces.jsx';
import { api } from './app/api.js';
import { AssetsView } from './views/assets.jsx';
import { DeliveriesView } from './views/deliveries.jsx';
import { GuideView } from './views/guide.jsx';
import { LibraryView } from './views/library.jsx';
import { LineageView } from './views/lineage.jsx';
import { ProjectOverviewView } from './views/project-overview.jsx';
import { ProjectsView } from './views/projects.jsx';
import { PromptsView } from './views/prompts.jsx';
import { RunsView } from './views/runs.jsx';
import { SharedAssetsView } from './views/shared-assets.jsx';
import { StudioOverviewView } from './views/studio-overview.jsx';
import { TasksView } from './views/tasks.jsx';
import { SessionPlanSummary, WorkspaceContextBar, WorkbenchErrorAlert } from './app/shell-pieces.jsx';
import { RuntimeHealthAlertStrip } from './app/project-surfaces.jsx';
import { DryRunEvidenceCard } from './app/run-surfaces.jsx';

import { MaterialImportGuide, ProjectCreationDialog, TaskCreationDialog, RoundCreationDialog, ReferenceAssetDialog, ReferenceRoundResolverDialog, DerivedRoundDialog, RejectReviewDialog } from './app/creation-dialogs.jsx';
import { ROUND_PURPOSE_LABELS, compactRecord, listItems, materialNeedsForTemplate, projectTemplateForProject, uniqueList } from './app/creation-model.mjs';
import { IconButton } from './components/IconButton.jsx';
import { StatusPill } from './components/StatusPill.jsx';
import { Troubleshoot } from './troubleshoot.jsx';
import { CreativeLibrary } from './creative-library.jsx';
import { SharedAssets } from './shared-assets.jsx';
import { CreativeLineageCanvas } from './creative-lineage-canvas.jsx';
import { CreatorDelivery } from './creator-delivery.jsx';
import { CreativeActionLauncher } from './creative-action-launcher.jsx';
import { AssetStateLegend } from './asset-state-legend.jsx';
import { WorkbenchNavigation } from './workbench-navigation.jsx';
import { deliveryIntentFromSelection, deliverySelectionMessage, projectDeliverySelection } from './delivery-workflow.mjs';
import { inPlaceCreationRoute } from './canvas-creation-model.mjs';
import { requestContextAssetIds } from './canvas-request-context.mjs';
import { VIEW_LAYOUTS } from './workbench-navigation-model.mjs';
import { confirmationEntry } from './confirmation-entry-model.mjs';
import { DEFAULT_PURPOSE } from './plan-questionnaire-model.mjs';
import { bootstrapLocalStudioSession } from './local-auth.mjs';
import { AccessibleDialog } from './accessible-dialog.jsx';
import { ConfirmationDialog } from './confirmation-dialog.jsx';
import { StudioSearch } from './studio-search.jsx';
import { useAssetImport } from './use-asset-import.mjs';
import { useProjectQualityMetrics } from './use-project-quality-metrics.mjs';
import { purposeLabel } from './purpose-labels.mjs';
import { projectEmptyState } from './project-empty-state-model.mjs';
import { negotiateStudioVersion, versionProbeRequest } from './version-negotiation-model.mjs';

/** 窗口标题的基准值。取一次存下来——否则带着计数的标题会被下一次拼装再套一层「(2) (1) …」。 */
const BASE_DOCUMENT_TITLE = document.title || 'DAOGE Pic Studio';
import { useStudioSearch } from './use-studio-search.mjs';
import { createLatestRequestGate, useRouteRefresh } from './use-route-refresh.mjs';
import { studioEventRefreshPlan, useStudioEvents } from './use-studio-events.mjs';
import { completionNotificationCopy, hasCompletionSignal, noticeTitle, shouldMarkUnread, shouldSendNotification } from './completion-notice-model.mjs';
import { assetOriginalUrl } from './asset-media-url.mjs';
import { ASSET_IMPORT_CONCURRENCY, mapWithConcurrency } from './bounded-concurrency.mjs';
import { createEventRefreshQueue } from './refresh-coordinator.mjs';
import { batchOperationSignature, createBatchOperationSnapshot, createDeliveryInteractionGuard, isDeliveryOperationCurrent } from './creator-delivery-model.mjs';
import { ASSET_PAGE_SIZES, DEFAULT_ASSET_PAGE_SIZE, assetPageCount, clampAssetPage, normalizeAssetPageSize } from './asset-pagination.mjs';
import { DEFAULT_RUN_ITEM_FILTER, DEFAULT_RUN_ITEM_PAGE_SIZE, EMPTY_RUN_ITEM_PAGE, normalizeRunItemFilter, normalizeRunItemPage, normalizeRunItemPageNumber, normalizeRunItemPageSize, normalizeRunItemSequence, retryableRunItems, serializeRunItemRequestQuery } from './run-item-pagination.mjs';
import { assetRefreshPath } from './asset-refresh-plan.mjs';
import { EMPTY_LINEAGE_RUN_ITEM_COVERAGE, LINEAGE_ASSET_PAGE_SIZE, loadCompleteLineageAssets, loadCompleteLineageRunItems } from './lineage-data-loader.mjs';
import { REFERENCE_USAGE_LABELS } from './reference-usage-model.mjs';
import { resolveUploadTarget } from './asset-import-model.mjs';
import { chunkAssetIds, deliverableIntent, isSelectionWriteCurrent, keepCandidateIds, latestSelection, mergeSelectionAssets, needsKeepReview, nextBusySet, nextSelectedIds, normalizeAssetIds, selectionCandidates, selectionIdSet, shouldClearSelectionBusy } from './selection-model.mjs';
import { paginateWorkspaceItems } from './workspace-list-model.mjs';
import { ProviderSettings } from './provider-settings.jsx';
import { RequestQueueDock } from './request-queue.jsx';
import { AssetProvenanceBody } from './asset-provenance.jsx';
import { PageFrame } from './templates/PageFrame.jsx';
import { PageHeader } from './components/PageHeader.jsx';
import { PageToolbar } from './components/PageToolbar.jsx';
import { LayoutAuditOverlay } from './components/LayoutAuditOverlay.jsx';
import { StatusSlot } from './components/StatusSlot.jsx';
import { useRequestQueue } from './use-request-queue.mjs';
import { useAgentPresence } from './use-agent-presence.mjs';
import { useAgentDetection } from './use-agent-detection.mjs';
import { readAgentConnectionConfig, writeAgentConnectionConfig } from './agent-connection-model.mjs';
import { beginCancelUndo, cancelUndoAvailable, cancelUndoLabel } from './cancel-undo-model.mjs';
import { queueRounds, requestProgress } from './request-progress-model.mjs';
import { workbenchConversationId } from './workbench-session.mjs';
import { creativeDerivedActionForPurpose } from './creative-actions.mjs';
import { installBrowserErrorGuard } from './browser-error-guard.mjs';
import { redactedRuntimeDiagnostic, runtimeHealthPresentation } from './runtime-health.mjs';
import { canRetryWorkbenchError, createWorkbenchError, errorMessageForDisplay, hasWorkbenchErrorMetadata, isAbortError, normalizeRequestError } from './error-model.mjs';
import './styles.css';

/**
 * 顶层横幅要展示的错误：可以是一句给人看的话，也可以是带分类与重试信息的结构化错误。
 * @typedef {string | Error} WorkbenchErrorState
 */

const EMPTY = [];

installBrowserErrorGuard();

function projectArchiveUrl(projectId, assetIds) { const params = new URLSearchParams(); for (const assetId of assetIds) params.append('assetId', assetId); return '/api/projects/' + encodeURIComponent(projectId) + '/assets/archive?' + params.toString(); }

function deliveryArchiveUrl(deliveryId, sequences) { const params = new URLSearchParams(); for (const sequence of sequences) params.append('sequence', String(sequence)); return '/api/deliveries/' + encodeURIComponent(deliveryId) + '/archive?' + params.toString(); }

function clipboardItemSupports(type) {
  return typeof ClipboardItem !== 'undefined' && (typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports(type));
}

async function convertImageBlobToPng(image) {
  const bitmap = await createImageBitmap(image);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('当前浏览器无法准备剪贴板图片。');
    context.drawImage(bitmap, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('当前浏览器无法转换图片格式。')), 'image/png');
    });
  } finally {
    bitmap.close?.();
  }
}
async function writeImageBlobToClipboard(image) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
  const writeBlob = async (type, blob) => {
    if (!clipboardItemSupports(type)) return false;
    await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
    return true;
  };
  if (image.type) {
    try {
      if (await writeBlob(image.type, image)) return true;
    } catch {
      // Browsers commonly reject image/jpeg for ClipboardItem; retry as PNG, then fall back to copying the URL.
    }
  }
  if (image.type !== 'image/png' && clipboardItemSupports('image/png')) {
    try {
      const pngImage = await convertImageBlobToPng(image);
      if (await writeBlob('image/png', pngImage)) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function uniqueKey(prefix) {
  return prefix + '-' + crypto.randomUUID();
}
const DELIVERY_COMPLETION_PREFIX = 'daoge-pic:delivery-completion:';
const ASSET_PAGE_SIZE_KEY = 'daoge-pic:asset-page-size';
const ASSET_PREVIEW_FIT_KEY = 'daoge-pic:asset-preview-fit';
const RAIL_COLLAPSE_KEY = 'daoge-pic:rail-collapsed';
/** @type {import('./lineage-data-loader.mjs').LineageCoverage} */
const EMPTY_LINEAGE_ASSET_COVERAGE = Object.freeze({ loaded: 0, total: 0, loading: true });

function normalizeReferenceMaterials(plan = {}) {
  const values = [];
  const seen = new Set();
  const add = (assetId, usage = 'subject', note = '') => {
    const id = typeof assetId === 'string' ? assetId.trim() : '';
    if (!id || seen.has(id)) return;
    seen.add(id);
    const knownUsage = REFERENCE_USAGE_LABELS[usage] ? usage : 'subject';
    values.push(compactRecord({ assetId: id, usage: knownUsage, note: typeof note === 'string' ? note.trim() : '' }));
  };
  if (Array.isArray(plan.referenceMaterials)) for (const item of plan.referenceMaterials) if (item && typeof item === 'object' && !Array.isArray(item)) add(item.assetId, item.usage, item.note);
  if (Array.isArray(plan.referenceAssetIds)) for (const assetId of plan.referenceAssetIds) add(assetId);
  if (typeof plan.maskAssetId === 'string') add(plan.maskAssetId, 'mask');
  return values;
}

/** @param {object} [plan] @param {any[]} [materials] */
function planWithReferenceMaterials(plan = {}, materials = []) {
  const normalized = normalizeReferenceMaterials({ referenceMaterials: materials });
  const referenceAssetIds = normalized.filter((item) => item.usage !== 'mask').map((item) => item.assetId);
  const mask = normalized.find((item) => item.usage === 'mask');
  const next = { ...plan, referenceMaterials: normalized, referenceAssetIds, referenceLabels: normalized.filter((item) => item.usage !== 'mask').map((item) => REFERENCE_USAGE_LABELS[item.usage] || item.usage) };
  if (mask) next.maskAssetId = mask.assetId;
  else delete next.maskAssetId;
  return next;
}

function materialNeedsForTask(task) {
  return uniqueList(task?.intent?.materialNeeds || task?.plan?.materialNeeds || []);
}

function materialNeedsForContext(project, task, round, templates = EMPTY) {
  const roundNeeds = uniqueList(round?.plan?.materialNeeds || []);
  if (roundNeeds.length) return roundNeeds;
  const taskNeeds = materialNeedsForTask(task);
  if (taskNeeds.length) return taskNeeds;
  const template = projectTemplateForProject(project, templates);
  return materialNeedsForTemplate(template);
}

function materialNeedCompletionCounts(materialNeeds, assets, referenceMaterials) {
  const buckets = Object.fromEntries(uniqueList(materialNeeds).map((need) => [need, new Set()]));
  if (!Object.keys(buckets).length) return {};
  for (const asset of listItems(assets)) {
    const need = typeof asset?.source?.materialNeed === 'string' ? asset.source.materialNeed.trim() : '';
    if (need && buckets[need]) buckets[need].add(asset.id);
  }
  for (const material of listItems(referenceMaterials)) {
    const note = typeof material?.note === 'string' ? material.note : '';
    for (const need of Object.keys(buckets)) if (note.includes(need) && material.assetId) buckets[need].add(material.assetId);
  }
  return Object.fromEntries(Object.entries(buckets).map(([need, assetIds]) => [need, assetIds.size]));
}

function rejectFeedbackToDerivedForm(feedback, assets) {
  const sourceAssetIds = listItems(assets).map((asset) => asset.id).filter(Boolean);
  const reasons = uniqueList(feedback?.reasons || []);
  const reasonIds = uniqueList(feedback?.reasonIds || []);
  const note = String(feedback?.note || '').trim();
  const reasonText = reasons.length ? reasons.join('、') : '不采用原因';
  const nextRound = feedback?.nextRound && typeof feedback.nextRound === 'object' ? feedback.nextRound : {};
  return {
    purpose: nextRound.purpose || 'refinement',
    action: 'feedback-to-next-round',
    actionLabel: '从不采用原因创建下一轮',
    sourceAssetIds,
    parentAssetIds: [],
    primaryAssetId: sourceAssetIds[0] || '',
    referenceArrangementMode: 'feedback-negative',
    referenceArrangementLabel: '不采用原因 → 下一轮修改',
    referenceMaterials: listItems(assets).map((asset) => ({ assetId: asset.id, usage: 'negative', note: '不采用反例：' + reasonText + (note ? '。' + note : '') })),
    refinementGoals: uniqueList(nextRound.refinementGoals || reasons.concat(['提升可用度'])),
    keepConstraints: uniqueList(nextRound.keepConstraints || ['主体', '品牌约束', '构图大方向']),
    feedbackToNextRound: { source: 'workbench-reject-dialog', assetIds: sourceAssetIds, reasonIds, reasons, note },
    note: '基于不采用原因修正：' + reasonText + (note ? '。' + note : '')
  };
}

function runExecutionPresentationFromCounts(run, statusCounts) {
  if (!run) return runExecutionPresentation(null, EMPTY);
  if (['completed', 'partial', 'failed', 'cancelled', 'paused', 'resume_pending', 'pausing'].includes(run.status)) return statusPresentation('run', run.status);
  const counts = statusCounts && typeof statusCounts === 'object' ? statusCounts : {};
  if (['requesting', 'receiving', 'persisting'].some((status) => Number(counts[status] || 0) > 0)) return { label: '正在生成', tone: 'live' };
  if (Number(counts.leased || 0) > 0) return { label: '正在准备', tone: 'live' };
  if (Number(counts.retry_wait || 0) > 0) return { label: '等待重试', tone: 'quiet' };
  if (run.status === 'queued' || Number(counts.pending || 0) > 0) return { label: '排队中', tone: 'live' };
  return statusPresentation('run', run.status);
}

function surfaceTitle(view, project = null) {
  if (view === 'project-overview') return project?.name || '项目总览';
  return ({
    projects: '项目管理',
    tasks: '任务',
    lineage: '创作平台',
    'studio-overview': '批次对比',
    prompts: '计划',
    assets: '资产管理',
    trash: '回收站',
    'shared-assets': '共享素材',
    runs: '生成历史',
    deliveries: '资产交付',
    library: '规则资料',
    guide: '创作手册',
    troubleshoot: '疑难处理'
  })[view] || '项目管理';
}

function surfaceEyebrow(view, hasProject) {
  if (['library', 'shared-assets', 'guide', 'troubleshoot'].includes(view)) return '辅助';
  return hasProject ? '项目工作区' : 'Studio';
}

function surfaceSubtitle(view, project) {
  if (view === 'project-overview') return '项目总览 · 任务、素材与交付';
  if (view === 'library') return '任务类型、风格与品牌规则。';
  if (view === 'shared-assets') return '跨项目复用图片。';
  if (view === 'guide') return '工作流帮助。';
  if (view === 'troubleshoot') return '出问题时的状态、诊断与恢复指引。';
  if (project) return project.name;
  return '先选择或创建一个项目，再进入创作。';
}

function confirmationPlanSummary(round) {
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  const plan = round && typeof round.plan === 'object' && round.plan ? round.plan : {};
  const output = plan.output && typeof plan.output === 'object' ? plan.output : {};
  const facts = [plan.itemCount ? plan.itemCount + ' 张' : '', text(output.aspectRatio), text(output.resolution)].filter(Boolean);
  const head = facts.length ? '确认后，这版计划（' + facts.join(' · ') + '）会交给当前会话继续执行：先核算，再出图。' : '确认后，这版计划会交给当前会话继续执行：先核算，再出图。';
  return head + '在此之前的所有操作都不会产生费用。';
}

function ImageInspectorDialog({ assets, zoom, selectedAssetIds, selectionBusyIds, selectedProject, selectedTask, fallbackTask, selectedRound, readOnly = false, onClose, onZoom, onToggleDeliverable, onOpenDerive, onAddReference, onReject, onOpenReference }) {
  const single = assets.length === 1 ? assets[0] : null;
  const singleSelected = single ? selectedAssetIds.has(single.id) : false;
  // 对比不设上限：布局是自适应网格（repeat(auto-fit)），2/4/6/8 张都并排，5 张以上也不再纵向堆叠。
  const comparing = assets.length >= 2;
  const comparingLabel = assets.length + ' 张对比';
  // 当前看第几张：切图靠 ←→，手不必回鼠标。
  const [focusIndex, setFocusIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  // 批 D（第 8 批）G24②：资产/回收站入口是**只读查看**——评审的家在创作平台（§7.4 不做挑图主路径）。
  const canReview = !readOnly && typeof onToggleDeliverable === 'function';
  useEffect(() => {
    const onKeyDown = (event) => {
      // 焦点在输入框里时一律不抢键（8.9 #19：正在打字时的空格不该触发「就它了」）。
      const target = event.target;
      if (target && typeof target.closest === 'function' && target.closest('input, textarea, [contenteditable="true"]')) return;
      const next = reviewKeyAction({ key: event.key, index: focusIndex, count: assets.length, canReview });
      if (next.action === 'none') return;
      event.preventDefault();
      if (next.action === 'close') return onClose();
      // ⚠️ 切换目标由模型给（单一来源）。原实现拿 `REVIEW_ZOOM_MIN`(0.75) 当判据，
      // 1× 时条件也成立 → 永远设回 1×，「Enter 放大」那一半是死的（实测按 8 次纹丝不动）。
      if (next.action === 'toggle-zoom') return onZoom(reviewZoomToggleTarget(zoom));
      if (next.action === 'prev' || next.action === 'next') return setFocusIndex(next.index);
      const asset = assets[focusIndex];
      if (!asset) return;
      if (next.action === 'keep') return void onToggleDeliverable(asset);
      if (next.action === 'reject') return onReject([asset], { createNextRound: false });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [assets, focusIndex, zoom, canReview, onClose, onZoom, onToggleDeliverable, onReject]);
  return <AccessibleDialog className={'image-inspector' + (fullscreen ? ' is-fullscreen' : '')} label={comparing ? comparingLabel : '素材放大查看'} onDismiss={onClose}>
    <div className="inspector-toolbar"><span>{comparing ? comparingLabel + ' · ← → 切图' + (readOnly ? '' : ' · 空格保留 · X 不采用') + ' · Enter 缩放' : '素材查看 · ← → 切图 · Enter 缩放'}</span><div><IconButton label="缩小" disabled={clampReviewZoom(zoom) <= REVIEW_ZOOM_MIN} onClick={() => onZoom(reviewZoomStep(zoom, -1))}><ZoomOut size={16} /></IconButton><IconButton label="放大" disabled={clampReviewZoom(zoom) >= REVIEW_ZOOM_MAX} onClick={() => onZoom(reviewZoomStep(zoom, 1))}><ZoomIn size={16} /></IconButton><IconButton label={fullscreen ? '退出铺满' : '铺满查看'} onClick={() => setFullscreen((value) => !value)}><Maximize2 size={16} /></IconButton><IconButton label="关闭查看" onClick={onClose}><X size={16} /></IconButton></div></div>
    <div className={'inspector-images ' + (comparing ? 'is-compare' : '')}>{assets.map((asset, index) => { const selected = selectedAssetIds.has(asset.id); const busy = selectionBusyIds.has(asset.id); return <figure className={(selected ? 'is-selected' : '') + (index === focusIndex ? ' is-keyboard-focus' : '')} key={asset.id}>{selectedProject && !asset.deletedAt && !readOnly && <label className="inspector-select-control"><input type="checkbox" checked={selected} disabled={busy} onChange={() => void onToggleDeliverable(asset)} /><span>{selected ? <Check size={15} /> : <Bookmark size={15} />}{busy ? '正在保存' : selected ? '已选成果' : '选为成果'}</span></label>}<div className="inspector-image-frame" style={{ '--inspector-zoom': zoom }}><img src={assetOriginalUrl(asset)} alt="" /></div><figcaption>{asset.display?.label || (comparing ? (index + 1) + ' / ' + assets.length : '素材')}</figcaption></figure>; })}</div>
    {readOnly ? <p className="inspector-readonly-note">挑图与评审在创作平台；这里只做查看。</p> : <div className="inspector-action-bar" aria-label="图片继续操作">
      {single ? <button type="button" className="outline-button" onClick={() => void onToggleDeliverable(single)}><Bookmark size={15} />{singleSelected ? '移出成果' : '选为成果'}</button> : <button type="button" className="outline-button" onClick={() => assets.forEach((asset) => void onToggleDeliverable(asset))}>都选为成果</button>}
      <CreativeActionLauncher assets={assets} selectedTask={selectedTask} fallbackTask={fallbackTask} selectedRound={selectedRound} label={single ? '用这张继续' : '用这组继续'} onOpenDerive={onOpenDerive} onAddReference={onAddReference} onReject={onReject} onOpenReference={onOpenReference} />
      <button type="button" className="outline-button" onClick={() => onReject(assets, { createNextRound: false })}><X size={15} />不采用</button>
    </div>}
  </AccessibleDialog>;
}

/**
 * 版本协商闸门（方案 9.4）：授权之后、渲染 App 之前，先用**不带协议头**的
 * `/api/studio` 和后台握一次手。不兼容时给一句人话，而不是让每个请求神秘失败。
 */
class WorkbenchErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error) { window.__daogeWorkbenchRenderError = error instanceof Error ? error.stack || error.message : String(error); }

  render() {
    if (this.state.failed) return <main className="fatal-error"><CircleAlert size={24} /><div><h1>无法显示工作台</h1><p>详情内容未能安全显示。刷新后可继续使用 Studio。</p></div><button type="button" className="command-button" onClick={() => window.location.reload()}>刷新</button></main>;
    return this.props.children;
  }
}

function StudioVersionGate() {
  const [attempt, setAttempt] = useState(0);
  const [negotiation, setNegotiation] = useState(null);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/studio', versionProbeRequest({ signal: controller.signal }));
        const payload = await response.json().catch(() => null);
        const studio = payload && payload.ok === true ? payload.data : null;
        if (current) setNegotiation(negotiateStudioVersion(studio));
      } catch (error) {
        if (current && !isAbortError(error)) setNegotiation({ compatible: false, message: '无法连接到本地 Studio。请确认后台服务在运行后重试。' });
      }
    })();
    return () => { current = false; controller.abort(); };
  }, [attempt]);

  if (!negotiation) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  if (negotiation.compatible) return <App />;
  return <main className="local-auth-failure" role="alert"><CircleAlert size={26} /><div><h1>界面与后台服务版本不一致</h1><p>{negotiation.message}</p></div><button type="button" className="command-button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} />重新检查</button></main>;
}

function LocalStudioAuthorizationGate() {
  const [attempt, setAttempt] = useState(0);
  const [authorizationError, setAuthorizationError] = useState('');
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let current = true;
    setAuthorizationError('');
    setAuthorized(false);
    void bootstrapLocalStudioSession().then(() => {
      if (current) setAuthorized(true);
    }).catch((nextError) => {
      if (current) setAuthorizationError(errorMessageForDisplay(nextError, '本地 Studio 授权失败。请重试。'));
    });
    return () => { current = false; };
  }, [attempt]);

  if (authorized) return <StudioVersionGate />;
  if (!authorizationError) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在验证本地 Studio 授权</span></div>;
  return <main className="local-auth-failure" role="alert"><CircleAlert size={26} /><div><h1>无法授权本地 Studio</h1><p>{authorizationError}</p></div><button type="button" className="command-button" onClick={() => setAttempt((value) => value + 1)}><RefreshCw size={16} />重试授权</button></main>;
}

function App() {
  const [studio, setStudio] = useState(null);
  const [provider, setProvider] = useState(null);
  const [projects, setProjects] = useState(EMPTY);
  const [assets, setAssets] = useState(EMPTY);
  const [sharedAssets, setSharedAssets] = useState(EMPTY);
  const [taskTypes, setTaskTypes] = useState(EMPTY);
  const [styleKits, setStyleKits] = useState(EMPTY);
  const [brandKits, setBrandKits] = useState(EMPTY);
  const [deliveries, setDeliveries] = useState(EMPTY);
  const [deliveryBatches, setDeliveryBatches] = useState(EMPTY);
  const [taskOverview, setTaskOverview] = useState(null);
  const [studioOverview, setStudioOverview] = useState(null);
  const [batchName, setBatchName] = useState('');
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState(new Set());
  const [creativeRecord, setCreativeRecord] = useState(null);
  const [assetProvenance, setAssetProvenance] = useState(null);
  const [deliveryBusyId, setDeliveryBusyId] = useState(null);
  const [deliveryCompletion, setDeliveryCompletion] = useState(null);
  const [deliveryCreating, setDeliveryCreating] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState(new Set());
  // G1：画布圈选（与「选片」是两条链）。只用于「这一句话指哪些图」，不落库、不持久化。
  const [canvasSelectedAssetIds, setCanvasSelectedAssetIds] = useState(EMPTY);
  const [selectedImportNeed, setSelectedImportNeed] = useState('');
  const [projectTemplates, setProjectTemplates] = useState(EMPTY);
  const [selectionAssets, setSelectionAssets] = useState(EMPTY);
  const [selectionBusyIds, setSelectionBusyIds] = useState(new Set());
  const [deliveryName, setDeliveryName] = useState('');
  const [deliveryIncludeCreativeRecord, setDeliveryIncludeCreativeRecord] = useState(true);
  const [assetFilter, setAssetFilter] = useState('all');
  const [assetPage, setAssetPage] = useState(1);
  const [assetPageSize, setAssetPageSize] = useState(() => normalizeAssetPageSize(window.localStorage.getItem(ASSET_PAGE_SIZE_KEY) || DEFAULT_ASSET_PAGE_SIZE));
  const [assetPreviewFit, setAssetPreviewFit] = useState(() => { const saved = window.localStorage.getItem(ASSET_PREVIEW_FIT_KEY); return saved === 'cover' || saved === 'cover-top' ? 'cover-top' : saved === 'adaptive' ? 'adaptive' : 'contain'; });
  const [assetTotal, setAssetTotal] = useState(0);
  const [previewAssets, setPreviewAssets] = useState([]);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [advancedDetails, setAdvancedDetails] = useState(null);
  const [planVersions, setPlanVersions] = useState(EMPTY);
  const [planVersionsLoading, setPlanVersionsLoading] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(() => window.localStorage.getItem(RAIL_COLLAPSE_KEY) === '1');
  const [providerDetails, setProviderDetails] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [confirmationBusy, setConfirmationBusy] = useState(false);
  const [confirmationError, setConfirmationError] = useState('');
  const [generationConfirmation, setGenerationConfirmation] = useState(null);
  const [generationConfirmationBusy, setGenerationConfirmationBusy] = useState(false);
  const [generationConfirmationError, setGenerationConfirmationError] = useState('');
  const [creationDialog, setCreationDialog] = useState(null);
  const [creationBusy, setCreationBusy] = useState(false);
  const [creationError, setCreationError] = useState('');
  const [referenceDialog, setReferenceDialog] = useState(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [referenceError, setReferenceError] = useState('');
  const [referenceResolver, setReferenceResolver] = useState(null);
  const [pendingReferenceAfterRound, setPendingReferenceAfterRound] = useState(null);
  const [derivedDialog, setDerivedDialog] = useState(null);
  const [derivedBusy, setDerivedBusy] = useState(false);
  const [derivedError, setDerivedError] = useState('');
  const [rejectDialog, setRejectDialog] = useState(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [rejectError, setRejectError] = useState('');

  const [tasks, setTasks] = useState(EMPTY);
  const [rounds, setRounds] = useState(EMPTY);
  const [runs, setRuns] = useState(EMPTY);
  const [sessionPlanStatus, setSessionPlanStatus] = useState(null);
  const [runItemPage, setRunItemPage] = useState(EMPTY_RUN_ITEM_PAGE);
  const [lineageRunItems, setLineageRunItems] = useState(EMPTY);
  const [lineageRunItemCoverage, setLineageRunItemCoverage] = useState(EMPTY_LINEAGE_RUN_ITEM_COVERAGE);
  const [lineageAssetCoverage, setLineageAssetCoverage] = useState(EMPTY_LINEAGE_ASSET_COVERAGE);
  const [selectedRunItemIds, setSelectedRunItemIds] = useState(new Set());
  const [runItemDetailId, setRunItemDetailId] = useState(null);
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState(() => parseWorkbenchRoute(window.location.search));
  const [contextError, setContextError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(/** @type {WorkbenchErrorState} */ (''));
  const [notice, setNotice] = useState('');
  const [cancelUndo, setCancelUndo] = useState(/** @type {{ runId: string, startedAt: number, expiresAt: number } | null} */ (null));
  const [cancelUndoNow, setCancelUndoNow] = useState(() => Date.now());
  const [agentConnection, setAgentConnection] = useState(() => readAgentConnectionConfig(typeof window === 'undefined' ? null : window.localStorage));
  const [connectionError, setConnectionError] = useState(/** @type {WorkbenchErrorState} */ (''));
  const [runtimeRepairing, setRuntimeRepairing] = useState(false);
  const [recoveryPhase, setRecoveryPhase] = useState('ready');
  const [pendingDerivedAfterTask, setPendingDerivedAfterTask] = useState(null);
  // 4.1 Q1：卡片上的「改一下」要真的展开那套控件——把「去画布打开这一批的计划编辑」记成一个待办，
  // 由画布在拿到对应节点时消费（跨组件只传一个 id，不传回调，避免把画布内部状态暴露出去）。
  const [pendingPlanEditRoundId, setPendingPlanEditRoundId] = useState(/** @type {string | null} */ (null));
  const [batchBusy, setBatchBusy] = useState(false);
  const [eventRevision, setEventRevision] = useState({ taskOverview: 0, creativeRecord: 0, studioOverview: 0, planVersions: 0, runs: 0, canvasLayout: 0, requests: 0 });
  const inputRef = useRef(null);
  const batchBusyRef = useRef(false);
  const batchOperationRef = useRef(null);
  const deliveryInteractionRef = useRef(null);
  const deliveryOperationEpoch = useRef(0);
  const activeProjectIdRef = useRef(null);
  const sessionRef = useRef(null);
  const selectedAssetIdsRef = useRef(new Set());
  const selectionBusyIdsRef = useRef(new Set());
  const selectionWriteQueue = useRef(Promise.resolve());
  const selectionMutationEpoch = useRef(0);
  const selectionProjectIdRef = useRef(null);
  const taskOverviewRequests = useRef(null);
  const creativeRecordRequests = useRef(null);
  const studioOverviewRequests = useRef(null);
  const planVersionRequests = useRef(null);
  const advancedDetailRequests = useRef(null);
  const assetRequests = useRef(null);
  const assetProvenanceRequests = useRef(null);
  const selectionRequests = useRef(null);
  const recoveryPhaseRef = useRef('ready');
  const recoveryTimerRef = useRef(null);
  const restartMonitorEpoch = useRef(0);
  const sharedAssetRequests = useRef(null);
  const eventRefreshQueueRef = useRef(null);
  const eventRefreshCallbacks = useRef(null);
  taskOverviewRequests.current ||= createLatestRequestGate();
  creativeRecordRequests.current ||= createLatestRequestGate();
  studioOverviewRequests.current ||= createLatestRequestGate();
  planVersionRequests.current ||= createLatestRequestGate();
  advancedDetailRequests.current ||= createLatestRequestGate();
  assetRequests.current ||= createLatestRequestGate();
  assetProvenanceRequests.current ||= createLatestRequestGate();
  selectionRequests.current ||= createLatestRequestGate();
  sharedAssetRequests.current ||= createLatestRequestGate();
  deliveryInteractionRef.current ||= createDeliveryInteractionGuard();
  useEffect(() => () => { restartMonitorEpoch.current += 1; if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current); assetProvenanceRequests.current?.cancel(); }, []);
  const { view, projectId: activeProjectId, taskId: activeTaskId, roundId: activeRoundId, compareRoundIds = EMPTY, runId: activeRunId, assetScope, runItemFilter: activeRunItemFilter = DEFAULT_RUN_ITEM_FILTER, runItemPage: activeRunItemPage = 1, runItemPageSize: activeRunItemPageSize = DEFAULT_RUN_ITEM_PAGE_SIZE, runItemSequence: activeRunItemSequence = null } = route;
  const routeView = rendererForWorkbenchView(view);
  const studioView = isStudioView(view);
  activeProjectIdRef.current = activeProjectId;
  sessionRef.current = session;
  const reportRequestError = useCallback((value, fallback, options = {}) => {
    const normalized = normalizeRequestError(value, fallback, options);
    if (normalized.category === 'connection') setConnectionError(normalized);
    else setError(normalized);
    return normalized;
  }, []);

  const navigateRoute = useCallback((changes, replace = false) => {
    const next = updateWorkbenchRoute(route, changes);
    const search = serializeWorkbenchRoute(next);
    window.history[replace ? 'replaceState' : 'pushState']({}, '', window.location.pathname + search);
    setRoute(next);
  }, [route]);

  useEffect(() => {
    const onPopState = () => { setRoute(parseWorkbenchRoute(window.location.search)); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  const { searchQuery, setSearchQuery, searchResults, searchLoading, searchError, openSearchResult } = useStudioSearch({ api, navigateRoute });
  // 请求队列：唯一事实源是 studio_requests；事件驱动重取，前端不造影子状态（方案 4.2 / 红线 1）。
  const { requests: studioRequests, pendingCount: pendingRequestCount, busy: requestBusy, send: sendRequest, withdraw: withdrawRequest } = useRequestQueue({ api, eventRevision: eventRevision.requests, reportError: reportRequestError });
  // 就地回答追问（8.10#8）：回答作为一条新请求，context 指回上一条，agent 据此「续上」而不靠记忆。
  const answerRequest = useCallback((request, answer) => sendRequest(answer, { projectId: request.projectId, taskId: request.taskId, previousRequestId: request.id }), [sendRequest]);
  // agent 在场（方案 4.6 的「显示是最要紧的」）：状态卡 + 输入框旁的「在场 ≠ 胜任」提示。
  const { presence: agentPresenceStatus } = useAgentPresence({ api, eventRevision: eventRevision.requests, reportError: reportRequestError });
  // C1 侦查按需触发（连接面板展开时），不在页面加载时扫宿主目录。
  const { detection: agentDetection, loading: agentDetectionLoading, detect: detectAgents } = useAgentDetection({ api, reportError: reportRequestError });
  // 队列是**全局底栏**，而它关联的批次可能不在当前视图已加载的数据里
  // （比如停在项目列表页、还没进项目）。缺的按 id 补取。
  //
  // ⚠️ 补取结果**不是一次性缓存**：批次状态会变（最典型的就是用户在闸门点了确认）。
  // 所以这里按 `progressRevision` 重取，而不是「已取过就永远跳过」——后者会让卡片
  // 一直显示确认前的旧状态，只有整页刷新才恢复。合并时当前视图优先（见 `queueRounds`）。
  const [linkedProgress, setLinkedProgress] = useState(() => new Map());
  const [progressRevision, setProgressRevision] = useState(0);
  useEffect(() => {
    const needed = [...new Set(studioRequests.map((request) => request.resultRoundId).filter(Boolean))]
      .filter((id) => !rounds.some((round) => round.id === id));
    if (!needed.length) return undefined;
    let cancelled = false;
    // `/api/rounds/:id` 同时给出批次、它最近的运行、以及槽位计数——
    // 有了这三样，卡片在**任何页面**都能算出真实进度（不必先进入那个项目/任务）。
    void Promise.all(needed.map((id) => api('/api/rounds/' + encodeURIComponent(id))
      .then((data) => (data?.round ? [id, { round: data.round, latestRun: data.latestRun || null, tally: data.tally || null }] : null))
      .catch(() => null)))
      .then((fetched) => { if (!cancelled) setLinkedProgress((current) => new Map([...current, ...fetched.filter(Boolean)])); });
    return () => { cancelled = true; };
  }, [studioRequests, rounds, api, progressRevision]);
  const roundsForQueue = useMemo(() => queueRounds(rounds, linkedProgress), [rounds, linkedProgress]);
  // 「agent 到哪一步了」全部由已有事实算出来（请求状态 + 关联批次 + 运行 + 槽位），
  // 前端不新增、也不累加任何进度状态（红线：前端不造影子状态）。
  // ⚠️ 进度必须拿**视图自己的** rounds（不是已合并补取批次的 roundsForQueue）。
  // 模型靠「这一批在不在视图里」判断该用哪份数据：在视图里 → 用视图的运行与槽位（最新）；
  // 不在 → 才退回补取快照。传合并后的列表会让「在视图里」永远成立，
  // 于是补取的 latestRun/tally 永不生效（全局底栏就又算不出出图进度）。
  const progressForRequest = useCallback((request) => requestProgress(request, { rounds, runs, runItems: lineageRunItems, linked: linkedProgress }), [rounds, runs, lineageRunItems, linkedProgress]);

  const openWorkbenchSession = useCallback(async () => {
    if (session) return session;
    const nextSession = await api('/api/sessions/open', { method: 'POST', idempotencyKey: uniqueKey('session-open'), body: { conversationId: workbenchConversationId(window.sessionStorage) } });
    setSession(nextSession);
    return nextSession;
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    if (!session) void openWorkbenchSession().catch((nextError) => {
      if (!cancelled) reportRequestError(nextError, '无法建立当前 Workbench 会话。', { operation: 'open-workbench-session', phase: 'requesting' });
    });
    return () => { cancelled = true; };
  }, [openWorkbenchSession, reportRequestError, session]);

  const refreshStudio = useCallback(async (request) => {
    const signal = request.signal;
    const [studioData, providerData, projectData, projectTemplateData, taskTypeData, styleKitData, brandKitData, sharedAssetData] = await Promise.all([
      api('/api/studio', { signal }),
      api('/api/providers', { signal }),
      api('/api/projects', { signal }),
      api('/api/project-templates', { signal }),
      api('/api/task-types', { signal }),
      api('/api/style-kits', { signal }),
      api('/api/brand-kits', { signal }),
      api('/api/shared-assets', { signal })
    ]);
    if (!request.isCurrent()) throw new DOMException('Stale refresh', 'AbortError');
    const nextProjects = projectData.projects || [];
    setStudio(studioData);
    setProvider({ ...(providerData.status || {}), reconfigurationPending: providerData.runtime?.reconfigurationPending === true, runtime: providerData.runtime || null, recentOutcomes: providerData.recentOutcomes || [] });
    setProjects(nextProjects);
    setTaskTypes(taskTypeData.taskTypes || []);
    setProjectTemplates(projectTemplateData.templates || []);
    setStyleKits(styleKitData.styleKits || []);
    setBrandKits(brandKitData.brandKits || []);
    setSharedAssets(sharedAssetData.assets || []);
    return nextProjects;
  }, []);

  const refreshContext = useCallback(async (knownProjects, request) => {
    const requireCurrent = () => {
      if (!request.isCurrent()) throw new DOMException('Stale refresh', 'AbortError');
    };
    const load = async (path) => {
      const data = await api(path, { signal: request.signal });
      requireCurrent();
      return data;
    };
    const clearLineageRunData = () => {
      setLineageRunItems(EMPTY);
      setLineageRunItemCoverage(EMPTY_LINEAGE_RUN_ITEM_COVERAGE);
    };
    const loadLineageRunItems = async (lineageRuns) => {
      setLineageRunItems(EMPTY);
      setLineageRunItemCoverage(EMPTY_LINEAGE_RUN_ITEM_COVERAGE);
      let streamedItems = [];
      const onPage = ({ items, total, loading, replace }) => {
        if (replace) streamedItems = [...items];
        else streamedItems = [...streamedItems, ...items];
        setLineageRunItems(streamedItems);
        setLineageRunItemCoverage({ loaded: streamedItems.length, total: Math.max(streamedItems.length, Number(total) || 0), loading: loading === true });
      };
      const result = await loadCompleteLineageRunItems(lineageRuns, load, requireCurrent, onPage);
      requireCurrent();
      setLineageRunItems(result.items);
      setLineageRunItemCoverage({ loaded: result.loaded, total: result.total, loading: false });
      return result;
    };
    const loadLineageRunItemsInBackground = (lineageRuns) => {
      void loadLineageRunItems(lineageRuns).catch((nextError) => {
        if (isAbortError(nextError) || !request.isCurrent()) return;
        const normalized = normalizeRequestError(nextError, '无法读取谱系里的单张出图。', { operation: 'load-lineage-run-items', phase: 'loading' });
        if (normalized.category === 'connection') setConnectionError(normalized);
        else setError(normalized);
      });
    };
    const selectedProject = activeProjectId ? (knownProjects || []).find((project) => project.id === activeProjectId) || null : null;
    const loadLineageRuns = async (lineageRounds) => {
      if (view !== 'lineage' || !lineageRounds.length) return EMPTY;
      const runLists = await mapWithConcurrency(lineageRounds, (round) => load('/api/rounds/' + encodeURIComponent(round.id) + '/runs').then((data) => data.runs || EMPTY), ASSET_IMPORT_CONCURRENCY);
      requireCurrent();
      return runLists.flat();
    };
    if (activeProjectId && !selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); setDeliveries(EMPTY); setDeliveryBatches(EMPTY); clearLineageRunData();
      setContextError('该链接所指向的项目已不存在，或不属于当前 Studio。');
      return;
    }
    if (!selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); setDeliveries(EMPTY); setDeliveryBatches(EMPTY); clearLineageRunData();
      setContextError(activeTaskId || activeRoundId || activeRunId ? '请先选择一个项目，再继续查看任务、批次或运行。' : '');
      return;
    }
    const needsDeliveries = view === 'deliveries' || view === 'lineage';
    const [taskData, deliveryData, batchData] = await Promise.all([
      load('/api/projects/' + encodeURIComponent(selectedProject.id) + '/tasks'),
      needsDeliveries ? load('/api/projects/' + encodeURIComponent(selectedProject.id) + '/deliveries') : Promise.resolve({ deliveries: EMPTY }),
      needsDeliveries ? load('/api/projects/' + encodeURIComponent(selectedProject.id) + '/delivery-batches') : Promise.resolve({ batches: EMPTY })
    ]);
    requireCurrent();
    const nextTasks = taskData.tasks || [];
    setTasks(nextTasks);
    setDeliveries(deliveryData.deliveries || []);
    setDeliveryBatches(batchData.batches || []);
    const selectedTask = activeTaskId ? nextTasks.find((task) => task.id === activeTaskId) || null : null;
    if (activeTaskId && !selectedTask) {
      setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError('该任务不属于当前项目，或已不存在。');
      return;
    }
    if (!selectedTask) {
      if (view === 'lineage') {
        const roundLists = await mapWithConcurrency(nextTasks, (task) => load('/api/tasks/' + encodeURIComponent(task.id) + '/rounds').then((data) => data.rounds || EMPTY), ASSET_IMPORT_CONCURRENCY);
        const projectRounds = roundLists.flat();
        setRounds(projectRounds);
        const projectRuns = await loadLineageRuns(projectRounds);
        setRuns(projectRuns);
        setRunItemPage(EMPTY_RUN_ITEM_PAGE);
        loadLineageRunItemsInBackground(projectRuns);
        setContextError('');
        return;
      }
      setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError(activeRoundId || activeRunId ? '请先选择一个任务，再继续查看批次或运行。' : '');
      return;
    }
    const roundData = await load('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/rounds');
    const nextRounds = roundData.rounds || [];
    setRounds(nextRounds);
    const selectedRound = activeRoundId ? nextRounds.find((round) => round.id === activeRoundId) || null : null;
    if (activeRoundId && !selectedRound) {
      setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError('该批次不属于当前任务，或已不存在。');
      return;
    }
    if (!selectedRound) {
      if (view === 'lineage') {
        const taskRuns = await loadLineageRuns(nextRounds);
        setRuns(taskRuns);
        setRunItemPage(EMPTY_RUN_ITEM_PAGE);
        loadLineageRunItemsInBackground(taskRuns);
        setContextError('');
        return;
      }
      setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError(activeRunId ? '请先打开出图视图，再继续查看。' : '');
      return;
    }
    if (!['runs', 'lineage'].includes(view)) {
      setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError(activeRunId ? '请先打开出图视图，再继续查看。' : '');
      return;
    }
    const runData = await load('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/runs');
    const nextRuns = runData.runs || [];
    setRuns(nextRuns);
    const selectedRun = activeRunId ? nextRuns.find((run) => run.id === activeRunId) || null : null;
    if (view === 'lineage') {
      setRunItemPage(EMPTY_RUN_ITEM_PAGE);
      loadLineageRunItemsInBackground(nextRuns);
      setContextError(activeRunId && !selectedRun ? '该运行不属于当前批次，或已不存在。' : '');
      return;
    }
    clearLineageRunData();
    if (activeRunId && !selectedRun) {
      setRunItemPage(EMPTY_RUN_ITEM_PAGE);
      setContextError('该运行不属于当前批次，或已不存在。');
    } else if (selectedRun) {
      const itemQuery = serializeRunItemRequestQuery({ page: activeRunItemPage, pageSize: activeRunItemPageSize, filter: activeRunItemFilter, sequence: activeRunItemSequence });
      const itemData = await load('/api/runs/' + encodeURIComponent(selectedRun.id) + '/items?' + itemQuery);
      setRunItemPage(normalizeRunItemPage(itemData, activeRunItemPageSize));
      setContextError('');
    } else {
      setRunItemPage(EMPTY_RUN_ITEM_PAGE);
      setContextError('');
    }
  }, [activeProjectId, activeTaskId, activeRoundId, activeRunId, activeRunItemFilter, activeRunItemPage, activeRunItemPageSize, activeRunItemSequence, view]);

  const refreshAssets = useCallback(async () => {
    const lineageView = view === 'lineage';
    if (!['assets', 'trash', 'deliveries', 'lineage'].includes(view)) {
      assetRequests.current.cancel();
      setAssets(EMPTY);
      setAssetTotal(0);
      return true;
    }
    const pagination = ['assets', 'trash'].includes(view) ? { page: assetPage, pageSize: assetPageSize, filter: assetFilter } : lineageView ? { page: 1, pageSize: LINEAGE_ASSET_PAGE_SIZE, filter: 'all' } : null;
    const path = assetRefreshPath(route, pagination);
    if (!path) {
      setAssets(EMPTY);
      setAssetTotal(0);
      if (lineageView) setLineageAssetCoverage(EMPTY_LINEAGE_ASSET_COVERAGE);
      return true;
    }
    const request = assetRequests.current.begin(path);
    if (lineageView) setLineageAssetCoverage(EMPTY_LINEAGE_ASSET_COVERAGE);
    let streamedAssets = [];
    const onPage = ({ assets: pageAssets, total, replace }) => {
      if (!request.isCurrent()) return;
      streamedAssets = replace ? [...pageAssets] : [...streamedAssets, ...pageAssets];
      const nextTotal = Number.isInteger(total) ? Math.max(streamedAssets.length, total) : streamedAssets.length;
      setAssets(streamedAssets);
      setAssetTotal(nextTotal);
      if (lineageView) setLineageAssetCoverage({ loaded: streamedAssets.length, total: nextTotal, loading: true });
    };
    try {
      const data = lineageView ? await loadCompleteLineageAssets(route, (nextPath) => api(nextPath, { signal: request.signal }), () => { if (!request.isCurrent()) throw new DOMException('Stale refresh', 'AbortError'); }, onPage) : await api(path, { signal: request.signal });
      if (!request.isCurrent()) return false;
      const nextAssets = data.assets || EMPTY;
      const nextTotal = Number.isInteger(data.total) ? Math.max(nextAssets.length, data.total) : nextAssets.length;
      setAssets(nextAssets);
      setAssetTotal(nextTotal);
      if (lineageView) setLineageAssetCoverage({ loaded: nextAssets.length, total: nextTotal, loading: false });
      return true;
    } catch (nextError) {
      if (lineageView && request.isCurrent()) setLineageAssetCoverage((current) => ({ ...current, loading: true }));
      if (!isAbortError(nextError) && request.isCurrent()) reportRefreshError(nextError);
      return false;
    }
  }, [assetFilter, assetPage, assetPageSize, route, view]);

  const refreshSelection = useCallback(async () => {
    if (!activeProjectId) {
      selectionRequests.current.cancel();
      applyProjectSelection({ assets: EMPTY });
      return true;
    }
    const projectId = activeProjectId;
    const observedMutationEpoch = selectionMutationEpoch.current;
    const request = selectionRequests.current.begin(projectId + ':' + observedMutationEpoch);
    try {
      const data = await api('/api/projects/' + encodeURIComponent(projectId) + '/selection', { signal: request.signal });
      if (!request.isCurrent() || selectionProjectIdRef.current !== projectId || observedMutationEpoch !== selectionMutationEpoch.current) return false;
      applyProjectSelection(data.selection);
      return true;
    } catch (nextError) {
      if (!isAbortError(nextError) && request.isCurrent()) reportRequestError(nextError, '无法读取当前选片。', { operation: 'load-selection', phase: 'loading' });
      return false;
    }
  }, [activeProjectId, reportRequestError]);

  const refreshSharedAssets = useCallback(async () => {
    const request = sharedAssetRequests.current.begin('shared-assets');
    try {
      const data = await api('/api/shared-assets', { signal: request.signal });
      if (!request.isCurrent()) return false;
      setSharedAssets(data.assets || EMPTY);
      return true;
    } catch (nextError) {
      if (!isAbortError(nextError) && request.isCurrent()) reportRequestError(nextError, '无法读取共享素材。', { operation: 'load-shared-assets', phase: 'loading' });
      return false;
    }
  }, [reportRequestError]);

  const reportRefreshError = useCallback((nextError) => {
    reportRequestError(nextError, '无法刷新当前 Workbench。', { operation: 'refresh-workbench', phase: 'loading' });
  }, [reportRequestError]);
  const { refreshAll, refreshContext: refreshCurrentContext } = useRouteRefresh({
    route,
    beforeRefresh: openWorkbenchSession,
    refreshGlobal: refreshStudio,
    refreshContext,
    onError: reportRefreshError,
    onSettled: () => setLoading(false)
  });
  const refresh = useCallback(async () => {
    // 任何一次刷新都让「按 id 补取的批次快照」重取一遍——批次状态会变，
    // 而卡片可能不在当前视图里（否则确认后卡片会停在旧状态，见 linkedProgress 注释）。
    setProgressRevision((current) => current + 1);
    const refreshed = await refreshAll();
    return refreshed ? refreshAssets() : false;
  }, [refreshAll, refreshAssets]);
  useEffect(() => {
    void refreshAssets();
    return () => assetRequests.current.cancel();
  }, [refreshAssets]);
  const applyEventRefreshPlan = useCallback((plan) => {
    setEventRevision((current) => ({
      taskOverview: current.taskOverview + (plan.taskOverview ? 1 : 0),
      creativeRecord: current.creativeRecord + (plan.creativeRecord ? 1 : 0),
      studioOverview: current.studioOverview + (plan.studioOverview ? 1 : 0),
      planVersions: current.planVersions + (plan.planVersions ? 1 : 0),
      runs: current.runs + (plan.refreshContext ? 1 : 0),
      canvasLayout: current.canvasLayout + (plan.refreshCanvasLayout || plan.canvasLayout ? 1 : 0),
      requests: current.requests + (plan.requests ? 1 : 0)
    }));
  }, []);
  eventRefreshCallbacks.current = {
    refresh: async (plan) => {
      const contextRefresh = plan.refreshContext ? (plan.scope === 'all' ? refreshAll() : refreshCurrentContext()) : Promise.resolve(true);
      const assetRefresh = plan.refreshAssets ? refreshAssets() : Promise.resolve(true);
      const selectionRefresh = plan.refreshSelection ? refreshSelection() : Promise.resolve(true);
      const sharedRefresh = plan.refreshSharedAssets && plan.scope !== 'all' ? refreshSharedAssets() : Promise.resolve(true);
      const refreshed = await Promise.all([contextRefresh, assetRefresh, selectionRefresh, sharedRefresh]);
      return refreshed.every(Boolean);
    },
    applyPlan: applyEventRefreshPlan
  };
  eventRefreshQueueRef.current ||= createEventRefreshQueue({
    refresh: (plan) => eventRefreshCallbacks.current.refresh(plan),
    applyPlan: (plan) => eventRefreshCallbacks.current.applyPlan(plan)
  });
  useEffect(() => () => eventRefreshQueueRef.current?.dispose(), []);
  // 「出完了叫我」（方案 9.5）：用户不在看页面时，出图有进展就记一次未读。
  // 判定与文案都在 completion-notice-model 里（纯逻辑、有单测），这里只是接线。
  const [unreadCompletions, setUnreadCompletions] = useState(0);
  const refreshForEvents = useCallback((events) => {
    if (shouldMarkUnread({ hidden: document.hidden, hasSignal: hasCompletionSignal(events) })) {
      setUnreadCompletions((count) => count + 1);
    }
    eventRefreshQueueRef.current.request(studioEventRefreshPlan(events));
  }, []);
  // 标题栏挂未读数：切走之后、回来之前，瞟一眼就知道「有新东西」。
  useEffect(() => { document.title = noticeTitle(BASE_DOCUMENT_TITLE, unreadCompletions); }, [unreadCompletions]);
  // 回到页面即清零——否则计数只增不减，数字就失去意义了。
  useEffect(() => {
    const clearWhenVisible = () => { if (!document.hidden) setUnreadCompletions(0); };
    document.addEventListener('visibilitychange', clearWhenVisible);
    return () => document.removeEventListener('visibilitychange', clearWhenVisible);
  }, []);
  // 系统通知**只在已授权时**才发；没授权就静默降级成「只有标题栏提示」，绝不主动索要权限。
  useEffect(() => {
    if (!unreadCompletions) return;
    if (!shouldSendNotification(typeof Notification === 'undefined' ? undefined : Notification.permission)) return;
    try { new Notification(BASE_DOCUMENT_TITLE, { body: completionNotificationCopy(unreadCompletions) }); } catch { /* 通知失败不影响使用 */ }
  }, [unreadCompletions]);
  const refreshSnapshot = useCallback(async () => {
    const refreshed = await refresh();
    const selectionRefreshed = refreshed ? await refreshSelection() : false;
    if (refreshed && selectionRefreshed) applyEventRefreshPlan({ taskOverview: true, creativeRecord: true, studioOverview: true, planVersions: true, refreshContext: true, canvasLayout: true });
    return refreshed && selectionRefreshed;
  }, [refresh, refreshSelection, applyEventRefreshPlan]);
  const updateRecoveryPhase = useCallback((phase) => { recoveryPhaseRef.current = phase; setRecoveryPhase(phase); }, []);
  const finishStudioRecovery = useCallback(async () => {
    if (!['stopping', 'reconnecting'].includes(recoveryPhaseRef.current)) return true;
    const restored = await refreshSnapshot();
    if (!restored) return false;
    restartMonitorEpoch.current += 1;
    setConnectionError('');
    updateRecoveryPhase('restored');
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = window.setTimeout(() => updateRecoveryPhase('ready'), 2400);
    return true;
  }, [refreshSnapshot, updateRecoveryPhase]);
  const monitorStudioRestart = useCallback(async (epoch, previousStartedAt) => {
    for (let attempt = 0; attempt < 100 && restartMonitorEpoch.current === epoch; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 150));
      try {
        const next = await api('/api/studio');
        const nextStartedAt = next?.runtime?.startedAt;
        if ((!previousStartedAt && nextStartedAt) || (previousStartedAt && nextStartedAt && nextStartedAt !== previousStartedAt)) {
          await finishStudioRecovery();
          return;
        }
      } catch { /* daemon is inside the expected restart gap */ }
    }
    if (restartMonitorEpoch.current === epoch) setError(createWorkbenchError({ category: 'connection', message: 'Studio 重启超时。请复制隐去隐私的诊断信息，并查看后台服务日志。' }, { category: 'connection', phase: 'reconnecting', safeToRetry: false }));
  }, [finishStudioRecovery]);
  const beginStudioRestart = useCallback(() => {
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
    const epoch = ++restartMonitorEpoch.current;
    updateRecoveryPhase('stopping');
    void monitorStudioRestart(epoch, studio?.runtime?.startedAt || null);
  }, [monitorStudioRestart, studio?.runtime?.startedAt, updateRecoveryPhase]);
  const handleConnectionError = useCallback((message) => {
    if (!message) {
      setConnectionError('');
      return;
    }
    setConnectionError(createWorkbenchError({ category: 'connection', message: errorMessageForDisplay(message) }, { category: 'connection', phase: 'streaming', safeToRetry: false }));
    updateRecoveryPhase('reconnecting');
  }, [updateRecoveryPhase]);
  const handleStreamRequestError = useCallback((message) => {
    if (message) setError(createWorkbenchError({ category: 'connection', message: errorMessageForDisplay(message) }, { category: 'connection', phase: 'streaming', safeToRetry: false }));
  }, []);
  const handleReconnected = useCallback(async () => { await finishStudioRecovery(); }, [finishStudioRecovery]);
  const reconnectStudio = useCallback(async () => {
    setConnectionError('');
    updateRecoveryPhase('reconnecting');
    return finishStudioRecovery();
  }, [finishStudioRecovery, updateRecoveryPhase]);
  const reconnectWorkbenchError = useCallback((nextError, clear) => {
    clear('');
    if (nextError?.category === 'auth') {
      window.location.reload();
      return;
    }
    void reconnectStudio();
  }, [reconnectStudio]);
  const retryWorkbenchError = useCallback(async (nextError, clear) => {
    if (!hasWorkbenchErrorMetadata(nextError) || !canRetryWorkbenchError(nextError) || typeof nextError.retry !== 'function') return;
    clear('');
    try {
      await nextError.retry();
      await refresh();
    } catch (retryError) {
      const safeRetryError = !retryError ? '无法重试当前工作台请求。' : typeof retryError === 'string' ? retryError : hasWorkbenchErrorMetadata(retryError) ? retryError : createWorkbenchError(retryError, { operation: 'retry-workbench', phase: 'retrying' });
      clear(safeRetryError);
    }
  }, [refresh]);
  useStudioEvents({
    studioId: studio?.studioId || null,
    onEventBatch: refreshForEvents,
    onSnapshot: refreshSnapshot,
    onConnectionError: handleConnectionError,
    onReconnected: handleReconnected,
    onRequestError: handleStreamRequestError
  });

  const copyRuntimeDiagnostic = async () => {
    try {
      const diagnostic = redactedRuntimeDiagnostic({ studio, provider, recoveryPhase, connectionError });
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器未提供剪贴板权限。');
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
      setNotice('已复制隐去隐私的运行诊断；内容不含生成服务密钥或工作区路径。');
    } catch (nextError) { reportRequestError(nextError, '无法复制诊断信息。', { operation: 'copy-runtime-diagnostic', phase: 'committing' }); }
  };
  const repairRuntime = async () => {
    if (runtimeRepairing) return;
    setRuntimeRepairing(true);
    try {
      await api('/api/restart', { method: 'POST', idempotencyKey: uniqueKey('runtime-repair'), body: {} });
      beginStudioRestart();
    } catch (nextError) { reportRequestError(nextError, '无法安全重启 Studio。', { operation: 'restart-studio', phase: 'requesting' }); }
    finally { setRuntimeRepairing(false); }
  };
  useEffect(() => {
    if (!session) { setSessionPlanStatus(null); return undefined; }
    const controller = new AbortController();
    let current = true;
    void api('/api/sessions/' + encodeURIComponent(session.id) + '/plan-status', { signal: controller.signal }).then((data) => {
      if (current) setSessionPlanStatus(data);
    }).catch((nextError) => {
      if (current && !isAbortError(nextError)) reportRequestError(nextError, '无法读取当前会话计划状态。', { operation: 'load-session-plan-status', phase: 'loading' });
    });
    return () => { current = false; controller.abort(); };
  }, [session?.id, session?.version, eventRevision.planVersions, eventRevision.creativeRecord, eventRevision.runs, reportRequestError]);

  const selectedProject = useMemo(() => activeProjectId ? projects.find((project) => project.id === activeProjectId) || null : null, [projects, activeProjectId]);
  const { qualityMetrics, qualityMetricsLoading, qualityMetricsError, refreshQualityMetrics } = useProjectQualityMetrics({ api, projectId: selectedProject?.id || null, view });
  const selectedTask = useMemo(() => activeTaskId ? tasks.find((task) => task.id === activeTaskId) || null : null, [tasks, activeTaskId]);
  const selectedRound = useMemo(() => activeRoundId ? rounds.find((round) => round.id === activeRoundId) || null : null, [rounds, activeRoundId]);
  const activeRun = useMemo(() => activeRunId ? runs.find((run) => run.id === activeRunId) || null : null, [runs, activeRunId]);
  useEffect(() => {
    if (!pendingDerivedAfterTask || !selectedTask || pendingDerivedAfterTask.taskId !== selectedTask.id) return;
    setDerivedError('');
    setDerivedDialog({ assets: pendingDerivedAfterTask.assets, purpose: pendingDerivedAfterTask.purpose, actionId: pendingDerivedAfterTask.actionId });
    setPendingDerivedAfterTask(null);
  }, [pendingDerivedAfterTask, selectedTask?.id]);
  useEffect(() => {
    deliveryOperationEpoch.current += 1;
    deliveryInteractionRef.current.reset();
    setDeliveryCreating(false);
    if (!selectedProject) { setDeliveryCompletion(null); return; }
    try {
      const stored = JSON.parse(window.localStorage.getItem(DELIVERY_COMPLETION_PREFIX + selectedProject.id) || 'null');
      setDeliveryCompletion(stored?.projectId === selectedProject.id && stored?.operationId ? stored : null);
    } catch {
      window.localStorage.removeItem(DELIVERY_COMPLETION_PREFIX + selectedProject.id);
      setDeliveryCompletion(null);
    }
  }, [selectedProject?.id]);
  // 取消运行后的 5 秒撤销窗口（#21）：只做倒计时与到点关闭，取消本身已经生效。
  useEffect(() => {
    if (!cancelUndo) return undefined;
    setCancelUndoNow(Date.now());
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (!cancelUndoAvailable(cancelUndo, now)) { setCancelUndo(null); return; }
      setCancelUndoNow(now);
    }, 250);
    return () => window.clearInterval(timer);
  }, [cancelUndo]);
  const visibleAssets = view === 'trash' ? assets.filter((asset) => asset.deletedAt) : assets.filter((asset) => !asset.deletedAt);
  const selectedAssets = selectionAssets.filter((asset) => !asset.deletedAt);
  const totalAssetPages = assetPageCount(assetTotal, assetPageSize);
  const allPageAssetsSelected = visibleAssets.length > 0 && visibleAssets.every((asset) => selectedAssetIds.has(asset.id));
  const pageSelectionBusy = visibleAssets.some((asset) => selectionBusyIds.has(asset.id));
  const sharedAssetIds = useMemo(() => new Set(sharedAssets.map((asset) => asset.id)), [sharedAssets]);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const referenceMaterials = useMemo(() => normalizeReferenceMaterials(selectedRound?.plan || {}), [selectedRound?.id, selectedRound?.version, selectedRound?.plan]);
  const contextMaterialNeeds = useMemo(() => materialNeedsForContext(selectedProject, selectedTask, selectedRound, projectTemplates), [selectedProject, selectedTask, selectedRound, projectTemplates]);
  const materialNeedCounts = useMemo(() => materialNeedCompletionCounts(contextMaterialNeeds, assets, referenceMaterials), [contextMaterialNeeds.join('|'), assets, referenceMaterials]);
  const selectionAssetById = useMemo(() => new Map(selectionAssets.map((asset) => [asset.id, asset])), [selectionAssets]);
  const deliveryFlowAssets = deliveryCompletion ? deliveryCompletion.assetIds.map((assetId) => assetById.get(assetId) || selectionAssetById.get(assetId) || { id: assetId, display: { label: '已冻结交付图片' } }) : selectedAssets;
  
  const visibleRunItems = runItemPage.items;
  const lineageVisibleRunItems = view === 'lineage' ? lineageRunItems : visibleRunItems;
  const runExecutionStatus = runExecutionPresentationFromCounts(activeRun, runItemPage.statusCounts);
  const runItemDetail = useMemo(() => runItemDetailId ? visibleRunItems.find((item) => item.id === runItemDetailId) || null : null, [runItemDetailId, visibleRunItems]);
  const runLifecycleStatus = activeRun ? statusPresentation('run', activeRun.status) : null;
  const canCancelActiveRun = Boolean(activeRun && !['completed', 'cancelled'].includes(activeRun.status));
  const uploadTarget = resolveUploadTarget({ assetScope, selectedRound, selectedTask, selectedProject });
  const canImport = ['assets', 'lineage'].includes(view) && Boolean(selectedProject);
  const importLabel = selectedImportNeed ? '导入“' + selectedImportNeed + '”' : selectedRound && assetScope === 'round' ? '添加为本轮参考' : '导入到项目';
  const deliverySelection = useMemo(() => projectDeliverySelection(selectedProject?.id || null, selectedAssets), [selectedProject?.id, selectedAssets]);
  const selectedDeliveryAssets = deliverySelection.eligibleAssets;
  // G4：「拿出去」挂选中——给得出就可用、给不出给人话（绝不给点了没用的按钮）。
  const deliveryIntent = deliveryIntentFromSelection({ projectId: selectedProject?.id || null, selection: deliverySelection });
  // P3/P4：provider 的运行时真相（限流/退避）与「还没配生成服务」都要在**不打开设置**的地方可见（决策 D2）。
  const providerNotice = providerRuntimeNotice(provider?.runtime) || (provider?.configured === false ? providerOutageCopy({ kind: 'not_configured' }) : '');
  // P4：整层故障（全挂 / 磁盘满）走**首屏级**提示条——由服务端给的「最近几次终态运行」事实判定，
  // 分类复用 failure-copy-model 的单一来源（providerOutageKind）。
  const providerOutage = providerOutageKind({ recentOutcomes: provider?.recentOutcomes });

  const eligibleDeliveryIds = useMemo(() => new Set(deliveries.filter((delivery) => ['ready', 'exported'].includes(delivery.status)).map((delivery) => delivery.id)), [deliveries]);

  useEffect(() => {
    setAssetPage(1);
  }, [view, activeProjectId, activeTaskId, activeRoundId, assetScope]);
  useEffect(() => {
    setSelectedImportNeed((current) => contextMaterialNeeds.includes(current) ? current : contextMaterialNeeds[0] || '');
  }, [contextMaterialNeeds.join('|'), activeProjectId, activeTaskId, activeRoundId]);
  useEffect(() => {
    const nextPage = clampAssetPage(assetPage, assetTotal, assetPageSize);
    if (nextPage !== assetPage) setAssetPage(nextPage);
  }, [assetPage, assetTotal, assetPageSize]);
  useEffect(() => {
    window.localStorage.setItem(ASSET_PAGE_SIZE_KEY, String(assetPageSize));
  }, [assetPageSize]);
  useEffect(() => {
    window.localStorage.setItem(ASSET_PREVIEW_FIT_KEY, assetPreviewFit);
  }, [assetPreviewFit]);
  useEffect(() => {
    if (view === 'runs' && activeRun && runItemPage.page !== activeRunItemPage) navigateRoute({ runItemPage: runItemPage.page }, true);
  }, [view, activeRun?.id, runItemPage.page, activeRunItemPage, navigateRoute]);
  useEffect(() => {
    setSelectedRunItemIds(new Set());
    setRunItemDetailId(null);
  }, [activeRunId, activeRunItemFilter, activeRunItemSequence]);
  useEffect(() => {
    const allowed = new Set(retryableRunItems(visibleRunItems).map((item) => item.id));
    setSelectedRunItemIds((current) => {
      const next = new Set([...current].filter((id) => allowed.has(id)));
      return next.size === current.size ? current : next;
    });
    if (runItemDetailId && !visibleRunItems.some((item) => item.id === runItemDetailId)) setRunItemDetailId(null);
  }, [visibleRunItems, runItemDetailId]);
  useEffect(() => {
    window.localStorage.setItem(RAIL_COLLAPSE_KEY, railCollapsed ? '1' : '0');
  }, [railCollapsed]);

  useEffect(() => {
    batchOperationRef.current = null;
    setBatchName('');
    setSelectedDeliveryIds(new Set());
  }, [activeProjectId]);

  useEffect(() => {
    if (selectionProjectIdRef.current !== activeProjectId) {
      selectionProjectIdRef.current = activeProjectId;
      selectionMutationEpoch.current += 1;
      selectedAssetIdsRef.current = new Set();
      selectionBusyIdsRef.current = new Set();
      setSelectedAssetIds(new Set());
      setSelectionAssets(EMPTY);
      setSelectionBusyIds(new Set());
    }
    if (!activeProjectId) return undefined;
    void refreshSelection();
    return () => selectionRequests.current.cancel();
  }, [activeProjectId, refreshSelection]);

  useEffect(() => {
    if (!selectedTask) { taskOverviewRequests.current.cancel(); setTaskOverview(null); return undefined; }
    const request = taskOverviewRequests.current.begin(selectedTask.id + ':' + eventRevision.taskOverview);
    void api('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/overview', { signal: request.signal }).then((data) => {
      if (request.isCurrent()) setTaskOverview(data.overview || null);
    }).catch((nextError) => {
      if (request.isCurrent() && !isAbortError(nextError)) reportRequestError(nextError, '无法读取任务创作概览。', { operation: 'load-task-overview', phase: 'loading' });
    });
    return () => request.abort();
  }, [reportRequestError, selectedTask?.id, eventRevision.taskOverview]);
  useEffect(() => {
    if (!selectedRound) { creativeRecordRequests.current.cancel(); setCreativeRecord(null); return undefined; }
    const params = new URLSearchParams();
    params.set('includeItems', '0');
    if (activeRunId) params.set('runId', activeRunId);
    const signature = [selectedRound.id, activeRunId || '', eventRevision.creativeRecord].join(':');
    const request = creativeRecordRequests.current.begin(signature);
    void api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/creative-record?' + params.toString(), { signal: request.signal }).then((data) => {
      if (request.isCurrent()) setCreativeRecord(data.record || null);
    }).catch((nextError) => {
      if (request.isCurrent() && !isAbortError(nextError)) reportRequestError(nextError, '无法读取批次创作记录。', { operation: 'load-creative-record', phase: 'loading' });
    });
    return () => request.abort();
  }, [reportRequestError, selectedRound?.id, activeRunId, eventRevision.creativeRecord]);
  useEffect(() => {
    if (view !== 'studio-overview' || !selectedTask) { studioOverviewRequests.current.cancel(); setStudioOverview(null); return undefined; }
    const signature = [view, selectedTask.id, compareRoundIds.join('|'), eventRevision.studioOverview].join(':');
    const request = studioOverviewRequests.current.begin(signature);
    const params = new URLSearchParams();
    for (const roundId of compareRoundIds) params.append('round', roundId);
    void api('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/studio-overview?' + params.toString(), { signal: request.signal }).then((data) => {
      if (request.isCurrent()) setStudioOverview(data.overview || null);
    }).catch((nextError) => {
      if (request.isCurrent() && !isAbortError(nextError)) reportRequestError(nextError, '无法读取任务批次比较。', { operation: 'load-studio-overview', phase: 'loading' });
    });
    return () => request.abort();
  }, [reportRequestError, view, selectedTask?.id, compareRoundIds.join('|'), eventRevision.studioOverview]);

  useEffect(() => {
    if (assetProvenance && !assets.some((asset) => asset.id === assetProvenance.asset?.id)) setAssetProvenance(null);
  }, [assets, assetProvenance]);
  // 「我在看哪儿」不再写进 Session。route 才是界面选中态的唯一来源；
  // Session 上的 agent_* 指针属于 Agent（方案 7.7.3）。这里曾经把两者混在
  // 同一列里互相覆盖，现在前端既不写它，也不再用它恢复视图。

  const review = async (assetId, decision, feedback = {}) => {
    try {
      await api('/api/assets/' + encodeURIComponent(assetId) + '/review', { method: 'POST', idempotencyKey: uniqueKey('review'), body: { decision, taskId: selectedTask?.id, roundId: selectedRound?.id, feedback } });
      await refresh();
    } catch (nextError) { reportRequestError(nextError, '无法保存选择。', { operation: 'save-asset-review', phase: 'committing' }); }
  };
  const moveAssetToTrash = async (assetId) => {
    await api('/api/assets/' + encodeURIComponent(assetId) + '/trash', { method: 'POST', idempotencyKey: uniqueKey('trash'), body: {} });
    await refresh();
  };
  const trash = async (assetId) => {
    try {
      const { impact } = await api('/api/assets/' + encodeURIComponent(assetId) + '/impact');
      if (impact.deliveryCount || impact.relationCount) {
        setConfirmationError('');
        setConfirmation({ kind: 'trash', assetId });
        return;
      }
      await moveAssetToTrash(assetId);
    } catch (nextError) { reportRequestError(nextError, '无法移入回收站。', { operation: 'trash-asset', phase: 'committing' }); }
  };
  const restore = async (assetId) => { try { await api('/api/assets/' + encodeURIComponent(assetId) + '/restore', { method: 'POST', idempotencyKey: uniqueKey('restore'), body: {} }); await refresh(); } catch (nextError) { reportRequestError(nextError, '无法恢复资产。', { operation: 'restore-asset', phase: 'committing' }); } };
  const applyProjectSelection = (selection) => {
    const nextAssets = selection?.assets || EMPTY;
    const ids = selectionIdSet(selection);
    selectedAssetIdsRef.current = ids;
    setSelectedAssetIds(ids);
    setSelectionAssets(nextAssets);
  };
  const markSelectionBusy = (assetIds, busy) => {
    selectionBusyIdsRef.current = nextBusySet(selectionBusyIdsRef.current, assetIds, busy);
    setSelectionBusyIds(new Set(selectionBusyIdsRef.current));
  };
  const enqueueSelectionWrite = (projectId, assetIds, request, fallbackMessage) => {
    const epoch = ++selectionMutationEpoch.current;
    markSelectionBusy(assetIds, true);
    const operation = selectionWriteQueue.current.catch(() => undefined).then(async () => {
      const data = await request();
      if (isSelectionWriteCurrent({ projectId, currentProjectId: selectionProjectIdRef.current, epoch, currentEpoch: selectionMutationEpoch.current })) applyProjectSelection(data.selection);
    });
    selectionWriteQueue.current = operation.catch(() => undefined);
    void operation.catch(async (nextError) => {
      if (!isSelectionWriteCurrent({ projectId, currentProjectId: selectionProjectIdRef.current, epoch, currentEpoch: selectionMutationEpoch.current })) return;
      reportRequestError(nextError, fallbackMessage, { operation: 'save-asset-selection', phase: 'committing' });
      await refresh();
    }).finally(() => { if (shouldClearSelectionBusy({ projectId, currentProjectId: selectionProjectIdRef.current })) markSelectionBusy(assetIds, false); });
  };
  const setAssetSelection = (assetId, selected) => {
    if (!selectedProject || selectionBusyIdsRef.current.has(assetId)) return;
    const nextIds = nextSelectedIds(selectedAssetIdsRef.current, [assetId], selected);
    selectedAssetIdsRef.current = nextIds;
    setSelectedAssetIds(new Set(nextIds));
    setSelectionAssets((current) => mergeSelectionAssets(current, [assetById.get(assetId)], selected));
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, [assetId], () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/assets/' + encodeURIComponent(assetId), { method: 'POST', idempotencyKey: uniqueKey('asset-selection'), body: { selected } }), '无法保存当前选片。');
  };
  const toggleSelection = (assetId) => setAssetSelection(assetId, !selectedAssetIdsRef.current.has(assetId));
  // 显式移出：菜单已经知道当前是选中状态，方向不该靠 ref 反推（ref 在异步写入时会滞后）。
  const deselectAsset = (assetId) => setAssetSelection(assetId, false);
  const markAsDeliverable = async (asset) => {
    const intent = deliverableIntent({ hasProject: Boolean(selectedProject), isSelected: selectedAssetIdsRef.current.has(asset.id) });
    if (intent === 'skip') return;
    if (intent === 'deselect') { toggleSelection(asset.id); return; }
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, [asset.id], async () => {
      if (needsKeepReview(asset)) await api('/api/assets/' + encodeURIComponent(asset.id) + '/review', { method: 'POST', idempotencyKey: uniqueKey('delivery-keep'), body: { decision: 'keep' } });
      return api('/api/projects/' + encodeURIComponent(projectId) + '/selection/assets/' + encodeURIComponent(asset.id), { method: 'POST', idempotencyKey: uniqueKey('delivery-select'), body: { selected: true } });
    }, '无法将图片选为成果。');
  };
  const clearSelection = () => {
    if (!selectedProject || !selectionAssets.length) return;
    const selected = [...selectionAssets];
    selectedAssetIdsRef.current = new Set();
    setSelectedAssetIds(new Set());
    setSelectionAssets(EMPTY);
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, selected.map((asset) => asset.id), async () => {
      let latest = { assets: EMPTY };
      for (const batch of chunkAssetIds(selected.map((asset) => asset.id))) {
        const data = await api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('asset-selection-clear'), body: { assetIds: batch, selected: false } });
        latest = latestSelection(latest, data.selection);
      }
      return { selection: latest };
    }, '无法清空当前选片。');
  };
  const setPageSelection = (selected) => {
    if (!selectedProject || !visibleAssets.length || pageSelectionBusy) return;
    const candidates = selectionCandidates(visibleAssets, selectedAssetIdsRef.current, selected);
    if (!candidates.length) return;
    const projectId = selectedProject.id;
    const candidateIds = candidates.map((asset) => asset.id);
    enqueueSelectionWrite(projectId, candidateIds, () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('page-selection'), body: { assetIds: candidateIds, selected, keepAssetIds: keepCandidateIds(candidates, selected) } }), '无法更新本页选片。');
  };
  const setAssetsSelection = (assetIds, selected) => {
    if (!selectedProject || !assetIds.length) return;
    const uniqueIds = normalizeAssetIds(assetIds);
    const nextIds = nextSelectedIds(selectedAssetIdsRef.current, uniqueIds, selected);
    selectedAssetIdsRef.current = nextIds;
    setSelectedAssetIds(new Set(nextIds));
    setSelectionAssets((current) => mergeSelectionAssets(current, uniqueIds.map((assetId) => assetById.get(assetId)), selected));
    const projectId = selectedProject.id;
    // keepAssetIds 只回答「补不补 keep 评审」：查不到的资产按「没有 keep」处理（与原实现一致），
    // 所以这里给它一个只带 id 的占位，避免 id 被丢掉 —— 但并进清单时不能塞占位，那是上一行的事。
    const keepEntries = uniqueIds.map((assetId) => assetById.get(assetId) || { id: assetId });
    enqueueSelectionWrite(projectId, uniqueIds, () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('canvas-selection'), body: { assetIds: uniqueIds, selected, keepAssetIds: keepCandidateIds(keepEntries, selected) } }), '无法更新创作谱系选片。');
  };
  const inspectAsset = async (assetId) => {
    const request = assetProvenanceRequests.current.begin(String(assetId));
    try {
      const data = await api('/api/assets/' + encodeURIComponent(assetId) + '/provenance', { signal: request.signal });
      if (!request.isCurrent()) return false;
      setAssetProvenance(data.provenance || null);
      return true;
    } catch (nextError) {
      if (isAbortError(nextError) || !request.isCurrent()) return false;
      reportRequestError(nextError, '无法读取素材来源与评审记录。', { operation: 'inspect-asset-provenance', phase: 'loading' });
      return false;
    }
  };
  const downloadAsset = (asset) => {
    const link = document.createElement('a');
    link.href = assetOriginalUrl(asset, true);
    link.download = 'daoge-pic-image';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const downloadArchive = (url) => {
    const link = document.createElement('a');
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };
  const downloadProjectArchive = (assetIds) => {
    if (!selectedProject || !assetIds.length) { setError('请先在项目资产中选择要打包的图片。'); return; }
    downloadArchive(projectArchiveUrl(selectedProject.id, assetIds));
  };
  const downloadDeliveryArchive = (delivery, sequences) => {
    if (!sequences.length) { setError('请至少选择一张交付图片。'); return; }
    downloadArchive(deliveryArchiveUrl(delivery.id, sequences));
  };
  const setAssetShared = async (asset, shared) => {
    try {
      await api('/api/assets/' + encodeURIComponent(asset.id) + '/shared', { method: 'POST', idempotencyKey: uniqueKey('asset-shared'), body: { shared } });
      setNotice(shared ? '图片已加入跨项目共享素材。' : '图片已从跨项目共享素材移除。');
      await refresh();
    } catch (nextError) { reportRequestError(nextError, '无法更新跨项目共享素材。', { operation: 'set-asset-shared', phase: 'committing' }); }
  };
  const copyAsset = async (asset) => {
    const fileUrl = asset.fileUrl || assetOriginalUrl(asset);
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('图片暂时无法读取。');
      const image = await response.blob();
      if (await writeImageBlobToClipboard(image)) {
        setNotice(image.type === 'image/png' ? '图片已复制，可粘贴到支持图片的应用。' : '图片已转换为 PNG 并复制，可粘贴到支持图片的应用。');
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(new URL(fileUrl, window.location.href).href);
        setNotice('当前浏览器不支持直接复制图片，已复制图片链接。');
        return;
      }
      throw new Error('当前浏览器未提供剪贴板权限。');
    } catch (nextError) { reportRequestError(nextError, '无法复制图片，请使用下载原图。', { operation: 'copy-asset', phase: 'requesting' }); }
  };
  const completeDelivery = async () => {
    if (!selectedProject) { setError('请先打开一个项目。'); return; }
    if (!deliveryInteractionRef.current.begin()) return;
    let intent = deliveryCompletion;
    if (intent?.phase === 'complete') {
      window.localStorage.removeItem(DELIVERY_COMPLETION_PREFIX + intent.projectId);
      setDeliveryCompletion(null);
      setDeliveryName('');
      setDeliveryIncludeCreativeRecord(true);
      setNotice('交付已完成，图片已生成实体文件，可直接下载或复制。');
      deliveryInteractionRef.current.end();
      return;
    }
    if (!intent) {
      if (deliverySelection.state !== 'ready') {
        setError(deliverySelectionMessage(deliverySelection));
        deliveryInteractionRef.current.end();
        return;
      }
      intent = {
        operationId: uniqueKey('delivery-complete'),
        projectId: selectedProject.id,
        name: deliveryName.trim() || '交付-' + new Date().toISOString().slice(0, 10),
        assetIds: selectedDeliveryAssets.map((asset) => asset.id),
        includeCreativeRecord: deliveryIncludeCreativeRecord,
        phase: 'draft',
        stage: 'starting'
      };
      window.localStorage.setItem(DELIVERY_COMPLETION_PREFIX + intent.projectId, JSON.stringify(intent));
      setDeliveryCompletion(intent);
    }
    const projectId = intent.projectId;
    const operationEpoch = ++deliveryOperationEpoch.current;
    setDeliveryCreating(true);
    try {
      const result = await api('/api/deliveries/complete', { method: 'POST', idempotencyKey: intent.operationId, body: { projectId, name: intent.name, assetIds: intent.assetIds, phase: intent.phase, includeCreativeRecord: intent.includeCreativeRecord === true } });
      const nextIntent = result.nextAction ? { ...intent, deliveryId: result.delivery.id, phase: result.nextAction, stage: result.stage } : { ...intent, deliveryId: result.delivery.id, phase: 'complete', stage: 'exported' };
      window.localStorage.setItem(DELIVERY_COMPLETION_PREFIX + projectId, JSON.stringify(nextIntent));
      if (isDeliveryOperationCurrent({ activeProjectId: activeProjectIdRef.current, projectId, currentEpoch: deliveryOperationEpoch.current, operationEpoch })) {
        setDeliveryCompletion(nextIntent);
        setNotice(result.nextAction ? result.stage === 'draft' ? '交付草稿已唯一创建。下一步准备交付。' : '交付已准备完成。下一步导出实体文件。' : '实体文件已导出。检查后完成本次交付。');
        await refresh();
      }
    } catch (nextError) {
      if (isDeliveryOperationCurrent({ activeProjectId: activeProjectIdRef.current, projectId, currentEpoch: deliveryOperationEpoch.current, operationEpoch })) reportRequestError(nextError, '无法继续交付；当前阶段已保留，可重试。', { operation: 'complete-delivery', phase: 'committing' });
    } finally {
      if (isDeliveryOperationCurrent({ activeProjectId: activeProjectIdRef.current, projectId, currentEpoch: deliveryOperationEpoch.current, operationEpoch })) {
        deliveryInteractionRef.current.end();
        setDeliveryCreating(false);
      }
    }
  };
  const deliveryAction = async (delivery, action) => {
    setDeliveryBusyId(delivery.id);
    try {
      if (action === 'update') {
        if (deliverySelection.state !== 'ready') throw new Error(deliverySelectionMessage(deliverySelection));
        await api('/api/deliveries/' + encodeURIComponent(delivery.id) + '/items', { method: 'PUT', idempotencyKey: uniqueKey('delivery-update'), body: { assetIds: selectedDeliveryAssets.map((asset) => asset.id) } });
      } else {
        const path = action === 'ready' ? '/ready' : action === 'draft' ? '/draft' : '/export';
        await api('/api/deliveries/' + encodeURIComponent(delivery.id) + path, { method: 'POST', idempotencyKey: uniqueKey('delivery-' + action), body: {} });
      }
      await refresh();
    } catch (nextError) { reportRequestError(nextError, '无法更新交付状态。', { operation: 'delivery-action', phase: 'committing' }); } finally { setDeliveryBusyId(null); }
  };
  const toggleComparedRound = (roundId) => {
    const next = compareRoundIds.includes(roundId) ? compareRoundIds.filter((id) => id !== roundId) : [...compareRoundIds, roundId].slice(0, 12);
    navigateRoute({ view: 'studio-overview', roundId: next[0] || null, compareRoundIds: next, runId: null, assetScope: 'task' });
  };
  const openCreationDialog = (kind) => {
    setCreationError('');
    setNotice('');
    setCreationDialog(kind);
  };
  const dismissCreationDialog = () => {
    if (creationBusy) return;
    setCreationDialog(null);
    setCreationError('');
  };
  const createProjectFromStudio = async (form) => {
    if (creationBusy) return;
    if (!form.name) { setCreationError('请输入项目名称。'); return; }
    setCreationBusy(true);
    setCreationError('');
    setError('');
    try {
      const receipt = await api('/api/projects', { method: 'POST', idempotencyKey: uniqueKey('studio-project-create'), body: { name: form.name, description: form.description || undefined, templateId: form.templateId || undefined, templateVersion: form.templateVersion || undefined } });
      const project = receipt.value;
      setCreationDialog(null);
      await refresh();
      navigateRoute(selectProject(route, project.id));
    } catch (nextError) {
      setCreationError(errorMessageForDisplay(nextError, '无法创建项目。'));
    } finally {
      setCreationBusy(false);
    }
  };
  const createTaskFromStudio = async (form) => {
    if (creationBusy || !selectedProject) return;
    if (!form.name) { setCreationError('请输入任务名称。'); return; }
    setCreationBusy(true);
    setCreationError('');
    setError('');
    try {
      const taskReceipt = await api('/api/tasks', { method: 'POST', idempotencyKey: uniqueKey('studio-task-create'), body: { projectId: selectedProject.id, name: form.name, taskTypeId: form.taskTypeId || undefined, styleKitId: form.styleKitId || undefined, brandKitId: form.brandKitId || undefined, intent: form.intent } });
      const createdTask = taskReceipt.value;
      let createdRound = null;
      if (form.createRound) {
        const roundReceipt = await api('/api/rounds', { method: 'POST', idempotencyKey: uniqueKey('studio-round-create'), body: { taskId: createdTask.id, purpose: form.roundPurpose, plan: form.plan } });
        createdRound = roundReceipt.value;
      }
      setCreationDialog(null);
      await refresh();
      // G2：建完留在画布（路由由 `inPlaceCreationRoute` 保证 view 不变），并聚焦新建的实体。
      navigateRoute(inPlaceCreationRoute({
        ...selectTask(route, createdTask.id),
        view: 'lineage',
        kind: createdRound ? 'round' : 'task',
        id: createdRound ? createdRound.id : createdTask.id,
        projectId: selectedProject.id,
        taskId: createdTask.id,
        compareRoundIds: createdRound ? [createdRound.id] : [],
        runId: null,
        assetScope: createdRound ? 'round' : 'task'
      }));
    } catch (nextError) {
      setCreationError(errorMessageForDisplay(nextError, '无法创建任务。'));
    } finally {
      setCreationBusy(false);
    }
  };
  const createRoundFromStudio = async (form) => {
    if (creationBusy || !selectedProject || !selectedTask) return;
    setCreationBusy(true);
    setCreationError('');
    setError('');
    try {
      const receipt = await api('/api/rounds', { method: 'POST', idempotencyKey: uniqueKey('studio-round-create'), body: { taskId: selectedTask.id, purpose: form.purpose, parentRoundId: form.parentRoundId || undefined, plan: form.plan } });
      const createdRound = receipt.value;
      const pendingReference = pendingReferenceAfterRound;
      let referenceAttachError = '';
      if (pendingReference?.assets?.length) {
        const materialMap = new Map(normalizeReferenceMaterials(createdRound.plan || {}).map((item) => [item.assetId, item]));
        for (const asset of pendingReference.assets) materialMap.set(asset.id, { assetId: asset.id, usage: pendingReference.usage, note: REFERENCE_USAGE_LABELS[pendingReference.usage] || pendingReference.usage });
        try {
          const plan = planWithReferenceMaterials(createdRound.plan || {}, [...materialMap.values()]);
          await api('/api/rounds/' + encodeURIComponent(createdRound.id) + '/draft-context', { method: 'PUT', idempotencyKey: uniqueKey('round-reference-create'), body: { plan, expectedVersion: createdRound.version } });
        } catch (nextError) {
          referenceAttachError = errorMessageForDisplay(nextError, '参考素材未能自动加入。');
        }
        setPendingReferenceAfterRound(null);
      }
      setCreationDialog(null);
      if (referenceAttachError) setError('批次已创建，但参考素材未能自动加入：' + referenceAttachError);
      await refresh();
      navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: selectedTask.id, roundId: createdRound.id, compareRoundIds: [createdRound.id], runId: null, assetScope: 'round' });
    } catch (nextError) {
      setCreationError(errorMessageForDisplay(nextError, '无法创建批次。'));
    } finally {
      setCreationBusy(false);
    }
  };

  const restoreSessionContext = (context) => {
    if (!context?.project?.id) return;
    navigateRoute({ view: 'lineage', projectId: context.project.id, taskId: context.task?.id || null, roundId: context.round?.id || null, compareRoundIds: context.round?.id ? [context.round.id] : [], runId: null, assetScope: context.round?.id ? 'round' : context.task?.id ? 'task' : 'project' });
  };
  const openReferenceDialog = () => {
    if (!selectedProject || !selectedTask || !selectedRound) { setError('请先选择项目、任务和批次。'); return; }
    if (selectedRound.status !== 'draft') { setError('当前批次已进入确认或运行流程，参考素材请回到 Agent 修改计划。'); return; }
    setReferenceError('');
    setReferenceDialog('round');
  };
  const dismissReferenceDialog = () => {
    if (referenceBusy) return;
    setReferenceDialog(null);
    setReferenceError('');
  };
  const dismissReferenceResolver = () => {
    if (referenceBusy) return;
    setReferenceResolver(null);
    setReferenceError('');
  };
  const taskForId = (taskId, taskList = tasks) => taskList.find((task) => task.id === taskId) || null;
  const roundForId = (roundId, roundList = rounds) => roundList.find((round) => round.id === roundId) || null;
  const draftRoundsForTask = (task, roundList = rounds) => task ? roundList.filter((round) => round.taskId === task.id && round.status === 'draft') : EMPTY;
  
  const referenceTaskIdsForAssets = (sourceAssets, roundList = rounds) => [...new Set(sourceAssets.flatMap((asset) => {
    const sourceRound = roundForId(asset?.display?.roundId || asset?.source?.roundId || asset?.source?.creativeRoundId || null, roundList);
    return [asset?.display?.taskId, asset?.source?.taskId, asset?.source?.creativeTaskId, sourceRound?.taskId].filter(Boolean);
  }))];
  const referenceTargetForAssets = (sourceAssets, availableRounds = rounds) => {
    if (selectedRound?.status === 'draft') return { task: selectedTask || taskForId(selectedRound.taskId), draftRounds: [selectedRound], tasks: selectedTask ? [selectedTask] : tasks };
    if (selectedTask) return { task: selectedTask, draftRounds: draftRoundsForTask(selectedTask, availableRounds), tasks: [selectedTask] };
    const inferredTasks = referenceTaskIdsForAssets(sourceAssets, availableRounds).map((taskId) => taskForId(taskId)).filter(Boolean);
    if (inferredTasks.length === 1) return { task: inferredTasks[0], draftRounds: draftRoundsForTask(inferredTasks[0], availableRounds), tasks: inferredTasks };
    const allDraftRounds = availableRounds.filter((round) => round.status === 'draft');
    if (allDraftRounds.length === 1) {
      const task = taskForId(allDraftRounds[0].taskId);
      return { task, draftRounds: allDraftRounds, tasks: task ? [task] : tasks };
    }
    if (tasks.length === 1) return { task: tasks[0], draftRounds: draftRoundsForTask(tasks[0], availableRounds), tasks };
    return { task: null, draftRounds: allDraftRounds, tasks };
  };
  const loadReferenceRounds = async (candidateTasks) => {
    const taskList = [...new Map(candidateTasks.filter((task) => task?.id).map((task) => [task.id, task])).values()];
    if (!taskList.length) return rounds;
    const roundLists = await Promise.all(taskList.map((task) => api('/api/tasks/' + encodeURIComponent(task.id) + '/rounds').then((data) => data.rounds || EMPTY)));
    const loadedRounds = [...new Map([...rounds, ...roundLists.flat()].map((round) => [round.id, round])).values()];
    setRounds((current) => [...new Map([...current, ...roundLists.flat()].map((round) => [round.id, round])).values()]);
    return loadedRounds;
  };
  const saveReferenceMaterialsForRound = async (round, materials, close = true, message = '') => {
    if (referenceBusy || !selectedProject || !round) return false;
    if (round.status !== 'draft') { setReferenceError('当前批次已进入确认或运行流程，不能在 Studio 直接改参考素材。'); return false; }
    setReferenceBusy(true);
    setReferenceError('');
    try {
      const plan = planWithReferenceMaterials(round.plan || {}, materials);
      await api('/api/rounds/' + encodeURIComponent(round.id) + '/draft-context', { method: 'PUT', idempotencyKey: uniqueKey('round-reference'), body: { plan, expectedVersion: round.version } });
      if (close) setReferenceDialog(null);
      setNotice(message || (materials.length ? '参考素材已保存到当前批次。请回到会话整理并确认计划。' : '当前批次参考素材已清空。'));
      await refresh();
      setEventRevision((current) => ({ ...current, planVersions: current.planVersions + 1, creativeRecord: current.creativeRecord + 1 }));
      return true;
    } catch (nextError) {
      setReferenceError(errorMessageForDisplay(nextError, '无法保存参考素材。'));
      reportRequestError(nextError, '无法保存参考素材。', { operation: 'save-reference-materials', phase: 'committing' });
      return false;
    } finally {
      setReferenceBusy(false);
    }
  };
  const chooseReferenceTask = (taskId) => {
    if (!referenceResolver) return;
    const nextTask = tasks.find((item) => item.id === taskId) || null;
    if (!nextTask) { setReferenceError('这个任务已不可用，请刷新后重试。'); return; }
    const availableRounds = [...new Map([...rounds, ...referenceResolver.draftRounds].map((round) => [round.id, round])).values()];
    setReferenceResolver((current) => current ? { ...current, task: nextTask, draftRounds: draftRoundsForTask(nextTask, availableRounds), tasks } : current);
    setReferenceError('');
  };
  const saveRoundReferenceMaterials = async (materials, close = true) => saveReferenceMaterialsForRound(selectedRound, materials, close);
  // 导入要等 saveRoundReferenceMaterials 就位才能接线：它得把导入结果并进本轮参考素材，
  // 而那件事又依赖上面的批次保存逻辑 —— 所以这个 hook 的调用点排在这里，不在原来的位置。
  const { uploading, uploadProgress, upload, importDerivedMaskAsset } = useAssetImport({
    api, refresh, uniqueKey, uploadTarget, assetScope, selectedImportNeed, contextMaterialNeeds,
    selectedProject, selectedRound, referenceMaterials, saveRoundReferenceMaterials, setError, setNotice, inputRef
  });
  const addAssetsToRoundReferences = async (round, sourceAssets, usage = 'subject', message = '') => {
    const materialMap = new Map(normalizeReferenceMaterials(round?.plan || {}).map((item) => [item.assetId, item]));
    for (const asset of sourceAssets) materialMap.set(asset.id, { assetId: asset.id, usage, note: REFERENCE_USAGE_LABELS[usage] || usage });
    return saveReferenceMaterialsForRound(round, [...materialMap.values()], false, message);
  };
  const chooseReferenceRound = async (roundId) => {
    if (!referenceResolver) return;
    const round = rounds.find((item) => item.id === roundId) || referenceResolver.draftRounds.find((item) => item.id === roundId) || null;
    if (!round || round.status !== 'draft') { setReferenceError('这一轮已不可用，请刷新后重试。'); return; }
    const targetTask = taskForId(round.taskId) || referenceResolver.task || selectedTask;
    const label = (ROUND_PURPOSE_LABELS[round.purpose] || round.purpose) + ' · 计划 v' + round.planVersion;
    const saved = await addAssetsToRoundReferences(round, referenceResolver.assets, referenceResolver.usage, '参考素材已加入“' + label + '”。请回到 Agent 整理并确认生成计划。');
    if (saved) {
      setReferenceResolver(null);
      navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: targetTask?.id || round.taskId, roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' });
    }
  };
  const createRoundForPendingReference = () => {
    if (!referenceResolver) return;
    const targetTask = referenceResolver.task || (referenceResolver.tasks?.length === 1 ? referenceResolver.tasks[0] : null);
    if (!targetTask) { setReferenceError('请先进入一个任务，再新建一轮。'); return; }
    setPendingReferenceAfterRound({ assets: referenceResolver.assets, usage: referenceResolver.usage });
    setReferenceResolver(null);
    if (!selectedTask || selectedTask.id !== targetTask.id) navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: targetTask.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
    openCreationDialog('round');
  };
  
  const openDerivedRoundDialog = (nextAssets, purpose = 'variation', actionId = '') => {
    const sourceAssets = (nextAssets || EMPTY).filter((asset) => asset && !asset.deletedAt);
    if (!selectedProject) { setError('请先打开一个项目，再继续创作。'); return; }
    if (!sourceAssets.length) { setError('请先选择至少一张可用图片。'); return; }
    const inferredTasks = referenceTaskIdsForAssets(sourceAssets).map((taskId) => taskForId(taskId)).filter(Boolean);
    const targetTask = selectedTask || (inferredTasks.length === 1 ? inferredTasks[0] : tasks.length === 1 ? tasks[0] : null);
    if (!targetTask) { setError(tasks.length ? '请先选择任务，再继续创作。' : '请先新建任务，再继续创作。'); return; }
    setError('');
    setPreviewAssets(EMPTY);
    setDerivedError('');
    if (!selectedTask || selectedTask.id !== targetTask.id) {
      setPendingDerivedAfterTask({ assets: sourceAssets, purpose, actionId, taskId: targetTask.id });
      navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: targetTask.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
      return;
    }
    setDerivedDialog({ assets: sourceAssets, purpose, actionId });
  };
  const dismissDerivedDialog = () => {
    if (derivedBusy) return;
    setDerivedDialog(null);
    setDerivedError('');
  };
  const createDerivedRoundFromAssets = async (form) => {
    if (derivedBusy || !selectedProject || !selectedTask) return;
    setDerivedBusy(true);
    setDerivedError('');
    setError('');
    try {
      const receipt = await api('/api/rounds/derived', { method: 'POST', idempotencyKey: uniqueKey('studio-derived-round'), body: { ...form, taskId: selectedTask.id } });
      const createdRound = receipt.value;
      setDerivedDialog(null);
      setNotice('已基于图片创建下一轮草稿，并设为当前批次。已回到创作平台；请让会话整理可确认的计划。');
      await refresh();
      navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: selectedTask.id, roundId: createdRound.id, compareRoundIds: [createdRound.id], runId: null, assetScope: 'round' });
    } catch (nextError) {
      setDerivedError(errorMessageForDisplay(nextError, '无法基于图片创建下一轮。'));
    } finally {
      setDerivedBusy(false);
    }
  };
  const addAssetsToCurrentRoundReferences = async (nextAssets, usage = 'subject') => {
    const sourceAssets = (nextAssets || EMPTY).filter((asset) => asset && !asset.deletedAt);
    if (!selectedProject) { setError('请先打开一个项目，再把图片作为参考。'); return false; }
    if (!sourceAssets.length) { setError('请先选择至少一张可用图片。'); return false; }
    let target = referenceTargetForAssets(sourceAssets);
    if (selectedRound?.status !== 'draft') {
      const inferredTasks = referenceTaskIdsForAssets(sourceAssets).map((taskId) => taskForId(taskId)).filter(Boolean);
      const candidateTasks = selectedTask ? [selectedTask] : inferredTasks.length ? inferredTasks : tasks;
      try {
        const availableRounds = await loadReferenceRounds(candidateTasks);
        target = referenceTargetForAssets(sourceAssets, availableRounds);
      } catch (nextError) {
        reportRequestError(nextError, '无法读取可用的批次，请刷新后重试。', { operation: 'load-reference-rounds', phase: 'loading' });
        return false;
      }
    }
    if (target.draftRounds.length === 1) {
      const round = target.draftRounds[0];
      const targetTask = target.task || taskForId(round.taskId);
      const label = (ROUND_PURPOSE_LABELS[round.purpose] || round.purpose) + ' · 计划 v' + round.planVersion;
      const saved = await addAssetsToRoundReferences(round, sourceAssets, usage, '已自动加入这一轮“' + label + '”。请回到 Agent 整理并确认生成计划。');
      if (saved) navigateRoute({ view: 'lineage', projectId: selectedProject.id, taskId: targetTask?.id || round.taskId, roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' });
      return saved;
    }
    if (!target.task && !target.draftRounds.length && !target.tasks.length) { setError('请先新建任务和批次，再把图片作为参考。'); return false; }
    setError('');
    setReferenceError('');
    setPreviewAssets(EMPTY);
    setReferenceResolver({ assets: sourceAssets, usage, task: target.task, tasks: target.tasks, draftRounds: target.draftRounds });
    return false;
  };
  const openRejectReviewDialog = (nextAssets, options = {}) => {
    const sourceAssets = (nextAssets || EMPTY).filter((asset) => asset && !asset.deletedAt);
    if (!sourceAssets.length) { setError('请先选择至少一张可用图片。'); return; }
    setPreviewAssets(EMPTY);
    setRejectError('');
    setRejectDialog({ assets: sourceAssets, createNextRound: Boolean(options?.createNextRound) });
  };
  const dismissRejectDialog = () => {
    if (rejectBusy) return;
    setRejectDialog(null);
    setRejectError('');
  };
  /** @param {unknown} feedback @param {boolean|{addAsNegative?: boolean, createNextRound?: boolean}} [options] 兼容旧调用：直接传 true 等于 addAsNegative。 */
  const saveRejectReview = async (feedback, options = {}) => {
    if (rejectBusy || !rejectDialog?.assets?.length) return;
    const addAsNegative = typeof options === 'boolean' ? options : Boolean(options?.addAsNegative);
    const createNextRound = typeof options === 'object' && Boolean(options?.createNextRound);
    if (createNextRound && (!selectedProject || !selectedTask)) { setRejectError('请先选择项目和任务，再从反馈创建下一轮。'); return; }
    setRejectBusy(true);
    setRejectError('');
    try {
      const rejectedAssets = rejectDialog.assets;
      for (const asset of rejectedAssets) await api('/api/assets/' + encodeURIComponent(asset.id) + '/review', { method: 'POST', idempotencyKey: uniqueKey('reject-review'), body: { decision: 'reject', taskId: selectedTask?.id, roundId: selectedRound?.id, feedback } });
      setRejectDialog(null);
      if (createNextRound) {
        const form = rejectFeedbackToDerivedForm(feedback, rejectedAssets);
        const receipt = await api('/api/rounds/derived', { method: 'POST', idempotencyKey: uniqueKey('reject-derived-round'), body: { ...form, taskId: selectedTask.id } });
        const createdRound = receipt.value;
          setNotice('不采用原因已保存，并已创建带反例参考的下一轮草稿。请让会话基于新的信息整理计划。');
await refresh();
      navigateRoute(inPlaceCreationRoute({ ...route, view: 'lineage', kind: 'round', id: createdRound.id, projectId: selectedProject.id, taskId: selectedTask.id, compareRoundIds: [createdRound.id], runId: null, assetScope: 'round' }));
        return;
      }
      const negativeSaved = addAsNegative ? await addAssetsToCurrentRoundReferences(rejectedAssets, 'negative') : false;
      if (!addAsNegative) await refresh();
      setNotice(negativeSaved ? '不采用原因已保存，并已作为当前这一轮的反例参考。' : '不采用原因已保存。');
    } catch (nextError) {
      setRejectError(errorMessageForDisplay(nextError, '无法保存不采用原因。'));
    } finally {
      setRejectBusy(false);
    }
  };

  const toggleBatchDelivery = (deliveryId) => setSelectedDeliveryIds((current) => { const next = new Set(current); if (next.has(deliveryId)) next.delete(deliveryId); else next.add(deliveryId); return next; });
  const batchAction = async (action, batch = null, version = null) => {
    if (batchBusyRef.current) return;
    const snapshot = createBatchOperationSnapshot({ action, batchId: batch?.id || null, versionId: version?.id || null, deliveryIds: selectedDeliveryIds, eligibleDeliveryIds, name: batchName });
    const signature = batchOperationSignature(snapshot);
    if (!batchOperationRef.current || batchOperationRef.current.signature !== signature) batchOperationRef.current = { signature, key: uniqueKey('batch-' + action) };
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      if (snapshot.action === 'create') {
        if (!selectedProject || !snapshot.deliveryIds.length) throw new Error('请选择至少一份已准备或已导出的交付。');
        await api('/api/delivery-batches', { method: 'POST', idempotencyKey: batchOperationRef.current.key, body: { projectId: selectedProject.id, name: snapshot.name || '交付批次-' + new Date().toISOString().slice(0, 10), deliveryIds: snapshot.deliveryIds } });
        setBatchName(''); setSelectedDeliveryIds(new Set());
      } else if (snapshot.action === 'revise') {
        await api('/api/delivery-batches/' + encodeURIComponent(snapshot.batchId) + '/revisions', { method: 'POST', idempotencyKey: batchOperationRef.current.key, body: { deliveryIds: snapshot.deliveryIds } });
      } else if (snapshot.versionId) {
        await api('/api/delivery-batch-versions/' + encodeURIComponent(snapshot.versionId) + '/ready', { method: 'POST', idempotencyKey: batchOperationRef.current.key, body: {} });
      }
      batchOperationRef.current = null;
      await refresh();
    } catch (nextError) {
      reportRequestError(nextError, '无法更新交付批次。', { operation: 'update-delivery-batch', phase: 'committing' });
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  };
  const updateRunItemControls = (changes) => navigateRoute(changes, false);
  const setRunItemFilter = (filter) => updateRunItemControls({ runItemFilter: normalizeRunItemFilter(filter), runItemPage: 1 });
  const setRunItemPageNumber = (page) => updateRunItemControls({ runItemPage: normalizeRunItemPageNumber(page) });
  const setRunItemPageSizeValue = (pageSize) => updateRunItemControls({ runItemPageSize: normalizeRunItemPageSize(pageSize), runItemPage: 1 });
  const setRunItemSequenceValue = (sequence) => updateRunItemControls({ runItemSequence: normalizeRunItemSequence(sequence), runItemPage: 1 });
  const toggleRunItemSelection = (itemId) => {
    const item = retryableRunItems(visibleRunItems).find((candidate) => candidate.id === itemId);
    if (!item) return;
    setSelectedRunItemIds((current) => { const next = new Set(current); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next; });
  };
  const selectRetryablePageItems = (selected) => {
    const pageIds = retryableRunItems(visibleRunItems).map((item) => item.id);
    setSelectedRunItemIds((current) => { const next = new Set(current); for (const itemId of pageIds) { if (selected) next.add(itemId); else next.delete(itemId); } return next; });
  };
  /**
   * 「花动作」（重试 / 恢复）**不直调 bearer**。
   *
   * 它们会重新花钱，属于 Agent Bearer 权限；浏览器只有确认 Cookie，直调必然 403。
   * 所以界面**不装作能直接执行**，而是把意图写成一条**共享请求队列**里的请求
   * （带 `intent` + `runId` + `itemIds`，agent 据此精确执行，不必从一句话里猜），
   * 由在场的 agent 接单后跑。这保持了角色分离：用户点按钮表达意图，agent 花钱执行。
   *
   * 之前这两个按钮只弹一句「回到会话」，点了什么都不会发生——实测让人以为功能坏了。
   */
  const requestRunAction = async (intent, { runId = null, itemIds = [], label }) => {
    const targetRunId = runId || activeRun?.id;
    if (!targetRunId) return false;
    // 项目是队列的容器（4.7）。运行视图里 `selectedProject` 偶尔还没解析出来
    // （深链直达、或项目列表未加载），这时**不能静默拒绝**——先按任务反查它所属项目。
    const owningTask = selectedTask || tasks.find((item) => item.id === selectedRound?.taskId) || null;
    const projectId = selectedProject?.id || owningTask?.projectId || null;
    if (!projectId) {
      setError('这条重试还不知道属于哪个项目：请先从左侧进入它所在的项目，再点重试。');
      return false;
    }
    const uniqueIds = [...new Set(itemIds)].filter(Boolean);
    const text = uniqueIds.length ? label + '（共 ' + uniqueIds.length + ' 项）' : label;
    const sent = await sendRequest(text, {
      projectId,
      taskId: selectedTask?.id || owningTask?.id || null,
      roundId: activeRun?.roundId || selectedRound?.id || null,
      intent, runId: targetRunId, itemIds: uniqueIds
    });
    // 成功与失败都要有一句话（「提交不了永远要有一句话」）。
    if (sent) setNotice('已把「' + text + '」交给会话：agent 接单后会执行；进度见下方请求队列。');
    else setError('没能把「' + text + '」交给会话（可能正在忙，请稍后再点一次）。');
    return sent;
  };
  const retryRunItemsByIds = async (itemIds) => { await requestRunAction('retry', { itemIds, label: '重试这批里没成的项' }); };
  const retryRunItem = async (itemId) => retryRunItemsByIds([itemId]);
  /**
   * 运行控制两类分治（方案 4.9 / 规格书 §2.2）：
   *   - 暂停 / 取消是**止损**：cookie 直达，点了就生效；
   *   - 重试 / 恢复会**重新花钱**：保持 bearer，界面不直调——**改为写进请求队列派给 agent**。
   */
  const controlRun = async (action, runId = activeRun?.id) => {
    const targetRunId = runId || activeRun?.id;
    if (!targetRunId) return;
    if (action === 'pause' || action === 'cancel') {
      const labels = { pause: '暂停运行', cancel: '取消运行' };
      const paths = { pause: '/pause', cancel: '/cancel' };
      try {
        await api('/api/runs/' + encodeURIComponent(targetRunId) + paths[action], { method: 'POST', idempotencyKey: uniqueKey('run-' + action), body: {} });
        setNotice(labels[action] + '已生效。');
        // 取消是止损：立即生效，但给 5 秒回头路（撤销走队列，由 agent 判断能否继续）。
        if (action === 'cancel') setCancelUndo(beginCancelUndo({ runId: targetRunId }));
        await refresh();
      } catch (nextError) {
        reportRequestError(nextError, '无法' + labels[action] + '。', { operation: 'run-' + action, phase: 'committing' });
      }
      return;
    }
    await requestRunAction(action, { runId: targetRunId, label: action === 'resume' ? '继续这一批的运行' : '重试这一批没成的项' });
  };
  /**
   * 撤销取消（#21）：**不是直调恢复**——把「继续这一批」写进请求队列，
   * 由 agent 判断这一批还在不在、能不能继续（花动作归 agent，4.9）。
   */
  const undoCancelRun = async () => {
    const target = cancelUndo;
    setCancelUndo(null);
    if (target?.runId) await requestRunAction('resume', { runId: target.runId, label: '撤销取消并继续这一批' });
  };
  /** C4：连接面板的配置（浏览器侧，与页面大小同类；不塞 studio.db）。 */
  const updateAgentConnection = (patch) => setAgentConnection(writeAgentConnectionConfig(window.localStorage, patch));
  const copyRunPrompt = async (run) => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器未提供剪贴板权限。');
      const textValue = (value) => typeof value === 'string' ? value.trim() : '';
      const itemPromptPrefix = '\n\nSpecific scene direction for this image: ';
      const summaryPrompt = typeof run?.planSnapshot?.prompt === 'string' ? run.planSnapshot.prompt.trim() : typeof run === 'string' ? run.trim() : '';
      let prompt = summaryPrompt;
      let copiedItemCount = 0;
      if (run && typeof run === 'object' && selectedRound?.id && Number.isFinite(Number(run.planVersion))) {
        const data = await api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/plan-versions');
        const version = listItems(data.planVersions).find((item) => Number(item.planVersion) === Number(run.planVersion));
        const fullPrompt = textValue(version?.plan?.prompt);
        const itemPrompts = Array.isArray(version?.plan?.itemPrompts) ? version.plan.itemPrompts.map(textValue).filter(Boolean) : [];
        if (fullPrompt) {
          copiedItemCount = itemPrompts.length;
          prompt = itemPrompts.length ? itemPrompts.map((itemPrompt, index) => '第 ' + (index + 1) + ' 张完整提示词\n' + fullPrompt + itemPromptPrefix + itemPrompt).join('\n\n---\n\n') : fullPrompt;
        }
      }
      if (!prompt) throw new Error('当前运行没有可复制的提示词。');
      await navigator.clipboard.writeText(prompt);
      setNotice(copiedItemCount ? '已复制 ' + copiedItemCount + ' 条逐图完整提示词。' : prompt.length > summaryPrompt.length ? '已复制本次运行的完整提示词。' : '已复制本次运行的提示词。');
    } catch (nextError) { reportRequestError(nextError, '无法复制本次提示词。', { operation: 'copy-run-prompt', phase: 'requesting' }); }
  };
  const openGenerationConfirmation = async (targetRound = selectedRound) => {
    // ⚠️ 这里原来是一个**静默 return**：状态不符就什么都不做。
    // 用户点了「审阅并确认计划」却毫无反应，只能猜是不是自己点错了。
    // 「提交不了」永远要有一句话，哪怕只是「这一批已经确认过了」。
    const round = targetRound?.id ? rounds.find((item) => item.id === targetRound.id) || targetRound : targetRound;
    if (!round?.id) { setNotice('请先选择要确认的批次。'); return; }
    // 4.1 Q1：可不可以开闸门、开不了怎么跟人说——**单一来源**在 confirmation-entry-model。
    const closedEntry = confirmationEntry({ hasChallenge: false, roundStatus: round.status });
    if (!closedEntry.open && !String(closedEntry.reason).includes('挑战')) { setNotice(closedEntry.reason); return; }
    setGenerationConfirmationBusy(true);
    setGenerationConfirmationError('');
    try {
      // **按批次**读挑战，不读会话。
      // 挑战是批次的属性，而界面看的是哪一批（路由）——这里原来读的是
      // `GET /api/sessions/<自己>/plan-status`，那只在界面自己往 `agent_*` 写指针的年代成立；
      // 指针收归 agent 独占之后这条读法必然拿到 null，确认按钮就会一直说
      // 「请先由当前智能体会话发起挑战」，尽管挑战明明已经在了。
      const data = await api('/api/rounds/' + encodeURIComponent(targetRound.id) + '/confirmation-challenge');
      const pending = data?.pendingConfirmation;
      const entry = confirmationEntry({ hasChallenge: Boolean(pending), roundStatus: round.status });
      if (!entry.open) {
        // 「还没有挑战」是一个**明确的状态**，不是故障：计划在等人确认，但闸门要由
        // agent 先发起挑战。所以给一句看得懂的指引，**不要**把它变成
        // 「操作结果不明确 / 不可自动重试」这种吓人的错误（那是未知故障的说法）。
        setNotice(entry.reason);
        return;
      }
      setGenerationConfirmation({ challenge: pending, round: targetRound });
    } catch (nextError) {
      reportRequestError(nextError, '无法读取本次生成确认挑战。', { operation: 'load-generation-confirmation', phase: 'loading' });
    } finally {
      setGenerationConfirmationBusy(false);
    }
  };
  /**
   * 从请求卡片直达确认闸门。
   *
   * 闸门挂在批次节点上，但批次可能被画布的模式 / 筛选藏起来（用户就会「找不到该节点」）。
   * 卡片是用户正在看的地方（4.2），所以这里直接定位到那一批并打开确认对话框，
   * 不要求用户先去画布上把节点找出来。
   */
  const openRoundFromQueue = useCallback(async (roundId) => {
    if (!roundId) return;
    const round = roundsForQueue.find((item) => item.id === roundId) || null;
    if (!round) {
      setNotice('找不到这一批；它可能属于另一个任务或已被归档。');
      return;
    }
    // 批次的返回体里只有 taskId，项目要从任务上找（队列是项目内的，但这样更稳）。
    const owningTask = tasks.find((item) => item.id === round.taskId) || null;
    navigateRoute({ view: 'lineage', projectId: round.projectId || owningTask?.projectId || selectedProject?.id || null, taskId: round.taskId, roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' });
    if (round.status === 'awaiting_confirmation') await openGenerationConfirmation(round);
  }, [navigateRoute, openGenerationConfirmation, roundsForQueue, selectedProject?.id, tasks]);

  /**
   * 4.1 Q1：卡片上的「改一下」——定位到那一批并**打开计划编辑**（不是又一个「看这一批」）。
   * 与 `openRoundFromQueue` 的区别只在最后一步：一个开闸门，一个开编辑器。
   */
  const openRoundPlanEdit = useCallback((roundId) => {
    if (!roundId) return;
    const round = roundsForQueue.find((item) => item.id === roundId) || null;
    if (!round) { setNotice('找不到这一批；它可能属于另一个任务或已被归档。'); return; }
    const owningTask = tasks.find((item) => item.id === round.taskId) || null;
    navigateRoute({ view: 'lineage', projectId: round.projectId || owningTask?.projectId || selectedProject?.id || null, taskId: round.taskId, roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' });
    setPendingPlanEditRoundId(round.id);
  }, [navigateRoute, roundsForQueue, selectedProject?.id, tasks]);

  /**
   * 9.6「我的配方」：把这一批的可用配置存成配方（用户侧、跨项目复用）。
   * 落在**用户可读写的库**（`style-kits`，两者皆可）上——`confirmed-templates` 是 bearer-only，
   * 浏览器读不了也写不了，用它就要么越界、要么多绕一条队列。
   */
  const savePlanAsRecipe = useCallback(async (round) => {
    if (!round?.id) return;
    const task = tasks.find((item) => item.id === round.taskId) || null;
    const draft = recipeDraftFrom({ plan: round.plan, task });
    try {
      await api('/api/style-kits', { method: 'POST', idempotencyKey: uniqueKey('style-kit-save'), body: { name: draft.name, definition: draft.definition } });
      setNotice('已存为我的配方「' + draft.name + '」；下次发起时可以带出来，改了再出。');
      await refresh();
    } catch (nextError) {
      reportRequestError(nextError, '没能存成配方。', { operation: 'save-recipe', phase: 'committing' });
    }
  }, [api, refresh, reportRequestError, tasks]);

  const dismissGenerationConfirmation = () => {
    if (generationConfirmationBusy) return;
    setGenerationConfirmation(null);
    setGenerationConfirmationError('');
  };
  const confirmGenerationPlan = async () => {
    if (!generationConfirmation) return;
    setGenerationConfirmationBusy(true);
    setGenerationConfirmationError('');
    try {
      const confirmationSessionId = generationConfirmation.challenge.sessionId;
      await api('/api/rounds/' + encodeURIComponent(generationConfirmation.round.id) + '/confirm', { method: 'POST', idempotencyKey: uniqueKey('user-confirm'), body: { expectedVersion: generationConfirmation.challenge.expectedVersion, sessionId: confirmationSessionId, challenge: generationConfirmation.challenge.challenge } });
      setGenerationConfirmation(null);
      setNotice('计划已确认。请回到会话，由会话核算一遍后开始出图。');
      await refresh();
      return true;
    } catch (nextError) {
      setGenerationConfirmationError(errorMessageForDisplay(nextError, '确认计划失败。'));
      return false;
    } finally {
      setGenerationConfirmationBusy(false);
    }
  };
  const openArchiveConfirmation = () => {
    if (!selectedProject || selectedProject.status === 'archived') return;
    setConfirmationError('');
    setConfirmation({ kind: 'archive', projectId: selectedProject.id, projectName: selectedProject.name });
  };
  const dismissConfirmation = () => {
    if (confirmationBusy) return;
    setConfirmation(null);
    setConfirmationError('');
  };
  const confirmPendingAction = async () => {
    if (!confirmation) return;
    setConfirmationBusy(true);
    setConfirmationError('');
    try {
      if (confirmation.kind === 'trash') await moveAssetToTrash(confirmation.assetId);
      else {
        await api('/api/projects/' + encodeURIComponent(confirmation.projectId) + '/archive', { method: 'POST', idempotencyKey: uniqueKey('archive-project'), body: {} });
        await refresh();
      }
      setConfirmation(null);
    } catch (nextError) {
      setConfirmationError(errorMessageForDisplay(nextError, confirmation.kind === 'trash' ? '无法移入回收站。' : '无法归档项目。'));
    } finally { setConfirmationBusy(false); }
  };
  const openProviderDetails = () => { setProviderDetails({ open: true }); };
  const openAdvancedDetails = async () => {
    if (!selectedRound) return;
    const request = advancedDetailRequests.current.begin([selectedRound.id, activeRunId || ''].join(':'));
    try {
      const [plans, dryRuns] = await Promise.all([api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/plan-versions', { signal: request.signal }), api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/dry-runs', { signal: request.signal })]);
      if (request.isCurrent()) setAdvancedDetails(normalizeAdvancedDetails({ plans: plans.planVersions, dryRuns: dryRuns.dryRuns }));
    } catch (nextError) { if (request.isCurrent() && !isAbortError(nextError)) reportRequestError(nextError, '无法读取高级详情。', { operation: 'load-advanced-details', phase: 'loading' }); }
  };
  useEffect(() => {
    advancedDetailRequests.current.cancel();
    setAdvancedDetails(null);
  }, [view, selectedRound?.id, activeRunId]);
  const refreshPlanVersions = async () => {
    if (!selectedRound) { planVersionRequests.current.cancel(); setPlanVersions(EMPTY); return; }
    const request = planVersionRequests.current.begin([view, selectedRound.id, eventRevision.planVersions].join(':'));
    try {
      setPlanVersionsLoading(true);
      const plans = await api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/plan-versions', { signal: request.signal });
      if (request.isCurrent()) setPlanVersions(plans.planVersions || EMPTY);
    } catch (nextError) { if (request.isCurrent() && !isAbortError(nextError)) reportRequestError(nextError, '无法读取计划版本。', { operation: 'load-plan-versions', phase: 'loading' }); } finally { if (request.isCurrent()) setPlanVersionsLoading(false); }
  };
  useEffect(() => {
    if (view !== 'prompts' || !selectedRound) {
      planVersionRequests.current.cancel();
      setPlanVersions(EMPTY);
      setPlanVersionsLoading(false);
      return undefined;
    }
    void refreshPlanVersions();
    return () => planVersionRequests.current.cancel();
  }, [view, selectedRound?.id, eventRevision.planVersions]);
  const dismissGuide = () => { window.localStorage.setItem('daoge-pic:guide-dismissed', '1'); };
  

  const renderAssetsView = () => <section className={'asset-stage ' + (selectedAssets.length && routeView === 'assets' ? 'has-selection' : '')}>
    <PageHeader
      kicker={routeView === 'trash' ? '回收站' : (selectedProject?.name || '项目资产')}
      title={routeView === 'trash' ? '回收站' : '资产'}
      description={routeView === 'trash' ? '这里是被回收的图片；还原后回到项目资产。' : ASSET_BACKSTAGE_COPY}
    />
    <PageToolbar label="资产工具"><span className="asset-count">{assetTotal.toString().padStart(2, '0')}</span><span className="asset-count-label">{routeView === 'trash' ? '回收站图片' : '张图片'}</span>{routeView === 'assets' && <div className="asset-scope-control" aria-label="资产范围">{ASSET_SCOPES.filter((scope) => scope !== 'studio').map((scope) => <button type="button" key={scope} className={assetScope === scope ? 'is-active' : ''} disabled={(scope === 'round' && !selectedRound) || (scope === 'task' && !selectedTask) || (scope === 'project' && !selectedProject)} onClick={() => navigateRoute({ assetScope: scope })}>{ASSET_SCOPE_LABELS[scope]}</button>)}</div>}
        {routeView === 'assets' && selectedProject && <button type="button" className="command-button asset-import-button" disabled={uploading} onClick={() => inputRef.current?.click()}><Upload size={16} />{uploading && uploadProgress ? '正在导入 ' + uploadProgress.completed + '/' + uploadProgress.total : importLabel}</button>}
        <div className="asset-filter" aria-label="素材筛选"><SlidersHorizontal size={14} />{[['all', '全部'], ['generated', '生成'], ['import', '导入']].map(([value, label]) => <button type="button" key={value} className={assetFilter === value ? 'is-active' : ''} onClick={() => { setAssetFilter(value); setAssetPage(1); }}>{label}</button>)}</div>
        {routeView === 'assets' && visibleAssets.length > 0 && <button type="button" className="outline-button asset-select-page" disabled={pageSelectionBusy} onClick={() => void setPageSelection(!allPageAssetsSelected)}><Check size={15} />{allPageAssetsSelected ? '取消全选本页' : '全选本页'}</button>}
        <details className="asset-view-options"><summary><SlidersHorizontal size={14} />显示<span className="asset-view-current">{assetPreviewFit === 'adaptive' ? '自适应卡片' : assetPreviewFit === 'cover-top' ? '填满裁切' : '完整显示'}</span></summary><div className="asset-view-panel"><label className="asset-page-size"><span>每页</span><select aria-label="每页资产数量" value={assetPageSize} onChange={(event) => { setAssetPageSize(normalizeAssetPageSize(event.target.value)); setAssetPage(1); }}>{ASSET_PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select><span>张</span></label><div className="asset-view-mode" aria-label="缩略图显示方式"><span>缩略图显示方式</span><button type="button" aria-pressed={assetPreviewFit === 'adaptive'} className={assetPreviewFit === 'adaptive' ? 'is-active' : ''} onClick={() => setAssetPreviewFit('adaptive')}>自适应卡片<span>按原图比例展示</span></button><button type="button" aria-pressed={assetPreviewFit === 'contain'} className={assetPreviewFit === 'contain' ? 'is-active' : ''} onClick={() => setAssetPreviewFit('contain')}>完整显示<span>留白不裁切</span></button><button type="button" aria-pressed={assetPreviewFit === 'cover-top'} className={assetPreviewFit === 'cover-top' ? 'is-active' : ''} onClick={() => setAssetPreviewFit('cover-top')}>填满裁切<span>铺满卡片，优先显示上半部</span></button></div></div></details>
        {routeView === 'assets' && selectedProject && <AssetStateLegend title="状态说明" compact collapsed />}
        {routeView === 'assets' && selectedProject && <button type="button" className="outline-button asset-trash-link" onClick={() => navigateRoute({ view: 'trash', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' })}><Trash2 size={15} />回收站</button>}
        {routeView === 'trash' && selectedProject && <button type="button" className="outline-button" onClick={() => navigateRoute({ view: 'assets', assetScope: 'project' })}><ImagePlus size={15} />返回素材</button>}
        {selectedAssets.length >= 2 && <IconButton label={'对比选中的 ' + selectedAssets.length + ' 张素材'} onClick={() => { setPreviewZoom(1); setPreviewAssets(selectedAssets); }}><Eye size={16} /></IconButton>}
        <div className="asset-hint">{routeView === 'trash' ? '当前项目回收站' : selectedAssetIds.size ? selectedAssetIds.size + ' 张已选择' : ASSET_SCOPE_LABELS[assetScope] + '资产'}</div>
    </PageToolbar>
    {routeView === 'assets' && selectedProject && <MaterialImportGuide materialNeeds={contextMaterialNeeds} selectedNeed={selectedImportNeed} completedCounts={materialNeedCounts} assetScope={assetScope} selectedRound={selectedRound} onSelectNeed={setSelectedImportNeed} />}
    {routeView === 'assets' && selectedProject && selectedAssets.length > 0 && <AssetSelectionStrip assets={selectedAssets} deliverIntent={deliveryIntent} onRemove={toggleSelection} onClear={() => void clearSelection()} onDownloadArchive={() => downloadProjectArchive(selectedAssets.map((asset) => asset.id))} onDeliver={() => navigateRoute({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {visibleAssets.length ? <><div className={'asset-grid is-preview-' + assetPreviewFit}>{visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selectedAssetIds.has(asset.id)} selectionBusy={selectionBusyIds.has(asset.id)} shared={sharedAssetIds.has(asset.id)} previewFit={assetPreviewFit} onReview={review} onToggleSelect={markAsDeliverable} onTrash={trash} onRestore={restore} onInspect={inspectAsset} onDownload={downloadAsset} onCopy={copyAsset} onSetShared={setAssetShared} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />)}</div><nav className="asset-pagination" aria-label="资产分页"><button type="button" className="outline-button" disabled={assetPage <= 1} onClick={() => setAssetPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} />上一页</button><span>第 <b>{assetPage}</b> / {totalAssetPages} 页 · 共 {assetTotal} 张</span><button type="button" className="outline-button" disabled={assetPage >= totalAssetPages} onClick={() => setAssetPage((current) => Math.min(totalAssetPages, current + 1))}>下一页<ChevronRight size={15} /></button></nav></> : <div className="empty-stage asset-empty">{routeView === 'trash' ? <Archive size={30} strokeWidth={1.15} /> : <Inbox size={30} strokeWidth={1.15} />}<p>{routeView === 'trash' ? '当前项目回收站为空' : (assetScope === 'round' && !selectedRound ? '请先从任务里选择批次，再查看本轮结果。' : '当前范围内暂未找到资产。')}</p>{routeView === 'assets' && <button type="button" className="outline-button" onClick={() => inputRef.current?.click()}><Upload size={16} />导入图片</button>}</div>}
  </section>;
  /**
   * A3：八屏共用 PageFrame —— 宽度只由注册表的 `layout` 档决定（页面不得自写 max-width）。
   * 这里包一层而不是改每个组件：**行为零变化**，先把「容器与宽度」统一；各屏自己的页头换 `PageHeader`
   * 按屏推进（A3b），不混在这一步。
   */
  const page = (view, node) => <PageFrame layout={VIEW_LAYOUTS[view] || 'standard'}>{node}</PageFrame>;
  const viewRenderers = {
    'projects': () => page('projects', <ProjectsView assetScope={assetScope} compareRoundIds={compareRoundIds} navigateRoute={navigateRoute} openCreationDialog={openCreationDialog} projectTemplates={projectTemplates} projects={projects} route={route} view={view} />),
    'project-overview': () => page('project-overview', <ProjectOverviewView assetScope={assetScope} assets={assets} compareRoundIds={compareRoundIds} deliveries={deliveries} navigateRoute={navigateRoute} openArchiveConfirmation={openArchiveConfirmation} openCreationDialog={openCreationDialog} projectTemplates={projectTemplates} qualityMetrics={qualityMetrics} qualityMetricsError={qualityMetricsError} qualityMetricsLoading={qualityMetricsLoading} refreshQualityMetrics={refreshQualityMetrics} route={route} selectedAssets={selectedAssets} selectedProject={selectedProject} tasks={tasks} view={view} />),
    'lineage': () => page('lineage', <LineageView activeRun={activeRun} addAssetsToCurrentRoundReferences={addAssetsToCurrentRoundReferences} assetProvenance={assetProvenance} assetTotal={assetTotal} assets={assets} copyAsset={copyAsset} deliveries={deliveries} deselectAsset={deselectAsset} downloadAsset={downloadAsset} eventRevision={eventRevision} inspectAsset={inspectAsset} lineageAssetCoverage={lineageAssetCoverage} lineageRunItemCoverage={lineageRunItemCoverage} lineageVisibleRunItems={lineageVisibleRunItems} markAsDeliverable={markAsDeliverable} navigateRoute={navigateRoute} openCreationDialog={openCreationDialog} openDerivedRoundDialog={openDerivedRoundDialog} openGenerationConfirmation={openGenerationConfirmation} openReferenceDialog={openReferenceDialog} openRejectReviewDialog={openRejectReviewDialog} pendingPlanEditRoundId={pendingPlanEditRoundId} rounds={rounds} runs={runs} savePlanAsRecipe={savePlanAsRecipe} selectedAssetIds={selectedAssetIds} selectedProject={selectedProject} selectedRound={selectedRound} selectedTask={selectedTask} selectionBusyIds={selectionBusyIds} setAssetProvenance={setAssetProvenance} setAssetShared={setAssetShared} setAssetsSelection={setAssetsSelection} setCanvasSelectedAssetIds={setCanvasSelectedAssetIds} setPendingPlanEditRoundId={setPendingPlanEditRoundId} setPreviewAssets={setPreviewAssets} setPreviewZoom={setPreviewZoom} sharedAssets={sharedAssets} tasks={tasks} view={view} visibleAssets={visibleAssets} />),
    'assets': () => page('assets', <AssetsView allPageAssetsSelected={allPageAssetsSelected} assetFilter={assetFilter} assetPage={assetPage} assetPageSize={assetPageSize} assetPreviewFit={assetPreviewFit} assetScope={assetScope} assetTotal={assetTotal} assets={assets} clearSelection={clearSelection} compareRoundIds={compareRoundIds} contextMaterialNeeds={contextMaterialNeeds} copyAsset={copyAsset} deliveries={deliveries} deliveryIntent={deliveryIntent} downloadAsset={downloadAsset} downloadProjectArchive={downloadProjectArchive} importLabel={importLabel} inputRef={inputRef} inspectAsset={inspectAsset} markAsDeliverable={markAsDeliverable} materialNeedCounts={materialNeedCounts} navigateRoute={navigateRoute} pageSelectionBusy={pageSelectionBusy} restore={restore} review={review} routeView={routeView} selectedAssetIds={selectedAssetIds} selectedAssets={selectedAssets} selectedImportNeed={selectedImportNeed} selectedProject={selectedProject} selectedRound={selectedRound} selectedTask={selectedTask} selectionBusyIds={selectionBusyIds} setAssetFilter={setAssetFilter} setAssetPage={setAssetPage} setAssetPageSize={setAssetPageSize} setAssetPreviewFit={setAssetPreviewFit} setAssetShared={setAssetShared} setPageSelection={setPageSelection} setPreviewAssets={setPreviewAssets} setPreviewZoom={setPreviewZoom} setSelectedImportNeed={setSelectedImportNeed} sharedAssetIds={sharedAssetIds} studio={studio} toggleSelection={toggleSelection} totalAssetPages={totalAssetPages} trash={trash} uploadProgress={uploadProgress} uploading={uploading} view={view} visibleAssets={visibleAssets} />),
    'tasks': () => page('tasks', <TasksView navigateRoute={navigateRoute} openCreationDialog={openCreationDialog} route={route} selectedProject={selectedProject} tasks={tasks} />),
    'studio-overview': () => page('studio-overview', <StudioOverviewView assets={assets} compareRoundIds={compareRoundIds} inspectAsset={inspectAsset} loading={loading} navigateRoute={navigateRoute} review={review} rounds={rounds} runs={runs} selectedProject={selectedProject} selectedTask={selectedTask} studioOverview={studioOverview} taskOverview={taskOverview} toggleComparedRound={toggleComparedRound} view={view} />),
    'prompts': () => page('prompts', <PromptsView confirmation={confirmation} generationConfirmationBusy={generationConfirmationBusy} loading={loading} openGenerationConfirmation={openGenerationConfirmation} planVersions={planVersions} planVersionsLoading={planVersionsLoading} refreshPlanVersions={refreshPlanVersions} selectedRound={selectedRound} session={session} />),
    'runs': () => page('runs', <RunsView activeRun={activeRun} activeRunId={activeRunId} activeRunItemFilter={activeRunItemFilter} activeRunItemPageSize={activeRunItemPageSize} activeRunItemSequence={activeRunItemSequence} advancedDetails={advancedDetails} canCancelActiveRun={canCancelActiveRun} controlRun={controlRun} copyRunPrompt={copyRunPrompt} creativeRecord={creativeRecord} inspectAsset={inspectAsset} navigateRoute={navigateRoute} openAdvancedDetails={openAdvancedDetails} retryRunItem={retryRunItem} retryRunItemsByIds={retryRunItemsByIds} runExecutionStatus={runExecutionStatus} runItemDetail={runItemDetail} runItemPage={runItemPage} runLifecycleStatus={runLifecycleStatus} runs={runs} selectRetryablePageItems={selectRetryablePageItems} selectedRound={selectedRound} selectedRunItemIds={selectedRunItemIds} setAdvancedDetails={setAdvancedDetails} setRunItemDetailId={setRunItemDetailId} setRunItemFilter={setRunItemFilter} setRunItemPageNumber={setRunItemPageNumber} setRunItemPageSizeValue={setRunItemPageSizeValue} setRunItemSequenceValue={setRunItemSequenceValue} taskOverview={taskOverview} toggleRunItemSelection={toggleRunItemSelection} visibleRunItems={visibleRunItems} />),
    'guide': () => page('guide', <GuideView dismissGuide={dismissGuide} navigateRoute={navigateRoute} view={view} />),
    'library': () => page('library', <LibraryView assets={assets} brandKits={brandKits} navigateRoute={navigateRoute} projects={projects} sharedAssets={sharedAssets} styleKits={styleKits} taskTypes={taskTypes} view={view} />),
    'shared-assets': () => page('shared-assets', <SharedAssetsView assets={assets} copyAsset={copyAsset} downloadAsset={downloadAsset} navigateRoute={navigateRoute} projects={projects} setAssetShared={setAssetShared} sharedAssets={sharedAssets} view={view} />),
    'deliveries': () => page('deliveries', <DeliveriesView assetScope={assetScope} assets={assets} batchAction={batchAction} batchBusy={batchBusy} batchName={batchName} compareRoundIds={compareRoundIds} completeDelivery={completeDelivery} copyAsset={copyAsset} deliveries={deliveries} deliveryAction={deliveryAction} deliveryBatches={deliveryBatches} deliveryBusyId={deliveryBusyId} deliveryCompletion={deliveryCompletion} deliveryCreating={deliveryCreating} deliveryFlowAssets={deliveryFlowAssets} deliveryIncludeCreativeRecord={deliveryIncludeCreativeRecord} deliveryName={deliveryName} deliverySelection={deliverySelection} downloadAsset={downloadAsset} downloadDeliveryArchive={downloadDeliveryArchive} downloadProjectArchive={downloadProjectArchive} navigateRoute={navigateRoute} selectedAssets={selectedAssets} selectedDeliveryIds={selectedDeliveryIds} selectedProject={selectedProject} setBatchName={setBatchName} setDeliveryIncludeCreativeRecord={setDeliveryIncludeCreativeRecord} setDeliveryName={setDeliveryName} toggleBatchDelivery={toggleBatchDelivery} toggleSelection={toggleSelection} view={view} />),
    'trash': () => page('trash', <AssetsView allPageAssetsSelected={allPageAssetsSelected} assetFilter={assetFilter} assetPage={assetPage} assetPageSize={assetPageSize} assetPreviewFit={assetPreviewFit} assetScope={assetScope} assetTotal={assetTotal} assets={assets} clearSelection={clearSelection} compareRoundIds={compareRoundIds} contextMaterialNeeds={contextMaterialNeeds} copyAsset={copyAsset} deliveries={deliveries} deliveryIntent={deliveryIntent} downloadAsset={downloadAsset} downloadProjectArchive={downloadProjectArchive} importLabel={importLabel} inputRef={inputRef} inspectAsset={inspectAsset} markAsDeliverable={markAsDeliverable} materialNeedCounts={materialNeedCounts} navigateRoute={navigateRoute} pageSelectionBusy={pageSelectionBusy} restore={restore} review={review} routeView={routeView} selectedAssetIds={selectedAssetIds} selectedAssets={selectedAssets} selectedImportNeed={selectedImportNeed} selectedProject={selectedProject} selectedRound={selectedRound} selectedTask={selectedTask} selectionBusyIds={selectionBusyIds} setAssetFilter={setAssetFilter} setAssetPage={setAssetPage} setAssetPageSize={setAssetPageSize} setAssetPreviewFit={setAssetPreviewFit} setAssetShared={setAssetShared} setPageSelection={setPageSelection} setPreviewAssets={setPreviewAssets} setPreviewZoom={setPreviewZoom} setSelectedImportNeed={setSelectedImportNeed} sharedAssetIds={sharedAssetIds} studio={studio} toggleSelection={toggleSelection} totalAssetPages={totalAssetPages} trash={trash} uploadProgress={uploadProgress} uploading={uploading} view={view} visibleAssets={visibleAssets} />),
    troubleshoot: () => page('troubleshoot', <Troubleshoot request={api} studio={studio} recoveryPhase={recoveryPhase} repairing={runtimeRepairing} onRefresh={() => void refresh()} onCopyDiagnostic={() => void copyRuntimeDiagnostic()} onRepair={() => void repairRuntime()} />)
  };
  const renderActiveView = viewRenderers[routeView];

  if (loading) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  // A4：七条状态条收进一个槽（同一时刻只显示一条；优先级在 status-slot-model 里写死）。
  // 每条仍保留自己的 class 与 role（外观与无障碍不变），只是「谁在台前」由槽决定。
  const cancelUndoActive = Boolean(cancelUndo && cancelUndoAvailable(cancelUndo, cancelUndoNow));
  const runtimeHealthTone = runtimeHealthPresentation(studio?.runtime, recoveryPhase).tone;
  const statusItems = [
    { id: 'runtime-danger', tone: 'runtime-danger', label: '运行异常', when: ['warning', 'danger'].includes(runtimeHealthTone), content: <RuntimeHealthAlertStrip studio={studio} recoveryPhase={recoveryPhase} repairing={runtimeRepairing} onCopy={() => void copyRuntimeDiagnostic()} onRefresh={() => void refresh()} onRepair={() => void repairRuntime()} /> },
    { id: 'provider-outage', tone: 'provider-outage', label: '生成服务不可用', when: Boolean(providerOutage), content: <div className="provider-outage-strip" role="alert" aria-live="assertive"><CircleAlert size={16} aria-hidden="true" /><span>{providerOutageCopy({ kind: providerOutage })}</span></div> },
    { id: 'connection-error', tone: 'connection-error', label: '连接异常', when: Boolean(connectionError), content: <WorkbenchErrorAlert error={connectionError} className="connection-error-strip" icon={CloudOff} dismissLabel="关闭连接错误" onDismiss={() => setConnectionError('')} onRetry={() => void retryWorkbenchError(connectionError, setConnectionError)} onReconnect={() => void reconnectWorkbenchError(connectionError, setConnectionError)} /> },
    { id: 'request-error', tone: 'request-error', label: '操作没成功', when: Boolean(error), content: <WorkbenchErrorAlert error={error} className="error-strip" onDismiss={() => setError('')} onRetry={() => void retryWorkbenchError(error, setError)} onReconnect={() => void reconnectWorkbenchError(error, setError)} /> },
    { id: 'context-error', tone: 'request-error', label: '刚才的位置没恢复', when: Boolean(contextError), content: <div className="error-strip" role="alert" aria-live="assertive"><CircleAlert size={15} aria-hidden="true" /><span>{errorMessageForDisplay(contextError, '无法恢复当前工作对象。')}</span><button type="button" className="outline-button" onClick={() => setContextError('')}>关闭错误提示</button></div> },
    { id: 'cancel-undo', tone: 'cancel-undo', label: '取消可撤销', when: cancelUndoActive, content: <div className="cancel-undo-strip" role="status" aria-live="polite"><span>{cancelUndoLabel(cancelUndo, cancelUndoNow)}</span><button type="button" className="outline-button" onClick={() => void undoCancelRun()}>撤销取消</button></div> },
    { id: 'notice', tone: 'notice', label: '通知', when: Boolean(notice), content: <div className="notice-strip" role="status" aria-live="polite"><Check size={16} /><span>{notice}</span><IconButton label="关闭通知" onClick={() => setNotice('')}><X size={15} /></IconButton></div> }
  ].filter((item) => item.when);

  // A6：布局体检只在显式带参数时挂载（生产零开销）；档位取自注册表，与 PageFrame 同源。
  const layoutAuditEnabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('audit') === 'layout';
  const currentLayoutTier = VIEW_LAYOUTS[routeView] || 'standard';

  return <main className={'studio-shell' + (railCollapsed ? ' is-rail-collapsed' : '')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith('image/')); if (files.length && canImport) void upload(files); }} onPaste={(event) => { const files = [...event.clipboardData.files].filter((item) => item.type.startsWith('image/')); if (files.length && canImport) { event.preventDefault(); void upload(files); } }}>
    <aside className="studio-rail" aria-label="Studio 左侧控制栏">
      <div className="rail-brand-row"><div className="brand-mark" aria-label="DAOGE Pic"><span>DAOGE</span><b>Pic</b></div><button type="button" className="rail-collapse-toggle" onClick={() => setRailCollapsed((current) => !current)} title={railCollapsed ? '展开左侧栏' : '折叠左侧栏'} aria-label={railCollapsed ? '展开左侧栏' : '折叠左侧栏'} aria-pressed={railCollapsed}>{railCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button></div>
      <WorkbenchNavigation view={view} project={selectedProject} task={selectedTask} round={selectedRound} provider={provider} studio={studio} recoveryPhase={recoveryPhase} repairing={runtimeRepairing} onOpenProvider={openProviderDetails} onOpenGuide={() => navigateRoute({ view: 'guide' })} onCopyRuntimeDiagnostic={() => void copyRuntimeDiagnostic()} onRefresh={() => void refresh()} onRepair={() => void repairRuntime()} onNavigate={(nextView, changes = {}) => navigateRoute({ view: nextView, ...changes })} />
    </aside>

    <section className={'work-surface' + (routeView === 'lineage' ? ' is-canvas' : '')}>
      <div className="workspace-chrome">
        <header className="surface-header">
          <div className="heading-group"><p className="eyebrow">{surfaceEyebrow(view, Boolean(selectedProject))}</p><h1>{surfaceTitle(view, selectedProject)}</h1><span>{surfaceSubtitle(view, selectedProject)}</span></div>
          <div className="header-actions">
            <StudioSearch query={searchQuery} results={searchResults} loading={searchLoading} error={searchError} onQueryChange={setSearchQuery} onOpenResult={openSearchResult} />
            <IconButton label="刷新工作台" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
            <input ref={inputRef} className="file-input" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void upload(event.target.files)} />
          </div>
        </header>
        {!studioView ? <>
          <WorkspaceContextBar project={selectedProject} tasks={tasks} task={selectedTask} rounds={rounds} selectedRound={selectedRound} sessionPlanStatus={sessionPlanStatus}  onSelectTask={(taskId) => navigateRoute(updateWorkbenchRoute(route, { taskId, roundId: null, compareRoundIds: [], runId: null, assetScope: taskId ? 'task' : 'project' }))} onSelectRound={(roundId) => { const nextRound = rounds.find((round) => round.id === roundId); navigateRoute(updateWorkbenchRoute(route, { taskId: roundId ? nextRound?.taskId || selectedTask?.id || null : selectedTask?.id || null, roundId, compareRoundIds: roundId ? [roundId] : [], runId: null, assetScope: roundId ? 'round' : selectedTask ? 'task' : 'project' })); }} projects={projects} onSwitchProject={(projectId) => navigateRoute(selectProject(route, projectId))} onRestoreContext={restoreSessionContext} />
        </> : <SessionPlanSummary sessionPlanStatus={sessionPlanStatus} onRestoreContext={restoreSessionContext} />}
      </div>
      <StatusSlot items={statusItems} />
      {/* C4（第 7 批）：队列从「内容之上」挪到内容之后（底部槽）——首元素 y 越界的真因就是它。
          页面区在画布视图是可收缩的滚动区，所以队列长高时画布**让位**，不会被盖住。 */}
      <div className="work-scroll" data-region="scroll">
        {renderActiveView()}
      </div>
      <RequestQueueDock requests={studioRequests} pendingCount={pendingRequestCount} busy={requestBusy} presence={agentPresenceStatus} progress={progressForRequest} onOpenRound={openRoundFromQueue} context={{ projectId: selectedProject?.id || null, taskId: selectedTask?.id || null, roundId: selectedRound?.id || null, assetIds: requestContextAssetIds({ canvasAssetIds: canvasSelectedAssetIds, selectedAssetIds: [...selectedAssetIds] }) }} onSend={sendRequest} onWithdraw={withdrawRequest} onAnswer={answerRequest} onEditPlan={openRoundPlanEdit} providerNotice={providerNotice} detection={agentDetection} detectionLoading={agentDetectionLoading} onDetect={detectAgents} connection={agentConnection} onConnectionChange={updateAgentConnection} selecting={previewAssets.length > 0} />
      {layoutAuditEnabled && <LayoutAuditOverlay layout={currentLayoutTier} screen={routeView} />}
    </section>

    {assetProvenance && routeView !== 'lineage' && <aside className="asset-inspector" data-region="aside-overlay" aria-label="资产来源与评审记录"><AssetProvenanceBody provenance={assetProvenance} onClose={() => setAssetProvenance(null)} onOpenTrace={(output) => navigateRoute({ view: 'runs', projectId: output.project.id, taskId: output.task.id, roundId: output.round.id, runId: output.run.id })} /></aside>}
    {generationConfirmation && <ConfirmationDialog label="确认创作计划" title={'确认这版计划（v' + generationConfirmation.round.planVersion + '）？'} message={confirmationPlanSummary(generationConfirmation.round)} note="确认会把这版计划绑定到当前 conversation 与计划哈希；确认本身不会调用生成服务，需要回到会话继续核算与出图。" confirmLabel="确认计划" busy={generationConfirmationBusy} error={generationConfirmationError} tone="warning" onCancel={dismissGenerationConfirmation} onConfirm={confirmGenerationPlan} />}
    {previewAssets.length > 0 && <ImageInspectorDialog readOnly={routeView === 'assets' || routeView === 'trash'} assets={previewAssets} zoom={previewZoom} selectedAssetIds={selectedAssetIds} selectionBusyIds={selectionBusyIds} selectedProject={selectedProject} selectedTask={selectedTask} fallbackTask={previewAssets.length === 1 ? taskForId(previewAssets[0]?.display?.taskId || previewAssets[0]?.source?.taskId || previewAssets[0]?.source?.creativeTaskId) : null} selectedRound={selectedRound} onClose={() => setPreviewAssets([])} onZoom={setPreviewZoom} onToggleDeliverable={markAsDeliverable} onOpenDerive={openDerivedRoundDialog} onAddReference={(nextAssets, usage) => void addAssetsToCurrentRoundReferences(nextAssets, usage)} onReject={openRejectReviewDialog} onOpenReference={openReferenceDialog} />}
    {rejectDialog && <RejectReviewDialog assets={rejectDialog.assets} canAddNegative={Boolean(selectedRound && selectedRound.status === 'draft')} canCreateNextRound={Boolean(selectedProject && selectedTask)} initialCreateNextRound={rejectDialog.createNextRound} busy={rejectBusy} error={rejectError} onDismiss={dismissRejectDialog} onSave={saveRejectReview} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {providerDetails && <ProviderSettings request={api} onDismiss={() => setProviderDetails(null)} onChanged={refresh} />}
    {creationDialog === 'project' && <ProjectCreationDialog projectTemplates={projectTemplates} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createProjectFromStudio} />}
    {creationDialog === 'task' && selectedProject && <TaskCreationDialog project={selectedProject} projectTemplates={projectTemplates} taskTypes={taskTypes} styleKits={styleKits} brandKits={brandKits} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createTaskFromStudio} />}
    {referenceResolver && selectedProject && <ReferenceRoundResolverDialog project={selectedProject} task={referenceResolver.task || selectedTask} tasks={referenceResolver.tasks || tasks} draftRounds={referenceResolver.draftRounds || EMPTY} assets={referenceResolver.assets || EMPTY} usage={referenceResolver.usage || 'subject'} busy={referenceBusy} error={referenceError} onDismiss={dismissReferenceResolver} onUseRound={(roundId) => void chooseReferenceRound(roundId)} onSelectTask={chooseReferenceTask} onCreateRound={createRoundForPendingReference} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {referenceDialog === 'round' && selectedProject && selectedTask && selectedRound && <ReferenceAssetDialog project={selectedProject} task={selectedTask} round={selectedRound} sharedAssets={sharedAssets} selectedMaterials={referenceMaterials} busy={referenceBusy} error={referenceError} onDismiss={dismissReferenceDialog} onSave={(materials) => void saveRoundReferenceMaterials(materials)} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {creationDialog === 'round' && selectedTask && <RoundCreationDialog task={selectedTask} rounds={rounds} currentRound={selectedRound} recipes={styleKits} busy={creationBusy} error={creationError} onDismiss={dismissCreationDialog} onCreate={createRoundFromStudio} />}
    {derivedDialog && selectedProject && selectedTask && <DerivedRoundDialog project={selectedProject} task={selectedTask} rounds={rounds} currentRound={selectedRound} assets={derivedDialog.assets} initialPurpose={derivedDialog.purpose} initialActionId={derivedDialog.actionId} busy={derivedBusy} error={derivedError} onDismiss={dismissDerivedDialog} onCreate={createDerivedRoundFromAssets} onImportMask={importDerivedMaskAsset} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {confirmation && <ConfirmationDialog label={confirmation.kind === 'archive' ? '确认归档项目' : '确认移入回收站'} title={confirmation.kind === 'archive' ? '归档“' + confirmation.projectName + '”？' : '将图片移入回收站？'} message={confirmation.kind === 'archive' ? '归档后将关闭该项目下的任务与批次。未完成生成必须先暂停或取消。是否继续？' : '这张图片仍被选择、规则资料或交付引用。移入回收站不会删除已冻结交付；引用关系会保留但素材不可用。是否继续？'} confirmLabel={confirmation.kind === 'archive' ? '归档项目' : '移入回收站'} busy={confirmationBusy} error={confirmationError} tone="danger" onCancel={dismissConfirmation} onConfirm={confirmPendingAction} />}
  </main>;
}

function renderWorkbench() {
  createRoot(document.getElementById('root')).render(<WorkbenchErrorBoundary><LocalStudioAuthorizationGate /></WorkbenchErrorBoundary>);
}

renderWorkbench();
