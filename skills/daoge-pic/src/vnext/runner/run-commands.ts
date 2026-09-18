import { createId, nowIso } from '../shared/ids';
import { assertRunItemTransition, assertRunTransition, OPEN_RUN_STATUSES, RunItemStatus, RunStatus } from '../domain/states';
import { CommandReceipt, executeIdempotent, InvalidCommandError, StudioNotFoundError, VersionConflictError } from '../domain/studio-commands';
import { MAX_IMAGE_REQUEST_MEDIA_BYTES } from '../providers/contracts';
import { providerDescriptor } from '../providers/descriptors';
import { ITEM_PROMPT_PREFIX, PreflightPlan, PreflightResult, preflightGenerationPlan } from './preflight';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { providerSnapshot, ResolvedProviderConfig, SafeProviderStatus } from '../studio/provider-config';
import { ConcurrencySource, MAX_GLOBAL_CONCURRENCY, resolveExecutionConcurrency } from '../studio/runtime-settings';
import { getStudioAsset, isStudioAssetMediaAvailable } from '../domain/assets';
import { inspectProjectAssetAccess, projectAssetReferenceAllowed } from '../domain/asset-access';
import { SafeErrorDetail, safeErrorDetail } from '../shared/safe-error';
import { canonicalJson } from '../shared/canonical-json';
import { evaluateBudgetGate, getBudgetPolicy, unknownUsageEstimate } from '../usage/budget';
import { budgetReservesRunStatus, parseStoredUsageEstimate, recordUsageEvent, UsageBillingState, UsageEstimate } from '../usage/ledger';
import { selectInStudioSql } from '../domain/studio-scope';

const MEDIA_TYPES_BY_ID = (values: readonly string[]): Record<string, true> => Object.fromEntries(values.map((value) => [value, true]));
const OPEN_RUN_STATUSES_SQL = '(' + OPEN_RUN_STATUSES.map((status) => "'" + status + "'").join(', ') + ')';
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
  usageEstimate: UsageEstimate;
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

function storedSnapshotMatches(serialized: string, expected: unknown): boolean {
  try { return canonicalJson(JSON.parse(serialized)) === canonicalJson(expected); } catch { return false; }
}

