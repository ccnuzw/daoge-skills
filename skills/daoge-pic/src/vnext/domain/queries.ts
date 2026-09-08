import { StudioDatabase } from '../studio/database';
import { CreativeRound, CreativeTask, InvalidCommandError, Project, StudioNotFoundError } from './studio-commands';
import { GenerationRun } from '../runner/run-commands';
import { RUN_ITEM_STATUSES, RunItemStatus } from './states';
import { SafeErrorDetail, safeErrorDetail, safeErrorSummary } from '../shared/safe-error';

interface StoredProject { id: string; studio_id: string; name: string; description: string | null; status: Project['status']; version: number; }
interface StoredTask { id: string; project_id: string; task_type_id: string | null; name: string; intent_json: string; status: CreativeTask['status']; version: number; }
interface StoredRound { id: string; task_id: string; parent_round_id: string | null; purpose: CreativeRound['purpose']; plan_json: string; plan_version: number; status: CreativeRound['status']; version: number; }
interface StoredRun { id: string; round_id: string; status: GenerationRun['status']; provider_snapshot_json: string; plan_snapshot_json: string; execution_concurrency: number; concurrency_source: 'default' | 'explicit' | 'serial'; version: number; plan_version: number; created_at: string; updated_at: string; }
interface StoredRunItem { id: string; run_id: string; sequence: number; status: RunItemStatus; attempts: number; retry_at: string | null; error_json: string | null; result_json: string | null; updated_at: string; }

function parseObject(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
function controlledText(value: unknown): string {
  const safe = safeErrorSummary(typeof value === 'string' ? value : '') || '';
  return safe.replace(/(?:^|\s)(?:\.{0,2}\/|~\/|[A-Za-z]:\\)[^\s,;]+/g, ' [redacted-path]').slice(0, 320).trim();
}
function outputSpec(value: unknown): Record<string, unknown> {
  const output = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const safe: Record<string, unknown> = {};
  for (const key of ['aspectRatio', 'resolution', 'size', 'dimensions', 'width', 'height']) {
    const item = output[key];
    if (typeof item === 'string' || typeof item === 'number') safe[key] = item;
    else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const dimensions = item as Record<string, unknown>;
      safe[key] = Object.fromEntries(Object.entries(dimensions).filter(([dimension, value]) => ['width', 'height', 'unit'].includes(dimension) && (typeof value === 'string' || typeof value === 'number')));
    }
  }
  return safe;
}
export function publicRunRequestSummary(value: unknown): PublicRunRequestSummary {
  const plan = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const references = Array.isArray(plan.referenceAssetIds) ? plan.referenceAssetIds.filter((id) => typeof id === 'string') : [];
  const labels = Array.isArray(plan.referenceLabels) ? plan.referenceLabels.map(controlledText).filter(Boolean).slice(0, 12) : [];
  return { operation: plan.operation === 'edit' ? 'edit' : 'generate', promptSummary: controlledText(plan.prompt), outputSpec: outputSpec(plan.output), referenceCount: references.length, referenceLabels: labels };
}
export function publicRunPlanSnapshot(value: unknown): PublicRunPlanSnapshot {
  const plan = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const summary = publicRunRequestSummary(plan);
  return { operation: summary.operation, itemCount: Number.isInteger(plan.itemCount) ? Number(plan.itemCount) : 0, prompt: summary.promptSummary, output: summary.outputSpec, referenceCount: summary.referenceCount, referenceLabels: summary.referenceLabels };
}
function publicProviderSnapshot(value: string): Record<string, unknown> {
  const provider = parseObject(value);
  const safe: Record<string, unknown> = {};
  for (const key of ['profileId', 'profileName', 'providerId', 'model']) if (typeof provider[key] === 'string') safe[key] = provider[key];
  if (Number.isInteger(provider.configVersion)) safe.configVersion = Number(provider.configVersion);
  if (provider.capabilities && typeof provider.capabilities === 'object' && !Array.isArray(provider.capabilities)) safe.capabilities = Object.fromEntries(Object.entries(provider.capabilities as Record<string, unknown>).filter(([, item]) => typeof item === 'boolean'));
  return safe;
}
function project(row: StoredProject): Project { return { id: row.id, studioId: row.studio_id, name: row.name, description: row.description, status: row.status, version: row.version }; }
function task(row: StoredTask): CreativeTask { return { id: row.id, projectId: row.project_id, taskTypeId: row.task_type_id, name: row.name, intent: parseObject(row.intent_json), status: row.status, version: row.version }; }
function round(row: StoredRound): CreativeRound { return { id: row.id, taskId: row.task_id, parentRoundId: row.parent_round_id, purpose: row.purpose, plan: parseObject(row.plan_json), planVersion: row.plan_version, status: row.status, version: row.version }; }
function run(row: StoredRun): PublicGenerationRun { const rawPlan = parseObject(row.plan_snapshot_json); return { id: row.id, roundId: row.round_id, status: row.status, providerSnapshot: publicProviderSnapshot(row.provider_snapshot_json), planSnapshot: publicRunPlanSnapshot(rawPlan), requestSummary: publicRunRequestSummary(rawPlan), executionConcurrency: Number(row.execution_concurrency), concurrencySource: row.concurrency_source, version: row.version, planVersion: Number(row.plan_version), createdAt: row.created_at, updatedAt: row.updated_at }; }
function safeRunItemError(value: string | null): SafeErrorDetail | null { return safeErrorDetail(value ? parseObject(value) : {}); }
function safeRunItemResult(value: string | null): PublicRunItemResult | null {
  const parsed = value ? parseObject(value) : {};
  const assetId = typeof parsed.assetId === 'string' ? parsed.assetId : undefined;
  const mediaType = typeof parsed.mediaType === 'string' ? parsed.mediaType : undefined;
  const byteSize = typeof parsed.byteSize === 'number' && Number.isFinite(parsed.byteSize) ? parsed.byteSize : undefined;
  return assetId || mediaType || byteSize !== undefined ? { ...(assetId ? { assetId } : {}), ...(mediaType ? { mediaType } : {}), ...(byteSize !== undefined ? { byteSize } : {}) } : null;
}
function item(row: StoredRunItem): PublicGenerationRunItem { return { id: row.id, runId: row.run_id, sequence: row.sequence, status: row.status, attempts: row.attempts, retryAt: row.retry_at, error: safeRunItemError(row.error_json), result: safeRunItemResult(row.result_json), updatedAt: row.updated_at }; }

