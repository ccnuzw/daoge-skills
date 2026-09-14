import { createHash } from 'node:crypto';
import { canonicalJson } from '../shared/canonical-json';

/** The schema is intentionally independent from the Studio database schema. */
export const PROVENANCE_SCHEMA_VERSION = 1 as const;
export const RETENTION_POLICY_VERSION = 1 as const;

export const MAX_PROVENANCE_INPUTS = 512;
export const MAX_PROVENANCE_STRING_LENGTH = 256;
export const MAX_SAFE_PROMPT_LENGTH = 64 * 1024;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,79}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,79}$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export type AssetUsage = 'primary' | 'reference' | 'style' | 'composition' | 'color' | 'brand' | 'mask' | 'negative';
export type AssetKind = 'import' | 'generated' | 'export';
export type ReviewDecision = 'keep' | 'review' | 'reject' | 'derive';

export interface SourceAssetProvenance {
  assetId: string;
  usage: AssetUsage;
  kind?: AssetKind;
  mediaType?: string;
  contentHash?: string;
}

export interface PlanProvenance {
  planId: string;
  version: number;
  operation: 'generate' | 'edit';
  planHash?: string;
  safePromptHash?: string;
}

export interface ProviderProvenance {
  providerId: string;
  descriptorVersion: number;
  configVersion: number;
  model?: string;
}

export interface RunItemProvenance {
  runId: string;
  itemId: string;
  itemSequence: number;
}

export interface ReviewAttribution {
  decision: ReviewDecision;
  reviewerId: string;
  reviewedAt: string;
  feedbackHash?: string;
}

export interface ExportReportProvenance {
  reportId: string;
  version: number;
  exportedAt: string;
}

/**
 * A provenance record contains references and digests only. It deliberately has
 * no prompt, provider request/response, endpoint, credential, or filesystem
 * path field.
 */
export interface ProvenanceRecord {
  schemaVersion: typeof PROVENANCE_SCHEMA_VERSION;
  recordId: string;
  createdAt: string;
  projectId: string;
  taskId: string;
  roundId: string;
  /** A digest or an already-sanitized short summary; never raw prompt text. */
  safePromptHash?: string;
  safePromptSummary?: string;
  plan: PlanProvenance;
  provider: ProviderProvenance;
  run: RunItemProvenance;
  inputs: readonly SourceAssetProvenance[];
  review: ReviewAttribution;
  exportReport: ExportReportProvenance;
}

export type RetentionCategory = 'source_asset' | 'generated_asset' | 'prompt_hash' | 'review' | 'export_report';
export const RETENTION_CATEGORIES: readonly RetentionCategory[] = Object.freeze([
  'source_asset',
  'generated_asset',
  'prompt_hash',
  'review',
  'export_report'
]);
export type RetentionAction = 'keep' | 'redact' | 'delete';

export interface RetentionRule {
  action: RetentionAction;
  /** Optional age boundary in milliseconds. The boundary is inclusive. */
  expiresAfterMs?: number;
  onExpire?: RetentionAction;
}

export interface RetentionPolicy {
  version: number;
  rules: Partial<Record<RetentionCategory, RetentionRule>>;
}

export interface ValidationIssue {
  path: string;
  code:
    | 'invalid_type'
    | 'missing_field'
    | 'invalid_value'
    | 'too_long'
    | 'too_many_items'
    | 'unknown_field'
    | 'sensitive_field_forbidden'
    | 'prompt_text_forbidden';
  message: string;
}

export interface ProvenanceValidationFailure {
  ok: false;
  valid: false;
  issues: readonly ValidationIssue[];
  record: null;
  canonicalJson: null;
  canonical: null;
}

export interface ProvenanceValidationSuccess {
  ok: true;
  valid: true;
  issues: readonly [];
  record: ProvenanceRecord;
  canonicalJson: string;
  canonical: string;
}

export type ProvenanceValidation = ProvenanceValidationFailure | ProvenanceValidationSuccess;
export type CanonicalProvenanceResult = ProvenanceValidation;

export interface SafeProvenanceProjection {
  schemaVersion: typeof PROVENANCE_SCHEMA_VERSION;
  recordId: string;
  createdAt: string;
  projectId: string;
  taskId: string;
  roundId: string;
  safePromptHash?: string;
  safePromptSummary?: string;
  plan: PlanProvenance;
  provider: ProviderProvenance;
  run: RunItemProvenance;
  inputs: readonly SourceAssetProvenance[];
  review: ReviewAttribution;
  exportReport: ExportReportProvenance;
}

