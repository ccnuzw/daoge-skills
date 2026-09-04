import { Component, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, Bookmark, Check, ChevronLeft, ChevronRight, CircleAlert, CloudOff, Columns3, Copy, Download, Ellipsis, Eye, FolderKanban, GitFork, ImagePlus, Inbox, Library, LoaderCircle, LockKeyhole, MessageSquareText, PanelLeftClose, Pause, Play, RefreshCw, RotateCcw, Search, Share2, SlidersHorizontal, Sparkles, Tag, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { dryRunEvidence, normalizeAdvancedDetails } from './advanced-details.mjs';
import { mergeRunHistoryItems, runExecutionPresentation, runHistoryOption, runItemRecovery, statusPresentation, taskPresentation } from './status-presentation.mjs';
import { ASSET_SCOPES, isStudioView, parseWorkbenchRoute, rendererForWorkbenchView, selectProject, selectRound, selectTask, serializeWorkbenchRoute, updateWorkbenchRoute } from './workbench-route.mjs';
import { PromptWorkspace } from './prompt-workspace.jsx';
import { LearningCenter } from './learning-center.jsx';
import { CreativeLibrary } from './creative-library.jsx';
import { SharedAssets } from './shared-assets.jsx';
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
import { assetRefreshPath } from './asset-refresh-plan.mjs';
import { PROJECT_PAGE_SIZE, TASK_OVERVIEW_PAGE_SIZE, TASK_PAGE_SIZE, createProjectSearchIndex, createTaskSearchIndex, filterProjectIndex, filterTaskIndex, paginateWorkspaceItems } from './workspace-list-model.mjs';
import { ProviderSettings } from './provider-settings.jsx';
import { workbenchConversationId } from './workbench-session.mjs';
import './styles.css';

const EMPTY = [];

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

const ASSET_SCOPE_LABELS = { round: '当前轮次', task: '当前任务', project: '当前项目', studio: '全部 Studio' };


function statusLabel(value) { return statusPresentation('generic', value).label; }

function StatusPill({ value, scope = 'generic', presentation = null }) {
  const semantics = presentation || statusPresentation(scope, value);
  return <span className={'status-pill ' + semantics.tone}>{semantics.label}</span>;
}

function IconButton({ label, children, onClick, disabled = false, tone = 'default' }) {
  return <button className={'icon-button ' + tone} type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}>{children}</button>;
}
function AssetSelectionStrip({ assets, onRemove, onClear, onPreview, onDownloadArchive }) {
  return <section className="selection-strip">
    <header><div><p className="eyebrow">当前选片</p><h2>{String(assets.length).padStart(2, '0')} 张</h2></div>{assets.length > 0 && <div className="selection-strip-actions"><button type="button" className="outline-button" onClick={onDownloadArchive}><Download size={15} />打包下载 {assets.length} 张</button><IconButton label="清空当前选片" onClick={onClear}><X size={15} /></IconButton></div>}</header>
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
  return <section className="project-overview-stage"><header className="project-overview-head"><div><p className="eyebrow">项目工作区</p><h2>{project.name}</h2><span>从任务推进创作，在项目资产中完成跨任务选片，再进入交付。</span></div><StatusPill value={project.status} scope="project" /></header><div className="project-status-strip"><button type="button" onClick={onOpenTasks}><span>任务</span><b>{tasks.length}</b><small>{activeTasks.length ? activeTasks.length + ' 个进行中' : '暂无进行中任务'}</small></button><button type="button" onClick={onOpenAssets}><span>当前选片</span><b>{selectedCount}</b><small>跨任务的项目选择</small></button><button type="button" onClick={onOpenDeliveries}><span>交付</span><b>查看</b><small>草稿、版本与导出</small></button></div><section className="project-task-panel"><header><div><p className="eyebrow">创作任务</p><h3>从一个目标继续</h3></div><button type="button" className="outline-button" onClick={onOpenTasks}>查看全部任务</button></header><ManagedTaskList tasks={tasks} pageSize={TASK_OVERVIEW_PAGE_SIZE} actionLabel="进入任务" emptyMessage="在会话中建立创作任务后，可以从这里继续。" onOpenTask={onOpenTask} /></section></section>;
}

function ProjectTaskList({ project, tasks, onOpenTask }) {
  return <section className="project-tasks-stage"><header><div><p className="eyebrow">{project.name}</p><h2>任务</h2><span>搜索、按状态筛选并分页管理每个独立创作目标。</span></div></header><ManagedTaskList tasks={tasks} pageSize={TASK_PAGE_SIZE} actionLabel="查看轮次" emptyMessage="在会话中建立创作任务后，会显示在这里。" onOpenTask={onOpenTask} /></section>;
}

