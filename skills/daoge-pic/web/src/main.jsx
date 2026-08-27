import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, Bookmark, Check, CircleAlert, CloudOff, Eye, FolderKanban, GitFork, ImagePlus, Inbox, Library, LoaderCircle, MessageSquareText, PackageCheck, PanelLeftClose, Pause, Play, RefreshCw, RotateCcw, SlidersHorizontal, Sparkles, Tag, Trash2, Upload, X, ZoomIn, ZoomOut } from 'lucide-react';
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

function statusLabel(value) { return ({ draft: '草稿', awaiting_confirmation: '待确认', active: '进行中', queued: '排队中', running: '生成中', pausing: '暂停中', paused: '已暂停', resume_pending: '待继续', partial: '部分完成', completed: '已完成', failed: '失败', cancelled: '已取消', keep: '保留', review: '待复核', reject: '不采用', derive: '衍生' })[value] || value; }
function runExecutionLabel(value) { return value === 'resume_pending' ? '等待会话确认' : statusLabel(value); }

function StatusPill({ value }) {
  const tone = value === 'completed' || value === 'keep' || value === 'active' ? 'ready' : value === 'running' || value === 'queued' ? 'live' : value === 'failed' || value === 'reject' ? 'danger' : 'quiet';
  const labels = { draft: '草稿', awaiting_confirmation: '待确认', active: '进行中', queued: '排队中', running: '生成中', pausing: '暂停中', paused: '已暂停', resume_pending: '待继续', partial: '部分完成', completed: '已完成', failed: '失败', cancelled: '已取消', keep: '保留', review: '待复核', reject: '不采用', derive: '衍生' };
  return <span className={'status-pill ' + tone}>{labels[value] || value}</span>;
}

function IconButton({ label, children, onClick, disabled = false, tone = 'default' }) {
  return <button className={'icon-button ' + tone} type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}>{children}</button>;
}

