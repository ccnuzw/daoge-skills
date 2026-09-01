export function nextSearchActiveIndex(current, key, resultCount) {
  if (!resultCount) return -1;
  if (key === 'ArrowDown') return (current + 1) % resultCount;
  if (key === 'ArrowUp') return current <= 0 ? resultCount - 1 : current - 1;
  return current;
}

export function searchKeyAction(current, key, resultCount) {
  if (key === 'ArrowDown' || key === 'ArrowUp') return { action: 'navigate', index: nextSearchActiveIndex(current, key, resultCount), preventDefault: resultCount > 0 };
  if (key === 'Enter' && current >= 0 && current < resultCount) return { action: 'commit', index: current, preventDefault: true };
  if (key === 'Escape') return { action: 'clear', index: -1, preventDefault: true };
  return { action: 'none', index: current, preventDefault: false };
}

export function createStudioSearchCoordinator({ request, schedule, cancelSchedule, delay = 260 }) {
  let epoch = 0;
  let controller = null;
  let timer = null;

  const cancel = () => {
    epoch += 1;
    controller?.abort();
    controller = null;
    if (timer !== null) cancelSchedule(timer);
    timer = null;
  };

  return {
    search(rawQuery, publish) {
      cancel();
      const query = String(rawQuery || '').trim();
      publish({ results: [], error: '', loading: Boolean(query) });
      if (!query) return;
      const requestEpoch = epoch;
      controller = new AbortController();
      const activeController = controller;
      timer = schedule(async () => {
        timer = null;
        try {
          const results = await request(query, activeController.signal);
          if (!activeController.signal.aborted && epoch === requestEpoch) publish({ results: results || [], error: '', loading: false });
        } catch (error) {
          if (!activeController.signal.aborted && epoch === requestEpoch && error?.name !== 'AbortError') publish({ results: [], error: error?.message || '无法搜索 Studio。', loading: false });
        }
      }, delay);
    },
    cancel,
    dispose: cancel
  };
}