function WorkspaceContextBar({ project, task, rounds, selectedRound, view, assetScope, onProject, onTasks, onSelectRound, onNavigate }) {
  if (!project) return null;
  const taskMode = Boolean(task) && (['studio-overview', 'prompts', 'runs'].includes(view) || (view === 'assets' && assetScope !== 'project'));
  return <div className="workspace-context"><button type="button" onClick={onProject}><span>项目</span><b>{project.name}</b></button>{task && <button type="button" onClick={onTasks}><span>任务</span><b>{task.name}</b></button>}{taskMode && <><label><span>轮次</span><select value={selectedRound?.id || ''} onChange={(event) => onSelectRound(event.target.value || null)}><option value="">选择轮次</option>{rounds.map((round) => <option value={round.id} key={round.id}>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[round.purpose] || round.purpose} · 计划 v{round.planVersion}</option>)}</select></label><div className="task-local-tabs"><button type="button" className={view === 'studio-overview' ? 'is-active' : ''} onClick={() => onNavigate('studio-overview', { assetScope: 'task' })}>概览</button><button type="button" className={view === 'prompts' ? 'is-active' : ''} disabled={!selectedRound} onClick={() => onNavigate('prompts', { assetScope: 'round' })}>计划</button><button type="button" className={view === 'runs' ? 'is-active' : ''} disabled={!selectedRound} onClick={() => onNavigate('runs', { assetScope: 'round' })}>运行</button><button type="button" className={view === 'assets' ? 'is-active' : ''} onClick={() => onNavigate('assets', { assetScope: selectedRound ? 'round' : 'task' })}>结果</button></div></>}</div>;
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
  const stateLabel = asset.deletedAt ? '已移入回收站' : asset.review?.decision === 'keep' ? '已保留，可交付' : asset.review?.decision === 'review' ? '待复核' : asset.review?.decision === 'reject' ? '不采用' : selected ? '已加入选片' : '尚未评审';
  return <article className={'asset-card ' + (asset.deletedAt ? 'is-trashed ' : '') + (selected ? 'is-selected' : '')}>
    <div className="asset-preview">
      {asset.deletedAt ? <div className="trash-preview"><Trash2 size={24} strokeWidth={1.4} /></div> : <button type="button" className="asset-preview-button" onClick={() => onPreview([asset])} aria-label="放大查看素材"><img src={assetThumbnailUrl(asset)} alt="" loading="lazy" decoding="async" /></button>}
      {!asset.deletedAt && <label className="asset-select-control"><input type="checkbox" checked={selected} disabled={selectionBusy} onChange={() => onToggleSelect(asset)} /><span><Bookmark size={13} fill={selected ? 'currentColor' : 'none'} />{selected ? '已选成果' : '选为成果'}</span></label>}
      <div className="asset-card-tools">{!asset.deletedAt && <IconButton label="下载原图" onClick={() => onDownload(asset)}><Download size={16} /></IconButton>}<IconButton label={menuOpen ? '关闭资产操作' : '打开资产操作'} onClick={() => setMenuOpen((value) => !value)}><Ellipsis size={17} /></IconButton></div>

    </div>
    {menuOpen && <div className="asset-action-menu">{asset.deletedAt ? <button type="button" onClick={() => runMenuAction(() => onRestore(asset.id))}><RotateCcw size={15} /><span>恢复资产</span></button> : <><button type="button" onClick={() => runMenuAction(() => onCopy(asset))}><Copy size={15} /><span>复制图片</span></button><button type="button" onClick={() => runMenuAction(() => onSetShared(asset, !shared))}><Share2 size={15} /><span>{shared ? '取消跨项目共享' : '共享到跨项目素材'}</span></button><button type="button" onClick={() => runMenuAction(() => onInspect(asset.id))}><GitFork size={15} /><span>查看来源与评审</span></button><div className="asset-action-group"><button type="button" onClick={() => runMenuAction(() => onReview(asset.id, 'keep'))}><Check size={15} /><span>保留</span></button><button type="button" onClick={() => runMenuAction(() => onReview(asset.id, 'review'))}><CircleAlert size={15} /><span>待复核</span></button><button type="button" onClick={() => { setAnnotating(true); setMenuOpen(false); }}><MessageSquareText size={15} /><span>添加批注</span></button><button type="button" onClick={() => runMenuAction(() => onReview(asset.id, 'derive'))}><Sparkles size={15} /><span>标记为衍生方向</span></button><button type="button" onClick={() => runMenuAction(() => onReview(asset.id, 'reject'))}><X size={15} /><span>不采用</span></button></div><button type="button" className="danger" role="menuitem" onClick={() => runMenuAction(() => onTrash(asset.id))}><Trash2 size={15} /><span>移入回收站</span></button></>}</div>}
    <div className="asset-meta"><div><strong>{assetLabel}</strong><span className="asset-state">{stateLabel}</span></div>{contextLabel && <span className="asset-context-line" title={contextLabel}>{contextLabel}</span>}</div>
    {annotating && <div className="annotation-editor"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录本轮反馈" /><button type="button" className="outline-button" disabled={!note.trim()} onClick={saveNote}>保存批注</button></div>}
  </article>;
}

