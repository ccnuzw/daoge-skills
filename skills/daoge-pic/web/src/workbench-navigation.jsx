import { BookOpen, CloudOff, Copy, FolderKanban, GitFork, Image, Images, Library, LifeBuoy, ListChecks, PackageCheck, RefreshCw, Server, TriangleAlert } from 'lucide-react';
import { Fragment } from 'react';
import { Disclosure } from './components/Disclosure.jsx';
import { runtimeHealthPresentation } from './runtime-health.mjs';
import { providerRuntimeHeadline, providerRuntimeNotice } from './provider-runtime-model.mjs';

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
];
const WORKBENCH_ACTIVE_VIEWS = new Set(['projects']);
// 生成历史属于创作过程，从任务页签进入时让「创作平台」保持高亮，避免左侧一整列无高亮。
const LINEAGE_ACTIVE_VIEWS = new Set(['lineage', 'studio-overview', 'prompts', 'runs']);
const ASSET_ACTIVE_VIEWS = new Set(['assets', 'trash', 'shared-assets']);

function NavigationButton({ item, active, disabled = false, onNavigate }) {
  const Icon = item.Icon;
  // 侧栏折叠后只剩图标：**行标签必须自带类名**。折叠规则靠 `.rail-row-label` 认它，
  // 不能再用「按钮里的所有 span」这种粗口径——那会把同一行里的图标 span 一起关掉
  // （资料三行折叠后变成空框就是这个原因）。
  return <button type="button" className={active ? 'is-active' : ''} disabled={disabled} onClick={() => onNavigate(item.view, item.changes || {})} title={disabled ? item.disabledLabel || item.label : item.label} aria-label={item.label} aria-current={active ? 'page' : undefined}><Icon size={17} strokeWidth={1.7} /><span className="rail-row-label">{item.label}</span></button>;
}

/**
 * 合并后的状态卡（批 B B1 / 界面宪法 §4 S7、§5.3 · D2）。
 *
 * **一张卡**：常显一行结论 + 点开两条明细（生成服务 / 运行状态）+ 卡底的疑难入口。
 * 结论按「谁在挡路」排：运行异常 > 生成服务未配置 > 配置热加载 > 限流/退避 > 一切正常。
 * provider 的**退避/限流结论**固定落在这里（S7：同一事实只有一个常显位置）——短句常显、整句进明细。
 * 「安全重启」只在真的可修时出现——能力保留，不是删掉。
 *
 * 常显行 = 卡头本身就是那个开关（D1/D3 拍板）：结论直接写在 `summary` 里，不再有「看明细」这个小字开关，
 * 也不再把结论放进会被 CSS 藏掉的第二个槽（它被藏过一次，`display:none`，任何宽度都看不见）。
 */