function promptPayloadForSequence(plan: PreflightPlan, sequence: number): Record<string, unknown> {
  const { itemPrompts, ...sharedPlan } = plan;
  const scene = itemPrompts?.[sequence - 1];
  return {
    ...sharedPlan,
    prompt: scene ? sharedPlan.prompt + ITEM_PROMPT_PREFIX + scene : sharedPlan.prompt,
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
const RUN_PROVIDER_USAGE_KEY_PREFIX = 'runner-provider-';
const RUN_PROVIDER_USAGE_ESTIMATE: UsageEstimate = { unit: 'image', quantity: 1, estimatedCostMinor: null, costUnit: null, source: 'unknown' };

/**
 * Project the estimate frozen at queue time onto one run item. A declared estimate is a total for the whole
 * run, so the integer remainder is spread over the leading items: the sum over all items equals the declared
 * total exactly, and a retried item that issues another request legitimately adds its share again.
 * An unknown estimate stays unknown -- the platform never invents a price, so a budget can still only bite
 * when the caller declared a known cost.
 */
function runItemUsageEstimate(db: StudioDatabase, runItemId: string): UsageEstimate {
  const row = db.prepare('SELECT item.run_id AS run_id, item.sequence AS sequence, run.usage_estimate_json AS usage_estimate_json FROM run_items item JOIN generation_runs run ON run.id = item.run_id WHERE item.id = ?').get(runItemId) as { run_id: string; sequence: number; usage_estimate_json: string | null } | undefined;
  if (!row) return RUN_PROVIDER_USAGE_ESTIMATE;
  const counts = db.prepare('SELECT COUNT(*) AS total FROM run_items WHERE run_id = ?').get(row.run_id) as { total: number } | undefined;
  const itemCount = Math.max(1, Number(counts?.total || 1));
  const declared = parseUsageEstimate(row.usage_estimate_json, itemCount);
  if (declared.estimatedCostMinor === null || declared.costUnit === null) return RUN_PROVIDER_USAGE_ESTIMATE;
  const sequence = Math.min(itemCount, Math.max(1, Number(row.sequence) || 1));
  const share = Math.floor(declared.estimatedCostMinor / itemCount) + (sequence <= declared.estimatedCostMinor % itemCount ? 1 : 0);
  return { unit: declared.unit || 'image', quantity: 1, estimatedCostMinor: share, costUnit: declared.costUnit, source: declared.source === 'unknown' ? 'caller' : declared.source };
}
interface RetryBudgetCandidate {
  itemId: string;
  estimate: UsageEstimate;
  addReservation: boolean;
}

interface RetryBudgetGroup {
  policyProfileId: string | null;
  costUnit: string;
  unit: string;
  source: UsageEstimate['source'];
  quantity: number;
  estimatedCostMinor: number;
  candidates: RetryBudgetCandidate[];
}

function hasRecordedRunItemUsage(db: StudioDatabase, studioId: string, runItemId: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM usage_ledger WHERE studio_id = ? AND run_item_id = ? AND estimated_cost_minor IS NOT NULL AND estimate_source IN ('caller', 'provider') LIMIT 1").get(studioId, runItemId));
}

function retryBudgetCandidates(db: StudioDatabase, studioId: string, run: GenerationRun, items: Array<{ id: string }>): RetryBudgetCandidate[] {
  return items.map((item) => ({
    itemId: item.id,
    estimate: runItemUsageEstimate(db, item.id),
    addReservation: !budgetReservesRunStatus(run.status) || hasRecordedRunItemUsage(db, studioId, item.id)
  }));
}

/**
 * Decides which retry candidates may run again. `budgetReservesRunStatus` deliberately excludes `failed`, so a
 * failed run releases its reservation instead of blocking new work until the operator resolves it; the retry
 * path re-clears the gate instead by adding each candidate's own share back as a reservation. The two halves are
 * one design -- do not "fix" one without the other.
 */
function retryBudgetDecisions(db: StudioDatabase, studioId: string, run: GenerationRun, items: Array<{ id: string }>): { allowed: Set<string>; blocked: Set<string>; blockedCodes: string[] } {
  const candidates = retryBudgetCandidates(db, studioId, run, items);
  const allowed = new Set(candidates.map((candidate) => candidate.itemId));
  const blocked = new Set<string>();
  const blockedCodes = new Set<string>();
  const groups = new Map<string, RetryBudgetGroup>();
  const runProfileId = typeof run.providerSnapshot.profileId === 'string' && run.providerSnapshot.profileId.trim() ? run.providerSnapshot.profileId : null;
  const explicitPolicy = runProfileId ? getBudgetPolicy(db, { studioId, profileId: runProfileId }) : null;
  const globalPolicy = explicitPolicy ? null : getBudgetPolicy(db, { studioId, profileId: null });
  const policy = explicitPolicy || globalPolicy;
  if (!policy) return { allowed, blocked, blockedCodes: [] };
  for (const candidate of candidates) {
    if (candidate.estimate.estimatedCostMinor === null || candidate.estimate.costUnit === null) continue;
    const key = policy.id + '\u0000' + candidate.estimate.costUnit;
    const current = groups.get(key);
    if (current) {
      current.quantity += candidate.estimate.quantity;
      const additional = candidate.addReservation ? candidate.estimate.estimatedCostMinor : 0;
      if (!Number.isSafeInteger(current.estimatedCostMinor + additional)) throw new InvalidCommandError('Retry usage estimate exceeds the supported safe integer range.');
      current.estimatedCostMinor += additional;
      current.candidates.push(candidate);
    } else {
      groups.set(key, {
        policyProfileId: policy.profileId,
        costUnit: candidate.estimate.costUnit,
        unit: candidate.estimate.unit,
        source: candidate.estimate.source,
        quantity: candidate.estimate.quantity,
        estimatedCostMinor: candidate.addReservation ? candidate.estimate.estimatedCostMinor : 0,
        candidates: [candidate]
      });
    }
  }
  for (const group of groups.values()) {
    const gate = evaluateBudgetGate(db, {
      studioId,
      profileId: group.policyProfileId,
      estimate: {
        unit: group.unit,
        quantity: group.quantity,
        estimatedCostMinor: group.estimatedCostMinor,
        costUnit: group.costUnit,
        source: group.source
      }
    });
    if (gate.allowed) continue;
    blockedCodes.add(gate.code);
    for (const candidate of group.candidates) {
      allowed.delete(candidate.itemId);
      blocked.add(candidate.itemId);
    }
  }
  return { allowed, blocked, blockedCodes: [...blockedCodes] };
}

function assertRetryBudget(db: StudioDatabase, studioId: string, run: GenerationRun, items: Array<{ id: string }>): void {
  const decisions = retryBudgetDecisions(db, studioId, run, items);
  if (!decisions.blocked.size) return;
  throw new InvalidCommandError('Generation budget gate failed: ' + decisions.blockedCodes.join(', ') + '（本次重试有 ' + decisions.blocked.size + ' 项未通过预算闸门）。');
}

export function recordRunItemUsage(db: StudioDatabase, input: { studioId: string; runItemId: string; requestId: string; billingState: UsageBillingState }): void {
  const existing = db.prepare('SELECT billing_state FROM usage_ledger WHERE studio_id = ? AND idempotency_key = ?').get(input.studioId, RUN_PROVIDER_USAGE_KEY_PREFIX + input.requestId) as { billing_state?: UsageBillingState } | undefined;
  const billingState = existing?.billing_state || input.billingState;
  recordUsageEvent(db, {
    studioId: input.studioId,
    runItemId: input.runItemId,
    estimate: runItemUsageEstimate(db, input.runItemId),
    billingState,
    idempotencyKey: RUN_PROVIDER_USAGE_KEY_PREFIX + input.requestId
  });
}



function resolveRoundInStudio(db: StudioDatabase, studioId: string, roundId: string): StoredRoundPlan {
  const row = db.prepare(selectInStudioSql('creative_round', 'round.id, round.status, round.plan_json, round.plan_version, project.studio_id, project.id AS project_id')).get(roundId, studioId) as StoredRoundPlan | undefined;
  if (!row) throw new StudioNotFoundError('Creative round not found: ' + roundId);
  return row;
}

function resolveRunInStudio(db: StudioDatabase, studioId: string, runId: string): StoredRun & { studio_id: string } {
  const row = db.prepare(selectInStudioSql('generation_run', 'run.id, run.round_id, run.status, run.provider_snapshot_json, run.plan_snapshot_json, run.execution_concurrency, run.concurrency_source, run.version, project.studio_id')).get(runId, studioId) as (StoredRun & { studio_id: string }) | undefined;
  if (!row) throw new StudioNotFoundError('Generation run not found: ' + runId);
  return row;
}

function resolveRunItemInStudio(db: StudioDatabase, studioId: string, itemId: string): { id: string; run_id: string; status: RunItemStatus; error_json: string | null } {
  const row = db.prepare(selectInStudioSql('run_item', 'item.id, item.run_id, item.status, item.error_json')).get(itemId, studioId) as { id: string; run_id: string; status: RunItemStatus; error_json: string | null } | undefined;
  if (!row) throw new StudioNotFoundError('Generation run item not found: ' + itemId);
  return row;
}

function assertRoundHasNoGenerationRun(db: StudioDatabase, roundId: string): void {
  const existing = db.prepare('SELECT id, status FROM generation_runs WHERE round_id = ? ORDER BY created_at, id LIMIT 1').get(roundId) as { id: string; status: RunStatus } | undefined;
  if (existing) throw new VersionConflictError('当前轮次已创建生成运行 ' + existing.id + '（' + existing.status + '）。请在 Generation History 查看；如需再次生成，请创建新的变体、优化或补图轮次。');
}

function assertRoundHasNoOpenSibling(db: StudioDatabase, roundId: string, runId: string): void {
  const sibling = db.prepare('SELECT id, status FROM generation_runs WHERE round_id = ? AND id <> ? AND status IN ' + OPEN_RUN_STATUSES_SQL + ' ORDER BY created_at, id LIMIT 1').get(roundId, runId) as { id: string; status: RunStatus } | undefined;
  if (sibling) throw new VersionConflictError('当前轮次存在另一个正在进行的生成运行 ' + sibling.id + '（' + sibling.status + '）。请先在 Generation History 处理该运行，再恢复或重试。');
}

function assertNoDegradedOpenRunConflicts(db: StudioDatabase): void {
  const conflicts = db.prepare('SELECT round_id, COUNT(*) AS open_runs FROM generation_runs WHERE status IN ' + OPEN_RUN_STATUSES_SQL + ' GROUP BY round_id HAVING open_runs > 1 ORDER BY round_id LIMIT 20').all() as Array<{ round_id: string; open_runs: number }>;
  if (conflicts.length) throw new InvalidCommandError('Generation worker is paused because migration v34 is pending in degraded mode for conflicted round(s): ' + conflicts.map((row) => row.round_id).join(', ') + '. Resolve duplicate open runs by cancelling or otherwise terminally closing all but one, then reopen the Studio.');
}

function isUniqueViolation(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code || '');
  return code.startsWith('SQLITE_CONSTRAINT') || /UNIQUE constraint failed/i.test(String((error as Error | null)?.message || ''));
}

/**
 * The read-then-insert above is only a friendly error, not a guarantee: two
 * queue requests can pass it together. The database carries the real
 * constraint, so a violation there has to come back as the same conflict rather
 * than as a raw SQLite error.
 */
function insertQueuedRun(db: StudioDatabase, input: {
  id: string;
  roundId: string;
  snapshotJson: string;
  planJson: string;
  profileId: string | null;
  configVersion: number | null;
  executionConcurrency: number;
  concurrencySource: ConcurrencySource;
  estimateJson: string;
  timestamp: string;
}): void {
  try {
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, provider_profile_id, provider_config_version, execution_concurrency, concurrency_source, usage_estimate_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)').run(input.id, input.roundId, 'queued', input.snapshotJson, input.planJson, input.profileId, input.configVersion, input.executionConcurrency, input.concurrencySource, input.estimateJson, input.timestamp, input.timestamp);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = db.prepare('SELECT id, status FROM generation_runs WHERE round_id = ? ORDER BY created_at, id LIMIT 1').get(input.roundId) as { id: string; status: RunStatus } | undefined;
    throw new VersionConflictError(existing
      ? '当前轮次已创建生成运行 ' + existing.id + '（' + existing.status + '）。请在 Generation History 查看；如需再次生成，请创建新的变体、优化或补图轮次。'
      : '当前轮次已有正在进行的生成运行，请稍后重试。');
  }
}

