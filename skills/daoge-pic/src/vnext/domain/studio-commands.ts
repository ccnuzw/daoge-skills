import { createId, nowIso, sha256 } from '../shared/ids';
import { appendStudioEvent, StudioDatabase, withTransaction } from '../studio/database';

export class StudioNotFoundError extends Error {}
export class VersionConflictError extends Error {}
export class InvalidCommandError extends Error {}

export interface CommandReceipt<T> {
  value: T;
  replayed: boolean;
}

export interface StudioSession {
  id: string;
  studioId: string;
  conversationId: string;
  activeProjectId: string | null;
  activeTaskId: string | null;
  activeRoundId: string | null;
  version: number;
}

export interface Project {
  id: string;
  studioId: string;
  name: string;
  description: string | null;
  status: 'active' | 'archived';
  version: number;
}

export interface CreativeTask {
  id: string;
  projectId: string;
  taskTypeId: string | null;
  name: string;
  intent: Record<string, unknown>;
  status: 'draft' | 'active' | 'completed' | 'archived';
  version: number;
}

export interface CreativeRound {
  id: string;
  taskId: string;
  parentRoundId: string | null;
  purpose: 'exploration' | 'refinement' | 'variation' | 'edit' | 'fill';
  plan: Record<string, unknown>;
  planVersion: number;
  status: 'draft' | 'awaiting_confirmation' | 'active' | 'completed' | 'archived';
  version: number;
}

interface StoredSession {
  id: string;
  studio_id: string;
  conversation_id: string;
  active_project_id: string | null;
  active_task_id: string | null;
  active_round_id: string | null;
  version: number;
}

interface StoredProject {
  id: string;
  studio_id: string;
  name: string;
  description: string | null;
  status: Project['status'];
  version: number;
}

interface StoredTask {
  id: string;
  project_id: string;
  task_type_id: string | null;
  name: string;
  intent_json: string;
  status: CreativeTask['status'];
  version: number;
}

interface StoredRound {
  id: string;
  task_id: string;
  parent_round_id: string | null;
  purpose: CreativeRound['purpose'];
  plan_json: string;
  plan_version: number;
  status: CreativeRound['status'];
  version: number;
}

function requireValue(value: string, label: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) throw new InvalidCommandError(label + ' is required.');
  return trimmed;
}

function parseObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return {};
  return parsed as Record<string, unknown>;
}

function sessionFromRow(row: StoredSession): StudioSession {
  return {
    id: row.id,
    studioId: row.studio_id,
    conversationId: row.conversation_id,
    activeProjectId: row.active_project_id,
    activeTaskId: row.active_task_id,
    activeRoundId: row.active_round_id,
    version: row.version
  };
}

function projectFromRow(row: StoredProject): Project {
  return { id: row.id, studioId: row.studio_id, name: row.name, description: row.description, status: row.status, version: row.version };
}

function taskFromRow(row: StoredTask): CreativeTask {
  return { id: row.id, projectId: row.project_id, taskTypeId: row.task_type_id, name: row.name, intent: parseObject(row.intent_json), status: row.status, version: row.version };
}

function roundFromRow(row: StoredRound): CreativeRound {
  return { id: row.id, taskId: row.task_id, parentRoundId: row.parent_round_id, purpose: row.purpose, plan: parseObject(row.plan_json), planVersion: row.plan_version, status: row.status, version: row.version };
}

function ensureStudio(db: StudioDatabase, studioId: string): void {
  const row = db.prepare('SELECT id FROM studios WHERE id = ?').get(studioId) as { id: string } | undefined;
  if (!row) throw new StudioNotFoundError('Studio not found: ' + studioId);
}

function resolveProjectInStudio(db: StudioDatabase, studioId: string, projectId: string): StoredProject {
  const id = requireValue(projectId, 'projectId');
  const row = db.prepare('SELECT id, studio_id, name, description, status, version FROM projects WHERE id = ? AND studio_id = ?').get(id, requireValue(studioId, 'studioId')) as StoredProject | undefined;
  if (!row) throw new StudioNotFoundError('Project not found: ' + id);
  return row;
}

