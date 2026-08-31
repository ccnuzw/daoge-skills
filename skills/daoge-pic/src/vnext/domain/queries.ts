import { StudioDatabase } from '../studio/database';
import { CreativeRound, CreativeTask, Project } from './studio-commands';
import { GenerationRun, GenerationRunItem } from '../runner/run-commands';

interface StoredProject { id: string; studio_id: string; name: string; description: string | null; status: Project['status']; version: number; }
interface StoredTask { id: string; project_id: string; task_type_id: string | null; name: string; intent_json: string; status: CreativeTask['status']; version: number; }
interface StoredRound { id: string; task_id: string; parent_round_id: string | null; purpose: CreativeRound['purpose']; plan_json: string; plan_version: number; status: CreativeRound['status']; version: number; }
interface StoredRun { id: string; round_id: string; status: GenerationRun['status']; provider_snapshot_json: string; plan_snapshot_json: string; version: number; created_at: string; updated_at: string; }
interface StoredRunItem { id: string; run_id: string; sequence: number; status: GenerationRunItem['status']; request_id: string; lease_token: string | null; lease_expires_at: string | null; attempts: number; retry_at: string | null; }

function parseObject(value: string): Record<string, unknown> {
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; }
}
function parsePlan(value: string): GenerationRun['planSnapshot'] {
  const plan = parseObject(value);
  return { operation: plan.operation === 'edit' ? 'edit' : 'generate', itemCount: Number(plan.itemCount), prompt: String(plan.prompt || ''), referenceAssetIds: Array.isArray(plan.referenceAssetIds) ? plan.referenceAssetIds.filter((id): id is string => typeof id === 'string') : [], maskAssetId: typeof plan.maskAssetId === 'string' ? plan.maskAssetId : undefined, output: parseObject(JSON.stringify(plan.output || {})) };
}
function project(row: StoredProject): Project { return { id: row.id, studioId: row.studio_id, name: row.name, description: row.description, status: row.status, version: row.version }; }
function task(row: StoredTask): CreativeTask { return { id: row.id, projectId: row.project_id, taskTypeId: row.task_type_id, name: row.name, intent: parseObject(row.intent_json), status: row.status, version: row.version }; }
function round(row: StoredRound): CreativeRound { return { id: row.id, taskId: row.task_id, parentRoundId: row.parent_round_id, purpose: row.purpose, plan: parseObject(row.plan_json), planVersion: row.plan_version, status: row.status, version: row.version }; }
function run(row: StoredRun): GenerationRun & { createdAt: string; updatedAt: string } { return { id: row.id, roundId: row.round_id, status: row.status, providerSnapshot: parseObject(row.provider_snapshot_json), planSnapshot: parsePlan(row.plan_snapshot_json), version: row.version, createdAt: row.created_at, updatedAt: row.updated_at }; }
function item(row: StoredRunItem): GenerationRunItem { return { id: row.id, runId: row.run_id, sequence: row.sequence, status: row.status, requestId: row.request_id, leaseToken: row.lease_token, leaseExpiresAt: row.lease_expires_at, attempts: row.attempts, retryAt: row.retry_at }; }

export function listProjects(db: StudioDatabase, studioId: string): Project[] { return (db.prepare('SELECT id, studio_id, name, description, status, version FROM projects WHERE studio_id = ? ORDER BY updated_at DESC').all(studioId) as unknown as StoredProject[]).map(project); }
export function listTasks(db: StudioDatabase, projectId: string): CreativeTask[] { return (db.prepare('SELECT id, project_id, task_type_id, name, intent_json, status, version FROM creative_tasks WHERE project_id = ? ORDER BY updated_at DESC').all(projectId) as unknown as StoredTask[]).map(task); }
export function listRounds(db: StudioDatabase, taskId: string): CreativeRound[] { return (db.prepare('SELECT id, task_id, parent_round_id, purpose, plan_json, plan_version, status, version FROM creative_rounds WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as unknown as StoredRound[]).map(round); }
export function listRuns(db: StudioDatabase, roundId: string): Array<GenerationRun & { createdAt: string; updatedAt: string }> { return (db.prepare('SELECT id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at FROM generation_runs WHERE round_id = ? ORDER BY created_at DESC').all(roundId) as unknown as StoredRun[]).map(run); }
export function listRunItemsForQuery(db: StudioDatabase, runId: string): GenerationRunItem[] { return (db.prepare('SELECT id, run_id, sequence, status, request_id, lease_token, lease_expires_at, attempts, retry_at FROM run_items WHERE run_id = ? ORDER BY sequence').all(runId) as unknown as StoredRunItem[]).map(item); }

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