function validateManagedAssets(db: StudioDatabase, studioId: string, projectId: string, result: PreflightResult, providerStatus: SafeProviderStatus): PreflightResult {
  const descriptor = providerStatus.providerId ? providerDescriptor(providerStatus.providerId) : null;
  const accepted = MEDIA_TYPES_BY_ID(descriptor?.reference.acceptedMediaTypes || []);
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
      if (!accepted[asset.mediaType]) result.issues.push({ code: 'reference_media_unsupported', message: '引用素材不是当前 Provider 支持的图像格式。', field: 'referenceAssetIds' });
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

function applyProviderProfileLimits(result: PreflightResult, providerConfig: ResolvedProviderConfig): PreflightResult {
  const issues = [...result.issues];
  const normalizedPlan: PreflightPlan = { ...result.normalizedPlan, output: { ...(result.normalizedPlan.output || {}) } };
  if (providerConfig.limits.maxRunItems && normalizedPlan.itemCount > providerConfig.limits.maxRunItems && !issues.some((issue) => issue.code === 'provider_item_limit_exceeded')) {
    issues.push({ code: 'provider_item_limit_exceeded', message: '当前 Provider Profile 限制单次最多 ' + providerConfig.limits.maxRunItems + ' 张。', field: 'itemCount' });
  }
  if (providerConfig.limits.requestTimeoutMs) normalizedPlan.output = { ...(normalizedPlan.output || {}), timeoutMs: providerConfig.limits.requestTimeoutMs };
  return { valid: issues.length === 0, issues, normalizedPlan };
}
function estimateForPlan(plan: PreflightPlan, estimate?: UsageEstimate): UsageEstimate {
  return estimate === undefined ? unknownUsageEstimate(plan.itemCount) : estimate;
}

function applyBudgetGate(db: StudioDatabase, result: PreflightResult, input: { studioId: string; profileId?: string | null; projectId: string; roundId: string; estimate?: UsageEstimate }): { result: PreflightResult; estimate: UsageEstimate } {
  const estimate = estimateForPlan(result.normalizedPlan, input.estimate);
  try {
    const gate = evaluateBudgetGate(db, { studioId: input.studioId, profileId: input.profileId, projectId: input.projectId, roundId: input.roundId, estimate });
    if (!gate.allowed) return { result: { ...result, valid: false, issues: [...result.issues, { code: gate.code, message: gate.message, field: 'usageEstimate' }] }, estimate };
    return { result, estimate };
  } catch (error) {
    if (error instanceof InvalidCommandError) return { result: { ...result, valid: false, issues: [...result.issues, { code: 'invalid_budget_estimate', message: error.message, field: 'usageEstimate' }] }, estimate };
    throw error;
  }
}

const FROZEN_USAGE_ESTIMATE_ERROR = 'Frozen usage estimate is invalid.';

function parseUsageEstimate(value: string | null | undefined, quantity: number): UsageEstimate {
  try {
    return parseStoredUsageEstimate(value, quantity);
  } catch {
    throw new InvalidCommandError(FROZEN_USAGE_ESTIMATE_ERROR);
  }
}

export function preflightRound(db: StudioDatabase, input: { studioId: string; roundId: string; providerStatus: SafeProviderStatus; usageEstimate?: UsageEstimate }): PreflightResult {
  const round = resolveRoundInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.roundId, 'roundId'));
  let validated = validateManagedAssets(db, input.studioId, round.project_id, preflightGenerationPlan(parseObject(round.plan_json), input.providerStatus), input.providerStatus);
  const gated = applyBudgetGate(db, validated, { studioId: input.studioId, profileId: input.providerStatus.profileId, projectId: round.project_id, roundId: round.id, estimate: input.usageEstimate });
  validated = gated.result;
  if (round.status !== 'active') return { ...validated, valid: false, issues: [{ code: 'round_not_confirmed', message: '创作计划需要在会话中确认后才能开始生图。', field: 'roundId' }, ...validated.issues] };
  return validated;
}

