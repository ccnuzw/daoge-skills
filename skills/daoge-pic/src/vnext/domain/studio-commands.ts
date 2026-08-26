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

export function executeIdempotent<T>(db: StudioDatabase, idempotencyKey: string, commandName: string, operation: () => T, request: unknown = null): CommandReceipt<T> {
  requireValue(idempotencyKey, 'idempotencyKey');
  requireValue(commandName, 'commandName');
  const requestHash = sha256(canonicalJson(request));
  return withTransaction(db, () => {
    const existing = db.prepare('SELECT command_name, request_hash, response_json FROM command_receipts WHERE idempotency_key = ?').get(idempotencyKey) as { command_name: string; request_hash: string | null; response_json: string } | undefined;
    if (existing) {
      if (existing.command_name !== commandName || (existing.request_hash && existing.request_hash !== requestHash)) throw new VersionConflictError('Idempotency key was already used by a different command or request.');
      return { value: JSON.parse(existing.response_json) as T, replayed: true };
    }
    const value = operation();
    db.prepare('INSERT INTO command_receipts (idempotency_key, command_name, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)').run(idempotencyKey, commandName, requestHash, JSON.stringify(value), nowIso());
    return { value, replayed: false };
  });
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
    const task = db.prepare('SELECT t.id, t.project_id, p.studio_id FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?').get(taskId) as { id: string; project_id: string; studio_id: string } | undefined;
    if (!task || task.studio_id !== input.studioId || (projectId && projectId !== task.project_id)) throw new InvalidCommandError('Session task context is not part of this Studio project.');
    projectId = task.project_id;
  }
  if (roundId) {
    const round = db.prepare('SELECT r.id, r.task_id, t.project_id, p.studio_id FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(roundId) as { id: string; task_id: string; project_id: string; studio_id: string } | undefined;
    if (!round || round.studio_id !== input.studioId || (taskId && taskId !== round.task_id) || (projectId && projectId !== round.project_id)) throw new InvalidCommandError('Session round context is not part of this Studio task.');
    taskId = round.task_id;
    projectId = round.project_id;
  }
  if (projectId) {
    const project = db.prepare('SELECT id FROM projects WHERE id = ? AND studio_id = ?').get(projectId, input.studioId) as { id: string } | undefined;
    if (!project) throw new InvalidCommandError('Session project context is not part of this Studio.');
  }
  const timestamp = nowIso();
  db.prepare('UPDATE studio_sessions SET active_project_id = ?, active_task_id = ?, active_round_id = ?, version = version + 1, updated_at = ? WHERE id = ?').run(projectId, taskId, roundId, timestamp, session.id);
  appendStudioEvent(db, { studioId: input.studioId, entityType: 'studio_session', entityId: session.id, eventType: 'session.context_updated', payload: { projectId, taskId, roundId } });
  return { ...sessionFromRow(session), activeProjectId: projectId, activeTaskId: taskId, activeRoundId: roundId, version: session.version + 1 };
}

