import { createHash } from 'node:crypto';
import { StudioDatabase, withTransaction } from '../studio/database';
import { StudioNotFoundError } from '../domain/studio-commands';
import { inspectProjectAssetAccess, projectAssetReferenceAllowed } from '../domain/asset-access';
import { buildCanonicalProvenance, evaluateRetention, RETENTION_CATEGORIES, RetentionCategory, RetentionDecision, RetentionPolicy, ProvenanceRecord, ValidationIssue } from './contract';
import { parseReviewContext } from '../domain/review-contract';

type JsonRecord = Record<string, unknown>;

type OutputRow = {
  asset_id: string;
  asset_kind: 'import' | 'generated' | 'export';
  media_type: string;
  content_hash: string;
  item_id: string;
  run_id: string;
  item_sequence: number;
  run_created_at: string;
  round_id: string;
  task_id: string;
  project_id: string;
  plan_json: string;
  provider_json: string;
  prompt_json: string;
};

type ReviewRow = {
  id: string;
  decision: 'keep' | 'review' | 'reject' | 'derive';
  feedback_json: string;
  context_json: string | null;
  task_id: string | null;
  round_id: string | null;
  created_at: string;
};

type ExportRow = { id: string; manifest_json: string; updated_at: string };

/**
 * The default policy is intentionally conservative about transient prompt
 * material. It is a policy descriptor, not a deletion job; callers must apply
 * returned decisions at an explicit lifecycle boundary.
 */
export const DEFAULT_PROVENANCE_RETENTION_POLICY: RetentionPolicy = Object.freeze({
  version: 1,
  rules: {
    source_asset: { action: 'keep' },
    generated_asset: { action: 'keep' },
    prompt_hash: { action: 'redact', expiresAfterMs: 90 * 24 * 60 * 60 * 1000, onExpire: 'delete' },
    review: { action: 'keep' },
    export_report: { action: 'keep' }
  }
} as RetentionPolicy);

export interface StudioProvenanceRecord {
  record: ProvenanceRecord;
  canonicalJson: string;
  assetId: string;
  deliveryId: string;
}

export interface StudioProvenanceResult {
  assetId: string;
  records: readonly StudioProvenanceRecord[];
  issues: readonly ValidationIssue[];
  retention: Readonly<Record<RetentionCategory, RetentionDecision>>;
}