function dryRunFromRow(row: { id: string; round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; item_count: number; execution_concurrency: number; concurrency_source: ConcurrencySource; usage_estimate_json?: string | null; created_at: string }): DryRunPreview {
  return { id: row.id, roundId: row.round_id, planVersion: row.plan_version, providerSnapshot: parseObject(row.provider_snapshot_json), planSnapshot: parsePlan(row.plan_snapshot_json), itemCount: row.item_count, executionConcurrency: Number(row.execution_concurrency), concurrencySource: row.concurrency_source, usageEstimate: parseUsageEstimate(row.usage_estimate_json, Number(row.item_count)), createdAt: row.created_at };
}

export function createDryRunPreview(db: StudioDatabase, input: { studioId: string; roundId: string; providerConfig: ResolvedProviderConfig; providerStatus: SafeProviderStatus; executionConcurrency?: unknown; concurrencySource?: unknown; usageEstimate?: UsageEstimate; idempotencyKey: string }): CommandReceipt<{ preview: DryRunPreview | null; preflight: PreflightResult }> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'rounds.dry_run', () => {
    const round = resolveRoundInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.roundId, 'roundId'));
    if (round.status !== 'active') throw new InvalidCommandError('Only a confirmed creative round can be dry-run.');
    assertRoundHasNoGenerationRun(db, round.id);
    if (input.providerConfig.providerId !== input.providerStatus.providerId) throw new InvalidCommandError('Provider configuration changed during dry-run.');
    let preflight = validateManagedAssets(db, input.studioId, round.project_id, preflightGenerationPlan(parseObject(round.plan_json), input.providerStatus), input.providerStatus);
    preflight = applyProviderProfileLimits(preflight, input.providerConfig);
    const gated = applyBudgetGate(db, preflight, { studioId: input.studioId, profileId: input.providerConfig.profileId, projectId: round.project_id, roundId: round.id, estimate: input.usageEstimate });
    preflight = gated.result;
    if (!preflight.valid) return { preview: null, preflight };
    const frozenConcurrency = resolveExecutionConcurrency(input.executionConcurrency, input.concurrencySource);
    if (input.providerConfig.limits.maxExecutionConcurrency && frozenConcurrency.executionConcurrency > input.providerConfig.limits.maxExecutionConcurrency) throw new InvalidCommandError('当前 Provider Profile 限制运行并发最多 ' + input.providerConfig.limits.maxExecutionConcurrency + '。');
    const timestamp = nowIso();
    const id = createId('dryrun');
    const provider = providerSnapshot(input.providerConfig);
    db.prepare('INSERT INTO dry_run_previews (id, round_id, plan_version, provider_snapshot_json, plan_snapshot_json, item_count, execution_concurrency, concurrency_source, usage_estimate_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, round.id, round.plan_version, JSON.stringify(provider), JSON.stringify(preflight.normalizedPlan), preflight.normalizedPlan.itemCount, frozenConcurrency.executionConcurrency, frozenConcurrency.concurrencySource, JSON.stringify(gated.estimate), timestamp);
    const insertItem = db.prepare('INSERT INTO dry_run_items (id, preview_id, sequence, prompt_payload_json, created_at) VALUES (?, ?, ?, ?, ?)');
    for (let sequence = 1; sequence <= preflight.normalizedPlan.itemCount; sequence += 1) insertItem.run(createId('dryitem'), id, sequence, JSON.stringify(promptPayloadForSequence(preflight.normalizedPlan, sequence)), timestamp);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'dry_run_preview', entityId: id, eventType: 'dry_run.created', payload: { roundId: round.id, planVersion: round.plan_version, itemCount: preflight.normalizedPlan.itemCount, ...frozenConcurrency, usageEstimateKnown: gated.estimate.estimatedCostMinor !== null } });
    return { preview: { id, roundId: round.id, planVersion: round.plan_version, providerSnapshot: provider, planSnapshot: preflight.normalizedPlan, itemCount: preflight.normalizedPlan.itemCount, ...frozenConcurrency, usageEstimate: gated.estimate, createdAt: timestamp }, preflight };
  }, { studioId: input.studioId, roundId: input.roundId, provider: providerSnapshot(input.providerConfig), concurrency: resolveExecutionConcurrency(input.executionConcurrency, input.concurrencySource), usageEstimate: input.usageEstimate || null });
}

