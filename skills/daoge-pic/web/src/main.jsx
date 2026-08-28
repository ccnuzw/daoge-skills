import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, Bookmark, Check, CircleAlert, CloudOff, Eye, FolderKanban, GitFork, ImagePlus, Inbox, Library, LoaderCircle, MessageSquareText, PackageCheck, PanelLeftClose, Pause, Play, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, Tag, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
import { dryRunEvidence, normalizeAdvancedDetails } from './advanced-details.mjs';
import { runExecutionPresentation, statusPresentation, taskPresentation } from './status-presentation.mjs';
import { ASSET_SCOPES, parseWorkbenchRoute, selectProject, selectRound, selectTask, serializeWorkbenchRoute, updateWorkbenchRoute } from './workbench-route.mjs';
import './styles.css';

const EMPTY = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload?.error?.message || '本地 Studio 请求失败。');
  return payload.data;
}

function uniqueKey(prefix) {
  return prefix + '-' + crypto.randomUUID();
}

const WORKBENCH_CONVERSATION_KEY = 'daoge-pic:workbench-conversation-id';
const ASSET_SCOPE_LABELS = { round: '当前轮次', task: '当前任务', project: '当前项目', studio: '全部 Studio' };

function workbenchConversationId() {
  const stored = window.localStorage.getItem(WORKBENCH_CONVERSATION_KEY);
  if (stored) return stored;
  const value = 'workbench-' + crypto.randomUUID();
  window.localStorage.setItem(WORKBENCH_CONVERSATION_KEY, value);
  return value;
}

function assetPathForRoute(route) {
  const params = new URLSearchParams();
  params.set('scope', route.assetScope);
  if (route.projectId) params.set('projectId', route.projectId);
  if (route.assetScope === 'round') { if (!route.roundId) return null; params.set('roundId', route.roundId); }
  if (route.assetScope === 'task') { if (!route.taskId) return null; params.set('taskId', route.taskId); if (route.projectId) params.set('projectId', route.projectId); }
  if (route.assetScope === 'project') { if (!route.projectId) return null; params.set('projectId', route.projectId); }
  if (route.view === 'trash') params.set('deleted', 'true');
  return '/api/assets?' + params.toString();
}

function statusLabel(value) { return statusPresentation('generic', value).label; }

function StatusPill({ value, scope = 'generic', presentation = null }) {
  const semantics = presentation || statusPresentation(scope, value);
  return <span className={'status-pill ' + semantics.tone}>{semantics.label}</span>;
}

function IconButton({ label, children, onClick, disabled = false, tone = 'default' }) {
  return <button className={'icon-button ' + tone} type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}>{children}</button>;
}

function AssetCard({ asset, view, selected, onToggleSelect, onReview, onTrash, onRestore, onPreview, onInspect }) {
  const [annotating, setAnnotating] = useState(false);
  const [note, setNote] = useState('');
  const saveNote = () => { if (!note.trim()) return; onReview(asset.id, 'review', { note: note.trim() }); setNote(''); setAnnotating(false); };
  return <article className={'asset-card ' + (asset.deletedAt ? 'is-trashed ' : '') + (selected ? 'is-selected' : '')}>
    <div className="asset-preview">
      {asset.deletedAt ? <div className="trash-preview"><Trash2 size={24} strokeWidth={1.4} /></div> : <button type="button" className="asset-preview-button" onClick={() => onPreview([asset])} aria-label="放大查看素材"><img src={'/api/assets/' + encodeURIComponent(asset.id) + '/file'} alt="" loading="lazy" /></button>}
      <div className="asset-overlay">
        {!asset.deletedAt && <><IconButton label="查看来源与评审记录" onClick={() => onInspect(asset.id)}><GitFork size={16} /></IconButton><IconButton label={selected ? '取消选择' : '选择资产'} onClick={() => onToggleSelect(asset.id)}><Bookmark size={16} fill={selected ? 'currentColor' : 'none'} /></IconButton><IconButton label="保留" onClick={() => onReview(asset.id, 'keep')}><Check size={16} /></IconButton><IconButton label="待复核" onClick={() => onReview(asset.id, 'review')}><CircleAlert size={16} /></IconButton><IconButton label="添加批注" onClick={() => setAnnotating((value) => !value)}><MessageSquareText size={16} /></IconButton><IconButton label="标记为衍生方向" onClick={() => onReview(asset.id, 'derive')}><GitFork size={16} /></IconButton><IconButton label="不采用" tone="danger" onClick={() => onReview(asset.id, 'reject')}><X size={16} /></IconButton></>}
        {asset.deletedAt ? <IconButton label="恢复资产" onClick={() => onRestore(asset.id)}><RotateCcw size={16} /></IconButton> : <IconButton label="移入回收站" tone="danger" onClick={() => onTrash(asset.id)}><Trash2 size={16} /></IconButton>}
      </div>
    </div>
    <div className="asset-meta">
      <span>{asset.kind === 'generated' ? '生成结果' : '导入素材'}</span>
      <span className="asset-state">{asset.deletedAt ? '已移入回收站' : asset.review?.decision === 'keep' ? '已保留 · 可交付' : asset.review?.decision === 'review' ? '待复核' : asset.review?.decision === 'reject' ? '不采用' : selected ? '已加入选片' : '尚未评审'}</span>
    </div>
    {annotating && <div className="annotation-editor"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录本轮反馈" /><button type="button" className="outline-button" disabled={!note.trim()} onClick={saveNote}>保存批注</button></div>}
  </article>;
}

class WorkbenchErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  render() {
    if (this.state.failed) return <main className="fatal-error"><CircleAlert size={24} /><div><h1>无法显示工作台</h1><p>详情内容未能安全显示。刷新后可继续使用 Studio。</p></div><button type="button" className="command-button" onClick={() => window.location.reload()}>刷新</button></main>;
    return this.props.children;
  }
}

