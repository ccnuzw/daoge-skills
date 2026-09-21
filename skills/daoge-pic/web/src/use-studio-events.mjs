import { useEffect, useRef } from 'react';
import { acceptEventId, advanceEventCursor, eventCursor, studioEventBatchDecision, studioSnapshotRecovery } from './studio-events-model.mjs';

// 规则本体在 studio-events-model.mjs（纯逻辑、可单测）；这条导出是给 Workbench 与测试用的门面，
// 不要在这里再写第二份判断。
export { studioEventRefreshPlan } from './studio-events-model.mjs';

export const STUDIO_EVENT_BATCH_LIMIT = 100;
const MAX_PENDING_EVENTS = STUDIO_EVENT_BATCH_LIMIT;
const EVENT_BATCH_DELAY_MS = 160;

export function studioCursorKey(studioId) {
  return 'daoge-pic:event-cursor:' + studioId;
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
  // 最近一次事件批量刷新的数据域（快照恢复后清空：那是全量权威刷新，不按域记账）。
  let domains = [];

  const callbacks = () => getCallbacks?.() || {};
  const writeCursor = (nextCursor) => {
    cursor = eventCursor(nextCursor);
    storage.setItem(cursorKey, String(cursor));
  };
  // 普通事件只前进：乱序/重复/过期 id 都不允许把游标拉回去。
  const commitEventCursor = (nextCursor) => writeCursor(advanceEventCursor(cursor, nextCursor));
  const replaceSnapshotCursor = (nextCursor) => writeCursor(nextCursor);
  const closeSource = () => {
    source?.close();
    source = null;
  };
  const clearBatchTimer = () => {
    if (!batchTimer) return;
    clearTimer(batchTimer);
    batchTimer = null;
  };
  const discardBufferedEvents = () => {
    clearBatchTimer();
    pending = [];
    overflowed = false;
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
      const reconnected = reconnectAttempt > 0;
      reconnectAttempt = 0;
      callbacks().onConnectionError?.('');
      if (reconnected) void callbacks().onReconnected?.();
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
    discardBufferedEvents();
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
    // 同一批事件 → 同一份决定（只前进的游标 + 刷新计划 + 稳定去重的数据域）。
    const decision = requiresSnapshot ? null : studioEventBatchDecision(events, cursor);
    try {
      const recovered = requiresSnapshot ? await callbacks().onSnapshot?.() : await callbacks().onEventBatch?.(events, decision);
      if (recovered === false) throw new Error('refresh failed');
      if (requiresSnapshot) {
        commitEventCursor(observedCursor);
        domains = [];
        closeSource();
        reconnectAttempt = 0;
        reconnect(true);
      } else {
        commitEventCursor(decision.cursor);
        domains = decision.domains;
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
      const id = acceptEventId(cursor, event?.id);
      if (!id) return;
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
    discardBufferedEvents();
    // 快照恢复之前游标原地不动（也不回退）；恢复成功后才按权威 snapshotCursor 推进。
    let held = eventCursor(cursor);
    try {
      const snapshot = JSON.parse(message.data || '{}');
      held = studioSnapshotRecovery({ currentCursor: cursor, snapshotCursor: snapshot.cursor }).cursor;
      replaceSnapshotCursor(held);
      const refreshed = await callbacks().onSnapshot?.();
      if (refreshed === false) throw new Error('snapshot refresh failed');
      const restored = studioSnapshotRecovery({ currentCursor: cursor, snapshotCursor: snapshot.cursor, snapshotRestored: true }).cursor;
      replaceSnapshotCursor(restored);
      maxObservedEventId = restored;
      domains = [];
      reconnectAttempt = 0;
      callbacks().onConnectionError?.('');
      reconnect(true);
    } catch {
      // 快照没恢复成功：停在 held（上次成功位置），退避重试。
      replaceSnapshotCursor(held);
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
    state: () => ({ cursor, pending: pending.length, overflowed, connected: Boolean(source), domains })
  };
}

export function useStudioEvents({ studioId, onEventBatch, onSnapshot, onConnectionError, onReconnected, onRequestError }) {
  const callbacks = useRef({ onEventBatch, onSnapshot, onConnectionError, onReconnected, onRequestError });
  callbacks.current = { onEventBatch, onSnapshot, onConnectionError, onReconnected, onRequestError };

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
