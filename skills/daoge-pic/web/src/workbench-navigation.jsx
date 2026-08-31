import { Archive, BookOpen, FolderKanban, Image, Images, Library, PackageCheck, PanelTop } from 'lucide-react';

const STUDIO_ITEMS = [
  { view: 'projects', label: '项目', Icon: FolderKanban },
  { view: 'library', label: '创作资料库', Icon: Library },
  { view: 'shared-assets', label: '共享素材', Icon: Images },
  { view: 'guide', label: '学习中心', Icon: BookOpen }
];

const PROJECT_CONTEXT_RESET = { taskId: null, roundId: null, compareRoundIds: [], runId: null };

const PROJECT_ITEMS = [
  { view: 'project-overview', label: '项目概览', Icon: PanelTop, changes: PROJECT_CONTEXT_RESET },
  { view: 'tasks', label: '任务', Icon: FolderKanban, changes: PROJECT_CONTEXT_RESET },
  { view: 'assets', label: '项目资产', Icon: Image, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' } },
  { view: 'deliveries', label: '交付', Icon: PackageCheck, changes: PROJECT_CONTEXT_RESET }
];

function NavigationButton({ item, active, onNavigate }) {
  const Icon = item.Icon;
  return <button type="button" className={active ? 'is-active' : ''} onClick={() => onNavigate(item.view, item.changes || {})} title={item.label} aria-label={item.label}><Icon size={17} strokeWidth={1.7} /><span>{item.label}</span></button>;
}

export function WorkbenchNavigation({ view, project, onNavigate }) {
  return <nav className="workspace-navigation" aria-label="Studio 导航">
    <section><p>Studio</p>{STUDIO_ITEMS.map((item) => <NavigationButton key={item.view} item={item} active={view === item.view} onNavigate={onNavigate} />)}</section>
    {project && <><section className="project-navigation"><button type="button" className="project-navigation-name" onClick={() => onNavigate('project-overview')} title="返回项目概览"><FolderKanban size={16} /><span>{project.name}</span></button>{PROJECT_ITEMS.map((item) => <NavigationButton key={item.view} item={item} active={view === item.view} onNavigate={onNavigate} />)}</section><section className="project-utility"><NavigationButton item={{ view: 'trash', label: '回收站', Icon: Archive, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' } }} active={view === 'trash'} onNavigate={onNavigate} /></section></>}
  </nav>;
}
