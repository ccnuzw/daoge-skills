// SSE 事件 → 状态槽刷新的纯决策逻辑。
//
// 规则只有这一份：`web/src/use-studio-events.mjs` 只管 I/O（EventSource、定时器、游标持久化）
// 并调用这里的决策函数；Workbench（`web/src/app/workbench-controller.jsx`）通过
// use-studio-events 转发的 `studioEventRefreshPlan` 取同一份规则。不要在别处再写一份判断。
//
// 三条不变量（与 `/api/events?after=<cursor>` 协议一致）：
// 1. 游标只前进：普通批量提交取 `max(当前游标, 本批最大 id)`，乱序/重复/过期 id 都不会让游标回退；
// 2. 游标过期（`snapshot-required`）时，必须先恢复权威快照——恢复之前游标原地不动，
//    「先推进再补快照」会把快照窗口里的事件当成已消费，状态槽就永久缺一段；
// 3. 快照恢复成功后，游标以服务器给出的 `snapshotCursor` 为准：它是权威位置，允许低于
//    本地已观测到的 id（本地可能读到了服务端已不再重放的窗口）。

export function eventCursor(value) {
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}

/** 只前进：非法的下一个游标退回当前值，小于当前值的下一个游标同样被忽略。 */
export function advanceEventCursor(currentCursor, nextCursor) {
  return Math.max(eventCursor(currentCursor), eventCursor(nextCursor));
}

/** 单条事件的准入判断：返回可接受的 id，过期/重复/非法 id 一律返回 0（调用方按「丢弃」处理）。 */
export function acceptEventId(currentCursor, eventId) {
  const id = eventCursor(eventId);
  return id > eventCursor(currentCursor) ? id : 0;
}

/** 一批事件的游标：取本批最大 id 与当前游标的较大者，与到达顺序无关。 */
export function studioEventBatchCursor(currentCursor, events = []) {
  const values = Array.isArray(events) ? events : [];
  let cursor = eventCursor(currentCursor);
  for (const event of values) cursor = Math.max(cursor, eventCursor(event?.id));
  return cursor;
}

/**
 * `snapshot-required` 的游标决策。
 *
 * 返回 `requiresSnapshot: true` 表示必须先拉权威快照；`cursor` 是此刻**可以提交**的游标：
 * - `snapshotRestored: false`（快照还没回来）：cursor 保持上次成功位置，既不推进也不回退；
 * - `snapshotRestored: true`（快照已恢复）：cursor 落在服务器给的 snapshotCursor 上。
 *
 * @param {{ currentCursor?: number|string|null, snapshotCursor?: number|string|null, snapshotRestored?: boolean }} [options]
 * @returns {{ requiresSnapshot: boolean, snapshotCursor: number, cursor: number, authoritativeReplace: boolean }}
 */
export function studioSnapshotRecovery({ currentCursor = 0, snapshotCursor, snapshotRestored = false } = {}) {
  const held = eventCursor(currentCursor);
  const authoritative = eventCursor(snapshotCursor);
  if (!snapshotRestored) return { requiresSnapshot: true, snapshotCursor: authoritative, cursor: held, authoritativeReplace: false };
  return { requiresSnapshot: false, snapshotCursor: authoritative, cursor: authoritative, authoritativeReplace: true };
}

