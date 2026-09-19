import { ProjectOverview } from '../app/project-surfaces.jsx';
import { selectTask } from '../workbench-route.mjs';

/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */
export function ProjectOverviewView({ assetScope, assets, compareRoundIds, deliveries, navigateRoute, openArchiveConfirmation, openCreationDialog, projectTemplates, qualityMetrics, qualityMetricsError, qualityMetricsLoading, refreshQualityMetrics, route, selectedAssets, selectedProject, tasks, view }) {
  return <>selectedProject ? <ProjectOverview project={selectedProject} projectTemplates={projectTemplates} tasks={tasks} selectedCount={selectedAssets.length} qualityMetrics={qualityMetrics} qualityMetricsLoading={qualityMetricsLoading} qualityMetricsError={qualityMetricsError} onRefreshQualityMetrics={refreshQualityMetrics} onCreateTask={() => openCreationDialog('task')} onArchive={openArchiveConfirmation} onOpenTasks={() => navigateRoute({ view: 'tasks', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenAssets={() => navigateRoute({ view: 'assets', assetScope: 'project', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenDeliveries={() => navigateRoute({ view: 'deliveries', taskId: null, roundId: null, compareRoundIds: [], runId: null })} onOpenTask={(taskId) => navigateRoute(selectTask(route, taskId))} /> : null</>;
}
