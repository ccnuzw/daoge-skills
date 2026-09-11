import { Activity, BookOpen, Clock3, CloudOff, Copy, FolderKanban, GitFork, Image, PackageCheck, RefreshCw, Server } from 'lucide-react';
import { runtimeHealthPresentation } from './runtime-health.mjs';

const PROJECT_CONTEXT_RESET = { taskId: null, roundId: null, compareRoundIds: [], runId: null };
const NAVIGATION_ITEMS = {
  workbench: { view: 'projects', label: '工作台', Icon: FolderKanban, changes: { projectId: null, ...PROJECT_CONTEXT_RESET, assetScope: 'studio' } },
  lineage: { view: 'lineage', label: '创作流', Icon: GitFork, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' }, disabledLabel: '先选择一个项目' },
  assets: { view: 'assets', label: '素材库', Icon: Image, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' }, disabledLabel: '先选择一个项目' },
  runs: { view: 'runs', label: '生成记录', Icon: Clock3, changes: { assetScope: 'round' } },
  deliveries: { view: 'deliveries', label: '交付', Icon: PackageCheck, changes: PROJECT_CONTEXT_RESET, disabledLabel: '先选择一个项目' }
};
const WORKBENCH_ACTIVE_VIEWS = new Set(['projects']);
const LINEAGE_ACTIVE_VIEWS = new Set(['lineage', 'studio-overview', 'prompts']);
const ASSET_ACTIVE_VIEWS = new Set(['assets', 'trash', 'shared-assets']);

function NavigationButton({ item, active, disabled = false, onNavigate }) {
  const Icon = item.Icon;
  return <button type="button" className={active ? 'is-active' : ''} disabled={disabled} onClick={() => onNavigate(item.view, item.changes || {})} title={disabled ? item.disabledLabel || item.label : item.label} aria-label={item.label} aria-current={active ? 'page' : undefined}><Icon size={17} strokeWidth={1.7} /><span>{item.label}</span></button>;
}

function ProviderStatusCard({ provider, onOpen }) {
  const configured = provider?.configured === true;
  const reconfigurationPending = provider?.reconfigurationPending === true;
  const tone = !configured ? 'danger' : reconfigurationPending ? 'warning' : 'ready';
  const title = !configured ? '生成配置未就绪' : reconfigurationPending ? '配置正在热加载' : '生成配置已就绪';
  const detail = configured ? reconfigurationPending ? 'daemon 正在切换匹配 Worker' : [provider.profileName, provider.model].filter(Boolean).join(' · ') || '活动 Profile 可用' : provider?.missing?.includes('active_profile') ? '请先创建并激活 Profile' : '补全模型、端点或密钥';
  const Icon = configured ? Server : CloudOff;
  return <button type="button" className={'rail-status-card is-' + tone} onClick={onOpen} title={title + '：' + detail} aria-label={title + '，打开生成服务设置'}>
    <span className="rail-status-icon"><Icon size={16} aria-hidden="true" /></span>
    <span className="rail-status-copy"><strong>生成服务</strong><small>{title}</small></span>
  </button>;
}

function RuntimeStatusCard({ studio, recoveryPhase, repairing, onCopy, onRefresh, onRepair }) {
  const presentation = runtimeHealthPresentation(studio?.runtime, recoveryPhase);
  const repairable = recoveryPhase === 'ready' && [studio?.runtime?.workerPool?.state, studio?.runtime?.mediaWorkerPool?.state].some((state) => state === 'degraded' || state === 'failed');
  return <details className={'rail-status-details is-' + presentation.tone}>
    <summary title={presentation.title} aria-label="查看 Studio 运行状态">
      <span className="rail-status-icon"><Activity size={16} aria-hidden="true" /></span>
      <span className="rail-status-copy"><strong>运行状态</strong><small>{presentation.title}</small></span>
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
  const projectRequired = !project;
  const workbenchItem = NAVIGATION_ITEMS.workbench;
  const lineageItem = project ? { ...NAVIGATION_ITEMS.lineage, changes: round ? { taskId: task?.id || round.taskId, roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' } : task ? { taskId: task.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' } : NAVIGATION_ITEMS.lineage.changes } : NAVIGATION_ITEMS.lineage;
  const assetItem = { ...NAVIGATION_ITEMS.assets, disabledLabel: projectRequired ? '先选择一个项目' : '打开当前项目素材库' };
  const runItem = { ...NAVIGATION_ITEMS.runs, changes: round ? { roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' } : { assetScope: 'round' }, disabledLabel: task ? '先在任务里选择一个轮次' : '先选择任务和轮次' };
  const deliveryItem = { ...NAVIGATION_ITEMS.deliveries, disabledLabel: projectRequired ? '先选择一个项目' : '打开当前项目交付' };
  const mainItems = [
    { item: workbenchItem, active: WORKBENCH_ACTIVE_VIEWS.has(view), disabled: false },
    { item: lineageItem, active: LINEAGE_ACTIVE_VIEWS.has(view), disabled: projectRequired },
    { item: assetItem, active: ASSET_ACTIVE_VIEWS.has(view), disabled: projectRequired },
    { item: runItem, active: view === 'runs', disabled: !round },
    { item: deliveryItem, active: view === 'deliveries', disabled: projectRequired }
  ];
  return <>
    <nav className="workspace-navigation" aria-label="Studio 导航">
      <section className="primary-navigation" aria-label="创作工作台主入口"><p>创作工作台</p>{mainItems.map(({ item, active, disabled }) => <NavigationButton key={item.label} item={item} active={active} disabled={disabled} onNavigate={onNavigate} />)}</section>
    </nav>
    <div className="rail-utility-stack">
      <section className="rail-system-panel" aria-label="Studio 状态"><p className="rail-section-label">系统</p><ProviderStatusCard provider={provider} onOpen={onOpenProvider} /><RuntimeStatusCard studio={studio} recoveryPhase={recoveryPhase} repairing={repairing} onCopy={onCopyRuntimeDiagnostic} onRefresh={onRefresh} onRepair={onRepair} /></section>
      <section className="rail-assist-panel" aria-label="辅助入口"><p className="rail-section-label">辅助</p><GuideCard active={view === 'guide'} onOpen={onOpenGuide} /></section>
    </div>
  </>;
}
