import { DEFAULT_RUN_ITEM_FILTER, DEFAULT_RUN_ITEM_PAGE_SIZE, normalizeRunItemFilter, normalizeRunItemPageNumber, normalizeRunItemPageSize, normalizeRunItemSequence } from './run-item-pagination.mjs';

export const WORKBENCH_VIEWS = ['projects', 'project-overview', 'lineage', 'tasks', 'assets', 'runs', 'studio-overview', 'prompts', 'library', 'shared-assets', 'guide', 'deliveries', 'trash', 'troubleshoot'];
export const STUDIO_VIEWS = ['projects', 'library', 'shared-assets', 'guide', 'troubleshoot'];
export const ASSET_SCOPES = ['round', 'task', 'project', 'studio'];
const PROJECT_CONTEXT_STUDIO_VIEWS = ['library', 'guide'];
// The only views that actually render a run. Anywhere else a `runId` is a leftover from whichever view set it.
const RUN_RENDERING_VIEWS = ['runs', 'lineage'];

/**
 * 一次路由可以带上的全部字段。`normalizeRoute` 是每个入口的唯一收敛点，调用方只会传自己关心的
 * 那几个字段，缺的必须在归一化里补默认值 —— 所以这里的字段全部是可选的。
 * @typedef {object} WorkbenchRouteDraft
 * @property {string} [view]
 * @property {string|null} [projectId]
 * @property {string|null} [taskId]
 * @property {string|null} [roundId]
 * @property {string[]} [compareRoundIds]
 * @property {string|null} [runId]
 * @property {string} [assetScope]
 * @property {string|null} [runItemFilter]
 * @property {number|string|null} [runItemPage]
 * @property {number|string|null} [runItemPageSize]
 * @property {number|string|null} [runItemSequence]
 */

/**
 * 归一化之后的结果。与 draft 的区别只有两点：字段一定有值（缺的补 null / 默认值），
 * 以及「单张出图」相关的四个字段只在 runs 视图下存在。
 * @typedef {object} NormalizedWorkbenchRoute
 * @property {string} view
 * @property {string|null} projectId
 * @property {string|null} taskId
 * @property {string|null} roundId
 * @property {string[]} compareRoundIds
 * @property {string|null} runId
 * @property {string} assetScope
 * @property {string} [runItemFilter]
 * @property {number} [runItemPage]
 * @property {number} [runItemPageSize]
 * @property {number|null} [runItemSequence]
 */

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

/**
 * 上下文层级：由 project / task / round 三个 id 的存在性**唯一决定**，不需要另外存一个字段。
 *
 * ⚠️ 它**不是** `assetScope`：`assetScope` 是「看哪一层的资产」这个**筛选范围**，
 * 两者只在「未指定 scope 时跟随上下文」这一处默认值上有关系。
 * 把这两个概念混为一谈，会让「筛选范围」看起来像层级、也让层级看起来像可选状态。
 *
 * @param {{projectId?: string|null, taskId?: string|null, roundId?: string|null}} route
 * @returns {'studio'|'project'|'task'|'round'}
 */
export function contextLevelOf(route) {
  if (route?.roundId) return 'round';
  if (route?.taskId) return 'task';
  if (route?.projectId) return 'project';
  return 'studio';
}

function studioViewKeepsProject(view) {
  return PROJECT_CONTEXT_STUDIO_VIEWS.includes(view);
}
function runItemControls(route) {
  return {
    runItemFilter: normalizeRunItemFilter(route.runItemFilter),
    runItemPage: normalizeRunItemPageNumber(route.runItemPage),
    runItemPageSize: normalizeRunItemPageSize(route.runItemPageSize),
    runItemSequence: normalizeRunItemSequence(route.runItemSequence)
  };
}


