import { createId, nowIso } from '../shared/ids';
import { InvalidCommandError, StudioNotFoundError } from '../domain/studio-commands';
import { StudioDatabase, withTransaction } from '../studio/database';

/** Monetary values are integer minor units named by costUnit (for example USD_minor); no provider price is inferred. */
export type UsageBillingState = 'estimated' | 'billed' | 'possibly_billed' | 'unknown' | 'not_billed';
export type UsageEstimateSource = 'caller' | 'provider' | 'unknown';

/** A caller-supplied estimate. A null cost is deliberately unknown, never treated as zero. */
export interface UsageEstimate {
  unit: string;
  quantity: number;
  estimatedCostMinor: number | null;
  costUnit: string | null;
  source: UsageEstimateSource;
}

export interface UsageAttribution {
  studioId: string;
  profileId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  roundId?: string | null;
  runId?: string | null;
  runItemId?: string | null;
}

export interface UsageEventInput extends UsageAttribution {
  estimate: UsageEstimate;
  billingState?: UsageBillingState;
  idempotencyKey: string;
  createdAt?: string;
}

export interface UsageEvent extends UsageAttribution {
  id: string;
  unit: string;
  quantity: number;
  estimatedCostMinor: number | null;
  costUnit: string | null;
  billingState: UsageBillingState;
  estimateSource: UsageEstimateSource;
  idempotencyKey: string;
  createdAt: string;
}

export interface UsageReceipt {
  value: UsageEvent;
  replayed: boolean;
}

export interface UsageSummary {
  quantity: number;
  knownCostMinor: number;
  unknownEventCount: number;
  eventCount: number;
  costUnits: string[];
}

interface UsageRow {
  id: string;
  studio_id: string;
  profile_id: string | null;
  project_id: string | null;
  task_id: string | null;
  round_id: string | null;
  run_id: string | null;
  run_item_id: string | null;
  unit: string;
  quantity: number;
  estimated_cost_minor: number | null;
  cost_unit: string | null;
  billing_state: UsageBillingState;
  estimate_source: UsageEstimateSource;
  idempotency_key: string;
  created_at: string;
}

function required(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new InvalidCommandError(label + ' is required.');
  if (normalized.length > 256) throw new InvalidCommandError(label + ' is too long.');
  return normalized;
}

function optional(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  return required(value, label);
}

export function normalizeUsageEstimate(input: unknown): UsageEstimate {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new InvalidCommandError('Usage estimate is invalid.');
  const candidate = input as Partial<UsageEstimate>;
  const unit = candidate.unit;
  if (typeof unit !== 'string' || !unit.trim()) throw new InvalidCommandError('Usage unit is required.');
  const quantity = candidate.quantity;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) throw new InvalidCommandError('Usage quantity must be a positive finite number.');
  const rawEstimatedCostMinor = candidate.estimatedCostMinor;
  if (!Object.prototype.hasOwnProperty.call(candidate, 'estimatedCostMinor') || (rawEstimatedCostMinor !== null && (typeof rawEstimatedCostMinor !== 'number' || !Number.isSafeInteger(rawEstimatedCostMinor) || rawEstimatedCostMinor < 0))) throw new InvalidCommandError('Estimated cost must be a non-negative integer minor amount.');
  const estimatedCostMinor = rawEstimatedCostMinor as number | null;
  const rawCostUnit = candidate.costUnit;
  if (!Object.prototype.hasOwnProperty.call(candidate, 'costUnit')) throw new InvalidCommandError('Cost unit is invalid.');
  let costUnit: string | null;
  if (rawCostUnit === null) costUnit = null;
  else {
    if (typeof rawCostUnit !== 'string' || !rawCostUnit.trim()) throw new InvalidCommandError('Cost unit is invalid.');
    costUnit = rawCostUnit.trim();
  }
  const source = candidate.source;
  if (source !== 'caller' && source !== 'provider' && source !== 'unknown') throw new InvalidCommandError('Usage estimate source is invalid.');
  if ((estimatedCostMinor === null) !== (costUnit === null)) throw new InvalidCommandError('Estimated cost and cost unit must be provided together; unknown cost uses both null.');
  if (estimatedCostMinor === null && source !== 'unknown') throw new InvalidCommandError('A known cost requires an explicit caller or provider estimate source.');
  if (estimatedCostMinor !== null && source === 'unknown') throw new InvalidCommandError('A known cost requires an explicit caller or provider estimate source.');
  return { unit: unit.trim(), quantity, estimatedCostMinor, costUnit, source };
}