function requireScopedEntity(db: StudioDatabase, sql: string, id: string, studioId: string, label: string): void {
  if (!db.prepare(sql).get(id, studioId)) throw new StudioNotFoundError(label + ' not found: ' + id);
}

function requireProjectInStudio(db: StudioDatabase, studioId: string, projectId: string): void { requireScopedEntity(db, 'SELECT id FROM projects WHERE id = ? AND studio_id = ?', projectId, studioId, 'Project'); }
function requireTaskInStudio(db: StudioDatabase, studioId: string, taskId: string): void { requireScopedEntity(db, 'SELECT task.id FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND project.studio_id = ?', taskId, studioId, 'Creative task'); }
function requireRoundInStudio(db: StudioDatabase, studioId: string, roundId: string): void { requireScopedEntity(db, 'SELECT round.id FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.studio_id = ?', roundId, studioId, 'Creative round'); }
function requireRunInStudio(db: StudioDatabase, studioId: string, runId: string): void { requireScopedEntity(db, 'SELECT run.id FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.id = ? AND project.studio_id = ?', runId, studioId, 'Generation run'); }

export interface PublicRunItemResult { assetId?: string; mediaType?: string; byteSize?: number; }
export interface PublicRunItemOutputAsset { id: string; kind: 'import' | 'generated' | 'export'; mediaType: string; deletedAt: string | null; mediaState: string; }
export interface PublicGenerationRunItem { id: string; runId: string; sequence: number; status: RunItemStatus; attempts: number; retryAt: string | null; error: SafeErrorDetail | null; result: PublicRunItemResult | null; updatedAt: string; outputAssets?: PublicRunItemOutputAsset[]; }
export interface RunItemPageQuery { page?: unknown; pageSize?: unknown; statuses?: unknown[]; sequence?: unknown; }
export interface RunItemPage { items: PublicGenerationRunItem[]; page: number; pageSize: number; total: number; totalPages: number; allTotal: number; statusCounts: Record<RunItemStatus, number>; }
export interface PublicRunRequestSummary { operation: 'generate' | 'edit'; promptSummary: string; outputSpec: Record<string, unknown>; referenceCount: number; referenceLabels: string[]; }
export interface PublicRunPlanSnapshot { operation: 'generate' | 'edit'; itemCount: number; prompt: string; output: Record<string, unknown>; referenceCount: number; referenceLabels: string[]; }
export interface PublicGenerationRun { id: string; roundId: string; status: GenerationRun['status']; providerSnapshot: Record<string, unknown>; planSnapshot: PublicRunPlanSnapshot; requestSummary: PublicRunRequestSummary; executionConcurrency: number; concurrencySource: 'default' | 'explicit' | 'serial'; version: number; planVersion: number; createdAt: string; updatedAt: string; }