export function listDryRunPreviews(db: StudioDatabase, studioId: string, roundId: string): DryRunPreview[] {
  resolveRoundInStudio(db, requireValue(studioId, 'studioId'), requireValue(roundId, 'roundId'));
  return (db.prepare('SELECT preview.id, preview.round_id, preview.plan_version, preview.provider_snapshot_json, preview.plan_snapshot_json, preview.item_count, preview.execution_concurrency, preview.concurrency_source, preview.usage_estimate_json, preview.created_at FROM dry_run_previews preview JOIN creative_rounds round ON round.id = preview.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE preview.round_id = ? AND project.studio_id = ? ORDER BY preview.created_at DESC').all(roundId, studioId) as Array<{ id: string; round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; item_count: number; execution_concurrency: number; concurrency_source: ConcurrencySource; usage_estimate_json: string; created_at: string }>).map(dryRunFromRow);
}

export function getDryRunPreview(db: StudioDatabase, studioId: string, roundId: string, previewId: string): DryRunPreview | null {
  const row = db.prepare(selectInStudioSql('dry_run_preview', 'preview.id, preview.round_id, preview.plan_version, preview.provider_snapshot_json, preview.plan_snapshot_json, preview.item_count, preview.execution_concurrency, preview.concurrency_source, preview.usage_estimate_json, preview.created_at') + ' AND preview.round_id = ?').get(previewId, studioId, roundId) as { id: string; round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; item_count: number; execution_concurrency: number; concurrency_source: ConcurrencySource; usage_estimate_json: string; created_at: string } | undefined;
  return row ? dryRunFromRow(row) : null;
}

export function queueGenerationRun(db: StudioDatabase, input: { studioId: string; roundId: string; providerConfig: ResolvedProviderConfig; providerStatus: SafeProviderStatus; preflightId?: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.queue', () => {
    const round = resolveRoundInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.roundId, 'roundId'));
    if (round.status !== 'active') throw new InvalidCommandError('The creative round must be confirmed before a run can be queued.');
    assertRoundHasNoGenerationRun(db, round.id);
    let preflight = validateManagedAssets(db, round.studio_id, round.project_id, preflightGenerationPlan(parseObject(round.plan_json), input.providerStatus), input.providerStatus);
    preflight = applyProviderProfileLimits(preflight, input.providerConfig);
    if (!preflight.valid) throw new InvalidCommandError('Generation preflight failed: ' + preflight.issues.map((issue) => issue.code).join(', '));
    const snapshot = providerSnapshot(input.providerConfig);
    if (!input.preflightId) throw new InvalidCommandError('Dry-run evidence is required before queueing.');
    const preview = db.prepare('SELECT round_id, plan_version, provider_snapshot_json, plan_snapshot_json, execution_concurrency, concurrency_source, usage_estimate_json FROM dry_run_previews WHERE id = ?').get(input.preflightId) as { round_id: string; plan_version: number; provider_snapshot_json: string; plan_snapshot_json: string; execution_concurrency: number; concurrency_source: ConcurrencySource; usage_estimate_json: string } | undefined;
    if (!preview || preview.round_id !== round.id || preview.plan_version !== round.plan_version || !storedSnapshotMatches(preview.provider_snapshot_json, snapshot) || !storedSnapshotMatches(preview.plan_snapshot_json, preflight.normalizedPlan)) throw new InvalidCommandError('Dry-run evidence is stale. Re-run preflight before queueing.');
    const estimate = parseUsageEstimate(preview.usage_estimate_json, preflight.normalizedPlan.itemCount);
    const gate = applyBudgetGate(db, preflight, { studioId: input.studioId, profileId: input.providerConfig.profileId, projectId: round.project_id, roundId: round.id, estimate });
    if (!gate.result.valid) throw new InvalidCommandError('Generation budget gate failed: ' + gate.result.issues.map((issue) => issue.code).join(', '));
    const id = createId('run');
    const timestamp = nowIso();
    insertQueuedRun(db, { id, roundId: round.id, snapshotJson: JSON.stringify(snapshot), planJson: JSON.stringify(preflight.normalizedPlan), profileId: snapshot.profileId, configVersion: snapshot.configVersion, executionConcurrency: preview.execution_concurrency, concurrencySource: preview.concurrency_source, estimateJson: JSON.stringify(estimate), timestamp });
    const insertItem = db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (let sequence = 1; sequence <= preflight.normalizedPlan.itemCount; sequence += 1) insertItem.run(createId('item'), id, sequence, 'pending', JSON.stringify(promptPayloadForSequence(preflight.normalizedPlan, sequence)), createId('request'), timestamp, timestamp);
    const frozen = { executionConcurrency: Number(preview.execution_concurrency), concurrencySource: preview.concurrency_source };
    appendStudioEvent(db, { studioId: round.studio_id, entityType: 'generation_run', entityId: id, eventType: 'run.queued', payload: { roundId: round.id, itemCount: preflight.normalizedPlan.itemCount, ...frozen, usageEstimateKnown: estimate.estimatedCostMinor !== null } });
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
const PAUSING_RUN_ITEM_STATUSES: readonly RunItemStatus[] = ['leased', 'requesting', 'receiving', 'persisting', 'cancel_requested'];
const MAINTENANCE_BATCH_LIMIT = 1000;

