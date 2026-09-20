import { Activity, CircleAlert, Copy, FolderKanban, GitFork, PanelTop, RefreshCw, Search, X } from 'lucide-react';
import { PROJECT_PAGE_SIZE, TASK_OVERVIEW_PAGE_SIZE, TASK_PAGE_SIZE, createProjectSearchIndex, createTaskSearchIndex, filterProjectIndex, filterTaskIndex, paginateWorkspaceItems } from '../workspace-list-model.mjs';
import { ListPager } from '../app/asset-surfaces.jsx';
import { taskPresentation } from '../status-presentation.mjs';
import { PageToolbar } from '../components/PageToolbar.jsx';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/PageHeader.jsx';
import { errorMessageForDisplay } from '../error-model.mjs';
import { StatusPill } from '../components/StatusPill.jsx';
import { IconButton } from '../components/IconButton.jsx';
import { runtimeHealthPresentation } from '../runtime-health.mjs';
import { projectEmptyState } from '../project-empty-state-model.mjs';

const EMPTY = [];

/** 界面批 E 从 main.jsx 搬出（行为零变化）。 */

export function RuntimeHealthAlertStrip({ studio, recoveryPhase, repairing, onCopy, onRefresh, onRepair }) {
  const presentation = runtimeHealthPresentation(studio?.runtime, recoveryPhase);
  if (!['warning', 'danger'].includes(presentation.tone)) return null;
  const repairable = recoveryPhase === 'ready' && [studio?.runtime?.workerPool?.state, studio?.runtime?.mediaWorkerPool?.state].some((state) => state === 'degraded' || state === 'failed');
  return <aside className={'runtime-alert-strip is-' + presentation.tone} role={presentation.tone === 'danger' ? 'alert' : 'status'} aria-live={presentation.live ? 'polite' : 'off'}>
    <div><Activity size={16} aria-hidden="true" /><strong>{presentation.title}</strong><span>{presentation.detail}</span></div>
    <div className="runtime-health-actions">
      {repairable && <button type="button" className="outline-button" disabled={repairing} onClick={onRepair}><RefreshCw size={15} className={repairing ? 'spin' : ''} />{repairing ? '正在重启' : '安全重启'}</button>}
      <button type="button" className="outline-button" onClick={onRefresh}><RefreshCw size={15} />刷新状态</button>
      <button type="button" className="outline-button" onClick={onCopy}><Copy size={15} />复制隐去隐私的诊断</button>
    </div>
  </aside>;
}