export interface PersistedStudioProvenanceRecord {
  recordId: string;
  assetId: string;
  deliveryId: string;
  persistedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedStudioProvenanceResult {
  assetId: string;
  records: readonly PersistedStudioProvenanceRecord[];
  issues: readonly ValidationIssue[];
  retention: Readonly<Record<RetentionCategory, RetentionDecision>>;
}

export interface StoredStudioProvenanceRecord {
  record: ProvenanceRecord;
  canonicalJson: string;
  retention: Readonly<Record<RetentionCategory, RetentionDecision>>;
  persistedAt: string;
  assetId: string;
  deliveryId: string;
  createdAt: string;
  updatedAt: string;
}

function parseObject(value: string | null | undefined): JsonRecord {
  try {
    const parsed = JSON.parse(value || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : {};
  } catch {
    return {};
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function digestJson(value: unknown): string {
  return digest(JSON.stringify(value) || 'null');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function reviewForProject(db: StudioDatabase, studioId: string, projectId: string, assetId: string): ReviewRow | null {
  const row = db.prepare("SELECT review.id, review.decision, review.feedback_json, review.task_id, review.round_id, review.created_at FROM review_decisions review LEFT JOIN creative_tasks task ON task.id = review.task_id LEFT JOIN creative_rounds round ON round.id = review.round_id LEFT JOIN creative_tasks round_task ON round_task.id = round.task_id JOIN assets asset ON asset.id = review.asset_id WHERE review.asset_id = ? AND asset.studio_id = ? AND ((((review.task_id IS NULL AND review.round_id IS NULL) AND (review.schema_version < 2 OR (json_valid(review.context_json) = 1 AND (json_extract(review.context_json, '$.projectId') IS NULL OR json_extract(review.context_json, '$.projectId') = ?)))) OR task.project_id = ? OR round_task.project_id = ?)) ORDER BY review.created_at DESC, review.rowid DESC LIMIT 1").get(assetId, studioId, projectId, projectId, projectId) as Omit<ReviewRow, 'context_json'> | undefined;
  if (!row) return null;
  const context = db.prepare('SELECT context_json FROM review_decisions WHERE id = ?').get(row.id) as { context_json: string | null } | undefined;
  return { ...row, context_json: context?.context_json || null };
}

function exportedDeliveriesForAsset(db: StudioDatabase, studioId: string, projectId: string, assetId: string): ExportRow[] {
  const rows = db.prepare("SELECT delivery.id, delivery.manifest_json, delivery.updated_at FROM delivery_assets member JOIN deliveries delivery ON delivery.id = member.delivery_id JOIN projects project ON project.id = delivery.project_id WHERE member.asset_id = ? AND project.id = ? AND project.studio_id = ? AND delivery.status = 'exported' ORDER BY delivery.updated_at DESC, delivery.id DESC").all(assetId, projectId, studioId) as ExportRow[];
  return rows;
}

function inputProvenance(db: StudioDatabase, studioId: string, projectId: string, plan: JsonRecord): { inputs: Array<Record<string, unknown>>; invalid: boolean } {
  const ids: Array<{ id: string; usage: 'reference' | 'mask' }> = [];
  const seen = new Set<string>();
  const references = Array.isArray(plan.referenceAssetIds) ? plan.referenceAssetIds : [];
  for (const value of references) {
    const id = text(value);
    if (id && !seen.has(id)) { seen.add(id); ids.push({ id, usage: 'reference' }); }
  }
  const maskId = text(plan.maskAssetId);
  if (maskId && !seen.has(maskId)) { seen.add(maskId); ids.push({ id: maskId, usage: 'mask' }); }
  if (!ids.length) return { inputs: [], invalid: false };
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare('SELECT id, kind, media_type, content_hash FROM assets WHERE studio_id = ? AND id IN (' + placeholders + ')').all(studioId, ...ids.map((item) => item.id)) as Array<{ id: string; kind: 'import' | 'generated' | 'export'; media_type: string; content_hash: string }>;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const access = inspectProjectAssetAccess(db, { studioId, projectId, assetIds: ids.map((item) => item.id) });
  const invalid = ids.some((item) => !byId.has(item.id) || !projectAssetReferenceAllowed(access.get(item.id)));
  const inputs = ids.filter((item) => byId.has(item.id) && projectAssetReferenceAllowed(access.get(item.id))).map((item) => {
    const asset = byId.get(item.id) as { id: string; kind: 'import' | 'generated' | 'export'; media_type: string; content_hash: string };
    return { assetId: asset.id, usage: item.usage, kind: asset.kind, mediaType: asset.media_type, contentHash: asset.content_hash };
  });
  return { inputs, invalid };
}

function providerProvenance(provider: JsonRecord): Record<string, unknown> | null {
  const providerId = text(provider.providerId);
  const descriptorVersion = integer(provider.descriptorVersion);
  const configVersion = integer(provider.configVersion);
  if (!providerId || descriptorVersion === null || configVersion === null) return null;
  const model = text(provider.model);
  return { providerId, descriptorVersion, configVersion, ...(model ? { model } : {}) };
}

function exportProvenance(row: ExportRow): Record<string, unknown> | null {
  const manifest = parseObject(row.manifest_json);
  const exportedAt = text(manifest.exportedAt) || text(manifest.createdAt) || text(row.updated_at);
  if (!exportedAt || !Number.isFinite(Date.parse(exportedAt))) return null;
  return { reportId: row.id, version: 1, exportedAt: new Date(exportedAt).toISOString() };
}

function reviewProvenance(review: ReviewRow): Record<string, unknown> {
  const feedback = parseObject(review.feedback_json);
  const context = parseReviewContext(review.context_json);
  return {
    decision: review.decision,
    reviewerId: context?.reviewerId || 'studio-user',
    reviewedAt: new Date(review.created_at).toISOString(),
    ...(Object.keys(feedback).length ? { feedbackHash: digestJson(feedback) } : {})
  };
}

function outputRows(db: StudioDatabase, studioId: string, assetId: string): OutputRow[] {
  return db.prepare("SELECT asset.id AS asset_id, asset.kind AS asset_kind, asset.media_type, asset.content_hash, item.id AS item_id, run.id AS run_id, item.sequence AS item_sequence, run.created_at AS run_created_at, round.id AS round_id, task.id AS task_id, project.id AS project_id, run.plan_snapshot_json AS plan_json, run.provider_snapshot_json AS provider_json, item.prompt_payload_json AS prompt_json FROM assets asset JOIN asset_relations relation ON relation.asset_id = asset.id AND relation.relation_type = 'output_of' AND relation.target_type = 'run_item' JOIN run_items item ON item.id = relation.target_id JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE asset.id = ? AND asset.studio_id = ? AND project.studio_id = ? ORDER BY run.created_at, run.id, item.sequence").all(assetId, studioId, studioId) as OutputRow[];
}

function recordForOutput(db: StudioDatabase, studioId: string, row: OutputRow, delivery: ExportRow, review: ReviewRow): StudioProvenanceRecord | null {
  const plan = parseObject(row.plan_json);
  const provider = providerProvenance(parseObject(row.provider_json));
  const exported = exportProvenance(delivery);
  if (!provider || !exported) return null;
  const promptPayload = parseObject(row.prompt_json);
  const prompt = text(promptPayload.prompt) || text(plan.prompt);
  const planVersion = integer(plan.planVersion) || integer(plan.version) || 1;
  const inputs = inputProvenance(db, studioId, row.project_id, { ...plan, ...promptPayload });
  if (inputs.invalid) return null;
  const recordId = 'provenance-' + digest(studioId + '\0' + row.asset_id + '\0' + row.item_id + '\0' + delivery.id).slice(0, 32);
  const candidate = {
    schemaVersion: 1,
    recordId,
    createdAt: new Date(row.run_created_at).toISOString(),
    projectId: row.project_id,
    taskId: row.task_id,
    roundId: row.round_id,
    ...(prompt ? { safePromptHash: digest(prompt) } : {}),
    plan: {
      planId: 'round-plan-' + row.round_id + '-' + planVersion,
      version: planVersion,
      operation: plan.operation === 'edit' ? 'edit' : 'generate',
      planHash: digestJson(plan),
      ...(prompt ? { safePromptHash: digest(prompt) } : {})
    },
    provider,
    run: { runId: row.run_id, itemId: row.item_id, itemSequence: Number(row.item_sequence) },
    inputs: inputs.inputs,
    review: reviewProvenance(review),
    exportReport: exported
  };
  const validated = buildCanonicalProvenance(candidate);
  if (!validated.ok) return null;
  return { record: validated.record, canonicalJson: validated.canonicalJson, assetId: row.asset_id, deliveryId: delivery.id };
}

/**
 * Derives canonical provenance only from Studio facts. A record is emitted only
 * when output lineage, a scoped review, and an exported delivery all exist;
 * incomplete history is reported rather than filled with synthetic IDs.
 */
export function projectAssetProvenance(db: StudioDatabase, studioId: string, assetId: string, policy: RetentionPolicy = DEFAULT_PROVENANCE_RETENTION_POLICY, now = new Date()): StudioProvenanceResult {
  const asset = db.prepare('SELECT id FROM assets WHERE id = ? AND studio_id = ?').get(assetId, studioId) as { id: string } | undefined;
  if (!asset) throw new StudioNotFoundError('Studio asset not found: ' + assetId);
  const rows = outputRows(db, studioId, assetId);
  const records: StudioProvenanceRecord[] = [];
  const issues: ValidationIssue[] = [];
  for (const row of rows) {
    const review = reviewForProject(db, studioId, row.project_id, assetId);
    if (!review) {
      issues.push({ path: '$.review', code: 'missing_field', message: 'A project-scoped review is required for canonical provenance.' });
      continue;
    }
    const deliveries = exportedDeliveriesForAsset(db, studioId, row.project_id, assetId);
    if (!deliveries.length) {
      issues.push({ path: '$.exportReport', code: 'missing_field', message: 'An exported delivery is required for canonical provenance.' });
      continue;
    }
    for (const delivery of deliveries) {
      const record = recordForOutput(db, studioId, row, delivery, review);
      if (record) records.push(record);
      else issues.push({ path: '$', code: 'invalid_value', message: 'Stored provenance inputs do not satisfy the canonical contract.' });
    }
  }
  const retention = Object.fromEntries(RETENTION_CATEGORIES.map((category) => [category, evaluateRetention(category, policy, { recordedAt: records[0]?.record.createdAt, now: now.toISOString() })])) as Record<RetentionCategory, RetentionDecision>;
  return { assetId, records, issues, retention };
}

function parseRetentionJson(value: string): Readonly<Record<RetentionCategory, RetentionDecision>> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Stored provenance retention is invalid.');
  return parsed as Record<RetentionCategory, RetentionDecision>;
}

function studioIdForAsset(db: StudioDatabase, assetId: string): string {
  const row = db.prepare('SELECT studio_id FROM assets WHERE id = ?').get(assetId) as { studio_id: string } | undefined;
  if (!row) throw new StudioNotFoundError('Studio asset not found: ' + assetId);
  return row.studio_id;
}

export function persistStudioProvenance(db: StudioDatabase, result: StudioProvenanceResult, now = new Date()): PersistedStudioProvenanceResult {
  const studioId = studioIdForAsset(db, result.assetId);
  const persistedAt = now.toISOString();
  const retentionJson = JSON.stringify(result.retention);
  const records = withTransaction(db, () => result.records.map((entry) => {
    db.prepare('INSERT INTO provenance_records (id, studio_id, asset_id, delivery_id, canonical_json, retention_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET asset_id = excluded.asset_id, delivery_id = excluded.delivery_id, canonical_json = excluded.canonical_json, retention_json = excluded.retention_json, updated_at = excluded.updated_at WHERE provenance_records.studio_id = excluded.studio_id').run(entry.record.recordId, studioId, entry.assetId, entry.deliveryId, entry.canonicalJson, retentionJson, persistedAt, persistedAt);
    const row = db.prepare('SELECT created_at, updated_at FROM provenance_records WHERE id = ? AND studio_id = ?').get(entry.record.recordId, studioId) as { created_at: string; updated_at: string } | undefined;
    if (!row) throw new StudioNotFoundError('Studio provenance record not found: ' + entry.record.recordId);
    return { recordId: entry.record.recordId, assetId: entry.assetId, deliveryId: entry.deliveryId, persistedAt: row.updated_at, createdAt: row.created_at, updatedAt: row.updated_at };
  }));
  return { assetId: result.assetId, records, issues: result.issues, retention: result.retention };
}

export function getPersistedStudioProvenance(db: StudioDatabase, studioId: string, recordId: string): StoredStudioProvenanceRecord {
  const row = db.prepare('SELECT id, asset_id, delivery_id, canonical_json, retention_json, created_at, updated_at FROM provenance_records WHERE id = ? AND studio_id = ?').get(recordId, studioId) as { id: string; asset_id: string; delivery_id: string; canonical_json: string; retention_json: string; created_at: string; updated_at: string } | undefined;
  if (!row) throw new StudioNotFoundError('Studio provenance record not found: ' + recordId);
  const canonical = buildCanonicalProvenance(JSON.parse(row.canonical_json));
  if (!canonical.ok) throw new Error('Stored provenance record is invalid.');
  return { record: canonical.record, canonicalJson: canonical.canonicalJson, retention: parseRetentionJson(row.retention_json), persistedAt: row.updated_at, assetId: row.asset_id, deliveryId: row.delivery_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

export const buildStudioProvenance = projectAssetProvenance;
