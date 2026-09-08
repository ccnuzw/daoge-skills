import { Component, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, Archive, Bookmark, Check, ChevronLeft, ChevronRight, CircleAlert, CloudOff, Columns3, Copy, Download, Ellipsis, Eye, FolderKanban, GitFork, ImagePlus, Inbox, Library, LoaderCircle, LockKeyhole, MessageSquareText, Pause, Play, RefreshCw, RotateCcw, Search, Share2, SlidersHorizontal, Sparkles, Tag, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { dryRunEvidence, normalizeAdvancedDetails } from './advanced-details.mjs';
import { runExecutionPresentation, runHistoryOption, runItemRecovery, statusPresentation, taskPresentation } from './status-presentation.mjs';
import { planPresentation, planStateLabel } from './plan-presentation.mjs';
import { ASSET_SCOPES, isStudioView, parseWorkbenchRoute, rendererForWorkbenchView, selectProject, selectRound, selectTask, serializeWorkbenchRoute, updateWorkbenchRoute } from './workbench-route.mjs';
import { PromptWorkspace } from './prompt-workspace.jsx';
import { LearningCenter } from './learning-center.jsx';
import { CreativeLibrary } from './creative-library.jsx';
import { SharedAssets } from './shared-assets.jsx';
import { CreativeLineageCanvas } from './creative-lineage-canvas.jsx';
import { CreatorDelivery } from './creator-delivery.jsx';
import { WorkbenchNavigation } from './workbench-navigation.jsx';
import { deliverySelectionMessage, projectDeliverySelection } from './delivery-workflow.mjs';
import { bootstrapLocalStudioSession } from './local-auth.mjs';
import { AccessibleDialog } from './accessible-dialog.jsx';
import { ConfirmationDialog } from './confirmation-dialog.jsx';
import { StudioSearch } from './studio-search.jsx';
import { createLatestRequestGate, useRouteRefresh } from './use-route-refresh.mjs';
import { studioEventRefreshPlan, useStudioEvents } from './use-studio-events.mjs';
import { assetOriginalUrl, assetThumbnailUrl } from './asset-media-url.mjs';
import { ASSET_IMPORT_CONCURRENCY, mapWithConcurrency } from './bounded-concurrency.mjs';
import { createEventRefreshQueue } from './refresh-coordinator.mjs';
import { createStudioSearchCoordinator } from './studio-search-model.mjs';
import { batchOperationSignature, createBatchOperationSnapshot, createDeliveryInteractionGuard, isDeliveryOperationCurrent } from './creator-delivery-model.mjs';
import { ASSET_PAGE_SIZES, DEFAULT_ASSET_PAGE_SIZE, assetPageCount, clampAssetPage, normalizeAssetPageSize } from './asset-pagination.mjs';
import { DEFAULT_RUN_ITEM_FILTER, DEFAULT_RUN_ITEM_PAGE_SIZE, EMPTY_RUN_ITEM_PAGE, RUN_ITEM_FILTER_OPTIONS, RUN_ITEM_PAGE_SIZES, normalizeRunItemFilter, normalizeRunItemPage, normalizeRunItemPageNumber, normalizeRunItemPageSize, normalizeRunItemSequence, retryableRunItems, runItemFilterCount, runItemPageBounds, runItemProgress, selectableRunItemIds, serializeRunItemRequestQuery } from './run-item-pagination.mjs';
import { assetRefreshPath } from './asset-refresh-plan.mjs';
import { EMPTY_LINEAGE_RUN_ITEM_COVERAGE, LINEAGE_ASSET_PAGE_SIZE, loadCompleteLineageAssets, loadCompleteLineageRunItems } from './lineage-data-loader.mjs';
import { PROJECT_PAGE_SIZE, TASK_OVERVIEW_PAGE_SIZE, TASK_PAGE_SIZE, createProjectSearchIndex, createTaskSearchIndex, filterProjectIndex, filterTaskIndex, paginateWorkspaceItems } from './workspace-list-model.mjs';
import { ProviderSettings } from './provider-settings.jsx';
import { workbenchConversationId } from './workbench-session.mjs';
import { redactedRuntimeDiagnostic, runtimeHealthPresentation } from './runtime-health.mjs';
import { installBrowserErrorGuard } from './browser-error-guard.mjs';
import './styles.css';

const EMPTY = [];

installBrowserErrorGuard();

function isAbortError(error) {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      headers: {
        accept: 'application/json',
        'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0',
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    const connectionFailure = new Error('无法连接到本地 Studio。请刷新到当前 Studio 地址后重试。');
    connectionFailure.category = 'connection';
    throw connectionFailure;
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok ? '本地 Studio 返回了无效响应。' : '本地 Studio 暂时不可用。');
  }
  if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || '本地 Studio 请求失败。');
  return payload.data;
}

function projectArchiveUrl(projectId, assetIds) { const params = new URLSearchParams(); for (const assetId of assetIds) params.append('assetId', assetId); return '/api/projects/' + encodeURIComponent(projectId) + '/assets/archive?' + params.toString(); }

function deliveryArchiveUrl(deliveryId, sequences) { const params = new URLSearchParams(); for (const sequence of sequences) params.append('sequence', String(sequence)); return '/api/deliveries/' + encodeURIComponent(deliveryId) + '/archive?' + params.toString(); }


function uniqueKey(prefix) {
  return prefix + '-' + crypto.randomUUID();
}
const DELIVERY_COMPLETION_PREFIX = 'daoge-pic:delivery-completion:';
const ASSET_PAGE_SIZE_KEY = 'daoge-pic:asset-page-size';
const RAIL_COLLAPSE_KEY = 'daoge-pic:rail-collapsed';

const ASSET_SCOPE_LABELS = { round: '当前轮次', task: '当前任务', project: '当前项目', studio: '全部 Studio' };
const ROUND_PURPOSE_LABELS = { exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' };


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

function statusLabel(value) { return statusPresentation('generic', value).label; }

function StatusPill({ value, scope = 'generic', presentation = null }) {
  const semantics = presentation || statusPresentation(scope, value);
  return <span className={'status-pill ' + semantics.tone}>{semantics.label}</span>;
}

function IconButton({ label, children, onClick, disabled = false, tone = 'default' }) {
  return <button className={'icon-button ' + tone} type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}>{children}</button>;
}

function RuntimeHealthAlertStrip({ studio, recoveryPhase, repairing, onCopy, onRefresh, onRepair }) {
  const presentation = runtimeHealthPresentation(studio?.runtime, recoveryPhase);
  if (!['warning', 'danger'].includes(presentation.tone)) return null;
  const repairable = recoveryPhase === 'ready' && [studio?.runtime?.workerPool?.state, studio?.runtime?.mediaWorkerPool?.state].some((state) => state === 'degraded' || state === 'failed');
  return <aside className={'runtime-alert-strip is-' + presentation.tone} role={presentation.tone === 'danger' ? 'alert' : 'status'} aria-live={presentation.live ? 'polite' : 'off'}>
    <div><Activity size={16} aria-hidden="true" /><strong>{presentation.title}</strong><span>{presentation.detail}</span></div>
    <div className="runtime-health-actions">
      {repairable && <button type="button" className="outline-button" disabled={repairing} onClick={onRepair}><RefreshCw size={15} className={repairing ? 'spin' : ''} />{repairing ? '正在重启' : '安全重启'}</button>}
      <button type="button" className="outline-button" onClick={onRefresh}><RefreshCw size={15} />刷新状态</button>
      <button type="button" className="outline-button" onClick={onCopy}><Copy size={15} />复制脱敏诊断</button>
    </div>
  </aside>;
}

function SessionPlanSummary({ sessionPlanStatus }) {
  if (!sessionPlanStatus) return null;
  const context = sessionPlanStatus.context;
  const purpose = context ? (({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[context.round.purpose] || context.round.purpose) : '';
  return <details className={'session-plan-summary ' + (!context ? 'is-empty' : '')}>
    <summary><LockKeyhole size={14} aria-hidden="true" /><span>当前会话</span><b>{context ? context.project.name + ' / ' + context.task.name : '未绑定活动轮次'}</b>{context && <em>{purpose} · 计划 v{context.round.planVersion}</em>}</summary>
    <div className="session-plan-popover" aria-label="当前会话只读计划摘要">
      {context ? <><p className="eyebrow">只读摘要</p><h3>{context.project.name} / {context.task.name}</h3><span>{purpose} · 计划 v{context.round.planVersion}</span><div className="session-plan-state"><StatusPill value={context.round.status} scope="round" /><span>{sessionPlanStatus.confirmation?.confirmed ? '当前计划已由用户确认' : '当前计划尚未人工确认'}</span>{sessionPlanStatus.latestRun && <span>最近运行：{statusLabel(sessionPlanStatus.latestRun.status)}</span>}</div></> : <><p className="eyebrow">只读摘要</p><h3>当前会话没有活动轮次</h3><span>请在会话中绑定项目、任务和轮次；此处只显示已绑定的计划事实。</span></>}
    </div>
  </details>;
}
function AssetSelectionStrip({ assets, onRemove, onClear, onPreview, onDownloadArchive, onDeliver }) {
  return <section className="selection-strip">
    <header><div><p className="eyebrow">已选图片</p><h2>{String(assets.length).padStart(2, '0')} 张</h2></div>{assets.length > 0 && <div className="selection-strip-actions"><button type="button" className="outline-button" onClick={() => onPreview(assets)}><Eye size={15} />预览</button><button type="button" className="command-button" onClick={onDeliver}><Check size={15} />去交付</button><button type="button" className="outline-button" onClick={onDownloadArchive}><Download size={15} />打包下载 {assets.length} 张</button><IconButton label="清空当前选片" onClick={onClear}><X size={15} /></IconButton></div>}</header>
    {assets.length ? <div className="selection-strip-items">{assets.map((asset) => <article className="selection-item" key={asset.id}><button type="button" className="selection-preview" onClick={() => onPreview([asset])} aria-label="放大查看已选图片"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button><div className="selection-item-copy"><strong title={asset.display?.label || '已选素材'}>{asset.display?.label || '已选素材'}</strong><span>{asset.review?.decision === 'keep' ? '已保留' : asset.review?.decision === 'review' ? '待复核' : asset.review?.decision === 'derive' ? '衍生方向' : '尚未评审'}</span></div><button type="button" className="selection-remove" title="移出当前选片" aria-label="移出当前选片" onClick={() => onRemove(asset.id)}><X size={13} /></button></article>)}</div> : <div className="selection-strip-empty"><Bookmark size={18} /><span>当前没有已选图片</span></div>}
  </section>;
}

function ListPager({ page, totalPages, total, onPageChange }) {
  if (totalPages <= 1) return <span className="workspace-list-total">共 {total} 项</span>;
  return <nav className="workspace-list-pager" aria-label="列表分页"><button type="button" className="outline-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={14} />上一页</button><span>第 {page} / {totalPages} 页 · 共 {total} 项</span><button type="button" className="outline-button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页<ChevronRight size={14} /></button></nav>;
}

function ProjectIndex({ projects, onOpenProject }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const projectIndex = useMemo(() => createProjectSearchIndex(projects), [projects]);
  const filtered = useMemo(() => filterProjectIndex(projectIndex, deferredQuery, status), [projectIndex, deferredQuery, status]);
  const pagination = useMemo(() => paginateWorkspaceItems(filtered, page, PROJECT_PAGE_SIZE), [filtered, page]);
  useEffect(() => { if (pagination.page !== page) setPage(pagination.page); }, [page, pagination.page]);
  return <section className="project-index-stage"><header><div><p className="eyebrow">Studio 项目</p><h2>继续创作</h2><span>搜索、筛选和分页管理项目，不让历史项目无限向下堆叠。</span></div></header><div className="workspace-list-toolbar"><label className="workspace-list-search"><Search size={15} /><input type="search" value={query} placeholder="搜索项目名称或说明" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{query && <IconButton label="清空项目搜索" onClick={() => { setQuery(''); setPage(1); }}><X size={14} /></IconButton>}</label><div className="workspace-list-filters" aria-label="项目状态">{[['active', '进行中'], ['archived', '已归档'], ['all', '全部']].map(([value, label]) => <button type="button" key={value} className={status === value ? 'is-active' : ''} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div></div>{pagination.items.length ? <><div className="project-index-list">{pagination.items.map((project) => <button type="button" key={project.id} onClick={() => onOpenProject(project.id)}><FolderKanban size={18} /><span><b>{project.name}</b><small>{statusLabel(project.status)}{project.description ? ' · ' + project.description : ''}</small></span><span className="project-index-open">打开</span></button>)}</div><ListPager page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} /></> : <div className="empty-stage"><FolderKanban size={30} strokeWidth={1.15} /><p>{projects.length ? '没有符合当前搜索与状态筛选的项目。' : '在会话中创建项目后，会显示在这里。'}</p></div>}</section>;
}

function ManagedTaskList({ tasks, pageSize, actionLabel, emptyMessage, onOpenTask }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const taskIndex = useMemo(() => createTaskSearchIndex(tasks), [tasks]);
  const filtered = useMemo(() => filterTaskIndex(taskIndex, deferredQuery, status), [taskIndex, deferredQuery, status]);
  const pagination = useMemo(() => paginateWorkspaceItems(filtered, page, pageSize), [filtered, page, pageSize]);
  useEffect(() => { if (pagination.page !== page) setPage(pagination.page); }, [page, pagination.page]);
  return <><div className="workspace-list-toolbar is-task"><label className="workspace-list-search"><Search size={15} /><input type="search" value={query} placeholder="搜索任务名称" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{query && <IconButton label="清空任务搜索" onClick={() => { setQuery(''); setPage(1); }}><X size={14} /></IconButton>}</label><div className="workspace-list-filters" aria-label="任务状态">{[['open', '进行中'], ['completed', '已完成'], ['archived', '已归档'], ['all', '全部']].map(([value, label]) => <button type="button" key={value} className={status === value ? 'is-active' : ''} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div></div>{pagination.items.length ? <><div className="project-task-list is-full">{pagination.items.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}><span><b>{task.name}</b><small>{taskPresentation(task).label}</small></span><span>{actionLabel}</span></button>)}</div><ListPager page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} /></> : <div className="empty-stage"><FolderKanban size={26} strokeWidth={1.15} /><p>{tasks.length ? '没有符合当前搜索与状态筛选的任务。' : emptyMessage}</p></div>}</>;
}

function ProjectOverview({ project, tasks, selectedCount, onOpenTasks, onOpenAssets, onOpenDeliveries, onOpenTask }) {
  const activeTasks = tasks.filter((task) => !['archived', 'completed'].includes(task.status));
  const nextTask = activeTasks[0] || tasks[0] || null;
  const recentTasks = (activeTasks.length ? activeTasks : tasks).slice(0, TASK_OVERVIEW_PAGE_SIZE);
  const nextTitle = nextTask ? '继续：' + nextTask.name : selectedCount ? '去交付已选图片' : '先在会话中创建任务';
  const nextHint = nextTask ? taskPresentation(nextTask).label : selectedCount ? selectedCount + ' 张图片已选好，可以创建交付包。' : '项目已打开，新的创作目标由当前会话建立。';
  const nextAction = nextTask ? () => onOpenTask(nextTask.id) : selectedCount ? onOpenDeliveries : onOpenTasks;
  return <section className="project-overview-stage"><header className="project-overview-head"><div><p className="eyebrow">项目</p><h2>{project.name}</h2></div><StatusPill value={project.status} scope="project" /></header><section className="project-next-step"><div><p className="eyebrow">下一步</p><h3>{nextTitle}</h3><span>{nextHint}</span></div><button type="button" className="command-button" onClick={nextAction}>{nextTask ? <Play size={16} /> : selectedCount ? <Check size={16} /> : <FolderKanban size={16} />}{nextTask ? '继续任务' : selectedCount ? '去交付' : '查看任务'}</button></section><div className="project-status-strip"><button type="button" onClick={onOpenTasks}><span>任务</span><b>{tasks.length}</b><small>{activeTasks.length ? activeTasks.length + ' 个可继续' : '没有待处理任务'}</small></button><button type="button" onClick={onOpenAssets}><span>已选图片</span><b>{selectedCount}</b><small>用于交付的成果</small></button><button type="button" onClick={onOpenDeliveries}><span>交付</span><b>打开</b><small>下载与交付包</small></button></div><section className="project-task-panel is-recent"><header><div><p className="eyebrow">最近任务</p><h3>选择一个目标</h3></div><button type="button" className="outline-button" onClick={onOpenTasks}>全部任务</button></header>{recentTasks.length ? <div className="project-task-list is-compact">{recentTasks.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}><span><b>{task.name}</b><small>{taskPresentation(task).label}</small></span><span>继续</span></button>)}</div> : <div className="empty-stage"><FolderKanban size={26} strokeWidth={1.15} /><p>在会话中建立创作任务后，可以从这里继续。</p></div>}</section></section>;
}

