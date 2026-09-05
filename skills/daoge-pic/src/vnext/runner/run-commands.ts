import { createId, nowIso } from '../shared/ids';
import { assertRunItemTransition, assertRunTransition, RunItemStatus, RunStatus } from '../domain/states';
import { CommandReceipt, executeIdempotent, InvalidCommandError, StudioNotFoundError, VersionConflictError } from '../domain/studio-commands';
import { ImageOperation, MAX_IMAGE_REQUEST_MEDIA_BYTES } from '../providers/contracts';
import { PreflightPlan, PreflightResult, preflightGenerationPlan } from './preflight';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { providerSnapshot, ResolvedProviderConfig, SafeProviderStatus } from '../studio/provider-config';
import { ConcurrencySource, MAX_GLOBAL_CONCURRENCY, resolveExecutionConcurrency } from '../studio/runtime-settings';
import { getStudioAsset, isStudioAssetMediaAvailable } from '../domain/assets';
import { inspectProjectAssetAccess, projectAssetReferenceAllowed } from '../domain/asset-access';
import { SafeErrorDetail, safeErrorDetail } from '../shared/safe-error';

export interface GenerationRun {
  id: string;
  roundId: string;
  status: RunStatus;
  providerSnapshot: Record<string, unknown>;
  planSnapshot: PreflightPlan;
  executionConcurrency: number;
  concurrencySource: ConcurrencySource;
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
  error: SafeErrorDetail | null;
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
  execution_concurrency: number;
  concurrency_source: ConcurrencySource;
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
  error_json?: string | null;
  lease_worker_id?: string | null;
}

interface StoredRoundPlan {
  id: string;
  status: string;
  plan_json: string;
  plan_version: number;
  studio_id: string;
  project_id: string;
}

export interface DryRunPreview {
  id: string;
  roundId: string;
  planVersion: number;
  providerSnapshot: Record<string, unknown>;
  planSnapshot: PreflightPlan;
  itemCount: number;
  executionConcurrency: number;
  concurrencySource: ConcurrencySource;
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
    itemPrompts: Array.isArray(plan.itemPrompts) ? plan.itemPrompts.filter((prompt): prompt is string => typeof prompt === 'string') : undefined,
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

function promptPayloadForSequence(plan: PreflightPlan, sequence: number): Record<string, unknown> {
  const { itemPrompts, ...sharedPlan } = plan;
  const scene = itemPrompts?.[sequence - 1];
  return {
    ...sharedPlan,
    prompt: scene ? sharedPlan.prompt + '\n\nSpecific scene direction for this image: ' + scene : sharedPlan.prompt,
    sequence
  };
}

function runFromRow(row: StoredRun): GenerationRun {
  return {
    id: row.id,
    roundId: row.round_id,
    status: row.status,
    providerSnapshot: parseObject(row.provider_snapshot_json),
    planSnapshot: parsePlan(row.plan_snapshot_json),
    executionConcurrency: Number(row.execution_concurrency),
    concurrencySource: row.concurrency_source,
    version: row.version
  };
}

function safeRunItemError(value: string | null | undefined): SafeErrorDetail | null {
  if (!value) return null;
  try { return safeErrorDetail(parseObject(value)); } catch { return null; }
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
    retryAt: row.retry_at,
    error: safeRunItemError(row.error_json)
  };
}

function requireValue(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) throw new InvalidCommandError(label + ' is required.');
  return normalized;
}


function resolveRoundInStudio(db: StudioDatabase, studioId: string, roundId: string): StoredRoundPlan {
  const row = db.prepare('SELECT r.id, r.status, r.plan_json, r.plan_version, p.studio_id, p.id AS project_id FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ? AND p.studio_id = ?').get(roundId, studioId) as StoredRoundPlan | undefined;
  if (!row) throw new StudioNotFoundError('Creative round not found: ' + roundId);
  return row;
}

function resolveRunInStudio(db: StudioDatabase, studioId: string, runId: string): StoredRun & { studio_id: string } {
  const row = db.prepare('SELECT r.id, r.round_id, r.status, r.provider_snapshot_json, r.plan_snapshot_json, r.execution_concurrency, r.concurrency_source, r.version, p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ? AND p.studio_id = ?').get(runId, studioId) as (StoredRun & { studio_id: string }) | undefined;
  if (!row) throw new StudioNotFoundError('Generation run not found: ' + runId);
  return row;
}

function resolveRunItemInStudio(db: StudioDatabase, studioId: string, itemId: string): { id: string; run_id: string; status: RunItemStatus; error_json: string | null } {
  const row = db.prepare('SELECT item.id, item.run_id, item.status, item.error_json FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE item.id = ? AND project.studio_id = ?').get(itemId, studioId) as { id: string; run_id: string; status: RunItemStatus; error_json: string | null } | undefined;
  if (!row) throw new StudioNotFoundError('Generation run item not found: ' + itemId);
  return row;
}

function assertRoundHasNoGenerationRun(db: StudioDatabase, roundId: string): void {
  const existing = db.prepare('SELECT id, status FROM generation_runs WHERE round_id = ? ORDER BY created_at, id LIMIT 1').get(roundId) as { id: string; status: RunStatus } | undefined;
  if (existing) throw new VersionConflictError('当前轮次已创建生成运行 ' + existing.id + '（' + existing.status + '）。请在 Generation History 查看；如需再次生成，请创建新的变体、优化或补图轮次。');
}

