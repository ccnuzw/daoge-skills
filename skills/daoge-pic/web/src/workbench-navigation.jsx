import { Activity, BookOpen, CloudOff, Copy, FolderKanban, GitFork, Image, Images, Library, LifeBuoy, PackageCheck, RefreshCw, Server } from 'lucide-react';
import { runtimeHealthPresentation } from './runtime-health.mjs';

const PROJECT_CONTEXT_RESET = { taskId: null, roundId: null, compareRoundIds: [], runId: null };
// 四个一级入口：选项目 → 干活 → 看产出 → 交出去。
// 「生成历史」(runs) 不是一级入口：它按批次组织，只在任务内联页签里出现。
// 「资产管理」以项目为边界（用户已定）：选片、评审、交付在数据模型里就是按项目记的
// （/api/projects/<id>/selection/…），跨项目混看没有意义，所以它和「创作平台」「资产交付」一样要先选项目。
const NAVIGATION_ITEMS = {
  workbench: { view: 'projects', label: '项目管理', Icon: FolderKanban, changes: { projectId: null, ...PROJECT_CONTEXT_RESET, assetScope: 'studio' } },
  lineage: { view: 'lineage', label: '创作平台', Icon: GitFork, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' }, disabledLabel: '先选择一个项目' },
  assets: { view: 'assets', label: '资产管理', Icon: Image, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' }, disabledLabel: '先选择一个项目' },
  deliveries: { view: 'deliveries', label: '资产交付', Icon: PackageCheck, changes: PROJECT_CONTEXT_RESET, disabledLabel: '先选择一个项目' }
};
// 辅助区。这两个视图此前各自只在创作手册里有一个按钮，等于不可达；现在给它们真入口。
const AUX_ITEMS = [
  { view: 'library', label: '规则资料', hint: '任务类型、风格与品牌规则', Icon: Library, changes: PROJECT_CONTEXT_RESET },
  { view: 'shared-assets', label: '共享素材', hint: '跨项目复用图片', Icon: Images, changes: PROJECT_CONTEXT_RESET },
  { view: 'troubleshoot', label: '疑难处理', hint: '状态、数据体检与恢复', Icon: LifeBuoy, changes: PROJECT_CONTEXT_RESET }
];
const WORKBENCH_ACTIVE_VIEWS = new Set(['projects']);
// 生成历史属于创作过程，从任务页签进入时让「创作平台」保持高亮，避免左侧一整列无高亮。
const LINEAGE_ACTIVE_VIEWS = new Set(['lineage', 'studio-overview', 'prompts', 'runs']);
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
  const detail = configured ? reconfigurationPending ? '后台服务正在切换对应的处理进程' : [provider.profileName, provider.model].filter(Boolean).join(' · ') || '生成服务配置可用' : provider?.missing?.includes('active_profile') ? '请先创建并启用生成服务配置' : '补全模型、服务地址或密钥';
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
        <button type="button" className="outline-button" onClick={onCopy}><Copy size={15} />复制隐去隐私的诊断</button>
      </div>
    </div>
  </details>;
}

function RailAuxCard({ active, onOpen, Icon, label, hint }) {
  return <button type="button" className={'rail-guide-card' + (active ? ' is-active' : '')} onClick={onOpen} title={'DAOGE Pic ' + label} aria-label={'打开 DAOGE Pic ' + label} aria-current={active ? 'page' : undefined}>
    <span className="rail-guide-icon"><Icon size={17} aria-hidden="true" /></span>
    <span className="rail-guide-copy"><strong>{label}</strong><small>{hint}</small></span>
  </button>;
}

export function WorkbenchNavigation({ view, project, task, round, provider, studio, recoveryPhase, repairing, onNavigate, onOpenProvider, onOpenGuide, onCopyRuntimeDiagnostic, onRefresh, onRepair }) {
  const projectRequired = !project;
  const workbenchItem = NAVIGATION_ITEMS.workbench;
  const lineageItem = project ? { ...NAVIGATION_ITEMS.lineage, changes: round ? { taskId: task?.id || round.taskId, roundId: round.id, compareRoundIds: [round.id], runId: null, assetScope: 'round' } : task ? { taskId: task.id, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' } : NAVIGATION_ITEMS.lineage.changes } : NAVIGATION_ITEMS.lineage;
  const assetItem = { ...NAVIGATION_ITEMS.assets, disabledLabel: projectRequired ? '先选择一个项目' : '打开当前项目的资产' };
  const deliveryItem = { ...NAVIGATION_ITEMS.deliveries, disabledLabel: projectRequired ? '先选择一个项目' : '打开当前项目的交付' };
  const mainItems = [
    { item: workbenchItem, active: WORKBENCH_ACTIVE_VIEWS.has(view), disabled: false },
    { item: lineageItem, active: LINEAGE_ACTIVE_VIEWS.has(view), disabled: projectRequired },
    { item: assetItem, active: ASSET_ACTIVE_VIEWS.has(view), disabled: projectRequired },
    { item: deliveryItem, active: view === 'deliveries', disabled: projectRequired }
  ];
  return <>
    <nav className="workspace-navigation" aria-label="Studio 导航">
      <section className="primary-navigation" aria-label="工作区主入口"><p>工作区</p>{mainItems.map(({ item, active, disabled }) => <NavigationButton key={item.label} item={item} active={active} disabled={disabled} onNavigate={onNavigate} />)}</section>
    </nav>
    <div className="rail-utility-stack">
      <section className="rail-system-panel" aria-label="Studio 状态"><p className="rail-section-label">系统</p><ProviderStatusCard provider={provider} onOpen={onOpenProvider} /><RuntimeStatusCard studio={studio} recoveryPhase={recoveryPhase} repairing={repairing} onCopy={onCopyRuntimeDiagnostic} onRefresh={onRefresh} onRepair={onRepair} /></section>
      <section className="rail-assist-panel" aria-label="辅助入口"><p className="rail-section-label">辅助</p>{AUX_ITEMS.map((item) => <RailAuxCard key={item.view} active={view === item.view} onOpen={() => onNavigate(item.view, item.changes)} Icon={item.Icon} label={item.label} hint={item.hint} />)}<RailAuxCard active={view === 'guide'} onOpen={onOpenGuide} Icon={BookOpen} label="创作手册" hint="工作流、边界与恢复" /></section>
    </div>
  </>;
}