export interface SafeProjectionSuccess {
  ok: true;
  valid: true;
  issues: readonly [];
  projection: SafeProvenanceProjection;
  json: string;
}

export interface SafeProjectionFailure {
  ok: false;
  valid: false;
  issues: readonly ValidationIssue[];
  projection: null;
  json: null;
}

export type SafeProjectionResult = SafeProjectionSuccess | SafeProjectionFailure;

export interface RetentionDecision {
  category: string;
  policyVersion: number | null;
  action: RetentionAction;
  /** Unknown/malformed input is never treated as retained. */
  failClosed: boolean;
  matched: boolean;
  expired: boolean;
  issues: readonly ValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Hashes transient prompt input; the prompt itself is never returned or stored. */
export function hashSafePrompt(prompt: string): string {
  if (typeof prompt !== 'string') throw new TypeError('Prompt must be a string.');
  if (prompt.length > MAX_SAFE_PROMPT_LENGTH) throw new RangeError('Prompt exceeds the safe hashing limit.');
  return createHash('sha256').update(prompt, 'utf8').digest('hex');
}

function issue(issues: ValidationIssue[], path: string, code: ValidationIssue['code'], message: string): void {
  issues.push({ path, code, message });
}

function unknownFieldIssue(issues: ValidationIssue[], path: string, key: string): void {
  const sensitive = /(prompt|api[_-]?key|authorization|secret|token|password|base[_-]?url|endpoint|request|response|storage.*path|absolute.*path|file.*path|credential)/i.test(key);
  issue(issues, path + '.' + key, sensitive ? (/(prompt)/i.test(key) ? 'prompt_text_forbidden' : 'sensitive_field_forbidden') : 'unknown_field', sensitive ? 'Sensitive provenance fields are not permitted.' : 'Field is not part of the provenance contract.');
}

function checkObjectKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: ValidationIssue[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) unknownFieldIssue(issues, path, key);
}
function safeText(value: unknown, path: string, issues: ValidationIssue[], max = MAX_PROVENANCE_STRING_LENGTH): string | undefined {
  if (value === undefined) {
    issue(issues, path, 'missing_field', 'Required field is missing.');
    return undefined;
  }
  if (typeof value !== 'string') {
    issue(issues, path, 'invalid_type', 'Expected a string.');
    return undefined;
  }
  if (value.length === 0) {
    issue(issues, path, 'invalid_value', 'Value must not be empty.');
    return undefined;
  }
  if (value.length > max) {
    issue(issues, path, 'too_long', 'Value exceeds the allowed length.');
    return undefined;
  }
  if (value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    issue(issues, path, 'invalid_value', 'Value contains unsafe whitespace or control characters.');
    return undefined;
  }
  // This check applies to summaries and labels as well as IDs. It prevents a
  // permitted string from becoming an accidental URL/path side channel.
  if (/(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\/|\bwww\.)[^\s<>"']+/i.test(value) || /(^|[\s"'=])(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value) || /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i.test(value) || /(?:sk-[A-Za-z0-9]|AIza[0-9A-Za-z_-]{10}|gh[pousr]_[A-Za-z0-9_]+)/.test(value) || /(?:api[_-]?key|authorization|secret|token|password)\s*[:=]/i.test(value)) {
    issue(issues, path, 'sensitive_field_forbidden', 'URLs, paths, and credential-like values are not permitted.');
    return undefined;
  }
  return value;
}

function identifier(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const result = safeText(value, path, issues, 128);
  if (result !== undefined && !ID_PATTERN.test(result)) issue(issues, path, 'invalid_value', 'Value must be a stable internal identifier.');
  return result !== undefined && ID_PATTERN.test(result) ? result : undefined;
}

function hash(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const result = safeText(value, path, issues, 64);
  if (result !== undefined && !HASH_PATTERN.test(result)) issue(issues, path, 'invalid_value', 'Value must be a lowercase SHA-256 digest.');
  return result !== undefined && HASH_PATTERN.test(result) ? result : undefined;
}

function positiveVersion(value: unknown, path: string, issues: ValidationIssue[]): number | undefined {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    issue(issues, path, 'invalid_value', 'Version must be a positive safe integer.');
    return undefined;
  }
  return value as number;
}

