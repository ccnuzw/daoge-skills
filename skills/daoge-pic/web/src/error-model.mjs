const MAX_CODE_LENGTH = 64;
const MAX_REQUEST_ID_LENGTH = 96;
const MAX_TEXT_LENGTH = 160;
const MAX_CONTEXT_DEPTH = 3;
const MAX_CONTEXT_ITEMS = 24;

const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const POST_SUBMISSION_PHASES = new Set(['requesting', 'receiving', 'persisting', 'submitted', 'post-request', 'committing', 'exporting']);
const HIDDEN_KEY = /(api[_-]?key|authorization|secret|token|prompt|response|raw|url|uri|endpoint|path|cookie|capability|bearer|password|base[_-]?url|external.*request)/i;
const SECRET_TEXT = /\b(?:bearer|authorization|api[_ -]?key|x-goog-api-key|token|secret|password|capability)\s*[:=]?\s*[^\s,;'"<>]+/gi;
const PROVIDER_KEY = /\b(?:sk|pk|rk|dgpct1)[-_a-z0-9.]{8,}\b/gi;
const URL_TEXT = /\b(?:[a-z][a-z0-9+.-]{1,31}:\/\/|www\.)[^\s'"<>]+/gi;
const WINDOWS_PATH = /[A-Za-z]:\\[^\r\n\t,;'"<>]+/g;
const ABSOLUTE_PATH = /(^|[\s('"=:])\/(?:Users|home|tmp|var|private|Volumes|opt|srv|mnt|media|workspace)\/[^\s,;'"<>)]*/g;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const CATEGORY_COPY = Object.freeze({
  abort: { code: 'aborted', message: '操作已取消，页面状态已保留。' },
  connection: { code: 'connection_failed', message: '无法连接到本地 Studio。请确认页面仍连接当前本地服务后再重试。' },
  auth: { code: 'unauthorized', message: '本地 Studio 授权未通过。请重新连接工作台。' },
  skill_only: { code: 'skill_only_action', message: '该操作涉及 Provider 凭据，只能在本地 Skill/CLI 中执行。请在会话里让智能体执行，或运行对应的 daoge 命令。' },
  secret_backend: { code: 'provider_secret_backend_policy', message: '本地后台服务的 Provider 凭据后端与工作区里已有的 Profile 不一致，因此拒绝了这次读写。这不是连接故障：请用 DAOGE_PIC_PROVIDER_SECRET_BACKEND=plaintext 重启后台服务后重试。' },
  conflict: { code: 'conflict', message: '当前内容已被更新；请刷新或继续查看最新状态后再操作。' },
  validation: { code: 'invalid_command', message: '请求未通过 Studio 校验。请调整输入或回到会话确认后再继续。' },
  provider: { code: 'provider_error', message: '生成服务暂时无法完成请求。Provider 细节已脱敏；请查看运行项或回到会话处理。' },
  media: { code: 'media_error', message: '图片或媒体文件未通过安全校验。请检查文件格式、大小或遮罩用途后继续。' },
  unknown_outcome: { code: 'outcome_unknown', message: '外部请求结果不明确。请先核实运行项状态或素材结果，不能自动重放。' },
  partial_batch: { code: 'partial_batch', message: '批量操作只完成了一部分。已保留成功项；请查看详情后决定是否继续。' },
  unknown: { code: 'unknown_error', message: '操作结果不明确。为避免重复写入，先查看详情或刷新权威状态。' }
});

const PRESENTATION_COPY = Object.freeze({
  abort: { tone: 'neutral', title: '操作已取消', failure: false },
  connection: { tone: 'warning', title: '本地 Studio 连接中断', failure: true },
  auth: { tone: 'warning', title: '需要重新授权', failure: true },
  skill_only: { tone: 'warning', title: '需要 Skill/CLI 执行', failure: true },
  secret_backend: { tone: 'warning', title: 'Provider 凭据后端不匹配', failure: true },
  conflict: { tone: 'warning', title: '状态已变化', failure: true },
  validation: { tone: 'warning', title: '需要调整后继续', failure: true },
  provider: { tone: 'danger', title: 'Provider 未完成请求', failure: true },
  media: { tone: 'warning', title: '媒体校验未通过', failure: true },
  unknown_outcome: { tone: 'danger', title: '结果不明确', failure: true },
  partial_batch: { tone: 'warning', title: '部分项目未完成', failure: true },
  unknown: { tone: 'danger', title: '操作结果不明确', failure: true }
});

const ACTION_LABELS = Object.freeze({
  retry: '重试此操作',
  continue: '继续处理',
  'view-details': '查看详情',
  reconnect: '重新连接'
});

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function asString(value) {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function nestedError(input) {
  if (!isObject(input)) return null;
  if (isObject(input.error)) return input.error;
  if (isObject(input.body?.error)) return input.body.error;
  if (isObject(input.payload?.error)) return input.payload.error;
  if (isObject(input.response?.error)) return input.response.error;
  if (isObject(input.data?.error)) return input.data.error;
  return null;
}

function nestedDetails(input, apiError) {
  return isObject(apiError?.details) ? apiError.details : isObject(input?.details) ? input.details : isObject(input?.cause?.details) ? input.cause.details : null;
}

function headerValue(input, name) {
  const headers = input?.headers || input?.response?.headers;
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toLowerCase()) || undefined;
  return headers[name] || headers[name.toLowerCase()];
}

function statusCode(input, options = {}) {
  const status = firstValue(options.status, input?.status, input?.statusCode, input?.response?.status, input?.body?.status);
  const number = Number(status);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : null;
}

function safeIdentifier(value, maxLength) {
  const text = asString(value).trim();
  if (!text || text.length > maxLength || !IDENTIFIER.test(text) || redactText(text, maxLength) !== text) return null;
  return text;
}

function redactText(value, maxLength = MAX_TEXT_LENGTH) {
  return asString(value)
    .replace(URL_TEXT, '[redacted-url]')
    .replace(WINDOWS_PATH, '[redacted-path]')
    .replace(ABSOLUTE_PATH, '$1[redacted-path]')
    .replace(PROVIDER_KEY, '[redacted-secret]')
    .replace(SECRET_TEXT, '[redacted-secret]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeUiText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = redactText(value, maxLength);
  return text || null;
}

function sanitizeContextValue(value, depth = 0) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return safeUiText(value, MAX_TEXT_LENGTH);
  if (depth >= MAX_CONTEXT_DEPTH) return '[redacted-nested]';
  if (Array.isArray(value)) return value.slice(0, MAX_CONTEXT_ITEMS).map((item) => sanitizeContextValue(item, depth + 1)).filter((item) => item !== undefined);
  if (!isObject(value)) return null;
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_CONTEXT_ITEMS)) {
    const safeKey = safeIdentifier(key, 48);
    if (!safeKey) continue;
    output[safeKey] = HIDDEN_KEY.test(key) ? '[redacted]' : sanitizeContextValue(item, depth + 1);
  }
  return output;
}

function sanitizeContext(context) {
  const sanitized = sanitizeContextValue(context || {});
  return isObject(sanitized) && !Array.isArray(sanitized) ? sanitized : {};
}

function rawMessage(input, apiError) {
  return asString(firstValue(apiError?.message, input?.message, input?.reason?.message, input?.cause?.message));
}

function isAbort(input, apiError) {
  return input?.name === 'AbortError' || apiError?.name === 'AbortError' || input instanceof DOMException && input.name === 'AbortError';
}

function hasPartialBatch(input, apiError, details) {
  if (input?.partial === true || apiError?.partial === true || details?.partial === true) return true;
  const succeeded = Number(firstValue(input?.succeeded, apiError?.succeeded, details?.succeeded, input?.succeededCount, details?.succeededCount));
  const failed = Number(firstValue(input?.failed, apiError?.failed, details?.failed, input?.failedCount, details?.failedCount));
  return Number.isFinite(succeeded) && succeeded > 0 && Number.isFinite(failed) && failed > 0;
}

function classify({ input, apiError, details, status, code, kind, category, message }) {
  if (isAbort(input, apiError)) return 'abort';
  const haystack = [code, kind, category, status, message].filter(Boolean).join(' ').toLowerCase();
  if (hasPartialBatch(input, apiError, details) || /partial[_ -]?batch|batch[_ -]?partial/.test(haystack)) return 'partial_batch';
  if (/outcome[_ -]?unknown|unknown[_ -]?outcome|result[_ -]?unknown|uncertain[_ -]?outcome|lease_expired/.test(haystack)) return 'unknown_outcome';
  // Checked before the 409/conflict bucket and before the provider bucket: the daemon answers this case with 409
  // and the code contains "provider", and both routes used to end in a message that blamed the network or a stale
  // page instead of the real cause (a mismatched DAOGE_PIC_PROVIDER_SECRET_BACKEND).
  if (/secret[_ -]?backend/.test(haystack)) return 'secret_backend';
  if (status === 409 || /conflict|version_conflict|invalid_state_transition|state_transition/.test(haystack)) return 'conflict';
  // Must be decided before the 401/403 bucket: this is a deliberate credential-class rule, not a lost session,
  // and presenting it as "reconnect the workbench" sent operators chasing an authorization problem that did not
  // exist. No endpoint emits it right now — the Provider credential actions accept same-origin Workbench callers
  // again — but keep the branch so a future credential-class gate stays distinguishable from an expired session.
  if (/skill[_ -]?only/.test(haystack)) return 'skill_only';
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|auth|permission|csrf/.test(haystack)) return 'auth';
  if (/connection|network|offline|econn|refused|failed to fetch|load failed|socket|dns|timeout|timed out|invalid[_ -]?response|malformed[_ -]?response|bad[_ -]?response|无法连接|暂时不可用/.test(haystack) || input?.category === 'connection') return 'connection';
  if (/media|asset|image|mask|mime|content[_ -]?type|unsupported[_ -]?media|too[_ -]?large|decode|thumbnail/.test(haystack)) return 'media';
  // A 400/422 is always a request-shape problem, never a Provider problem — even when the message mentions
  // "Provider" (e.g. "使用 Provider Profile 覆盖端点、Provider 类型或信任策略时必须同时提供新的 API Key").
  // Without this, that business-rule rejection rendered as 「生成服务暂时无法完成请求。Provider 细节已脱敏」,
  // sending the operator to inspect run items for a problem they could have fixed in the form immediately.
  if (status === 400 || status === 422) return 'validation';
  if (/provider|rate[_ -]?limited|quota|external|http_429|http_5\d\d|transient/.test(haystack) || status === 429) return 'provider';
  if (status === 400 || status === 422 || /invalid|validation|required|missing|malformed|bad_request/.test(haystack)) return 'validation';
  if (status && TRANSIENT_STATUSES.has(status)) return 'connection';
  return 'unknown';
}

function explicitBoolean(...values) {
  for (const value of values) if (typeof value === 'boolean') return value;
  return null;
}

function phaseValue(input, apiError, details, options) {
  return safeIdentifier(firstValue(options.phase, input?.phase, apiError?.phase, details?.phase, input?.status, details?.status), 48) || 'unknown';
}

function committedState({ category, mayHaveCommitted, phase }) {
  if (category === 'abort') return 'cancelled';
  if (category === 'partial_batch') return 'partial';
  if (category === 'unknown_outcome') return 'unknown';
  if (mayHaveCommitted) return 'unknown';
  if (phase === 'unknown') return 'not_submitted';
  return POST_SUBMISSION_PHASES.has(phase) ? 'unknown' : 'not_submitted';
}

function actionIdsFor(error) {
  if (error.category === 'abort') return ['continue'];
  if (error.category === 'connection') return error.safeToRetry ? ['reconnect', 'retry', 'view-details'] : ['reconnect', 'view-details'];
  if (error.category === 'auth') return ['reconnect', 'view-details'];
  if (error.safeToRetry) return ['retry', 'view-details'];
  if (error.category === 'conflict' || error.category === 'validation' || error.category === 'media' || error.category === 'unknown_outcome' || error.category === 'partial_batch') return ['continue', 'view-details'];
  return ['view-details'];
}

function isNormalized(value) {
  return isObject(value) && typeof value.category === 'string' && typeof value.safeToRetry === 'boolean' && Array.isArray(value.actions);
}

export function normalizeWorkbenchError(input, options = {}) {
  const apiError = nestedError(input) || (isObject(input) ? input : null);
  const details = nestedDetails(input, apiError);
  const status = statusCode(input, options);
  const rawCode = firstValue(options.code, apiError?.code, input?.code, details?.code);
  const rawKind = firstValue(apiError?.kind, input?.kind, details?.kind);
  const rawCategory = firstValue(options.category, apiError?.category, input?.category, details?.category);
  const message = rawMessage(input, apiError);
  const category = classify({ input, apiError, details, status, code: rawCode, kind: rawKind, category: rawCategory, message });
  const copy = CATEGORY_COPY[category] || CATEGORY_COPY.unknown;
  const code = safeIdentifier(rawCode, MAX_CODE_LENGTH) || copy.code;
  const requestId = safeIdentifier(firstValue(options.requestId, apiError?.requestId, input?.requestId, details?.requestId, headerValue(input, 'x-request-id'), headerValue(input, 'request-id')), MAX_REQUEST_ID_LENGTH);
  const phase = phaseValue(input, apiError, details, options);
  const explicitRetryable = explicitBoolean(options.retryable, apiError?.retryable, input?.retryable, details?.retryable);
  const retryable = explicitRetryable ?? (category === 'connection' || category === 'provider' && (TRANSIENT_STATUSES.has(status) || /rate[_ -]?limited|transient|quota|http_429/.test([code, rawKind].join(' ').toLowerCase())));
  const explicitCommitted = explicitBoolean(options.mayHaveCommitted, options.possibleCommitted, apiError?.mayHaveCommitted, input?.mayHaveCommitted, details?.mayHaveCommitted, details?.possibleCommitted);
  const mayHaveCommitted = explicitCommitted ?? (category === 'unknown_outcome' || category === 'partial_batch' || POST_SUBMISSION_PHASES.has(phase));
  const explicitSafe = explicitBoolean(options.safeToRetry, apiError?.safeToRetry, input?.safeToRetry, details?.safeToRetry);
  const unsafeByCategory = category === 'abort' || category === 'auth' || category === 'skill_only' || category === 'secret_backend' || category === 'conflict' || category === 'unknown_outcome' || category === 'partial_batch';
  const safeToRetry = Boolean((explicitSafe ?? retryable) && !unsafeByCategory && !mayHaveCommitted);
  const context = sanitizeContext({ ...(options.context || {}), ...(isObject(input?.context) ? input.context : {}), ...(isObject(apiError?.context) ? apiError.context : {}), ...(isObject(details?.context) ? details.context : {}) });
  const normalized = {
    category,
    code,
    message: copy.message,
    requestId,
    operation: safeUiText(firstValue(options.operation, input?.operation, apiError?.operation, details?.operation), 80),
    resource: safeUiText(firstValue(options.resource, input?.resource, apiError?.resource, details?.resource), 80),
    context,
    retryable: Boolean(retryable),
    safeToRetry,
    phase,
    outcome: committedState({ category, mayHaveCommitted, phase }),
    mayHaveCommitted: Boolean(mayHaveCommitted)
  };
  normalized.actions = actionIdsFor(normalized);
  return normalized;
}

export function canRetryWorkbenchError(input, options = {}) {
  return normalizeWorkbenchError(input, options).safeToRetry === true;
}

export function errorPresentation(input, options = {}) {
  const error = normalizeWorkbenchError(input, options);
  const copy = PRESENTATION_COPY[error.category] || PRESENTATION_COPY.unknown;
  return {
    tone: copy.tone,
    title: copy.title,
    detail: error.message,
    failure: copy.failure,
    category: error.category,
    code: error.code,
    requestId: error.requestId,
    operation: error.operation,
    resource: error.resource,
    retryable: error.retryable,
    safeToRetry: error.safeToRetry,
    phase: error.phase,
    outcome: error.outcome,
    mayHaveCommitted: error.mayHaveCommitted,
    actions: error.actions.map((id) => ({ id, label: ACTION_LABELS[id], primary: id === 'retry' && error.safeToRetry || id === 'reconnect' && error.category === 'connection' }))
  };
}
