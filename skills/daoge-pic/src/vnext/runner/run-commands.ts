import { createId, nowIso } from '../shared/ids';
import { assertRunItemTransition, assertRunTransition, RunItemStatus, RunStatus } from '../domain/states';
import { CommandReceipt, executeIdempotent, InvalidCommandError, StudioNotFoundError, VersionConflictError } from '../domain/studio-commands';
import { ImageOperation } from '../providers/contracts';
import { PreflightPlan, PreflightResult, preflightGenerationPlan } from './preflight';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { providerSnapshot, ResolvedProviderConfig, SafeProviderStatus } from '../studio/provider-config';
import { getStudioAsset } from '../domain/assets';

export interface GenerationRun {
  id: string;
  roundId: string;
  status: RunStatus;
  providerSnapshot: Record<string, unknown>;
  planSnapshot: PreflightPlan;
  version: number;
}

export interface GenerationRunItem {
  id: string;
  runId: string;
  sequence: number;
  status: RunItemStatus;
  requestId: string;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  attempts: number;
  retryAt: string | null;
}

export interface ClaimedRunItem extends GenerationRunItem {
  promptPayload: Record<string, unknown>;
  studioId: string;
}

interface StoredRun {
  id: string;
  round_id: string;
  status: RunStatus;
  provider_snapshot_json: string;
  plan_snapshot_json: string;
  version: number;
}

interface StoredRunItem {
  id: string;
  run_id: string;
  sequence: number;
  status: RunItemStatus;
  prompt_payload_json: string;
  request_id: string;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempts: number;
  retry_at: string | null;
}

interface StoredRoundPlan {
  id: string;
  status: string;
  plan_json: string;
  plan_version: number;
  studio_id: string;
}

export interface DryRunPreview {
  id: string;
  roundId: string;
  planVersion: number;
  providerSnapshot: Record<string, unknown>;
  planSnapshot: PreflightPlan;
  itemCount: number;
  createdAt: string;
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
  return parsed as Record<string, unknown>;
}

