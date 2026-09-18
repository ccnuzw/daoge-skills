import { useCallback, useEffect, useRef, useState } from 'react';
import { requestContextFor, pendingRequestCount } from './request-queue-model.mjs';

const EMPTY = Object.freeze([]);

/**
 * 请求队列的前端接线（方案 4.2）。
 *
 * 队列是唯一事实源（`studio_requests`），前端不造影子状态：
 * 列表来自 `GET /api/requests`，SSE 收到 `request.*` 事件后重取；发起与撤回都落库。
 * `eventRevision` 由事件的刷新计划驱动，`refresh` 闭包保持稳定。
 *
 * @param {object} input
 * @param {(path: string, options?: object) => Promise<any>} input.api
 * @param {number} input.eventRevision 队列相关事件的版本号（变了就重取）
 * @param {(error: unknown, fallback: string, options?: object) => void} input.reportError
 */
export function useRequestQueue({ api, eventRevision, reportError }) {
  const [requests, setRequests] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const requestGate = useRef(null);
  requestGate.current ||= { current: null, epoch: 0 };

  const refresh = useCallback(async () => {
    const gate = requestGate.current;
    const epoch = ++gate.epoch;
    try {
      const data = await api('/api/requests?limit=50');
      if (gate.epoch === epoch) setRequests(Array.isArray(data.requests) ? data.requests : EMPTY);
    } catch (error) {
      if (gate.epoch === epoch) reportError(error, '无法读取请求队列。', { operation: 'load-requests', phase: 'loading' });
    }
  }, [api, reportError]);

  useEffect(() => { void refresh(); }, [refresh, eventRevision]);

  const send = useCallback(async (text, context) => {
    const body = requestContextFor(context);
    const value = String(text || '').trim();
    if (!value || !body.canSend || busy) return false;
    setBusy(true);
    try {
      // 只把「用户说的话」送进队列；上下文随之落库，不依赖 session（方案 4.2）。
      await api('/api/requests', { method: 'POST', idempotencyKey: 'request-' + Date.now(), body: { text: value, projectId: body.projectId, taskId: body.taskId, roundId: body.roundId, ...(body.previousRequestId ? { previousRequestId: body.previousRequestId } : {}), assetIds: body.assetIds, ...(body.intent ? { intent: body.intent } : {}), ...(body.runId ? { runId: body.runId } : {}), ...(body.itemIds.length ? { itemIds: body.itemIds } : {}) } });
      await refresh();
      return true;
    } catch (error) {
      reportError(error, '无法把这句话放进队列。', { operation: 'create-request', phase: 'committing' });
      return false;
    } finally {
      setBusy(false);
    }
  }, [api, busy, refresh, reportError]);

  const withdraw = useCallback(async (requestId) => {
    setBusy(true);
    try {
      await api('/api/requests/' + encodeURIComponent(requestId) + '/withdraw', { method: 'POST', idempotencyKey: 'request-withdraw-' + requestId, body: {} });
      await refresh();
    } catch (error) {
      reportError(error, '无法撤回这条请求。', { operation: 'withdraw-request', phase: 'committing' });
    } finally {
      setBusy(false);
    }
  }, [api, refresh, reportError]);

  return { requests, pendingCount: pendingRequestCount(requests), busy, send, withdraw, refresh };
}