function validateManagedAssets(db: StudioDatabase, studioId: string, projectId: string, result: PreflightResult): PreflightResult {
  const accepted = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  const referenceAssetIds = result.normalizedPlan.referenceAssetIds || [];
  const maskAssetId = result.normalizedPlan.maskAssetId;
  const access = inspectProjectAssetAccess(db, { studioId, projectId, assetIds: [...referenceAssetIds, ...(maskAssetId ? [maskAssetId] : [])] });
  let aggregateBytes = 0;
  for (const assetId of referenceAssetIds) {
    const asset = getStudioAsset(db, studioId, assetId);
    if (!asset || asset.deletedAt || !isStudioAssetMediaAvailable(db, studioId, assetId)) result.issues.push({ code: 'missing_reference_asset', message: '引用素材不存在、已删除、媒体缺失或不属于当前 Studio。', field: 'referenceAssetIds' });
    else {
      if (!projectAssetReferenceAllowed(access.get(assetId))) result.issues.push({ code: 'reference_asset_out_of_scope', message: '参考素材必须属于当前项目或已明确共享到跨项目素材。', field: 'referenceAssetIds' });
      aggregateBytes += asset.byteSize;
      if (!accepted.includes(asset.mediaType)) result.issues.push({ code: 'reference_media_unsupported', message: '引用素材不是支持的图像格式。', field: 'referenceAssetIds' });
    }
  }
  if (maskAssetId) {
    const mask = getStudioAsset(db, studioId, maskAssetId);
    if (!mask || mask.deletedAt || !isStudioAssetMediaAvailable(db, studioId, maskAssetId)) result.issues.push({ code: 'missing_mask_asset', message: '遮罩素材不存在、已删除、媒体缺失或不属于当前 Studio。', field: 'maskAssetId' });
    else {
      if (!projectAssetReferenceAllowed(access.get(maskAssetId))) result.issues.push({ code: 'mask_asset_out_of_scope', message: '遮罩素材必须属于当前项目或已明确共享到跨项目素材。', field: 'maskAssetId' });
      aggregateBytes += mask.byteSize;
      if (mask.mediaType !== 'image/png') result.issues.push({ code: 'mask_must_be_png', message: '遮罩必须是 PNG 格式的受管理资产。', field: 'maskAssetId' });
    }
  }
  if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > MAX_IMAGE_REQUEST_MEDIA_BYTES) result.issues.push({ code: 'reference_media_too_large', message: '参考素材和遮罩合计不能超过 64 MiB。', field: 'referenceAssetIds' });
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

export function preflightRound(db: StudioDatabase, input: { studioId: string; roundId: string; providerStatus: SafeProviderStatus }): PreflightResult {
  const round = resolveRoundInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.roundId, 'roundId'));
  const validated = validateManagedAssets(db, input.studioId, round.project_id, preflightGenerationPlan(parseObject(round.plan_json), input.providerStatus));
  if (round.status !== 'active') {
    return { ...validated, valid: false, issues: [{ code: 'round_not_confirmed', message: '创作计划需要在会话中确认后才能开始生图。', field: 'roundId' }, ...validated.issues] };
  }
  return validated;
}



function dryRunFromRow(row: { id: string; round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; item_count: number; execution_concurrency: number; concurrency_source: ConcurrencySource; created_at: string }): DryRunPreview {
  return { id: row.id, roundId: row.round_id, planVersion: row.plan_version, providerSnapshot: parseObject(row.provider_snapshot_json), planSnapshot: parsePlan(row.plan_snapshot_json), itemCount: row.item_count, executionConcurrency: Number(row.execution_concurrency), concurrencySource: row.concurrency_source, createdAt: row.created_at };
}

export function createDryRunPreview(db: StudioDatabase, input: { studioId: string; roundId: string; providerConfig: ResolvedProviderConfig; providerStatus: SafeProviderStatus; executionConcurrency?: unknown; concurrencySource?: unknown; idempotencyKey: string }): CommandReceipt<{ preview: DryRunPreview | null; preflight: PreflightResult }> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'rounds.dry_run', () => {
    const round = resolveRoundInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.roundId, 'roundId'));
    if (round.status !== 'active') throw new InvalidCommandError('Only a confirmed creative round can be dry-run.');
    assertRoundHasNoGenerationRun(db, round.id);
    if (input.providerConfig.providerId !== input.providerStatus.providerId) throw new InvalidCommandError('Provider configuration changed during dry-run.');
    const preflight = validateManagedAssets(db, input.studioId, round.project_id, preflightGenerationPlan(parseObject(round.plan_json), input.providerStatus));
    if (!preflight.valid) return { preview: null, preflight };
    const timestamp = nowIso();
    const id = createId('dryrun');
    const provider = providerSnapshot(input.providerConfig);
    const frozenConcurrency = resolveExecutionConcurrency(input.executionConcurrency, input.concurrencySource);
    db.prepare('INSERT INTO dry_run_previews (id, round_id, plan_version, provider_snapshot_json, plan_snapshot_json, item_count, execution_concurrency, concurrency_source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, round.id, round.plan_version, JSON.stringify(provider), JSON.stringify(preflight.normalizedPlan), preflight.normalizedPlan.itemCount, frozenConcurrency.executionConcurrency, frozenConcurrency.concurrencySource, timestamp);
    const insertItem = db.prepare('INSERT INTO dry_run_items (id, preview_id, sequence, prompt_payload_json, created_at) VALUES (?, ?, ?, ?, ?)');
    for (let sequence = 1; sequence <= preflight.normalizedPlan.itemCount; sequence += 1) insertItem.run(createId('dryitem'), id, sequence, JSON.stringify(promptPayloadForSequence(preflight.normalizedPlan, sequence)), timestamp);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'dry_run_preview', entityId: id, eventType: 'dry_run.created', payload: { roundId: round.id, planVersion: round.plan_version, itemCount: preflight.normalizedPlan.itemCount, ...frozenConcurrency } });
    return { preview: { id, roundId: round.id, planVersion: round.plan_version, providerSnapshot: provider, planSnapshot: preflight.normalizedPlan, itemCount: preflight.normalizedPlan.itemCount, ...frozenConcurrency, createdAt: timestamp }, preflight };
  }, { studioId: input.studioId, roundId: input.roundId, provider: providerSnapshot(input.providerConfig), concurrency: resolveExecutionConcurrency(input.executionConcurrency, input.concurrencySource) });
}