function timestamp(value: unknown, path: string, issues: ValidationIssue[]): string | undefined {
  const result = safeText(value, path, issues, 40);
  if (result !== undefined && (!TIMESTAMP_PATTERN.test(result) || !Number.isFinite(Date.parse(result)))) issue(issues, path, 'invalid_value', 'Value must be an ISO-8601 UTC timestamp.');
  return result !== undefined && TIMESTAMP_PATTERN.test(result) && Number.isFinite(Date.parse(result)) ? result : undefined;
}

function normalizeAsset(value: unknown, path: string, issues: ValidationIssue[]): SourceAssetProvenance | undefined {
  if (value === undefined) {
    issue(issues, path, 'missing_field', 'Required field is missing.');
    return undefined;
  }
  if (!isRecord(value)) {
    issue(issues, path, 'invalid_type', 'Expected an asset object.');
    return undefined;
  }
  checkObjectKeys(value, ['assetId', 'usage', 'kind', 'mediaType', 'contentHash'], path, issues);
  const assetId = identifier(value.assetId, path + '.assetId', issues);
  const usages: readonly AssetUsage[] = ['primary', 'reference', 'style', 'composition', 'color', 'brand', 'mask', 'negative'];
  if (!usages.includes(value.usage as AssetUsage)) issue(issues, path + '.usage', 'invalid_value', 'Asset usage is not supported.');
  const result: SourceAssetProvenance = { assetId: assetId || '', usage: value.usage as AssetUsage };
  if (value.kind !== undefined) {
    if (value.kind !== 'import' && value.kind !== 'generated' && value.kind !== 'export') issue(issues, path + '.kind', 'invalid_value', 'Asset kind is not supported.');
    else result.kind = value.kind;
  }
  if (value.mediaType !== undefined) {
    const mediaType = safeText(value.mediaType, path + '.mediaType', issues, 80);
    if (mediaType !== undefined && !MEDIA_TYPE_PATTERN.test(mediaType)) issue(issues, path + '.mediaType', 'invalid_value', 'Media type is invalid.');
    if (mediaType !== undefined && MEDIA_TYPE_PATTERN.test(mediaType)) result.mediaType = mediaType;
  }
  if (value.contentHash !== undefined) {
    const contentHash = hash(value.contentHash, path + '.contentHash', issues);
    if (contentHash !== undefined) result.contentHash = contentHash;
  }
  return result;
}

function normalizePlan(value: unknown, path: string, issues: ValidationIssue[]): PlanProvenance | undefined {
  if (value === undefined) {
    issue(issues, path, 'missing_field', 'Required field is missing.');
    return undefined;
  }
  if (!isRecord(value)) {
    issue(issues, path, 'invalid_type', 'Expected a plan object.');
    return undefined;
  }
  checkObjectKeys(value, ['planId', 'version', 'operation', 'planHash', 'safePromptHash'], path, issues);
  const planId = identifier(value.planId, path + '.planId', issues);
  const version = positiveVersion(value.version, path + '.version', issues);
  const operation = value.operation === 'generate' || value.operation === 'edit' ? value.operation : undefined;
  if (!operation) issue(issues, path + '.operation', 'invalid_value', 'Plan operation is not supported.');
  const result: PlanProvenance = { planId: planId || '', version: version || 0, operation: operation || 'generate' };
  if (value.planHash !== undefined) {
    const planHash = hash(value.planHash, path + '.planHash', issues);
    if (planHash !== undefined) result.planHash = planHash;
  }
  if (value.safePromptHash !== undefined) {
    const safePromptHash = hash(value.safePromptHash, path + '.safePromptHash', issues);
    if (safePromptHash !== undefined) result.safePromptHash = safePromptHash;
  }
  return result;
}