function resolveTaskInStudio(db: StudioDatabase, studioId: string, taskId: string): StoredTask & { studio_id: string; project_status: Project['status'] } {
  const id = requireValue(taskId, 'taskId');
  const row = db.prepare('SELECT t.id, t.project_id, t.task_type_id, t.name, t.intent_json, t.status, t.version, p.studio_id, p.status AS project_status FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.studio_id = ?').get(id, requireValue(studioId, 'studioId')) as (StoredTask & { studio_id: string; project_status: Project['status'] }) | undefined;
  if (!row) throw new StudioNotFoundError('Creative task not found: ' + id);
  return row;
}

function resolveRoundInStudio(db: StudioDatabase, studioId: string, roundId: string, label = 'Creative round'): StoredRound & { studio_id: string; project_id: string } {
  const id = requireValue(roundId, 'roundId');
  const row = db.prepare('SELECT r.id, r.task_id, r.parent_round_id, r.purpose, r.plan_json, r.plan_version, r.status, r.version, p.studio_id, p.id AS project_id FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ? AND p.studio_id = ?').get(id, requireValue(studioId, 'studioId')) as (StoredRound & { studio_id: string; project_id: string }) | undefined;
  if (!row) throw new StudioNotFoundError(label + ' not found: ' + id);
  return row;
}

function assertVersion(actual: number, expectedVersion: number): void {
  if (actual !== expectedVersion) {
    throw new VersionConflictError('Expected version ' + expectedVersion + ', received ' + actual + '.');
  }
}


function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value as Record<string, unknown>).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value === undefined ? null : value);
}