function AssetCard({ asset, view, selected, onToggleSelect, onReview, onTrash, onRestore, onPreview }) {
  const [annotating, setAnnotating] = useState(false);
  const [note, setNote] = useState('');
  const saveNote = () => { if (!note.trim()) return; onReview(asset.id, 'review', { note: note.trim() }); setNote(''); setAnnotating(false); };
  return <article className={'asset-card ' + (asset.deletedAt ? 'is-trashed ' : '') + (selected ? 'is-selected' : '')}>
    <div className="asset-preview">
      {asset.deletedAt ? <div className="trash-preview"><Trash2 size={24} strokeWidth={1.4} /></div> : <button type="button" className="asset-preview-button" onClick={() => onPreview([asset])} aria-label="放大查看素材"><img src={'/api/assets/' + encodeURIComponent(asset.id) + '/file'} alt="" loading="lazy" /></button>}
      <div className="asset-overlay">
        {!asset.deletedAt && <><IconButton label={selected ? '取消选择' : '选择资产'} onClick={() => onToggleSelect(asset.id)}><Bookmark size={16} fill={selected ? 'currentColor' : 'none'} /></IconButton><IconButton label="保留" onClick={() => onReview(asset.id, 'keep')}><Check size={16} /></IconButton><IconButton label="待复核" onClick={() => onReview(asset.id, 'review')}><CircleAlert size={16} /></IconButton><IconButton label="添加批注" onClick={() => setAnnotating((value) => !value)}><MessageSquareText size={16} /></IconButton><IconButton label="标记为衍生方向" onClick={() => onReview(asset.id, 'derive')}><GitFork size={16} /></IconButton><IconButton label="不采用" tone="danger" onClick={() => onReview(asset.id, 'reject')}><X size={16} /></IconButton></>}
        {asset.deletedAt ? <IconButton label="恢复资产" onClick={() => onRestore(asset.id)}><RotateCcw size={16} /></IconButton> : <IconButton label="移入回收站" tone="danger" onClick={() => onTrash(asset.id)}><Trash2 size={16} /></IconButton>}
      </div>
    </div>
    <div className="asset-meta">
      <span>{asset.kind === 'generated' ? '生成结果' : '导入素材'}</span>
      <span className="asset-state">{asset.deletedAt ? '已移入回收站' : selected ? '已加入选片' : '可用于创作'}</span>
    </div>
    {annotating && <div className="annotation-editor"><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录本轮反馈" /><button type="button" className="outline-button" disabled={!note.trim()} onClick={saveNote}>保存批注</button></div>}
  </article>;
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
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);
  const [activeRoundId, setActiveRoundId] = useState(null);
  const [view, setView] = useState(() => new URLSearchParams(window.location.search).get('view') || 'assets');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef(null);
  const eventCursor = useRef(Number(sessionStorage.getItem('daoge-pic:event-cursor') || '0') || 0);

  const refreshStudio = useCallback(async () => {
    const [studioData, providerData, projectData, assetData, taskTypeData, styleKitData, brandKitData] = await Promise.all([
      api('/api/studio'), api('/api/provider/status'), api('/api/projects'), api('/api/assets' + (view === 'trash' ? '?deleted=true' : '')), api('/api/task-types'), api('/api/style-kits'), api('/api/brand-kits')
    ]);
    setStudio(studioData);
    setProvider(providerData);
    setProjects(projectData.projects || []);
    setAssets(assetData.assets || []);
    setTaskTypes(taskTypeData.taskTypes || []);
    setStyleKits(styleKitData.styleKits || []);
    setBrandKits(brandKitData.brandKits || []);
  }, [view]);

  const refreshContext = useCallback(async () => {
    if (!activeProjectId) { setTasks(EMPTY); setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY); setDeliveries(EMPTY); return; }
    const [taskData, deliveryData] = await Promise.all([
      api('/api/projects/' + encodeURIComponent(activeProjectId) + '/tasks'),
      api('/api/projects/' + encodeURIComponent(activeProjectId) + '/deliveries')
    ]);
    setDeliveries(deliveryData.deliveries || []);
    const nextTasks = taskData.tasks || [];
    setTasks(nextTasks);
    const taskId = nextTasks.some((task) => task.id === activeTaskId) ? activeTaskId : nextTasks[0]?.id || null;
    if (taskId !== activeTaskId) setActiveTaskId(taskId);
    if (!taskId) { setRounds(EMPTY); setRuns(EMPTY); setRunItems(EMPTY); return; }
    const roundData = await api('/api/tasks/' + encodeURIComponent(taskId) + '/rounds');
    const nextRounds = roundData.rounds || [];
    setRounds(nextRounds);
    const roundId = nextRounds.some((round) => round.id === activeRoundId) ? activeRoundId : nextRounds[0]?.id || null;
    if (roundId !== activeRoundId) setActiveRoundId(roundId);
    if (!roundId) { setRuns(EMPTY); setRunItems(EMPTY); return; }
    const runData = await api('/api/rounds/' + encodeURIComponent(roundId) + '/runs');
    const nextRuns = runData.runs || [];
    setRuns(nextRuns);
    const nextRun = nextRuns.find((run) => ['queued', 'running', 'pausing', 'paused', 'resume_pending'].includes(run.status)) || nextRuns[0];
    if (!nextRun) { setRunItems(EMPTY); return; }
    const itemData = await api('/api/runs/' + encodeURIComponent(nextRun.id) + '/items');
    setRunItems(itemData.items || []);
  }, [activeProjectId, activeTaskId, activeRoundId]);

  const refresh = useCallback(async () => {
    try {
      setError('');
      await refreshStudio();
      await refreshContext();
    } catch (nextError) {
      setError(nextError.message || '无法读取本地 Studio。');
    } finally {
      setLoading(false);
    }
  }, [refreshStudio, refreshContext]);

  const refreshForEvent = useCallback(async (event) => {
    const eventType = String(event?.eventType || '');
    const entityType = String(event?.entityType || '');
    if (entityType === 'project' || eventType.startsWith('project.')) {
      const projectData = await api('/api/projects');
      setProjects(projectData.projects || []);
      if (activeProjectId) await refreshContext();
      return;
    }
    if (entityType === 'creative_task' || eventType.startsWith('task.')) {
      if (activeProjectId) {
        const taskData = await api('/api/projects/' + encodeURIComponent(activeProjectId) + '/tasks');
        setTasks(taskData.tasks || []);
      }
      return;
    }
    if (entityType === 'creative_round' || eventType.startsWith('round.')) {
      if (activeTaskId) {
        const roundData = await api('/api/tasks/' + encodeURIComponent(activeTaskId) + '/rounds');
        setRounds(roundData.rounds || []);
      }
      return;
    }
    if (entityType === 'generation_run' || entityType === 'run_item' || eventType.startsWith('run.')) {
      if (activeRoundId) {
        const runData = await api('/api/rounds/' + encodeURIComponent(activeRoundId) + '/runs');
        const nextRuns = runData.runs || [];
        setRuns(nextRuns);
        const nextRun = nextRuns.find((run) => ['queued', 'running', 'pausing', 'paused', 'resume_pending'].includes(run.status)) || nextRuns[0];
        if (nextRun) { const itemData = await api('/api/runs/' + encodeURIComponent(nextRun.id) + '/items'); setRunItems(itemData.items || []); }
        else setRunItems(EMPTY);
      }
      return;
    }
    if (entityType === 'asset' || eventType.startsWith('asset.') || entityType === 'review_decision') {
      const assetData = await api('/api/assets' + (view === 'trash' ? '?deleted=true' : ''));
      setAssets(assetData.assets || []);
      return;
    }
    if (entityType === 'delivery' || eventType.startsWith('delivery.')) {
      if (activeProjectId) {
        const deliveryData = await api('/api/projects/' + encodeURIComponent(activeProjectId) + '/deliveries');
        setDeliveries(deliveryData.deliveries || []);
      }
      return;
    }
    if (entityType === 'style_kit' || entityType === 'brand_kit' || entityType === 'task_type') {
      const [taskTypeData, styleKitData, brandKitData] = await Promise.all([api('/api/task-types'), api('/api/style-kits'), api('/api/brand-kits')]);
      setTaskTypes(taskTypeData.taskTypes || []);
      setStyleKits(styleKitData.styleKits || []);
      setBrandKits(brandKitData.brandKits || []);
      return;
    }
    if (entityType === 'daemon') setProvider(await api('/api/provider/status'));
  }, [activeProjectId, activeTaskId, activeRoundId, refreshContext, view]);

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

  const selectedProject = useMemo(() => projects.find((project) => project.id === activeProjectId) || projects[0] || null, [projects, activeProjectId]);
  const selectedTask = useMemo(() => tasks.find((task) => task.id === activeTaskId) || tasks[0] || null, [tasks, activeTaskId]);
  const selectedRound = useMemo(() => rounds.find((round) => round.id === activeRoundId) || rounds[0] || null, [rounds, activeRoundId]);
  const visibleAssets = (view === 'trash' ? assets.filter((asset) => asset.deletedAt) : assets.filter((asset) => !asset.deletedAt)).filter((asset) => assetFilter === 'all' || asset.kind === assetFilter);
  const selectedAssets = assets.filter((asset) => selectedAssetIds.has(asset.id) && !asset.deletedAt);
  const activeRun = runs.find((run) => ['queued', 'running', 'pausing', 'paused', 'resume_pending'].includes(run.status)) || runs[0] || null;
  const canCancelActiveRun = Boolean(activeRun && !['completed', 'cancelled'].includes(activeRun.status));

  useEffect(() => {
    if (!activeProjectId && projects[0]) setActiveProjectId(projects[0].id);
  }, [projects, activeProjectId]);

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
          ...(selectedProject ? { 'x-daoge-target-type': 'project', 'x-daoge-target-id': selectedProject.id } : {})
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
  const exportSelected = async () => {
    if (!selectedProject || !selectedAssets.length) { setError('请先选择至少一张可用资产，再准备交付。'); return; }
    try {
      const name = deliveryName.trim() || '交付-' + new Date().toISOString().slice(0, 10);
      const created = await api('/api/deliveries', { method: 'POST', idempotencyKey: uniqueKey('delivery'), body: { projectId: selectedProject.id, name, assetIds: selectedAssets.map((asset) => asset.id) } });
      await api('/api/deliveries/' + encodeURIComponent(created.id) + '/export', { method: 'POST', idempotencyKey: uniqueKey('export'), body: {} });
      setDeliveryName('');
      setSelectedAssetIds(new Set());
      await refresh();
    } catch (nextError) { setError(nextError.message || '无法导出交付。'); }
  };
  const controlRun = async (operation) => { if (!activeRun) return; try { await api('/api/runs/' + activeRun.id + '/' + operation, { method: 'POST', idempotencyKey: uniqueKey(operation), body: {} }); await refresh(); } catch (nextError) { setError(nextError.message || '无法更新生成会话。'); } };
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
      setAdvancedDetails({ plans: plans.planVersions || [], dryRuns: dryRuns.dryRuns || [] });
    } catch (nextError) { setError(nextError.message || '无法读取高级详情。'); }
  };

  if (loading) return <div className="loading-shell"><LoaderCircle size={22} className="spin" /><span>正在连接 Studio</span></div>;
  return <main className="studio-shell" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith('image/')); if (file) void upload([file]); }} onPaste={(event) => { const file = [...event.clipboardData.files].find((item) => item.type.startsWith('image/')); if (file) { event.preventDefault(); void upload([file]); } }}>
    <aside className="studio-rail">
      <div className="brand-mark"><span>DAOGE</span><b>Pic</b></div>
      <div className="rail-label">工作上下文</div>
      <div className="project-stack">
        {projects.map((project) => <button type="button" key={project.id} onClick={() => { setActiveProjectId(project.id); setActiveTaskId(null); setActiveRoundId(null); }} className={'project-switcher ' + (selectedProject?.id === project.id ? 'is-active' : '')}><FolderKanban size={15} /><span>{project.name}</span></button>)}
        {!projects.length && <div className="context-empty">等待会话创建项目</div>}
      </div>
      <div className="context-detail">
        <div className="rail-label">当前任务</div>
        {tasks.map((task) => <button type="button" key={task.id} onClick={() => { setActiveTaskId(task.id); setActiveRoundId(null); }} className={'context-item ' + (selectedTask?.id === task.id ? 'is-active' : '')}><span>{task.name}</span><StatusPill value={task.status} /></button>)}
        {selectedTask && <div className="round-list">{rounds.map((round) => <button type="button" key={round.id} onClick={() => setActiveRoundId(round.id)} className={'round-item ' + (selectedRound?.id === round.id ? 'is-active' : '')}><span>{({ exploration: '探索', refinement: '优化', variation: '变体', edit: '编辑', fill: '补图' })[round.purpose]}</span><StatusPill value={round.status} /></button>)}</div>}
      </div>
      <div className="rail-bottom"><div className="settings-path"><PanelLeftClose size={16} /><span>{provider?.configured ? '本地 Studio 已连接' : '需要配置生成服务'}</span></div></div>
    </aside>

    <section className="work-surface">
      <header className="surface-header">
        <div className="heading-group"><p className="eyebrow">{selectedProject ? '项目 / ' + selectedProject.name : '本地创作空间'}</p><h1>{view === 'assets' ? '素材与结果' : view === 'runs' ? '生成会话' : view === 'library' ? '创作资料库' : view === 'deliveries' ? '交付准备' : '回收站'}</h1></div>
        <div className="header-actions">
          {provider?.configured ? <span className="connection-state"><span className="signal-dot" />生成配置已就绪</span> : <span className="connection-state is-error"><CloudOff size={14} />生成配置未就绪</span>}
          <IconButton label="查看生成配置详情" onClick={() => void openProviderDetails()}><SlidersHorizontal size={17} /></IconButton>
          {selectedProject && selectedProject.status !== 'archived' && <IconButton label="归档当前项目" onClick={() => void archiveCurrentProject()}><Archive size={17} /></IconButton>}
          <IconButton label="刷新工作台" onClick={() => void refresh()}><RefreshCw size={17} /></IconButton>
          <input ref={inputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => void upload(event.target.files)} />
          <button type="button" className="command-button" onClick={() => inputRef.current?.click()} disabled={uploading}><ImagePlus size={17} />{uploading ? '正在导入' : '导入素材'}</button>
        </div>
      </header>

      {error && <div className="error-strip"><CircleAlert size={16} /><span>{error}</span><IconButton label="关闭提示" onClick={() => setError('')}><X size={15} /></IconButton></div>}
      {providerDetails && <section className="provider-details"><div><p className="eyebrow">高级设置</p><h2>生成配置详情</h2></div><div className="provider-details-content"><span>{providerDetails.configured ? '当前配置可用' : '当前配置未就绪'}</span><span>配置文件：<code>{providerDetails.providerEnvPath}</code></span>{providerDetails.providerId && <span>服务：{providerDetails.providerId} · {providerDetails.model}</span>}<span>能力：{providerDetails.capabilities?.edit ? '支持编辑' : '仅生成'}{providerDetails.capabilities?.referenceImage ? ' · 支持参考图' : ''}</span></div><IconButton label="关闭生成配置详情" onClick={() => setProviderDetails(null)}><X size={16} /></IconButton></section>}
      <nav className="view-switcher" aria-label="工作台视图"><button className={view === 'assets' ? 'is-active' : ''} onClick={() => setView('assets')}><Sparkles size={16} />资产</button><button className={view === 'runs' ? 'is-active' : ''} onClick={() => setView('runs')}><LoaderCircle size={16} />生成</button><button className={view === 'library' ? 'is-active' : ''} onClick={() => setView('library')}><Library size={16} />资料库</button><button className={view === 'deliveries' ? 'is-active' : ''} onClick={() => setView('deliveries')}><PackageCheck size={16} />交付</button><button className={view === 'trash' ? 'is-active' : ''} onClick={() => setView('trash')}><Trash2 size={16} />回收站</button></nav>

      {view === 'runs' ? <section className="run-stage">
        <div className="run-focus"><div><p className="eyebrow">{selectedRound ? ({ exploration: '探索轮次', refinement: '优化轮次', variation: '变体轮次', edit: '编辑轮次', fill: '补图轮次' })[selectedRound.purpose] : '等待会话确认轮次'}</p><h2>{activeRun ? '当前生成会话' : '尚无生成会话'}</h2></div>{activeRun && <StatusPill value={activeRun.status} />}</div>
        {activeRun ? <><div className="run-metrics"><div><span>计划产出</span><b>{activeRun.planSnapshot.itemCount}</b></div><div><span>执行状态</span><b>{runExecutionLabel(activeRun.status)}</b></div><div><span>当前进度</span><b>{statusLabel(activeRun.status)}</b></div></div><div className="run-controls">{['queued', 'running'].includes(activeRun.status) && <button type="button" className="outline-button" onClick={() => void controlRun('pause')}><Pause size={16} />暂停</button>}{['paused'].includes(activeRun.status) && <button type="button" className="command-button" onClick={() => void controlRun('resume')}><Play size={16} />继续</button>}{['partial', 'failed'].includes(activeRun.status) && <button type="button" className="command-button" onClick={() => void controlRun('retry')}><RefreshCw size={16} />重试</button>}{canCancelActiveRun && <button type="button" className="outline-button danger-text" onClick={() => void controlRun('cancel')}><X size={16} />取消会话</button>}</div><section className="run-item-list"><div className="run-item-list-head"><span>运行项</span><small>{runItems.length} 项</small></div>{runItems.map((item) => <div className="run-item-row" key={item.id}><span>第 {item.sequence} 项</span><StatusPill value={item.status} />{['failed', 'blocked', 'retry_wait'].includes(item.status) ? <IconButton label={'重试第 ' + item.sequence + ' 项'} onClick={() => void retryRunItem(item.id)}><RefreshCw size={15} /></IconButton> : item.status === 'outcome_unknown' ? <small className="run-item-warning">需在会话中核实结果</small> : <span />}</div>)}</section><div className="run-advanced-toggle"><IconButton label="查看高级计划与干跑详情" onClick={() => void openAdvancedDetails()}><Eye size={16} /></IconButton><span>高级详情</span></div>{advancedDetails && <section className="advanced-details"><div className="advanced-details-head"><div><p className="eyebrow">仅在需要复核时显示</p><h3>计划与干跑证据</h3></div><IconButton label="关闭高级详情" onClick={() => setAdvancedDetails(null)}><X size={16} /></IconButton></div><div className="advanced-evidence"><div><b>计划版本</b>{advancedDetails.plans.map((plan) => <details key={plan.version}><summary>第 {plan.version} 版 · {statusLabel(plan.state)}</summary><pre>{JSON.stringify(plan.plan, null, 2)}</pre></details>)}</div><div><b>干跑记录</b>{advancedDetails.dryRuns.map((preview) => <details key={preview.id}><summary>可执行性：{preview.preflight.valid ? '通过' : '需要修正'}</summary><pre>{JSON.stringify(preview.preflight, null, 2)}</pre></details>)}</div></div></section>}</> : <div className="empty-stage"><Sparkles size={28} strokeWidth={1.2} /><p>在会话中确认创作计划后，生成会话会在这里出现。</p></div>}
      </section> : view === 'library' ? <section className="library-stage">
        <div className="library-column"><div className="library-head"><Tag size={17} /><div><p className="eyebrow">官方任务类型</p><h2>创作语义</h2></div></div><div className="type-grid">{taskTypes.map((type) => <article className="type-item" key={type.id}><b>{type.name}</b><p>{type.definition.summary || '由会话补全创作字段。'}</p><span>{type.source === 'official' ? '官方' : '自定义'}</span></article>)}</div></div>
        <div className="library-column kits-column"><div className="library-head"><Library size={17} /><div><p className="eyebrow">可复用上下文</p><h2>风格与品牌</h2></div></div><div className="kit-list">{styleKits.map((kit) => <article className="kit-item" key={kit.id}><span>风格包</span><b>{kit.name}</b><small>{kit.assetIds.length} 张参考资产</small></article>)}{brandKits.map((kit) => <article className="kit-item" key={kit.id}><span>品牌包</span><b>{kit.name}</b><small>{kit.assetIds.length} 张参考资产</small></article>)}{!styleKits.length && !brandKits.length && <div className="kit-empty">在会话中建立风格包或品牌包后，它们会显示在这里。</div>}</div></div>
      </section> : view === 'deliveries' ? <section className="delivery-stage">
        <div className="delivery-compose"><div><p className="eyebrow">{selectedProject ? selectedProject.name : '需要先在会话中建立项目'}</p><h2>{selectedAssets.length.toString().padStart(2, '0')} 张资产待交付</h2></div><div className="delivery-controls"><input aria-label="交付名称" value={deliveryName} onChange={(event) => setDeliveryName(event.target.value)} placeholder="交付名称" /><button type="button" className="command-button" disabled={!selectedAssets.length || !selectedProject} onClick={() => void exportSelected()}><PackageCheck size={16} />导出交付</button></div></div>
        <div className="delivery-selection">{selectedAssets.length ? selectedAssets.map((asset, index) => <div className="selected-asset" key={asset.id}><img src={'/api/assets/' + encodeURIComponent(asset.id) + '/file'} alt="" /><span>素材 {index + 1}</span><IconButton label="移出交付" onClick={() => toggleSelection(asset.id)}><X size={15} /></IconButton></div>) : <div className="empty-stage"><PackageCheck size={28} strokeWidth={1.2} /><p>在资产视图选择图片后，可以在这里生成交付包。</p></div>}</div>
        {deliveries.length > 0 && <div className="delivery-history"><p className="eyebrow">已准备的交付</p>{deliveries.map((delivery) => <article key={delivery.id}><b>{delivery.name}</b><StatusPill value={delivery.status} /><span>{Array.isArray(delivery.manifest.assetIds) ? delivery.manifest.assetIds.length : 0} 张资产</span></article>)}</div>}
      </section> : <section className="asset-stage">
        <div className="asset-stage-head"><div><span className="asset-count">{visibleAssets.length.toString().padStart(2, '0')}</span><span className="asset-count-label">{view === 'trash' ? '已移入回收站' : '张可用资产'}</span></div><div className="asset-stage-tools"><div className="asset-filter" aria-label="素材筛选"><SlidersHorizontal size={14} />{[['all', '全部'], ['generated', '生成'], ['import', '导入']].map(([value, label]) => <button type="button" key={value} className={assetFilter === value ? 'is-active' : ''} onClick={() => setAssetFilter(value)}>{label}</button>)}</div>{selectedAssets.length === 2 && <IconButton label="对比两张已选素材" onClick={() => { setPreviewZoom(1); setPreviewAssets(selectedAssets); }}><Eye size={16} /></IconButton>}<div className="asset-hint">{selectedAssetIds.size ? selectedAssetIds.size + ' 张已选择' : (selectedProject ? selectedProject.name : 'Studio 全局资产')}</div></div></div>
        {visibleAssets.length ? <div className="asset-grid">{visibleAssets.map((asset) => <AssetCard key={asset.id} asset={asset} view={view} selected={selectedAssetIds.has(asset.id)} onToggleSelect={toggleSelection} onReview={review} onTrash={trash} onRestore={restore} onPreview={(nextAssets) => { setPreviewZoom(1); setPreviewAssets(nextAssets); }} />)}</div> : <div className="empty-stage asset-empty">{view === 'trash' ? <Archive size={30} strokeWidth={1.15} /> : <Inbox size={30} strokeWidth={1.15} />}<p>{view === 'trash' ? '回收站为空' : '从会话开始创作，或在这里放入参考素材。'}</p>{view === 'assets' && <button type="button" className="outline-button" onClick={() => inputRef.current?.click()}><Upload size={16} />导入图片</button>}</div>}
      </section>}
    </section>
    {previewAssets.length > 0 && <div className="image-inspector" role="dialog" aria-modal="true" aria-label={previewAssets.length === 2 ? '双图对比' : '素材放大查看'}><div className="inspector-toolbar"><span>{previewAssets.length === 2 ? '双图对比' : '素材查看'}</span><div><IconButton label="缩小" disabled={previewZoom <= 0.75} onClick={() => setPreviewZoom((value) => Math.max(0.75, value - 0.25))}><ZoomOut size={16} /></IconButton><IconButton label="放大" disabled={previewZoom >= 2} onClick={() => setPreviewZoom((value) => Math.min(2, value + 0.25))}><ZoomIn size={16} /></IconButton><IconButton label="关闭查看" onClick={() => setPreviewAssets([])}><X size={16} /></IconButton></div></div><div className={'inspector-images ' + (previewAssets.length === 2 ? 'is-compare' : '')}>{previewAssets.map((asset, index) => <figure key={asset.id}><img src={'/api/assets/' + encodeURIComponent(asset.id) + '/file'} alt="" style={{ transform: 'scale(' + previewZoom + ')' }} /><figcaption>{previewAssets.length === 2 ? '对比图 ' + (index + 1) : '素材预览'}</figcaption></figure>)}</div></div>}
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
