import { createId, nowIso } from '../shared/ids';
import { InvalidCommandError, StudioNotFoundError } from '../domain/studio-commands';
import { StudioDatabase, withTransaction } from '../studio/database';
import { UsageEstimate, normalizeUsageEstimate, sumCommittedUsageCostMinor } from './ledger';
export interface BudgetPolicy {
  id: string;
  studioId: string;
  profileId: string | null;
  limitCostMinor: number;
  costUnit: string;
  mode: 'hard';
  createdAt: string;
  updatedAt: string;
}

export interface BudgetGateResult {
  allowed: boolean;
  code: 'budget_not_configured' | 'budget_ok' | 'budget_exceeded' | 'budget_unknown_estimate' | 'budget_cost_unit_mismatch';
  message: string;
  policy: BudgetPolicy | null;
  committedCostMinor: number;
  estimatedCostMinor: number | null;
  unknownEstimate: boolean;
}

export interface BudgetPolicyInput {
  studioId: string;
  profileId?: string | null;
  limitCostMinor: number;
  costUnit: string;
}

interface BudgetRow { id: string; studio_id: string; profile_id: string | null; limit_cost_minor: number; cost_unit: string; mode: 'hard'; created_at: string; updated_at: string; }

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
function policyFromRow(row: BudgetRow): BudgetPolicy {
  return { id: row.id, studioId: row.studio_id, profileId: row.profile_id, limitCostMinor: Number(row.limit_cost_minor), costUnit: row.cost_unit, mode: row.mode, createdAt: row.created_at, updatedAt: row.updated_at };
}
/** The platform default is explicitly unknown; callers must supply a price to enable hard cost rejection. */
export function unknownUsageEstimate(quantity: number): UsageEstimate {
  return normalizeUsageEstimate({ unit: 'image', quantity, estimatedCostMinor: null, costUnit: null, source: 'unknown' });
}

/** Create or replace a hard budget. Limits and usage are integer minor units; pricing remains caller/provider supplied. */
export function configureBudget(db: StudioDatabase, input: BudgetPolicyInput): BudgetPolicy {
  return withTransaction(db, () => {
    const studioId = required(input.studioId, 'studioId');
    if (!db.prepare('SELECT id FROM studios WHERE id = ?').get(studioId)) throw new StudioNotFoundError('Studio not found: ' + studioId);
    const profileId = optional(input.profileId, 'profileId');
    const limitCostMinor = Number(input.limitCostMinor);
    if (!Number.isSafeInteger(limitCostMinor) || limitCostMinor < 0) throw new InvalidCommandError('Budget limit must be a non-negative integer minor amount.');
    const costUnit = required(input.costUnit, 'cost unit');
    const timestamp = nowIso();
    const id = createId('budget');
    const existing = db.prepare('SELECT id FROM budget_policies WHERE studio_id = ? AND profile_id IS ?').get(studioId, profileId) as { id: string } | undefined;
    if (existing) db.prepare('UPDATE budget_policies SET limit_cost_minor = ?, cost_unit = ?, mode = \'hard\', updated_at = ? WHERE id = ?').run(limitCostMinor, costUnit, timestamp, existing.id);
    else db.prepare('INSERT INTO budget_policies (id, studio_id, profile_id, limit_cost_minor, cost_unit, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'hard\', ?, ?)').run(id, studioId, profileId, limitCostMinor, costUnit, timestamp, timestamp);
    const row = db.prepare('SELECT id, studio_id, profile_id, limit_cost_minor, cost_unit, mode, created_at, updated_at FROM budget_policies WHERE studio_id = ? AND profile_id IS ? ORDER BY updated_at DESC, id DESC LIMIT 1').get(studioId, profileId) as unknown as BudgetRow;
    return policyFromRow(row);
  });
}

export function getBudgetPolicy(db: StudioDatabase, input: { studioId: string; profileId?: string | null }): BudgetPolicy | null {
  const studioId = required(input.studioId, 'studioId');
  if (!db.prepare('SELECT id FROM studios WHERE id = ?').get(studioId)) throw new StudioNotFoundError('Studio not found: ' + studioId);
  const profileId = optional(input.profileId, 'profileId');
  const row = db.prepare('SELECT id, studio_id, profile_id, limit_cost_minor, cost_unit, mode, created_at, updated_at FROM budget_policies WHERE studio_id = ? AND profile_id IS ?').get(studioId, profileId) as BudgetRow | undefined;
  return row ? policyFromRow(row) : null;
}

/**
 * Evaluate before dry-run/queue. No policy means allow. Unknown estimates never become zero and are reported as unknown;
 * only a known, matching-unit estimate can trigger a hard rejection.
 */
export function evaluateBudgetGate(db: StudioDatabase, input: { studioId: string; profileId?: string | null; projectId?: string | null; taskId?: string | null; roundId?: string | null; runId?: string | null; estimate: UsageEstimate }): BudgetGateResult {
  const studioId = required(input.studioId, 'studioId');
  const profileId = optional(input.profileId, 'profileId');
  const estimate = normalizeUsageEstimate(input.estimate);
  const policy = getBudgetPolicy(db, { studioId, profileId }) || (profileId ? getBudgetPolicy(db, { studioId, profileId: null }) : null);
  if (!policy) return { allowed: true, code: 'budget_not_configured', message: 'No budget is configured.', policy: null, committedCostMinor: 0, estimatedCostMinor: estimate.estimatedCostMinor, unknownEstimate: estimate.estimatedCostMinor === null };
  const committedCostMinor = sumCommittedUsageCostMinor(db, { studioId, profileId: policy.profileId }, policy.costUnit);
  if (estimate.estimatedCostMinor === null || estimate.costUnit === null) return { allowed: true, code: 'budget_unknown_estimate', message: 'Usage cost is unknown; budget gate did not invent a price.', policy, committedCostMinor, estimatedCostMinor: null, unknownEstimate: true };
  if (estimate.costUnit !== policy.costUnit) return { allowed: false, code: 'budget_cost_unit_mismatch', message: 'Usage estimate currency/unit does not match the configured budget.', policy, committedCostMinor, estimatedCostMinor: estimate.estimatedCostMinor, unknownEstimate: false };
  if (estimate.estimatedCostMinor > policy.limitCostMinor - committedCostMinor) return { allowed: false, code: 'budget_exceeded', message: 'Estimated usage exceeds the configured budget.', policy, committedCostMinor, estimatedCostMinor: estimate.estimatedCostMinor, unknownEstimate: false };
  return { allowed: true, code: 'budget_ok', message: 'Estimated usage is within the configured budget.', policy, committedCostMinor, estimatedCostMinor: estimate.estimatedCostMinor, unknownEstimate: false };
}