function parsePlan(value: string): PreflightPlan {
  const plan = parseObject(value);
  return {
    operation: plan.operation === 'edit' ? 'edit' : 'generate',
    itemCount: Number(plan.itemCount),
    prompt: String(plan.prompt || ''),
    referenceAssetIds: Array.isArray(plan.referenceAssetIds) ? plan.referenceAssetIds.filter((assetId): assetId is string => typeof assetId === 'string') : [],
    maskAssetId: typeof plan.maskAssetId === 'string' ? plan.maskAssetId : undefined,
    output: typeof plan.output === 'object' && plan.output && !Array.isArray(plan.output) ? plan.output as Record<string, unknown> : {}
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map((item) => stableJson(item)).join(',') + ']';
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return '{' + Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => JSON.stringify(key) + ':' + stableJson(record[key])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function storedSnapshotMatches(serialized: string, expected: unknown): boolean {
  try { return stableJson(JSON.parse(serialized)) === stableJson(expected); } catch { return false; }
}

function runFromRow(row: StoredRun): GenerationRun {
  return {
    id: row.id,
    roundId: row.round_id,
    status: row.status,
    providerSnapshot: parseObject(row.provider_snapshot_json),
    planSnapshot: parsePlan(row.plan_snapshot_json),
    version: row.version
  };
}

function runItemFromRow(row: StoredRunItem): GenerationRunItem {
  return {
    id: row.id,
    runId: row.run_id,
    sequence: row.sequence,
    status: row.status,
    requestId: row.request_id,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    attempts: row.attempts,
    retryAt: row.retry_at
  };
}

function requireValue(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new InvalidCommandError(label + ' is required.');
  return normalized;
}

function resolveRound(db: StudioDatabase, roundId: string): StoredRoundPlan {
  const row = db.prepare('SELECT r.id, r.status, r.plan_json, r.plan_version, p.studio_id FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(roundId) as StoredRoundPlan | undefined;
  if (!row) throw new StudioNotFoundError('Creative round not found: ' + roundId);
  return row;
}

function validateManagedAssets(db: StudioDatabase, studioId: string, result: PreflightResult): PreflightResult {
  const accepted = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  for (const assetId of result.normalizedPlan.referenceAssetIds || []) {
    const asset = getStudioAsset(db, studioId, assetId);
    if (!asset || asset.deletedAt) result.issues.push({ code: 'missing_reference_asset', message: '引用素材不存在、已删除或不属于当前 Studio。', field: 'referenceAssetIds' });
    else if (!accepted.includes(asset.mediaType)) result.issues.push({ code: 'reference_media_unsupported', message: '引用素材不是支持的图像格式。', field: 'referenceAssetIds' });
  }
  if (result.normalizedPlan.maskAssetId) {
    const mask = getStudioAsset(db, studioId, result.normalizedPlan.maskAssetId);
    if (!mask || mask.deletedAt) result.issues.push({ code: 'missing_mask_asset', message: '遮罩素材不存在、已删除或不属于当前 Studio。', field: 'maskAssetId' });
    else if (mask.mediaType !== 'image/png') result.issues.push({ code: 'mask_must_be_png', message: '遮罩必须是 PNG 格式的受管理资产。', field: 'maskAssetId' });
  }
  return { ...result, valid: result.issues.length === 0 };
}

function countInFlightItems(db: StudioDatabase, runId: string): number {
  const row = db.prepare("SELECT COUNT(*) AS total FROM run_items WHERE run_id = ? AND status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested')").get(runId) as { total: number };
  return row.total;
}

function storeRunStatus(db: StudioDatabase, run: StoredRun, status: RunStatus, workerId: string | null = null): GenerationRun {
  assertRunTransition(run.status, status);
  db.prepare('UPDATE generation_runs SET status = ?, worker_id = COALESCE(?, worker_id), version = version + 1, updated_at = ? WHERE id = ?').run(status, workerId, nowIso(), run.id);
  return { ...runFromRow(run), status, version: run.version + 1 };
}

export function preflightRound(db: StudioDatabase, input: { roundId: string; providerStatus: SafeProviderStatus }): PreflightResult {
  const round = resolveRound(db, requireValue(input.roundId, 'roundId'));
  if (round.status !== 'active') {
    return { valid: false, issues: [{ code: 'round_not_confirmed', message: '创作计划需要在会话中确认后才能开始生图。', field: 'roundId' }], normalizedPlan: parsePlan(round.plan_json) };
  }
  return validateManagedAssets(db, round.studio_id, preflightGenerationPlan(parsePlan(round.plan_json), input.providerStatus));
}



function dryRunFromRow(row: { id: string; round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; item_count: number; created_at: string }): DryRunPreview {
  return { id: row.id, roundId: row.round_id, planVersion: row.plan_version, providerSnapshot: parseObject(row.provider_snapshot_json), planSnapshot: parsePlan(row.plan_snapshot_json), itemCount: row.item_count, createdAt: row.created_at };
}

export function createDryRunPreview(db: StudioDatabase, input: { roundId: string; providerConfig: ResolvedProviderConfig; providerStatus: SafeProviderStatus; idempotencyKey: string }): CommandReceipt<{ preview: DryRunPreview | null; preflight: PreflightResult }> {
  return executeIdempotent(db, input.idempotencyKey, 'rounds.dry_run', () => {
    const round = resolveRound(db, requireValue(input.roundId, 'roundId'));
    if (!['awaiting_confirmation', 'active'].includes(round.status)) throw new InvalidCommandError('Only a prepared or confirmed creative round can be dry-run.');
    if (input.providerConfig.providerId !== input.providerStatus.providerId) throw new InvalidCommandError('Provider configuration changed during dry-run.');
    const preflight = validateManagedAssets(db, round.studio_id, preflightGenerationPlan(parsePlan(round.plan_json), input.providerStatus));
    if (!preflight.valid) return { preview: null, preflight };
    const timestamp = nowIso();
    const id = createId('dryrun');
    const provider = providerSnapshot(input.providerConfig);
    db.prepare('INSERT INTO dry_run_previews (id, round_id, plan_version, provider_snapshot_json, plan_snapshot_json, item_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, round.id, round.plan_version, JSON.stringify(provider), JSON.stringify(preflight.normalizedPlan), preflight.normalizedPlan.itemCount, timestamp);
    const insertItem = db.prepare('INSERT INTO dry_run_items (id, preview_id, sequence, prompt_payload_json, created_at) VALUES (?, ?, ?, ?, ?)');
    for (let sequence = 1; sequence <= preflight.normalizedPlan.itemCount; sequence += 1) insertItem.run(createId('dryitem'), id, sequence, JSON.stringify({ ...preflight.normalizedPlan, sequence }), timestamp);
    appendStudioEvent(db, { studioId: round.studio_id, entityType: 'dry_run_preview', entityId: id, eventType: 'dry_run.created', payload: { roundId: round.id, planVersion: round.plan_version, itemCount: preflight.normalizedPlan.itemCount } });
    return { preview: { id, roundId: round.id, planVersion: round.plan_version, providerSnapshot: provider, planSnapshot: preflight.normalizedPlan, itemCount: preflight.normalizedPlan.itemCount, createdAt: timestamp }, preflight };
  }, { roundId: input.roundId, provider: providerSnapshot(input.providerConfig) });
}

export function listDryRunPreviews(db: StudioDatabase, roundId: string): DryRunPreview[] {
  return (db.prepare('SELECT id, round_id, plan_version, provider_snapshot_json, plan_snapshot_json, item_count, created_at FROM dry_run_previews WHERE round_id = ? ORDER BY created_at DESC').all(requireValue(roundId, 'roundId')) as Array<{ id: string; round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; item_count: number; created_at: string }>).map(dryRunFromRow);
}

export function queueGenerationRun(db: StudioDatabase, input: { roundId: string; providerConfig: ResolvedProviderConfig; providerStatus: SafeProviderStatus; preflightId?: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.idempotencyKey, 'runs.queue', () => {
    const round = resolveRound(db, requireValue(input.roundId, 'roundId'));
    if (round.status !== 'active') throw new InvalidCommandError('The creative round must be confirmed before a run can be queued.');
    const preflight = validateManagedAssets(db, round.studio_id, preflightGenerationPlan(parsePlan(round.plan_json), input.providerStatus));
    if (!preflight.valid) throw new InvalidCommandError('Generation preflight failed: ' + preflight.issues.map((issue) => issue.code).join(', '));
    if (input.providerConfig.providerId !== input.providerStatus.providerId) throw new InvalidCommandError('Provider configuration changed during preflight. Run preflight again.');
    const snapshot = providerSnapshot(input.providerConfig);
    if (!input.preflightId) throw new InvalidCommandError('Dry-run evidence is required before queueing.');
    {
      const preview = db.prepare('SELECT round_id, plan_version, provider_snapshot_json, plan_snapshot_json FROM dry_run_previews WHERE id = ?').get(input.preflightId) as { round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string } | undefined;
      if (!preview || preview.round_id !== round.id || preview.plan_version !== round.plan_version || !storedSnapshotMatches(preview.provider_snapshot_json, snapshot) || !storedSnapshotMatches(preview.plan_snapshot_json, preflight.normalizedPlan)) throw new InvalidCommandError('Dry-run evidence is stale. Re-run preflight before queueing.');
    }
    const id = createId('run');
    const timestamp = nowIso();
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(
      id,
      round.id,
      'queued',
      JSON.stringify(snapshot),
      JSON.stringify(preflight.normalizedPlan),
      timestamp,
      timestamp
    );
    const insertItem = db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (let sequence = 1; sequence <= preflight.normalizedPlan.itemCount; sequence += 1) {
      const itemId = createId('item');
      const requestId = createId('request');
      const promptPayload = { ...preflight.normalizedPlan, sequence };
      insertItem.run(itemId, id, sequence, 'pending', JSON.stringify(promptPayload), requestId, timestamp, timestamp);
    }
    appendStudioEvent(db, { studioId: round.studio_id, entityType: 'generation_run', entityId: id, eventType: 'run.queued', payload: { roundId: round.id, itemCount: preflight.normalizedPlan.itemCount } });
    return { id, roundId: round.id, status: 'queued', providerSnapshot: snapshot, planSnapshot: preflight.normalizedPlan, version: 1 };
  }, { roundId: input.roundId, preflightId: input.preflightId || null, provider: providerSnapshot(input.providerConfig) });
}

export function getGenerationRun(db: StudioDatabase, runId: string): GenerationRun | null {
  const row = db.prepare('SELECT id, round_id, status, provider_snapshot_json, plan_snapshot_json, version FROM generation_runs WHERE id = ?').get(runId) as StoredRun | undefined;
  return row ? runFromRow(row) : null;
}

export function listGenerationRunItems(db: StudioDatabase, runId: string): GenerationRunItem[] {
  return (db.prepare('SELECT id, run_id, sequence, status, prompt_payload_json, request_id, lease_token, lease_expires_at, attempts, retry_at FROM run_items WHERE run_id = ? ORDER BY sequence').all(runId) as unknown as StoredRunItem[]).map(runItemFromRow);
}

const ACTIVE_RUN_ITEM_STATUSES: readonly RunItemStatus[] = ['pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'cancel_requested'];

export function settleTerminalGenerationRun(db: StudioDatabase, runId: string, now = new Date()): RunStatus | null {
  const run = getGenerationRun(db, runId);
  if (!run || !['running', 'pausing'].includes(run.status)) return null;
  const items = listGenerationRunItems(db, runId);
  if (!items.length || items.some((item) => ACTIVE_RUN_ITEM_STATUSES.includes(item.status))) return null;
  const successful = items.filter((item) => item.status === 'succeeded').length;
  const nextStatus: RunStatus = run.status === 'pausing' ? 'paused' : successful === items.length ? 'completed' : successful > 0 ? 'partial' : 'failed';
  const timestamp = now.toISOString();
  const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(runId) as { studio_id: string } | undefined;
  withTransaction(db, () => {
    assertRunTransition(run.status, nextStatus);
    if (nextStatus === 'paused') db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run(nextStatus, timestamp, runId);
    else db.prepare('UPDATE generation_runs SET status = ?, completed_at = ?, version = version + 1, updated_at = ? WHERE id = ?').run(nextStatus, timestamp, timestamp, runId);
    if (studio) appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'generation_run', entityId: runId, eventType: 'run.' + nextStatus, payload: { succeeded: successful, total: items.length, reconciled: true } });
  });
  return nextStatus;
}

export function reconcileTerminalRuns(db: StudioDatabase, now = new Date()): number {
  const rows = db.prepare("SELECT r.id FROM generation_runs r WHERE r.status IN ('running', 'pausing') AND EXISTS (SELECT 1 FROM run_items i WHERE i.run_id = r.id) AND NOT EXISTS (SELECT 1 FROM run_items i WHERE i.run_id = r.id AND i.status IN ('pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'cancel_requested')) ORDER BY r.created_at").all() as Array<{ id: string }> ;
  let reconciled = 0;
  for (const row of rows) if (settleTerminalGenerationRun(db, row.id, now)) reconciled += 1;
  return reconciled;
}

export function claimRunItems(db: StudioDatabase, input: { workerId: string; limit: number; leaseMs: number; now?: Date; providerSnapshot?: { providerId: string; model: string; endpoint: string | null } }): ClaimedRunItem[] {
  const workerId = requireValue(input.workerId, 'workerId');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new InvalidCommandError('Claim limit must be an integer between 1 and 100.');
  if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1000) throw new InvalidCommandError('Lease duration must be at least 1000 ms.');
  const now = input.now || new Date();
  const nowValue = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
  return withTransaction(db, () => {
    const providerFilter = input.providerSnapshot ? " AND json_extract(r.provider_snapshot_json, '$.providerId') = ? AND json_extract(r.provider_snapshot_json, '$.model') = ? AND COALESCE(json_extract(r.provider_snapshot_json, '$.endpoint'), '') = ?" : '';
    const sql = "SELECT i.id, i.run_id, i.sequence, i.status, i.prompt_payload_json, i.request_id, i.lease_token, i.lease_expires_at, i.attempts, i.retry_at, r.status AS run_status, r.round_id, p.studio_id FROM run_items i JOIN generation_runs r ON r.id = i.run_id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE i.status = 'pending' AND r.status IN ('queued', 'running') AND (i.retry_at IS NULL OR i.retry_at <= ?)" + providerFilter + " ORDER BY r.created_at, i.sequence LIMIT ?";
    const params: Array<string | number> = [nowValue];
    if (input.providerSnapshot) params.push(input.providerSnapshot.providerId, input.providerSnapshot.model, input.providerSnapshot.endpoint || '');
    params.push(input.limit);
    const rows = db.prepare(sql).all(...params) as unknown as Array<StoredRunItem & { run_status: RunStatus; round_id: string; studio_id: string }>;
    const claimed: ClaimedRunItem[] = [];
    for (const row of rows) {
      if (row.run_status === 'queued') {
        assertRunTransition('queued', 'running');
        db.prepare('UPDATE generation_runs SET status = ?, worker_id = ?, started_at = COALESCE(started_at, ?), version = version + 1, updated_at = ? WHERE id = ? AND status = ?').run('running', workerId, nowValue, nowValue, row.run_id, 'queued');
        appendStudioEvent(db, { studioId: row.studio_id, entityType: 'generation_run', entityId: row.run_id, eventType: 'run.started', payload: { workerId } });
      }
      const leaseToken = createId('lease');
      const updated = db.prepare('UPDATE run_items SET status = ?, lease_token = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = ?').run('leased', leaseToken, expiresAt, nowValue, row.id, 'pending');
      if (Number(updated.changes) !== 1) continue;
      appendStudioEvent(db, { studioId: row.studio_id, entityType: 'run_item', entityId: row.id, eventType: 'run_item.leased', payload: { runId: row.run_id, workerId } });
      claimed.push({ ...runItemFromRow({ ...row, status: 'leased', lease_token: leaseToken, lease_expires_at: expiresAt, attempts: row.attempts + 1 }), promptPayload: parseObject(row.prompt_payload_json), studioId: row.studio_id });
    }
    return claimed;
  });
}

export function renewRunItemLease(db: StudioDatabase, input: { itemId: string; leaseToken: string; leaseMs: number; now?: Date }): GenerationRunItem {
  if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1000) throw new InvalidCommandError('Lease duration must be at least 1000 ms.');
  const now = input.now || new Date();
  return withTransaction(db, () => {
    const row = db.prepare('SELECT id, run_id, sequence, status, prompt_payload_json, request_id, lease_token, lease_expires_at, attempts, retry_at FROM run_items WHERE id = ?').get(requireValue(input.itemId, 'itemId')) as StoredRunItem | undefined;
    if (!row) throw new StudioNotFoundError('Run item not found: ' + input.itemId);
    const leaseToken = requireValue(input.leaseToken, 'leaseToken');
    if (!row.lease_token || row.lease_token !== leaseToken) throw new VersionConflictError('Run item lease is no longer owned by this worker.');
    if (!row.lease_expires_at || new Date(row.lease_expires_at).getTime() <= now.getTime()) throw new VersionConflictError('Run item lease has expired.');
    if (!['leased', 'requesting', 'receiving', 'persisting', 'cancel_requested'].includes(row.status)) throw new InvalidCommandError('Run item is not leaseable in its current state.');
    const expiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
    db.prepare('UPDATE run_items SET lease_expires_at = ?, updated_at = ? WHERE id = ?').run(expiresAt, now.toISOString(), row.id);
    return { ...runItemFromRow(row), leaseExpiresAt: expiresAt };
  });
}

export function transitionRunItem(db: StudioDatabase, input: { itemId: string; leaseToken: string; status: RunItemStatus; retryAt?: string; error?: Record<string, unknown>; result?: Record<string, unknown>; now?: Date }): GenerationRunItem {
  return withTransaction(db, () => {
    const now = input.now || new Date();
    const row = db.prepare('SELECT id, run_id, sequence, status, prompt_payload_json, request_id, lease_token, lease_expires_at, attempts, retry_at FROM run_items WHERE id = ?').get(requireValue(input.itemId, 'itemId')) as StoredRunItem | undefined;
    if (!row) throw new StudioNotFoundError('Run item not found: ' + input.itemId);
    const leaseToken = requireValue(input.leaseToken, 'leaseToken');
    if (!row.lease_token || row.lease_token !== leaseToken) throw new VersionConflictError('Run item lease is no longer owned by this worker.');
    if (!row.lease_expires_at || new Date(row.lease_expires_at).getTime() <= now.getTime()) throw new VersionConflictError('Run item lease has expired.');
    assertRunItemTransition(row.status, input.status);
    if (input.status === 'retry_wait' && !input.retryAt) throw new InvalidCommandError('A retry timestamp is required for retry_wait.');
    const clearLease = ['pending', 'retry_wait', 'blocked', 'cancelled', 'outcome_unknown', 'failed', 'succeeded'].includes(input.status);
    db.prepare('UPDATE run_items SET status = ?, retry_at = ?, error_json = ?, result_json = ?, lease_token = CASE WHEN ? THEN NULL ELSE lease_token END, lease_expires_at = CASE WHEN ? THEN NULL ELSE lease_expires_at END, updated_at = ? WHERE id = ?').run(
      input.status,
      input.retryAt || null,
      input.error ? JSON.stringify(input.error) : null,
      input.result ? JSON.stringify(input.result) : null,
      clearLease ? 1 : 0,
      clearLease ? 1 : 0,
      now.toISOString(),
      row.id
    );
    const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(row.run_id) as { studio_id: string } | undefined;
    if (studio) appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'run_item', entityId: row.id, eventType: 'run_item.' + input.status, payload: { runId: row.run_id, sequence: row.sequence } });
    return { ...runItemFromRow(row), status: input.status, retryAt: input.retryAt || null, leaseToken: clearLease ? null : row.lease_token, leaseExpiresAt: clearLease ? null : row.lease_expires_at };
  });
}

