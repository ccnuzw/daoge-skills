import { createHash } from 'node:crypto';
import { StudioDatabase, withTransaction } from '../studio/database';
import { InvalidCommandError, StudioNotFoundError } from '../domain/studio-commands';
import { inspectProjectAssetAccess, projectAssetReferenceAllowed } from '../domain/asset-access';
import { buildCanonicalProvenance, evaluateRetention, RETENTION_CATEGORIES, RetentionCategory, RetentionDecision, RetentionPolicy, ProvenanceRecord, ValidationIssue } from './contract';
import { parseReviewContext } from '../domain/review-contract';
import { canonicalJsonHash } from '../shared/canonical-json';

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
  /** SHA-256 of `canonicalJson`. Together with `recordId` this is the
   * externally anchorable identity: unlike `recordId` alone it changes when
   * the content does, and unlike either alone it always resolves back to the
   * exact body that was anchored. */
  contentHash: string;
  /** How many distinct canonical bodies this recordId has had. 1 means the
   * record has never drifted. */
  versionCount: number;
  /** True when this persist call replaced an older body. */
  superseded: boolean;
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
  contentHash: string;
  versionCount: number;
  retention: Readonly<Record<RetentionCategory, RetentionDecision>>;
  persistedAt: string;
  assetId: string;
  deliveryId: string;
  createdAt: string;
  updatedAt: string;
}

/** A frozen historical body. Reading one always yields the content that was
 * written under this exact hash. */
export interface StoredStudioProvenanceVersion {
  recordId: string;
  assetId: string;
  deliveryId: string;
  contentHash: string;
  versionNo: number;
  canonicalJson: string;
  /** Same shape as `StoredStudioProvenanceRecord.record` so callers read
   * history and current with identical code. */
  record: ProvenanceRecord;
  retention: Readonly<Record<RetentionCategory, RetentionDecision>>;
  recordedAt: string;
  supersededAt: string | null;
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

function validateStoredCanonicalJson(value: string, expectedHash?: string | null): { canonicalJson: string; record: ProvenanceRecord; contentHash: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('Stored provenance record is invalid.');
  }
  const canonical = buildCanonicalProvenance(parsed);
  if (!canonical.ok) throw new Error('Stored provenance record is invalid.');
  if (value !== canonical.canonicalJson) throw new Error('Stored provenance canonical JSON is not canonical.');
  const contentHash = digest(canonical.canonicalJson);
  if (expectedHash && expectedHash !== contentHash) throw new Error('Stored provenance content hash does not match canonical JSON.');
  return { canonicalJson: canonical.canonicalJson, record: canonical.record, contentHash };
}