export function listDryRunPreviews(db: StudioDatabase, studioId: string, roundId: string): DryRunPreview[] {
  resolveRoundInStudio(db, requireValue(studioId, 'studioId'), requireValue(roundId, 'roundId'));
  return (db.prepare('SELECT preview.id, preview.round_id, preview.plan_version, preview.provider_snapshot_json, preview.plan_snapshot_json, preview.item_count, preview.execution_concurrency, preview.concurrency_source, preview.created_at FROM dry_run_previews preview JOIN creative_rounds round ON round.id = preview.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE preview.round_id = ? AND project.studio_id = ? ORDER BY preview.created_at DESC').all(roundId, studioId) as Array<{ id: string; round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; item_count: number; execution_concurrency: number; concurrency_source: ConcurrencySource; created_at: string }>).map(dryRunFromRow);
}

export function getDryRunPreview(db: StudioDatabase, studioId: string, roundId: string, previewId: string): DryRunPreview | null {
  const row = db.prepare('SELECT preview.id, preview.round_id, preview.plan_version, preview.provider_snapshot_json, preview.plan_snapshot_json, preview.item_count, preview.execution_concurrency, preview.concurrency_source, preview.created_at FROM dry_run_previews preview JOIN creative_rounds round ON round.id = preview.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE preview.id = ? AND preview.round_id = ? AND project.studio_id = ?').get(previewId, roundId, studioId) as { id: string; round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; item_count: number; execution_concurrency: number; concurrency_source: ConcurrencySource; created_at: string } | undefined;
  return row ? dryRunFromRow(row) : null;
}

export function queueGenerationRun(db: StudioDatabase, input: { studioId: string; roundId: string; providerConfig: ResolvedProviderConfig; providerStatus: SafeProviderStatus; preflightId?: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.queue', () => {
    const round = resolveRoundInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.roundId, 'roundId'));
    if (round.status !== 'active') throw new InvalidCommandError('The creative round must be confirmed before a run can be queued.');
    assertRoundHasNoGenerationRun(db, round.id);
    const preflight = validateManagedAssets(db, round.studio_id, round.project_id, preflightGenerationPlan(parseObject(round.plan_json), input.providerStatus));
    if (!preflight.valid) throw new InvalidCommandError('Generation preflight failed: ' + preflight.issues.map((issue) => issue.code).join(', '));
    const snapshot = providerSnapshot(input.providerConfig);
    if (!input.preflightId) throw new InvalidCommandError('Dry-run evidence is required before queueing.');
    const preview = db.prepare('SELECT round_id, plan_version, provider_snapshot_json, plan_snapshot_json, execution_concurrency, concurrency_source FROM dry_run_previews WHERE id = ?').get(input.preflightId) as { round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; execution_concurrency: number; concurrency_source: ConcurrencySource } | undefined;
    if (!preview || preview.round_id !== round.id || preview.plan_version !== round.plan_version || !storedSnapshotMatches(preview.provider_snapshot_json, snapshot) || !storedSnapshotMatches(preview.plan_snapshot_json, preflight.normalizedPlan)) throw new InvalidCommandError('Dry-run evidence is stale. Re-run preflight before queueing.');
    const id = createId('run');
    const timestamp = nowIso();
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, provider_profile_id, provider_config_version, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)').run(id, round.id, 'queued', JSON.stringify(snapshot), JSON.stringify(preflight.normalizedPlan), snapshot.profileId, snapshot.configVersion, preview.execution_concurrency, preview.concurrency_source, timestamp, timestamp);
    const insertItem = db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (let sequence = 1; sequence <= preflight.normalizedPlan.itemCount; sequence += 1) {
      const itemId = createId('item');
      const requestId = createId('request');
      insertItem.run(itemId, id, sequence, 'pending', JSON.stringify(promptPayloadForSequence(preflight.normalizedPlan, sequence)), requestId, timestamp, timestamp);
    }
    const frozen = { executionConcurrency: Number(preview.execution_concurrency), concurrencySource: preview.concurrency_source };
    appendStudioEvent(db, { studioId: round.studio_id, entityType: 'generation_run', entityId: id, eventType: 'run.queued', payload: { roundId: round.id, itemCount: preflight.normalizedPlan.itemCount, ...frozen } });
    return { id, roundId: round.id, status: 'queued', providerSnapshot: snapshot, planSnapshot: preflight.normalizedPlan, ...frozen, version: 1 };
  }, { studioId: input.studioId, roundId: input.roundId, preflightId: input.preflightId || null, provider: providerSnapshot(input.providerConfig) });
}

export function getGenerationRun(db: StudioDatabase, runId: string): GenerationRun | null {
  const row = db.prepare('SELECT id, round_id, status, provider_snapshot_json, plan_snapshot_json, execution_concurrency, concurrency_source, version FROM generation_runs WHERE id = ?').get(runId) as StoredRun | undefined;
  return row ? runFromRow(row) : null;
}

export function listGenerationRunItems(db: StudioDatabase, runId: string): GenerationRunItem[] {
  return (db.prepare('SELECT id, run_id, sequence, status, prompt_payload_json, request_id, lease_token, lease_expires_at, attempts, retry_at, error_json FROM run_items WHERE run_id = ? ORDER BY sequence').all(runId) as unknown as StoredRunItem[]).map(runItemFromRow);
}