export function pauseGenerationRun(db: StudioDatabase, input: { runId: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.idempotencyKey, 'runs.pause', () => {
    const run = db.prepare('SELECT id, round_id, status, provider_snapshot_json, plan_snapshot_json, version FROM generation_runs WHERE id = ?').get(requireValue(input.runId, 'runId')) as StoredRun | undefined;
    if (!run) throw new StudioNotFoundError('Generation run not found: ' + input.runId);
    assertRunTransition(run.status, 'pausing');
    const inFlight = countInFlightItems(db, run.id);
    const status: RunStatus = inFlight === 0 ? 'paused' : 'pausing';
    if (status === 'paused') assertRunTransition('pausing', 'paused');
    db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run(status, nowIso(), run.id);
    const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(run.id) as { studio_id: string };
    appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'generation_run', entityId: run.id, eventType: status === 'paused' ? 'run.paused' : 'run.pausing', payload: {} });
    return { ...runFromRow(run), status, version: run.version + 1 };
  }, input);
}


export function resolveUnknownRunItems(db: StudioDatabase, input: { runId: string; itemIds: string[]; idempotencyKey: string }): CommandReceipt<{ runId: string; resolvedItemIds: string[] }> {
  return executeIdempotent(db, input.idempotencyKey, 'runs.resolve_unknown', () => {
    const runId = requireValue(input.runId, 'runId');
    const run = db.prepare('SELECT r.id, p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(runId) as { id: string; studio_id: string } | undefined;
    if (!run) throw new StudioNotFoundError('Generation run not found: ' + runId);
    const ids = [...new Set(input.itemIds.filter((itemId): itemId is string => typeof itemId === 'string' && itemId.trim().length > 0))];
    if (!ids.length) throw new InvalidCommandError('At least one unknown-outcome item must be explicitly resolved.');
    const timestamp = nowIso();
    for (const itemId of ids) {
      const changed = db.prepare("UPDATE run_items SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status = 'outcome_unknown'").run(JSON.stringify({ code: 'user_resolved_unknown_outcome' }), timestamp, itemId, runId);
      if (Number(changed.changes) !== 1) throw new InvalidCommandError('Run item is not an unresolved unknown outcome: ' + itemId);
      appendStudioEvent(db, { studioId: run.studio_id, entityType: 'run_item', entityId: itemId, eventType: 'run_item.outcome_resolved', payload: { runId, resolution: 'failed' } });
    }
    return { runId, resolvedItemIds: ids };
  }, input);
}


export function retryGenerationRunItems(db: StudioDatabase, input: { runId: string; itemIds?: string[]; idempotencyKey: string }): CommandReceipt<{ runId: string; retriedItemIds: string[] }> {
  return executeIdempotent(db, input.idempotencyKey, 'runs.retry', () => {
    const runId = requireValue(input.runId, 'runId');
    const run = db.prepare('SELECT r.id, r.status, p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(runId) as { id: string; status: RunStatus; studio_id: string } | undefined;
    if (!run) throw new StudioNotFoundError('Generation run not found: ' + runId);
    if (run.status === 'resume_pending') throw new InvalidCommandError('Restart recovery must be confirmed through a Studio Session before retrying.');
    if (!['queued', 'running', 'paused', 'partial', 'failed'].includes(run.status)) throw new InvalidCommandError('This generation run cannot be retried in its current state.');
    const requested = [...new Set((input.itemIds || []).filter((itemId): itemId is string => typeof itemId === 'string' && itemId.trim().length > 0))];
    const retryable = db.prepare("SELECT id, status, error_json FROM run_items WHERE run_id = ? AND status IN ('failed', 'blocked', 'retry_wait')").all(runId) as unknown as Array<{ id: string; status: RunItemStatus; error_json: string | null }>;
    const candidates = requested.length ? retryable.filter((item) => requested.includes(item.id)) : retryable;
    if (!candidates.length) throw new InvalidCommandError('No retryable run items were selected.');
    if (requested.length && candidates.length !== requested.length) throw new InvalidCommandError('One or more run items are not retryable in this generation run.');
    for (const item of candidates) {
      if (item.error_json && item.error_json.includes('user_resolved_unknown_outcome')) throw new InvalidCommandError('An outcome resolved as unknown cannot be retried; create a new round after reviewing the result.');
      assertRunItemTransition(item.status, 'pending');
    }
    const timestamp = nowIso();
    for (const item of candidates) {
      db.prepare("UPDATE run_items SET status = 'pending', request_id = ?, retry_at = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(createId('request'), timestamp, item.id);
      appendStudioEvent(db, { studioId: run.studio_id, entityType: 'run_item', entityId: item.id, eventType: 'run_item.retried', payload: { runId } });
    }
    if (['paused', 'partial', 'failed'].includes(run.status)) {
      assertRunTransition(run.status, 'queued');
      db.prepare("UPDATE generation_runs SET status = 'queued', worker_id = NULL, version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, runId);
      appendStudioEvent(db, { studioId: run.studio_id, entityType: 'generation_run', entityId: runId, eventType: 'run.queued', payload: { retried: true, itemCount: candidates.length } });
    }
    return { runId, retriedItemIds: candidates.map((item) => item.id) };
  }, input);
}

export function resumeGenerationRun(db: StudioDatabase, input: { runId: string; sessionId?: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.idempotencyKey, 'runs.resume', () => {
    const run = db.prepare('SELECT id, round_id, status, provider_snapshot_json, plan_snapshot_json, version FROM generation_runs WHERE id = ?').get(requireValue(input.runId, 'runId')) as StoredRun | undefined;
    if (!run) throw new StudioNotFoundError('Generation run not found: ' + input.runId);
    const unknown = db.prepare("SELECT COUNT(*) AS total FROM run_items WHERE run_id = ? AND status = 'outcome_unknown'").get(run.id) as { total: number };
    if (unknown.total > 0) throw new InvalidCommandError('This run has provider requests with unknown outcomes and cannot resume automatically.');
    const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(run.id) as { studio_id: string };
    if (run.status === 'resume_pending') {
      const sessionId = requireValue(input.sessionId || '', 'sessionId');
      const session = db.prepare('SELECT id FROM studio_sessions WHERE id = ? AND studio_id = ?').get(sessionId, studio.studio_id) as { id: string } | undefined;
      if (!session) throw new InvalidCommandError('A Studio Session confirmation is required before resuming after restart.');
      db.prepare('INSERT INTO run_resume_confirmations (id, run_id, session_id, confirmed_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, session_id) DO NOTHING').run(createId('resumeconfirm'), run.id, sessionId, nowIso());
    }
    assertRunTransition(run.status, 'queued');
    db.prepare('UPDATE generation_runs SET status = ?, worker_id = NULL, version = version + 1, updated_at = ? WHERE id = ?').run('queued', nowIso(), run.id);
    appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'generation_run', entityId: run.id, eventType: 'run.queued', payload: { resumed: true, sessionId: input.sessionId || null } });
    return { ...runFromRow(run), status: 'queued', version: run.version + 1 };
  }, input);
}

export function cancelGenerationRun(db: StudioDatabase, input: { runId: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.idempotencyKey, 'runs.cancel', () => {
    const run = db.prepare('SELECT id, round_id, status, provider_snapshot_json, plan_snapshot_json, version FROM generation_runs WHERE id = ?').get(requireValue(input.runId, 'runId')) as StoredRun | undefined;
    if (!run) throw new StudioNotFoundError('Generation run not found: ' + input.runId);
    assertRunTransition(run.status, 'cancelled');
    const timestamp = nowIso();
    db.prepare("UPDATE run_items SET status = 'cancelled', lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE run_id = ? AND status IN ('pending', 'leased', 'retry_wait', 'blocked')").run(timestamp, run.id);
    db.prepare("UPDATE run_items SET status = 'cancel_requested', updated_at = ? WHERE run_id = ? AND status IN ('requesting', 'receiving', 'persisting')").run(timestamp, run.id);
    db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run('cancelled', timestamp, run.id);
    const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(run.id) as { studio_id: string };
    appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'generation_run', entityId: run.id, eventType: 'run.cancelled', payload: {} });
    return { ...runFromRow(run), status: 'cancelled', version: run.version + 1 };
  }, input);
}