function digestJson(value: unknown): string {
  return canonicalJsonHash(value);
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

function validateProvenanceEntryScope(db: StudioDatabase, studioId: string, resultAssetId: string, entry: StudioProvenanceRecord): { record: ProvenanceRecord; canonicalJson: string; contentHash: string } {
  if (entry.assetId !== resultAssetId) throw new InvalidCommandError('Provenance entry asset does not match the result asset.');
  const canonical = validateStoredCanonicalJson(entry.canonicalJson);
  const entryRecord = buildCanonicalProvenance(entry.record);
  if (!entryRecord.ok || entryRecord.canonicalJson !== canonical.canonicalJson) throw new InvalidCommandError('Provenance entry record does not match its canonical JSON.');
  const scoped = db.prepare("SELECT 1 FROM assets asset JOIN asset_relations relation ON relation.asset_id = asset.id AND relation.relation_type = 'output_of' AND relation.target_type = 'run_item' JOIN run_items item ON item.id = relation.target_id JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id JOIN delivery_assets member ON member.asset_id = asset.id JOIN deliveries delivery ON delivery.id = member.delivery_id AND delivery.project_id = project.id WHERE asset.id = ? AND asset.studio_id = ? AND delivery.id = ? AND project.studio_id = ? AND project.id = ? AND task.id = ? AND round.id = ? AND run.id = ? AND item.id = ? AND item.sequence = ?").get(entry.assetId, studioId, entry.deliveryId, studioId, canonical.record.projectId, canonical.record.taskId, canonical.record.roundId, canonical.record.run.runId, canonical.record.run.itemId, canonical.record.run.itemSequence);
  if (!scoped) throw new InvalidCommandError('Provenance entry asset, delivery, or canonical body is outside the Studio lineage.');
  return canonical;
}

export function persistStudioProvenance(db: StudioDatabase, result: StudioProvenanceResult, now = new Date()): PersistedStudioProvenanceResult {
  const studioId = studioIdForAsset(db, result.assetId);
  const persistedAt = now.toISOString();
  const retentionJson = JSON.stringify(result.retention);
  const records = withTransaction(db, () => result.records.map((entry) => {
    const validated = validateProvenanceEntryScope(db, studioId, result.assetId, entry);
    const recordId = validated.record.recordId;
    const contentHash = validated.contentHash;
    const existing = db.prepare('SELECT asset_id, delivery_id, canonical_json, retention_json, content_hash, version_count, created_at, updated_at FROM provenance_records WHERE id = ? AND studio_id = ?').get(recordId, studioId) as { asset_id: string; delivery_id: string; canonical_json: string; retention_json: string; content_hash: string | null; version_count: number | null; created_at: string; updated_at: string } | undefined;
    let superseded = false;
    let versionCount = 1;
    if (existing) {
      const current = validateStoredCanonicalJson(existing.canonical_json, existing.content_hash);
      const history = db.prepare('SELECT content_hash, version_no FROM provenance_record_versions WHERE record_id = ? AND studio_id = ? ORDER BY version_no').all(recordId, studioId) as Array<{ content_hash: string; version_no: number }>;
      const historicalVersion = new Map(history.map((row) => [row.content_hash, Number(row.version_no)]));
      const currentVersionNo = historicalVersion.get(current.contentHash) || history.reduce((maximum, row) => Math.max(maximum, Number(row.version_no)), 0) + 1;
      const distinctCurrentBodies = new Set([...history.map((row) => row.content_hash), current.contentHash]).size;
      // Pre-v33 rows have a blank content_hash. Compare against a digest of
      // their canonical body first, otherwise their first unchanged persist is
      // incorrectly treated as drift and creates a bogus frozen version.
      if (current.contentHash === contentHash) {
        // Idempotent re-persist of the same body: nothing to freeze, and the
        // version count stays put. We still fall through to the upsert so
        // `updated_at` reflects the touch — the returned values must always
        // agree with what a later read would find.
        versionCount = distinctCurrentBodies;
      } else {
        // The body is changing. Freeze what is currently there first so an
        // anchor handed out earlier still resolves to exactly that content.
        db.prepare('INSERT OR IGNORE INTO provenance_record_versions (id, studio_id, record_id, asset_id, delivery_id, content_hash, canonical_json, retention_json, version_no, recorded_at, superseded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(recordId + '-v' + currentVersionNo, studioId, recordId, existing.asset_id, existing.delivery_id, current.contentHash, current.canonicalJson, existing.retention_json, currentVersionNo, existing.updated_at, persistedAt);
        superseded = true;
        versionCount = distinctCurrentBodies + (historicalVersion.has(contentHash) ? 0 : 1);
      }
    }
    db.prepare('INSERT INTO provenance_records (id, studio_id, asset_id, delivery_id, canonical_json, retention_json, content_hash, version_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET asset_id = excluded.asset_id, delivery_id = excluded.delivery_id, canonical_json = excluded.canonical_json, retention_json = excluded.retention_json, content_hash = excluded.content_hash, version_count = excluded.version_count, updated_at = excluded.updated_at WHERE provenance_records.studio_id = excluded.studio_id').run(recordId, studioId, entry.assetId, entry.deliveryId, validated.canonicalJson, retentionJson, contentHash, versionCount, persistedAt, persistedAt);
    const row = db.prepare('SELECT created_at, updated_at, version_count FROM provenance_records WHERE id = ? AND studio_id = ?').get(recordId, studioId) as { created_at: string; updated_at: string; version_count: number } | undefined;
    if (!row) throw new StudioNotFoundError('Studio provenance record not found: ' + recordId);
    return { recordId, assetId: entry.assetId, deliveryId: entry.deliveryId, persistedAt: row.updated_at, createdAt: row.created_at, updatedAt: row.updated_at, contentHash, versionCount: Number(row.version_count) || versionCount, superseded };
  }));
  return { assetId: result.assetId, records, issues: result.issues, retention: result.retention };
}

export function getPersistedStudioProvenance(db: StudioDatabase, studioId: string, recordId: string): StoredStudioProvenanceRecord {
  const row = db.prepare('SELECT id, asset_id, delivery_id, canonical_json, retention_json, content_hash, version_count, created_at, updated_at FROM provenance_records WHERE id = ? AND studio_id = ?').get(recordId, studioId) as { id: string; asset_id: string; delivery_id: string; canonical_json: string; retention_json: string; content_hash: string | null; version_count: number | null; created_at: string; updated_at: string } | undefined;
  if (!row) throw new StudioNotFoundError('Studio provenance record not found: ' + recordId);
  const canonical = validateStoredCanonicalJson(row.canonical_json, row.content_hash);
  return { record: canonical.record, canonicalJson: canonical.canonicalJson, contentHash: canonical.contentHash, versionCount: Number(row.version_count) || 1, retention: parseRetentionJson(row.retention_json), persistedAt: row.updated_at, assetId: row.asset_id, deliveryId: row.delivery_id, createdAt: row.created_at, updatedAt: row.updated_at };
}

/**
 * Resolves an external anchor `(recordId, contentHash)` back to the exact body
 * that was anchored. This is what makes a provenance anchor trustworthy even
 * though the current record under the same id may have moved on.
 */
export function getStudioProvenanceVersion(db: StudioDatabase, studioId: string, recordId: string, contentHash: string): StoredStudioProvenanceVersion {
  const current = db.prepare('SELECT content_hash, asset_id, delivery_id, canonical_json, retention_json, version_count, created_at, updated_at FROM provenance_records WHERE id = ? AND studio_id = ?').get(recordId, studioId) as { content_hash: string | null; asset_id: string; delivery_id: string; canonical_json: string; retention_json: string; version_count: number | null; created_at: string; updated_at: string } | undefined;
  if (current) {
    const canonical = validateStoredCanonicalJson(current.canonical_json, current.content_hash);
    if (canonical.contentHash === contentHash) {
      const historical = db.prepare('SELECT version_no FROM provenance_record_versions WHERE record_id = ? AND studio_id = ? AND content_hash = ?').get(recordId, studioId, contentHash) as { version_no: number } | undefined;
      return { recordId, assetId: current.asset_id, deliveryId: current.delivery_id, contentHash: canonical.contentHash, versionNo: historical ? Number(historical.version_no) : Number(current.version_count) || 1, canonicalJson: canonical.canonicalJson, record: canonical.record, retention: parseRetentionJson(current.retention_json), recordedAt: current.updated_at, supersededAt: null };
    }
  }
  const row = db.prepare('SELECT asset_id, delivery_id, content_hash, canonical_json, retention_json, version_no, recorded_at, superseded_at FROM provenance_record_versions WHERE record_id = ? AND studio_id = ? AND content_hash = ?').get(recordId, studioId, contentHash) as { asset_id: string; delivery_id: string; content_hash: string; canonical_json: string; retention_json: string; version_no: number; recorded_at: string; superseded_at: string | null } | undefined;
  if (!row) throw new StudioNotFoundError('Studio provenance record version not found: ' + recordId + '@' + contentHash.slice(0, 12));
  const canonical = validateStoredCanonicalJson(row.canonical_json, row.content_hash);
  return { recordId, assetId: row.asset_id, deliveryId: row.delivery_id, contentHash: canonical.contentHash, versionNo: Number(row.version_no), canonicalJson: canonical.canonicalJson, record: canonical.record, retention: parseRetentionJson(row.retention_json), recordedAt: row.recorded_at, supersededAt: row.superseded_at };
}

/** All frozen bodies ever recorded under a recordId, oldest first. */
export function listStudioProvenanceVersions(db: StudioDatabase, studioId: string, recordId: string): readonly StoredStudioProvenanceVersion[] {
  const rows = db.prepare('SELECT asset_id, delivery_id, content_hash, canonical_json, retention_json, version_no, recorded_at, superseded_at FROM provenance_record_versions WHERE record_id = ? AND studio_id = ? ORDER BY version_no').all(recordId, studioId) as Array<{ asset_id: string; delivery_id: string; content_hash: string; canonical_json: string; retention_json: string; version_no: number; recorded_at: string; superseded_at: string | null }>;
  return rows.map((row) => {
    const canonical = validateStoredCanonicalJson(row.canonical_json, row.content_hash);
    return { recordId, assetId: row.asset_id, deliveryId: row.delivery_id, contentHash: canonical.contentHash, versionNo: Number(row.version_no), canonicalJson: canonical.canonicalJson, record: canonical.record, retention: parseRetentionJson(row.retention_json), recordedAt: row.recorded_at, supersededAt: row.superseded_at };
  });
}

export const buildStudioProvenance = projectAssetProvenance;