export function ProjectIndex({ projects, projectTemplates = EMPTY, onOpenProject, onOpenProjectOverview, onCreateProject }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const projectIndex = useMemo(() => createProjectSearchIndex(projects), [projects]);
  const filtered = useMemo(() => filterProjectIndex(projectIndex, deferredQuery, status), [projectIndex, deferredQuery, status]);
  const pagination = useMemo(() => paginateWorkspaceItems(filtered, page, PROJECT_PAGE_SIZE), [filtered, page]);
  // 首屏三形态（方案 4.7）：全新用户 / 搜索无果 / 筛选无果，三句话各不相同。
  // 判定优先级：先看「有没有项目」这个大前提，才轮到搜索与筛选。
  const emptyState = projectEmptyState({ hasAnyProject: projects.length > 0, hasQuery: deferredQuery.trim() !== '', hasStatusFilter: status !== 'all' });
  useEffect(() => { if (pagination.page !== page) setPage(pagination.page); }, [page, pagination.page]);
  return <section className="project-index-stage">
    <PageToolbar label="项目筛选" trailing={<button type="button" className="command-button" onClick={onCreateProject}><FolderKanban size={16} />新建项目</button>}><label className="workspace-list-search"><Search size={15} /><input type="search" value={query} placeholder="搜索项目名称或说明" aria-label="搜索项目名称或说明" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{query && <IconButton label="清空项目搜索" onClick={() => { setQuery(''); setPage(1); }}><X size={14} /></IconButton>}</label><div className="workspace-list-filters" aria-label="项目状态">{[['active', '进行中'], ['archived', '已归档'], ['all', '全部']].map(([value, label]) => <button type="button" key={value} className={status === value ? 'is-active' : ''} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div></PageToolbar>
    {pagination.items.length ? <><div className="project-index-list">{pagination.items.map((project) => { const template = projectTemplates.find((item) => item.id === project.templateId); return <div className="project-index-row" key={project.id}><button type="button" className="project-index-main" onClick={() => onOpenProject(project.id)}><FolderKanban size={16} /><span><b>{project.name}</b><small>{project.description || '暂无说明'}</small></span><span className="project-index-open">{template?.name || (project.templateId ? '模板未加载' : '未绑定模板')}</span></button><button type="button" className="project-index-overview" title={'只看“' + project.name + '”的总览'} aria-label={'查看“' + project.name + '”的项目总览'} onClick={() => onOpenProjectOverview(project.id)}><PanelTop size={14} />总览</button></div>; })}</div><ListPager page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} /></> : <div className={'empty-stage is-' + emptyState.kind}><FolderKanban size={28} strokeWidth={1.15} /><p>{emptyState.title}。</p><p>{emptyState.body}</p>{emptyState.cta && <button type="button" className="command-button" onClick={onCreateProject}><FolderKanban size={16} />{emptyState.cta}</button>}</div>}
  </section>;
}

export function ManagedTaskList({ tasks, pageSize, actionLabel, emptyMessage, createAction = null, onOpenTask }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(1);
  const deferredQuery = useDeferredValue(query);
  const taskIndex = useMemo(() => createTaskSearchIndex(tasks), [tasks]);
  const filtered = useMemo(() => filterTaskIndex(taskIndex, deferredQuery, status), [taskIndex, deferredQuery, status]);
  const pagination = useMemo(() => paginateWorkspaceItems(filtered, page, pageSize), [filtered, page, pageSize]);
  useEffect(() => { if (pagination.page !== page) setPage(pagination.page); }, [page, pagination.page]);
  return <><PageToolbar label="任务筛选" trailing={createAction}><label className="workspace-list-search"><Search size={15} /><input type="search" value={query} placeholder="搜索任务名称" aria-label="搜索任务名称" onChange={(event) => { setQuery(event.target.value); setPage(1); }} />{query && <IconButton label="清空任务搜索" onClick={() => { setQuery(''); setPage(1); }}><X size={14} /></IconButton>}</label><div className="workspace-list-filters" aria-label="任务状态">{[['open', '进行中'], ['completed', '已完成'], ['archived', '已归档'], ['all', '全部']].map(([value, label]) => <button type="button" key={value} className={status === value ? 'is-active' : ''} onClick={() => { setStatus(value); setPage(1); }}>{label}</button>)}</div></PageToolbar>{pagination.items.length ? <><div className="project-task-list is-full">{pagination.items.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}><GitFork size={16} /><span><b>{task.name}</b><small>{taskPresentation(task).label}</small></span><span>{actionLabel}</span></button>)}</div><ListPager page={pagination.page} totalPages={pagination.totalPages} total={pagination.total} onPageChange={setPage} /></> : <div className="empty-stage"><FolderKanban size={26} strokeWidth={1.15} /><p>{tasks.length ? '没有符合当前搜索与状态筛选的任务。' : emptyMessage}</p></div>}</>;
}

export function ProjectOverview({ project, projectTemplates = EMPTY, tasks, selectedCount, qualityMetrics, qualityMetricsLoading, qualityMetricsError, onRefreshQualityMetrics, onOpenTasks, onOpenAssets, onOpenDeliveries, onOpenTask, onCreateTask, onArchive }) {
  const archived = project.status === 'archived';
  const activeTasks = tasks.filter((task) => !['archived', 'completed'].includes(task.status));
  const recentTasks = (activeTasks.length ? activeTasks : tasks).slice(0, TASK_OVERVIEW_PAGE_SIZE);
  const template = projectTemplates.find((option) => option.id === project.templateId);
  return <section className="project-overview-stage">
    <PageHeader kicker="项目概览" title="继续当前工作" description={template ? template.name + ' · 模板 v' + (project.templateVersion || template.version || 1) : ''}><StatusPill value={project.status} scope="project" />{!archived && <><button type="button" className="command-button" onClick={onCreateTask}><FolderKanban size={16} />新建任务</button><button type="button" className="outline-button" onClick={onArchive}>归档项目</button></>}</PageHeader>
    <div className="project-status-strip"><button type="button" onClick={onOpenTasks}><span>任务</span><b>{tasks.length}</b><small>{activeTasks.length ? activeTasks.length + ' 个可继续' : '没有待处理任务'}</small></button><button type="button" onClick={onOpenAssets}><span>已选图片</span><b>{selectedCount}</b><small>用于交付的成果</small></button><button type="button" onClick={onOpenDeliveries}><span>交付</span><b>打开</b><small>下载与交付包</small></button></div>
    <ProjectQualityMetrics metrics={qualityMetrics} loading={qualityMetricsLoading} error={qualityMetricsError} onRefresh={() => void onRefreshQualityMetrics()} />
    <section className="project-task-panel is-recent"><header><div><p className="eyebrow">最近任务</p><h3>选择一个目标</h3></div><div className="project-task-panel-actions"><button type="button" className="outline-button" onClick={onOpenTasks}>全部任务</button>{!archived && <button type="button" className="command-button" onClick={onCreateTask}>新建任务</button>}</div></header>{recentTasks.length ? <div className="project-task-list is-compact">{recentTasks.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task.id)}><GitFork size={16} /><span><b>{task.name}</b><small>{taskPresentation(task).label}</small></span><span>继续</span></button>)}</div> : <div className="empty-stage"><FolderKanban size={26} strokeWidth={1.15} /><p>{archived ? '项目已归档，没有可继续的任务。' : '这个项目还没有任务。可以直接在 Studio 新建任务，生成前仍由 Agent 整理计划。'}</p></div>}</section>
  </section>;
}

