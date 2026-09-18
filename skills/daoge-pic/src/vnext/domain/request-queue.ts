import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { InvalidCommandError, StudioNotFoundError } from './studio-commands';

/**
 * The shared request queue (plan 7.1 / 4.2).
 *
 * One row is one request. State lives in columns, never in an event replay:
 * the `events` table is a rolling 2000-row window that fills up in days, so a
 * request that had not been claimed yet could be evicted before anyone read it.
 *
 * The lease mechanics copy the existing `run_items` pattern rather than
 * inventing a second one: claiming writes `lease_token` + `lease_expires_at`,
 * and an expired lease can be claimed again. `attempts` counts consecutive
 * expiries, so a request nobody finishes eventually fails instead of looping.
 */

export const REQUEST_STATUSES = ['pending', 'accepted', 'done', 'rejected', 'failed'] as const;
export type StudioRequestStatus = typeof REQUEST_STATUSES[number];

export const REQUEST_MAX_ATTEMPTS = 3;
export const REQUEST_DEFAULT_LEASE_MS = 10 * 60 * 1000;
export const REQUEST_TEXT_LIMIT = 4000;

export interface RequestFlowRequirement {
  skill: string;
  required: boolean;
  profile?: string;
}

export interface RequestContextInput {
  projectId?: string | null;
  taskId?: string | null;
  roundId?: string | null;
  assetIds?: string[];
  /** 就地回答追问时指回上一条请求：agent 据此「续上」，不靠记忆（8.10#8）。 */
  previousRequestId?: string | null;
  flow?: string | RequestFlowRequirement | null;
  /**
   * 界面上的「花动作」按钮（重试 / 恢复）走队列时带的结构化意图。
   *
   * 浏览器只有确认 Cookie，不能直调 Bearer（重试会重新花钱），所以那些按钮
   * 把意图写成一条请求；agent/CLI 接单后按这里的 `intent` + `runId` + `itemIds`
   * 精确执行，不必从自然语言里猜（三批的「队列路径」）。
   */
  intent?: string | null;
  runId?: string | null;
  itemIds?: string[];
}

export interface RequestContext {
  projectId: string | null;
  taskId: string | null;
  roundId: string | null;
  assetIds: string[];
  previousRequestId: string | null;
  flow: RequestFlowRequirement | null;
  intent: string | null;
  runId: string | null;
  itemIds: string[];
}

export interface StudioRequest {
  id: string;
  studioId: string;
  projectId: string | null;
  taskId: string | null;
  text: string;
  contextJson: string;
  status: StudioRequestStatus;
  leaseToken: string | null;
  leaseWorkerId: string | null;
  leaseExpiresAt: string | null;
  attempts: number;
  resultRoundId: string | null;
  resultJson: string | null;
  createdAt: string;
  acceptedAt: string | null;
  doneAt: string | null;
  updatedAt: string;
}

export interface CreateRequestInput { studioId: string; text: string; context?: RequestContextInput; projectId?: string | null; taskId?: string | null; }
export interface ClaimRequestInput { studioId: string; requestId: string; agentId: string; leaseMs?: number; now?: string; }
export interface ClaimRequestResult { claimed: boolean; request: StudioRequest; }
export interface ExpireLeasesResult { requeued: number; failed: number; /** 卡在人工确认上、只松开租约的条数。 */ waitingOnHuman: number; }
export interface ListRequestsInput { studioId: string; status?: StudioRequestStatus | null; limit?: number; }

interface RequestRow {
  id: string; studio_id: string; project_id: string | null; task_id: string | null;
  text: string; context_json: string; status: StudioRequestStatus;
  lease_token: string | null; lease_worker_id: string | null; lease_expires_at: string | null;
  attempts: number; result_round_id: string | null; result_json: string | null;
  created_at: string; accepted_at: string | null; done_at: string | null; updated_at: string;
}

const ALLOWED_TRANSITIONS: Record<StudioRequestStatus, readonly StudioRequestStatus[]> = {
  pending: ['accepted'],
  accepted: ['done', 'rejected', 'failed'],
  done: [],
  rejected: [],
  failed: []
};