function normalizeProvider(value: unknown, path: string, issues: ValidationIssue[]): ProviderProvenance | undefined {
  if (value === undefined) {
    issue(issues, path, 'missing_field', 'Required field is missing.');
    return undefined;
  }
  if (!isRecord(value)) {
    issue(issues, path, 'invalid_type', 'Expected a provider descriptor snapshot.');
    return undefined;
  }
  checkObjectKeys(value, ['providerId', 'descriptorVersion', 'configVersion', 'model'], path, issues);
  const providerId = safeText(value.providerId, path + '.providerId', issues, 64);
  if (providerId !== undefined && !PROVIDER_ID_PATTERN.test(providerId)) issue(issues, path + '.providerId', 'invalid_value', 'Provider id is not a safe identifier.');
  const descriptorVersion = positiveVersion(value.descriptorVersion, path + '.descriptorVersion', issues);
  const configVersion = positiveVersion(value.configVersion, path + '.configVersion', issues);
  const result: ProviderProvenance = { providerId: providerId || '', descriptorVersion: descriptorVersion || 0, configVersion: configVersion || 0 };
  if (value.model !== undefined) {
    const model = safeText(value.model, path + '.model', issues, 128);
    if (model !== undefined) result.model = model;
  }
  return result;
}

function normalizeRun(value: unknown, path: string, issues: ValidationIssue[]): RunItemProvenance | undefined {
  if (value === undefined) {
    issue(issues, path, 'missing_field', 'Required field is missing.');
    return undefined;
  }
  if (!isRecord(value)) {
    issue(issues, path, 'invalid_type', 'Expected a run item object.');
    return undefined;
  }
  checkObjectKeys(value, ['runId', 'itemId', 'itemSequence'], path, issues);
  const runId = identifier(value.runId, path + '.runId', issues);
  const itemId = identifier(value.itemId, path + '.itemId', issues);
  if (!Number.isSafeInteger(value.itemSequence) || (value.itemSequence as number) < 1) issue(issues, path + '.itemSequence', 'invalid_value', 'Item sequence must be a positive safe integer.');
  return { runId: runId || '', itemId: itemId || '', itemSequence: Number.isSafeInteger(value.itemSequence) && (value.itemSequence as number) > 0 ? value.itemSequence as number : 0 };
}

function normalizeReview(value: unknown, path: string, issues: ValidationIssue[]): ReviewAttribution | undefined {
  if (value === undefined) {
    issue(issues, path, 'missing_field', 'Required field is missing.');
    return undefined;
  }
  if (!isRecord(value)) {
    issue(issues, path, 'invalid_type', 'Expected review attribution.');
    return undefined;
  }
  checkObjectKeys(value, ['decision', 'reviewerId', 'reviewedAt', 'feedbackHash'], path, issues);
  const decisions: readonly ReviewDecision[] = ['keep', 'review', 'reject', 'derive'];
  if (!decisions.includes(value.decision as ReviewDecision)) issue(issues, path + '.decision', 'invalid_value', 'Review decision is not supported.');
  const reviewerId = identifier(value.reviewerId, path + '.reviewerId', issues);
  const reviewedAt = timestamp(value.reviewedAt, path + '.reviewedAt', issues);
  const result: ReviewAttribution = { decision: value.decision as ReviewDecision, reviewerId: reviewerId || '', reviewedAt: reviewedAt || '' };
  if (value.feedbackHash !== undefined) {
    const feedbackHash = hash(value.feedbackHash, path + '.feedbackHash', issues);
    if (feedbackHash !== undefined) result.feedbackHash = feedbackHash;
  }
  return result;
}

function normalizeExportReport(value: unknown, path: string, issues: ValidationIssue[]): ExportReportProvenance | undefined {
  if (value === undefined) {
    issue(issues, path, 'missing_field', 'Required field is missing.');
    return undefined;
  }
  if (!isRecord(value)) {
    issue(issues, path, 'invalid_type', 'Expected export report provenance.');
    return undefined;
  }
  checkObjectKeys(value, ['reportId', 'version', 'exportedAt'], path, issues);
  const reportId = identifier(value.reportId, path + '.reportId', issues);
  const version = positiveVersion(value.version, path + '.version', issues);
  const exportedAt = timestamp(value.exportedAt, path + '.exportedAt', issues);
  return { reportId: reportId || '', version: version || 0, exportedAt: exportedAt || '' };
}

