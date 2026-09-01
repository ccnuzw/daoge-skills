export const WORKBENCH_VIEWS = ['projects', 'project-overview', 'tasks', 'assets', 'runs', 'studio-overview', 'prompts', 'library', 'shared-assets', 'guide', 'deliveries', 'trash'];
export const STUDIO_VIEWS = ['projects', 'library', 'shared-assets', 'guide'];
export const ASSET_SCOPES = ['round', 'task', 'project', 'studio'];

export const WORKBENCH_VIEW_RENDERERS = Object.freeze(Object.fromEntries(WORKBENCH_VIEWS.map((view) => [view, view])));

export function rendererForWorkbenchView(view) {
  return WORKBENCH_VIEW_RENDERERS[view] || WORKBENCH_VIEW_RENDERERS.projects;
}

function known(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function identifier(params, name) {
  const value = params.get(name);
  return value && value.trim() ? value.trim() : null;
}

export function isStudioView(view) {
  return STUDIO_VIEWS.includes(view);
}

function normalizeRoute(route) {
  const view = known(route.view, WORKBENCH_VIEWS, 'projects');
  if (isStudioView(view)) return { view, projectId: null, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'studio' };
  const projectId = route.projectId || null;
  if (!projectId) return { view: 'projects', projectId: null, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'studio' };
  const suppliedScope = known(route.assetScope, ASSET_SCOPES, route.taskId ? 'task' : 'project');
  const requestedScope = view === 'assets' && suppliedScope === 'studio' ? route.taskId ? 'task' : 'project' : suppliedScope;
  const projectViews = ['project-overview', 'tasks', 'deliveries', 'trash'];
  if (projectViews.includes(view)) {
    return { view, projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' };
  }
  if (view === 'assets' && requestedScope === 'project') {
    return { view, projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' };
  }
  const taskId = route.taskId || null;
  const compareRoundIds = [...new Set(Array.isArray(route.compareRoundIds) ? route.compareRoundIds : route.roundId ? [route.roundId] : [])].filter(Boolean).slice(0, 12);
  const roundId = compareRoundIds[0] || null;
  const taskViews = ['studio-overview', 'prompts', 'runs'];
  if (taskViews.includes(view) && !taskId) return { view: 'tasks', projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' };
  if (['prompts', 'runs'].includes(view) && !roundId) return { view: 'studio-overview', projectId, taskId, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' };
  return { view, projectId, taskId, roundId, compareRoundIds, runId: route.runId || null, assetScope: requestedScope };
}

export function parseWorkbenchRoute(search = '') {
  const params = new URLSearchParams(search);
  const compareRoundIds = [...new Set(params.getAll('round').map((value) => value.trim()).filter(Boolean))].slice(0, 12);
  return normalizeRoute({
    view: params.get('view'),
    projectId: identifier(params, 'project'),
    taskId: identifier(params, 'task'),
    roundId: compareRoundIds[0] || null,
    compareRoundIds,
    runId: identifier(params, 'run'),
    assetScope: params.get('scope')
  });
}

export function serializeWorkbenchRoute(route) {
  const normalized = normalizeRoute(route);
  const params = new URLSearchParams();
  params.set('view', normalized.view);
  if (!isStudioView(normalized.view)) {
    params.set('project', normalized.projectId);
    if (normalized.taskId) params.set('task', normalized.taskId);
    for (const roundId of normalized.compareRoundIds) params.append('round', roundId);
    if (normalized.runId) params.set('run', normalized.runId);
    params.set('scope', normalized.assetScope);
  }
  return '?' + params.toString();
}

export function updateWorkbenchRoute(route, changes) {
  return normalizeRoute({ ...route, ...changes });
}

export function selectProject(route, projectId) {
  return normalizeRoute({ ...route, view: 'project-overview', projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
}

export function selectTask(route, taskId) {
  return normalizeRoute({ ...route, view: 'studio-overview', taskId, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
}

export function selectRound(route, roundId) {
  return normalizeRoute({ ...route, roundId, compareRoundIds: roundId ? [roundId] : [], runId: null, assetScope: 'round' });
}
