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