function unknownEstimate(quantity: number): UsageEstimate {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 || quantity > Number.MAX_SAFE_INTEGER) throw new InvalidCommandError('Usage quantity must be a positive finite number.');
  return { unit: 'image', quantity, estimatedCostMinor: null, costUnit: null, source: 'unknown' };
}

/** Parse a frozen estimate, retaining the migration sentinel as an explicit unknown estimate. */
export function parseStoredUsageEstimate(value: string | null | undefined, fallbackQuantity: number): UsageEstimate {
  if (!value) return unknownEstimate(fallbackQuantity);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new InvalidCommandError('Frozen usage estimate is invalid.');
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const candidate = parsed as Partial<UsageEstimate>;
    if (candidate.unit === 'unknown' && candidate.quantity === 0 && candidate.estimatedCostMinor === null && candidate.costUnit === null && candidate.source === 'unknown') return unknownEstimate(fallbackQuantity);
  }
  try {
    return normalizeUsageEstimate(parsed);
  } catch {
    throw new InvalidCommandError('Frozen usage estimate is invalid.');
  }
}

function rowToEvent(row: UsageRow): UsageEvent {
  return {
    id: row.id,
    studioId: row.studio_id,
    profileId: row.profile_id,
    projectId: row.project_id,
    taskId: row.task_id,
    roundId: row.round_id,
    runId: row.run_id,
    runItemId: row.run_item_id,
    unit: row.unit,
    quantity: Number(row.quantity),
    estimatedCostMinor: row.estimated_cost_minor === null ? null : Number(row.estimated_cost_minor),
    costUnit: row.cost_unit,
    billingState: row.billing_state,
    estimateSource: row.estimate_source,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at
  };
}