export function getGenerationRunItem(db: StudioDatabase, itemId: string): GenerationRunItem | null {
  const row = db.prepare('SELECT id, run_id, sequence, status, prompt_payload_json, request_id, lease_token, lease_expires_at, attempts, retry_at, error_json FROM run_items WHERE id = ?').get(itemId) as StoredRunItem | undefined;
  return row ? runItemFromRow(row) : null;
}

const ACTIVE_RUN_ITEM_STATUSES: readonly RunItemStatus[] = ['pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'cancel_requested'];
const MAINTENANCE_BATCH_LIMIT = 1000;

export function settleTerminalGenerationRun(db: StudioDatabase, runId: string, now = new Date()): RunStatus | null {
  const run = getGenerationRun(db, runId);
  if (!run || !['running', 'pausing'].includes(run.status)) return null;
  const items = listGenerationRunItems(db, runId);
  if (!items.length || items.some((item) => ACTIVE_RUN_ITEM_STATUSES.includes(item.status))) return null;
  const successful = items.filter((item) => item.status === 'succeeded').length;
  const nextStatus: RunStatus = run.status === 'pausing' ? 'paused' : successful === items.length ? 'completed' : successful > 0 ? 'partial' : 'failed';
  const timestamp = now.toISOString();
  const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(runId) as { studio_id: string } | undefined;
  let settled = false;
  withTransaction(db, () => {
    assertRunTransition(run.status, nextStatus);
    const update = nextStatus === 'paused'
      ? db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ? AND version = ?').run(nextStatus, timestamp, runId, run.status, run.version)
      : db.prepare('UPDATE generation_runs SET status = ?, completed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ? AND version = ?').run(nextStatus, timestamp, timestamp, runId, run.status, run.version);
    if (Number(update.changes) !== 1) return;
    settled = true;
    if (studio) appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'generation_run', entityId: runId, eventType: 'run.' + nextStatus, payload: { succeeded: successful, total: items.length, reconciled: true } });
  });
  return settled ? nextStatus : null;
}

export function reconcileTerminalRuns(db: StudioDatabase, now = new Date()): number {
  const rows = db.prepare("SELECT r.id, r.status, r.version, p.studio_id, COUNT(i.id) AS total, SUM(CASE WHEN i.status IN ('pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'cancel_requested') THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN i.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded FROM generation_runs r JOIN run_items i ON i.run_id = r.id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.status IN ('running', 'pausing') GROUP BY r.id, r.status, r.version, p.studio_id HAVING active = 0 ORDER BY r.created_at, r.id LIMIT ?").all(MAINTENANCE_BATCH_LIMIT) as Array<{ id: string; status: RunStatus; version: number; studio_id: string; total: number; succeeded: number }>;
  if (!rows.length) return 0;
  const timestamp = now.toISOString();
  const markPaused = db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ? AND version = ?');
  const markTerminal = db.prepare('UPDATE generation_runs SET status = ?, completed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ? AND version = ?');
  let reconciled = 0;
  withTransaction(db, () => {
    for (const row of rows) {
      const nextStatus: RunStatus = row.status === 'pausing' ? 'paused' : Number(row.succeeded) === Number(row.total) ? 'completed' : Number(row.succeeded) > 0 ? 'partial' : 'failed';
      assertRunTransition(row.status, nextStatus);
      const update = nextStatus === 'paused'
        ? markPaused.run(nextStatus, timestamp, row.id, row.status, row.version)
        : markTerminal.run(nextStatus, timestamp, timestamp, row.id, row.status, row.version);
      if (Number(update.changes) !== 1) continue;
      reconciled += 1;
      appendStudioEvent(db, { studioId: row.studio_id, entityType: 'generation_run', entityId: row.id, eventType: 'run.' + nextStatus, payload: { succeeded: Number(row.succeeded), total: Number(row.total), reconciled: true } });
    }
  });
  return reconciled;
}

export function promoteDueRetryWaitItems(db: StudioDatabase, now = new Date()): number {
  return withTransaction(db, () => {
    const timestamp = now.toISOString();
    const rows = db.prepare("SELECT i.id, i.run_id, i.sequence, i.status, i.retry_at, p.studio_id FROM run_items i JOIN generation_runs r ON r.id = i.run_id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE i.status = 'retry_wait' AND i.retry_at IS NOT NULL AND i.retry_at <= ? AND r.status IN ('queued', 'running') ORDER BY r.created_at, i.sequence LIMIT ?").all(timestamp, MAINTENANCE_BATCH_LIMIT) as Array<{ id: string; run_id: string; sequence: number; status: RunItemStatus; retry_at: string; studio_id: string }>;
    let promoted = 0;
    const promote = db.prepare("UPDATE run_items SET status = 'pending', retry_at = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'retry_wait' AND retry_at IS NOT NULL AND retry_at <= ?");
    const promotedByRun = new Map<string, { studioId: string; count: number }>();
    for (const row of rows) {
      assertRunItemTransition(row.status, 'pending');
      const changed = promote.run(timestamp, row.id, timestamp);
      if (Number(changed.changes) !== 1) continue;
      const update = promotedByRun.get(row.run_id) || { studioId: row.studio_id, count: 0 };
      update.count += 1;
      promotedByRun.set(row.run_id, update);
      promoted += 1;
    }
    for (const [runId, update] of promotedByRun) appendStudioEvent(db, { studioId: update.studioId, entityType: 'generation_run', entityId: runId, eventType: 'run.retries_ready', payload: { count: update.count } });
    return promoted;
  });
}