export function executeIdempotent<T>(db: StudioDatabase, studioId: string, idempotencyKey: string, commandName: string, operation: () => T, request: unknown = null): CommandReceipt<T> {
  const scopedStudioId = requireValue(studioId, 'studioId');
  requireValue(idempotencyKey, 'idempotencyKey');
  requireValue(commandName, 'commandName');
  ensureStudio(db, scopedStudioId);
  const requestHash = sha256(canonicalJson(request));
  return withTransaction(db, () => {
    const existing = db.prepare('SELECT command_name, request_hash, response_json FROM command_receipts WHERE studio_id = ? AND idempotency_key = ?').get(scopedStudioId, idempotencyKey) as { command_name: string; request_hash: string | null; response_json: string } | undefined;
    if (existing) {
      if (existing.command_name !== commandName || (existing.request_hash && existing.request_hash !== requestHash)) throw new VersionConflictError('Idempotency key was already used by a different command or request.');
      return { value: JSON.parse(existing.response_json) as T, replayed: true };
    }
    const value = operation();
    db.prepare('INSERT INTO command_receipts (studio_id, idempotency_key, command_name, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(scopedStudioId, idempotencyKey, commandName, requestHash, JSON.stringify(value), nowIso());
    return { value, replayed: false };
  });
}

const asyncIdempotentOperations = new WeakMap<object, Map<string, Promise<unknown>>>();

export async function executeIdempotentAsync<T>(db: StudioDatabase, studioId: string, idempotencyKey: string, commandName: string, operation: () => Promise<T>, request: unknown = null): Promise<CommandReceipt<T>> {
  const scopedStudioId = requireValue(studioId, 'studioId');
  const scopedKey = requireValue(idempotencyKey, 'idempotencyKey');
  requireValue(commandName, 'commandName');
  ensureStudio(db, scopedStudioId);
  const key = scopedStudioId + ':' + scopedKey;
  const operations = asyncIdempotentOperations.get(db as unknown as object) || new Map<string, Promise<unknown>>();
  asyncIdempotentOperations.set(db as unknown as object, operations);
  const pending = operations.get(key);
  if (pending) {
    await pending;
    return executeIdempotentAsync(db, scopedStudioId, scopedKey, commandName, operation, request);
  }
  const requestHash = sha256(canonicalJson(request));
  const run = (async (): Promise<CommandReceipt<T>> => {
    const existing = db.prepare('SELECT command_name, request_hash, response_json FROM command_receipts WHERE studio_id = ? AND idempotency_key = ?').get(scopedStudioId, scopedKey) as { command_name: string; request_hash: string | null; response_json: string } | undefined;
    if (existing) {
      if (existing.command_name !== commandName || (existing.request_hash && existing.request_hash !== requestHash)) throw new VersionConflictError('Idempotency key was already used by a different command or request.');
      return { value: JSON.parse(existing.response_json) as T, replayed: true };
    }
    const value = await operation();
    return withTransaction(db, () => {
      const raced = db.prepare('SELECT command_name, request_hash, response_json FROM command_receipts WHERE studio_id = ? AND idempotency_key = ?').get(scopedStudioId, scopedKey) as { command_name: string; request_hash: string | null; response_json: string } | undefined;
      if (raced) {
        if (raced.command_name !== commandName || (raced.request_hash && raced.request_hash !== requestHash)) throw new VersionConflictError('Idempotency key was already used by a different command or request.');
        return { value: JSON.parse(raced.response_json) as T, replayed: true };
      }
      db.prepare('INSERT INTO command_receipts (studio_id, idempotency_key, command_name, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(scopedStudioId, scopedKey, commandName, requestHash, JSON.stringify(value), nowIso());
      return { value, replayed: false };
    });
  })();
  operations.set(key, run);
  try {
    return await run;
  } finally {
    if (operations.get(key) === run) operations.delete(key);
  }
}

export function getStudioSession(db: StudioDatabase, input: { studioId: string; sessionId: string }): StudioSession {
  ensureStudio(db, input.studioId);
  const session = db.prepare('SELECT id, studio_id, conversation_id, active_project_id, active_task_id, active_round_id, version FROM studio_sessions WHERE id = ?').get(requireValue(input.sessionId, 'sessionId')) as StoredSession | undefined;
  if (!session || session.studio_id !== input.studioId) throw new StudioNotFoundError('Studio session not found: ' + input.sessionId);
  return sessionFromRow(session);
}

export function openOrAttachStudioSession(db: StudioDatabase, input: { studioId: string; conversationId: string }): StudioSession {
  const studioId = requireValue(input.studioId, 'studioId');
  const conversationId = requireValue(input.conversationId, 'conversationId');
  return withTransaction(db, () => {
    ensureStudio(db, studioId);
    const existing = db.prepare('SELECT id, studio_id, conversation_id, active_project_id, active_task_id, active_round_id, version FROM studio_sessions WHERE conversation_id = ?').get(conversationId) as StoredSession | undefined;
    if (existing) {
      if (existing.studio_id !== studioId) throw new InvalidCommandError('A conversation cannot attach to two Studios.');
      return sessionFromRow(existing);
    }
    const timestamp = nowIso();
    const id = createId('session');
    db.prepare('INSERT INTO studio_sessions (id, studio_id, conversation_id, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(id, studioId, conversationId, timestamp, timestamp);
    appendStudioEvent(db, { studioId, entityType: 'studio_session', entityId: id, eventType: 'session.attached', payload: { conversationId } });
    return { id, studioId, conversationId, activeProjectId: null, activeTaskId: null, activeRoundId: null, version: 1 };
  });
}


export function updateStudioSessionContext(db: StudioDatabase, input: { studioId: string; sessionId?: string; projectId?: string; taskId?: string; roundId?: string }): StudioSession | null {
  if (!input.sessionId) return null;
  const session = db.prepare('SELECT id, studio_id, conversation_id, active_project_id, active_task_id, active_round_id, version FROM studio_sessions WHERE id = ?').get(requireValue(input.sessionId, 'sessionId')) as StoredSession | undefined;
  if (!session || session.studio_id !== input.studioId) throw new StudioNotFoundError('Studio session not found: ' + input.sessionId);
  let projectId = input.projectId || null;
  let taskId = input.taskId || null;
  let roundId = input.roundId || null;
  if (taskId) {
    const task = resolveTaskInStudio(db, input.studioId, taskId);
    if (projectId && projectId !== task.project_id) throw new InvalidCommandError('Session task context is not part of the selected project.');
    projectId = task.project_id;
  }
  if (roundId) {
    const round = resolveRoundInStudio(db, input.studioId, roundId);
    if ((taskId && taskId !== round.task_id) || (projectId && projectId !== round.project_id)) throw new InvalidCommandError('Session round context is not part of the selected task.');
    taskId = round.task_id;
    projectId = round.project_id;
  }
  if (projectId) resolveProjectInStudio(db, input.studioId, projectId);
  const timestamp = nowIso();
  db.prepare('UPDATE studio_sessions SET active_project_id = ?, active_task_id = ?, active_round_id = ?, version = version + 1, updated_at = ? WHERE id = ?').run(projectId, taskId, roundId, timestamp, session.id);
  appendStudioEvent(db, { studioId: input.studioId, entityType: 'studio_session', entityId: session.id, eventType: 'session.context_updated', payload: { projectId, taskId, roundId } });
  return { ...sessionFromRow(session), activeProjectId: projectId, activeTaskId: taskId, activeRoundId: roundId, version: session.version + 1 };
}

export function createProject(db: StudioDatabase, input: { studioId: string; name: string; description?: string; sessionId?: string; idempotencyKey: string }): CommandReceipt<Project> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'projects.create', () => {
    const studioId = requireValue(input.studioId, 'studioId');
    const name = requireValue(input.name, 'project name');
    ensureStudio(db, studioId);
    const id = createId('project');
    const timestamp = nowIso();
    const description = input.description ? input.description.trim() : null;
    db.prepare('INSERT INTO projects (id, studio_id, name, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, studioId, name, description, 'active', timestamp, timestamp);
    updateStudioSessionContext(db, { studioId, sessionId: input.sessionId, projectId: id });
    appendStudioEvent(db, { studioId, entityType: 'project', entityId: id, eventType: 'project.created', payload: { name } });
    return { id, studioId, name, description, status: 'active', version: 1 };
  }, input);
}


export function archiveProject(db: StudioDatabase, input: { studioId: string; projectId: string; idempotencyKey: string }): CommandReceipt<Project> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'projects.archive', () => {
    const project = resolveProjectInStudio(db, input.studioId, input.projectId);
    if (project.status === 'archived') return projectFromRow(project);
    const activeRuns = db.prepare("SELECT COUNT(*) AS total FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id WHERE t.project_id = ? AND r.status IN ('queued', 'running', 'pausing', 'interrupted', 'resume_pending')").get(project.id) as { total: number };
    if (activeRuns.total > 0) throw new InvalidCommandError('Pause or cancel unfinished generation runs before archiving this project.');
    const timestamp = nowIso();
    db.prepare("UPDATE creative_rounds SET status = 'archived', version = version + 1, updated_at = ? WHERE task_id IN (SELECT id FROM creative_tasks WHERE project_id = ?) AND status != 'archived'").run(timestamp, project.id);
    db.prepare("UPDATE creative_tasks SET status = 'archived', version = version + 1, updated_at = ? WHERE project_id = ? AND status != 'archived'").run(timestamp, project.id);
    db.prepare("UPDATE projects SET status = 'archived', archived_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND studio_id = ?").run(timestamp, timestamp, project.id, input.studioId);
    db.prepare('UPDATE studio_sessions SET active_project_id = NULL, active_task_id = NULL, active_round_id = NULL, version = version + 1, updated_at = ? WHERE studio_id = ? AND active_project_id = ?').run(timestamp, input.studioId, project.id);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'project', entityId: project.id, eventType: 'project.archived', payload: {} });
    return { ...projectFromRow(project), status: 'archived', version: project.version + 1 };
  }, input);
}