export function settleTerminalGenerationRun(db: StudioDatabase, runId: string, now = new Date()): RunStatus | null {
  const run = getGenerationRun(db, runId);
  if (!run || !['running', 'pausing'].includes(run.status)) return null;
  const blockingStatuses = run.status === 'pausing' ? PAUSING_RUN_ITEM_STATUSES : ACTIVE_RUN_ITEM_STATUSES;
  const items = listGenerationRunItems(db, runId);
  if (!items.length || items.some((item) => blockingStatuses.includes(item.status))) return null;
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
  const rows = db.prepare("SELECT r.id, r.status, r.version, p.studio_id, COUNT(i.id) AS total, SUM(CASE WHEN ((r.status = 'pausing' AND i.status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested')) OR (r.status <> 'pausing' AND i.status IN ('pending', 'leased', 'requesting', 'receiving', 'persisting', 'retry_wait', 'cancel_requested'))) THEN 1 ELSE 0 END) AS active, SUM(CASE WHEN i.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded FROM generation_runs r JOIN run_items i ON i.run_id = r.id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.status IN ('running', 'pausing') GROUP BY r.id, r.status, r.version, p.studio_id HAVING active = 0 ORDER BY r.created_at, r.id LIMIT ?").all(MAINTENANCE_BATCH_LIMIT) as Array<{ id: string; status: RunStatus; version: number; studio_id: string; total: number; active: number; succeeded: number }>;
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
    assertNoDegradedOpenRunConflicts(db);
    const globalInFlight = db.prepare("SELECT COUNT(*) AS total FROM run_items WHERE status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested')").get() as { total: number };
    const availableSlots = Math.max(0, Math.min(input.limit, globalLimit - Number(globalInFlight.total)));
    if (!availableSlots) return [];
    const providerFilter = input.providerSnapshot ? ' AND r.provider_profile_id = ? AND r.provider_config_version = ?' : '';
    const sql = "WITH ranked_candidates AS (SELECT i.id, i.run_id, i.sequence, i.status, i.prompt_payload_json, i.request_id, i.lease_token, i.lease_expires_at, i.attempts, i.retry_at, i.lease_worker_id, r.status AS run_status, r.execution_concurrency, r.round_id, r.created_at AS run_created_at, p.studio_id, ROW_NUMBER() OVER (PARTITION BY i.run_id ORDER BY i.sequence) AS candidate_rank FROM run_items i JOIN generation_runs r ON r.id = i.run_id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE i.status = 'pending' AND r.status IN ('queued', 'running') AND (i.retry_at IS NULL OR i.retry_at <= ?) AND NOT EXISTS (SELECT 1 FROM generation_runs conflict_run WHERE conflict_run.round_id = r.round_id AND conflict_run.id <> r.id AND conflict_run.status IN " + OPEN_RUN_STATUSES_SQL + ")" + providerFilter + ") SELECT * FROM ranked_candidates WHERE candidate_rank <= MIN(execution_concurrency, ?) ORDER BY run_created_at, run_id, sequence";
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
    const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(row.run_id) as { studio_id: string } | undefined;
    if (row.status === 'outcome_unknown') {
      if (studio) recordRunItemUsage(db, { studioId: studio.studio_id, runItemId: row.id, requestId: row.request_id, billingState: 'possibly_billed' });
      return runItemFromRow(row);
    }
    if (!['requesting', 'receiving', 'persisting', 'cancel_requested'].includes(row.status)) throw new VersionConflictError('Run item can no longer be marked as an unknown outcome.');
    assertRunItemTransition(row.status, 'outcome_unknown');
    const timestamp = (input.now || new Date()).toISOString();
    const error = { kind: 'unknown_outcome', code: reason };
    db.prepare("UPDATE run_items SET status = 'outcome_unknown', retry_at = NULL, error_json = ?, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(JSON.stringify(error), timestamp, row.id);
    if (studio) {
      recordRunItemUsage(db, { studioId: studio.studio_id, runItemId: row.id, requestId: row.request_id, billingState: 'possibly_billed' });
      if (input.emitEvent !== false) appendStudioEvent(db, { studioId: studio.studio_id, entityType: 'run_item', entityId: row.id, eventType: 'run_item.outcome_unknown', payload: { runId: row.run_id, sequence: row.sequence, reason } });
    }
    return { ...runItemFromRow(row), status: 'outcome_unknown', retryAt: null, leaseToken: null, leaseExpiresAt: null, error: safeErrorDetail(error) };
  });
}

