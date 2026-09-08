import { Activity, Archive, BookOpen, Clock3, CloudOff, Copy, FolderKanban, GitFork, Image, PackageCheck, PanelTop, RefreshCw, Server } from 'lucide-react';
import { runtimeHealthPresentation } from './runtime-health.mjs';

const PROJECT_CONTEXT_RESET = { taskId: null, roundId: null, compareRoundIds: [], runId: null };
const NAVIGATION_ITEMS = {
  projects: { view: 'projects', label: '项目管理', Icon: FolderKanban },
  guide: { view: 'guide', label: '学习中心', Icon: BookOpen },
  'project-overview': { view: 'project-overview', label: '项目概览', Icon: PanelTop, changes: PROJECT_CONTEXT_RESET },
  lineage: { view: 'lineage', label: '创作谱系', Icon: GitFork, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' } },
  tasks: { view: 'tasks', label: '任务', Icon: FolderKanban, changes: PROJECT_CONTEXT_RESET },
  assets: { view: 'assets', label: '项目资产', Icon: Image, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' } },
  runs: { view: 'runs', label: '生成历史', Icon: Clock3, changes: { assetScope: 'round' } },
  deliveries: { view: 'deliveries', label: '交付', Icon: PackageCheck, changes: PROJECT_CONTEXT_RESET },
  trash: { view: 'trash', label: '回收站', Icon: Archive, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' } }
};

function NavigationButton({ item, active, disabled = false, onNavigate }) {
  const Icon = item.Icon;
  return <button type="button" className={active ? 'is-active' : ''} disabled={disabled} onClick={() => onNavigate(item.view, item.changes || {})} title={disabled ? item.disabledLabel || item.label : item.label} aria-label={item.label} aria-current={active ? 'page' : undefined}><Icon size={17} strokeWidth={1.7} /><span>{item.label}</span></button>;
}

function ProviderStatusCard({ provider, runtimeRestartRequired, onOpen }) {
  const configured = provider?.configured === true;
  const tone = !configured ? 'danger' : runtimeRestartRequired ? 'warning' : 'ready';
  const title = !configured ? '生成配置未就绪' : runtimeRestartRequired ? '配置变更需重启' : '生成配置已就绪';
  const detail = configured ? [provider.profileName, provider.model].filter(Boolean).join(' · ') || '活动 Profile 可用' : provider?.missing?.includes('active_profile') ? '请先创建并激活 Profile' : '补全模型、端点或密钥';
  const Icon = configured ? Server : CloudOff;
  return <button type="button" className={'rail-status-card is-' + tone} onClick={onOpen} title={title + '：' + detail} aria-label={title + '，打开生成服务设置'}>
    <span className="rail-status-icon"><Icon size={16} aria-hidden="true" /></span>
    <span className="rail-status-copy"><strong>{title}</strong><small>{detail}</small></span>
  </button>;
}

function RuntimeStatusCard({ studio, recoveryPhase, repairing, onCopy, onRefresh, onRepair }) {
  const presentation = runtimeHealthPresentation(studio?.runtime, recoveryPhase);
  const repairable = recoveryPhase === 'ready' && [studio?.runtime?.workerPool?.state, studio?.runtime?.mediaWorkerPool?.state].some((state) => state === 'degraded' || state === 'failed');
  return <details className={'rail-status-details is-' + presentation.tone}>
    <summary title={presentation.title} aria-label="查看 Studio 运行状态">
      <span className="rail-status-icon"><Activity size={16} aria-hidden="true" /></span>
      <span className="rail-status-copy"><strong>{presentation.title}</strong><small>{presentation.detail}</small></span>
    </summary>
    <div className="rail-status-popover" role={presentation.tone === 'danger' ? 'alert' : 'status'} aria-live={presentation.live ? 'polite' : 'off'}>
      <p>{presentation.detail}</p>
      <div className="runtime-health-actions">
        {repairable && <button type="button" className="outline-button" disabled={repairing} onClick={onRepair}><RefreshCw size={15} className={repairing ? 'spin' : ''} />{repairing ? '正在重启' : '安全重启'}</button>}
        <button type="button" className="outline-button" onClick={onRefresh}><RefreshCw size={15} />刷新状态</button>
        <button type="button" className="outline-button" onClick={onCopy}><Copy size={15} />复制脱敏诊断</button>
      </div>
    </div>
  </details>;
}

function GuideCard({ active, onOpen }) {
  return <button type="button" className={'rail-guide-card' + (active ? ' is-active' : '')} onClick={onOpen} title="DAOGE Pic 创作手册" aria-label="打开 DAOGE Pic 创作手册" aria-current={active ? 'page' : undefined}>
    <span className="rail-guide-icon"><BookOpen size={17} aria-hidden="true" /></span>
    <span className="rail-guide-copy"><strong>创作手册</strong><small>工作流、边界与恢复</small></span>
  </button>;
}

export function WorkbenchNavigation({ view, project, task, round, provider, studio, recoveryPhase, repairing, onNavigate, onOpenProvider, onOpenGuide, onCopyRuntimeDiagnostic, onRefresh, onRepair }) {
  const primaryItems = [NAVIGATION_ITEMS.projects];
  const runItem = { ...NAVIGATION_ITEMS.runs, changes: round ? { roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' } : { assetScope: 'round' }, disabledLabel: task ? '先在任务里选择一个轮次' : '先选择任务和轮次' };
  return <>
    <nav className="workspace-navigation" aria-label="Studio 导航">
      <section className="primary-navigation"><p>主功能</p>{primaryItems.map((item) => {
        const nextItem = item.view === 'runs' ? runItem : item;
        const active = item.view === 'projects' ? view === 'projects' : item.view === view;
        return <NavigationButton key={item.view} item={nextItem} active={active} disabled={item.view === 'runs' && !round} onNavigate={onNavigate} />;
      })}</section>
      {project && <section className="project-navigation"><p>当前项目</p><button type="button" className={'project-navigation-name' + (view === 'project-overview' ? ' is-active' : '')} onClick={() => onNavigate('project-overview')} title="返回项目概览" aria-label={'返回项目概览：' + project.name} aria-current={view === 'project-overview' ? 'page' : undefined}><FolderKanban size={16} /><span>{project.name}</span></button><NavigationButton item={{ ...NAVIGATION_ITEMS.lineage, label: '谱系' }} active={view === 'lineage'} onNavigate={onNavigate} /><NavigationButton item={NAVIGATION_ITEMS.tasks} active={view === 'tasks'} onNavigate={onNavigate} /><NavigationButton item={runItem} active={view === 'runs'} disabled={!round} onNavigate={onNavigate} /><NavigationButton item={NAVIGATION_ITEMS.assets} active={view === 'assets'} onNavigate={onNavigate} /><NavigationButton item={NAVIGATION_ITEMS.deliveries} active={view === 'deliveries'} onNavigate={onNavigate} /><NavigationButton item={NAVIGATION_ITEMS.trash} active={view === 'trash'} onNavigate={onNavigate} /></section>}
    </nav>
    <div className="rail-utility-stack">
      <section className="rail-system-panel" aria-label="Studio 状态"><p className="rail-section-label">Studio 状态</p><ProviderStatusCard provider={provider} runtimeRestartRequired={studio?.runtime?.restartRequired === true || provider?.restartRequired === true} onOpen={onOpenProvider} /><RuntimeStatusCard studio={studio} recoveryPhase={recoveryPhase} repairing={repairing} onCopy={onCopyRuntimeDiagnostic} onRefresh={onRefresh} onRepair={onRepair} /></section>
      <section className="rail-assist-panel" aria-label="辅助入口"><p className="rail-section-label">辅助</p><GuideCard active={view === 'guide'} onOpen={onOpenGuide} /></section>
    </div>
  </>;
}
