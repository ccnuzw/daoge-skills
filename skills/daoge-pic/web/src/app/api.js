import { WORKBENCH_PROTOCOL_VERSION } from '../version-negotiation-model.mjs';
import { createWorkbenchError, isAbortError } from '../error-model.mjs';

/** Workbench 的统一请求口与它的 5 个小助手（界面批 E 从 main.jsx 搬出，行为零变化）。 */
export function isReadRequest(method) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method);
}

export function apiErrorOptions(options, overrides = {}) {
  const modelOptions = {};
  for (const key of ['category', 'code', 'requestId', 'phase', 'operation', 'resource', 'retryable', 'safeToRetry', 'mayHaveCommitted', 'possibleCommitted']) {
    if (options?.[key] !== undefined) modelOptions[key] = options[key];
  }
  return { ...modelOptions, ...overrides };
}

export function retryOptions(options) {
  const next = { ...options };
  delete next.signal;
  delete next.retry;
  return next;
}

export function safeApiError(payload) {
  const source = payload?.error && typeof payload.error === 'object' && !Array.isArray(payload.error) ? payload.error : payload;
  const rawDetails = source?.details ?? payload?.details;
  const details = rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails) ? rawDetails : null;
  const value = (key) => source?.[key] ?? payload?.[key];
  return {
    code: value('code'),
    kind: value('kind'),
    category: value('category'),
    message: value('message'),
    requestId: value('requestId') ?? details?.requestId,
    retryable: value('retryable'),
    safeToRetry: value('safeToRetry'),
    phase: value('phase'),
    mayHaveCommitted: value('mayHaveCommitted'),
    possibleCommitted: value('possibleCommitted'),
    partial: value('partial'),
    succeeded: value('succeeded'),
    failed: value('failed'),
    succeededCount: value('succeededCount'),
    failedCount: value('failedCount'),
    details: details ? {
      code: details.code,
      phase: details.phase,
      partial: details.partial,
      succeeded: details.succeeded,
      failed: details.failed,
      succeededCount: details.succeededCount,
      failedCount: details.failedCount,
      requestId: details.requestId
    } : undefined
  };
}

export function payloadPhase(payload) {
  return payload?.error?.phase || payload?.phase || payload?.details?.phase || '';
}

export async function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const readRequest = isReadRequest(method);
  const hasRawBody = Object.prototype.hasOwnProperty.call(options, 'rawBody');
  const hasJsonBody = !hasRawBody && options.body !== undefined;
  const requestOptions = retryOptions(options);
  const canReplay = readRequest || Boolean(options.idempotencyKey);
  const retry = canReplay ? (typeof options.retry === 'function' ? options.retry : () => api(path, requestOptions)) : null;
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: {
        accept: 'application/json',
        'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/' + WORKBENCH_PROTOCOL_VERSION,
        ...(hasJsonBody ? { 'content-type': 'application/json' } : {}),
        ...(options.contentType ? { 'content-type': options.contentType } : {}),
        ...(options.headers || {}),
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {})
      },
      body: hasRawBody ? options.rawBody : hasJsonBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw createWorkbenchError({ category: 'connection', message: error?.message }, apiErrorOptions(options, {
      category: 'connection',
      phase: options.phase || (readRequest ? 'loading' : 'requesting'),
      ...(options.mayHaveCommitted === undefined ? { mayHaveCommitted: !readRequest && !options.idempotencyKey } : {})
    }), retry);
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw createWorkbenchError({ code: 'invalid_response', status: response.status, headers: response.headers }, apiErrorOptions(options, {
      code: 'invalid_response',
      phase: options.phase || (readRequest ? 'loading' : 'receiving'),
      ...(options.mayHaveCommitted === undefined ? { mayHaveCommitted: !readRequest && !options.idempotencyKey } : {})
    }), retry);
  }
  if (!response.ok || !payload?.ok) {
    const unsafeReplay = !readRequest && !options.idempotencyKey;
    throw createWorkbenchError({ error: safeApiError(payload), status: response.status, headers: response.headers }, apiErrorOptions(options, {
      phase: options.phase || payloadPhase(payload) || 'response',
      ...(unsafeReplay ? { safeToRetry: false } : {})
    }), retry);
  }
  return payload.data;
}