function runConcurrencyLimit(executionConcurrency: number, globalLimit: number): number {
  return Math.min(MAX_GLOBAL_CONCURRENCY, globalLimit, executionConcurrency);
}

export function claimRunItems(db: StudioDatabase, input: { workerId: string; limit: number; globalLimit?: number; leaseMs: number; now?: Date; providerSnapshot?: { profileId: string; configVersion: number } }): ClaimedRunItem[] {
  const workerId = requireValue(input.workerId, 'workerId');
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new InvalidCommandError('Claim limit must be an integer between 1 and 1000.');
  const globalLimit = input.globalLimit === undefined ? input.limit : input.globalLimit;
  if (!Number.isInteger(globalLimit) || globalLimit < 1 || globalLimit > MAX_GLOBAL_CONCURRENCY) throw new InvalidCommandError('Global claim limit must be an integer between 1 and 1000.');
  if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1000) throw new InvalidCommandError('Lease duration must be at least 1000 ms.');
  const now = input.now || new Date();
  const nowValue = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.leaseMs).toISOString();
  return withTransaction(db, () => {
    const globalInFlight = db.prepare("SELECT COUNT(*) AS total FROM run_items WHERE status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested')").get() as { total: number };
    const availableSlots = Math.max(0, Math.min(input.limit, globalLimit - Number(globalInFlight.total)));
    if (!availableSlots) return [];
    const providerFilter = input.providerSnapshot ? ' AND r.provider_profile_id = ? AND r.provider_config_version = ?' : '';
    const sql = "WITH ranked_candidates AS (SELECT i.id, i.run_id, i.sequence, i.status, i.prompt_payload_json, i.request_id, i.lease_token, i.lease_expires_at, i.attempts, i.retry_at, i.lease_worker_id, r.status AS run_status, r.execution_concurrency, r.round_id, r.created_at AS run_created_at, p.studio_id, ROW_NUMBER() OVER (PARTITION BY i.run_id ORDER BY i.sequence) AS candidate_rank FROM run_items i JOIN generation_runs r ON r.id = i.run_id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE i.status = 'pending' AND r.status IN ('queued', 'running') AND (i.retry_at IS NULL OR i.retry_at <= ?)" + providerFilter + ") SELECT * FROM ranked_candidates WHERE candidate_rank <= MIN(execution_concurrency, ?) ORDER BY run_created_at, run_id, sequence";
    const params: Array<string | number> = [nowValue];
    if (input.providerSnapshot) params.push(input.providerSnapshot.profileId, input.providerSnapshot.configVersion);
    params.push(Math.min(MAX_GLOBAL_CONCURRENCY, availableSlots));
    type CandidateRow = StoredRunItem & { run_status: RunStatus; execution_concurrency: number; round_id: string; studio_id: string };
    const rows = db.prepare(sql).all(...params) as unknown as CandidateRow[];
    if (!rows.length) return [];
    const runIds = [...new Set(rows.map((row) => row.run_id))];
    const placeholders = runIds.map(() => '?').join(', ');
    const inFlightRows = db.prepare("SELECT run_id, COUNT(*) AS total FROM run_items WHERE run_id IN (" + placeholders + ") AND status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested') GROUP BY run_id").all(...runIds) as Array<{ run_id: string; total: number }>;
    const inFlightByRun = new Map(inFlightRows.map((row) => [row.run_id, Number(row.total)]));
    const rowsByRun = new Map<string, CandidateRow[]>();
    for (const row of rows) {
      const queue = rowsByRun.get(row.run_id);
      if (queue) queue.push(row);
      else rowsByRun.set(row.run_id, [row]);
    }
    const queueIndex = new Map<string, number>();
    const activatedRuns = new Set<string>();
    const leasedByRun = new Map<string, { studioId: string; count: number }>();
    const claimed: ClaimedRunItem[] = [];
    const startRun = db.prepare('UPDATE generation_runs SET status = ?, worker_id = ?, started_at = COALESCE(started_at, ?), version = version + 1, updated_at = ? WHERE id = ? AND status = ?');
    const leaseItem = db.prepare('UPDATE run_items SET status = ?, lease_token = ?, lease_worker_id = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = ?');
    let claimedInPass = true;
    while (claimed.length < availableSlots && claimedInPass) {
      claimedInPass = false;
      for (const [runId, queue] of rowsByRun) {
        if (claimed.length >= availableSlots) break;
        const index = queueIndex.get(runId) || 0;
        const row = queue[index];
        if (!row) continue;
        queueIndex.set(runId, index + 1);
        const inFlight = inFlightByRun.get(runId) || 0;
        if (inFlight >= runConcurrencyLimit(row.execution_concurrency, input.limit)) continue;
        if (row.run_status === 'queued' && !activatedRuns.has(runId)) {
          assertRunTransition('queued', 'running');
          const started = startRun.run('running', workerId, nowValue, nowValue, row.run_id, 'queued');
          if (Number(started.changes) === 1) appendStudioEvent(db, { studioId: row.studio_id, entityType: 'generation_run', entityId: row.run_id, eventType: 'run.started', payload: { workerId } });
          activatedRuns.add(runId);
        }
        const leaseToken = createId('lease');
        const updated = leaseItem.run('leased', leaseToken, workerId, expiresAt, nowValue, row.id, 'pending');
        if (Number(updated.changes) !== 1) continue;
        inFlightByRun.set(runId, inFlight + 1);
        claimedInPass = true;
        const leased = leasedByRun.get(row.run_id) || { studioId: row.studio_id, count: 0 };
        leased.count += 1;
        leasedByRun.set(row.run_id, leased);
        claimed.push({ ...runItemFromRow({ ...row, status: 'leased', lease_token: leaseToken, lease_expires_at: expiresAt, attempts: row.attempts + 1 }), promptPayload: parseObject(row.prompt_payload_json), studioId: row.studio_id });
      }
    }
    for (const [runId, leased] of leasedByRun) appendStudioEvent(db, { studioId: leased.studioId, entityType: 'generation_run', entityId: runId, eventType: 'run.items_leased', payload: { workerId, count: leased.count } });
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

export function markRunItemOutcomeUnknown(db: StudioDatabase, input: { itemId: string; requestId: string; reason: string; now?: Date; emitEvent?: boolean }): GenerationRunItem {
  return withTransaction(db, () => {
    const itemId = requireValue(input.itemId, 'itemId');
    const requestId = requireValue(input.requestId, 'requestId');
    const reason = requireValue(input.reason, 'reason');
    const row = db.prepare('SELECT id, run_id, sequence, status, prompt_payload_json, request_id, lease_token, lease_worker_id, lease_expires_at, attempts, retry_at, error_json FROM run_items WHERE id = ?').get(itemId) as StoredRunItem | undefined;
    if (!row) throw new StudioNotFoundError('Run item not found: ' + itemId);
    if (row.request_id !== requestId) throw new VersionConflictError('Run item request identity has changed.');
    if (row.status === 'outcome_unknown') return runItemFromRow(row);
    if (!['requesting', 'receiving', 'persisting', 'cancel_requested'].includes(row.status)) throw new VersionConflictError('Run item can no longer be marked as an unknown outcome.');
    assertRunItemTransition(row.status, 'outcome_unknown');
    const timestamp = (input.now || new Date()).toISOString();
    const error = { kind: 'unknown_outcome', code: reason };
    db.prepare("UPDATE run_items SET status = 'outcome_unknown', retry_at = NULL, error_json = ?, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(JSON.stringify(error), timestamp, row.id);
    const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(row.run_id) as { studio_id: string } | undefined;
    if (studio && input.emitEvent !== false) appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'run_item', entityId: row.id, eventType: 'run_item.outcome_unknown', payload: { runId: row.run_id, sequence: row.sequence, reason } });
    return { ...runItemFromRow(row), status: 'outcome_unknown', retryAt: null, leaseToken: null, leaseExpiresAt: null, error: safeErrorDetail(error) };
  });
}

export function transitionRunItem(db: StudioDatabase, input: { itemId: string; leaseToken: string; status: RunItemStatus; retryAt?: string; error?: Record<string, unknown>; result?: Record<string, unknown>; now?: Date; emitEvent?: boolean }): GenerationRunItem {
  return withTransaction(db, () => {
    const now = input.now || new Date();
    const row = db.prepare('SELECT id, run_id, sequence, status, prompt_payload_json, request_id, lease_token, lease_worker_id, lease_expires_at, attempts, retry_at FROM run_items WHERE id = ?').get(requireValue(input.itemId, 'itemId')) as StoredRunItem | undefined;
    if (!row) throw new StudioNotFoundError('Run item not found: ' + input.itemId);
    const leaseToken = requireValue(input.leaseToken, 'leaseToken');
    if (!row.lease_token || row.lease_token !== leaseToken) throw new VersionConflictError('Run item lease is no longer owned by this worker.');
    if (!row.lease_expires_at || new Date(row.lease_expires_at).getTime() <= now.getTime()) throw new VersionConflictError('Run item lease has expired.');
    assertRunItemTransition(row.status, input.status);
    if (input.status === 'retry_wait' && !input.retryAt) throw new InvalidCommandError('A retry timestamp is required for retry_wait.');
    const clearLease = ['pending', 'retry_wait', 'blocked', 'cancelled', 'outcome_unknown', 'failed', 'succeeded'].includes(input.status);
    db.prepare('UPDATE run_items SET status = ?, retry_at = ?, error_json = ?, result_json = ?, lease_token = CASE WHEN ? THEN NULL ELSE lease_token END, lease_worker_id = CASE WHEN ? THEN NULL ELSE lease_worker_id END, lease_expires_at = CASE WHEN ? THEN NULL ELSE lease_expires_at END, updated_at = ? WHERE id = ?').run(
      input.status,
      input.retryAt || null,
      input.error ? JSON.stringify(input.error) : null,
      input.result ? JSON.stringify(input.result) : null,
      clearLease ? 1 : 0,
      clearLease ? 1 : 0,
      clearLease ? 1 : 0,
      now.toISOString(),
      row.id
    );
    const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(row.run_id) as { studio_id: string } | undefined;
    if (studio && input.emitEvent !== false) appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'run_item', entityId: row.id, eventType: 'run_item.' + input.status, payload: { runId: row.run_id, sequence: row.sequence } });
    return { ...runItemFromRow(row), status: input.status, retryAt: input.retryAt || null, leaseToken: clearLease ? null : row.lease_token, leaseExpiresAt: clearLease ? null : row.lease_expires_at };
  });
}

