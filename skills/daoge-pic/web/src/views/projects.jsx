import { ProjectIndex } from '../app/project-surfaces.jsx';
import { selectProject } from '../workbench-route.mjs';

/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */
export function ProjectsView({ assetScope, compareRoundIds, navigateRoute, openCreationDialog, projectTemplates, projects, route, view }) {
  return <><ProjectIndex projects={projects} projectTemplates={projectTemplates} onCreateProject={() => openCreationDialog('project')} onOpenProject={(projectId) => navigateRoute(selectProject(route, projectId))} onOpenProjectOverview={(projectId) => navigateRoute({ view: 'project-overview', projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' })} /></>;
}
