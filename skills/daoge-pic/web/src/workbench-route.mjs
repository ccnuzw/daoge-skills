export const WORKBENCH_VIEWS = ['assets', 'runs', 'library', 'deliveries', 'trash'];
export const ASSET_SCOPES = ['round', 'task', 'project', 'studio'];

function known(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function identifier(params, name) {
  const value = params.get(name);
  return value && value.trim() ? value.trim() : null;
}

export function parseWorkbenchRoute(search = '') {
  const params = new URLSearchParams(search);
  return {
    view: known(params.get('view'), WORKBENCH_VIEWS, 'assets'),
    projectId: identifier(params, 'project'),
    taskId: identifier(params, 'task'),
    roundId: identifier(params, 'round'),
    runId: identifier(params, 'run'),
    assetScope: known(params.get('scope'), ASSET_SCOPES, 'round')
  };
}

export function serializeWorkbenchRoute(route) {
  const params = new URLSearchParams();
  params.set('view', known(route.view, WORKBENCH_VIEWS, 'assets'));
  if (route.projectId) params.set('project', route.projectId);
  if (route.taskId) params.set('task', route.taskId);
  if (route.roundId) params.set('round', route.roundId);
  if (route.runId) params.set('run', route.runId);
  params.set('scope', known(route.assetScope, ASSET_SCOPES, 'round'));
  return '?' + params.toString();
}

export function updateWorkbenchRoute(route, changes) {
  return { ...route, ...changes };
}

export function selectProject(route, projectId) {
  return updateWorkbenchRoute(route, { projectId, taskId: null, roundId: null, runId: null });
}

export function selectTask(route, taskId) {
  return updateWorkbenchRoute(route, { taskId, roundId: null, runId: null });
}

export function selectRound(route, roundId) {
  return updateWorkbenchRoute(route, { roundId, runId: null });
}