export function createTaskDraft(db: StudioDatabase, input: { studioId: string; projectId: string; name: string; taskTypeId?: string; intent?: Record<string, unknown>; sessionId?: string; idempotencyKey: string }): CommandReceipt<CreativeTask> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'tasks.create_draft', () => {
    const project = resolveProjectInStudio(db, input.studioId, input.projectId);
    if (project.status === 'archived') throw new InvalidCommandError('Cannot create a task in an archived project.');
    const id = createId('task');
    const name = requireValue(input.name, 'task name');
    const taskTypeId = input.taskTypeId ? requireValue(input.taskTypeId, 'task type id') : null;
    if (taskTypeId && !db.prepare("SELECT id FROM task_types WHERE id = ? AND ((source = 'official' AND studio_id IS NULL) OR (source = 'user' AND studio_id = ?))").get(taskTypeId, input.studioId)) {
      throw new StudioNotFoundError('Task type not found: ' + taskTypeId);
    }
    const intent = input.intent || {};
    const timestamp = nowIso();
    db.prepare('INSERT INTO creative_tasks (id, project_id, task_type_id, name, intent_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, project.id, taskTypeId, name, JSON.stringify(intent), 'draft', timestamp, timestamp);
    updateStudioSessionContext(db, { studioId: input.studioId, sessionId: input.sessionId, projectId: project.id, taskId: id });
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'creative_task', entityId: id, eventType: 'task.draft_created', payload: { projectId: project.id, name } });
    return { id, projectId: project.id, taskTypeId, name, intent, status: 'draft', version: 1 };
  }, input);
}