export function recoverExpiredLeases(db: StudioDatabase, now = new Date()): number {
  return withTransaction(db, () => {
    const result = db.prepare("UPDATE run_items SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE status = 'leased' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?").run(now.toISOString(), now.toISOString());
    return Number(result.changes);
  });
}

export function markRunsResumePending(db: StudioDatabase): number {
  return withTransaction(db, () => {
    const rows = db.prepare("SELECT r.id, r.status, p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.status IN ('queued', 'running', 'pausing')").all() as Array<{ id: string; status: RunStatus; studio_id: string }>;
    const timestamp = nowIso();
    for (const row of rows) {
      assertRunTransition(row.status, 'resume_pending');
      db.prepare('UPDATE generation_runs SET status = ?, worker_id = NULL, version = version + 1, updated_at = ? WHERE id = ?').run('resume_pending', timestamp, row.id);
      db.prepare("UPDATE run_items SET status = 'pending', lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE run_id = ? AND status = 'leased'").run(timestamp, row.id);
      db.prepare("UPDATE run_items SET status = 'outcome_unknown', lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE run_id = ? AND status IN ('requesting', 'receiving', 'persisting', 'cancel_requested')").run(timestamp, row.id);
      appendStudioEvent(db, { studioId: row.studio_id, entityType: 'generation_run', entityId: row.id, eventType: 'run.resume_pending', payload: {} });
    }
    return rows.length;
  });
}
