import { ProjectTaskList } from '../app/project-surfaces.jsx';
import { selectTask } from '../workbench-route.mjs';

/** 界面批 E（E1.6）从 main.jsx 的 viewRenderers 拆出（行为零变化）。 */
export function TasksView({ navigateRoute, openCreationDialog, route, selectedProject, tasks }) {
  return <>selectedProject ? <ProjectTaskList project={selectedProject} tasks={tasks} onCreateTask={() => openCreationDialog('task')} onOpenTask={(taskId) => navigateRoute(selectTask(route, taskId))} /> : null</>;
}