export function createRoundDraft(db: StudioDatabase, input: { studioId: string; taskId: string; purpose: CreativeRound['purpose']; parentRoundId?: string; plan?: Record<string, unknown>; sessionId?: string; idempotencyKey: string }): CommandReceipt<CreativeRound> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'rounds.create_draft', () => {
    const task = resolveTaskInStudio(db, input.studioId, input.taskId);
    if (task.status === 'archived' || task.project_status === 'archived') throw new InvalidCommandError('Cannot create a round in archived creative context.');
    const allowedPurposes: CreativeRound['purpose'][] = ['exploration', 'refinement', 'variation', 'edit', 'fill'];
    if (!allowedPurposes.includes(input.purpose)) throw new InvalidCommandError('Unsupported round purpose.');
    if (input.parentRoundId) {
      const parent = resolveRoundInStudio(db, input.studioId, input.parentRoundId, 'Parent creative round');
      if (parent.task_id !== task.id) throw new InvalidCommandError('Parent creative round must belong to the same task.');
    }
    const id = createId('round');
    const plan = input.plan || {};
    const timestamp = nowIso();
    db.prepare('INSERT INTO creative_rounds (id, task_id, parent_round_id, purpose, plan_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, task.id, input.parentRoundId || null, input.purpose, JSON.stringify(plan), 'draft', timestamp, timestamp);
    db.prepare('INSERT INTO round_plan_versions (id, round_id, plan_version, plan_json, state, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(createId('planver'), id, 1, JSON.stringify(plan), 'draft', timestamp);
    updateStudioSessionContext(db, { studioId: input.studioId, sessionId: input.sessionId, projectId: task.project_id, taskId: task.id, roundId: id });
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'creative_round', entityId: id, eventType: 'round.draft_created', payload: { taskId: task.id, purpose: input.purpose } });
    return { id, taskId: task.id, parentRoundId: input.parentRoundId || null, purpose: input.purpose, plan, planVersion: 1, status: 'draft', version: 1 };
  }, input);
}

export function prepareRoundForConfirmation(db: StudioDatabase, input: { studioId: string; roundId: string; plan: Record<string, unknown>; expectedVersion: number; idempotencyKey: string }): CommandReceipt<CreativeRound> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'rounds.prepare_confirmation', () => {
    const row = resolveRoundInStudio(db, input.studioId, input.roundId);
    assertVersion(row.version, input.expectedVersion);
    if (row.status !== 'draft' && row.status !== 'awaiting_confirmation') throw new InvalidCommandError('Only draft rounds can be prepared for confirmation.');
    const timestamp = nowIso();
    db.prepare('UPDATE creative_rounds SET plan_json = ?, plan_version = plan_version + 1, status = ?, version = version + 1, updated_at = ? WHERE id = ?').run(JSON.stringify(input.plan), 'awaiting_confirmation', timestamp, row.id);
    db.prepare('INSERT INTO round_plan_versions (id, round_id, plan_version, plan_json, state, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(createId('planver'), row.id, row.plan_version + 1, JSON.stringify(input.plan), 'awaiting_confirmation', timestamp);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'creative_round', entityId: row.id, eventType: 'round.awaiting_confirmation', payload: { planVersion: row.plan_version + 1 } });
    return { id: row.id, taskId: row.task_id, parentRoundId: row.parent_round_id, purpose: row.purpose, plan: input.plan, planVersion: row.plan_version + 1, status: 'awaiting_confirmation', version: row.version + 1 };
  }, input);
}