export function pauseGenerationRun(db: StudioDatabase, input: { studioId: string; runId: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.pause', () => {
    const run = resolveRunInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.runId, 'runId'));
    assertRunTransition(run.status, 'pausing');
    const inFlight = countInFlightItems(db, run.id);
    const status: RunStatus = inFlight === 0 ? 'paused' : 'pausing';
    if (status === 'paused') assertRunTransition('pausing', 'paused');
    db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run(status, nowIso(), run.id);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: run.id, eventType: status === 'paused' ? 'run.paused' : 'run.pausing', payload: {} });
    return { ...runFromRow(run), status, version: run.version + 1 };
  }, input);
}


export function resolveUnknownRunItems(db: StudioDatabase, input: { studioId: string; runId: string; itemIds: string[]; idempotencyKey: string }): CommandReceipt<{ runId: string; resolvedItemIds: string[] }> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.resolve_unknown', () => {
    const runId = requireValue(input.runId, 'runId');
    resolveRunInStudio(db, requireValue(input.studioId, 'studioId'), runId);
    const ids = [...new Set(input.itemIds.filter((itemId): itemId is string => typeof itemId === 'string' && itemId.trim().length > 0))];
    if (!ids.length) throw new InvalidCommandError('At least one unknown-outcome item must be explicitly resolved.');
    const items = ids.map((itemId) => resolveRunItemInStudio(db, input.studioId, itemId));
    if (items.some((item) => item.run_id !== runId || item.status !== 'outcome_unknown')) throw new InvalidCommandError('One or more run items are not unresolved unknown outcomes in this generation run.');
    const timestamp = nowIso();
    for (const item of items) {
      const changed = db.prepare("UPDATE run_items SET status = 'failed', error_json = ?, updated_at = ? WHERE id = ? AND run_id = ? AND status = 'outcome_unknown'").run(JSON.stringify({ code: 'user_resolved_unknown_outcome' }), timestamp, item.id, runId);
      if (Number(changed.changes) !== 1) throw new VersionConflictError('Run item changed while its unknown outcome was being resolved.');
    }
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: runId, eventType: 'run.outcomes_resolved', payload: { count: items.length } });
    return { runId, resolvedItemIds: ids };
  }, input);
}


