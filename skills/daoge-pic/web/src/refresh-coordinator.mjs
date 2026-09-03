export function createTrailingTaskQueue(task) {
  let inFlight = null;
  let queued = false;
  let disposed = false;

  const request = () => {
    if (disposed) return Promise.resolve();
    queued = true;
    if (inFlight) return inFlight;
    const run = (async () => {
      try {
        while (queued && !disposed) {
          queued = false;
          await task();
        }
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
  return {
    scope: current.scope === 'all' || next.scope === 'all' ? 'all' : 'context',
    taskOverview: current.taskOverview || next.taskOverview,
    creativeRecord: current.creativeRecord || next.creativeRecord,
    studioOverview: current.studioOverview || next.studioOverview,
    planVersions: current.planVersions || next.planVersions,
    refreshContext: current.refreshContext || next.refreshContext,
    refreshAssets: current.refreshAssets || next.refreshAssets,
    refreshSelection: Boolean(current.refreshSelection || next.refreshSelection),
    refreshSharedAssets: Boolean(current.refreshSharedAssets || next.refreshSharedAssets)
  };
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