export function transitionRunItem(db: StudioDatabase, input: { itemId: string; leaseToken: string; status: RunItemStatus; retryAt?: string; error?: Record<string, unknown>; result?: Record<string, unknown>; externalRequestId?: string | null; billingState?: UsageBillingState; now?: Date; emitEvent?: boolean }): GenerationRunItem {
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
    db.prepare('UPDATE run_items SET status = ?, retry_at = ?, error_json = ?, result_json = ?, external_request_id = COALESCE(?, external_request_id), lease_token = CASE WHEN ? THEN NULL ELSE lease_token END, lease_worker_id = CASE WHEN ? THEN NULL ELSE lease_worker_id END, lease_expires_at = CASE WHEN ? THEN NULL ELSE lease_expires_at END, updated_at = ? WHERE id = ?').run(
      input.status,
      input.retryAt || null,
      input.error ? JSON.stringify(input.error) : null,
      input.result ? JSON.stringify(input.result) : null,
      input.externalRequestId === undefined ? null : input.externalRequestId,
      clearLease ? 1 : 0,
      clearLease ? 1 : 0,
      clearLease ? 1 : 0,
      now.toISOString(),
      row.id
    );
    const studio = db.prepare('SELECT p.studio_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(row.run_id) as { studio_id: string } | undefined;
    if (studio && input.billingState) recordRunItemUsage(db, { studioId: studio.studio_id, runItemId: row.id, requestId: row.request_id, billingState: input.billingState });
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


const MIN_RETRY_TIMEOUT_MS = 1000;
const MAX_RETRY_TIMEOUT_MS = 10 * 60 * 1000;

function normalizedRetryTimeout(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const timeoutMs = Number(value);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < MIN_RETRY_TIMEOUT_MS || timeoutMs > MAX_RETRY_TIMEOUT_MS) {
    throw new InvalidCommandError('Retry timeout must be an integer between ' + MIN_RETRY_TIMEOUT_MS + ' and ' + MAX_RETRY_TIMEOUT_MS + ' milliseconds.');
  }
  return timeoutMs;
}

/**
 * Rewrites only the per-item request payload, which is what actually reaches the provider. The confirmed plan
 * snapshot stays untouched, and the override is reported in the result and the studio event so the run keeps an
 * honest record of the timeout that was really used.
 *
 * A timeout is an operational retry parameter, not a creative change: the prompt, references and count are all
 * unchanged, so requiring a fresh confirmed round would be ceremony. Before this the only way to recover from a
 * too-short timeout -- the most common provider failure -- was to create a new round and re-confirm the plan.
 */
function applyRetryTimeout(db: StudioDatabase, itemId: string, timeoutMs: number, timestamp: string): void {
  const row = db.prepare('SELECT prompt_payload_json FROM run_items WHERE id = ?').get(itemId) as { prompt_payload_json: string } | undefined;
  if (!row) return;
  const payload = parseObject(row.prompt_payload_json);
  const output = payload.output && typeof payload.output === 'object' && !Array.isArray(payload.output) ? payload.output as Record<string, unknown> : {};
  db.prepare('UPDATE run_items SET prompt_payload_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify({ ...payload, output: { ...output, timeoutMs } }), timestamp, itemId);
}

export function retryGenerationRunItems(db: StudioDatabase, input: { studioId: string; runId: string; itemIds?: string[]; timeoutMs?: number; idempotencyKey: string }): CommandReceipt<{ runId: string; retriedItemIds: string[]; timeoutMsOverrideMs?: number }> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.retry', () => {
    const runId = requireValue(input.runId, 'runId');
    const timeoutMs = normalizedRetryTimeout(input.timeoutMs);
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
    assertRetryBudget(db, input.studioId, runFromRow(run), candidates);
    const timestamp = nowIso();
    for (const item of candidates) {
      // ⚠️ 已由用户核实并 `resolve-unknown` 结案的项（error code `user_resolved_unknown_outcome`）
      // **允许在原运行内重试**。
      //
      // 之前这里一律拒绝，要求「新建轮次」。但那时用户已经确认过「没出图、没扣费」——
      // 重试会派生新的 `request_id`，不可能重复计费；而**为补一张图新建一个批次**，
      // 把「补图」变得比失败本身更麻烦（实测：三张里补一张，却要重走确认闸门）。
      // 未结案的 `outcome_unknown` 仍然不可重试——它根本不在候选状态里，先核实再说。
      assertRunItemTransition(item.status, 'pending');
      db.prepare("UPDATE run_items SET status = 'pending', request_id = ?, external_request_id = NULL, retry_at = NULL, error_json = NULL, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?").run(createId('request'), timestamp, item.id);
      if (timeoutMs !== undefined) applyRetryTimeout(db, item.id, timeoutMs, timestamp);
    }
    const override = timeoutMs === undefined ? {} : { timeoutMsOverrideMs: timeoutMs };
    if (['paused', 'partial', 'failed'].includes(run.status)) {
      assertRoundHasNoOpenSibling(db, run.round_id, run.id);
      assertRunTransition(run.status, 'queued');
      db.prepare("UPDATE generation_runs SET status = 'queued', worker_id = NULL, version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, runId);
      appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: runId, eventType: 'run.queued', payload: { retried: true, itemCount: candidates.length, ...override } });
    } else appendStudioEvent(db, { studioId: input.studioId, entityType: 'generation_run', entityId: runId, eventType: 'run.items_retried', payload: { itemCount: candidates.length, ...override } });
    return { runId, retriedItemIds: candidates.map((item) => item.id), ...override };
  }, input);
}

