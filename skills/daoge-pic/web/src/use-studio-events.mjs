import { useEffect, useRef } from 'react';

export const STUDIO_EVENT_BATCH_LIMIT = 100;
const MAX_PENDING_EVENTS = STUDIO_EVENT_BATCH_LIMIT;
const EVENT_BATCH_DELAY_MS = 160;

export function studioCursorKey(studioId) {
  return 'daoge-pic:event-cursor:' + studioId;
}

export function studioEventRefreshPlan(events = []) {
  const values = Array.isArray(events) ? events : [];
  const global = values.some((event) => (event?.entityType === 'project' && event?.eventType !== 'project.selection_updated') || /^(?:task_type|style_kit|brand_kit|studio)\./.test(event?.eventType || ''));
  const detailEvent = (event) => ['task', 'creative_round', 'round', 'generation_run', 'run', 'run_item', 'asset', 'review'].includes(event?.entityType) || /^(task|round|run|run_item|asset|review)\./.test(event?.eventType || '');
  const planEvent = (event) => ['creative_round', 'round'].includes(event?.entityType) || /^(round|plan)\./.test(event?.eventType || '');
  const assetEvent = (event) => ['asset', 'review'].includes(event?.entityType) || /^(asset|review)\./.test(event?.eventType || '') || ['run.items_updated', 'project.selection_updated'].includes(event?.eventType);
  const contextEvent = (event) => ['task', 'creative_round', 'round', 'generation_run', 'run', 'run_item', 'delivery', 'delivery_batch'].includes(event?.entityType) || /^(task|round|run|run_item|delivery|delivery_batch)\./.test(event?.eventType || '');
  const refreshSelection = values.some((event) => event?.eventType === 'project.selection_updated' || /^asset\.(reviewed|trashed|restored|restored_reused)$/.test(event?.eventType || ''));
  const refreshSharedAssets = values.some((event) => /^asset\.(shared|unshared)_across_projects$/.test(event?.eventType || ''));
  const refreshContext = global || values.some(contextEvent);
  const refreshAssets = global || values.some(assetEvent);
  return {
    scope: global ? 'all' : 'context',
    refreshContext,
    refreshAssets,
    refreshSelection,
    refreshSharedAssets,
    taskOverview: values.some(detailEvent),
    creativeRecord: values.some(detailEvent),
    studioOverview: values.some(detailEvent),
    planVersions: values.some(planEvent),
    maximumRefreshes: (refreshContext ? 1 : 0) + (refreshAssets ? 1 : 0) + (refreshSelection ? 1 : 0) + (refreshSharedAssets ? 1 : 0) + (values.some(detailEvent) ? 1 : 0)
  };
}

function eventCursor(value) {
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}