function UnifiedStatusCard({ provider, studio, recoveryPhase, repairing, onOpenProvider, onCopy, onRefresh, onRepair, onOpenTroubleshoot }) {
  const runtime = runtimeHealthPresentation(studio?.runtime, recoveryPhase);
  const configured = provider?.configured === true;
  const reconfigurationPending = provider?.reconfigurationPending === true;
  const concurrency = { providerConcurrency: provider?.runtime?.providerConcurrency || null };
  const throttle = providerRuntimeNotice(concurrency);
  const repairable = recoveryPhase === 'ready' && [studio?.runtime?.workerPool?.state, studio?.runtime?.mediaWorkerPool?.state].some((state) => state === 'degraded' || state === 'failed');
  // 常显行只放一句话（≤14 字档）；长句（限流/内存 23–24 字）落在明细的「生成服务」行。
  const headline = runtime.tone === 'danger' ? runtime.title
    : !configured ? '生成服务未配置'
      : reconfigurationPending ? '配置正在热加载'
        : providerRuntimeHeadline(concurrency) || (runtime.tone === 'warning' ? runtime.title : '一切正常');
  const tone = runtime.tone === 'danger' || !configured ? 'danger' : (reconfigurationPending || runtime.tone === 'warning' || throttle) ? 'warning' : 'ready';
  // 图标跟结论走：缺配置=断连、挡路的=警示、其余=服务。扫一眼图标就知道该不该点开。
  const StatusIcon = tone === 'danger' ? (configured ? TriangleAlert : CloudOff) : tone === 'warning' ? TriangleAlert : Server;
  const providerTitle = !configured ? '生成配置未就绪' : reconfigurationPending ? '配置正在热加载' : '生成配置已就绪';
  const providerDetail = !configured ? (provider?.missing?.includes('active_profile') ? '请先创建并启用生成服务配置' : '补全模型、服务地址或密钥') : [provider?.profileName, provider?.model].filter(Boolean).join(' · ') || '生成服务配置可用';
  return <section className={'rail-status-card is-' + tone} data-region="rail-status" aria-label={'系统状态：' + headline} title={'系统状态：' + headline}>
    <Disclosure className="rail-status-more" summary={<summary>
      <span className="rail-status-icon"><StatusIcon size={16} aria-hidden="true" /></span>
      <span className="rail-status-copy"><strong>{headline}</strong></span>
    </summary>}>
      <div className="rail-status-popover">
        <div className="rail-status-row is-provider">
          <span><b>生成服务</b><small>{[providerTitle, providerDetail, throttle].filter(Boolean).join(' · ')}</small></span>
          <button type="button" className="outline-button" onClick={onOpenProvider}>打开设置</button>
        </div>
        <div className="rail-status-row is-runtime">
          <span><b>运行状态</b><small>{runtime.title}：{runtime.detail}</small></span>
          <div className="runtime-health-actions">
            {repairable && <button type="button" className="outline-button" disabled={repairing} onClick={onRepair}><RefreshCw size={15} className={repairing ? 'spin' : ''} />{repairing ? '正在重启' : '安全重启'}</button>}
            <button type="button" className="outline-button" onClick={onRefresh}><RefreshCw size={15} />刷新</button>
            <button type="button" className="outline-button" onClick={onCopy}><Copy size={15} />复制诊断</button>
          </div>
        </div>
        <button type="button" className="outline-button rail-troubleshoot-entry" onClick={onOpenTroubleshoot}><LifeBuoy size={15} />疑难处理</button>
      </div>
    </Disclosure>
  </section>;
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
      {/* 任务列表是「创作平台」的子入口（`VIEW_HOSTS.tasks === 'lineage'`：任务列表 = 画布上的任务节点 + 文件夹管理），
          位置跟着它的宿主走、渲染在那个入口的**上一行**（用户定），而不是整列的末尾——
          放在末尾会被读成「第五个一级入口」。 */}
      <section className="primary-navigation" data-region="rail-workspace" aria-label="工作区主入口"><p className="rail-section-label">工作区</p>{mainItems.map(({ item, active, disabled }) => <Fragment key={item.label}>{item.view === 'lineage' && project && <button type="button" className={'rail-sub-entry' + (view === 'tasks' ? ' is-active' : '')} title="任务列表" aria-label="任务列表" onClick={() => onNavigate('tasks', {})} aria-current={view === 'tasks' ? 'page' : undefined}><ListChecks size={17} strokeWidth={1.7} /><span className="rail-row-label">任务列表</span></button>}<NavigationButton item={item} active={active} disabled={disabled} onNavigate={onNavigate} /></Fragment>)}</section>
      <section className="rail-assist-panel" data-region="rail-library" aria-label="资料与手册"><p className="rail-section-label">资料</p>{AUX_ITEMS.map((item) => <RailAuxCard key={item.view} active={view === item.view} onOpen={() => onNavigate(item.view, item.changes)} Icon={item.Icon} label={item.label} hint={item.hint} />)}<RailAuxCard active={view === 'guide'} onOpen={onOpenGuide} Icon={BookOpen} label="创作手册" hint="工作流、边界与恢复" /></section>
    </nav>
    <div className="rail-utility-stack">
      <UnifiedStatusCard provider={provider} studio={studio} recoveryPhase={recoveryPhase} repairing={repairing} onOpenProvider={onOpenProvider} onCopy={onCopyRuntimeDiagnostic} onRefresh={onRefresh} onRepair={onRepair} onOpenTroubleshoot={() => onNavigate('troubleshoot', {})} />
    </div>
  </>;
}