export function confirmRoundPlan(db: StudioDatabase, input: { studioId: string; roundId: string; expectedVersion: number; idempotencyKey: string }): CommandReceipt<CreativeRound> {
  return executeIdempotent(db, input.studioId, input.idempotencyKey, 'rounds.confirm_plan', () => {
    const row = resolveRoundInStudio(db, input.studioId, input.roundId);
    assertVersion(row.version, input.expectedVersion);
    if (row.status !== 'awaiting_confirmation') throw new InvalidCommandError('A round must be awaiting confirmation before it can be confirmed.');
    const timestamp = nowIso();
    db.prepare('UPDATE creative_rounds SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run('active', timestamp, row.id);
    db.prepare("UPDATE round_plan_versions SET state = 'confirmed', confirmed_at = ? WHERE round_id = ? AND plan_version = ?").run(timestamp, row.id, row.plan_version);
    appendStudioEvent(db, { studioId: input.studioId, entityType: 'creative_round', entityId: row.id, eventType: 'round.confirmed', payload: { planVersion: row.plan_version } });
    return { id: row.id, taskId: row.task_id, parentRoundId: row.parent_round_id, purpose: row.purpose, plan: parseObject(row.plan_json), planVersion: row.plan_version, status: 'active', version: row.version + 1 };
  }, input);
}

export function getProject(db: StudioDatabase, studioId: string, projectId: string): Project | null {
  const row = db.prepare('SELECT id, studio_id, name, description, status, version FROM projects WHERE id = ? AND studio_id = ?').get(projectId, studioId) as StoredProject | undefined;
  return row ? projectFromRow(row) : null;
}

export function getTask(db: StudioDatabase, studioId: string, taskId: string): CreativeTask | null {
  const row = db.prepare('SELECT t.id, t.project_id, t.task_type_id, t.name, t.intent_json, t.status, t.version FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ? AND p.studio_id = ?').get(taskId, studioId) as StoredTask | undefined;
  return row ? taskFromRow(row) : null;
}

export function getRound(db: StudioDatabase, studioId: string, roundId: string): CreativeRound | null {
  const row = db.prepare('SELECT r.id, r.task_id, r.parent_round_id, r.purpose, r.plan_json, r.plan_version, r.status, r.version FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ? AND p.studio_id = ?').get(roundId, studioId) as StoredRound | undefined;
  return row ? roundFromRow(row) : null;
}

export interface RoundPlanVersion { id: string; roundId: string; planVersion: number; plan: Record<string, unknown>; state: 'draft' | 'awaiting_confirmation' | 'confirmed'; createdAt: string; confirmedAt: string | null; }

export function listRoundPlanVersions(db: StudioDatabase, studioId: string, roundId: string): RoundPlanVersion[] {
  resolveRoundInStudio(db, studioId, roundId);
  return (db.prepare('SELECT version.id, version.round_id, version.plan_version, version.plan_json, version.state, version.created_at, version.confirmed_at FROM round_plan_versions version JOIN creative_rounds round ON round.id = version.round_id JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE version.round_id = ? AND project.studio_id = ? ORDER BY version.plan_version DESC').all(requireValue(roundId, 'roundId'), requireValue(studioId, 'studioId')) as Array<{ id: string; round_id: string; plan_version: number; plan_json: string; state: RoundPlanVersion['state']; created_at: string; confirmed_at: string | null }>).map((row) => ({ id: row.id, roundId: row.round_id, planVersion: row.plan_version, plan: parseObject(row.plan_json), state: row.state, createdAt: row.created_at, confirmedAt: row.confirmed_at }));
}