function ProjectTaskList({ project, tasks, onOpenTask }) {
  return <section className="project-tasks-stage"><header><div><p className="eyebrow">{project.name}</p><h2>任务</h2><span>搜索、按状态筛选并分页管理每个独立创作目标。</span></div></header><ManagedTaskList tasks={tasks} pageSize={TASK_PAGE_SIZE} actionLabel="查看轮次" emptyMessage="在会话中建立创作任务后，会显示在这里。" onOpenTask={onOpenTask} /></section>;
}

function WorkspaceContextBar({ project, task, rounds, selectedRound, view, assetScope, sessionPlanStatus, onProject, onTasks, onSelectRound, onNavigate }) {
  if (!project) return null;
  const taskMode = Boolean(task) && (['lineage', 'studio-overview', 'prompts', 'runs'].includes(view) || (view === 'assets' && assetScope !== 'project'));
  return <div className="workspace-context"><button type="button" onClick={onProject}><span>项目</span><b>{project.name}</b></button>{task && <button type="button" onClick={onTasks}><span>任务</span><b>{task.name}</b></button>}{taskMode && <><label><span>轮次</span><select value={selectedRound?.id || ''} onChange={(event) => onSelectRound(event.target.value || null)}><option value="">选择轮次</option>{rounds.map((round) => <option value={round.id} key={round.id}>{ROUND_PURPOSE_LABELS[round.purpose] || round.purpose} · 计划 v{round.planVersion}</option>)}</select></label><div className="task-local-tabs"><button type="button" className={view === 'prompts' ? 'is-active' : ''} disabled={!selectedRound} onClick={() => onNavigate('prompts', { assetScope: 'round' })}>计划</button><button type="button" className={view === 'runs' ? 'is-active' : ''} disabled={!selectedRound} onClick={() => onNavigate('runs', { assetScope: 'round' })}>生成历史</button><button type="button" className={view === 'assets' ? 'is-active' : ''} onClick={() => onNavigate('assets', { assetScope: selectedRound ? 'round' : 'task' })}>结果</button><button type="button" className={view === 'lineage' ? 'is-active' : ''} onClick={() => onNavigate('lineage', { assetScope: selectedRound ? 'round' : 'task' })}>谱系</button><details className="task-more-tabs"><summary>更多</summary><div><button type="button" className={view === 'studio-overview' ? 'is-active' : ''} onClick={() => onNavigate('studio-overview', { assetScope: 'task' })}>轮次对比</button></div></details></div></>}<SessionPlanSummary sessionPlanStatus={sessionPlanStatus} /></div>;
}


