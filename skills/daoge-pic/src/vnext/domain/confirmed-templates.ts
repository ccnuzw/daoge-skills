import { createId, nowIso } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';
import { InvalidCommandError, StudioNotFoundError } from './studio-commands';
import { joinInStudioSql } from './studio-scope';

/** Template kinds that may be persisted from a confirmed creative round. */
export const CONFIRMED_TEMPLATE_TYPES = ['task_type', 'style_kit', 'brand_kit'] as const;
export type ConfirmedTemplateType = typeof CONFIRMED_TEMPLATE_TYPES[number];

export const CONFIRMED_TEMPLATE_STATUSES = ['active', 'archived'] as const;
export type ConfirmedTemplateStatus = typeof CONFIRMED_TEMPLATE_STATUSES[number];

/** Hard limits applied before any template JSON reaches SQLite. */
export const CONFIRMED_TEMPLATE_LIMITS = Object.freeze({
  maxTemplateIdLength: 128,
  maxNameLength: 120,
  maxDefinitionBytes: 64 * 1024,
  maxProvenanceBytes: 8 * 1024,
  maxStringLength: 2048,
  maxObjectKeys: 64,
  maxArrayItems: 64,
  maxDepth: 6,
  maxValueNodes: 512,
  maxVersion: 1_000_000
});

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SENSITIVE_KEY = /(?:api[_-]?key|authorization|secret|token|password|credential|cookie|capability|bearer|prompt|provider|request|response|raw|headers?|body|url|uri|endpoint|path|storage|file)/i;
// eslint-disable-next-line no-useless-escape -- 脱敏用的安全正则，逐个字符校对过；不为了 lint 去改它
const SENSITIVE_VALUE = /(?:\b[a-z][a-z0-9+.-]{1,31}:\/\/|\bwww\.[^\s<>"]+|\b(?:bearer|authorization|api[_ -]?key|secret|token|password|capability)\s*[:=]\s*[^\s,;<>"']+|\b(?:sk|pk|rk|dgpct1)[-_a-z0-9.]{8,}\b|(?:^|[\s(\"'=])(?:~\/|\.{1,2}\/|[A-Za-z]:[\\/]|\\\\|\/(?:Users|home|tmp|var|private|Volumes|opt|srv|mnt|media|workspace)(?:[\\/]|$))|\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[^\s]+|[\u0000-\u001f\u007f])/i;

export interface ConfirmedTemplateSource {
  roundId: string;
  taskId: string;
  projectId: string;
  planVersion: number;
}

export interface ConfirmedTemplateProvenance {
  kind: 'confirmed_round_plan';
  summary: string;
  confirmedAt: string | null;
  [key: string]: unknown;
}

export type ConfirmedTemplateProvenanceInput = string | Record<string, unknown>;

export interface ConfirmedTemplate {
  /** Immutable snapshot row id. */
  id: string;
  /** Stable logical id shared by all versions of one template. */
  templateId: string;
  studioId: string;
  templateType: ConfirmedTemplateType;
  version: number;
  status: ConfirmedTemplateStatus;
  name: string;
  definition: Record<string, unknown>;
  source: ConfirmedTemplateSource;
  provenance: ConfirmedTemplateProvenance;
  createdAt: string;
  archivedAt: string | null;
}

/** Input for the only operation that creates a persisted template snapshot. */
export interface SaveConfirmedTemplateInput {
  studioId: string;
  templateType: ConfirmedTemplateType;
  name: string;
  definition: unknown;
  /** One of roundId/sourceRoundId is required; task and project are derived. */
  roundId?: string;
  sourceRoundId?: string;
  /** Reuses this logical id and creates its next version; omitted creates/finds by safe name. */
  templateId?: string;
  provenance?: ConfirmedTemplateProvenanceInput;
  /** Optional optimistic assertion for the confirmed source plan. */
  planVersion?: number;
  sourcePlanVersion?: number;
}

export interface ListConfirmedTemplatesInput {
  studioId: string;
  templateType?: ConfirmedTemplateType;
  templateId?: string;
  /** Defaults to true so archived versions remain readable. */
  includeArchived?: boolean;
}

export interface GetConfirmedTemplateInput {
  studioId: string;
  templateId: string;
  /** Omit to read the active version, or the newest archived version if fully archived. */
  version?: number;
}

