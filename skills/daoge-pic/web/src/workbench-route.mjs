export const WORKBENCH_VIEWS = ['assets', 'runs', 'studio-overview', 'library', 'deliveries', 'trash'];
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
  const compareRoundIds = [...new Set(params.getAll('round').map((value) => value.trim()).filter(Boolean))].slice(0, 12);
  return {
    view: known(params.get('view'), WORKBENCH_VIEWS, 'assets'),
    projectId: identifier(params, 'project'),
    taskId: identifier(params, 'task'),
    roundId: compareRoundIds[0] || null,
    compareRoundIds,
    runId: identifier(params, 'run'),
    assetScope: known(params.get('scope'), ASSET_SCOPES, 'round')
  };
}

export function serializeWorkbenchRoute(route) {
  const params = new URLSearchParams();
  params.set('view', known(route.view, WORKBENCH_VIEWS, 'assets'));
  if (route.projectId) params.set('project', route.projectId);
  if (route.taskId) params.set('task', route.taskId);
  for (const roundId of [...new Set(Array.isArray(route.compareRoundIds) ? route.compareRoundIds : route.roundId ? [route.roundId] : [])].slice(0, 12)) params.append('round', roundId);
  if (route.runId) params.set('run', route.runId);
  params.set('scope', known(route.assetScope, ASSET_SCOPES, 'round'));
  return '?' + params.toString();
}

export function updateWorkbenchRoute(route, changes) {
  return { ...route, ...changes };
}

export function selectProject(route, projectId) {
  return updateWorkbenchRoute(route, { projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null });
}

export function selectTask(route, taskId) {
  return updateWorkbenchRoute(route, { taskId, roundId: null, compareRoundIds: [], runId: null });
}

export function selectRound(route, roundId) {
  return updateWorkbenchRoute(route, { roundId, compareRoundIds: roundId ? [roundId] : [], runId: null });
}