function assertAttribution(db: StudioDatabase, input: UsageAttribution): UsageAttribution {
  const studioId = required(input.studioId, 'studioId');
  if (!db.prepare('SELECT id FROM studios WHERE id = ?').get(studioId)) throw new StudioNotFoundError('Studio not found: ' + studioId);
  const profileId = optional(input.profileId, 'profileId');
  const projectId = optional(input.projectId, 'projectId');
  const taskId = optional(input.taskId, 'taskId');
  const roundId = optional(input.roundId, 'roundId');
  const runId = optional(input.runId, 'runId');
  const runItemId = optional(input.runItemId, 'runItemId');
  let expectedProfile = profileId;
  let expectedProject = projectId;
  let expectedTask = taskId;
  let expectedRound = roundId;
  let expectedRun = runId;
  if (projectId && !db.prepare('SELECT id FROM projects WHERE id = ? AND studio_id = ?').get(projectId, studioId) && !taskId && !roundId && !runId && !runItemId) throw new InvalidCommandError('Usage project attribution is outside the Studio.');
  if (taskId) {
    const row = db.prepare('SELECT t.id, t.project_id FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.studio_id = ?').get(taskId, studioId) as { id: string; project_id: string } | undefined;
    if (!row) throw new InvalidCommandError('Usage task attribution is outside the Studio.');
    if (expectedProject && expectedProject !== row.project_id) throw new InvalidCommandError('Usage task attribution does not belong to the project.');
    expectedProject = row.project_id; expectedTask = row.id;
  }
  if (roundId) {
    const row = db.prepare('SELECT r.id, r.task_id, t.project_id FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ? AND p.studio_id = ?').get(roundId, studioId) as { id: string; task_id: string; project_id: string } | undefined;
    if (!row) throw new InvalidCommandError('Usage round attribution is outside the Studio.');
    if (expectedTask && expectedTask !== row.task_id) throw new InvalidCommandError('Usage round attribution does not belong to the task.');
    if (expectedProject && expectedProject !== row.project_id) throw new InvalidCommandError('Usage round attribution does not belong to the project.');
    expectedProject = row.project_id; expectedTask = row.task_id; expectedRound = row.id;
  }
  if (runId) {
    const row = db.prepare('SELECT r.id, r.round_id, cr.task_id, t.project_id, r.provider_profile_id FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ? AND p.studio_id = ?').get(runId, studioId) as { id: string; round_id: string; task_id: string; project_id: string; provider_profile_id: string | null } | undefined;
    if (!row) throw new InvalidCommandError('Usage run attribution is outside the Studio.');
    if (expectedRound && expectedRound !== row.round_id) throw new InvalidCommandError('Usage run attribution does not belong to the round.');
    if (expectedTask && expectedTask !== row.task_id) throw new InvalidCommandError('Usage run attribution does not belong to the task.');
    if (expectedProject && expectedProject !== row.project_id) throw new InvalidCommandError('Usage run attribution does not belong to the project.');
    expectedProfile = row.provider_profile_id;
    if (profileId && profileId !== row.provider_profile_id) throw new InvalidCommandError('Usage profile attribution does not match the generation run.');
    expectedProject = row.project_id; expectedTask = row.task_id; expectedRound = row.round_id; expectedRun = row.id;
  }
  if (runItemId) {
    const row = db.prepare('SELECT i.id, i.run_id, r.round_id, cr.task_id, t.project_id, r.provider_profile_id FROM run_items i JOIN generation_runs r ON r.id = i.run_id JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id WHERE i.id = ? AND p.studio_id = ?').get(runItemId, studioId) as { id: string; run_id: string; round_id: string; task_id: string; project_id: string; provider_profile_id: string | null } | undefined;
    if (!row) throw new InvalidCommandError('Usage run item attribution is outside the Studio.');
    if (expectedRun && expectedRun !== row.run_id) throw new InvalidCommandError('Usage run item attribution does not belong to the run.');
    if (expectedRound && expectedRound !== row.round_id) throw new InvalidCommandError('Usage run item attribution does not belong to the round.');
    if (expectedTask && expectedTask !== row.task_id) throw new InvalidCommandError('Usage run item attribution does not belong to the task.');
    if (expectedProject && expectedProject !== row.project_id) throw new InvalidCommandError('Usage run item attribution does not belong to the project.');
    if (profileId && profileId !== row.provider_profile_id) throw new InvalidCommandError('Usage profile attribution does not match the run item.');
    expectedProfile = row.provider_profile_id;
    expectedProject = row.project_id; expectedTask = row.task_id; expectedRound = row.round_id; expectedRun = row.run_id;
  }
  if (profileId && !runId) throw new InvalidCommandError('Usage profile attribution requires a generation run to prove Studio scope.');
  return { studioId, profileId: expectedProfile, projectId: expectedProject, taskId: expectedTask, roundId: expectedRound, runId: expectedRun, runItemId };
}