export interface ArchiveConfirmedTemplateInput {
  studioId: string;
  templateId: string;
}

export interface RollbackConfirmedTemplateInput {
  studioId: string;
  templateId: string;
  version: number;
}

type JsonObject = Record<string, unknown>;
type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

interface StoredConfirmedTemplate {
  id: string;
  studio_id: string;
  template_id: string;
  template_type: ConfirmedTemplateType;
  version: number;
  name: string;
  definition_json: string;
  source_round_id: string;
  source_task_id: string;
  source_project_id: string;
  source_plan_version: number;
  provenance_json: string;
  status: ConfirmedTemplateStatus;
  created_at: string;
  archived_at: string | null;
}

interface ConfirmedSourceRow {
  round_id: string;
  task_id: string;
  project_id: string;
  studio_id: string;
  round_status: string;
  plan_version: number;
  plan_json: string;
  plan_state: string;
  confirmed_at: string | null;
}

interface JsonNormalizationState {
  nodes: number;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new InvalidCommandError(message);
}

function requireSafeId(value: unknown, label: string): string {
  if (typeof value !== 'string') invalid(label + ' must be a safe identifier.');
  const text = value.trim();
  if (!SAFE_ID.test(text)) invalid(label + ' must be a safe identifier.');
  return text;
}

function requireStudio(db: StudioDatabase, studioId: unknown): string {
  const id = requireSafeId(studioId, 'studioId');
  if (!db.prepare('SELECT id FROM studios WHERE id = ?').get(id)) throw new StudioNotFoundError('Studio is not available.');
  return id;
}

function requireTemplateType(value: unknown): ConfirmedTemplateType {
  if (typeof value !== 'string' || !CONFIRMED_TEMPLATE_TYPES.includes(value as ConfirmedTemplateType)) invalid('templateType is not supported.');
  return value as ConfirmedTemplateType;
}

function requireVersion(value: unknown, label = 'version'): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > CONFIRMED_TEMPLATE_LIMITS.maxVersion) invalid(label + ' must be a positive integer within the supported limit.');
  return Number(value);
}

function safeName(value: unknown): string {
  if (typeof value !== 'string') invalid('Template name must be a string.');
  const name = value.trim();
  if (!name || name.length > CONFIRMED_TEMPLATE_LIMITS.maxNameLength || CONTROL_CHARACTERS.test(name) || SENSITIVE_VALUE.test(name)) invalid('Template name contains unsupported or sensitive content.');
  return name;
}