export function studioEventRefreshPlan(events = []) {
  const values = Array.isArray(events) ? events : [];
  const runtimeProviderEvent = (event) => /^daemon\.provider_config_(?:pending|applied)$/.test(event?.eventType || '');
  const global = values.some((event) => runtimeProviderEvent(event) || (event?.entityType === 'project' && event?.eventType !== 'project.selection_updated') || /^(?:task_type|style_kit|brand_kit|studio)\./.test(event?.eventType || ''));
  const detailEvent = (event) => ['task', 'creative_round', 'round', 'generation_run', 'run', 'run_item', 'asset', 'review'].includes(event?.entityType) || /^(task|round|run|run_item|asset|review)\./.test(event?.eventType || '');
  const planEvent = (event) => ['creative_round', 'round'].includes(event?.entityType) || /^(round|plan)\./.test(event?.eventType || '');
  const assetEvent = (event) => ['asset', 'review'].includes(event?.entityType) || /^(asset|review)\./.test(event?.eventType || '') || ['run.items_updated', 'project.selection_updated'].includes(event?.eventType);
  const contextEvent = (event) => ['task', 'creative_round', 'round', 'generation_run', 'run', 'run_item', 'delivery', 'delivery_batch'].includes(event?.entityType) || /^(task|round|run|run_item|delivery|delivery_batch)\./.test(event?.eventType || '');
  const canvasLayoutEvent = (event) => event?.entityType === 'canvas_layout' || /^canvas_layout\./.test(event?.eventType || '');
  // 请求队列的事件（created/accepted/done/rejected/lease_expired）驱动队列重取；
  // 「accepted 立刻推回 Studio」靠的就是这条（方案 4.2：静默是最大的坑）。
  const requestEvent = (event) => event?.entityType === 'request' || /^request\./.test(event?.eventType || '');
  const refreshSelection = values.some((event) => event?.eventType === 'project.selection_updated' || /^asset\.(reviewed|trashed|restored|restored_reused)$/.test(event?.eventType || ''));
  const refreshSharedAssets = values.some((event) => /^asset\.(shared|unshared)_across_projects$/.test(event?.eventType || ''));
  const refreshContext = global || values.some(contextEvent);
  const refreshAssets = global || values.some(assetEvent);
  const refreshCanvasLayout = values.some(canvasLayoutEvent);
  return {
    scope: global ? 'all' : 'context',
    refreshContext,
    refreshAssets,
    refreshSelection,
    refreshSharedAssets,
    refreshCanvasLayout,
    taskOverview: values.some(detailEvent),
    creativeRecord: values.some(detailEvent),
    studioOverview: values.some(detailEvent),
    planVersions: values.some(planEvent),
    canvasLayout: refreshCanvasLayout,
    requests: values.some(requestEvent),
    maximumRefreshes: (refreshContext ? 1 : 0) + (refreshAssets ? 1 : 0) + (refreshSelection ? 1 : 0) + (refreshSharedAssets ? 1 : 0) + (refreshCanvasLayout ? 1 : 0) + (values.some(detailEvent) ? 1 : 0) + (values.some(requestEvent) ? 1 : 0)
  };
}

/**
 * 数据域：一批事件要重取哪些东西。字典序固定，且由 plan 标记推导——
 * 域列表只是 plan 的稳定、去重视图，判定规则仍然只有 `studioEventRefreshPlan` 一份。
 * 同名域只出现一次；同一批事件永远得到同一个数组。
 */
export const STUDIO_REFRESH_DOMAINS = Object.freeze(['asset', 'canvas-layout', 'delivery', 'item', 'plan', 'request', 'run', 'selection', 'shared-asset']);

const DOMAIN_SOURCES = Object.freeze({
  // 上下文重取会一并把 run 列表与交付列表拉回来（Workbench 的 runs 槽同样挂在 refreshContext 上）。
  run: (plan) => Boolean(plan.refreshContext),
  delivery: (plan) => Boolean(plan.refreshContext),
  // 明细/概览槽在具体业务事件下一起刷新。
  item: (plan) => Boolean(plan.taskOverview || plan.creativeRecord || plan.studioOverview),
  asset: (plan) => Boolean(plan.refreshAssets),
  selection: (plan) => Boolean(plan.refreshSelection),
  'shared-asset': (plan) => Boolean(plan.refreshSharedAssets),
  plan: (plan) => Boolean(plan.planVersions),
  request: (plan) => Boolean(plan.requests),
  'canvas-layout': (plan) => Boolean(plan.refreshCanvasLayout || plan.canvasLayout)
});

export function studioRefreshDomains(plan) {
  if (!plan || typeof plan !== 'object') return [];
  return STUDIO_REFRESH_DOMAINS.filter((domain) => DOMAIN_SOURCES[domain](plan));
}

/** 一批事件的完整决策：只前进的游标 + 刷新计划 + 稳定去重的域列表。 */
export function studioEventBatchDecision(events = [], currentCursor = 0) {
  const values = Array.isArray(events) ? events : [];
  const plan = studioEventRefreshPlan(values);
  return { cursor: studioEventBatchCursor(currentCursor, values), plan, domains: studioRefreshDomains(plan) };
}