export function canTransitionRequest(from: StudioRequestStatus, to: StudioRequestStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from: StudioRequestStatus, to: StudioRequestStatus): void {
  if (!canTransitionRequest(from, to)) throw new InvalidCommandError('请求状态不能从 ' + from + ' 变为 ' + to + '。');
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function requiredText(value: unknown, label: string, limit: number): string {
  const textValue = String(value || '').trim();
  if (!textValue) throw new InvalidCommandError(label + ' is required.');
  if (textValue.length > limit) throw new InvalidCommandError(label + ' is too long.');
  return textValue;
}

function mapRequest(row: RequestRow): StudioRequest {
  return {
    id: row.id, studioId: row.studio_id, projectId: row.project_id, taskId: row.task_id,
    text: row.text, contextJson: row.context_json, status: row.status,
    leaseToken: row.lease_token, leaseWorkerId: row.lease_worker_id, leaseExpiresAt: row.lease_expires_at,
    attempts: row.attempts, resultRoundId: row.result_round_id, resultJson: row.result_json,
    createdAt: row.created_at, acceptedAt: row.accepted_at, doneAt: row.done_at, updatedAt: row.updated_at
  };
}

/** The queue entry carries its own process requirement, not just a bare sentence. */
export function buildRequestContext(input: RequestContextInput = {}): RequestContext {
  const flow = input.flow;
  let requirement: RequestFlowRequirement | null = null;
  if (typeof flow === 'string' && flow.trim()) requirement = { skill: 'daoge-pic', required: true, profile: flow.trim() };
  else if (flow && typeof flow === 'object') requirement = { skill: String(flow.skill || 'daoge-pic'), required: flow.required !== false, ...(flow.profile ? { profile: String(flow.profile) } : {}) };
  return {
    projectId: input.projectId ? String(input.projectId) : null,
    taskId: input.taskId ? String(input.taskId) : null,
    roundId: input.roundId ? String(input.roundId) : null,
    previousRequestId: input.previousRequestId ? String(input.previousRequestId) : null,
    assetIds: Array.isArray(input.assetIds) ? input.assetIds.map((id) => String(id)).filter(Boolean).slice(0, 200) : [],
    flow: requirement,
    intent: input.intent ? String(input.intent).trim().slice(0, 40) || null : null,
    runId: input.runId ? String(input.runId) : null,
    itemIds: Array.isArray(input.itemIds) ? [...new Set(input.itemIds.map((id) => String(id)).filter(Boolean))].slice(0, 200) : []
  };
}

export function createStudioRequest(db: StudioDatabase, input: CreateRequestInput): StudioRequest {
  const studioId = requiredText(input.studioId, 'studioId', 160);
  const text = requiredText(input.text, '请求内容', REQUEST_TEXT_LIMIT);
  const context = buildRequestContext({ ...input.context, projectId: input.context?.projectId ?? input.projectId, taskId: input.context?.taskId ?? input.taskId });
  const now = nowIso();
  const id = createId('req');
  db.prepare('INSERT INTO studio_requests (id, studio_id, project_id, task_id, text, context_json, status, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
    .run(id, studioId, context.projectId, context.taskId, text, JSON.stringify(context), 'pending', now, now);
  appendStudioEvent(db, { studioId, entityType: 'request', entityId: id, eventType: 'request.created', payload: { status: 'pending' } });
  return getStudioRequest(db, { studioId, requestId: id });
}

export function getStudioRequest(db: StudioDatabase, input: { studioId: string; requestId: string }): StudioRequest {
  const row = db.prepare('SELECT * FROM studio_requests WHERE studio_id = ? AND id = ?').get(input.studioId, input.requestId) as RequestRow | undefined;
  if (!row) throw new StudioNotFoundError('找不到这个请求。');
  return mapRequest(row);
}

export function listStudioRequests(db: StudioDatabase, input: ListRequestsInput): StudioRequest[] {
  const limit = Math.min(500, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 100));
  const rows = input.status
    ? db.prepare('SELECT * FROM studio_requests WHERE studio_id = ? AND status = ? ORDER BY created_at, id LIMIT ?').all(input.studioId, input.status, limit) as unknown as RequestRow[]
    : db.prepare('SELECT * FROM studio_requests WHERE studio_id = ? ORDER BY created_at, id LIMIT ?').all(input.studioId, limit) as unknown as RequestRow[];
  return rows.map(mapRequest);
}

/**
 * Atomically claim one request. Two agents calling this for the same request
 * cannot both win: the UPDATE is guarded by `status = 'pending' OR lease expired`.
 */
export function claimStudioRequest(db: StudioDatabase, input: ClaimRequestInput): ClaimRequestResult {
  const studioId = requiredText(input.studioId, 'studioId', 160);
  const requestId = requiredText(input.requestId, 'requestId', 160);
  const agentId = requiredText(input.agentId, 'agentId', 160);
  const leaseMs = Number.isInteger(input.leaseMs) ? Number(input.leaseMs) : REQUEST_DEFAULT_LEASE_MS;
  const now = input.now || nowIso();
  const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
  const leaseToken = createId('lease');
  return withTransaction(db, () => {
    const current = getStudioRequest(db, { studioId, requestId });
    const expired = Boolean(current.leaseExpiresAt && current.leaseExpiresAt <= now);
    if (current.status === 'accepted' && !expired) return { claimed: false, request: current };
    if (current.status !== 'pending' && current.status !== 'accepted') return { claimed: false, request: current };
    if (current.status === 'pending') assertTransition('pending', 'accepted');
    const result = db.prepare("UPDATE studio_requests SET status = 'accepted', lease_token = ?, lease_worker_id = ?, lease_expires_at = ?, attempts = attempts + 1, accepted_at = COALESCE(accepted_at, ?), updated_at = ? WHERE studio_id = ? AND id = ? AND status = ?")
      .run(leaseToken, agentId, leaseExpiresAt, now, now, studioId, requestId, current.status);
    if (Number(result.changes) !== 1) return { claimed: false, request: getStudioRequest(db, { studioId, requestId }) };
    const claimedRequest = getStudioRequest(db, { studioId, requestId });
    appendStudioEvent(db, { studioId, entityType: 'request', entityId: requestId, eventType: 'request.accepted', payload: { status: 'accepted', agentId, attempts: claimedRequest.attempts } });
    return { claimed: true, request: claimedRequest };
  });
}

/**
 * 这条请求是不是**卡在人那里**。
 *
 * 判据：它关联的批次正等着人工确认（`awaiting_confirmation`）。
 * 那一刻球在用户脚下——**agent 不是死了，是在等人**。
 *
 * 关联方式是计划里的 `requestId` 外键（B5 建的现成字段），用 `json_extract` 精确取值，
 * 不做字符串 LIKE（JSON 的空白与键序会漂）。
 */
function blockedOnHumanConfirmation(db: StudioDatabase, requestId: string): boolean {
  const row = db.prepare("SELECT 1 FROM creative_rounds round WHERE json_extract(round.plan_json, '$.requestId') = ? AND round.status = 'awaiting_confirmation' LIMIT 1").get(requestId);
  return Boolean(row);
}

/**
 * Expired leases self-heal: back to the queue, or fail after the attempt limit.
 *
 * ⚠️ **例外：卡在人工确认上的不算 agent 失职。**
 * 租约本是防「agent 领了单却死掉」；但一条要人来确认的请求，从写计划到用户点确认
 * 之间可以隔任意久（实测：领单后用户 7 分钟才确认，10 分钟的租约先到期了，
 * 请求回队、界面显示「被领取 1 次但没完成」——**其实是 agent 在等人**）。
 * 所以这种情形**只松开租约、保留 accepted**：既不会被第二个 agent 抢走
 *（`claimStudioRequest` 对未过期的 accepted 返回 claimed:false），也不冤枉它一次失败。
 */
export function expireStudioRequestLeases(db: StudioDatabase, now = nowIso()): ExpireLeasesResult {
  return withTransaction(db, () => {
    const stale = db.prepare("SELECT * FROM studio_requests WHERE status = 'accepted' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ? ORDER BY created_at, id").all(now) as unknown as RequestRow[];
    let requeued = 0;
    let failed = 0;
    let waitingOnHuman = 0;
    for (const row of stale) {
      if (blockedOnHumanConfirmation(db, row.id)) {
        // 球在用户脚下：松开租约但**不**回队、**不**计失败。
        db.prepare('UPDATE studio_requests SET lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE studio_id = ? AND id = ?').run(now, row.studio_id, row.id);
        waitingOnHuman += 1;
        appendStudioEvent(db, { studioId: row.studio_id, entityType: 'request', entityId: row.id, eventType: 'request.awaiting_human', payload: { status: 'accepted' } });
        continue;
      }
      const nextStatus: StudioRequestStatus = row.attempts >= REQUEST_MAX_ATTEMPTS ? 'failed' : 'pending';
      db.prepare('UPDATE studio_requests SET status = ?, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, done_at = ?, updated_at = ? WHERE studio_id = ? AND id = ?')
        .run(nextStatus, nextStatus === 'failed' ? now : null, now, row.studio_id, row.id);
      if (nextStatus === 'failed') failed += 1; else requeued += 1;
      appendStudioEvent(db, { studioId: row.studio_id, entityType: 'request', entityId: row.id, eventType: 'request.lease_expired', payload: { status: nextStatus, attempts: row.attempts } });
    }
    return { requeued, failed, waitingOnHuman };
  });
}

/**
 * 续租（心跳）：长时间的活（写计划 → 等确认 → 预检 → 出图 → 收图）要能一直持有租约。
 * 没有它，任何跨人工确认的请求都必然被判「被领过但没完成」。
 */
export function renewStudioRequestLease(db: StudioDatabase, input: { studioId: string; requestId: string; agentId: string; leaseMs?: number; now?: string }): StudioRequest {
  const now = input.now || nowIso();
  const leaseMs = Number.isInteger(input.leaseMs) ? Number(input.leaseMs) : REQUEST_DEFAULT_LEASE_MS;
  return withTransaction(db, () => {
    const current = getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
    if (current.status !== 'accepted') throw new InvalidCommandError('只有已被接单的请求可以续租。');
    if (current.leaseWorkerId && current.leaseWorkerId !== input.agentId) throw new InvalidCommandError('这条请求被另一个 agent 持有。');
    const leaseExpiresAt = new Date(Date.parse(now) + leaseMs).toISOString();
    db.prepare('UPDATE studio_requests SET lease_worker_id = ?, lease_expires_at = ?, updated_at = ? WHERE studio_id = ? AND id = ?')
      .run(input.agentId, leaseExpiresAt, now, input.studioId, input.requestId);
    return getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
  });
}

export interface CompleteRequestInput { studioId: string; requestId: string; agentId?: string; resultRoundId?: string | null; result?: Record<string, unknown> | null; reply?: string; needsInput?: string; }
export interface RejectRequestInput { studioId: string; requestId: string; agentId?: string; reason?: string; }

/** Finishing a request: `done` carries whatever the caller should see (a reply, a round, a question). */
export function completeStudioRequest(db: StudioDatabase, input: CompleteRequestInput): StudioRequest {
  const now = nowIso();
  return withTransaction(db, () => {
    const current = getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
    assertTransition(current.status, 'done');
    const result = {
      ...(input.result || {}),
      ...(input.reply !== undefined ? { reply: String(input.reply) } : {}),
      ...(input.needsInput !== undefined ? { needsInput: String(input.needsInput) } : {})
    };
    db.prepare("UPDATE studio_requests SET status = 'done', result_round_id = ?, result_json = ?, done_at = ?, updated_at = ?, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL WHERE studio_id = ? AND id = ?")
      .run(input.resultRoundId || null, Object.keys(result).length ? JSON.stringify(result) : null, now, now, input.studioId, input.requestId);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'request', entityId: input.requestId, eventType: 'request.done', payload: { status: 'done', resultRoundId: input.resultRoundId || null, needsInput: input.needsInput !== undefined } });
    return getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
  });
}