export function resumeGenerationRun(db: StudioDatabase, input: { studioId: string; runId: string; sessionId?: string; idempotencyKey: string }): CommandReceipt<GenerationRun> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'runs.resume', () => {
    const run = resolveRunInStudio(db, requireValue(input.studioId, 'studioId'), requireValue(input.runId, 'runId'));
    const unknown = db.prepare("SELECT COUNT(*) AS total FROM run_items WHERE run_id = ? AND status = 'outcome_unknown'").get(run.id) as { total: number };
    if (unknown.total > 0) throw new InvalidCommandError('This run has provider requests with unknown outcomes and cannot resume automatically.');
    if (run.status === 'resume_pending') {
      const sessionId = requireValue(input.sessionId || '', 'sessionId');
      const session = db.prepare('SELECT id, agent_round_id FROM studio_sessions WHERE id = ? AND studio_id = ?').get(sessionId, input.studioId) as { id: string; agent_round_id: string | null } | undefined;
      if (!session || session.agent_round_id !== run.round_id) throw new InvalidCommandError('A Studio Session confirmation for this creative round is required before resuming after restart.');
      db.prepare('INSERT INTO run_resume_confirmations (id, run_id, session_id, confirmed_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, session_id) DO NOTHING').run(createId('resumeconfirm'), run.id, sessionId, nowIso());
    }
    assertRoundHasNoOpenSibling(db, run.round_id, run.id);
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
    const rows = db.prepare("SELECT i.id, i.run_id, i.sequence, i.status, i.request_id, p.studio_id FROM run_items i JOIN generation_runs r ON r.id = i.run_id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE i.status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested') AND i.lease_expires_at IS NOT NULL AND i.lease_expires_at <= ? ORDER BY r.created_at, i.sequence LIMIT ?").all(timestamp, MAINTENANCE_BATCH_LIMIT) as Array<{ id: string; run_id: string; sequence: number; status: RunItemStatus; request_id: string; studio_id: string }>;
    const recover = db.prepare('UPDATE run_items SET status = ?, retry_at = NULL, error_json = ?, lease_token = NULL, lease_worker_id = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = ? AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?');
    const recoveredByRun = new Map<string, { studioId: string; count: number; unknown: number }>();
    let recovered = 0;
    for (const row of rows) {
      const nextStatus: RunItemStatus = row.status === 'leased' ? 'pending' : 'outcome_unknown';
      assertRunItemTransition(row.status, nextStatus);
      const error = nextStatus === 'outcome_unknown' ? JSON.stringify({ kind: 'unknown_outcome', code: 'lease_expired' }) : null;
      const changed = recover.run(nextStatus, error, timestamp, row.id, row.status, timestamp);
      if (Number(changed.changes) !== 1) continue;
      if (nextStatus === 'outcome_unknown') recordRunItemUsage(db, { studioId: row.studio_id, runItemId: row.id, requestId: row.request_id, billingState: 'possibly_billed' });
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
      const items = db.prepare("SELECT id, sequence, status, request_id FROM run_items WHERE run_id = ? AND status IN ('leased', 'requesting', 'receiving', 'persisting', 'cancel_requested') ORDER BY sequence").all(row.id) as Array<{ id: string; sequence: number; status: RunItemStatus; request_id: string }>;
      for (const item of items) {
        const nextStatus: RunItemStatus = item.status === 'leased' ? 'pending' : 'outcome_unknown';
        assertRunItemTransition(item.status, nextStatus);
        const error = nextStatus === 'outcome_unknown' ? JSON.stringify({ kind: 'unknown_outcome', code: 'startup_recovery' }) : null;
        const changed = recoverItem.run(nextStatus, error, timestamp, item.id, item.status);
        if (Number(changed.changes) !== 1) throw new VersionConflictError('Run item changed during startup recovery.');
        if (nextStatus === 'outcome_unknown') recordRunItemUsage(db, { studioId: row.studio_id, runItemId: item.id, requestId: item.request_id, billingState: 'possibly_billed' });
      }
      const changed = markRun.run('resume_pending', timestamp, row.id, row.status, row.version);
      if (Number(changed.changes) !== 1) throw new VersionConflictError('Generation run changed during startup recovery.');
      appendStudioEvent(db, { studioId: row.studio_id, entityType: 'generation_run', entityId: row.id, eventType: 'run.resume_pending', payload: { recoveredItemCount: items.length } });
      marked += 1;
    }
    return marked;
  });
}