function normalizeJsonValue(value: unknown, label: string, depth: number, state: JsonNormalizationState, seen: WeakSet<object>, scanContent: boolean): JsonValue {
  state.nodes += 1;
  if (state.nodes > CONFIRMED_TEMPLATE_LIMITS.maxValueNodes) invalid(label + ' exceeds the value limit.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > CONFIRMED_TEMPLATE_LIMITS.maxStringLength || CONTROL_CHARACTERS.test(value) || (scanContent && SENSITIVE_VALUE.test(value))) invalid(label + ' contains unsupported or sensitive content.');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(label + ' contains a non-finite number.');
    return value;
  }
  if (typeof value !== 'object' || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') invalid(label + ' must contain JSON-compatible values.');
  if (depth >= CONFIRMED_TEMPLATE_LIMITS.maxDepth) invalid(label + ' exceeds the nesting limit.');
  if (seen.has(value)) invalid(label + ' cannot contain cyclic values.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > CONFIRMED_TEMPLATE_LIMITS.maxArrayItems) invalid(label + ' exceeds the array item limit.');
      return value.map((item, index) => normalizeJsonValue(item, label + '[' + index + ']', depth + 1, state, seen, scanContent));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid(label + ' must contain plain objects.');
    const keys = Object.keys(value);
    if (keys.length > CONFIRMED_TEMPLATE_LIMITS.maxObjectKeys) invalid(label + ' exceeds the field limit.');
    const output: JsonObject = {};
    const objectValue = value as JsonObject;
    for (const key of keys.sort()) {
      if (!key || key.length > 64 || CONTROL_CHARACTERS.test(key) || (scanContent && SENSITIVE_KEY.test(key))) invalid(label + ' contains an unsupported or sensitive field.');
      output[key] = normalizeJsonValue(objectValue[key], label + '.' + key, depth + 1, state, seen, scanContent);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

function normalizeSafeObject(value: unknown, label: string, maxBytes: number): { value: JsonObject; json: string } {
  return normalizeObject(value, label, maxBytes, true);
}

/**
 * Structural validation only, for values already stored by this runtime. Stored content passed the sensitive
 * scan when it was written, so re-running that scan on read cannot add safety -- it only turns rows written
 * under older rules into rows that abort an entire listing. Structural checks (shape, depth, size, control
 * characters) still run so real corruption is still rejected.
 */
function normalizeStoredObject(value: unknown, label: string, maxBytes: number): { value: JsonObject; json: string } {
  return normalizeObject(value, label, maxBytes, false);
}

function normalizeObject(value: unknown, label: string, maxBytes: number, scanContent: boolean): { value: JsonObject; json: string } {
  if (!isObject(value)) invalid(label + ' must be an object.');
  const normalized = normalizeJsonValue(value, label, 0, { nodes: 0 }, new WeakSet<object>(), scanContent);
  if (!isObject(normalized)) invalid(label + ' must be an object.');
  const json = JSON.stringify(normalized);
  if (Buffer.byteLength(json, 'utf8') > maxBytes) invalid(label + ' exceeds the size limit.');
  return { value: normalized, json };
}

function parseStoredObject(value: string, label: string, maxBytes: number): JsonObject {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { invalid(label + ' is not valid JSON.'); }
  return normalizeStoredObject(parsed, label, maxBytes).value;
}

/** Read path counterpart of `safeName`: structural limits only, no content scan. */
function safeStoredName(value: unknown): string {
  if (typeof value !== 'string') invalid('Stored template name must be a string.');
  const name = value.trim();
  if (!name || name.length > CONFIRMED_TEMPLATE_LIMITS.maxNameLength || CONTROL_CHARACTERS.test(name)) invalid('Stored template name contains unsupported content.');
  return name;
}

function normalizeProvenance(value: ConfirmedTemplateProvenanceInput | undefined, confirmedAt: string | null): { value: ConfirmedTemplateProvenance; json: string } {
  const candidate: unknown = value === undefined ? { summary: '来自已确认轮次计划的模板快照。' } : typeof value === 'string' ? { summary: value } : value;
  const normalized = normalizeSafeObject(candidate, 'Template provenance', CONFIRMED_TEMPLATE_LIMITS.maxProvenanceBytes).value;
  const summary = typeof normalized.summary === 'string' ? normalized.summary.trim() : '';
  if (!summary) invalid('Template provenance summary is required.');
  const provenance = { ...normalized, kind: 'confirmed_round_plan' as const, summary, confirmedAt };
  const json = JSON.stringify(provenance);
  if (Buffer.byteLength(json, 'utf8') > CONFIRMED_TEMPLATE_LIMITS.maxProvenanceBytes) invalid('Template provenance exceeds the size limit.');
  return { value: provenance, json };
}

function parsePlanObject(value: string): void {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { invalid('The confirmed plan snapshot is invalid.'); }
  if (!isObject(parsed)) invalid('The confirmed plan snapshot is invalid.');
}

function resolveConfirmedSource(db: StudioDatabase, studioId: string, roundIdValue: unknown): ConfirmedSourceRow {
  const roundId = requireSafeId(roundIdValue, 'roundId');
  const row = db.prepare(`SELECT round.id AS round_id, task.id AS task_id, project.id AS project_id, project.studio_id,
    round.status AS round_status, round.plan_version, round.plan_json,
    plan.state AS plan_state, plan.confirmed_at
    ${joinInStudioSql('creative_round', 'JOIN round_plan_versions plan ON plan.round_id = round.id AND plan.plan_version = round.plan_version')}
    WHERE round.id = ? AND project.studio_id = ?`).get(roundId, studioId) as ConfirmedSourceRow | undefined;
  if (!row) throw new StudioNotFoundError('Creative round is not available in this Studio.');
  if (row.round_status !== 'active' || row.plan_state !== 'confirmed' || !row.confirmed_at) invalid('A confirmed round and confirmed plan version are required.');
  requireSafeId(row.round_id, 'source round');
  requireSafeId(row.task_id, 'source task');
  requireSafeId(row.project_id, 'source project');
  requireVersion(row.plan_version, 'source plan version');
  parsePlanObject(row.plan_json);
  return row;
}

function assertTemplateOwnership(db: StudioDatabase, studioId: string, templateId: string): void {
  const foreign = db.prepare('SELECT 1 FROM confirmed_templates WHERE template_id = ? AND studio_id <> ? LIMIT 1').get(templateId, studioId);
  if (foreign) throw new StudioNotFoundError('Confirmed template is not available in this Studio.');
}

function rowToTemplate(row: StoredConfirmedTemplate): ConfirmedTemplate {
  const studioId = requireSafeId(row.studio_id, 'stored studio');
  const templateId = requireSafeId(row.template_id, 'stored template');
  const templateType = requireTemplateType(row.template_type);
  const version = requireVersion(row.version, 'stored version');
  const name = safeStoredName(row.name);
  const definition = parseStoredObject(row.definition_json, 'Stored template definition', CONFIRMED_TEMPLATE_LIMITS.maxDefinitionBytes);
  const source = {
    roundId: requireSafeId(row.source_round_id, 'stored source round'),
    taskId: requireSafeId(row.source_task_id, 'stored source task'),
    projectId: requireSafeId(row.source_project_id, 'stored source project'),
    planVersion: requireVersion(row.source_plan_version, 'stored source plan version')
  };
  if (row.status !== 'active' && row.status !== 'archived') invalid('Stored template status is invalid.');
  if (row.status === 'active' && row.archived_at !== null) invalid('Stored template status is invalid.');
  if (row.status === 'archived' && !row.archived_at) invalid('Stored template status is invalid.');
  const provenance = parseStoredObject(row.provenance_json, 'Stored template provenance', CONFIRMED_TEMPLATE_LIMITS.maxProvenanceBytes) as ConfirmedTemplateProvenance;
  if (provenance.kind !== 'confirmed_round_plan' || typeof provenance.summary !== 'string' || !provenance.summary.trim()) invalid('Stored template provenance is invalid.');
  return {
    id: requireSafeId(row.id, 'stored template snapshot'),
    templateId,
    studioId,
    templateType,
    version,
    status: row.status,
    name,
    definition,
    source,
    provenance,
    createdAt: row.created_at,
    archivedAt: row.archived_at
  };
}

function readTemplateRow(db: StudioDatabase, studioId: string, templateId: string, version?: number): ConfirmedTemplate | null {
  const row = version === undefined
    ? db.prepare('SELECT id, studio_id, template_id, template_type, version, name, definition_json, source_round_id, source_task_id, source_project_id, source_plan_version, provenance_json, status, created_at, archived_at FROM confirmed_templates WHERE studio_id = ? AND template_id = ? ORDER BY CASE WHEN status = \'active\' THEN 0 ELSE 1 END, version DESC LIMIT 1').get(studioId, templateId) as StoredConfirmedTemplate | undefined
    : db.prepare('SELECT id, studio_id, template_id, template_type, version, name, definition_json, source_round_id, source_task_id, source_project_id, source_plan_version, provenance_json, status, created_at, archived_at FROM confirmed_templates WHERE studio_id = ? AND template_id = ? AND version = ?').get(studioId, templateId, version) as StoredConfirmedTemplate | undefined;
  return row ? rowToTemplate(row) : null;
}

function resolveSaveRoundId(input: SaveConfirmedTemplateInput): string {
  if (input.roundId !== undefined && input.sourceRoundId !== undefined && String(input.roundId).trim() !== String(input.sourceRoundId).trim()) invalid('roundId and sourceRoundId must identify the same round.');
  return requireSafeId(input.roundId ?? input.sourceRoundId, 'roundId');
}

function resolveSavePlanVersion(input: SaveConfirmedTemplateInput, source: ConfirmedSourceRow): void {
  const requested = input.planVersion ?? input.sourcePlanVersion;
  if (requested === undefined) return;
  if (input.planVersion !== undefined && input.sourcePlanVersion !== undefined && input.planVersion !== input.sourcePlanVersion) invalid('planVersion and sourcePlanVersion must match.');
  if (requireVersion(requested, 'planVersion') !== Number(source.plan_version)) invalid('The requested plan version is not the current confirmed version.');
}

function findTemplateIdByName(db: StudioDatabase, studioId: string, templateType: ConfirmedTemplateType, name: string): string | null {
  const row = db.prepare('SELECT template_id FROM confirmed_templates WHERE studio_id = ? AND template_type = ? AND name = ? ORDER BY CASE WHEN status = \'active\' THEN 0 ELSE 1 END, version DESC LIMIT 1').get(studioId, templateType, name) as { template_id: string } | undefined;
  return row ? requireSafeId(row.template_id, 'stored template') : null;
}

/**
 * Explicitly snapshots caller-provided safe template content against the current
 * confirmed round plan. It never mutates a prior snapshot; each save is a new
 * version in the same logical template chain.
 */
export function saveConfirmedTemplate(db: StudioDatabase, input: SaveConfirmedTemplateInput): ConfirmedTemplate {
  return withTransaction(db, () => {
    const studioId = requireStudio(db, input.studioId);
    const templateType = requireTemplateType(input.templateType);
    const name = safeName(input.name);
    const roundId = resolveSaveRoundId(input);
    const source = resolveConfirmedSource(db, studioId, roundId);
    resolveSavePlanVersion(input, source);
    const definition = normalizeSafeObject(input.definition, 'Template definition', CONFIRMED_TEMPLATE_LIMITS.maxDefinitionBytes);
    let templateId = input.templateId === undefined ? findTemplateIdByName(db, studioId, templateType, name) : requireSafeId(input.templateId, 'templateId');
    if (!templateId) templateId = createId('ctemplate');
    assertTemplateOwnership(db, studioId, templateId);
    const previous = db.prepare('SELECT template_type, MAX(version) AS version FROM confirmed_templates WHERE studio_id = ? AND template_id = ? GROUP BY template_type').get(studioId, templateId) as { template_type: ConfirmedTemplateType; version: number | null } | undefined;
    if (previous && previous.template_type !== templateType) invalid('A template id cannot change template type.');
    const version = previous ? requireVersion(Number(previous.version) + 1, 'next template version') : 1;
    const timestamp = nowIso();
    const provenance = normalizeProvenance(input.provenance, source.confirmed_at);
    db.prepare("UPDATE confirmed_templates SET status = 'archived', archived_at = ? WHERE studio_id = ? AND template_id = ? AND status = 'active'").run(timestamp, studioId, templateId);
    const id = createId('ctemplate-version');
    db.prepare('INSERT INTO confirmed_templates (id, studio_id, template_id, template_type, version, name, definition_json, source_round_id, source_task_id, source_project_id, source_plan_version, provenance_json, status, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)').run(id, studioId, templateId, templateType, version, name, definition.json, source.round_id, source.task_id, source.project_id, source.plan_version, provenance.json, 'active', timestamp);
    appendStudioEvent(db, { studioId, entityType: 'confirmed_template', entityId: id, eventType: 'confirmed_template.saved', payload: { templateId, templateType, version, sourceRoundId: source.round_id } });
    const saved = readTemplateRow(db, studioId, templateId, version);
    if (!saved) throw new Error('Saved confirmed template snapshot could not be read back.');
    return saved;
  });
}

/** Lists immutable snapshots; archived versions are included by default. */
export function listConfirmedTemplates(db: StudioDatabase, studioId: string, options?: Omit<ListConfirmedTemplatesInput, 'studioId'>): ConfirmedTemplate[];
export function listConfirmedTemplates(db: StudioDatabase, input: ListConfirmedTemplatesInput): ConfirmedTemplate[];
export function listConfirmedTemplates(db: StudioDatabase, input: string | ListConfirmedTemplatesInput, options: Omit<ListConfirmedTemplatesInput, 'studioId'> = {}): ConfirmedTemplate[] {
  const query = typeof input === 'string' ? { studioId: input, ...options } : input;
  const studioId = requireStudio(db, query.studioId);
  const templateType = query.templateType === undefined ? undefined : requireTemplateType(query.templateType);
  const templateId = query.templateId === undefined ? undefined : requireSafeId(query.templateId, 'templateId');
  if (templateId) assertTemplateOwnership(db, studioId, templateId);
  if (query.includeArchived !== undefined && typeof query.includeArchived !== 'boolean') invalid('includeArchived must be a boolean.');
  const conditions = ['studio_id = ?'];
  const parameters: Array<string | number> = [studioId];
  if (templateType) { conditions.push('template_type = ?'); parameters.push(templateType); }
  if (templateId) { conditions.push('template_id = ?'); parameters.push(templateId); }
  if (query.includeArchived === false) conditions.push("status = 'active'");
  const rows = db.prepare('SELECT id, studio_id, template_id, template_type, version, name, definition_json, source_round_id, source_task_id, source_project_id, source_plan_version, provenance_json, status, created_at, archived_at FROM confirmed_templates WHERE ' + conditions.join(' AND ') + ' ORDER BY template_type, template_id, version DESC').all(...parameters) as unknown as StoredConfirmedTemplate[];
  return rows.map(rowToTemplate);
}

export function getConfirmedTemplate(db: StudioDatabase, studioId: string, templateId: string, version?: number): ConfirmedTemplate | null;
export function getConfirmedTemplate(db: StudioDatabase, input: GetConfirmedTemplateInput): ConfirmedTemplate | null;
export function getConfirmedTemplate(db: StudioDatabase, input: string | GetConfirmedTemplateInput, templateIdValue?: string, versionValue?: number): ConfirmedTemplate | null {
  const query = typeof input === 'string' ? { studioId: input, templateId: templateIdValue, version: versionValue } : input;
  const studioId = requireStudio(db, query.studioId);
  const templateId = requireSafeId(query.templateId, 'templateId');
  const version = query.version === undefined ? undefined : requireVersion(query.version);
  assertTemplateOwnership(db, studioId, templateId);
  return readTemplateRow(db, studioId, templateId, version);
}

/** Archives every version in one logical template chain without deleting snapshots. */
export function archiveConfirmedTemplate(db: StudioDatabase, input: ArchiveConfirmedTemplateInput): ConfirmedTemplate {
  return withTransaction(db, () => {
    const studioId = requireStudio(db, input.studioId);
    const templateId = requireSafeId(input.templateId, 'templateId');
    assertTemplateOwnership(db, studioId, templateId);
    const existing = db.prepare('SELECT 1 FROM confirmed_templates WHERE studio_id = ? AND template_id = ? LIMIT 1').get(studioId, templateId);
    if (!existing) throw new StudioNotFoundError('Confirmed template is not available in this Studio.');
    const timestamp = nowIso();
    db.prepare("UPDATE confirmed_templates SET status = 'archived', archived_at = COALESCE(archived_at, ?) WHERE studio_id = ? AND template_id = ? AND status = 'active'").run(timestamp, studioId, templateId);
    appendStudioEvent(db, { studioId, entityType: 'confirmed_template', entityId: templateId, eventType: 'confirmed_template.archived', payload: { templateId } });
    const archived = readTemplateRow(db, studioId, templateId);
    if (!archived) throw new Error('Archived confirmed template could not be read back.');
    return archived;
  });
}

/** Makes an existing immutable version active; no snapshot content is changed. */
export function rollbackConfirmedTemplate(db: StudioDatabase, input: RollbackConfirmedTemplateInput): ConfirmedTemplate {
  return withTransaction(db, () => {
    const studioId = requireStudio(db, input.studioId);
    const templateId = requireSafeId(input.templateId, 'templateId');
    const version = requireVersion(input.version);
    assertTemplateOwnership(db, studioId, templateId);
    const target = db.prepare('SELECT 1 FROM confirmed_templates WHERE studio_id = ? AND template_id = ? AND version = ?').get(studioId, templateId, version);
    if (!target) throw new StudioNotFoundError('Confirmed template version is not available in this Studio.');
    const timestamp = nowIso();
    db.prepare("UPDATE confirmed_templates SET status = 'archived', archived_at = COALESCE(archived_at, ?) WHERE studio_id = ? AND template_id = ? AND status = 'active'").run(timestamp, studioId, templateId);
    db.prepare("UPDATE confirmed_templates SET status = 'active', archived_at = NULL WHERE studio_id = ? AND template_id = ? AND version = ?").run(studioId, templateId, version);
    appendStudioEvent(db, { studioId, entityType: 'confirmed_template', entityId: templateId, eventType: 'confirmed_template.rolled_back', payload: { templateId, version } });
    const rolledBack = readTemplateRow(db, studioId, templateId, version);
    if (!rolledBack) throw new Error('Rolled-back confirmed template could not be read back.');
    return rolledBack;
  });
}