export function rejectStudioRequest(db: StudioDatabase, input: RejectRequestInput): StudioRequest {
  const now = nowIso();
  return withTransaction(db, () => {
    const current = getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
    assertTransition(current.status, 'rejected');
    const result = input.reason ? JSON.stringify({ reason: String(input.reason) }) : null;
    db.prepare("UPDATE studio_requests SET status = 'rejected', result_json = ?, done_at = ?, updated_at = ?, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL WHERE studio_id = ? AND id = ?")
      .run(result, now, now, input.studioId, input.requestId);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'request', entityId: input.requestId, eventType: 'request.rejected', payload: { status: 'rejected' } });
    return getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
  });
}

/** Only a not-yet-claimed request can be withdrawn; a claimed one belongs to its agent. */
export function withdrawStudioRequest(db: StudioDatabase, input: { studioId: string; requestId: string }): StudioRequest {
  return withTransaction(db, () => {
    const current = getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
    if (current.status !== 'pending') throw new InvalidCommandError('已被接单的请求不能撤回。');
    const now = nowIso();
    // 撤回与「agent 说做不了」同为 rejected，但界面要区分：标记 withdrawn 而不是编一条理由。
    db.prepare("UPDATE studio_requests SET status = 'rejected', result_json = ?, done_at = ?, updated_at = ? WHERE studio_id = ? AND id = ?")
      .run(JSON.stringify({ withdrawn: true }), now, now, input.studioId, input.requestId);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'request', entityId: input.requestId, eventType: 'request.withdrawn', payload: { status: 'rejected' } });
    return getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
  });
}

export function requestContextOf(request: StudioRequest): Record<string, unknown> {
  return parseRecord(request.contextJson);
}

/**
 * 把「这条请求产出了哪一批」写成**列**，而不是只留在计划的 JSON 里。
 *
 * 计划里的 `requestId` 是事实源（B5），但它是埋在 `plan_json` 里的；
 * 界面要按请求显示进度时，就需要能直接查的关联——列表接口本来就返回 `resultRoundId`。
 * 所以计划一落盘就把这层关联补上，之后的读取全走列，不必解析 JSON。
 * （一个请求可以出多批：这里记**最近**一批，事实源仍是各批计划里的 requestId。）
 */
export function linkRequestToRound(db: StudioDatabase, input: { studioId: string; requestId: string; roundId: string }): void {
  const request = getStudioRequest(db, { studioId: input.studioId, requestId: input.requestId });
  if (request.resultRoundId === input.roundId) return;
  db.prepare('UPDATE studio_requests SET result_round_id = ?, updated_at = ? WHERE studio_id = ? AND id = ?')
    .run(input.roundId, nowIso(), input.studioId, input.requestId);
}