function RunItemRow({ item, onInspect, onRetry }) {
  const recovery = runItemRecovery(item);
  const retryable = ['failed', 'blocked', 'retry_wait'].includes(item.status);
  return <div className="run-item-row">
    <div className="run-item-summary"><span>第 {item.sequence} 项</span>{item.outputAssets?.length ? <span className="run-item-output">{item.outputAssets.map((asset) => <button type="button" key={asset.id} title="查看结果资产来源" onClick={() => void onInspect(asset.id)}><img src={assetThumbnailUrl(asset)} alt="运行结果" loading="lazy" decoding="async" /></button>)}</span> : null}</div>
    <StatusPill value={item.status} scope="run_item" />
    <div className="run-item-details"><span>尝试 {Number.isInteger(item.attempts) ? item.attempts : 0} 次</span>{item.retryAt && <span>重试时间 {item.retryAt}</span>}{recovery.error && <span className="run-item-error">{recovery.error}</span>}{recovery.advice && <span className="run-item-recovery">{recovery.advice}</span>}</div>
    {retryable ? <IconButton label={'重试第 ' + item.sequence + ' 项'} onClick={() => void onRetry(item.id)}><RefreshCw size={15} /></IconButton> : <span />}
  </div>;
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
  const [guideDismissed, setGuideDismissed] = useState(() => window.localStorage.getItem('daoge-pic:guide-dismissed') === '1');
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
  const [runItems, setRunItems] = useState(EMPTY);
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState(() => parseWorkbenchRoute(window.location.search));
  const [contextError, setContextError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [eventRevision, setEventRevision] = useState({ taskOverview: 0, creativeRecord: 0, studioOverview: 0, planVersions: 0, runs: 0 });
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
  const { view, projectId: activeProjectId, taskId: activeTaskId, roundId: activeRoundId, compareRoundIds = EMPTY, runId: activeRunId, assetScope } = route;
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
    setProvider(providerData.status);
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
    const selectedProject = activeProjectId ? (knownProjects || []).find((project) => project.id === activeProjectId) || null : null;
    if (activeProjectId && !selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY); setDeliveries(EMPTY); setDeliveryBatches(EMPTY);
      setContextError('该链接所指向的项目已不存在，或不属于当前 Studio。');
      return;
    }
    if (!selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY); setDeliveries(EMPTY); setDeliveryBatches(EMPTY);
      setContextError(activeTaskId || activeRoundId || activeRunId ? '请先选择一个项目，再继续查看任务、轮次或运行。' : '');
      return;
    }
    const needsDeliveries = view === 'deliveries';
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
      setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY);
      setContextError('该任务不属于当前项目，或已不存在。');
      return;
    }
    if (!selectedTask) {
      setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY);
      setContextError(activeRoundId || activeRunId ? '请先选择一个任务，再继续查看轮次或运行。' : '');
      return;
    }
    const roundData = await load('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/rounds');
    const nextRounds = roundData.rounds || [];
    setRounds(nextRounds);
    const selectedRound = activeRoundId ? nextRounds.find((round) => round.id === activeRoundId) || null : null;
    if (activeRoundId && !selectedRound) {
      setRuns(EMPTY); setRunItems(EMPTY);
      setContextError('该轮次不属于当前任务，或已不存在。');
      return;
    }
    if (!selectedRound || view !== 'runs') {
      setRuns(EMPTY); setRunItems(EMPTY);
      setContextError(activeRunId ? '请先打开生成运行视图，再继续查看运行。' : '');
      return;
    }
    const runData = await load('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/runs');
    const nextRuns = runData.runs || [];
    setRuns(nextRuns);
    const selectedRun = activeRunId ? nextRuns.find((run) => run.id === activeRunId) || null : null;
    if (activeRunId && !selectedRun) {
      setRunItems(EMPTY);
      setContextError('该运行不属于当前轮次，或已不存在。');
    } else if (selectedRun) {
      const itemData = await load('/api/runs/' + encodeURIComponent(selectedRun.id) + '/items');
      setRunItems(itemData.items || []);
      setContextError('');
    } else {
      setRunItems(EMPTY);
      setContextError('');
    }
  }, [activeProjectId, activeTaskId, activeRoundId, activeRunId, view]);

  const refreshAssets = useCallback(async () => {
    if (!['assets', 'trash', 'deliveries'].includes(view)) {
      assetRequests.current.cancel();
      setAssets(EMPTY);
      setAssetTotal(0);
      return true;
    }
    const path = assetRefreshPath(route, ['assets', 'trash'].includes(view) ? { page: assetPage, pageSize: assetPageSize, filter: assetFilter } : null);
    if (!path) {
      setAssets(EMPTY);
      setAssetTotal(0);
      return true;
    }
    const request = assetRequests.current.begin(path);
    try {
      const data = await api(path, { signal: request.signal });
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
    const detail = view === 'studio-overview' ? 'studioOverview' : view === 'prompts' ? 'planVersions' : view === 'runs' ? 'creativeRecord' : '';
    setEventRevision((current) => ({
      taskOverview: current.taskOverview,
      creativeRecord: current.creativeRecord + (detail === 'creativeRecord' && plan.creativeRecord ? 1 : 0),
      studioOverview: current.studioOverview + (detail === 'studioOverview' && plan.studioOverview ? 1 : 0),
      planVersions: current.planVersions + (detail === 'planVersions' && plan.planVersions ? 1 : 0),
      runs: current.runs + (plan.refreshContext ? 1 : 0)
    }));
  }, [view]);
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
    if (refreshed) applyEventRefreshPlan({ taskOverview: true, creativeRecord: true, studioOverview: true, planVersions: true, refreshContext: true });
    return refreshed;
  }, [refresh, applyEventRefreshPlan]);
  useStudioEvents({
    studioId: studio?.studioId || null,
    onEventBatch: refreshForEvents,
    onSnapshot: refreshSnapshot,
    onConnectionError: setConnectionError,
    onRequestError: setError
  });
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
  const runExecutionStatus = runExecutionPresentation(activeRun, runItems);
  const visibleRunItems = useMemo(() => mergeRunHistoryItems(creativeRecord?.items || EMPTY, runItems), [creativeRecord?.items, runItems]);
  const runLifecycleStatus = activeRun ? statusPresentation('run', activeRun.status) : null;
  const canCancelActiveRun = Boolean(activeRun && !['completed', 'cancelled'].includes(activeRun.status));
  const uploadTarget = assetScope === 'round' && selectedRound ? { type: 'creative_round', id: selectedRound.id } : assetScope === 'task' && selectedTask ? { type: 'creative_task', id: selectedTask.id } : selectedProject ? { type: 'project', id: selectedProject.id } : null;
  const canImport = view === 'assets' && Boolean(selectedProject);
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
    const signature = [selectedRound.id, activeRunId || '', eventRevision.creativeRecord].join(':');
    const request = creativeRecordRequests.current.begin(signature);
    const query = activeRunId ? '?runId=' + encodeURIComponent(activeRunId) : '';
    void api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/creative-record' + query, { signal: request.signal }).then((data) => {
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
  const confirmAndQueueGeneration = async () => {
    if (!generationConfirmation) return;
    setGenerationConfirmationBusy(true);
    setGenerationConfirmationError('');
    try {
      const confirmationSessionId = generationConfirmation.challenge.sessionId;
      await api('/api/rounds/' + encodeURIComponent(generationConfirmation.round.id) + '/confirm', { method: 'POST', idempotencyKey: uniqueKey('user-confirm'), body: { expectedVersion: generationConfirmation.challenge.expectedVersion, sessionId: confirmationSessionId, challenge: generationConfirmation.challenge.challenge } });
      const preflight = await api('/api/rounds/' + encodeURIComponent(generationConfirmation.round.id) + '/preflight', { method: 'POST', idempotencyKey: uniqueKey('user-preflight'), body: { sessionId: confirmationSessionId } });
      if (!preflight.value?.preflight?.valid || !preflight.value?.preview || !preflight.value?.confirmToken) throw new Error('预检未通过，未创建生成运行。');
      const queued = await api('/api/runs', { method: 'POST', idempotencyKey: uniqueKey('user-run'), body: { roundId: generationConfirmation.round.id, preflightId: preflight.value.preview.id, confirmToken: preflight.value.confirmToken } });
      const roundId = generationConfirmation.round.id;
      setGenerationConfirmation(null);
      setNotice('计划已由当前用户确认，并通过 daemon 闸门创建生成运行。');
      await refresh();
      navigateRoute({ view: 'runs', roundId, compareRoundIds: [roundId], runId: queued.value?.id || null });
      return true;
    } catch (nextError) {
      setGenerationConfirmationError(nextError.message || '确认或启动生成失败。');
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
  const dismissGuide = () => { window.localStorage.setItem('daoge-pic:guide-dismissed', '1'); setGuideDismissed(true); };

  const renderAssetsView = () => <section className="asset-stage">
    {routeView === 'assets' && <div className="asset-scope-control" aria-label="资产范围"><span>查看范围</span>{ASSET_SCOPES.filter((scope) => scope !== 'studio').map((scope) => <button type="button" key={scope} className={assetScope === scope ? 'is-active' : ''} disabled={(scope === 'round' && !selectedRound) || (scope === 'task' && !selectedTask) || (scope === 'project' && !selectedProject)} onClick={() => navigateRoute({ assetScope: scope })}>{ASSET_SCOPE_LABELS[scope]}</button>)}</div>}
    <div className="asset-stage-head">
      <div><span className="asset-count">{assetTotal.toString().padStart(2, '0')}</span><span className="asset-count-label">{routeView === 'trash' ? '已移入回收站' : '张可用资产'}</span></div>
      <div className="asset-stage-tools">
        <div className="asset-filter" aria-label="素材筛选"><SlidersHorizontal size={14} />{[['all', '全部'], ['generated', '生成'], ['import', '导入']].map(([value, label]) => <button type="button" key={value} className={assetFilter === value ? 'is-active' : ''} onClick={() => { setAssetFilter(value); setAssetPage(1); }}>{label}</button>)}</div>
        {routeView === 'assets' && visibleAssets.length > 0 && <button type="button" className="outline-button asset-select-page" disabled={pageSelectionBusy} onClick={() => void setPageSelection(!allPageAssetsSelected)}><Check size={15} />{allPageAssetsSelected ? '取消全选本页' : '全选本页'}</button>}
        <label className="asset-page-size"><span>每页</span><select aria-label="每页资产数量" value={assetPageSize} onChange={(event) => { setAssetPageSize(normalizeAssetPageSize(event.target.value)); setAssetPage(1); }}>{ASSET_PAGE_SIZES.map((size) => <option value={size} key={size}>{size}</option>)}</select><span>张</span></label>
        {selectedAssets.length === 2 && <IconButton label="对比两张已选素材" onClick={() => { setPreviewZoom(1); setPreviewAssets(selectedAssets); }}><Eye size={16} /></IconButton>}
        <div className="asset-hint">{routeView === 'trash' ? '当前项目回收站' : selectedAssetIds.size ? selectedAssetIds.size + ' 张已选择' : ASSET_SCOPE_LABELS[assetScope] + '资产'}</div>
      </div>
    </div>
    {routeView === 'assets' && selectedProject && <AssetSelectionStrip assets={selectedAssets} onRemove={toggleSelection} onClear={() => void clearSelection()} onDownloadArchive={() => downloadProjectArchive(selectedAssets.map((asset) => asset.id))} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />}
    {visibleAssets.length ? <><div className="asset-grid">{visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} selected={selectedAssetIds.has(asset.id)} selectionBusy={selectionBusyIds.has(asset.id)} shared={sharedAssetIds.has(asset.id)} onToggleSelect={markAsDeliverable} onReview={review} onTrash={trash} onRestore={restore} onInspect={inspectAsset} onDownload={downloadAsset} onCopy={copyAsset} onSetShared={setAssetShared} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />)}</div><nav className="asset-pagination" aria-label="资产分页"><button type="button" className="outline-button" disabled={assetPage <= 1} onClick={() => setAssetPage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} />上一页</button><span>第 <b>{assetPage}</b> / {totalAssetPages} 页 · 共 {assetTotal} 张</span><button type="button" className="outline-button" disabled={assetPage >= totalAssetPages} onClick={() => setAssetPage((current) => Math.min(totalAssetPages, current + 1))}>下一页<ChevronRight size={15} /></button></nav></> : <div className="empty-stage asset-empty">{routeView === 'trash' ? <Archive size={30} strokeWidth={1.15} /> : <Inbox size={30} strokeWidth={1.15} />}<p>{routeView === 'trash' ? '当前项目回收站为空' : (assetScope === 'round' && !selectedRound ? '请先从任务上下文选择轮次，再查看本轮结果。' : '当前范围内暂未找到资产。')}</p>{routeView === 'assets' && <button type="button" className="outline-button" onClick={() => inputRef.current?.click()}><Upload size={16} />导入图片</button>}</div>}
  </section>;
  const viewRenderers = {
    projects: () => <ProjectIndex projects={projects} onOpenProject={(projectId) => navigateRoute(selectProject(route, projectId))} />,
    'project-overview': () => selectedProject ? <ProjectOverview project={selectedProject} tasks={tasks} selectedCount={selectedAssets.length} onOpenTasks={() => navigateRoute({ view: 'tasks', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenAssets={() => navigateRoute({ view: 'assets', assetScope: 'project', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenDeliveries={() => navigateRoute({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenTask={(taskId) => navigateRoute(selectTask(route, taskId))} /> : null,
    tasks: () => selectedProject ? <ProjectTaskList project={selectedProject} tasks={tasks} onOpenTask={(taskId) => navigateRoute(selectTask(route, taskId))} /> : null,
    'studio-overview': () => <section className="overview-stage">
      <div className="overview-head"><div><p className="eyebrow">同一任务内的显式对比</p><h2>{selectedTask ? selectedTask.name : '请选择任务'}</h2><span>{studioOverview?.availableRounds?.length || 0} 个可比较轮次。比较不会推断或启动运行。</span></div>{taskOverview && <div className="overview-metrics"><span>轮次 {taskOverview.summary?.roundCount || 0}</span><span>运行 {taskOverview.summary?.runCount || 0}</span><span>结果 {taskOverview.summary?.resultCount || 0}</span></div>}</div>
      {selectedTask ? <><div className="compare-selector">{(studioOverview?.availableRounds || rounds).map((round) => <label key={round.id}><input type="checkbox" checked={compareRoundIds.includes(round.id)} onChange={() => toggleComparedRound(round.id)} /><span>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[round.purpose] || round.purpose} · 计划 v{round.planVersion}</span></label>)}</div>{studioOverview?.comparisons?.length ? <div className="comparison-grid">{studioOverview.comparisons.map((comparison) => <article key={comparison.round.id} className="comparison-column"><header><div><p>轮次 {comparison.round.planVersion}</p><h3>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[comparison.round.purpose] || comparison.round.purpose}</h3></div><StatusPill value={comparison.round.status} scope="round" /></header><dl><div><dt>上游</dt><dd>{comparison.lineage?.rounds?.length ? '承接 ' + comparison.lineage.rounds.length + ' 个轮次' : '首个方向'}</dd></div><div><dt>计划</dt><dd>{comparison.round.plan?.operation === 'edit' ? '编辑' : '生成'} · {comparison.round.plan?.itemCount || 0} 项</dd></div><div><dt>产出</dt><dd>{comparison.summary?.resultCount || 0} 个结果</dd></div></dl>{comparison.runsTruncated && <p className="comparison-truncated">仅显示最近 24 次运行</p>}<div className="comparison-runs">{comparison.runs?.map((run) => <section key={run.id}><button type="button" className="trace-link" onClick={() => navigateRoute({ view: 'runs', projectId: selectedProject?.id, taskId: selectedTask.id, roundId: comparison.round.id, compareRoundIds: [comparison.round.id], runId: run.id })}><b>运行项 {run.items?.length || 0}</b><StatusPill value={run.status} scope="run" /></button><div className="comparison-assets">{run.items?.flatMap((item) => item.outputAssets || []).map((asset) => <button type="button" key={asset.id} title="查看资产来源与评审" onClick={() => void inspectAsset(asset.id)}><img src={assetThumbnailUrl(asset)} alt="轮次结果" loading="lazy" decoding="async" /><span>{asset.review?.decision === 'keep' ? '保留' : asset.review?.decision === 'review' ? '待复核' : '未评审'}</span></button>)}</div></section>)}</div></article>)}</div> : <div className="empty-stage"><Columns3 size={30} strokeWidth={1.15} /><p>勾选一个或多个轮次后，比较计划、运行、结果和当前评审。</p></div>}</> : <div className="empty-stage"><Columns3 size={30} strokeWidth={1.15} /><p>请先选择项目和任务，再打开创作总览。</p></div>}
    </section>,
    prompts: () => <><PromptWorkspace round={selectedRound} planVersions={planVersions} loading={planVersionsLoading} onRefresh={() => void refreshPlanVersions()} />{selectedRound?.status === 'awaiting_confirmation' && <section className="human-confirmation-gate"><div><p className="eyebrow">人工确认闸门 · 可写操作</p><h3>等待当前用户确认计划</h3><span>这是独立于只读摘要的写入闸门。Skill 只能创建挑战；只有此 Workbench 标签中的确认动作能激活计划、签发预检绑定令牌并允许创建运行。</span></div><button type="button" className="command-button" onClick={() => void openGenerationConfirmation()} disabled={!session || generationConfirmationBusy}><LockKeyhole size={16} />{generationConfirmationBusy ? '正在准备确认' : '审阅并确认生成'}</button></section>}</>,
    runs: () => <section className="run-stage">
      <div className="run-focus"><div><p className="eyebrow">{selectedRound ? ({ exploration: '探索轮次', refinement: '优化轮次', variation: '变体轮次', edit: '编辑轮次', fill: '补图轮次' })[selectedRound.purpose] : '请先选择轮次'}</p><h2>{activeRun ? '已选择生成运行' : selectedRound ? '请选择生成运行' : '尚未选择轮次'}</h2></div>{activeRun && <StatusPill presentation={runExecutionStatus} />}</div>
      {selectedRound && <label className="run-history-select"><span>运行历史</span><select value={activeRunId || ''} onChange={(event) => navigateRoute({ runId: event.target.value || null })}><option value="">请选择生成运行</option>{runs.map((run) => <option value={run.id} key={run.id}>{runHistoryOption(run)}</option>)}</select></label>}
      {taskOverview && <section className="creative-summary"><div><p className="eyebrow">当前任务创作链</p><h3>{taskOverview.task?.name}</h3><span>{taskOverview.summary?.roundCount || 0} 个轮次 · {taskOverview.summary?.runCount || 0} 次运行 · {taskOverview.summary?.resultCount || 0} 个结果</span></div>{creativeRecord && <div className="round-record"><span>第 {creativeRecord.round?.planVersion || 0} 版计划 · {creativeRecord.round?.purpose || '创作'}方向</span><span>{creativeRecord.lineage?.rounds?.length ? '承接 ' + creativeRecord.lineage.rounds.length + ' 个上游轮次' : '首个创作方向'}</span></div>}</section>}
      {activeRun ? <><div className="run-metrics"><div><span>计划产出</span><b>{activeRun.planSnapshot?.itemCount ?? '未记录'}</b></div><div><span>冻结并发</span><b>{activeRun.executionConcurrency + ' 路'}</b><small>{activeRun.concurrencySource === 'default' ? '默认' : activeRun.concurrencySource === 'serial' ? '串行' : '显式指定'}</small></div><div><span>实际执行</span><b>{runExecutionStatus.label}</b></div><div><span>运行状态</span><b>{runLifecycleStatus.label}</b></div></div><div className="run-controls">{['queued', 'running'].includes(activeRun.status) && <button type="button" className="outline-button" onClick={() => void controlRun('pause')}><Pause size={16} />暂停</button>}{activeRun.status === 'paused' && <button type="button" className="command-button" onClick={() => void controlRun('resume')}><Play size={16} />继续</button>}{['partial', 'failed'].includes(activeRun.status) && <button type="button" className="outline-button" onClick={() => void controlRun('retry')}><RefreshCw size={16} />重试安全项</button>}{canCancelActiveRun && <button type="button" className="danger-button" onClick={() => void controlRun('cancel')}><X size={16} />取消</button>}<IconButton label="查看高级详情" onClick={() => void openAdvancedDetails()}><Ellipsis size={18} /></IconButton></div><div className="run-item-list">{visibleRunItems.length ? visibleRunItems.map((item) => <RunItemRow key={item.id} item={item} onInspect={inspectAsset} onRetry={retryRunItem} />) : <p className="empty-copy">尚无运行项。</p>}</div></> : <p className="empty-copy">从运行历史中选择一次运行，查看冻结计划、并发与执行结果。</p>}
    </section>,
    guide: () => <LearningCenter onDismiss={dismissGuide} onNavigate={(nextView) => navigateRoute({ view: nextView })} />,
    library: () => <CreativeLibrary taskTypes={taskTypes} styleKits={styleKits} brandKits={brandKits} sharedAssets={sharedAssets} onOpenProjects={() => navigateRoute({ view: 'projects' })} onOpenSharedAssets={() => navigateRoute({ view: 'shared-assets' })} />,
    'shared-assets': () => <SharedAssets assets={sharedAssets} onDownload={downloadAsset} onCopy={copyAsset} onSetShared={setAssetShared} onOpenProjects={() => navigateRoute({ view: 'projects' })} />,
    deliveries: () => <CreatorDelivery project={selectedProject} selection={deliverySelection} deliveryName={deliveryName} deliveryCreating={deliveryCreating} completion={deliveryCompletion} frozen={Boolean(deliveryCompletion || deliveryCreating)} onDeliveryNameChange={setDeliveryName} onCreate={() => void completeDelivery()} onOpenAssets={() => navigateRoute({ view: 'assets', assetScope: 'project', taskId: null, roundId: null, compareRoundIds: [], runId: null })} selectedAssets={deliveryFlowAssets} deliveries={deliveries} assets={assets} deliveryBusyId={deliveryBusyId} onDeliveryAction={deliveryAction} onRemoveSelection={(asset) => toggleSelection(asset.id)} onDownload={downloadAsset} onCopy={copyAsset} onArchiveProject={downloadProjectArchive} onArchiveDelivery={downloadDeliveryArchive} batches={deliveryBatches} batchName={batchName} selectedDeliveryIds={selectedDeliveryIds} batchBusy={batchBusy} onBatchNameChange={setBatchName} onToggleDelivery={toggleBatchDelivery} onBatchAction={batchAction} />,
    assets: () => renderAssetsView(),
    trash: () => renderAssetsView()
  };
  const renderActiveView = viewRenderers[routeView];

  if (loading) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  return <main className="studio-shell" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const files = Array.from(event.dataTransfer.files).filter((item) => item.type.startsWith('image/')); if (files.length && canImport) void upload(files); }} onPaste={(event) => { const files = [...event.clipboardData.files].filter((item) => item.type.startsWith('image/')); if (files.length && canImport) { event.preventDefault(); void upload(files); } }}>
    <aside className="studio-rail">
      <div className="brand-mark"><span>DAOGE</span><b>Pic</b></div>
      <WorkbenchNavigation view={view} project={selectedProject} onNavigate={(nextView, changes = {}) => navigateRoute({ view: nextView, ...changes })} />
      <div className="rail-bottom"><button type="button" className="settings-path" onClick={openProviderDetails}><PanelLeftClose size={16} /><span>{provider?.configured ? 'Provider 设置' : '配置生成服务'}</span></button></div>
    </aside>

    <section className="work-surface">
      <header className="surface-header">
        <div className="heading-group"><p className="eyebrow">{studioView ? 'Studio' : selectedProject ? '项目工作区' : 'Studio'}</p><h1>{view === 'projects' ? '项目' : view === 'project-overview' ? '项目概览' : view === 'tasks' ? '任务' : view === 'assets' ? assetScope === 'project' ? '项目资产' : '结果资产' : view === 'runs' ? '生成运行' : view === 'studio-overview' ? '任务概览' : view === 'prompts' ? '计划与提示词' : view === 'library' ? '创作资料库' : view === 'shared-assets' ? '共享素材' : view === 'guide' ? '学习中心' : view === 'deliveries' ? '交付' : '项目回收站'}</h1>{studioView ? <span>{view === 'library' ? '可复用的任务类型、风格与品牌规则。' : view === 'shared-assets' ? '仅显示从项目明确共享的跨项目图片。' : view === 'guide' ? '从工作流、选片和交付开始。' : '选择一个项目后进入创作与交付工作区。'}</span> : selectedProject ? <span>{selectedProject.name}</span> : null}</div>
        <div className="header-actions">
          <StudioSearch query={searchQuery} results={searchResults} loading={searchLoading} error={searchError} onQueryChange={setSearchQuery} onOpenResult={openSearchResult} />
          {provider?.configured ? <button type="button" className="connection-state" onClick={openProviderDetails}><span className="signal-dot" />生成配置已就绪</button> : <button type="button" className="connection-state is-error" onClick={openProviderDetails}><CloudOff size={14} />生成配置未就绪</button>}
          {!studioView && selectedProject && selectedProject.status !== 'archived' && <IconButton label="归档当前项目" onClick={openArchiveConfirmation}><Archive size={17} /></IconButton>}
          <IconButton label="刷新工作台" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
          <input ref={inputRef} className="file-input" type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void upload(event.target.files)} />
          {canImport && view !== 'library' && <button type="button" className="command-button" onClick={() => inputRef.current?.click()} disabled={uploading}><ImagePlus size={17} />{uploading && uploadProgress ? '正在导入 ' + uploadProgress.completed + '/' + uploadProgress.total : importLabel}</button>}
        </div>
      </header>

       {!studioView && <WorkspaceContextBar project={selectedProject} task={selectedTask} rounds={rounds} selectedRound={selectedRound} view={view} assetScope={assetScope} onProject={() => navigateRoute({ view: 'project-overview', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onTasks={() => navigateRoute({ view: 'tasks', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onSelectRound={(roundId) => navigateRoute(selectRound(route, roundId))} onNavigate={(nextView, changes = {}) => navigateRoute({ view: nextView, ...changes })} />}
      {connectionError && <div className="connection-error-strip" role="alert" aria-live="assertive"><CloudOff size={16} /><span>{connectionError}</span></div>}
      {sessionPlanStatus && <aside className={'session-plan-panel ' + (!sessionPlanStatus.context ? 'is-empty' : '')} aria-label="当前会话只读计划摘要"><div><p className="eyebrow">当前会话 · 只读摘要</p>{sessionPlanStatus.context ? <><h3>{sessionPlanStatus.context.project.name} / {sessionPlanStatus.context.task.name}</h3><span>{sessionPlanStatus.context.round.purpose} · 计划 v{sessionPlanStatus.context.round.planVersion}</span></> : <><h3>当前会话没有活动轮次</h3><span>请在会话中绑定项目、任务和轮次；此处只显示已绑定的计划事实。</span></>}</div>{sessionPlanStatus.context && <div className="session-plan-state"><StatusPill value={sessionPlanStatus.context.round.status} scope="round" /><span>{sessionPlanStatus.confirmation.confirmed ? '当前计划已由用户确认' : '当前计划尚未人工确认'}</span>{sessionPlanStatus.latestRun && <span>最近运行：{statusLabel(sessionPlanStatus.latestRun.status)}</span>}</div>}</aside>}
      {error && <div className="error-strip" role="alert" aria-live="assertive"><CircleAlert size={16} /><span>{error}</span><IconButton label="关闭请求错误" onClick={() => setError('')}><X size={15} /></IconButton></div>}
      {notice && <div className="notice-strip" role="status" aria-live="polite"><Check size={16} /><span>{notice}</span><IconButton label="关闭通知" onClick={() => setNotice('')}><X size={15} /></IconButton></div>}
       {view === 'projects' && !guideDismissed && <button type="button" className="guide-nudge" onClick={() => navigateRoute({ view: 'guide' })}>首次使用 Studio？从学习中心了解计划、生成、选片与交付。</button>}

      {renderActiveView()}
    </section>

    {assetProvenance && <aside className="asset-inspector" aria-label="资产来源与评审记录"><div className="asset-inspector-head"><div><p className="eyebrow">资产检查器</p><h2>{assetProvenance.asset?.kind === 'generated' ? '生成结果来源链' : '导入素材来源链'}</h2></div><IconButton label="关闭资产检查器" onClick={() => setAssetProvenance(null)}><X size={16} /></IconButton></div><div className="asset-inspector-section"><span>来源</span><p>{assetProvenance.asset?.kind === 'generated' ? '由已确认轮次中的运行项保存' : '导入到当前 Studio 的素材'}</p>{assetProvenance.outputs?.map((output) => <button type="button" key={output.runItem.id} className="trace-link" onClick={() => { navigateRoute({ view: 'runs', projectId: output.project.id, taskId: output.task.id, roundId: output.round.id, runId: output.run.id }); setAssetProvenance(null); }}><span>{output.project.name} / {output.task.name}</span><b>{output.round.purpose} · 运行项 {output.runItem.sequence}</b></button>)}</div><div className="asset-inspector-section"><span>评审历史</span>{assetProvenance.reviews?.length ? assetProvenance.reviews.map((review) => <p key={review.id}><b>{review.decision === 'keep' ? '保留' : review.decision === 'review' ? '待复核' : review.decision === 'reject' ? '不采用' : '衍生方向'}</b> · {review.createdAt}</p>) : <p>尚未记录评审。</p>}</div><div className="asset-inspector-section"><span>交付引用</span>{assetProvenance.deliveries?.length ? assetProvenance.deliveries.map((delivery) => <p key={delivery.id}>{delivery.name} · {delivery.status}</p>) : <p>尚未加入交付草稿。</p>}</div><div className="asset-inspector-section"><span>批次版本</span>{assetProvenance.deliveryBatches?.length ? assetProvenance.deliveryBatches.map((batch) => <p key={batch.versionId}>{batch.name} · v{batch.versionNo} · {batch.status === 'ready' ? '已准备' : batch.status === 'draft' ? '草稿' : '已被新修订版本替代'}</p>) : <p>尚未加入版本化交付批次。</p>}</div></aside>}
    {generationConfirmation && <ConfirmationDialog label="确认创作计划并开始生成" title={'确认计划 v' + generationConfirmation.round.planVersion + ' 并启动生成？'} message="此操作代表当前用户已审阅计划。daemon 会把确认绑定到当前 conversation、计划哈希和随后生成的预检证据；Skill 无法自行伪造该令牌。" confirmLabel="确认并开始生成" busy={generationConfirmationBusy} error={generationConfirmationError} tone="warning" onCancel={dismissGenerationConfirmation} onConfirm={confirmAndQueueGeneration} />}
    {previewAssets.length > 0 && <AccessibleDialog className="image-inspector" label={previewAssets.length === 2 ? '双图对比' : '素材放大查看'} onDismiss={() => setPreviewAssets([])}><div className="inspector-toolbar"><span>{previewAssets.length === 2 ? '双图对比' : '素材查看'}</span><div><IconButton label="缩小" disabled={previewZoom <= 0.75} onClick={() => setPreviewZoom((value) => Math.max(0.75, value - 0.25))}><ZoomOut size={16} /></IconButton><IconButton label="放大" disabled={previewZoom >= 2} onClick={() => setPreviewZoom((value) => Math.min(2, value + 0.25))}><ZoomIn size={16} /></IconButton><IconButton label="关闭查看" onClick={() => setPreviewAssets([])}><X size={16} /></IconButton></div></div><div className={'inspector-images ' + (previewAssets.length === 2 ? 'is-compare' : '')}>{previewAssets.map((asset, index) => { const selected = selectedAssetIds.has(asset.id); const busy = selectionBusyIds.has(asset.id); return <figure className={selected ? 'is-selected' : ''} key={asset.id}>{selectedProject && !asset.deletedAt && <label className="inspector-select-control"><input type="checkbox" checked={selected} disabled={busy} onChange={() => void markAsDeliverable(asset)} /><span>{selected ? <Check size={15} /> : <Bookmark size={15} />}{busy ? '正在保存' : selected ? '已选成果' : '选为成果'}</span></label>}<img src={assetOriginalUrl(asset)} alt="" style={{ transform: 'scale(' + previewZoom + ')' }} /><figcaption>{asset.display?.label || (previewAssets.length === 2 ? '对比图 ' + (index + 1) : '素材预览')}</figcaption></figure>; })}</div></AccessibleDialog>}
    {providerDetails && <ProviderSettings request={api} onDismiss={() => setProviderDetails(null)} onChanged={refresh} />}
    {confirmation && <ConfirmationDialog label={confirmation.kind === 'archive' ? '确认归档项目' : '确认移入回收站'} title={confirmation.kind === 'archive' ? '归档“' + confirmation.projectName + '”？' : '将图片移入回收站？'} message={confirmation.kind === 'archive' ? '归档后将关闭该项目下的任务与轮次。未完成生成必须先暂停或取消。是否继续？' : '这张图片仍被选择、资料库或交付引用。移入回收站不会删除已冻结交付，是否继续？'} confirmLabel={confirmation.kind === 'archive' ? '确认归档' : '继续移入'} busy={confirmationBusy} error={confirmationError} onCancel={dismissConfirmation} onConfirm={confirmPendingAction} />}
  </main>;
}

function renderWorkbench() {
  createRoot(document.getElementById('root')).render(<WorkbenchErrorBoundary><LocalStudioAuthorizationGate /></WorkbenchErrorBoundary>);
}

renderWorkbench();