export function retryGenerationRunItems(db: StudioDatabase, input: { studioId: string; runId: string; itemIds?: string[]; idempotencyKey: string }): CommandReceipt<{ runId: string; retriedItemIds: string[] }> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.retry', () => {
    const runId = requireValue(input.runId, 'runId');
    const run = resolveRunInStudio(db, requireValue(input.studioId, 'studioId'), runId);
    if (run.status === 'resume_pending') throw new InvalidCommandError('Restart recovery must be confirmed through a Studio Session before retrying.');
    if (!['queued', 'running', 'paused', 'partial', 'failed'].includes(run.status)) throw new InvalidCommandError('This generation run cannot be retried in its current state.');
    const requested = [...new Set((input.itemIds || []).filter((itemId): itemId is string => typeof itemId === 'string' && itemId.trim().length > 0))];
    const requestedItems = requested.map((itemId) => resolveRunItemInStudio(db, input.studioId, itemId));
    if (requestedItems.some((item) => item.run_id !== runId)) throw new InvalidCommandError('One or more run items do not belong to this generation run.');
    const retryable = db.prepare("SELECT id, status, error_json FROM run_items WHERE run_id = ? AND status IN ('failed', 'blocked', 'retry_wait')").all(runId) as unknown as Array<{ id: string; status: RunItemStatus; error_json: string | null }>;
    const candidates = requested.length ? retryable.filter((item) => requested.includes(item.id)) : retryable;
    if (!candidates.length) throw new InvalidCommandError('No retryable run items were selected.');
    if (requested.length && candidates.length !== requested.length) throw new InvalidCommandError('One or more run items are not retryable in this generation run.');
    const timestamp = nowIso();
    for (const item of candidates) {
      if (item.error_json && item.error_json.includes('user_resolved_unknown_outcome')) throw new InvalidCommandError('An outcome resolved as unknown cannot be retried; create a new round after reviewing the result.');
      assertRunItemTransition(item.status, 'pending');
      db.prepare("UPDATE run_items SET status = 'pending', request_id = ?, retry_at = NULL, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(createId('request'), timestamp, item.id);
    }
    if (['paused', 'partial', 'failed'].includes(run.status)) {
      assertRunTransition(run.status, 'queued');
      db.prepare("UPDATE generation_runs SET status = 'queued', worker_id = NULL, version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, runId);
      appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: runId, eventType: 'run.queued', payload: { retried: true, itemCount: candidates.length } });
    } else appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: runId, eventType: 'run.items_retried', payload: { itemCount: candidates.length } });
    return { runId, retriedItemIds: candidates.map((item) => item.id) };
  }, input);
}

export function resumeGenerationRun(db: StudioDatabase, input: { studioId: string; runId: string; sessionId?: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.resume', () => {
    const run = resolveRunInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.runId, 'runId'));
    const unknown = db.prepare("SELECT COUNT(*) AS total FROM run_items WHERE run_id = ? AND status = 'outcome_unknown'").get(run.id) as { total: number };
    if (unknown.total > 0) throw new InvalidCommandError('This run has provider requests with unknown outcomes and cannot resume automatically.');
    if (run.status === 'resume_pending') {
      const sessionId = requireValue(input.sessionId || '', 'sessionId');
      const session = db.prepare('SELECT id, active_round_id FROM studio_sessions WHERE id = ? AND studio_id = ?').get(sessionId, input.studioId) as { id: string; active_round_id: string | null } | undefined;
      if (!session || session.active_round_id !== run.round_id) throw new InvalidCommandError('A Studio Session confirmation for this creative round is required before resuming after restart.');
      db.prepare('INSERT INTO run_resume_confirmations (id, run_id, session_id, confirmed_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, session_id) DO NOTHING').run(createId('resumeconfirm'), run.id, sessionId, nowIso());
    }
    assertRunTransition(run.status, 'queued');
    db.prepare('UPDATE generation_runs SET status = ?, worker_id = NULL, version = version + 1, updated_at = ? WHERE id = ?').run('queued', nowIso(), run.id);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: run.id, eventType: 'run.queued', payload: { resumed: true, sessionId: input.sessionId || null } });
    return { ...runFromRow(run), status: 'queued', version: run.version + 1 };
  }, input);
}

