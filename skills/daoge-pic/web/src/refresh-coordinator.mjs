export function createTrailingTaskQueue(task) {
  let inFlight = null;
  let queued = false;
  let disposed = false;

  const request = () => {
    if (disposed) return Promise.resolve();
    queued = true;
    if (inFlight) return inFlight;
    const run = (async () => {
      let result;
      try {
        while (queued && !disposed) {
          queued = false;
          result = await task();
        }
        return result;
      } finally {
        inFlight = null;
      }
    })();
    inFlight = run;
    return run;
  };

  return {
    request,
    dispose() {
      disposed = true;
      queued = false;
    }
  };
}

export function mergeEventRefreshPlans(current, next) {
  if (!current) return next;
  const merged = {
    scope: current.scope === 'all' || next.scope === 'all' ? 'all' : 'context',
    taskOverview: Boolean(current.taskOverview || next.taskOverview),
    creativeRecord: Boolean(current.creativeRecord || next.creativeRecord),
    studioOverview: Boolean(current.studioOverview || next.studioOverview),
    planVersions: Boolean(current.planVersions || next.planVersions),
    refreshContext: Boolean(current.refreshContext || next.refreshContext),
    refreshAssets: Boolean(current.refreshAssets || next.refreshAssets),
    refreshSelection: Boolean(current.refreshSelection || next.refreshSelection),
    refreshSharedAssets: Boolean(current.refreshSharedAssets || next.refreshSharedAssets),
    refreshCanvasLayout: Boolean(current.refreshCanvasLayout || next.refreshCanvasLayout),
    canvasLayout: Boolean(current.canvasLayout || next.canvasLayout)
  };
  merged.maximumRefreshes = (merged.refreshContext ? 1 : 0) + (merged.refreshAssets ? 1 : 0) + (merged.refreshSelection ? 1 : 0) + (merged.refreshSharedAssets ? 1 : 0) + (merged.refreshCanvasLayout || merged.canvasLayout ? 1 : 0) + (merged.taskOverview || merged.creativeRecord || merged.studioOverview || merged.planVersions ? 1 : 0);
  return merged;
}

export function createEventRefreshQueue({ refresh, applyPlan }) {
  let pending = null;
  const queue = createTrailingTaskQueue(async () => {
    const plan = pending;
    pending = null;
    const refreshed = await refresh(plan);
    if (refreshed) applyPlan(plan);
    return refreshed;
  });
  return {
    request(plan) {
      pending = mergeEventRefreshPlans(pending, plan);
      return queue.request();
    },
    dispose() { queue.dispose(); }
  };
}