/** Validates and canonicalizes without filling absent fields with fake values. */
export function validateProvenance(input: unknown): ProvenanceValidation {
  const issues: ValidationIssue[] = [];
  if (!isRecord(input)) {
    issue(issues, '$', 'invalid_type', 'Expected a provenance record object.');
    return { ok: false, valid: false, issues, record: null, canonicalJson: null, canonical: null };
  }
  checkObjectKeys(input, ['schemaVersion', 'recordId', 'createdAt', 'projectId', 'taskId', 'roundId', 'safePromptHash', 'safePromptSummary', 'plan', 'provider', 'run', 'inputs', 'review', 'exportReport'], '$', issues);
  if (input.schemaVersion !== PROVENANCE_SCHEMA_VERSION) issue(issues, '$.schemaVersion', 'invalid_value', 'Unsupported provenance schema version.');
  const recordId = identifier(input.recordId, '$.recordId', issues);
  const createdAt = timestamp(input.createdAt, '$.createdAt', issues);
  const projectId = identifier(input.projectId, '$.projectId', issues);
  const taskId = identifier(input.taskId, '$.taskId', issues);
  const roundId = identifier(input.roundId, '$.roundId', issues);
  const safePromptHash = input.safePromptHash === undefined ? undefined : hash(input.safePromptHash, '$.safePromptHash', issues);
  const safePromptSummary = input.safePromptSummary === undefined ? undefined : safeText(input.safePromptSummary, '$.safePromptSummary', issues, 160);
  const plan = normalizePlan(input.plan, '$.plan', issues);
  const provider = normalizeProvider(input.provider, '$.provider', issues);
  const run = normalizeRun(input.run, '$.run', issues);
  if (!Array.isArray(input.inputs)) issue(issues, '$.inputs', input.inputs === undefined ? 'missing_field' : 'invalid_type', 'Inputs must be an array.');
  if (Array.isArray(input.inputs) && input.inputs.length > MAX_PROVENANCE_INPUTS) issue(issues, '$.inputs', 'too_many_items', 'Too many input assets.');
  const inputs = Array.isArray(input.inputs) ? input.inputs.map((asset, index) => normalizeAsset(asset, '$.inputs[' + index + ']', issues)).filter((asset): asset is SourceAssetProvenance => Boolean(asset)).sort((left, right) => left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : left.usage < right.usage ? -1 : left.usage > right.usage ? 1 : 0) : [];
  const review = normalizeReview(input.review, '$.review', issues);
  const exportReport = normalizeExportReport(input.exportReport, '$.exportReport', issues);
  if (issues.length) return { ok: false, valid: false, issues, record: null, canonicalJson: null, canonical: null };
  const record: ProvenanceRecord = {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    recordId: recordId as string,
    createdAt: createdAt as string,
    projectId: projectId as string,
    taskId: taskId as string,
    roundId: roundId as string,
    ...(safePromptHash === undefined ? {} : { safePromptHash }),
    ...(safePromptSummary === undefined ? {} : { safePromptSummary }),
    plan: plan as PlanProvenance,
    provider: provider as ProviderProvenance,
    run: run as RunItemProvenance,
    inputs,
    review: review as ReviewAttribution,
    exportReport: exportReport as ExportReportProvenance
  };
  const canonical = canonicalJson(record);
  return { ok: true, valid: true, issues: [], record, canonicalJson: canonical, canonical };
}

export function buildCanonicalProvenance(input: unknown): CanonicalProvenanceResult {
  return validateProvenance(input);
}

/**
 * Produces an approved external projection. Since the validator rejects all
 * disallowed fields, projection never copies unknown input keys or sensitive
 * values; no prompt/request/response/path redaction can be bypassed.
 */
export function redactProvenance(input: unknown): SafeProjectionResult {
  const result = validateProvenance(input);
  if (!result.ok) return { ok: false, valid: false, issues: result.issues, projection: null, json: null };
  const projection: SafeProvenanceProjection = {
    schemaVersion: result.record.schemaVersion,
    recordId: result.record.recordId,
    createdAt: result.record.createdAt,
    projectId: result.record.projectId,
    taskId: result.record.taskId,
    roundId: result.record.roundId,
    ...(result.record.safePromptHash === undefined ? {} : { safePromptHash: result.record.safePromptHash }),
    ...(result.record.safePromptSummary === undefined ? {} : { safePromptSummary: result.record.safePromptSummary }),
    plan: { ...result.record.plan },
    provider: { ...result.record.provider },
    run: { ...result.record.run },
    inputs: result.record.inputs.map((asset) => ({ ...asset })),
    review: { ...result.record.review },
    exportReport: { ...result.record.exportReport }
  };
  return { ok: true, valid: true, issues: [], projection, json: canonicalJson(projection) };
}

