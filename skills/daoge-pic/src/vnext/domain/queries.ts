import { StudioDatabase } from '../studio/database';
import { CreativeRound, CreativeTask, Project, StudioNotFoundError } from './studio-commands';
import { GenerationRun } from '../runner/run-commands';
import { RunItemStatus } from './states';
import { SafeErrorDetail, safeErrorDetail, safeErrorSummary } from '../shared/safe-error';

interface StoredProject { id: string; studio_id: string; name: string; description: string | null; status: Project['status']; version: number; }
interface StoredTask { id: string; project_id: string; task_type_id: string | null; name: string; intent_json: string; status: CreativeTask['status']; version: number; }
interface StoredRound { id: string; task_id: string; parent_round_id: string | null; purpose: CreativeRound['purpose']; plan_json: string; plan_version: number; status: CreativeRound['status']; version: number; }
interface StoredRun { id: string; round_id: string; status: GenerationRun['status']; provider_snapshot_json: string; plan_snapshot_json: string; execution_concurrency: number; concurrency_source: 'default' | 'explicit' | 'serial'; version: number; plan_version: number; created_at: string; updated_at: string; }
interface StoredRunItem { id: string; run_id: string; sequence: number; status: RunItemStatus; attempts: number; retry_at: string | null; error_json: string | null; result_json: string | null; }

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
function item(row: StoredRunItem): PublicGenerationRunItem { return { id: row.id, runId: row.run_id, sequence: row.sequence, status: row.status, attempts: row.attempts, retryAt: row.retry_at, error: safeRunItemError(row.error_json), result: safeRunItemResult(row.result_json) }; }

function requireScopedEntity(db: StudioDatabase, sql: string, id: string, studioId: string, label: string): void {
  if (!db.prepare(sql).get(id, studioId)) throw new StudioNotFoundError(label + ' not found: ' + id);
}

function requireProjectInStudio(db: StudioDatabase, studioId: string, projectId: string): void { requireScopedEntity(db, 'SELECT id FROM projects WHERE id = ? AND studio_id = ?', projectId, studioId, 'Project'); }
function requireTaskInStudio(db: StudioDatabase, studioId: string, taskId: string): void { requireScopedEntity(db, 'SELECT task.id FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = ? AND project.studio_id = ?', taskId, studioId, 'Creative task'); }
function requireRoundInStudio(db: StudioDatabase, studioId: string, roundId: string): void { requireScopedEntity(db, 'SELECT round.id FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.id = ? AND project.studio_id = ?', roundId, studioId, 'Creative round'); }
function requireRunInStudio(db: StudioDatabase, studioId: string, runId: string): void { requireScopedEntity(db, 'SELECT run.id FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.id = ? AND project.studio_id = ?', runId, studioId, 'Generation run'); }

export interface PublicRunItemResult { assetId?: string; mediaType?: string; byteSize?: number; }
export interface PublicGenerationRunItem { id: string; runId: string; sequence: number; status: RunItemStatus; attempts: number; retryAt: string | null; error: SafeErrorDetail | null; result: PublicRunItemResult | null; }
export interface PublicRunRequestSummary { operation: 'generate' | 'edit'; promptSummary: string; outputSpec: Record<string, unknown>; referenceCount: number; referenceLabels: string[]; }
export interface PublicRunPlanSnapshot { operation: 'generate' | 'edit'; itemCount: number; prompt: string; output: Record<string, unknown>; referenceCount: number; referenceLabels: string[]; }
export interface PublicGenerationRun { id: string; roundId: string; status: GenerationRun['status']; providerSnapshot: Record<string, unknown>; planSnapshot: PublicRunPlanSnapshot; requestSummary: PublicRunRequestSummary; executionConcurrency: number; concurrencySource: 'default' | 'explicit' | 'serial'; version: number; planVersion: number; createdAt: string; updatedAt: string; }

export function listProjects(db: StudioDatabase, studioId: string): Project[] { return (db.prepare('SELECT id, studio_id, name, description, status, version FROM projects WHERE studio_id = ? ORDER BY updated_at DESC').all(studioId) as unknown as StoredProject[]).map(project); }
export function listTasks(db: StudioDatabase, studioId: string, projectId: string): CreativeTask[] { requireProjectInStudio(db, studioId, projectId); return (db.prepare('SELECT task.id, task.project_id, task.task_type_id, task.name, task.intent_json, task.status, task.version FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.project_id = ? AND project.studio_id = ? ORDER BY task.updated_at DESC').all(projectId, studioId) as unknown as StoredTask[]).map(task); }
export function listRounds(db: StudioDatabase, studioId: string, taskId: string): CreativeRound[] { requireTaskInStudio(db, studioId, taskId); return (db.prepare('SELECT round.id, round.task_id, round.parent_round_id, round.purpose, round.plan_json, round.plan_version, round.status, round.version FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE round.task_id = ? AND project.studio_id = ? ORDER BY round.created_at DESC').all(taskId, studioId) as unknown as StoredRound[]).map(round); }
export function listRuns(db: StudioDatabase, studioId: string, roundId: string): PublicGenerationRun[] { requireRoundInStudio(db, studioId, roundId); return (db.prepare('SELECT run.id, run.round_id, run.status, run.provider_snapshot_json, run.plan_snapshot_json, run.execution_concurrency, run.concurrency_source, run.version, round.plan_version, run.created_at, run.updated_at FROM generation_runs run JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE run.round_id = ? AND project.studio_id = ? ORDER BY run.created_at DESC, run.id DESC').all(roundId, studioId) as unknown as StoredRun[]).map(run); }
export function listRunItemsForQuery(db: StudioDatabase, studioId: string, runId: string): PublicGenerationRunItem[] { requireRunInStudio(db, studioId, runId); return (db.prepare('SELECT item.id, item.run_id, item.sequence, item.status, item.attempts, item.retry_at, item.error_json, item.result_json FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE item.run_id = ? AND project.studio_id = ? ORDER BY item.sequence').all(runId, studioId) as unknown as StoredRunItem[]).map(item); }

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