/** Record one auditable event. The scoped idempotency key is unique; replay returns the original event without another ledger row. */
export function recordUsageEvent(db: StudioDatabase, input: UsageEventInput): UsageReceipt {
  return withTransaction(db, () => {
    const idempotencyKey = required(input.idempotencyKey, 'usage idempotencyKey');
    const attribution = assertAttribution(db, input);
    const estimate = normalizeUsageEstimate(input.estimate);
    const billingState = input.billingState || (estimate.estimatedCostMinor === null ? 'unknown' : 'estimated');
    if (billingState === 'unknown' && estimate.estimatedCostMinor !== null) throw new InvalidCommandError('Unknown billing state cannot carry a settled cost estimate.');
    const existing = db.prepare('SELECT id, studio_id, profile_id, project_id, task_id, round_id, run_id, run_item_id, unit, quantity, estimated_cost_minor, cost_unit, billing_state, estimate_source, idempotency_key, created_at FROM usage_ledger WHERE studio_id = ? AND idempotency_key = ?').get(attribution.studioId, idempotencyKey) as UsageRow | undefined;
    if (existing) {
      const event = rowToEvent(existing);
      if (event.profileId !== attribution.profileId || event.projectId !== attribution.projectId || event.taskId !== attribution.taskId || event.roundId !== attribution.roundId || event.runId !== attribution.runId || event.runItemId !== attribution.runItemId || event.unit !== estimate.unit || event.quantity !== estimate.quantity || event.estimatedCostMinor !== estimate.estimatedCostMinor || event.costUnit !== estimate.costUnit || event.estimateSource !== estimate.source || event.billingState !== billingState) throw new InvalidCommandError('Usage idempotency key was already used with different usage identity.');
      return { value: event, replayed: true };
    }
    const createdAt = input.createdAt || nowIso();
    const id = createId('usage');
    db.prepare('INSERT INTO usage_ledger (id, studio_id, profile_id, project_id, task_id, round_id, run_id, run_item_id, unit, quantity, estimated_cost_minor, cost_unit, billing_state, estimate_source, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, attribution.studioId, attribution.profileId || null, attribution.projectId || null, attribution.taskId || null, attribution.roundId || null, attribution.runId || null, attribution.runItemId || null, estimate.unit, estimate.quantity, estimate.estimatedCostMinor, estimate.costUnit, billingState, estimate.source, idempotencyKey, createdAt);
    return { value: { id, ...attribution, unit: estimate.unit, quantity: estimate.quantity, estimatedCostMinor: estimate.estimatedCostMinor, costUnit: estimate.costUnit, billingState, estimateSource: estimate.source, idempotencyKey, createdAt }, replayed: false };
  });
}

interface UsageQuery {
  where: string;
  values: string[];
}

interface UsageAggregateRow {
  quantity: number;
  known_cost_minor: number;
  unknown_event_count: number;
  event_count: number;
}

function usageQuery(db: StudioDatabase, input: UsageAttribution): UsageQuery {
  const requestedProfile = optional(input.profileId, 'profileId');
  const attribution = assertAttribution(db, { ...input, profileId: input.runId ? requestedProfile : null });
  const clauses = ['studio_id = ?'];
  const values: string[] = [attribution.studioId];
  const addFilter = (column: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined) {
      clauses.push(column + ' = ?');
      values.push(value);
    }
  };
  addFilter('profile_id', requestedProfile);
  addFilter('project_id', attribution.projectId);
  addFilter('task_id', attribution.taskId);
  addFilter('round_id', attribution.roundId);
  addFilter('run_id', attribution.runId);
  addFilter('run_item_id', attribution.runItemId);
  return { where: clauses.join(' AND '), values };
}

export function listUsageLedger(db: StudioDatabase, input: UsageAttribution & { limit?: number }): UsageEvent[] {
  const query = usageQuery(db, input);
  const limit = Math.min(10000, Math.max(1, Number.isInteger(input.limit) ? Number(input.limit) : 1000));
  const rows = db.prepare('SELECT id, studio_id, profile_id, project_id, task_id, round_id, run_id, run_item_id, unit, quantity, estimated_cost_minor, cost_unit, billing_state, estimate_source, idempotency_key, created_at FROM usage_ledger WHERE ' + query.where + ' ORDER BY created_at DESC, id DESC LIMIT ?').all(...query.values, limit) as unknown as UsageRow[];
  return rows.map(rowToEvent);
}


function safeAggregate(value: unknown, label: string, integer: boolean): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > Number.MAX_SAFE_INTEGER || (integer && !Number.isSafeInteger(result))) throw new InvalidCommandError('Usage ' + label + ' exceeds the supported safe integer range.');
  return result;
}

function aggregateUsage(db: StudioDatabase, input: UsageAttribution): UsageSummary {
  const query = usageQuery(db, input);
  const row = db.prepare('SELECT COALESCE(SUM(CAST(quantity AS REAL)), 0.0) AS quantity, COALESCE(SUM(CASE WHEN estimated_cost_minor IS NOT NULL AND estimate_source IN (\'caller\', \'provider\') AND billing_state NOT IN (\'unknown\', \'not_billed\') THEN CAST(estimated_cost_minor AS REAL) ELSE 0.0 END), 0.0) AS known_cost_minor, COALESCE(SUM(CAST(CASE WHEN estimated_cost_minor IS NULL OR billing_state IN (\'unknown\', \'not_billed\') OR estimate_source = \'unknown\' THEN 1 ELSE 0 END AS REAL)), 0.0) AS unknown_event_count, COUNT(*) AS event_count FROM usage_ledger WHERE ' + query.where).get(...query.values) as unknown as UsageAggregateRow | undefined;
  const costUnits = (db.prepare('SELECT DISTINCT cost_unit FROM usage_ledger WHERE ' + query.where + ' AND estimated_cost_minor IS NOT NULL AND estimate_source IN (\'caller\', \'provider\') AND billing_state NOT IN (\'unknown\', \'not_billed\') AND cost_unit IS NOT NULL').all(...query.values) as Array<{ cost_unit: string }>).map((item) => item.cost_unit).sort();
  return {
    quantity: safeAggregate(row?.quantity ?? 0, 'quantity total', false),
    knownCostMinor: safeAggregate(row?.known_cost_minor ?? 0, 'known cost total', true),
    unknownEventCount: safeAggregate(row?.unknown_event_count ?? 0, 'unknown event count', true),
    eventCount: safeAggregate(row?.event_count ?? 0, 'event count', true),
    costUnits
  };
}