const RUN_ITEM_PAGE_SIZES = new Set([25, 50, 100]);

function positiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new InvalidCommandError(label + ' 必须是正整数。');
  return number;
}

function normalizeRunItemPageQuery(input: RunItemPageQuery): { page: number; pageSize: number; statuses: RunItemStatus[]; sequence: number | null } {
  const page = positiveInteger(input.page, 1, '运行项页码');
  const pageSize = positiveInteger(input.pageSize, 50, '运行项每页数量');
  if (!RUN_ITEM_PAGE_SIZES.has(pageSize)) throw new InvalidCommandError('运行项每页数量只支持 25、50 或 100。');
  const statuses = [...new Set((input.statuses || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (statuses.some((value) => !RUN_ITEM_STATUSES.includes(value as RunItemStatus))) throw new InvalidCommandError('运行项状态筛选包含未知状态。');
  const sequence = input.sequence === undefined || input.sequence === null || input.sequence === '' ? null : positiveInteger(input.sequence, 1, '运行项序号');
  return { page, pageSize, statuses: statuses as RunItemStatus[], sequence };
}

function publicOutputAsset(row: { id: string; kind: PublicRunItemOutputAsset['kind']; media_type: string; deleted_at: string | null; media_state: string | null }): PublicRunItemOutputAsset {
  return { id: row.id, kind: row.kind, mediaType: row.media_type, deletedAt: row.deleted_at, mediaState: row.media_state || 'available' };
}
function outputAssetsForRunItems(db: StudioDatabase, studioId: string, itemIds: string[]): Map<string, PublicRunItemOutputAsset[]> {
  const output = new Map<string, PublicRunItemOutputAsset[]>();
  if (!itemIds.length) return output;
  const placeholders = itemIds.map(() => '?').join(',');
  const rows = db.prepare("SELECT relation.target_id AS item_id, asset.id, asset.kind, asset.media_type, asset.deleted_at, asset.media_state FROM asset_relations relation JOIN assets asset ON asset.id = relation.asset_id AND asset.studio_id = ? WHERE relation.relation_type = 'output_of' AND relation.target_type = 'run_item' AND relation.target_id IN (" + placeholders + ') ORDER BY relation.target_id, asset.created_at, asset.id').all(studioId, ...itemIds) as Array<{ item_id: string; id: string; kind: PublicRunItemOutputAsset['kind']; media_type: string; deleted_at: string | null; media_state: string | null }>;
  for (const row of rows) {
    const current = output.get(row.item_id) || [];
    current.push(publicOutputAsset(row));
    output.set(row.item_id, current);
  }
  return output;
}
function resultFallbackAssets(db: StudioDatabase, studioId: string, items: PublicGenerationRunItem[], outputs: Map<string, PublicRunItemOutputAsset[]>): Map<string, PublicRunItemOutputAsset> {
  const assetIds = [...new Set(items.flatMap((item) => {
    const assetId = item.result?.assetId;
    if (!assetId || (outputs.get(item.id) || []).some((asset) => asset.id === assetId)) return [];
    return [assetId];
  }))];
  if (!assetIds.length) return new Map();
  const placeholders = assetIds.map(() => '?').join(',');
  const rows = db.prepare('SELECT id, kind, media_type, deleted_at, media_state FROM assets WHERE studio_id = ? AND id IN (' + placeholders + ')').all(studioId, ...assetIds) as Array<{ id: string; kind: PublicRunItemOutputAsset['kind']; media_type: string; deleted_at: string | null; media_state: string | null }>;
  return new Map(rows.map((row) => [row.id, publicOutputAsset(row)]));
}

export function listProjects(db: StudioDatabase, studioId: string): Project[] { return (db.prepare('SELECT id, studio_id, name, description, status, version FROM projects WHERE studio_id = ? ORDER BY updated_at DESC').all(studioId) as unknown as StoredProject[]).map(project); }
export function listTasks(db: StudioDatabase, studioId: string, projectId: string): CreativeTask[] { requireProjectInStudio(db, studioId, projectId); return (db.prepare('SELECT task.id, task.project_id, task.task_type_id, task.name, task.intent_json, task.status, task.version FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.project_id = ? AND project.studio_id = ? ORDER BY task.updated_at DESC').all(projectId, studioId) as unknown as StoredTask[]).map(task); }
export function listRounds(db: StudioDatabase, studioId: string, taskId: string): CreativeRound[] { requireTaskInStudio(db, studioId, taskId); return (db.prepare('SELECT round.id, round.task_id, round.parent_round_id, round.purpose, round.plan_json, round.plan_version, round.status, round.version FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.task_id = ? AND project.studio_id = ? ORDER BY round.created_at DESC').all(taskId, studioId) as unknown as StoredRound[]).map(round); }
export function listRuns(db: StudioDatabase, studioId: string, roundId: string): PublicGenerationRun[] { requireRoundInStudio(db, studioId, roundId); return (db.prepare('SELECT run.id, run.round_id, run.status, run.provider_snapshot_json, run.plan_snapshot_json, run.execution_concurrency, run.concurrency_source, run.version, round.plan_version, run.created_at, run.updated_at FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.round_id = ? AND project.studio_id = ? ORDER BY run.created_at DESC, run.id DESC').all(roundId, studioId) as unknown as StoredRun[]).map(run); }
export function getLatestRun(db: StudioDatabase, studioId: string, roundId: string): PublicGenerationRun | null {
  const row = db.prepare('SELECT run.id, run.round_id, run.status, run.provider_snapshot_json, run.plan_snapshot_json, run.execution_concurrency, run.concurrency_source, run.version, round.plan_version, run.created_at, run.updated_at FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.round_id = ? AND project.studio_id = ? ORDER BY run.created_at DESC, run.id DESC LIMIT 1').get(roundId, studioId) as StoredRun | undefined;
  return row ? run(row) : null;
}
export function listRunItemsForQuery(db: StudioDatabase, studioId: string, runId: string, input: RunItemPageQuery = {}): RunItemPage {
  requireRunInStudio(db, studioId, runId);
  const query = normalizeRunItemPageQuery(input);
  const statusCounts = Object.fromEntries(RUN_ITEM_STATUSES.map((status) => [status, 0])) as Record<RunItemStatus, number>;
  const countRows = db.prepare('SELECT status, COUNT(*) AS total FROM run_items WHERE run_id = ? GROUP BY status').all(runId) as Array<{ status: RunItemStatus; total: number }>;
  for (const row of countRows) if (RUN_ITEM_STATUSES.includes(row.status)) statusCounts[row.status] = Number(row.total);
  const allTotalRow = db.prepare('SELECT COUNT(*) AS total FROM run_items WHERE run_id = ?').get(runId) as { total: number } | undefined;
  const allTotal = Number(allTotalRow?.total || 0);
  const clauses = ['run_id = ?'];
  const parameters: Array<string | number> = [runId];
  if (query.statuses.length) {
    clauses.push('status IN (' + query.statuses.map(() => '?').join(',') + ')');
    parameters.push(...query.statuses);
  }
  if (query.sequence !== null) { clauses.push('sequence = ?'); parameters.push(query.sequence); }
  const where = clauses.join(' AND ');
  let total = allTotal;
  if (query.statuses.length || query.sequence !== null) {
    const totalRow = db.prepare('SELECT COUNT(*) AS total FROM run_items WHERE ' + where).get(...parameters);
    total = totalRow && typeof totalRow === 'object' && 'total' in totalRow ? Number(totalRow.total) : 0;
  }
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const rows = db.prepare('SELECT id, run_id, sequence, status, attempts, retry_at, error_json, result_json, updated_at FROM run_items WHERE ' + where + ' ORDER BY sequence LIMIT ? OFFSET ?').all(...parameters, query.pageSize, (page - 1) * query.pageSize) as unknown as StoredRunItem[];
  const publicItems = rows.map(item);
  const outputs = outputAssetsForRunItems(db, studioId, rows.map((row) => row.id));
  const fallbacks = resultFallbackAssets(db, studioId, publicItems, outputs);
  return { items: publicItems.map((row) => {
    const relatedAssets = outputs.get(row.id) || [];
    const fallback = row.result?.assetId ? fallbacks.get(row.result.assetId) : null;
    const outputAssets = fallback && !relatedAssets.some((asset) => asset.id === fallback.id) ? [...relatedAssets, fallback] : relatedAssets;
    return { ...row, outputAssets };
  }), page, pageSize: query.pageSize, total, totalPages, allTotal, statusCounts };
}

export interface StudioSearchResult { entityType: 'project' | 'task' | 'round'; entityId: string; label: string; projectId: string; taskId?: string; purpose?: string; status?: string; }

export function searchStudio(db: StudioDatabase, studioId: string, query: string, limit = 25): StudioSearchResult[] {
  const term = String(query || '').trim();
  if (!term) return [];
  const safeQuery = term.split(/\s+/).map((token) => token.replace(/[^\p{L}\p{N}_-]/gu, '')).filter(Boolean).map((token) => token + '*').join(' AND ');
  if (!safeQuery) return [];
  const boundedLimit = Math.min(50, Math.max(1, Number.isInteger(limit) ? limit : 25));
  const rows = db.prepare('WITH candidates AS (SELECT entity_type, entity_id, rank AS ordering FROM studio_search WHERE studio_id = ? AND studio_search MATCH ? ORDER BY rank LIMIT ?) SELECT candidate.ordering, \'project\' AS entity_type, project.id AS entity_id, project.name AS label, project.id AS project_id, NULL AS task_id, NULL AS purpose, project.status FROM candidates candidate JOIN projects project ON candidate.entity_type = \'project\' AND project.id = candidate.entity_id AND project.studio_id = ? UNION ALL SELECT candidate.ordering, \'task\' AS entity_type, task.id AS entity_id, task.name AS label, task.project_id, task.id AS task_id, NULL AS purpose, task.status FROM candidates candidate JOIN creative_tasks task ON candidate.entity_type = \'task\' AND task.id = candidate.entity_id JOIN projects project ON project.id = task.project_id AND project.studio_id = ? UNION ALL SELECT candidate.ordering, \'round\' AS entity_type, round.id AS entity_id, task.name || \' / \' || round.purpose AS label, task.project_id, round.task_id, round.purpose, round.status FROM candidates candidate JOIN creative_rounds round ON candidate.entity_type = \'round\' AND round.id = candidate.entity_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id AND project.studio_id = ? ORDER BY ordering').all(studioId, safeQuery, boundedLimit, studioId, studioId, studioId) as Array<{ entity_type: StudioSearchResult['entityType']; entity_id: string; label: string; project_id: string; task_id: string | null; purpose: string | null; status: string | null }>;
  return rows.map((row) => ({ entityType: row.entity_type, entityId: row.entity_id, label: row.label, projectId: row.project_id, ...(row.task_id ? { taskId: row.task_id } : {}), ...(row.purpose ? { purpose: row.purpose } : {}), ...(row.status ? { status: row.status } : {}) }));
}