export function projectSafeProvenance(input: unknown): SafeProjectionResult {
  return redactProvenance(input);
}

function retentionIssue(path: string, code: ValidationIssue['code'], message: string): ValidationIssue {
  return { path, code, message };
}

function failClosedRetention(category: string, policyVersion: number | null, issues: readonly ValidationIssue[]): RetentionDecision {
  return { category, policyVersion, action: 'delete', failClosed: true, matched: false, expired: false, issues };
}

/**
 * Decides only. It never deletes, redacts, or mutates a record. Missing rules,
 * invalid policy versions, and unknown categories all fail closed to delete.
 */
export function evaluateRetention(category: string, policy: unknown, context: { recordedAt?: string; now?: string } = {}): RetentionDecision {
  if (typeof category !== 'string' || !RETENTION_CATEGORIES.includes(category as RetentionCategory)) return failClosedRetention(typeof category === 'string' ? category : '', null, [retentionIssue('category', 'invalid_value', 'Unknown retention category fails closed.')]);
  if (!isRecord(policy)) return failClosedRetention(category, null, [retentionIssue('policy', 'invalid_type', 'An explicit retention policy is required.')]);
  const policyVersion = policy.version;
  if (!Number.isSafeInteger(policyVersion) || (policyVersion as number) < 1) return failClosedRetention(category, null, [retentionIssue('policy.version', 'invalid_value', 'Retention policy version must be positive.')]);
  if (policyVersion !== RETENTION_POLICY_VERSION) return failClosedRetention(category, policyVersion as number, [retentionIssue('policy.version', 'invalid_value', 'Unsupported retention policy version fails closed.')]);
  if (!isRecord(policy.rules)) return failClosedRetention(category, policyVersion as number, [retentionIssue('policy.rules', 'invalid_type', 'Retention rules are required.')]);
  const ruleKeys = Object.keys(policy.rules);
  const unknownRule = ruleKeys.find((key) => !RETENTION_CATEGORIES.includes(key as RetentionCategory));
  if (unknownRule) return failClosedRetention(category, policyVersion as number, [retentionIssue('policy.rules.' + unknownRule, 'invalid_value', 'Unknown retention category fails closed.')]);
  const rawRule = policy.rules[category];
  if (!isRecord(rawRule) || (rawRule.action !== 'keep' && rawRule.action !== 'redact' && rawRule.action !== 'delete')) return failClosedRetention(category, policyVersion as number, [retentionIssue('policy.rules.' + category, 'invalid_value', 'A valid explicit rule is required.')]);
  const rule = rawRule as Record<string, unknown>;
  const unknownRuleField = Object.keys(rule).find((key) => !['action', 'expiresAfterMs', 'onExpire'].includes(key));
  if (unknownRuleField) return failClosedRetention(category, policyVersion as number, [retentionIssue('policy.rules.' + category + '.' + unknownRuleField, 'invalid_value', 'Unknown retention rule fields fail closed.')]);
  let expired = false;
  let action = rule.action as RetentionAction;
  if (rule.expiresAfterMs !== undefined) {
    if (!Number.isSafeInteger(rule.expiresAfterMs) || (rule.expiresAfterMs as number) < 0 || (rule.onExpire !== 'keep' && rule.onExpire !== 'redact' && rule.onExpire !== 'delete')) return failClosedRetention(category, policyVersion as number, [retentionIssue('policy.rules.' + category, 'invalid_value', 'Expiry rules require a non-negative boundary and onExpire action.')]);
    if (typeof context.recordedAt !== 'string' || typeof context.now !== 'string' || !Number.isFinite(Date.parse(context.recordedAt)) || !Number.isFinite(Date.parse(context.now))) return failClosedRetention(category, policyVersion as number, [retentionIssue('context', 'invalid_value', 'Expiry rules require recordedAt and now timestamps.')]);
    expired = Date.parse(context.now) - Date.parse(context.recordedAt) >= (rule.expiresAfterMs as number);
    if (expired) action = rule.onExpire as RetentionAction;
  }
  return { category, policyVersion: policyVersion as number, action, failClosed: false, matched: true, expired, issues: [] };
}

export function decideRetention(category: string, policy: unknown, context: { recordedAt?: string; now?: string } = {}): RetentionDecision {
  return evaluateRetention(category, policy, context);
}