function AssetCard({ asset, selected, selectionBusy, shared, onToggleSelect, onReview, onTrash, onRestore, onPreview, onInspect, onDownload, onCopy, onSetShared }) {
  const [annotating, setAnnotating] = useState(false);
  const [note, setNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const saveNote = () => { if (!note.trim()) return; onReview(asset.id, 'review', { note: note.trim() }); setNote(''); setAnnotating(false); };
  const runMenuAction = (callback) => { callback(); setMenuOpen(false); };
  const assetLabel = asset.display?.label || (asset.kind === 'generated' ? '生成结果' : '导入素材');
  const roundLabel = asset.display?.roundSequence ? (({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[asset.display.roundPurpose] || '创作') + ' · 第 ' + asset.display.roundSequence + ' 轮' : null;
  const contextLabel = asset.display?.taskName && roundLabel ? asset.display.taskName + ' · ' + roundLabel : asset.display?.taskName || roundLabel;
  const stateLabel = asset.deletedAt ? '回收站' : asset.review?.decision === 'keep' ? '已保留' : asset.review?.decision === 'review' ? '待复核' : asset.review?.decision === 'reject' ? '不采用' : selected ? '已选' : '未评审';
  return <article className={'asset-card ' + (asset.deletedAt ? 'is-trashed ' : '') + (selected ? 'is-selected' : '')}>
    <div className="asset-preview">
      {asset.deletedAt ? <div className="trash-preview"><Trash2 size={24} strokeWidth={1.4} /></div> : <button type="button" className="asset-preview-button" onClick={() => onPreview([asset])} aria-label="放大查看素材"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button>}
      {!asset.deletedAt && <label className="asset-select-control"><input type="checkbox" checked={selected} disabled={selectionBusy} onChange={() => onToggleSelect(asset)} /><span><Bookmark size={13} fill={selected ? 'currentColor' : 'none'} />{selected ? '已选成果' : '选为成果'}</span></label>}
      <div className="asset-card-tools"><IconButton label={menuOpen ? '关闭更多操作' : '更多操作'} onClick={() => setMenuOpen((value) => !value)}><Ellipsis size={17} /></IconButton></div>

    </div>
    {menuOpen && <div className="asset-action-menu">{asset.deletedAt ? <button type="button" onClick={() => runMenuAction(() => onRestore(asset.id))}><RotateCcw size={15} /><span>恢复资产</span></button> : <><button type="button" aria-label="下载原图" onClick={() => runMenuAction(() => onDownload(asset))}><Download size={15} /><span>下载原图</span></button><button type="button" onClick={() => runMenuAction(() => onCopy(asset))}><Copy size={15} /><span>复制图片</span></button><button type="button" onClick={() => runMenuAction(() => onSetShared(asset, !shared))}><Share2 size={15} /><span>{shared ? '取消共享' : '共享到资料'}</span></button><button type="button" onClick={() => runMenuAction(() => onInspect(asset.id))}><GitFork size={15} /><span>来源</span></button><div className="asset-action-group"><button type="button" onClick={() => runMenuAction(() => onReview(asset.id, 'keep'))}><Check size={15} /><span>保留</span></button><button type="button" onClick={() => runMenuAction(() => onReview(asset.id, 'review'))}><CircleAlert size={15} /><span>待复核</span></button><button type="button" onClick={() => { setAnnotating(true); setMenuOpen(false); }}><MessageSquareText size={15} /><span>批注</span></button><button type="button" onClick={() => runMenuAction(() => onReview(asset.id, 'derive'))}><Sparkles size={15} /><span>可衍生</span></button><button type="button" onClick={() => runMenuAction(() => onReview(asset.id, 'reject'))}><X size={15} /><span>不采用</span></button></div><button type="button" className="danger" role="menuitem" onClick={() => runMenuAction(() => onTrash(asset.id))}><Trash2 size={15} /><span>移入回收站</span></button></>}</div>}
    <div className="asset-meta"><div><strong>{assetLabel}</strong><span className="asset-state">{stateLabel}</span></div>{contextLabel && <span className="asset-context-line" title={contextLabel}>{contextLabel}</span>}</div>
    {annotating && <div className="annotation-editor"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录本轮反馈" /><button type="button" className="outline-button" disabled={!note.trim()} onClick={saveNote}>保存批注</button></div>}
  </article>;
}

function RunItemOutputThumbs({ assets, onInspect }) {
  if (!assets?.length) return <span className="run-item-output is-empty">暂无图像</span>;
  return <span className="run-item-output">{assets.slice(0, 3).map((asset, index) => <button type="button" key={asset.id} aria-label={'查看第 ' + (index + 1) + ' 个结果资产来源'} title="查看结果资产来源" onClick={() => void onInspect(asset.id)}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button>)}{assets.length > 3 && <em>+{assets.length - 3}</em>}</span>;
}

function RunItemRow({ item, selected, onToggleSelected, onOpenDetail, onInspect, onRetry }) {
  const recovery = runItemRecovery(item);
  const retryable = retryableRunItems([item]).length > 0;
  const attempts = Number.isInteger(item.attempts) ? item.attempts : 0;
  return <article className={'run-item-row ' + (selected ? 'is-selected ' : '') + (retryable ? 'is-retryable' : '')}>
    <label className="run-item-select"><input type="checkbox" checked={selected} disabled={!retryable} onChange={() => onToggleSelected(item.id)} aria-label={'选择第 ' + item.sequence + ' 项用于批量重试'} /><span aria-hidden="true"><Check size={12} /></span></label>
    <div className="run-item-summary"><b>#{String(item.sequence).padStart(3, '0')}</b><RunItemOutputThumbs assets={item.outputAssets || EMPTY} onInspect={onInspect} /></div>
    <StatusPill value={item.status} scope="run_item" />
    <div className="run-item-details"><span>尝试 {attempts} 次</span>{item.retryAt && <span>重试 {item.retryAt}</span>}{item.updatedAt && <span>更新 {new Date(item.updatedAt).toLocaleString('zh-CN')}</span>}{recovery.error && <span className="run-item-error">{recovery.error}</span>}{recovery.advice && <span className="run-item-recovery">{recovery.advice}</span>}</div>
    <div className="run-item-actions"><button type="button" className="outline-button" onClick={() => onOpenDetail(item)}><Eye size={15} />详情</button>{retryable && <IconButton label={'重试第 ' + item.sequence + ' 项'} onClick={() => void onRetry(item.id)}><RefreshCw size={15} /></IconButton>}</div>
  </article>;
}

function RunItemDetailDialog({ item, onDismiss, onInspect, onRetry }) {
  if (!item) return null;
  const recovery = runItemRecovery(item);
  const retryable = retryableRunItems([item]).length > 0;
  return <AccessibleDialog label={'第 ' + item.sequence + ' 项运行详情'} onDismiss={onDismiss} className="run-item-detail-dialog">
    <header><div><p className="eyebrow">运行项详情</p><h2>第 {item.sequence} 项</h2></div><IconButton label="关闭运行项详情" onClick={onDismiss}><X size={16} /></IconButton></header>
    <div className="run-item-detail-grid"><section><h3>状态</h3><StatusPill value={item.status} scope="run_item" /><p>已尝试 {Number.isInteger(item.attempts) ? item.attempts : 0} 次{item.retryAt ? '，下次重试 ' + item.retryAt : ''}。</p>{item.updatedAt && <p>最后更新：{new Date(item.updatedAt).toLocaleString('zh-CN')}</p>}</section><section><h3>恢复建议</h3>{recovery.error ? <p className="run-item-error">{recovery.error}</p> : <p>没有安全错误摘要。</p>}{recovery.advice && <p className="run-item-recovery">{recovery.advice}</p>}</section><section className="run-item-detail-assets"><h3>输出资产</h3>{item.outputAssets?.length ? <div>{item.outputAssets.map((asset) => <button type="button" key={asset.id} onClick={() => void onInspect(asset.id)}><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /><span>{asset.mediaType || 'image'} · {asset.mediaState || 'available'}</span></button>)}</div> : <p>这一项还没有输出资产。</p>}</section></div>
    {retryable && <footer><button type="button" className="command-button" onClick={() => void onRetry(item.id)}><RefreshCw size={16} />立即重试此项</button></footer>}
  </AccessibleDialog>;
}

function RunItemProgressBar({ page }) {
  const progress = runItemProgress(page.statusCounts);
  const total = Math.max(0, Number(page.allTotal || page.total || 0));
  const segments = [{ key: 'succeeded', label: '完成', value: progress.succeeded }, { key: 'active', label: '进行中', value: progress.active }, { key: 'waiting', label: '等待', value: progress.waiting }, { key: 'attention', label: '需处理', value: progress.attention }, { key: 'cancelled', label: '取消', value: progress.cancelled }].filter((segment) => segment.value > 0);
  return <div className="run-item-progress" role="progressbar" aria-label={'运行项完成进度：' + progress.succeeded + ' / ' + total} aria-valuemin="0" aria-valuemax={total || 1} aria-valuenow={Math.min(progress.succeeded, total || 1)}>
    <div>{segments.length ? segments.map((segment) => <span key={segment.key} className={'is-' + segment.key} style={{ width: Math.max(2, (segment.value / Math.max(1, total)) * 100) + '%' }} />) : <span className="is-empty" />}</div>
    <p>{progress.succeeded} 完成 · {progress.active} 进行中 · {progress.attention} 需处理 · 共 {total} 项</p>
  </div>;
}

function GenerationHistory({ selectedRound, runs, activeRunId, activeRun, runExecutionStatus, runLifecycleStatus, taskOverview, creativeRecord, visibleRunItems, runItemPage, runItemFilter, runItemPageSize, runItemSequence, selectedRunItemIds, runItemDetail, canCancelActiveRun, advancedDetails, onSelectRun, onControlRun, onRetryItem, onInspectAsset, onSetRunItemFilter, onSetRunItemPage, onSetRunItemPageSize, onSetRunItemSequence, onToggleRunItemSelection, onSelectRetryablePageItems, onRetrySelectedItems, onOpenRunItemDetail, onCloseRunItemDetail, onToggleAdvanced, onCloseAdvanced, onCopyPrompt }) {
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
      <aside className="run-history-panel" aria-label="当前轮次的生成历史">
        <header><div><p className="eyebrow">当前轮次</p><h2>运行记录</h2></div><span className="run-history-count">{runs.length}</span></header>
        <p className="run-history-help">{selectedRound ? '选择一条记录查看当时的提示词、结果与恢复操作。' : '先从上方选择轮次。'}</p>
        {selectedRound ? runs.length ? <div className="run-history-list">{runs.map((run, index) => <button type="button" key={run.id} className={run.id === activeRunId ? 'is-active' : ''} aria-pressed={run.id === activeRunId} aria-label={runHistoryOption(run)} title={runHistoryOption(run)} onClick={() => onSelectRun(run.id)}>
          <span className="run-history-index">{String(index + 1).padStart(2, '0')}</span>
          <span className="run-history-entry"><b>计划 v{run.planVersion ?? '?'}</b><small>{run.createdAt ? new Date(run.createdAt).toLocaleString('zh-CN') : '时间未知'} · {String(run.id || '').slice(-8) || '未知标识'}</small></span>
          <StatusPill value={run.status} scope="run" />
        </button>)}</div> : <p className="empty-copy">当前轮次还没有生成运行。</p> : <p className="empty-copy">从上方选择一个轮次后，再查看生成历史。</p>}
      </aside>

      <section className="run-detail-panel">
        <header className="run-detail-header">
          <div><p className="eyebrow">{selectedRound ? (ROUND_PURPOSE_LABELS[selectedRound.purpose] || selectedRound.purpose) + '轮次' : '未选择轮次'}</p><h2>{activeRun ? '生成详情' : '选择一条运行记录'}</h2>{activeRun && <span>{activeRun.createdAt ? new Date(activeRun.createdAt).toLocaleString('zh-CN') : '时间未知'} · 计划 v{activeRun.planVersion ?? '?'} · {runShortId}</span>}</div>
          {activeRun && <StatusPill presentation={runExecutionStatus} />}
        </header>

        {activeRun ? <>
          <section className="run-prompt-card">
            <header><div className="run-prompt-title"><MessageSquareText size={17} aria-hidden="true" /><div><span>本次提示词</span><small>{plan.operation} · {plan.output}</small></div></div><button type="button" className="run-copy-button" onClick={() => void onCopyPrompt(activeRun.planSnapshot.prompt)} disabled={!hasPrompt}><Copy size={15} />复制提示词</button></header>
            <p>{plan.prompt}</p>
            <div className="run-plan-facts"><span>计划产出 <b>{plan.itemCount ?? '未记录'}</b></span><span>参考素材 <b>{activeRun.planSnapshot?.referenceCount ?? plan.references.length}</b></span><span>执行并发 <b>{activeRun.executionConcurrency || '未记录'}</b></span></div>
          </section>

          <section className="run-overview-strip" aria-label="运行概览">
            {taskOverview && <div className="run-task-context"><p className="eyebrow">当前任务</p><strong>{taskOverview.task?.name}</strong><span>{taskOverview.summary?.roundCount || 0} 个轮次 · {taskOverview.summary?.runCount || 0} 次运行 · {taskOverview.summary?.resultCount || 0} 个结果{creativeRecord?.lineage?.rounds?.length ? ' · 承接 ' + creativeRecord.lineage.rounds.length + ' 个上游轮次' : ''}</span></div>}
            <div className="run-metrics"><div><span>计划</span><b>v{activeRun.planVersion ?? creativeRecord?.round?.planVersion ?? '?'}</b></div><div><span>执行</span><b>{runExecutionStatus.label}</b></div><div><span>状态</span><b>{runLifecycleStatus.label}</b></div></div>
          </section>

          <div className="run-controls" aria-label="运行操作">
            <span className="run-controls-label">运行操作</span>
            {['queued', 'running'].includes(activeRun.status) && <button type="button" className="outline-button" onClick={() => void onControlRun('pause')}><Pause size={16} />暂停</button>}
            {activeRun.status === 'paused' && <button type="button" className="command-button" onClick={() => void onControlRun('resume')}><Play size={16} />继续</button>}
            {['partial', 'failed'].includes(activeRun.status) && <button type="button" className="command-button" onClick={() => void onControlRun('retry')}><RefreshCw size={16} />重试失败项</button>}
            {canCancelActiveRun && <button type="button" className="danger-button" onClick={() => void onControlRun('cancel')}><X size={16} />取消运行</button>}
            <button type="button" className="run-advanced-button" aria-expanded={Boolean(advancedDetails)} onClick={onToggleAdvanced}><Ellipsis size={16} />{advancedDetails ? '收起技术详情' : '技术详情'}</button>
          </div>

          <section className="run-items-section">
            <header className="run-items-heading"><div><p className="eyebrow">生成结果</p><h3>结果队列</h3></div><span>{bounds.start ? bounds.start + '-' + bounds.end : '0'} / {runItemPage.total} 项{runItemPage.allTotal !== runItemPage.total ? ' · 总 ' + runItemPage.allTotal : ''}</span></header>
            <RunItemProgressBar page={runItemPage} />
            <div className="run-item-toolbar">
              <div className="run-item-filters" aria-label="运行项状态筛选">{RUN_ITEM_FILTER_OPTIONS.map((option) => <button type="button" key={option.id} className={normalizedFilter === option.id ? 'is-active' : ''} onClick={() => onSetRunItemFilter(option.id)}>{option.label}<small>{runItemFilterCount(runItemPage.statusCounts, option.id)}</small></button>)}</div>
              <label className="run-item-sequence"><Search size={14} /><span>序号</span><input type="number" min="1" inputMode="numeric" value={normalizedSequence || ''} onChange={(event) => onSetRunItemSequence(event.target.value)} placeholder="任意" />{normalizedSequence !== null && <button type="button" aria-label="清除序号筛选" onClick={() => onSetRunItemSequence(null)}><X size={13} /></button>}</label>
              <label className="run-item-page-size"><span>每页</span><select aria-label="每页运行项数量" value={normalizedPageSize} onChange={(event) => onSetRunItemPageSize(event.target.value)}>{RUN_ITEM_PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select></label>
              <div className="run-item-bulk"><button type="button" className="outline-button" disabled={!retryablePageItems.length} onClick={() => onSelectRetryablePageItems(!allRetryableSelected)}><Check size={15} />{allRetryableSelected ? '取消本页' : '选择可重试'}</button><button type="button" className="command-button" disabled={!selectedRetryableIds.length} onClick={() => void onRetrySelectedItems(selectedRetryableIds)}><RefreshCw size={15} />重试已选 {selectedRetryableIds.length || ''}</button></div>
            </div>
            <div className="run-item-list">{visibleRunItems.length ? visibleRunItems.map((item) => <RunItemRow key={item.id} item={item} selected={selectedRunItemIds.has(item.id)} onToggleSelected={onToggleRunItemSelection} onOpenDetail={onOpenRunItemDetail} onInspect={onInspectAsset} onRetry={onRetryItem} />) : <p className="empty-copy">当前筛选没有运行项。</p>}</div>
            <nav className="run-item-pagination" aria-label="运行项分页"><button type="button" className="outline-button" disabled={runItemPage.page <= 1} onClick={() => onSetRunItemPage(runItemPage.page - 1)}><ChevronLeft size={15} />上一页</button><span>第 {runItemPage.page} / {runItemPage.totalPages} 页</span><button type="button" className="outline-button" disabled={runItemPage.page >= runItemPage.totalPages} onClick={() => onSetRunItemPage(runItemPage.page + 1)}>下一页<ChevronRight size={15} /></button></nav>
          </section>

          {advancedDetails && <section className="advanced-details"><div className="advanced-details-head"><div><p className="eyebrow">技术详情</p><h3>计划与预检证据</h3></div><IconButton label="关闭技术详情" onClick={onCloseAdvanced}><X size={15} /></IconButton></div><div className="advanced-evidence"><section><h4>计划版本</h4>{advancedDetails.plans.length ? advancedDetails.plans.map((item) => <p key={item.id || item.planVersion}>v{item.planVersion} · {planStateLabel?.(item.state) || item.state || '未知'}</p>) : <p>没有计划版本记录。</p>}</section><section><h4>预检</h4>{advancedDetails.dryRuns.length ? advancedDetails.dryRuns.map((dryRun) => { const evidence = dryRunEvidence(dryRun); return <p key={dryRun.id}>{evidence.status} · 计划 v{evidence.planVersion || '未知'} · {JSON.stringify(evidence.details)}</p>; }) : <p>没有预检记录。</p>}</section></div></section>}
        </> : <div className="run-detail-empty"><Sparkles size={28} strokeWidth={1.25} /><div><h3>选择一条运行记录</h3><p>选择后会在这里集中显示提示词、执行状态、生成结果和可用操作。</p></div></div>}
      </section>
    </div>
    <RunItemDetailDialog item={runItemDetail} onDismiss={onCloseRunItemDetail} onInspect={onInspectAsset} onRetry={onRetryItem} />
  </section>;
}

class WorkbenchErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) return <main className="fatal-error"><CircleAlert size={24} /><div><h1>无法显示工作台</h1><p>详情内容未能安全显示。刷新后可继续使用 Studio。</p></div><button type="button" className="command-button" onClick={() => window.location.reload()}>刷新</button></main>;
    return this.props.children;
  }
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
      if (current) setAuthorizationError(nextError?.message || '本地 Studio 授权失败。请重试。');
    });
    return () => { current = false; };
  }, [attempt]);

  if (authorized) return <App />;
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
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(EMPTY);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [batchName, setBatchName] = useState('');
  const [selectedDeliveryIds, setSelectedDeliveryIds] = useState(new Set());
  const [creativeRecord, setCreativeRecord] = useState(null);
  const [assetProvenance, setAssetProvenance] = useState(null);
  const [deliveryBusyId, setDeliveryBusyId] = useState(null);
  const [deliveryCompletion, setDeliveryCompletion] = useState(null);
  const [deliveryCreating, setDeliveryCreating] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState(new Set());
  const [selectionAssets, setSelectionAssets] = useState(EMPTY);
  const [selectionBusyIds, setSelectionBusyIds] = useState(new Set());
  const [deliveryName, setDeliveryName] = useState('');
  const [assetFilter, setAssetFilter] = useState('all');
  const [assetPage, setAssetPage] = useState(1);
  const [assetPageSize, setAssetPageSize] = useState(() => normalizeAssetPageSize(window.localStorage.getItem(ASSET_PAGE_SIZE_KEY) || DEFAULT_ASSET_PAGE_SIZE));
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
  const [tasks, setTasks] = useState(EMPTY);
  const [rounds, setRounds] = useState(EMPTY);
  const [runs, setRuns] = useState(EMPTY);
  const [sessionPlanStatus, setSessionPlanStatus] = useState(null);
  const [runItemPage, setRunItemPage] = useState(EMPTY_RUN_ITEM_PAGE);
  const [lineageRunItems, setLineageRunItems] = useState(EMPTY);
  const [lineageRunItemCoverage, setLineageRunItemCoverage] = useState(EMPTY_LINEAGE_RUN_ITEM_COVERAGE);
  const [selectedRunItemIds, setSelectedRunItemIds] = useState(new Set());
  const [runItemDetailId, setRunItemDetailId] = useState(null);
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState(() => parseWorkbenchRoute(window.location.search));
  const [contextError, setContextError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [recoveryPhase, setRecoveryPhase] = useState('ready');
  const [runtimeRepairing, setRuntimeRepairing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [eventRevision, setEventRevision] = useState({ taskOverview: 0, creativeRecord: 0, studioOverview: 0, planVersions: 0, runs: 0, canvasLayout: 0 });
  const inputRef = useRef(null);
  const searchCoordinatorRef = useRef(null);
  const batchBusyRef = useRef(false);
  const batchOperationRef = useRef(null);
  const deliveryInteractionRef = useRef(null);
  const deliveryOperationEpoch = useRef(0);
  const activeProjectIdRef = useRef(null);
  const contextSignature = useRef('');
  const contextWriteQueue = useRef(Promise.resolve());
  const sessionRef = useRef(null);
  const desiredContextRef = useRef(null);
  const restoredSessionContext = useRef(false);
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
  selectionRequests.current ||= createLatestRequestGate();
  sharedAssetRequests.current ||= createLatestRequestGate();
  deliveryInteractionRef.current ||= createDeliveryInteractionGuard();
  searchCoordinatorRef.current ||= createStudioSearchCoordinator({
    request: async (query, signal) => (await api('/api/search?q=' + encodeURIComponent(query) + '&limit=12', { signal })).results || [],
    schedule: (callback, delay) => window.setTimeout(callback, delay),
    cancelSchedule: (timer) => window.clearTimeout(timer)
  });
  useEffect(() => () => { restartMonitorEpoch.current += 1; if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current); }, []);
  const { view, projectId: activeProjectId, taskId: activeTaskId, roundId: activeRoundId, compareRoundIds = EMPTY, runId: activeRunId, assetScope, runItemFilter: activeRunItemFilter = DEFAULT_RUN_ITEM_FILTER, runItemPage: activeRunItemPage = 1, runItemPageSize: activeRunItemPageSize = DEFAULT_RUN_ITEM_PAGE_SIZE, runItemSequence: activeRunItemSequence = null } = route;
  const routeView = rendererForWorkbenchView(view);
  const studioView = isStudioView(view);
  activeProjectIdRef.current = activeProjectId;
  sessionRef.current = session;

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

  const openWorkbenchSession = useCallback(async () => {
    if (session) return session;
    const nextSession = await api('/api/sessions/open', { method: 'POST', idempotencyKey: uniqueKey('session-open'), body: { conversationId: workbenchConversationId(window.sessionStorage) } });
    setSession(nextSession);
    return nextSession;
  }, [session]);

  const refreshStudio = useCallback(async (request) => {
    const signal = request.signal;
    const [studioData, providerData, projectData, taskTypeData, styleKitData, brandKitData, sharedAssetData] = await Promise.all([
      api('/api/studio', { signal }),
      api('/api/providers', { signal }),
      api('/api/projects', { signal }),
      api('/api/task-types', { signal }),
      api('/api/style-kits', { signal }),
      api('/api/brand-kits', { signal }),
      api('/api/shared-assets', { signal })
    ]);
    if (!request.isCurrent()) throw new DOMException('Stale refresh', 'AbortError');
    const nextProjects = projectData.projects || [];
    setStudio(studioData);
    setProvider({ ...(providerData.status || {}), restartRequired: providerData.runtime?.restartRequired === true });
    setProjects(nextProjects);
    setTaskTypes(taskTypeData.taskTypes || []);
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
    const selectedProject = activeProjectId ? (knownProjects || []).find((project) => project.id === activeProjectId) || null : null;
    if (activeProjectId && !selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); setDeliveries(EMPTY); setDeliveryBatches(EMPTY); clearLineageRunData();
      setContextError('该链接所指向的项目已不存在，或不属于当前 Studio。');
      return;
    }
    if (!selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); setDeliveries(EMPTY); setDeliveryBatches(EMPTY); clearLineageRunData();
      setContextError(activeTaskId || activeRoundId || activeRunId ? '请先选择一个项目，再继续查看任务、轮次或运行。' : '');
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
      setRounds(EMPTY); setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError(activeRoundId || activeRunId ? '请先选择一个任务，再继续查看轮次或运行。' : '');
      return;
    }
    const roundData = await load('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/rounds');
    const nextRounds = roundData.rounds || [];
    setRounds(nextRounds);
    const selectedRound = activeRoundId ? nextRounds.find((round) => round.id === activeRoundId) || null : null;
    if (activeRoundId && !selectedRound) {
      setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError('该轮次不属于当前任务，或已不存在。');
      return;
    }
    if (!selectedRound || !['runs', 'lineage'].includes(view)) {
      setRuns(EMPTY); setRunItemPage(EMPTY_RUN_ITEM_PAGE); clearLineageRunData();
      setContextError(activeRunId ? '请先打开生成运行视图，再继续查看运行。' : '');
      return;
    }
    const runData = await load('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/runs');
    const nextRuns = runData.runs || [];
    setRuns(nextRuns);
    const selectedRun = activeRunId ? nextRuns.find((run) => run.id === activeRunId) || null : null;
    if (view === 'lineage') {
      setRunItemPage(EMPTY_RUN_ITEM_PAGE);
      const lineage = await loadCompleteLineageRunItems(nextRuns, load, requireCurrent);
      requireCurrent();
      setLineageRunItems(lineage.items);
      setLineageRunItemCoverage({ loaded: lineage.loaded, total: lineage.total });
      setContextError(activeRunId && !selectedRun ? '该运行不属于当前轮次，或已不存在。' : '');
      return;
    }
    clearLineageRunData();
    if (activeRunId && !selectedRun) {
      setRunItemPage(EMPTY_RUN_ITEM_PAGE);
      setContextError('该运行不属于当前轮次，或已不存在。');
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
    if (!['assets', 'trash', 'deliveries', 'lineage'].includes(view)) {
      assetRequests.current.cancel();
      setAssets(EMPTY);
      setAssetTotal(0);
      return true;
    }
    const pagination = ['assets', 'trash'].includes(view) ? { page: assetPage, pageSize: assetPageSize, filter: assetFilter } : view === 'lineage' ? { page: 1, pageSize: LINEAGE_ASSET_PAGE_SIZE, filter: 'all' } : null;
    const path = assetRefreshPath(route, pagination);
    if (!path) {
      setAssets(EMPTY);
      setAssetTotal(0);
      return true;
    }
    const request = assetRequests.current.begin(path);
    try {
      const data = view === 'lineage' ? await loadCompleteLineageAssets(route, (nextPath) => api(nextPath, { signal: request.signal }), () => { if (!request.isCurrent()) throw new DOMException('Stale refresh', 'AbortError'); }) : await api(path, { signal: request.signal });
      if (!request.isCurrent()) return false;
      const nextAssets = data.assets || EMPTY;
      setAssets(nextAssets);
      setAssetTotal(Number.isInteger(data.total) ? data.total : nextAssets.length);
      return true;
    } catch (nextError) {
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
      if (!isAbortError(nextError) && request.isCurrent()) setError(nextError.message || '无法读取当前选片。');
      return false;
    }
  }, [activeProjectId]);

  const refreshSharedAssets = useCallback(async () => {
    const request = sharedAssetRequests.current.begin('shared-assets');
    try {
      const data = await api('/api/shared-assets', { signal: request.signal });
      if (!request.isCurrent()) return false;
      setSharedAssets(data.assets || EMPTY);
      return true;
    } catch (nextError) {
      if (!isAbortError(nextError) && request.isCurrent()) setError(nextError.message || '无法读取共享素材。');
      return false;
    }
  }, []);

  const reportRefreshError = useCallback((nextError) => {
    if (nextError?.category === 'connection') setConnectionError(nextError.message || '无法连接本地 Studio。');
    else setError(nextError?.message || '无法读取本地 Studio。');
  }, []);
  const { refreshAll, refreshContext: refreshCurrentContext } = useRouteRefresh({
    route,
    beforeRefresh: openWorkbenchSession,
    refreshGlobal: refreshStudio,
    refreshContext,
    onError: reportRefreshError,
    onSettled: () => setLoading(false)
  });
  const refresh = useCallback(async () => {
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
      canvasLayout: current.canvasLayout + (plan.refreshCanvasLayout || plan.canvasLayout ? 1 : 0)
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
  const refreshForEvents = useCallback((events) => eventRefreshQueueRef.current.request(studioEventRefreshPlan(events)), []);
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
    if (restartMonitorEpoch.current === epoch) setError('Studio 重启超时。请复制脱敏诊断并检查本地 daemon 日志。');
  }, [finishStudioRecovery]);
  const beginStudioRestart = useCallback(() => {
    if (recoveryTimerRef.current) window.clearTimeout(recoveryTimerRef.current);
    const epoch = ++restartMonitorEpoch.current;
    updateRecoveryPhase('stopping');
    void monitorStudioRestart(epoch, studio?.runtime?.startedAt || null);
  }, [monitorStudioRestart, studio?.runtime?.startedAt, updateRecoveryPhase]);
  const handleConnectionError = useCallback((message) => {
    setConnectionError(message);
    if (message) updateRecoveryPhase('reconnecting');
  }, [updateRecoveryPhase]);
  const handleReconnected = useCallback(async () => { await finishStudioRecovery(); }, [finishStudioRecovery]);
  useStudioEvents({
    studioId: studio?.studioId || null,
    onEventBatch: refreshForEvents,
    onSnapshot: refreshSnapshot,
    onConnectionError: handleConnectionError,
    onReconnected: handleReconnected,
    onRequestError: setError
  });

  const copyRuntimeDiagnostic = async () => {
    try {
      const diagnostic = redactedRuntimeDiagnostic({ studio, provider, recoveryPhase, connectionError });
      if (!navigator.clipboard?.writeText) throw new Error('当前浏览器未提供剪贴板权限。');
      await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
      setNotice('已复制脱敏运行诊断；内容不含 Provider 密钥或工作区路径。');
    } catch (nextError) { setError(nextError.message || '无法复制脱敏诊断。'); }
  };
  const repairRuntime = async () => {
    if (runtimeRepairing) return;
    setRuntimeRepairing(true);
    try {
      await api('/api/restart', { method: 'POST', idempotencyKey: uniqueKey('runtime-repair'), body: {} });
      beginStudioRestart();
    } catch (nextError) { setError(nextError.message || '无法安全重启 Studio。'); }
    finally { setRuntimeRepairing(false); }
  };
  useEffect(() => {
    if (!session) { setSessionPlanStatus(null); return undefined; }
    const controller = new AbortController();
     void api('/api/sessions/' + encodeURIComponent(session.id) + '/plan-status', { signal: controller.signal }).then(setSessionPlanStatus).catch((nextError) => {
       if (!isAbortError(nextError)) setError(nextError.message || '无法读取当前会话计划状态。');
     });
     return () => controller.abort();
   }, [session?.id, eventRevision.planVersions, eventRevision.creativeRecord, eventRevision.runs]);

  const selectedProject = useMemo(() => activeProjectId ? projects.find((project) => project.id === activeProjectId) || null : null, [projects, activeProjectId]);
  const selectedTask = useMemo(() => activeTaskId ? tasks.find((task) => task.id === activeTaskId) || null : null, [tasks, activeTaskId]);
  const selectedRound = useMemo(() => activeRoundId ? rounds.find((round) => round.id === activeRoundId) || null : null, [rounds, activeRoundId]);
  const activeRun = useMemo(() => activeRunId ? runs.find((run) => run.id === activeRunId) || null : null, [runs, activeRunId]);
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
  const visibleAssets = view === 'trash' ? assets.filter((asset) => asset.deletedAt) : assets.filter((asset) => !asset.deletedAt);
  const selectedAssets = selectionAssets.filter((asset) => !asset.deletedAt);
  const totalAssetPages = assetPageCount(assetTotal, assetPageSize);
  const allPageAssetsSelected = visibleAssets.length > 0 && visibleAssets.every((asset) => selectedAssetIds.has(asset.id));
  const pageSelectionBusy = visibleAssets.some((asset) => selectionBusyIds.has(asset.id));
  const sharedAssetIds = useMemo(() => new Set(sharedAssets.map((asset) => asset.id)), [sharedAssets]);
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const selectionAssetById = useMemo(() => new Map(selectionAssets.map((asset) => [asset.id, asset])), [selectionAssets]);
  const deliveryFlowAssets = deliveryCompletion ? deliveryCompletion.assetIds.map((assetId) => assetById.get(assetId) || selectionAssetById.get(assetId) || { id: assetId, display: { label: '已冻结交付图片' } }) : selectedAssets;
  const selectedTaskStatus = taskPresentation(selectedTask, rounds);
  const visibleRunItems = runItemPage.items;
  const lineageVisibleRunItems = view === 'lineage' ? lineageRunItems : visibleRunItems;
  const runExecutionStatus = runExecutionPresentationFromCounts(activeRun, runItemPage.statusCounts);
  const runItemDetail = useMemo(() => runItemDetailId ? visibleRunItems.find((item) => item.id === runItemDetailId) || null : null, [runItemDetailId, visibleRunItems]);
  const runLifecycleStatus = activeRun ? statusPresentation('run', activeRun.status) : null;
  const canCancelActiveRun = Boolean(activeRun && !['completed', 'cancelled'].includes(activeRun.status));
  const uploadTarget = assetScope === 'round' && selectedRound ? { type: 'creative_round', id: selectedRound.id } : assetScope === 'task' && selectedTask ? { type: 'creative_task', id: selectedTask.id } : selectedProject ? { type: 'project', id: selectedProject.id } : null;
  const canImport = ['assets', 'lineage'].includes(view) && Boolean(selectedProject);
  const importLabel = selectedRound && assetScope === 'round' ? '添加为本轮参考' : '导入到项目';
  const deliverySelection = useMemo(() => projectDeliverySelection(selectedProject?.id || null, selectedAssets), [selectedProject?.id, selectedAssets]);
  const selectedDeliveryAssets = deliverySelection.eligibleAssets;
  const eligibleDeliveryIds = useMemo(() => new Set(deliveries.filter((delivery) => ['ready', 'exported'].includes(delivery.status)).map((delivery) => delivery.id)), [deliveries]);

  useEffect(() => {
    setAssetPage(1);
  }, [view, activeProjectId, activeTaskId, activeRoundId, assetScope]);
  useEffect(() => {
    const nextPage = clampAssetPage(assetPage, assetTotal, assetPageSize);
    if (nextPage !== assetPage) setAssetPage(nextPage);
  }, [assetPage, assetTotal, assetPageSize]);
  useEffect(() => {
    window.localStorage.setItem(ASSET_PAGE_SIZE_KEY, String(assetPageSize));
  }, [assetPageSize]);
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
      if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取任务创作概览。');
    });
    return () => request.abort();
  }, [selectedTask?.id, eventRevision.taskOverview]);
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
      if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取轮次创作记录。');
    });
    return () => request.abort();
  }, [selectedRound?.id, activeRunId, eventRevision.creativeRecord]);
  useEffect(() => {
    if (view !== 'studio-overview' || !selectedTask) { studioOverviewRequests.current.cancel(); setStudioOverview(null); return undefined; }
    const signature = [view, selectedTask.id, compareRoundIds.join('|'), eventRevision.studioOverview].join(':');
    const request = studioOverviewRequests.current.begin(signature);
    const params = new URLSearchParams();
    for (const roundId of compareRoundIds) params.append('round', roundId);
    void api('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/studio-overview?' + params.toString(), { signal: request.signal }).then((data) => {
      if (request.isCurrent()) setStudioOverview(data.overview || null);
    }).catch((nextError) => {
      if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取任务轮次比较。');
    });
    return () => request.abort();
  }, [view, selectedTask?.id, compareRoundIds.join('|'), eventRevision.studioOverview]);

  useEffect(() => {
    if (assetProvenance && !assets.some((asset) => asset.id === assetProvenance.asset?.id)) setAssetProvenance(null);
  }, [assets, assetProvenance]);
  useEffect(() => {
    if (!session || restoredSessionContext.current || route.projectId || studioView) return;
    restoredSessionContext.current = true;
    if (session.activeProjectId) navigateRoute({ view: 'project-overview', projectId: session.activeProjectId, taskId: session.activeTaskId, roundId: session.activeRoundId, runId: null }, true);
  }, [session, route.projectId, studioView, navigateRoute]);

  useEffect(() => {
    if (!session || !selectedProject || (activeTaskId && !selectedTask) || (activeRoundId && !selectedRound)) return;
    const desired = { signature: [selectedProject.id, selectedTask?.id || '', selectedRound?.id || ''].join(':'), projectId: selectedProject.id, taskId: selectedTask?.id || null, roundId: selectedRound?.id || null };
    if (desired.signature === contextSignature.current) return;
    contextSignature.current = desired.signature;
    desiredContextRef.current = desired;
    contextWriteQueue.current = contextWriteQueue.current.catch(() => undefined).then(async () => {
      const current = sessionRef.current;
      const target = desiredContextRef.current;
      if (!current || !target || target.signature !== contextSignature.current) return;
      try {
        const next = await api('/api/sessions/' + encodeURIComponent(current.id) + '/context', { method: 'POST', idempotencyKey: uniqueKey('session-context'), body: { projectId: target.projectId, taskId: target.taskId, roundId: target.roundId, expectedVersion: current.version } });
        sessionRef.current = next;
        setSession(next);
      } catch (nextError) {
        contextSignature.current = '';
        setError(nextError.message || '无法保存工作上下文。');
      }
    });
  }, [session, selectedProject, selectedTask, selectedRound, activeTaskId, activeRoundId]);

  const upload = async (files) => {
    const images = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    const failed = [];
    try {
      setUploading(true); setUploadProgress({ completed: 0, total: images.length }); setError(''); setNotice('');
      await mapWithConcurrency(images, async (file, index) => {
        try {
          const response = await fetch('/api/assets/import', {
            method: 'POST',
            headers: {
              'content-type': file.type || 'application/octet-stream',
              'idempotency-key': uniqueKey('upload'),
              'x-daoge-filename': encodeURIComponent(file.name),
              ...(uploadTarget ? { 'x-daoge-target-type': uploadTarget.type, 'x-daoge-target-id': uploadTarget.id } : {})
            },
            body: file
          });
          const payload = await response.json();
          if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || '无法导入图片。');
        } catch (nextError) {
          failed.push({ name: file.name, message: nextError.message || '无法导入图片。' });
        }
        setUploadProgress((current) => ({ completed: Math.min(images.length, (current?.completed || 0) + 1), total: images.length }));
      }, ASSET_IMPORT_CONCURRENCY);
      await refresh();
      const succeeded = images.length - failed.length;
      if (succeeded) setNotice('已导入 ' + succeeded + ' 张图片' + (failed.length ? '，' + failed.length + ' 张失败。' : '。'));
      if (failed.length) setError('有 ' + failed.length + ' 张图片导入失败：' + failed.slice(0, 3).map((item) => item.name).join('、') + (failed.length > 3 ? ' 等' : '') + '。');
    } finally {
      setUploading(false); setUploadProgress(null); if (inputRef.current) inputRef.current.value = '';
    }
  };

  const review = async (assetId, decision, feedback = {}) => {
    try {
      await api('/api/assets/' + encodeURIComponent(assetId) + '/review', { method: 'POST', idempotencyKey: uniqueKey('review'), body: { decision, taskId: selectedTask?.id, roundId: selectedRound?.id, feedback } });
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法保存选择。'); }
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
    } catch (nextError) { setError(nextError.message || '无法移入回收站。'); }
  };
  const restore = async (assetId) => { try { await api('/api/assets/' + encodeURIComponent(assetId) + '/restore', { method: 'POST', idempotencyKey: uniqueKey('restore'), body: {} }); await refresh(); } catch (nextError) { setError(nextError.message || '无法恢复资产。'); } };
  const applyProjectSelection = (selection) => {
    const nextAssets = selection?.assets || EMPTY;
    const ids = new Set(nextAssets.map((asset) => asset.id));
    selectedAssetIdsRef.current = ids;
    setSelectedAssetIds(ids);
    setSelectionAssets(nextAssets);
  };
  const markSelectionBusy = (assetIds, busy) => {
    for (const assetId of assetIds) { if (busy) selectionBusyIdsRef.current.add(assetId); else selectionBusyIdsRef.current.delete(assetId); }
    setSelectionBusyIds(new Set(selectionBusyIdsRef.current));
  };
  const enqueueSelectionWrite = (projectId, assetIds, request, fallbackMessage) => {
    const epoch = ++selectionMutationEpoch.current;
    markSelectionBusy(assetIds, true);
    const operation = selectionWriteQueue.current.catch(() => undefined).then(async () => {
      const data = await request();
      if (selectionProjectIdRef.current === projectId && epoch === selectionMutationEpoch.current) applyProjectSelection(data.selection);
    });
    selectionWriteQueue.current = operation.catch(() => undefined);
    void operation.catch(async (nextError) => {
      if (selectionProjectIdRef.current !== projectId || epoch !== selectionMutationEpoch.current) return;
      setError(nextError.message || fallbackMessage);
      await refresh();
    }).finally(() => { if (selectionProjectIdRef.current === projectId) markSelectionBusy(assetIds, false); });
  };
  const setAssetSelection = (assetId, selected) => {
    if (!selectedProject || selectionBusyIdsRef.current.has(assetId)) return;
    const nextIds = new Set(selectedAssetIdsRef.current);
    if (selected) nextIds.add(assetId); else nextIds.delete(assetId);
    selectedAssetIdsRef.current = nextIds;
    setSelectedAssetIds(new Set(nextIds));
    setSelectionAssets((current) => selected ? (current.some((asset) => asset.id === assetId) ? current : [...current, assetById.get(assetId)].filter(Boolean)) : current.filter((asset) => asset.id !== assetId));
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, [assetId], () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/assets/' + encodeURIComponent(assetId), { method: 'POST', idempotencyKey: uniqueKey('asset-selection'), body: { selected } }), '无法保存当前选片。');
  };
  const toggleSelection = (assetId) => setAssetSelection(assetId, !selectedAssetIdsRef.current.has(assetId));
  const markAsDeliverable = async (asset) => {
    if (!selectedProject) return;
    if (selectedAssetIdsRef.current.has(asset.id)) { toggleSelection(asset.id); return; }
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, [asset.id], async () => {
      if (asset.review?.decision !== 'keep') await api('/api/assets/' + encodeURIComponent(asset.id) + '/review', { method: 'POST', idempotencyKey: uniqueKey('delivery-keep'), body: { decision: 'keep' } });
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
      for (let offset = 0; offset < selected.length; offset += 500) {
        const data = await api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('asset-selection-clear'), body: { assetIds: selected.slice(offset, offset + 500).map((asset) => asset.id), selected: false } });
        latest = data.selection || latest;
      }
      return { selection: latest };
    }, '无法清空当前选片。');
  };
  const setPageSelection = (selected) => {
    if (!selectedProject || !visibleAssets.length || pageSelectionBusy) return;
    const candidates = visibleAssets.filter((asset) => selectedAssetIdsRef.current.has(asset.id) !== selected);
    if (!candidates.length) return;
    const projectId = selectedProject.id;
    const candidateIds = candidates.map((asset) => asset.id);
    enqueueSelectionWrite(projectId, candidateIds, () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('page-selection'), body: { assetIds: candidateIds, selected, keepAssetIds: selected ? candidates.filter((asset) => asset.review?.decision !== 'keep').map((asset) => asset.id) : [] } }), '无法更新本页选片。');
  };
  const setAssetsSelection = (assetIds, selected) => {
    if (!selectedProject || !assetIds.length) return;
    const uniqueIds = [...new Set(assetIds)].filter(Boolean);
    const nextIds = new Set(selectedAssetIdsRef.current);
    for (const assetId of uniqueIds) { if (selected) nextIds.add(assetId); else nextIds.delete(assetId); }
    selectedAssetIdsRef.current = nextIds;
    setSelectedAssetIds(new Set(nextIds));
    setSelectionAssets((current) => selected ? [...current, ...uniqueIds.map((assetId) => assetById.get(assetId)).filter((asset) => asset && !current.some((item) => item.id === asset.id))] : current.filter((asset) => !uniqueIds.includes(asset.id)));
    const projectId = selectedProject.id;
    enqueueSelectionWrite(projectId, uniqueIds, () => api('/api/projects/' + encodeURIComponent(projectId) + '/selection/batch', { method: 'POST', idempotencyKey: uniqueKey('canvas-selection'), body: { assetIds: uniqueIds, selected, keepAssetIds: selected ? uniqueIds.filter((assetId) => assetById.get(assetId)?.review?.decision !== 'keep') : [] } }), '无法更新创作谱系选片。');
  };
  const batchReview = async (assetIds, decision) => {
    try {
      const uniqueIds = [...new Set(assetIds)].filter(Boolean);
      for (const assetId of uniqueIds) await api('/api/assets/' + encodeURIComponent(assetId) + '/review', { method: 'POST', idempotencyKey: uniqueKey('canvas-review'), body: { decision, taskId: selectedTask?.id, roundId: selectedRound?.id, feedback: {} } });
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法批量保存评审。'); }
  };
  const inspectAsset = async (assetId) => {
    try { const data = await api('/api/assets/' + encodeURIComponent(assetId) + '/provenance'); setAssetProvenance(data.provenance || null); } catch (nextError) { setError(nextError.message || '无法读取素材来源与评审记录。'); }
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
    } catch (nextError) { setError(nextError.message || '无法更新跨项目共享素材。'); }
  };
  const copyAsset = async (asset) => {
    const fileUrl = asset.fileUrl || assetOriginalUrl(asset);
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error('图片暂时无法读取。');
      const image = await response.blob();
      if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([new ClipboardItem({ [image.type]: image })]);
        setNotice('图片已复制，可粘贴到支持图片的应用。');
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(new URL(fileUrl, window.location.href).href);
        setNotice('当前浏览器不支持直接复制图片，已复制图片链接。');
        return;
      }
      throw new Error('当前浏览器未提供剪贴板权限。');
    } catch (nextError) { setError(nextError.message || '无法复制图片，请使用下载原图。'); }
  };
  const completeDelivery = async () => {
    if (!selectedProject) { setError('请先打开一个项目。'); return; }
    if (!deliveryInteractionRef.current.begin()) return;
    let intent = deliveryCompletion;
    if (intent?.phase === 'complete') {
      window.localStorage.removeItem(DELIVERY_COMPLETION_PREFIX + intent.projectId);
      setDeliveryCompletion(null);
      setDeliveryName('');
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
      const result = await api('/api/deliveries/complete', { method: 'POST', idempotencyKey: intent.operationId, body: { projectId, name: intent.name, assetIds: intent.assetIds, phase: intent.phase } });
      const nextIntent = result.nextAction ? { ...intent, deliveryId: result.delivery.id, phase: result.nextAction, stage: result.stage } : { ...intent, deliveryId: result.delivery.id, phase: 'complete', stage: 'exported' };
      window.localStorage.setItem(DELIVERY_COMPLETION_PREFIX + projectId, JSON.stringify(nextIntent));
      if (isDeliveryOperationCurrent({ activeProjectId: activeProjectIdRef.current, projectId, currentEpoch: deliveryOperationEpoch.current, operationEpoch })) {
        setDeliveryCompletion(nextIntent);
        setNotice(result.nextAction ? result.stage === 'draft' ? '交付草稿已唯一创建。下一步准备交付。' : '交付已准备完成。下一步导出实体文件。' : '实体文件已导出。检查后完成本次交付。');
        await refresh();
      }
    } catch (nextError) {
      if (isDeliveryOperationCurrent({ activeProjectId: activeProjectIdRef.current, projectId, currentEpoch: deliveryOperationEpoch.current, operationEpoch })) setError(nextError.message || '无法继续交付；当前阶段已保留，可重试。');
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
    } catch (nextError) { setError(nextError.message || '无法更新交付状态。'); } finally { setDeliveryBusyId(null); }
  };
  const toggleComparedRound = (roundId) => {
    const next = compareRoundIds.includes(roundId) ? compareRoundIds.filter((id) => id !== roundId) : [...compareRoundIds, roundId].slice(0, 12);
    navigateRoute({ view: 'studio-overview', roundId: next[0] || null, compareRoundIds: next, runId: null, assetScope: 'task' });
  };
  useEffect(() => {
    searchCoordinatorRef.current.search(searchQuery, (state) => {
      setSearchResults(state.results);
      setSearchError(state.error);
      setSearchLoading(state.loading);
    });
    return () => searchCoordinatorRef.current.cancel();
  }, [searchQuery]);
  useEffect(() => () => searchCoordinatorRef.current.dispose(), []);
  const openSearchResult = (result) => {
    const changes = result.entityType === 'project' ? { view: 'assets', projectId: result.projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' } : { view: 'studio-overview', projectId: result.projectId, taskId: result.taskId, roundId: result.entityType === 'round' ? result.entityId : null, compareRoundIds: result.entityType === 'round' ? [result.entityId] : [], runId: null, assetScope: 'task' };
    setSearchResults(EMPTY); setSearchQuery(''); navigateRoute(changes);
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
      setError(nextError.message || '无法更新交付批次。');
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
    setSelectedRunItemIds((current) => { const next = new Set(current); for (const itemId of pageIds) selected ? next.add(itemId) : next.delete(itemId); return next; });
  };
  const retryRunItemsByIds = async (itemIds) => {
    if (!activeRun) return;
    const retryIds = [...new Set(itemIds)].filter(Boolean);
    if (!retryIds.length) return;
    try {
      await api('/api/runs/' + encodeURIComponent(activeRun.id) + '/retry', { method: 'POST', idempotencyKey: uniqueKey('retry-run-item'), body: { itemIds: retryIds } });
      setSelectedRunItemIds(new Set());
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法重试生成项。'); }
  };
  const retryRunItem = async (itemId) => retryRunItemsByIds([itemId]);
  const controlRun = async (action, runId = activeRun?.id) => {
    const targetRunId = runId || activeRun?.id;
    if (!targetRunId) return;
    if (action === 'resume') {
      setError('恢复运行需要在当前智能体会话中重新确认。');
      return;
    }
    const path = action === 'pause' ? '/pause' : action === 'cancel' ? '/cancel' : '/retry';
    try {
      await api('/api/runs/' + encodeURIComponent(targetRunId) + path, { method: 'POST', idempotencyKey: uniqueKey('run-' + action), body: {} });
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法更新生成运行。'); }
  };
  const copyRunPrompt = async (prompt) => {
    try {
      if (!prompt || !navigator.clipboard?.writeText) throw new Error('当前浏览器未提供剪贴板权限。');
      await navigator.clipboard.writeText(prompt);
      setNotice('已复制本次运行的提示词。');
    } catch (nextError) { setError(nextError.message || '无法复制本次提示词。'); }
  };
  const openGenerationConfirmation = async () => {
    if (!selectedRound || selectedRound.status !== 'awaiting_confirmation') return;
    setGenerationConfirmationBusy(true);
    setGenerationConfirmationError('');
    try {
      let status = sessionPlanStatus;
      if (!status?.pendingConfirmation || status.context?.round?.id !== selectedRound.id) {
        if (!session) throw new Error('当前 Workbench 尚未建立只读会话状态。');
        status = await api('/api/sessions/' + encodeURIComponent(session.id) + '/plan-status');
        setSessionPlanStatus(status);
      }
      if (!status.pendingConfirmation) throw new Error('请先由当前智能体会话发起确认挑战。');
      setGenerationConfirmation({ challenge: status.pendingConfirmation, round: selectedRound });
    } catch (nextError) {
      setError(nextError.message || '无法读取本次生成确认挑战。');
    } finally {
      setGenerationConfirmationBusy(false);
    }
  };
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
      setNotice('计划已由当前用户确认。请返回当前智能体会话，由会话执行预检并创建运行。');
      await refresh();
      return true;
    } catch (nextError) {
      setGenerationConfirmationError(nextError.message || '确认计划失败。');
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
      setConfirmationError(nextError.message || (confirmation.kind === 'trash' ? '无法移入回收站。' : '无法归档项目。'));
    } finally { setConfirmationBusy(false); }
  };
  const openProviderDetails = () => { setProviderDetails({ open: true }); };
  const openAdvancedDetails = async () => {
    if (!selectedRound) return;
    const request = advancedDetailRequests.current.begin([selectedRound.id, activeRunId || ''].join(':'));
    try {
      const [plans, dryRuns] = await Promise.all([api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/plan-versions', { signal: request.signal }), api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/dry-runs', { signal: request.signal })]);
      if (request.isCurrent()) setAdvancedDetails(normalizeAdvancedDetails({ plans: plans.planVersions, dryRuns: dryRuns.dryRuns }));
    } catch (nextError) { if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取高级详情。'); }
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
    } catch (nextError) { if (request.isCurrent() && !isAbortError(nextError)) setError(nextError.message || '无法读取计划版本。'); } finally { if (request.isCurrent()) setPlanVersionsLoading(false); }
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
    <div className="asset-stage-head">
      <div><span className="asset-count">{assetTotal.toString().padStart(2, '0')}</span><span className="asset-count-label">{routeView === 'trash' ? '回收站图片' : '张图片'}</span></div>
      <div className="asset-stage-tools">
        {routeView === 'assets' && <div className="asset-scope-control" aria-label="资产范围">{ASSET_SCOPES.filter((scope) => scope !== 'studio').map((scope) => <button type="button" key={scope} className={assetScope === scope ? 'is-active' : ''} disabled={(scope === 'round' && !selectedRound) || (scope === 'task' && !selectedTask) || (scope === 'project' && !selectedProject)} onClick={() => navigateRoute({ assetScope: scope })}>{ASSET_SCOPE_LABELS[scope]}</button>)}</div>}
        <div className="asset-filter" aria-label="素材筛选"><SlidersHorizontal size={14} />{[['all', '全部'], ['generated', '生成'], ['import', '导入']].map(([value, label]) => <button type="button" key={value} className={assetFilter === value ? 'is-active' : ''} onClick={() => { setAssetFilter(value); setAssetPage(1); }}>{label}</button>)}</div>
        {routeView === 'assets' && visibleAssets.length > 0 && <button type="button" className="outline-button asset-select-page" disabled={pageSelectionBusy} onClick={() => void setPageSelection(!allPageAssetsSelected)}><Check size={15} />{allPageAssetsSelected ? '取消全选本页' : '全选本页'}</button>}
        <details className="asset-view-options"><summary><SlidersHorizontal size={14} />显示</summary><label className="asset-page-size"><span>每页</span><select aria-label="每页资产数量" value={assetPageSize} onChange={(event) => { setAssetPageSize(normalizeAssetPageSize(event.target.value)); setAssetPage(1); }}>{ASSET_PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select><span>张</span></label></details>
        {routeView === 'assets' && selectedProject && <button type="button" className="outline-button asset-trash-link" onClick={() => navigateRoute({ view: 'trash', taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' })}><Trash2 size={15} />回收站</button>}
        {routeView === 'trash' && selectedProject && <button type="button" className="outline-button" onClick={() => navigateRoute({ view: 'assets', assetScope: 'project' })}><ImagePlus size={15} />返回素材</button>}
        {selectedAssets.length === 2 && <IconButton label="对比两张已选素材" onClick={() => { setPreviewZoom(1); setPreviewAssets(selectedAssets); }}><Eye size={16} /></IconButton>}
        <div className="asset-hint">{routeView === 'trash' ? '当前项目回收站' : selectedAssetIds.size ? selectedAssetIds.size + ' 张已选择' : ASSET_SCOPE_LABELS[assetScope] + '资产'}</div>
      </div>
    </div>
    {routeView === 'assets' && selectedProject && selectedAssets.length > 0 && <AssetSelectionStrip assets={selectedAssets} onRemove={toggleSelection} onClear={() => void clearSelection()} onDownloadArchive={() => downloadProjectArchive(selectedAssets.map((asset) => asset.id))} onDeliver={() => navigateRoute({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {visibleAssets.length ? <><div className="asset-grid">{visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selectedAssetIds.has(asset.id)} selectionBusy={selectionBusyIds.has(asset.id)} shared={sharedAssetIds.has(asset.id)} onToggleSelect={markAsDeliverable} onReview={review} onTrash={trash} onRestore={restore} onInspect={inspectAsset} onDownload={downloadAsset} onCopy={copyAsset} onSetShared={setAssetShared} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />)}</div><nav className="asset-pagination" aria-label="资产分页"><button type="button" className="outline-button" disabled={assetPage <= 1} onClick={() => setAssetPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} />上一页</button><span>第 <b>{assetPage}</b> / {totalAssetPages} 页 · 共 {assetTotal} 张</span><button type="button" className="outline-button" disabled={assetPage >= totalAssetPages} onClick={() => setAssetPage((current) => Math.min(totalAssetPages, current + 1))}>下一页<ChevronRight size={15} /></button></nav></> : <div className="empty-stage asset-empty">{routeView === 'trash' ? <Archive size={30} strokeWidth={1.15} /> : <Inbox size={30} strokeWidth={1.15} />}<p>{routeView === 'trash' ? '当前项目回收站为空' : (assetScope === 'round' && !selectedRound ? '请先从任务上下文选择轮次，再查看本轮结果。' : '当前范围内暂未找到资产。')}</p>{routeView === 'assets' && <button type="button" className="outline-button" onClick={() => inputRef.current?.click()}><Upload size={16} />导入图片</button>}</div>}
  </section>;
  const viewRenderers = {
    projects: () => <ProjectIndex projects={projects} onOpenProject={(projectId) => navigateRoute(selectProject(route, projectId))} />,
    'project-overview': () => selectedProject ? <ProjectOverview project={selectedProject} tasks={tasks} selectedCount={selectedAssets.length} onOpenTasks={() => navigateRoute({ view: 'tasks', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenAssets={() => navigateRoute({ view: 'assets', assetScope: 'project', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenDeliveries={() => navigateRoute({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenTask={(taskId) => navigateRoute(selectTask(route, taskId))} /> : null,
    lineage: () => selectedProject ? <CreativeLineageCanvas
      request={api}
      project={selectedProject}
      tasks={tasks}
      selectedTask={selectedTask}
      rounds={rounds}
      selectedRound={selectedRound}
      runs={runs}
      activeRun={activeRun}
      runItems={lineageVisibleRunItems}
      runItemCoverage={lineageRunItemCoverage}
      assets={visibleAssets}
      assetTotal={assetTotal}
      sharedAssets={sharedAssets}
      selectedAssetIds={selectedAssetIds}
      selectionBusyIds={selectionBusyIds}
      deliveries={deliveries}
      taskTypes={taskTypes}
      styleKits={styleKits}
      brandKits={brandKits}
      layoutRevision={eventRevision.canvasLayout}
      onNavigate={navigateRoute}
      onPreviewAsset={(asset) => { setPreviewZoom(1); setPreviewAssets([asset]); }}
      onInspectAsset={inspectAsset}
      onToggleAsset={markAsDeliverable}
      onBatchSelectAssets={setAssetsSelection}
      onReviewAsset={review}
      onBatchReviewAssets={batchReview}
      onSetAssetShared={setAssetShared}
      onDownloadAsset={downloadAsset}
      onCopyAsset={copyAsset}
      onRetryRunItem={retryRunItem}
      onControlRun={controlRun}
      onOpenProvider={openProviderDetails}
    /> : null,
    tasks: () => selectedProject ? <ProjectTaskList project={selectedProject} tasks={tasks} onOpenTask={(taskId) => navigateRoute(selectTask(route, taskId))} /> : null,
    'studio-overview': () => <section className="overview-stage">
      <div className="overview-head"><div><p className="eyebrow">同一任务内的显式对比</p><h2>{selectedTask ? selectedTask.name : '请选择任务'}</h2><span>{studioOverview?.availableRounds?.length || 0} 个可比较轮次。比较不会推断或启动运行。</span></div>{taskOverview && <div className="overview-metrics"><span>轮次 {taskOverview.summary?.roundCount || 0}</span><span>运行 {taskOverview.summary?.runCount || 0}</span><span>结果 {taskOverview.summary?.resultCount || 0}</span></div>}</div>
      {selectedTask ? <><div className="compare-selector">{(studioOverview?.availableRounds || rounds).map((round) => <label key={round.id}><input type="checkbox" checked={compareRoundIds.includes(round.id)} onChange={() => toggleComparedRound(round.id)} /><span>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[round.purpose] || round.purpose} · 计划 v{round.planVersion}</span></label>)}</div>{studioOverview?.comparisons?.length ? <div className="comparison-grid">{studioOverview.comparisons.map((comparison) => <article key={comparison.round.id} className="comparison-column"><header><div><p>轮次 {comparison.round.planVersion}</p><h3>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[comparison.round.purpose] || comparison.round.purpose}</h3></div><StatusPill value={comparison.round.status} scope="round" /></header><dl><div><dt>上游</dt><dd>{comparison.lineage?.rounds?.length ? '承接 ' + comparison.lineage.rounds.length + ' 个轮次' : '首个方向'}</dd></div><div><dt>计划</dt><dd>{comparison.round.plan?.operation === 'edit' ? '编辑' : '生成'} · {comparison.round.plan?.itemCount || 0} 项</dd></div><div><dt>产出</dt><dd>{comparison.summary?.resultCount || 0} 个结果</dd></div></dl>{comparison.runsTruncated && <p className="comparison-truncated">仅显示最近 24 次运行</p>}<div className="comparison-runs">{comparison.runs?.map((run) => <section key={run.id}><button type="button" className="trace-link" onClick={() => navigateRoute({ view: 'runs', projectId: selectedProject?.id, taskId: selectedTask.id, roundId: comparison.round.id, compareRoundIds: [comparison.round.id], runId: run.id })}><b>运行项 {run.items?.length || 0}</b><StatusPill value={run.status} scope="run" /></button><div className="comparison-assets">{run.items?.flatMap((item) => item.outputAssets || []).map((asset) => <button type="button" key={asset.id} title="查看资产来源与评审" onClick={() => void inspectAsset(asset.id)}><img src={assetThumbnailUrl(asset)} alt="轮次结果" loading="lazy" decoding="async" /><span>{asset.review?.decision === 'keep' ? '保留' : asset.review?.decision === 'review' ? '待复核' : '未评审'}</span></button>)}</div></section>)}</div></article>)}</div> : <div className="empty-stage"><Columns3 size={30} strokeWidth={1.15} /><p>勾选一个或多个轮次后，比较计划、运行、结果和当前评审。</p></div>}</> : <div className="empty-stage"><Columns3 size={30} strokeWidth={1.15} /><p>请先选择项目和任务，再打开创作总览。</p></div>}
    </section>,
    prompts: () => <><PromptWorkspace round={selectedRound} planVersions={planVersions} loading={planVersionsLoading} onRefresh={() => void refreshPlanVersions()} />{selectedRound?.status === 'awaiting_confirmation' && <section className="human-confirmation-gate"><div><p className="eyebrow">人工确认闸门 · 可写操作</p><h3>等待当前用户确认计划</h3><span>这是独立于只读摘要的写入闸门。Skill 只能创建挑战；此 Workbench 标签只负责激活计划，确认后由当前智能体会话执行预检并创建唯一运行。</span></div><button type="button" className="command-button" onClick={() => void openGenerationConfirmation()} disabled={!session || generationConfirmationBusy}><LockKeyhole size={16} />{generationConfirmationBusy ? '正在准备确认' : '审阅并确认计划'}</button></section>}</>,
    runs: () => <GenerationHistory selectedRound={selectedRound} runs={runs} activeRunId={activeRunId} activeRun={activeRun} runExecutionStatus={runExecutionStatus} runLifecycleStatus={runLifecycleStatus} taskOverview={taskOverview} creativeRecord={creativeRecord} visibleRunItems={visibleRunItems} runItemPage={runItemPage} runItemFilter={activeRunItemFilter} runItemPageSize={activeRunItemPageSize} runItemSequence={activeRunItemSequence} selectedRunItemIds={selectedRunItemIds} runItemDetail={runItemDetail} canCancelActiveRun={canCancelActiveRun} advancedDetails={advancedDetails} onSelectRun={(runId) => navigateRoute({ runId, runItemFilter: DEFAULT_RUN_ITEM_FILTER, runItemPage: 1, runItemPageSize: DEFAULT_RUN_ITEM_PAGE_SIZE, runItemSequence: null })} onControlRun={controlRun} onRetryItem={retryRunItem} onInspectAsset={inspectAsset} onSetRunItemFilter={setRunItemFilter} onSetRunItemPage={setRunItemPageNumber} onSetRunItemPageSize={setRunItemPageSizeValue} onSetRunItemSequence={setRunItemSequenceValue} onToggleRunItemSelection={toggleRunItemSelection} onSelectRetryablePageItems={selectRetryablePageItems} onRetrySelectedItems={retryRunItemsByIds} onOpenRunItemDetail={(item) => setRunItemDetailId(item.id)} onCloseRunItemDetail={() => setRunItemDetailId(null)} onToggleAdvanced={() => advancedDetails ? setAdvancedDetails(null) : void openAdvancedDetails()} onCloseAdvanced={() => setAdvancedDetails(null)} onCopyPrompt={copyRunPrompt} />,
    guide: () => <LearningCenter onDismiss={dismissGuide} onNavigate={(nextView) => navigateRoute({ view: nextView })} />,
    library: () => <CreativeLibrary taskTypes={taskTypes} styleKits={styleKits} brandKits={brandKits} sharedAssets={sharedAssets} onOpenProjects={() => navigateRoute({ view: 'projects' })} onOpenSharedAssets={() => navigateRoute({ view: 'shared-assets' })} />,
    'shared-assets': () => <SharedAssets assets={sharedAssets} onDownload={downloadAsset} onCopy={copyAsset} onSetShared={setAssetShared} onOpenProjects={() => navigateRoute({ view: 'projects' })} />,
    deliveries: () => <CreatorDelivery project={selectedProject} selection={deliverySelection} deliveryName={deliveryName} deliveryCreating={deliveryCreating} completion={deliveryCompletion} frozen={Boolean(deliveryCompletion || deliveryCreating)} onDeliveryNameChange={setDeliveryName} onCreate={() => void completeDelivery()} onOpenAssets={() => navigateRoute({ view: 'assets', assetScope: 'project', taskId: null, roundId: null, compareRoundIds: [], runId: null })} selectedAssets={deliveryFlowAssets} deliveries={deliveries} assets={assets} deliveryBusyId={deliveryBusyId} onDeliveryAction={deliveryAction} onRemoveSelection={(asset) => toggleSelection(asset.id)} onDownload={downloadAsset} onCopy={copyAsset} onArchiveProject={downloadProjectArchive} onArchiveDelivery={downloadDeliveryArchive} batches={deliveryBatches} batchName={batchName} selectedDeliveryIds={selectedDeliveryIds} batchBusy={batchBusy} onBatchNameChange={setBatchName} onToggleDelivery={toggleBatchDelivery} onBatchAction={batchAction} />,
    assets: () => renderAssetsView(),
    trash: () => renderAssetsView()
  };
  const renderActiveView = viewRenderers[routeView];

  if (loading) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  return <main className={'studio-shell' + (railCollapsed ? ' is-rail-collapsed' : '')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith('image/')); if (files.length && canImport) void upload(files); }} onPaste={(event) => { const files = [...event.clipboardData.files].filter((item) => item.type.startsWith('image/')); if (files.length && canImport) { event.preventDefault(); void upload(files); } }}>
    <aside className="studio-rail" aria-label="Studio 左侧控制栏">
      <div className="rail-brand-row"><div className="brand-mark" aria-label="DAOGE Pic"><span>DAOGE</span><b>Pic</b></div><button type="button" className="rail-collapse-toggle" onClick={() => setRailCollapsed((current) => !current)} title={railCollapsed ? '展开左侧栏' : '折叠左侧栏'} aria-label={railCollapsed ? '展开左侧栏' : '折叠左侧栏'} aria-pressed={railCollapsed}>{railCollapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button></div>
      <WorkbenchNavigation view={view} project={selectedProject} task={selectedTask} round={selectedRound} provider={provider} studio={studio} recoveryPhase={recoveryPhase} repairing={runtimeRepairing} onNavigate={(nextView, changes = {}) => navigateRoute({ view: nextView, ...changes })} onOpenProvider={openProviderDetails} onOpenGuide={() => navigateRoute({ view: 'guide' })} onCopyRuntimeDiagnostic={() => void copyRuntimeDiagnostic()} onRefresh={() => void refresh()} onRepair={() => void repairRuntime()} />
    </aside>

    <section className="work-surface">
      <div className="workspace-chrome">
        <header className="surface-header">
          <div className="heading-group"><p className="eyebrow">{studioView ? 'Studio' : selectedProject ? '项目工作区' : 'Studio'}</p><h1>{view === 'projects' ? '项目' : view === 'project-overview' ? '项目' : view === 'lineage' ? '谱系' : view === 'tasks' ? '任务' : view === 'assets' ? assetScope === 'project' ? '素材' : '结果' : view === 'runs' ? '生成历史' : view === 'studio-overview' ? '轮次对比' : view === 'prompts' ? '当前计划' : view === 'library' ? '资料' : view === 'shared-assets' ? '共享素材' : view === 'guide' ? '创作手册' : view === 'deliveries' ? '交付' : '回收站'}</h1>{studioView ? <span>{view === 'library' ? '任务类型、风格与品牌规则。' : view === 'shared-assets' ? '跨项目复用图片。' : view === 'guide' ? '工作流帮助。' : '选择项目后继续创作。'}</span> : selectedProject ? <span>{selectedProject.name}</span> : null}</div>
          <div className="header-actions">
            <StudioSearch query={searchQuery} results={searchResults} loading={searchLoading} error={searchError} onQueryChange={setSearchQuery} onOpenResult={openSearchResult} />
            {!studioView && selectedProject && selectedProject.status !== 'archived' && <IconButton label="归档当前项目" onClick={openArchiveConfirmation}><Archive size={17} /></IconButton>}
            <IconButton label="刷新工作台" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
            <input ref={inputRef} className="file-input" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void upload(event.target.files)} />
            {canImport && view !== 'library' && <button type="button" className="command-button" onClick={() => inputRef.current?.click()} disabled={uploading}><ImagePlus size={17} />{uploading && uploadProgress ? '正在导入 ' + uploadProgress.completed + '/' + uploadProgress.total : importLabel}</button>}
          </div>
        </header>
        {!studioView ? <WorkspaceContextBar project={selectedProject} task={selectedTask} rounds={rounds} selectedRound={selectedRound} view={view} assetScope={assetScope} sessionPlanStatus={sessionPlanStatus} onProject={() => navigateRoute({ view: 'project-overview', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onTasks={() => navigateRoute({ view: 'tasks', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onSelectRound={(roundId) => navigateRoute(selectRound(route, roundId))} onNavigate={(nextView, changes = {}) => navigateRoute({ view: nextView, ...changes })} /> : <SessionPlanSummary sessionPlanStatus={sessionPlanStatus} />}
      </div>
      <RuntimeHealthAlertStrip studio={studio} recoveryPhase={recoveryPhase} repairing={runtimeRepairing} onCopy={() => void copyRuntimeDiagnostic()} onRefresh={() => void refresh()} onRepair={() => void repairRuntime()} />
      {connectionError && <div className="connection-error-strip" role="alert" aria-live="assertive"><CloudOff size={16} /><span>{connectionError}</span></div>}
      {error && <div className="error-strip" role="alert" aria-live="assertive"><CircleAlert size={16} /><span>{error}</span><IconButton label="关闭请求错误" onClick={() => setError('')}><X size={15} /></IconButton></div>}
      {contextError && <div className="error-strip" role="alert" aria-live="assertive"><CircleAlert size={16} /><span>{contextError}</span><IconButton label="关闭上下文错误" onClick={() => setContextError('')}><X size={15} /></IconButton></div>}
      {notice && <div className="notice-strip" role="status" aria-live="polite"><Check size={16} /><span>{notice}</span><IconButton label="关闭通知" onClick={() => setNotice('')}><X size={15} /></IconButton></div>}
      {renderActiveView()}
    </section>

    {assetProvenance && <aside className="asset-inspector" aria-label="资产来源与评审记录"><div className="asset-inspector-head"><div><p className="eyebrow">资产检查器</p><h2>{assetProvenance.asset?.kind === 'generated' ? '生成结果来源链' : '导入素材来源链'}</h2></div><IconButton label="关闭资产检查器" onClick={() => setAssetProvenance(null)}><X size={16} /></IconButton></div><div className="asset-inspector-section"><span>来源</span><p>{assetProvenance.asset?.kind === 'generated' ? '由已确认轮次中的运行项保存' : '导入到当前 Studio 的素材'}</p>{assetProvenance.outputs?.map((output) => <button type="button" key={output.runItem.id} className="trace-link" onClick={() => { navigateRoute({ view: 'runs', projectId: output.project.id, taskId: output.task.id, roundId: output.round.id, runId: output.run.id }); setAssetProvenance(null); }}><span>{output.project.name} / {output.task.name}</span><b>{output.round.purpose} · 运行项 {output.runItem.sequence}</b></button>)}</div><div className="asset-inspector-section"><span>评审历史</span>{assetProvenance.reviews?.length ? assetProvenance.reviews.map((review) => <p key={review.id}><b>{review.decision === 'keep' ? '保留' : review.decision === 'review' ? '待复核' : review.decision === 'reject' ? '不采用' : '衍生方向'}</b> · {review.createdAt}</p>) : <p>尚未记录评审。</p>}</div><div className="asset-inspector-section"><span>交付引用</span>{assetProvenance.deliveries?.length ? assetProvenance.deliveries.map((delivery) => <p key={delivery.id}>{delivery.name} · {delivery.status}</p>) : <p>尚未加入交付草稿。</p>}</div><div className="asset-inspector-section"><span>批次版本</span>{assetProvenance.deliveryBatches?.length ? assetProvenance.deliveryBatches.map((batch) => <p key={batch.versionId}>{batch.name} · v{batch.versionNo} · {batch.status === 'ready' ? '已准备' : batch.status === 'draft' ? '草稿' : '已被新修订版本替代'}</p>) : <p>尚未加入版本化交付批次。</p>}</div></aside>}
    {generationConfirmation && <ConfirmationDialog label="确认创作计划" title={'确认计划 v' + generationConfirmation.round.planVersion + '？'} message="此操作代表当前用户已审阅计划，并把确认绑定到当前 conversation 与计划哈希。确认不会调用 Provider；请返回当前智能体会话继续预检和生成。" confirmLabel="确认计划" busy={generationConfirmationBusy} error={generationConfirmationError} tone="warning" onCancel={dismissGenerationConfirmation} onConfirm={confirmGenerationPlan} />}
    {previewAssets.length > 0 && <AccessibleDialog className="image-inspector" label={previewAssets.length === 2 ? '双图对比' : '素材放大查看'} onDismiss={() => setPreviewAssets([])}><div className="inspector-toolbar"><span>{previewAssets.length === 2 ? '双图对比' : '素材查看'}</span><div><IconButton label="缩小" disabled={previewZoom <= 0.75} onClick={() => setPreviewZoom((value) => Math.max(0.75, value - 0.25))}><ZoomOut size={16} /></IconButton><IconButton label="放大" disabled={previewZoom >= 2} onClick={() => setPreviewZoom((value) => Math.min(2, value + 0.25))}><ZoomIn size={16} /></IconButton><IconButton label="关闭查看" onClick={() => setPreviewAssets([])}><X size={16} /></IconButton></div></div><div className={'inspector-images ' + (previewAssets.length === 2 ? 'is-compare' : '')}>{previewAssets.map((asset, index) => { const selected = selectedAssetIds.has(asset.id); const busy = selectionBusyIds.has(asset.id); return <figure className={selected ? 'is-selected' : ''} key={asset.id}>{selectedProject && !asset.deletedAt && <label className="inspector-select-control"><input type="checkbox" checked={selected} disabled={busy} onChange={() => void markAsDeliverable(asset)} /><span>{selected ? <Check size={15} /> : <Bookmark size={15} />}{busy ? '正在保存' : selected ? '已选成果' : '选为成果'}</span></label>}<img src={assetOriginalUrl(asset)} alt="" style={{ transform: 'scale(' + previewZoom + ')' }} /><figcaption>{asset.display?.label || (previewAssets.length === 2 ? '对比图 ' + (index + 1) : '素材预览')}</figcaption></figure>; })}</div></AccessibleDialog>}
    {providerDetails && <ProviderSettings request={api} onDismiss={() => setProviderDetails(null)} onChanged={refresh} onRestarting={beginStudioRestart} />}
    {confirmation && <ConfirmationDialog label={confirmation.kind === 'archive' ? '确认归档项目' : '确认移入回收站'} title={confirmation.kind === 'archive' ? '归档“' + confirmation.projectName + '”？' : '将图片移入回收站？'} message={confirmation.kind === 'archive' ? '归档后将关闭该项目下的任务与轮次。未完成生成必须先暂停或取消。是否继续？' : '这张图片仍被选择、资料库或交付引用。移入回收站不会删除已冻结交付，是否继续？'} confirmLabel={confirmation.kind === 'archive' ? '确认归档' : '继续移入'} busy={confirmationBusy} error={confirmationError} onCancel={dismissConfirmation} onConfirm={confirmPendingAction} />}
  </main>;
}

function renderWorkbench() {
  createRoot(document.getElementById('root')).render(<WorkbenchErrorBoundary><LocalStudioAuthorizationGate /></WorkbenchErrorBoundary>);
}

renderWorkbench();