export function createProject(db: StudioDatabase, input: { studioId: string; name: string; description?: string; sessionId?: string; idempotencyKey: string }): CommandReceipt<Project> {
  return executeIdempotent(db, input.idempotencyKey, 'projects.create', () => {
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


export function archiveProject(db: StudioDatabase, input: { projectId: string; idempotencyKey: string }): CommandReceipt<Project> {
  return executeIdempotent(db, input.idempotencyKey, 'projects.archive', () => {
    const project = db.prepare('SELECT id, studio_id, name, description, status, version FROM projects WHERE id = ?').get(requireValue(input.projectId, 'projectId')) as StoredProject | undefined;
    if (!project) throw new StudioNotFoundError('Project not found: ' + input.projectId);
    if (project.status === 'archived') return projectFromRow(project);
    const activeRuns = db.prepare("SELECT COUNT(*) AS total FROM generation_runs r JOIN creative_rounds cr ON cr.id = r.round_id JOIN creative_tasks t ON t.id = cr.task_id WHERE t.project_id = ? AND r.status IN ('queued', 'running', 'pausing', 'interrupted', 'resume_pending')").get(project.id) as { total: number };
    if (activeRuns.total > 0) throw new InvalidCommandError('Pause or cancel unfinished generation runs before archiving this project.');
    const timestamp = nowIso();
    db.prepare("UPDATE creative_rounds SET status = 'archived', version = version + 1, updated_at = ? WHERE task_id IN (SELECT id FROM creative_tasks WHERE project_id = ?) AND status != 'archived'").run(timestamp, project.id);
    db.prepare("UPDATE creative_tasks SET status = 'archived', version = version + 1, updated_at = ? WHERE project_id = ? AND status != 'archived'").run(timestamp, project.id);
    db.prepare("UPDATE projects SET status = 'archived', archived_at = ?, version = version + 1, updated_at = ? WHERE id = ?").run(timestamp, timestamp, project.id);
    db.prepare('UPDATE studio_sessions SET active_project_id = NULL, active_task_id = NULL, active_round_id = NULL, version = version + 1, updated_at = ? WHERE studio_id = ? AND active_project_id = ?').run(timestamp, project.studio_id, project.id);
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'project', entityId: project.id, eventType: 'project.archived', payload: {} });
    return { ...projectFromRow(project), status: 'archived', version: project.version + 1 };
  }, input);
}

export function createTaskDraft(db: StudioDatabase, input: { projectId: string; name: string; taskTypeId?: string; intent?: Record<string, unknown>; sessionId?: string; idempotencyKey: string }): CommandReceipt<CreativeTask> {
  return executeIdempotent(db, input.idempotencyKey, 'tasks.create_draft', () => {
    const projectId = requireValue(input.projectId, 'projectId');
    const project = db.prepare('SELECT id, studio_id FROM projects WHERE id = ?').get(projectId) as { id: string; studio_id: string } | undefined;
    if (!project) throw new StudioNotFoundError('Project not found: ' + projectId);
    const projectState = db.prepare('SELECT status FROM projects WHERE id = ?').get(projectId) as { status: Project['status'] };
    if (projectState.status === 'archived') throw new InvalidCommandError('Cannot create a task in an archived project.');
    const id = createId('task');
    const name = requireValue(input.name, 'task name');
    const intent = input.intent || {};
    const timestamp = nowIso();
    db.prepare('INSERT INTO creative_tasks (id, project_id, task_type_id, name, intent_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, projectId, input.taskTypeId || null, name, JSON.stringify(intent), 'draft', timestamp, timestamp);
    updateStudioSessionContext(db, { studioId: project.studio_id, sessionId: input.sessionId, projectId, taskId: id });
    appendStudioEvent(db, { studioId: project.studio_id, entityType: 'creative_task', entityId: id, eventType: 'task.draft_created', payload: { projectId, name } });
    return { id, projectId, taskTypeId: input.taskTypeId || null, name, intent, status: 'draft', version: 1 };
  }, input);
}

export function createRoundDraft(db: StudioDatabase, input: { taskId: string; purpose: CreativeRound['purpose']; parentRoundId?: string; plan?: Record<string, unknown>; sessionId?: string; idempotencyKey: string }): CommandReceipt<CreativeRound> {
  return executeIdempotent(db, input.idempotencyKey, 'rounds.create_draft', () => {
    const taskId = requireValue(input.taskId, 'taskId');
    const task = db.prepare('SELECT t.id, t.project_id, p.studio_id FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?').get(taskId) as { id: string; project_id: string; studio_id: string } | undefined;
    if (!task) throw new StudioNotFoundError('Creative task not found: ' + taskId);
    const taskState = db.prepare('SELECT t.status AS task_status, p.status AS project_status FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?').get(taskId) as { task_status: CreativeTask['status']; project_status: Project['status'] };
    if (taskState.task_status === 'archived' || taskState.project_status === 'archived') throw new InvalidCommandError('Cannot create a round in archived creative context.');
    const allowedPurposes: CreativeRound['purpose'][] = ['exploration', 'refinement', 'variation', 'edit', 'fill'];
    if (!allowedPurposes.includes(input.purpose)) throw new InvalidCommandError('Unsupported round purpose.');
    const id = createId('round');
    const plan = input.plan || {};
    const timestamp = nowIso();
    db.prepare('INSERT INTO creative_rounds (id, task_id, parent_round_id, purpose, plan_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, taskId, input.parentRoundId || null, input.purpose, JSON.stringify(plan), 'draft', timestamp, timestamp);
    db.prepare('INSERT INTO round_plan_versions (id, round_id, plan_version, plan_json, state, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(createId('planver'), id, 1, JSON.stringify(plan), 'draft', timestamp);
    updateStudioSessionContext(db, { studioId: task.studio_id, sessionId: input.sessionId, projectId: task.project_id, taskId, roundId: id });
    appendStudioEvent(db, { studioId: task.studio_id, entityType: 'creative_round', entityId: id, eventType: 'round.draft_created', payload: { taskId, purpose: input.purpose } });
    return { id, taskId, parentRoundId: input.parentRoundId || null, purpose: input.purpose, plan, planVersion: 1, status: 'draft', version: 1 };
  }, input);
}

export function prepareRoundForConfirmation(db: StudioDatabase, input: { roundId: string; plan: Record<string, unknown>; expectedVersion: number; idempotencyKey: string }): CommandReceipt<CreativeRound> {
  return executeIdempotent(db, input.idempotencyKey, 'rounds.prepare_confirmation', () => {
    const row = db.prepare('SELECT r.id, r.task_id, r.parent_round_id, r.purpose, r.plan_json, r.plan_version, r.status, r.version, p.studio_id FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(requireValue(input.roundId, 'roundId')) as (StoredRound & { studio_id: string }) | undefined;
    if (!row) throw new StudioNotFoundError('Creative round not found: ' + input.roundId);
    assertVersion(row.version, input.expectedVersion);
    if (row.status !== 'draft' && row.status !== 'awaiting_confirmation') throw new InvalidCommandError('Only draft rounds can be prepared for confirmation.');
    const timestamp = nowIso();
    db.prepare('UPDATE creative_rounds SET plan_json = ?, plan_version = plan_version + 1, status = ?, version = version + 1, updated_at = ? WHERE id = ?').run(JSON.stringify(input.plan), 'awaiting_confirmation', timestamp, row.id);
    db.prepare('INSERT INTO round_plan_versions (id, round_id, plan_version, plan_json, state, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(createId('planver'), row.id, row.plan_version + 1, JSON.stringify(input.plan), 'awaiting_confirmation', timestamp);
    appendStudioEvent(db, { studioId: row.studio_id, entityType: 'creative_round', entityId: row.id, eventType: 'round.awaiting_confirmation', payload: { planVersion: row.plan_version + 1 } });
    return { id: row.id, taskId: row.task_id, parentRoundId: row.parent_round_id, purpose: row.purpose, plan: input.plan, planVersion: row.plan_version + 1, status: 'awaiting_confirmation', version: row.version + 1 };
  }, input);
}

export function confirmRoundPlan(db: StudioDatabase, input: { roundId: string; expectedVersion: number; idempotencyKey: string }): CommandReceipt<CreativeRound> {
  return executeIdempotent(db, input.idempotencyKey, 'rounds.confirm_plan', () => {
    const row = db.prepare('SELECT r.id, r.task_id, r.parent_round_id, r.purpose, r.plan_json, r.plan_version, r.status, r.version, p.studio_id FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id WHERE r.id = ?').get(requireValue(input.roundId, 'roundId')) as (StoredRound & { studio_id: string }) | undefined;
    if (!row) throw new StudioNotFoundError('Creative round not found: ' + input.roundId);
    assertVersion(row.version, input.expectedVersion);
    if (row.status !== 'awaiting_confirmation') throw new InvalidCommandError('A round must be awaiting confirmation before it can be confirmed.');
    const timestamp = nowIso();
    db.prepare('UPDATE creative_rounds SET status = ?, version = version + 1, updated_at = ? WHERE id = ?').run('active', timestamp, row.id);
    db.prepare("UPDATE round_plan_versions SET state = 'confirmed', confirmed_at = ? WHERE round_id = ? AND plan_version = ?").run(timestamp, row.id, row.plan_version);
    appendStudioEvent(db, { studioId: row.studio_id, entityType: 'creative_round', entityId: row.id, eventType: 'round.confirmed', payload: { planVersion: row.plan_version } });
    return { id: row.id, taskId: row.task_id, parentRoundId: row.parent_round_id, purpose: row.purpose, plan: parseObject(row.plan_json), planVersion: row.plan_version, status: 'active', version: row.version + 1 };
  }, input);
}

export function getProject(db: StudioDatabase, projectId: string): Project | null {
  const row = db.prepare('SELECT id, studio_id, name, description, status, version FROM projects WHERE id = ?').get(projectId) as StoredProject | undefined;
  return row ? projectFromRow(row) : null;
}

export function getTask(db: StudioDatabase, taskId: string): CreativeTask | null {
  const row = db.prepare('SELECT id, project_id, task_type_id, name, intent_json, status, version FROM creative_tasks WHERE id = ?').get(taskId) as StoredTask | undefined;
  return row ? taskFromRow(row) : null;
}

export function getRound(db: StudioDatabase, roundId: string): CreativeRound | null {
  const row = db.prepare('SELECT id, task_id, parent_round_id, purpose, plan_json, plan_version, status, version FROM creative_rounds WHERE id = ?').get(roundId) as StoredRound | undefined;
  return row ? roundFromRow(row) : null;
}

export interface RoundPlanVersion { id: string; roundId: string; planVersion: number; plan: Record<string, unknown>; state: 'draft' | 'awaiting_confirmation' | 'confirmed'; createdAt: string; confirmedAt: string | null; }

export function listRoundPlanVersions(db: StudioDatabase, roundId: string): RoundPlanVersion[] {
  return (db.prepare('SELECT id, round_id, plan_version, plan_json, state, created_at, confirmed_at FROM round_plan_versions WHERE round_id = ? ORDER BY plan_version DESC').all(requireValue(roundId, 'roundId')) as Array<{ id: string; round_id: string; plan_version: number; plan_json: string; state: RoundPlanVersion['state']; created_at: string; confirmed_at: string | null }>).map((row) => ({ id: row.id, roundId: row.round_id, planVersion: row.plan_version, plan: parseObject(row.plan_json), state: row.state, createdAt: row.created_at, confirmedAt: row.confirmed_at }));
}