export function ProjectQualityMetrics({ metrics, loading, error, onRefresh }) {
  const runItems = metrics?.runItems || {};
  const reviews = metrics?.reviews || {};
  const patterns = (Array.isArray(metrics?.failurePatterns) ? metrics.failurePatterns : []).filter((pattern) => pattern && typeof pattern === 'object').slice(0, 3);
  const attentionCount = ['failed', 'blocked', 'retryWait', 'unknownOutcome'].reduce((total, key) => total + Number(runItems[key] || 0), 0);
  return <section className="quality-metrics-panel" aria-labelledby="quality-metrics-title">
    <header className="quality-metrics-head">
      <div><p className="eyebrow">运营摘要</p><h3 id="quality-metrics-title">质量指标</h3><span>只显示当前项目的聚合结果；失败模式仅保留安全的分类代码，不展示原始错误内容。</span></div>
      <button type="button" className="outline-button" disabled={loading} onClick={onRefresh}><RefreshCw size={14} className={loading ? 'spin' : ''} />{loading ? '正在刷新' : '刷新指标'}</button>
    </header>
    {loading && <p className="quality-metrics-empty" role="status" aria-live="polite">正在读取当前项目质量指标。</p>}
    {error && <div className="quality-metrics-error" role="alert" aria-live="assertive"><CircleAlert size={15} aria-hidden="true" /><span>{errorMessageForDisplay(error, '无法读取项目质量指标。')}</span><button type="button" className="outline-button" onClick={onRefresh}>重试</button></div>}
    {!loading && !error && metrics && <>
      <div className="quality-metrics-grid">
        <div className="quality-metrics-stat"><span>终局成功率</span><strong>{metricRate(runItems.successRate)}</strong><small>{safeMetricCount(runItems.successful)} 成功 / {safeMetricCount(runItems.settled)} 个已判定{Number(runItems.cancelled) > 0 ? '（另有 ' + safeMetricCount(runItems.cancelled) + ' 个已取消）' : ''}</small></div>
        <div className="quality-metrics-stat"><span>单张出图</span><strong>{safeMetricCount(runItems.total)}</strong><small>{safeMetricCount(metrics.runs?.total)} 次运行</small></div>
        <div className="quality-metrics-stat"><span>需关注</span><strong>{safeMetricCount(attentionCount)}</strong><small>失败 · 阻塞 · 等待重试 · 待核实</small></div>
        <div className="quality-metrics-stat"><span>保留率</span><strong>{metricRate(reviews.keepRate)}</strong><small>{safeMetricCount(reviews.total)} 条评审记录</small></div>
      </div>
      <section className="quality-metrics-patterns" aria-labelledby="quality-metrics-patterns-title"><h4 id="quality-metrics-patterns-title">常见失败模式</h4>{patterns.length ? <ul>{patterns.map((pattern, index) => { const kind = typeof pattern.kind === 'string' ? pattern.kind : ''; const code = typeof pattern.code === 'string' ? pattern.code : '未分类'; return <li key={(pattern.key || code) + '-' + index}>{kind ? kind + ' · ' : ''}{code} <b>{safeMetricCount(pattern.count)} 次</b></li>; })}</ul> : <p className="quality-metrics-empty">当前没有可分类的失败模式。</p>}</section>
    </>}
    {!loading && !error && !metrics && <p className="quality-metrics-empty">暂无质量指标。</p>}
  </section>;
}

export function ProjectTaskList({ project, tasks, onOpenTask, onCreateTask }) {
  return <section className="project-tasks-stage"><ManagedTaskList tasks={tasks} pageSize={TASK_PAGE_SIZE} actionLabel="查看批次" emptyMessage="这个项目还没有任务。创作者可以在 Studio 直接新建任务，并把它设为当前工作对象。" createAction={project.status !== 'archived' ? <button type="button" className="command-button" onClick={onCreateTask}><FolderKanban size={16} />新建任务</button> : null} onOpenTask={onOpenTask} /></section>;
}

function safeMetricCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? String(Math.trunc(count)) : '0';
}

function metricRate(value) {
  if (value === null || value === undefined) return '暂无';
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? Math.round(rate * 100) + '%' : '暂无';
}
