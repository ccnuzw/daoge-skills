import { useCallback, useEffect, useRef } from 'react';

export function routeRefreshSignature(route) {
  return [route.view, route.projectId || '', route.taskId || '', route.roundId || '', (route.compareRoundIds || []).join('|'), route.runId || '', route.assetScope].join(':');
}

export function createLatestRequestGate() {
  let epoch = 0;
  let active = null;
  return {
    begin(signature) {
      epoch += 1;
      active?.controller.abort();
      const controller = new AbortController();
      const requestEpoch = epoch;
      const requestSignature = String(signature);
      active = { controller, epoch: requestEpoch, signature: requestSignature };
      return {
        signal: controller.signal,
        epoch: requestEpoch,
        signature: requestSignature,
        isCurrent: () => !controller.signal.aborted && active?.epoch === requestEpoch && active?.signature === requestSignature,
        abort: () => controller.abort()
      };
    },
    cancel() {
      epoch += 1;
      active?.controller.abort();
      active = null;
    }
  };
}

export function useRouteRefresh({ route, beforeRefresh, refreshGlobal, refreshContext, onError, onSettled }) {
  const callbacks = useRef({ beforeRefresh, refreshGlobal, refreshContext, onError, onSettled });
  const controller = useRef(null);
  const epoch = useRef(0);
  const globalSnapshot = useRef(null);
  const signature = routeRefreshSignature(route);
  callbacks.current = { beforeRefresh, refreshGlobal, refreshContext, onError, onSettled };

  const run = useCallback(async (requestedScope = 'all') => {
    const requestEpoch = ++epoch.current;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    const requestSignature = signature;
    const request = {
      signal: nextController.signal,
      epoch: requestEpoch,
      signature: requestSignature,
      isCurrent: () => !nextController.signal.aborted && epoch.current === requestEpoch && routeRefreshSignature(route) === requestSignature
    };
    try {
      await callbacks.current.beforeRefresh?.(request);
      const scope = requestedScope === 'context' && globalSnapshot.current ? 'context' : 'all';
      if (scope === 'all') {
        const nextGlobal = await callbacks.current.refreshGlobal(request);
        if (!request.isCurrent()) return false;
        globalSnapshot.current = nextGlobal;
      }
      await callbacks.current.refreshContext(globalSnapshot.current, request);
      return request.isCurrent();
    } catch (error) {
      if (error?.name !== 'AbortError' && request.isCurrent()) callbacks.current.onError?.(error);
      return false;
    } finally {
      if (controller.current === nextController) controller.current = null;
      if (request.isCurrent()) callbacks.current.onSettled?.();
    }
  }, [signature]);

  useEffect(() => {
    void run(globalSnapshot.current ? 'context' : 'all');
    return () => controller.current?.abort();
  }, [run]);

  useEffect(() => () => controller.current?.abort(), []);

  return {
    refreshAll: useCallback(() => run('all'), [run]),
    refreshContext: useCallback(() => run('context'), [run])
  };
}