export function sumUsageCostMinor(db: StudioDatabase, input: UsageAttribution, costUnit: string): number {
  const query = usageQuery(db, input);
  const normalizedCostUnit = required(costUnit, 'cost unit');
  const row = db.prepare('SELECT COALESCE(SUM(CAST(estimated_cost_minor AS REAL)), 0.0) AS known_cost_minor FROM usage_ledger WHERE ' + query.where + ' AND estimated_cost_minor IS NOT NULL AND estimate_source IN (\'caller\', \'provider\') AND billing_state NOT IN (\'unknown\', \'not_billed\') AND cost_unit = ?').get(...query.values, normalizedCostUnit) as { known_cost_minor: number };
  return safeAggregate(row?.known_cost_minor ?? 0, 'known cost total', true);
}
function sumRecordedRunUsageCostMinor(db: StudioDatabase, input: UsageAttribution, costUnit: string): number {
  const query = usageQuery(db, input);
  const normalizedCostUnit = required(costUnit, 'cost unit');
  const row = db.prepare('SELECT COALESCE(SUM(CAST(estimated_cost_minor AS REAL)), 0.0) AS recorded_cost_minor FROM usage_ledger WHERE ' + query.where + ' AND estimated_cost_minor IS NOT NULL AND estimate_source IN (\'caller\', \'provider\') AND cost_unit = ?').get(...query.values, normalizedCostUnit) as { recorded_cost_minor: number };
  return safeAggregate(row?.recorded_cost_minor ?? 0, 'recorded cost total', true);
}

export const BUDGET_RESERVING_RUN_STATUSES: readonly string[] = ['queued', 'running', 'pausing', 'paused', 'resume_pending', 'partial', 'interrupted'];
export function budgetReservesRunStatus(status: string): boolean {
  return BUDGET_RESERVING_RUN_STATUSES.includes(status);
}

/** Add only the unreconciled portion of known frozen estimates for non-terminal runs. */
export function sumCommittedUsageCostMinor(db: StudioDatabase, input: UsageAttribution, costUnit: string): number {
  const normalizedCostUnit = required(costUnit, 'cost unit');
  let committed = sumUsageCostMinor(db, input, normalizedCostUnit);
  const profileId = optional(input.profileId, 'profileId');
  const profileFilter = profileId === null ? '' : ' AND r.provider_profile_id = ?';
  const parameters: Array<string | number> = [input.studioId];
  if (profileId !== null) parameters.push(profileId);
  const rows = db.prepare('SELECT r.id, r.provider_profile_id, r.usage_estimate_json, COUNT(i.id) AS item_count FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id JOIN projects p ON p.id = t.project_id LEFT JOIN run_items i ON i.run_id = r.id WHERE p.studio_id = ? AND r.status IN (' + BUDGET_RESERVING_RUN_STATUSES.map(() => '?').join(', ') + ')' + profileFilter + ' GROUP BY r.id, r.provider_profile_id, r.usage_estimate_json').all(input.studioId, ...BUDGET_RESERVING_RUN_STATUSES, ...parameters.slice(1)) as Array<{ id: string; provider_profile_id: string | null; usage_estimate_json: string | null; item_count: number }>;
  for (const row of rows) {
    const estimate = parseStoredUsageEstimate(row.usage_estimate_json, Math.max(1, Number(row.item_count) || 1));
    if (estimate.estimatedCostMinor === null || estimate.costUnit !== normalizedCostUnit) continue;
    const recorded = sumRecordedRunUsageCostMinor(db, { studioId: input.studioId, runId: row.id }, normalizedCostUnit);
    const remaining = estimate.estimatedCostMinor - recorded;
    if (remaining > 0) committed += remaining;
  }
  return safeAggregate(committed, 'committed cost total', true);
}

export function summarizeUsage(db: StudioDatabase, input: UsageAttribution): UsageSummary {
  return aggregateUsage(db, input);
}