export function cancelGenerationRun(db: StudioDatabase, input: { studioId: string; runId: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.cancel', () => {
    const run = resolveRunInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.runId, 'runId'));
    assertRunTransition(run.status, 'cancelled');
    const timestamp = nowIso();
    const items = db.prepare("SELECT id, status, sequence FROM run_items WHERE run_id = ? AND status IN ('pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'blocked') ORDER BY sequence").all(run.id) as Array<{ id: string; status: RunItemStatus; sequence: number }>;
    for (const item of items) {
      assertRunItemTransition(item.status, 'cancel_requested');
      const active = ['requesting', 'receiving', 'persisting'].includes(item.status);
      if (active) {
        const changed = db.prepare("UPDATE run_items SET status = 'cancel_requested', updated_at = ? WHERE id = ? AND status = ?").run(timestamp, item.id, item.status);
        if (Number(changed.changes) !== 1) throw new VersionConflictError('Run item changed while cancellation was being requested.');
        continue;
      }
      assertRunItemTransition('cancel_requested', 'cancelled');
      const changed = db.prepare("UPDATE run_items SET status = 'cancelled', retry_at = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = ?").run(timestamp, item.id, item.status);
      if (Number(changed.changes) !== 1) throw new VersionConflictError('Run item changed while cancellation was being completed.');
    }
    const changed = db.prepare('UPDATE generation_runs SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = ? AND version = ?').run('cancelled', timestamp, run.id, run.status, run.version);
    if (Number(changed.changes) !== 1) throw new VersionConflictError('Generation run changed while cancellation was being completed.');
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: run.id, eventType: 'run.cancelled', payload: {} });
    return { ...runFromRow(run), status: 'cancelled', version: run.version + 1 };
  }, input);
}

export function recoverExpiredLeases(db: StudioDatabase, now = new Date()): number {
  return withTransaction(db, () => {
    const timestamp = now.toISOString();
    const rows = db.prepare("SELECT i.id, i.run_id, i.sequence, i.status, p.studio_id FROM run_items i JOIN generation_runs r ON r.id = i.run_id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE i.status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested') AND i.lease_expires_at IS NOT NULL AND i.lease_expires_at <= ? ORDER BY r.created_at, i.sequence LIMIT ?").all(timestamp, MAINTENANCE_BATCH_LIMIT) as Array<{ id: string; run_id: string; sequence: number; status: RunItemStatus; studio_id: string }>;
    const recover = db.prepare('UPDATE run_items SET status = ?, retry_at = NULL, error_json = ?, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?');
    const recoveredByRun = new Map<string, { studioId: string; count: number; unknown: number }>();
    let recovered = 0;
    for (const row of rows) {
      const nextStatus: RunItemStatus = row.status === 'leased' ? 'pending' : 'outcome_unknown';
      assertRunItemTransition(row.status, nextStatus);
      const error = nextStatus === 'outcome_unknown' ? JSON.stringify({ kind: 'unknown_outcome', code: 'lease_expired' }) : null;
      const changed = recover.run(nextStatus, error, timestamp, row.id, row.status, timestamp);
      if (Number(changed.changes) !== 1) continue;
      const update = recoveredByRun.get(row.run_id) || { studioId: row.studio_id, count: 0, unknown: 0 };
      update.count += 1;
      if (nextStatus === 'outcome_unknown') update.unknown += 1;
      recoveredByRun.set(row.run_id, update);
      recovered += 1;
    }
    for (const [runId, update] of recoveredByRun) appendStudioEvent(db, { studioId: update.studioId, entityType: 'generation_run', entityId: runId, eventType: 'run.leases_recovered', payload: { count: update.count, unknown: update.unknown } });
    return recovered;
  });
}

export function markRunsResumePending(db: StudioDatabase): number {
  return withTransaction(db, () => {
    const rows = db.prepare("SELECT r.id, r.status, r.version, p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.status IN ('queued', 'running', 'pausing')").all() as Array<{ id: string; status: RunStatus; version: number; studio_id: string }>;
    const timestamp = nowIso();
    const recoverItem = db.prepare('UPDATE run_items SET status = ?, retry_at = NULL, error_json = ?, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = ?');
    const markRun = db.prepare('UPDATE generation_runs SET status = ?, worker_id = NULL, version = version + 1, updated_at = ? WHERE id = ? AND status = ? AND version = ?');
    let marked = 0;
    for (const row of rows) {
      assertRunTransition(row.status, 'resume_pending');
      const items = db.prepare("SELECT id, sequence, status FROM run_items WHERE run_id = ? AND status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested') ORDER BY sequence").all(row.id) as Array<{ id: string; sequence: number; status: RunItemStatus }>;
      for (const item of items) {
        const nextStatus: RunItemStatus = item.status === 'leased' ? 'pending' : 'outcome_unknown';
        assertRunItemTransition(item.status, nextStatus);
        const error = nextStatus === 'outcome_unknown' ? JSON.stringify({ kind: 'unknown_outcome', code: 'startup_recovery' }) : null;
        const changed = recoverItem.run(nextStatus, error, timestamp, item.id, item.status);
        if (Number(changed.changes) !== 1) throw new VersionConflictError('Run item changed during startup recovery.');
      }
      const changed = markRun.run('resume_pending', timestamp, row.id, row.status, row.version);
      if (Number(changed.changes) !== 1) throw new VersionConflictError('Generation run changed during startup recovery.');
      appendStudioEvent(db, { studioId: row.studio_id, entityType: 'generation_run', entityId: row.id, eventType: 'run.resume_pending', payload: { recoveredItemCount: items.length } });
      marked += 1;
    }
    return marked;
  });
}