export function createStudioEventStream({
  studioId,
  storage,
  createEventSource,
  setTimer,
  clearTimer,
  random = Math.random,
  getCallbacks,
  maxPendingEvents = MAX_PENDING_EVENTS,
  batchDelayMs = EVENT_BATCH_DELAY_MS
}) {
  const cursorKey = studioCursorKey(studioId);
  let cursor = eventCursor(storage.getItem(cursorKey));
  let source = null;
  let reconnectTimer = null;
  let batchTimer = null;
  let reconnectAttempt = 0;
  let disposed = false;
  let flushing = false;
  let overflowed = false;
  let pending = [];
  let maxObservedEventId = cursor;

  const callbacks = () => getCallbacks?.() || {};
  const writeCursor = (nextCursor) => {
    cursor = eventCursor(nextCursor);
    storage.setItem(cursorKey, String(cursor));
  };
  const commitEventCursor = (nextCursor) => writeCursor(Math.max(cursor, eventCursor(nextCursor)));
  const replaceSnapshotCursor = (nextCursor) => writeCursor(nextCursor);
  const closeSource = () => {
    source?.close();
    source = null;
  };
  const connect = () => {
    if (disposed || source) return;
    const nextSource = createEventSource('/api/events?after=' + cursor);
    source = nextSource;
    nextSource.addEventListener('studio-event', receive);
    nextSource.addEventListener('snapshot-required', snapshotRequired);
    nextSource.onmessage = receive;
    nextSource.onopen = () => {
      if (disposed || source !== nextSource) return;
      reconnectAttempt = 0;
      callbacks().onConnectionError?.('');
    };
    nextSource.onerror = () => {
      if (disposed || source !== nextSource) return;
      closeSource();
      callbacks().onConnectionError?.('实时连接暂时中断，正在恢复。');
      reconnect();
    };
  };
  const reconnect = (immediate = false) => {
    if (disposed || reconnectTimer) return;
    const delay = immediate ? 0 : Math.min(30000, 500 * 2 ** reconnectAttempt) + Math.floor(random() * 250);
    if (!immediate) reconnectAttempt += 1;
    reconnectTimer = setTimer(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };
  const failCurrentStream = (message) => {
    closeSource();
    pending = [];
    overflowed = false;
    callbacks().onRequestError?.(message);
    reconnect();
  };
  const flush = async () => {
    if (disposed || flushing || (!pending.length && !overflowed)) return;
    flushing = true;
    const events = pending;
    const requiresSnapshot = overflowed;
    const observedCursor = maxObservedEventId;
    pending = [];
    overflowed = false;
    try {
      const recovered = requiresSnapshot ? await callbacks().onSnapshot?.() : await callbacks().onEventBatch?.(events);
      if (recovered === false) throw new Error('refresh failed');
      if (requiresSnapshot) {
        commitEventCursor(observedCursor);
        closeSource();
        reconnectAttempt = 0;
        reconnect(true);
      } else if (events.length) {
        commitEventCursor(events.reduce((latest, event) => Math.max(latest, eventCursor(event.id)), cursor));
        reconnectAttempt = 0;
      }
    } catch {
      failCurrentStream(requiresSnapshot ? '实时事件超过安全批次，完整快照恢复失败，正在重试。' : '实时更新请求失败，正在从上次成功位置重试。');
    } finally {
      flushing = false;
      if (!disposed && (pending.length || overflowed) && !batchTimer) batchTimer = setTimer(() => { batchTimer = null; void flush(); }, batchDelayMs);
    }
  };
  const scheduleFlush = () => {
    if (!batchTimer && !flushing) batchTimer = setTimer(() => { batchTimer = null; void flush(); }, batchDelayMs);
  };
  function receive(message) {
    try {
      const event = JSON.parse(message.data);
      const id = eventCursor(event.id);
      if (!id || id <= cursor) return;
      maxObservedEventId = Math.max(maxObservedEventId, id);
      if (pending.length >= maxPendingEvents) {
        overflowed = true;
        pending = [];
        closeSource();
      } else if (!overflowed) {
        pending.push(event);
      }
      scheduleFlush();
    } catch {
      failCurrentStream('实时更新内容无效，正在从上次成功位置重试。');
    }
  }
  async function snapshotRequired(message) {
    if (disposed) return;
    closeSource();
    try {
      const snapshot = JSON.parse(message.data || '{}');
      const refreshed = await callbacks().onSnapshot?.();
      if (refreshed === false) throw new Error('snapshot refresh failed');
      replaceSnapshotCursor(snapshot.cursor);
      maxObservedEventId = cursor;
      reconnectAttempt = 0;
      callbacks().onConnectionError?.('');
      reconnect(true);
    } catch {
      callbacks().onRequestError?.('实时快照恢复失败，保留上次成功位置并退避重试。');
      reconnect();
    }
  }

  connect();
  return {
    dispose() {
      disposed = true;
      closeSource();
      if (reconnectTimer) clearTimer(reconnectTimer);
      if (batchTimer) clearTimer(batchTimer);
    },
    flushNow: flush,
    state: () => ({ cursor, pending: pending.length, overflowed, connected: Boolean(source) })
  };
}

export function useStudioEvents({ studioId, onEventBatch, onSnapshot, onConnectionError, onRequestError }) {
  const callbacks = useRef({ onEventBatch, onSnapshot, onConnectionError, onRequestError });
  callbacks.current = { onEventBatch, onSnapshot, onConnectionError, onRequestError };

  useEffect(() => {
    if (!studioId) return undefined;
    const stream = createStudioEventStream({
      studioId,
      storage: sessionStorage,
      createEventSource: (url) => new EventSource(url),
      setTimer: (callback, delay) => window.setTimeout(callback, delay),
      clearTimer: (timer) => window.clearTimeout(timer),
      getCallbacks: () => callbacks.current
    });
    return () => stream.dispose();
  }, [studioId]);
}