function App() {
  const [studio, setStudio] = useState(null);
  const [provider, setProvider] = useState(null);
  const [projects, setProjects] = useState(EMPTY);
  const [assets, setAssets] = useState(EMPTY);
  const [taskTypes, setTaskTypes] = useState(EMPTY);
  const [styleKits, setStyleKits] = useState(EMPTY);
  const [brandKits, setBrandKits] = useState(EMPTY);
  const [deliveries, setDeliveries] = useState(EMPTY);
  const [taskOverview, setTaskOverview] = useState(null);
  const [creativeRecord, setCreativeRecord] = useState(null);
  const [assetProvenance, setAssetProvenance] = useState(null);
  const [deliveryBusyId, setDeliveryBusyId] = useState(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState(new Set());
  const [deliveryName, setDeliveryName] = useState('');
  const [assetFilter, setAssetFilter] = useState('all');
  const [previewAssets, setPreviewAssets] = useState([]);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [advancedDetails, setAdvancedDetails] = useState(null);
  const [providerDetails, setProviderDetails] = useState(null);
  const [tasks, setTasks] = useState(EMPTY);
  const [rounds, setRounds] = useState(EMPTY);
  const [runs, setRuns] = useState(EMPTY);
  const [runItems, setRunItems] = useState(EMPTY);
  const [session, setSession] = useState(null);
  const [route, setRoute] = useState(() => parseWorkbenchRoute(window.location.search));
  const [contextError, setContextError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const eventCursor = useRef(Number(sessionStorage.getItem('daoge-pic:event-cursor') || '0') || 0);
  const contextSignature = useRef('');
  const restoredSessionContext = useRef(false);
  const { view, projectId: activeProjectId, taskId: activeTaskId, roundId: activeRoundId, runId: activeRunId, assetScope } = route;

  const navigateRoute = useCallback((changes, replace = false) => {
    const next = updateWorkbenchRoute(route, changes);
    const search = serializeWorkbenchRoute(next);
    window.history[replace ? 'replaceState' : 'pushState']({}, '', window.location.pathname + search);
    setRoute(next);
  }, [route]);

  useEffect(() => {
    const onPopState = () => setRoute(parseWorkbenchRoute(window.location.search));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openWorkbenchSession = useCallback(async () => {
    if (session) return session;
    const nextSession = await api('/api/sessions/open', { method: 'POST', idempotencyKey: uniqueKey('session-open'), body: { conversationId: workbenchConversationId() } });
    setSession(nextSession);
    return nextSession;
  }, [session]);

  const refreshStudio = useCallback(async () => {
    const [studioData, providerData, projectData, taskTypeData, styleKitData, brandKitData] = await Promise.all([
      api('/api/studio'), api('/api/provider/status'), api('/api/projects'), api('/api/task-types'), api('/api/style-kits'), api('/api/brand-kits')
    ]);
    const nextProjects = projectData.projects || [];
    setStudio(studioData);
    setProvider(providerData);
    setProjects(nextProjects);
    setTaskTypes(taskTypeData.taskTypes || []);
    setStyleKits(styleKitData.styleKits || []);
    setBrandKits(brandKitData.brandKits || []);
    return nextProjects;
  }, []);

  const refreshContext = useCallback(async (knownProjects = projects) => {
    const selectedProject = activeProjectId ? knownProjects.find((project) => project.id === activeProjectId) || null : null;
    if (activeProjectId && !selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY); setDeliveries(EMPTY); setAssets(EMPTY); setContextError('该链接所指向的项目已不存在，或不属于当前 Studio。'); return;
    }
    if (!selectedProject) {
      setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY); setDeliveries(EMPTY);
      const path = assetScope === 'studio' ? assetPathForRoute(route) : null;
      setAssets(path ? (await api(path)).assets || [] : EMPTY);
      setContextError(activeTaskId || activeRoundId || activeRunId ? '请先选择一个项目，再继续查看任务、轮次或运行。' : '');
      return;
    }
    const [taskData, deliveryData] = await Promise.all([
      api('/api/projects/' + encodeURIComponent(selectedProject.id) + '/tasks'),
      api('/api/projects/' + encodeURIComponent(selectedProject.id) + '/deliveries')
    ]);
    const nextTasks = taskData.tasks || [];
    setTasks(nextTasks);
    setDeliveries(deliveryData.deliveries || []);
    const selectedTask = activeTaskId ? nextTasks.find((task) => task.id === activeTaskId) || null : null;
    if (activeTaskId && !selectedTask) {
      setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY); setAssets(assetScope === 'project' || assetScope === 'studio' ? (await api(assetPathForRoute(route))).assets || [] : EMPTY); setContextError('该任务不属于当前项目，或已不存在。'); return;
    }
    if (!selectedTask) {
      setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY);
      const path = assetScope === 'project' || assetScope === 'studio' ? assetPathForRoute(route) : null;
      setAssets(path ? (await api(path)).assets || [] : EMPTY);
      setContextError(activeRoundId || activeRunId ? '请先选择一个任务，再继续查看轮次或运行。' : '');
      return;
    }
    const roundData = await api('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/rounds');
    const nextRounds = roundData.rounds || [];
    setRounds(nextRounds);
    const selectedRound = activeRoundId ? nextRounds.find((round) => round.id === activeRoundId) || null : null;
    if (activeRoundId && !selectedRound) {
      setRuns(EMPTY); setRunItems(EMPTY);
      const path = assetScope === 'task' || assetScope === 'project' || assetScope === 'studio' ? assetPathForRoute(route) : null;
      setAssets(path ? (await api(path)).assets || [] : EMPTY); setContextError('该轮次不属于当前任务，或已不存在。'); return;
    }
    if (!selectedRound) {
      setRuns(EMPTY); setRunItems(EMPTY);
      const path = assetScope === 'task' || assetScope === 'project' || assetScope === 'studio' ? assetPathForRoute(route) : null;
      setAssets(path ? (await api(path)).assets || [] : EMPTY);
      setContextError(activeRunId ? '请先选择一个轮次，再继续查看运行。' : '');
      return;
    }
    const runData = await api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/runs');
    const nextRuns = runData.runs || [];
    setRuns(nextRuns);
    const selectedRun = activeRunId ? nextRuns.find((run) => run.id === activeRunId) || null : null;
    if (activeRunId && !selectedRun) {
      setRunItems(EMPTY); setContextError('该运行不属于当前轮次，或已不存在。');
    } else if (selectedRun) {
      const itemData = await api('/api/runs/' + encodeURIComponent(selectedRun.id) + '/items');
      setRunItems(itemData.items || []); setContextError('');
    } else {
      setRunItems(EMPTY); setContextError('');
    }
    const path = assetPathForRoute(route);
    setAssets(path ? (await api(path)).assets || [] : EMPTY);
  }, [activeProjectId, activeTaskId, activeRoundId, activeRunId, assetScope, projects, route]);

  const refresh = useCallback(async () => {
    try {
      setError('');
      await openWorkbenchSession();
      const nextProjects = await refreshStudio();
      await refreshContext(nextProjects);
    } catch (nextError) {
      setError(nextError.message || '无法读取本地 Studio。');
    } finally {
      setLoading(false);
    }
  }, [openWorkbenchSession, refreshStudio, refreshContext]);

  const refreshForEvent = useCallback(async () => {
    await refresh();
  }, [refresh]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const cursor = eventCursor.current;
    const source = new EventSource('/api/events?after=' + cursor);
    const receive = (message) => {
      try {
        const event = JSON.parse(message.data);
        eventCursor.current = Math.max(eventCursor.current, Number(event.id) || 0);
        sessionStorage.setItem('daoge-pic:event-cursor', String(eventCursor.current));
        void refreshForEvent(event);
      } catch { setError('实时更新内容无效，正在等待下一次同步。'); }
    };
    const snapshotRequired = () => { eventCursor.current = 0; sessionStorage.removeItem('daoge-pic:event-cursor'); void refresh(); };
    source.addEventListener('studio-event', receive);
    source.addEventListener('snapshot-required', snapshotRequired);
    source.onerror = () => setError((current) => current || '实时连接暂时中断，正在自动恢复。');
    source.onopen = () => setError('');
    return () => source.close();
  }, [refresh, refreshForEvent]);

  const selectedProject = useMemo(() => activeProjectId ? projects.find((project) => project.id === activeProjectId) || null : null, [projects, activeProjectId]);
  const selectedTask = useMemo(() => activeTaskId ? tasks.find((task) => task.id === activeTaskId) || null : null, [tasks, activeTaskId]);
  const selectedRound = useMemo(() => activeRoundId ? rounds.find((round) => round.id === activeRoundId) || null : null, [rounds, activeRoundId]);
  const activeRun = useMemo(() => activeRunId ? runs.find((run) => run.id === activeRunId) || null : null, [runs, activeRunId]);
  const visibleAssets = (view === 'trash' ? assets.filter((asset) => asset.deletedAt) : assets.filter((asset) => !asset.deletedAt)).filter((asset) => assetFilter === 'all' || asset.kind === assetFilter);
  const selectedAssets = assets.filter((asset) => selectedAssetIds.has(asset.id) && !asset.deletedAt);
  const selectedTaskStatus = taskPresentation(selectedTask, rounds);
  const runExecutionStatus = runExecutionPresentation(activeRun, runItems);
  const runLifecycleStatus = activeRun ? statusPresentation('run', activeRun.status) : null;
  const canCancelActiveRun = Boolean(activeRun && !['completed', 'cancelled'].includes(activeRun.status));
  const uploadTarget = assetScope === 'round' && selectedRound ? { type: 'creative_round', id: selectedRound.id } : assetScope === 'task' && selectedTask ? { type: 'creative_task', id: selectedTask.id } : selectedProject ? { type: 'project', id: selectedProject.id } : null;
  const selectedDeliveryAssets = selectedAssets.filter((asset) => asset.review?.decision === 'keep');
  const hasIneligibleDeliveryAssets = selectedAssets.length !== selectedDeliveryAssets.length;

  useEffect(() => {
    let cancelled = false;
    if (!selectedTask) { setTaskOverview(null); return undefined; }
    void api('/api/tasks/' + encodeURIComponent(selectedTask.id) + '/overview').then((data) => { if (!cancelled) setTaskOverview(data.overview || null); }).catch((nextError) => { if (!cancelled) setError(nextError.message || '无法读取任务创作概览。'); });
    return () => { cancelled = true; };
  }, [selectedTask?.id]);
  useEffect(() => {
    let cancelled = false;
    if (!selectedRound) { setCreativeRecord(null); return undefined; }
    const query = activeRunId ? '?runId=' + encodeURIComponent(activeRunId) : '';
    void api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/creative-record' + query).then((data) => { if (!cancelled) setCreativeRecord(data.record || null); }).catch((nextError) => { if (!cancelled) setError(nextError.message || '无法读取轮次创作记录。'); });
    return () => { cancelled = true; };
  }, [selectedRound?.id, activeRunId]);
  useEffect(() => {
    if (assetProvenance && !assets.some((asset) => asset.id === assetProvenance.asset?.id)) setAssetProvenance(null);
  }, [assets, assetProvenance]);
  useEffect(() => {
    if (!session || restoredSessionContext.current || route.projectId) return;
    restoredSessionContext.current = true;
    if (session.activeProjectId) navigateRoute({ projectId: session.activeProjectId, taskId: session.activeTaskId, roundId: session.activeRoundId, runId: null }, true);
  }, [session, route.projectId, navigateRoute]);

  useEffect(() => {
    if (!session || !selectedProject || (activeTaskId && !selectedTask) || (activeRoundId && !selectedRound)) return;
    const signature = [selectedProject.id, selectedTask?.id || '', selectedRound?.id || ''].join(':');
    if (signature === contextSignature.current) return;
    contextSignature.current = signature;
    void api('/api/sessions/' + encodeURIComponent(session.id) + '/context', { method: 'POST', idempotencyKey: uniqueKey('session-context'), body: { projectId: selectedProject.id, taskId: selectedTask?.id || null, roundId: selectedRound?.id || null } }).then(setSession).catch((nextError) => setError(nextError.message || '无法保存工作上下文。'));
  }, [session, selectedProject, selectedTask, selectedRound, activeTaskId, activeRoundId]);

  const upload = async (files) => {
    const file = files?.[0];
    if (!file) return;
    try {
      setUploading(true); setError('');
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
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法导入图片。'); }
    finally { setUploading(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const review = async (assetId, decision, feedback = {}) => {
    try {
      await api('/api/assets/' + encodeURIComponent(assetId) + '/review', { method: 'POST', idempotencyKey: uniqueKey('review'), body: { decision, taskId: selectedTask?.id, roundId: selectedRound?.id, feedback } });
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法保存选择。'); }
  };
  const trash = async (assetId) => {
    try {
      const { impact } = await api('/api/assets/' + encodeURIComponent(assetId) + '/impact');
      const references = impact.relationCount + impact.reviewCount + impact.deliveryCount;
      const message = references ? '该素材关联 ' + impact.relationCount + ' 个上下文、' + impact.reviewCount + ' 条评审记录，并影响 ' + impact.deliveryCount + ' 个已交付记录。移入回收站不会删除这些事实，仍可恢复。是否继续？' : '素材将移入回收站，之后仍可恢复。是否继续？';
      if (!window.confirm(message)) return;
      await api('/api/assets/' + encodeURIComponent(assetId) + '/trash', { method: 'POST', idempotencyKey: uniqueKey('trash'), body: {} });
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法移入回收站。'); }
  };
  const restore = async (assetId) => { try { await api('/api/assets/' + encodeURIComponent(assetId) + '/restore', { method: 'POST', idempotencyKey: uniqueKey('restore'), body: {} }); await refresh(); } catch (nextError) { setError(nextError.message || '无法恢复资产。'); } };
  const toggleSelection = (assetId) => setSelectedAssetIds((current) => { const next = new Set(current); if (next.has(assetId)) next.delete(assetId); else next.add(assetId); return next; });
  const inspectAsset = async (assetId) => {
    try { const data = await api('/api/assets/' + encodeURIComponent(assetId) + '/provenance'); setAssetProvenance(data.provenance || null); } catch (nextError) { setError(nextError.message || '无法读取素材来源与评审记录。'); }
  };
  const createDeliveryDraft = async () => {
    if (!selectedProject || !selectedAssets.length) { setError('请先选择至少一张已保留资产，再创建交付草稿。'); return; }
    if (hasIneligibleDeliveryAssets) { setError('交付草稿只能包含当前范围内已保留的资产。请先完成评审或取消选择。'); return; }
    try {
      const name = deliveryName.trim() || '交付-' + new Date().toISOString().slice(0, 10);
      await api('/api/deliveries', { method: 'POST', idempotencyKey: uniqueKey('delivery-draft'), body: { projectId: selectedProject.id, name, assetIds: selectedDeliveryAssets.map((asset) => asset.id) } });
      setDeliveryName('');
      setSelectedAssetIds(new Set());
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法创建交付草稿。'); }
  };
  const deliveryAction = async (delivery, action) => {
    setDeliveryBusyId(delivery.id);
    try {
      if (action === 'update') {
        if (!selectedAssets.length || hasIneligibleDeliveryAssets) throw new Error('更新草稿前，请只选择已保留的资产。');
        await api('/api/deliveries/' + encodeURIComponent(delivery.id) + '/items', { method: 'PUT', idempotencyKey: uniqueKey('delivery-update'), body: { assetIds: selectedDeliveryAssets.map((asset) => asset.id) } });
      } else {
        const path = action === 'ready' ? '/ready' : action === 'draft' ? '/draft' : '/export';
        await api('/api/deliveries/' + encodeURIComponent(delivery.id) + path, { method: 'POST', idempotencyKey: uniqueKey('delivery-' + action), body: {} });
      }
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法更新交付状态。'); } finally { setDeliveryBusyId(null); }
  };
  const controlRun = async (operation) => { if (!activeRun) return; try { await api('/api/runs/' + activeRun.id + '/' + operation, { method: 'POST', idempotencyKey: uniqueKey(operation), body: {} }); await refresh(); } catch (nextError) { setError(nextError.message || '无法更新生成运行。'); } };
  const retryRunItem = async (itemId) => {
    if (!activeRun) return;
    try { await api('/api/runs/' + encodeURIComponent(activeRun.id) + '/retry', { method: 'POST', idempotencyKey: uniqueKey('retry-item'), body: { itemIds: [itemId] } }); await refresh(); } catch (nextError) { setError(nextError.message || '无法重试该运行项。'); }
  };
  const archiveCurrentProject = async () => {
    if (!selectedProject || selectedProject.status === 'archived') return;
    if (!window.confirm('归档后将关闭该项目下的任务与轮次。未完成生成必须先暂停或取消。是否继续？')) return;
    try { await api('/api/projects/' + encodeURIComponent(selectedProject.id) + '/archive', { method: 'POST', idempotencyKey: uniqueKey('archive-project'), body: {} }); await refresh(); } catch (nextError) { setError(nextError.message || '无法归档项目。'); }
  };
  const openProviderDetails = async () => {
    try { setProviderDetails(await api('/api/provider/details')); } catch (nextError) { setError(nextError.message || '无法读取生成配置详情。'); }
  };
  const openAdvancedDetails = async () => {
    if (!selectedRound) return;
    try {
      const [plans, dryRuns] = await Promise.all([api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/plan-versions'), api('/api/rounds/' + encodeURIComponent(selectedRound.id) + '/dry-runs')]);
      setAdvancedDetails(normalizeAdvancedDetails({ plans: plans.planVersions, dryRuns: dryRuns.dryRuns }));
    } catch (nextError) { setError(nextError.message || '无法读取高级详情。'); }
  };

  if (loading) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  return <main className="studio-shell" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('image/')); if (file) void upload([file]); }} onPaste={(event) => { const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/')); if (file) { event.preventDefault(); void upload([file]); } }}>
    <aside className="studio-rail">
      <div className="brand-mark"><span>DAOGE</span><b>Pic</b></div>
      <div className="rail-label">工作上下文</div>
      <div className="project-stack">
        {projects.map((project) => <button type="button" key={project.id} onClick={() => navigateRoute(selectProject(route, project.id))} className={'project-switcher ' + (selectedProject?.id === project.id ? 'is-active' : '')}><FolderKanban size={15} /><span>{project.name}</span><StatusPill value={project.status} scope="project" /></button>)}
        {!projects.length && <div className="context-empty">等待会话创建项目</div>}
      </div>
      <div className="context-detail">
        <div className="rail-label">当前任务</div>
        {tasks.map((task) => <button type="button" key={task.id} onClick={() => navigateRoute(selectTask(route, task.id))} className={'context-item ' + (selectedTask?.id === task.id ? 'is-active' : '')}><span>{task.name}</span><StatusPill presentation={task.id === selectedTask?.id ? selectedTaskStatus : taskPresentation(task)} /></button>)}
        {selectedTask && <div className="round-list">{rounds.map((round) => <button type="button" key={round.id} onClick={() => navigateRoute(selectRound(route, round.id))} className={'round-item ' + (selectedRound?.id === round.id ? 'is-active' : '')}><span>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[round.purpose]}{round.parentRoundId ? ' · 衍生轮次' : ''}</span><StatusPill value={round.status} scope="round" /></button>)}</div>}
      </div>
      <div className="rail-bottom"><div className="settings-path"><PanelLeftClose size={16} /><span>{provider?.configured ? '本地 Studio 已连接' : '需要配置生成服务'}</span></div></div>
    </aside>

    <section className="work-surface">
      <header className="surface-header">
        <div className="heading-group"><p className="eyebrow">{selectedProject ? '项目 / ' + selectedProject.name : '本地创作空间'}</p><h1>{view === 'assets' ? '素材与结果' : view === 'runs' ? '生成运行' : view === 'library' ? '创作资料库' : view === 'deliveries' ? '交付准备' : '回收站'}</h1></div>
        <div className="header-actions">
          {provider?.configured ? <span className="connection-state"><span className="signal-dot" />生成配置已就绪</span> : <span className="connection-state is-error"><CloudOff size={14} />生成配置未就绪</span>}
          <IconButton label="查看生成配置详情" onClick={() => void openProviderDetails()}><SlidersHorizontal size={17} /></IconButton>
          {selectedProject && selectedProject.status !== 'archived' && <IconButton label="归档当前项目" onClick={() => void archiveCurrentProject()}><Archive size={17} /></IconButton>}
          <IconButton label="刷新工作台" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
          <input ref={inputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void upload(event.target.files)} />
          <button type="button" className="command-button" onClick={() => inputRef.current?.click()} disabled={uploading}><ImagePlus size={17} />{uploading ? '正在导入' : '导入素材'}</button>
        </div>
      </header>

      <nav className="workbench-breadcrumb" aria-label="当前工作上下文"><span>项目 <b>{selectedProject?.name || '未选择项目'}</b></span><span>任务 <b>{selectedTask?.name || '未选择任务'}</b></span><span>轮次 <b>{selectedRound ? ({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[selectedRound.purpose] : '未选择轮次'}</b></span><span>运行 <b>{activeRun ? '已选择运行' : '未选择运行'}</b></span></nav>
      {contextError && <div className="context-strip"><CircleAlert size={16} /><span>{contextError}</span></div>}
      {error && <div className="error-strip"><CircleAlert size={16} /><span>{error}</span><IconButton label="关闭提示" onClick={() => setError('')}><X size={15} /></IconButton></div>}
      {providerDetails && <section className="provider-details"><div><p className="eyebrow">高级设置</p><h2>生成配置详情</h2></div><div className="provider-details-content"><span>{providerDetails.configured ? '当前配置可用' : '当前配置未就绪'}</span><span>配置文件：<code>{providerDetails.providerEnvPath}</code></span>{providerDetails.providerId && <span>服务：{providerDetails.providerId} · {providerDetails.model}</span>}<span>能力：{providerDetails.capabilities?.edit ? '支持编辑' : '仅生成'}{providerDetails.capabilities?.referenceImage ? ' · 支持参考图' : ''}</span></div><IconButton label="关闭生成配置详情" onClick={() => setProviderDetails(null)}><X size={16} /></IconButton></section>}
      <nav className="view-switcher" aria-label="工作台视图"><button className={view === 'assets' ? 'is-active' : ''} onClick={() => navigateRoute({ view: 'assets' })}><Sparkles size={16} />资产</button><button className={view === 'runs' ? 'is-active' : ''} onClick={() => navigateRoute({ view: 'runs' })}><LoaderCircle size={16} />生成</button><button className={view === 'library' ? 'is-active' : ''} onClick={() => navigateRoute({ view: 'library' })}><Library size={16} />资料库</button><button className={view === 'deliveries' ? 'is-active' : ''} onClick={() => navigateRoute({ view: 'deliveries' })}><PackageCheck size={16} />交付</button><button className={view === 'trash' ? 'is-active' : ''} onClick={() => navigateRoute({ view: 'trash' })}><Trash2 size={16} />回收站</button></nav>

      {view === 'runs' ? <section className="run-stage">
        <div className="run-focus"><div><p className="eyebrow">{selectedRound ? ({ exploration: '探索轮次', refinement: '优化轮次', variation: '变体轮次', edit: '编辑轮次', fill: '补图轮次' })[selectedRound.purpose] : '请先选择轮次'}</p><h2>{activeRun ? '已选择生成运行' : selectedRound ? '请选择生成运行' : '尚未选择轮次'}</h2></div>{activeRun && <StatusPill presentation={runExecutionStatus} />}</div>{selectedRound && <label className="run-history-select"><span>运行历史</span><select value={activeRunId || ''} onChange={(event) => navigateRoute({ runId: event.target.value || null })}><option value="">请选择生成运行</option>{runs.map((run, index) => <option value={run.id} key={run.id}>运行 {runs.length - index} · {statusPresentation('run', run.status).label}</option>)}</select></label>}{taskOverview && <section className="creative-summary"><div><p className="eyebrow">当前任务创作链</p><h3>{taskOverview.task?.name}</h3><span>{taskOverview.summary?.roundCount || 0} 个轮次 · {taskOverview.summary?.runCount || 0} 次运行 · {taskOverview.summary?.resultCount || 0} 个结果</span></div>{creativeRecord && <div className="round-record"><span>第 {creativeRecord.round?.planVersion || 0} 版计划 · {creativeRecord.round?.purpose || '创作'}方向</span><span>{creativeRecord.lineage?.rounds?.length ? '承接 ' + creativeRecord.lineage.rounds.length + ' 个上游轮次' : '首个创作方向'}</span></div>}</section>}
        {activeRun ? <><div className="run-metrics"><div><span>计划产出</span><b>{activeRun.planSnapshot.itemCount}</b></div><div><span>实际执行</span><b>{runExecutionStatus.label}</b></div><div><span>运行状态</span><b>{runLifecycleStatus.label}</b></div></div><div className="run-controls">{['queued', 'running'].includes(activeRun.status) && <button type="button" className="outline-button" onClick={() => void controlRun('pause')}><Pause size={16} />暂停</button>}{['paused'].includes(activeRun.status) && <button type="button" className="command-button" onClick={() => void controlRun('resume')}><Play size={16} />继续</button>}{['partial', 'failed'].includes(activeRun.status) && <button type="button" className="command-button" onClick={() => void controlRun('retry')}><RefreshCw size={16} />重试</button>}{canCancelActiveRun && <button type="button" className="outline-button danger-text" onClick={() => void controlRun('cancel')}><X size={16} />取消运行</button>}</div><section className="run-item-list"><div className="run-item-list-head"><span>运行项</span><small>{runItems.length} 项</small></div>{(creativeRecord?.items || runItems).map((item) => <div className="run-item-row" key={item.id}><span>第 {item.sequence} 项{item.outputAssets?.length ? <span className="run-item-output">{item.outputAssets.map((asset) => <button type="button" key={asset.id} title="查看结果资产来源" onClick={() => void inspectAsset(asset.id)}><img src={'/api/assets/' + encodeURIComponent(asset.id) + '/file'} alt="运行结果" /></button>)}</span> : null}</span><StatusPill value={item.status} scope="run_item" />{['failed', 'blocked', 'retry_wait'].includes(item.status) ? <IconButton label={'重试第 ' + item.sequence + ' 项'} onClick={() => void retryRunItem(item.id)}><RefreshCw size={15} /></IconButton> : item.status === 'outcome_unknown' ? <small className="run-item-warning">需在会话中核实结果</small> : <span />}</div>)}</section><div className="run-advanced-toggle"><IconButton label="查看高级计划与干跑详情" onClick={() => void openAdvancedDetails()}><Eye size={16} /></IconButton><span>高级详情</span></div>{advancedDetails && <section className="advanced-details"><div className="advanced-details-head"><div><p className="eyebrow">仅在需要复核时显示</p><h3>计划与干跑证据</h3></div><IconButton label="关闭高级详情" onClick={() => setAdvancedDetails(null)}><X size={16} /></IconButton></div><div className="advanced-evidence"><div><b>计划版本</b>{advancedDetails.plans.map((plan) => <details key={plan.id || plan.planVersion}><summary>第 {plan.planVersion || '未知'} 版 · {statusLabel(plan.state)}</summary><pre>{JSON.stringify(plan.plan, null, 2)}</pre></details>)}</div><div><b>干跑记录</b>{advancedDetails.dryRuns.map((preview) => <details key={preview.id}><summary>第 {dryRunEvidence(preview).planVersion || '未知'} 版 · {dryRunEvidence(preview).status}{dryRunEvidence(preview).details.itemCount === null ? '' : ' · ' + dryRunEvidence(preview).details.itemCount + ' 项'}</summary><pre>{JSON.stringify(dryRunEvidence(preview).details, null, 2)}</pre></details>)}</div></div></section>}</> : <div className="empty-stage"><Sparkles size={28} strokeWidth={1.2} /><p>在会话中确认创作计划后，生成运行会在这里出现。</p></div>}
      </section> : view === 'library' ? <section className="library-stage">
        <div className="library-column"><div className="library-head"><Tag size={17} /><div><p className="eyebrow">官方任务类型</p><h2>创作语义</h2></div></div><div className="type-grid">{taskTypes.map((type) => <article className="type-item" key={type.id}><b>{type.name}</b><p>{type.definition.summary || '由会话补全创作字段。'}</p><span>{type.source === 'official' ? '官方' : '自定义'}</span></article>)}</div></div>
        <div className="library-column kits-column"><div className="library-head"><Library size={17} /><div><p className="eyebrow">可复用上下文</p><h2>风格与品牌</h2></div></div><div className="kit-list">{styleKits.map((kit) => <article className="kit-item" key={kit.id}><span>风格包</span><b>{kit.name}</b><small>{kit.assetIds.length} 张参考资产</small></article>)}{brandKits.map((kit) => <article className="kit-item" key={kit.id}><span>品牌包</span><b>{kit.name}</b><small>{kit.assetIds.length} 张参考资产</small></article>)}{!styleKits.length && !brandKits.length && <div className="kit-empty">在会话中建立风格包或品牌包后，它们会显示在这里。</div>}</div></div>
      </section> : view === 'deliveries' ? <section className="delivery-stage">
        <div className="delivery-compose"><div><p className="eyebrow">{selectedProject ? selectedProject.name : '需要先在会话中建立项目'}</p><h2>{selectedDeliveryAssets.length.toString().padStart(2, '0')} 张已保留资产待建草稿</h2><small>{hasIneligibleDeliveryAssets ? '当前选片含未保留资产，不能进入交付草稿。' : '草稿会冻结来源与当前评审，准备完成后才可导出。'}</small></div><div className="delivery-controls"><input aria-label="交付名称" value={deliveryName} onChange={(event) => setDeliveryName(event.target.value)} placeholder="交付名称" /><button type="button" className="command-button" disabled={!selectedDeliveryAssets.length || !selectedProject || hasIneligibleDeliveryAssets} onClick={() => void createDeliveryDraft()}><PackageCheck size={16} />创建草稿</button></div></div>
        <div className="delivery-selection">{selectedAssets.length ? selectedAssets.map((asset, index) => <div className="selected-asset" key={asset.id}><img src={'/api/assets/' + encodeURIComponent(asset.id) + '/file'} alt="" /><span>素材 {index + 1} · {asset.review?.decision === 'keep' ? '已保留' : '未满足准入'}</span><IconButton label="移出交付" onClick={() => toggleSelection(asset.id)}><X size={15} /></IconButton></div>) : <div className="empty-stage"><PackageCheck size={28} strokeWidth={1.2} /><p>在资产视图选择已保留的图片后，在这里创建可审阅的交付草稿。</p></div>}</div>
        {deliveries.length > 0 && <div className="delivery-history"><p className="eyebrow">交付草稿与导出记录</p>{deliveries.map((delivery) => <article key={delivery.id}><div><b>{delivery.name}</b><span>{delivery.items?.length || 0} 张冻结资产 · {delivery.items?.every((item) => item.review?.decision === 'keep') ? '保留评审已冻结' : '历史评审快照'}</span></div><StatusPill value={delivery.status} />{delivery.status === 'draft' ? <div className="delivery-row-actions"><button type="button" className="outline-button" disabled={!selectedDeliveryAssets.length || hasIneligibleDeliveryAssets || deliveryBusyId === delivery.id} onClick={() => void deliveryAction(delivery, 'update')}>更新选片</button><button type="button" className="command-button" disabled={deliveryBusyId === delivery.id} onClick={() => void deliveryAction(delivery, 'ready')}>准备交付</button></div> : delivery.status === 'ready' ? <div className="delivery-row-actions"><button type="button" className="outline-button" disabled={deliveryBusyId === delivery.id} onClick={() => void deliveryAction(delivery, 'draft')}>退回草稿</button><button type="button" className="command-button" disabled={deliveryBusyId === delivery.id} onClick={() => void deliveryAction(delivery, 'export')}>导出文件</button></div> : <span>已导出，内容以冻结快照为准</span>}</article>)}</div>}
      </section> : <section className="asset-stage">
        <div className="asset-scope-control" aria-label="资产范围"><span>资产范围</span>{ASSET_SCOPES.map((scope) => <button type="button" key={scope} className={assetScope === scope ? 'is-active' : ''} disabled={(scope === 'round' && !selectedRound) || (scope === 'task' && !selectedTask) || (scope === 'project' && !selectedProject)} onClick={() => navigateRoute({ assetScope: scope })}>{ASSET_SCOPE_LABELS[scope]}</button>)}</div>
        <div className="asset-stage-head"><div><span className="asset-count">{visibleAssets.length.toString().padStart(2, '0')}</span><span className="asset-count-label">{view === 'trash' ? '已移入回收站' : '张可用资产'}</span></div><div className="asset-stage-tools"><div className="asset-filter" aria-label="素材筛选"><SlidersHorizontal size={14} />{[['all', '全部'], ['generated', '生成'], ['import', '导入']].map(([value, label]) => <button type="button" key={value} className={assetFilter === value ? 'is-active' : ''} onClick={() => setAssetFilter(value)}>{label}</button>)}</div>{selectedAssets.length === 2 && <IconButton label="对比两张已选素材" onClick={() => { setPreviewZoom(1); setPreviewAssets(selectedAssets); }}><Eye size={16} /></IconButton>}<div className="asset-hint">{selectedAssetIds.size ? selectedAssetIds.size + ' 张已选择' : ASSET_SCOPE_LABELS[assetScope] + '资产'}</div></div></div>
        {visibleAssets.length ? <div className="asset-grid">{visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} view={view} selected={selectedAssetIds.has(asset.id)} onToggleSelect={toggleSelection} onReview={review} onTrash={trash} onRestore={restore} onInspect={inspectAsset} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />)}</div> : <div className="empty-stage asset-empty">{view === 'trash' ? <Archive size={30} strokeWidth={1.15} /> : <Inbox size={30} strokeWidth={1.15} />}<p>{view === 'trash' ? '当前范围内的回收站为空' : (assetScope === 'round' && !selectedRound ? '请先从左侧选择轮次，再查看本轮结果。' : '当前范围内暂未找到资产。')}</p>{view === 'assets' && <button type="button" className="outline-button" onClick={() => inputRef.current?.click()}><Upload size={16} />导入图片</button>}</div>}
      </section>}
    </section>
    {assetProvenance && <aside className="asset-inspector" aria-label="资产来源与评审记录"><div className="asset-inspector-head"><div><p className="eyebrow">资产检查器</p><h2>{assetProvenance.asset?.kind === 'generated' ? '生成结果来源链' : '导入素材来源链'}</h2></div><IconButton label="关闭资产检查器" onClick={() => setAssetProvenance(null)}><X size={16} /></IconButton></div><div className="asset-inspector-section"><span>来源</span><p>{assetProvenance.asset?.kind === 'generated' ? '由已确认轮次中的运行项保存' : '导入到当前 Studio 的素材'}</p>{assetProvenance.outputs?.map((output) => <button type="button" key={output.runItem.id} className="trace-link" onClick={() => { navigateRoute({ view: 'runs', projectId: output.project.id, taskId: output.task.id, roundId: output.round.id, runId: output.run.id }); setAssetProvenance(null); }}><span>{output.project.name} / {output.task.name}</span><b>{output.round.purpose} · 运行项 {output.runItem.sequence}</b></button>)}</div><div className="asset-inspector-section"><span>评审历史</span>{assetProvenance.reviews?.length ? assetProvenance.reviews.map((review) => <p key={review.id}><b>{review.decision === 'keep' ? '保留' : review.decision === 'review' ? '待复核' : review.decision === 'reject' ? '不采用' : '衍生方向'}</b> · {review.createdAt}</p>) : <p>尚未记录评审。</p>}</div><div className="asset-inspector-section"><span>交付引用</span>{assetProvenance.deliveries?.length ? assetProvenance.deliveries.map((delivery) => <p key={delivery.id}>{delivery.name} · {delivery.status}</p>) : <p>尚未加入交付草稿。</p>}</div></aside>}
    {previewAssets.length > 0 && <div className="image-inspector" role="dialog" aria-modal="true" aria-label={previewAssets.length === 2 ? '双图对比' : '素材放大查看'}><div className="inspector-toolbar"><span>{previewAssets.length === 2 ? '双图对比' : '素材查看'}</span><div><IconButton label="缩小" disabled={previewZoom <= 0.75} onClick={() => setPreviewZoom((value) => Math.max(0.75, value - 0.25))}><ZoomOut size={16} /></IconButton><IconButton label="放大" disabled={previewZoom >= 2} onClick={() => setPreviewZoom((value) => Math.min(2, value + 0.25))}><ZoomIn size={16} /></IconButton><IconButton label="关闭查看" onClick={() => setPreviewAssets([])}><X size={16} /></IconButton></div></div><div className={'inspector-images ' + (previewAssets.length === 2 ? 'is-compare' : '')}>{previewAssets.map((asset, index) => <figure key={asset.id}><img src={'/api/assets/' + encodeURIComponent(asset.id) + '/file'} alt="" style={{ transform: 'scale(' + previewZoom + ')' }} /><figcaption>{previewAssets.length === 2 ? '对比图 ' + (index + 1) : '素材预览'}</figcaption></figure>)}</div></div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<WorkbenchErrorBoundary><App /></WorkbenchErrorBoundary>);