/** @param {WorkbenchRouteDraft} route @returns {NormalizedWorkbenchRoute} */
function normalizeRoute(route) {
  const view = known(route.view, WORKBENCH_VIEWS, 'projects');
  const controls = view === 'runs' ? runItemControls(route) : {};
  if (isStudioView(view)) {
    const projectId = studioViewKeepsProject(view) ? route.projectId || null : null;
    return { view, projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: projectId ? 'project' : 'studio' };
  }
  const projectId = route.projectId || null;
  if (!projectId) return { view: 'projects', projectId: null, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'studio' };
  const taskId = route.taskId || null;
  let compareRoundIds = [...new Set(Array.isArray(route.compareRoundIds) ? route.compareRoundIds : route.roundId ? [route.roundId] : [])].filter(Boolean).slice(0, 12);
  // The context hierarchy is project > task > round > run, and a round only resolves against its own task. An id
  // that arrives without its parent is not a usable context: it used to survive on the asset/overview views and
  // made the Workbench answer with 「请先选择一个任务，再继续查看轮次或运行。」.
  if (!taskId) compareRoundIds = [];
  // `roundId` 是 `compareRoundIds[0]`（主轮次）的**派生快捷方式**——两者的一致性由守卫测试锁住，
  // 所以这里只从 compareRoundIds 派发，不单独接受一个 roundId 输入。
  const roundId = compareRoundIds[0] || null;
  // 未指定 scope 时跟随上下文层级 —— 这是「筛选范围」（assetScope）与「上下文层级」唯一的关联点。
  // 层级由 id 推导（contextLevelOf），不单独存储；assetScope 只表达「看哪一层的资产」。
  const contextLevel = contextLevelOf({ projectId, taskId, roundId });
  const suppliedScope = known(route.assetScope, ASSET_SCOPES, contextLevel);
  let requestedScope = ['assets', 'lineage'].includes(view) && suppliedScope === 'studio' ? contextLevel : suppliedScope;
  // A scope level must be backed by the context that level needs. These two guards used to run for `lineage` only,
  // so `?view=assets&task=t&scope=round` kept a round scope with no round behind it and `assetRefreshPath` answered
  // with null — the asset list then silently stayed on whatever it showed before. Degrading the scope keeps the
  // route self-consistent for every view, so the "which ids does this scope need" guards downstream become moot.
  if (requestedScope === 'round' && !roundId) requestedScope = taskId ? 'task' : 'project';
  if (requestedScope === 'task' && !taskId) requestedScope = 'project';
  const projectViews = ['project-overview', 'tasks', 'deliveries', 'trash'];
  if (projectViews.includes(view)) {
    return { view, projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' };
  }
  if (view === 'assets' && requestedScope === 'project') {
    return { view, projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' };
  }
  const taskViews = ['studio-overview', 'prompts', 'runs'];
  if (taskViews.includes(view) && !taskId) return { view: 'tasks', projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' };
  if (['prompts', 'runs'].includes(view) && !roundId) return { view: 'studio-overview', projectId, taskId, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' };
  // `runId` survives only on the views that render a run. `updateWorkbenchRoute` merges rather than replaces, so
  // switching tabs used to carry the previous `run=` into 「计划」/「结果」/「轮次对比」, and the context loader then
  // answered with 「请先打开生成运行视图，再继续查看运行。」 on pages that have nothing to do with runs. Enforcing
  // it here — instead of adding `runId: null` to each tab's own changes — makes the invariant structural: a new
  // tab cannot reintroduce a stale value, and a hand-edited or bookmarked URL is normalized on the way in too.
  const runId = RUN_RENDERING_VIEWS.includes(view) ? route.runId || null : null;
  return { view, projectId, taskId, roundId, compareRoundIds, runId, assetScope: requestedScope, ...controls };
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
    assetScope: params.get('scope'),
    runItemFilter: params.get('itemFilter'),
    runItemPage: params.get('itemPage'),
    runItemPageSize: params.get('itemPageSize'),
    runItemSequence: params.get('itemSequence')
  });
}

export function serializeWorkbenchRoute(route) {
  const normalized = normalizeRoute(route);
  const params = new URLSearchParams();
  params.set('view', normalized.view);
  if (isStudioView(normalized.view)) {
    if (studioViewKeepsProject(normalized.view) && normalized.projectId) params.set('project', normalized.projectId);
  } else {
    params.set('project', normalized.projectId);
    if (normalized.taskId) params.set('task', normalized.taskId);
    for (const roundId of normalized.compareRoundIds) params.append('round', roundId);
    if (normalized.runId) params.set('run', normalized.runId);
    params.set('scope', normalized.assetScope);
    if (normalized.view === 'runs') {
      if (normalized.runItemFilter !== DEFAULT_RUN_ITEM_FILTER) params.set('itemFilter', normalized.runItemFilter);
      if (normalized.runItemPage !== 1) params.set('itemPage', String(normalized.runItemPage));
      if (normalized.runItemPageSize !== DEFAULT_RUN_ITEM_PAGE_SIZE) params.set('itemPageSize', String(normalized.runItemPageSize));
      if (normalized.runItemSequence !== null) params.set('itemSequence', String(normalized.runItemSequence));
    }
  }
  return '?' + params.toString();
}

export function updateWorkbenchRoute(route, changes) {
  return normalizeRoute({ ...route, ...changes });
}

export function selectProject(route, projectId) {
  return normalizeRoute({ ...route, view: 'lineage', projectId, taskId: null, roundId: null, compareRoundIds: [], runId: null, assetScope: 'project' });
}

export function selectTask(route, taskId) {
  return normalizeRoute({ ...route, view: 'lineage', taskId, roundId: null, compareRoundIds: [], runId: null, assetScope: 'task' });
}

export function selectRound(route, roundId) {
  return normalizeRoute({ ...route, roundId, compareRoundIds: roundId ? [roundId] : [], runId: null, assetScope: 'round' });
}
