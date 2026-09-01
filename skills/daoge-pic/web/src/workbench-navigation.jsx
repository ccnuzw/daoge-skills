import { Archive, BookOpen, FolderKanban, Image, Images, Library, PackageCheck, PanelTop } from 'lucide-react';
import { PROJECT_NAVIGATION_VIEWS, STUDIO_NAVIGATION_VIEWS } from './workbench-navigation-model.mjs';

const PROJECT_CONTEXT_RESET = { taskId: null, roundId: null, compareRoundIds: [], runId: null };
const NAVIGATION_ITEMS = {
  projects: { view: 'projects', label: '项目', Icon: FolderKanban },
  library: { view: 'library', label: '创作资料库', Icon: Library },
  'shared-assets': { view: 'shared-assets', label: '共享素材', Icon: Images },
  guide: { view: 'guide', label: '学习中心', Icon: BookOpen },
  'project-overview': { view: 'project-overview', label: '项目概览', Icon: PanelTop, changes: PROJECT_CONTEXT_RESET },
  tasks: { view: 'tasks', label: '任务', Icon: FolderKanban, changes: PROJECT_CONTEXT_RESET },
  assets: { view: 'assets', label: '项目资产', Icon: Image, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' } },
  deliveries: { view: 'deliveries', label: '交付', Icon: PackageCheck, changes: PROJECT_CONTEXT_RESET },
  trash: { view: 'trash', label: '回收站', Icon: Archive, changes: { ...PROJECT_CONTEXT_RESET, assetScope: 'project' } }
};
const STUDIO_ITEMS = STUDIO_NAVIGATION_VIEWS.map((view) => NAVIGATION_ITEMS[view]);
const PROJECT_ITEMS = PROJECT_NAVIGATION_VIEWS.filter((view) => view !== 'trash').map((view) => NAVIGATION_ITEMS[view]);

function NavigationButton({ item, active, onNavigate }) {
  const Icon = item.Icon;
  return <button type="button" className={active ? 'is-active' : ''} onClick={() => onNavigate(item.view, item.changes || {})} title={item.label} aria-label={item.label}><Icon size={17} strokeWidth={1.7} /><span>{item.label}</span></button>;
}

export function WorkbenchNavigation({ view, project, onNavigate }) {
  return <nav className="workspace-navigation" aria-label="Studio 导航">
    <section><p>Studio</p>{STUDIO_ITEMS.map((item) => <NavigationButton key={item.view} item={item} active={view === item.view} onNavigate={onNavigate} />)}</section>
    {project && <><section className="project-navigation"><button type="button" className="project-navigation-name" onClick={() => onNavigate('project-overview')} title="返回项目概览"><FolderKanban size={16} /><span>{project.name}</span></button>{PROJECT_ITEMS.map((item) => <NavigationButton key={item.view} item={item} active={view === item.view} onNavigate={onNavigate} />)}</section><section className="project-utility"><NavigationButton item={NAVIGATION_ITEMS.trash} active={view === 'trash'} onNavigate={onNavigate} /></section></>}
  </nav>;
}
