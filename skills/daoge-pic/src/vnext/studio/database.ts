import fs from 'node:fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { nowIso } from '../shared/ids';
import { StudioManifest, StudioPaths } from './workspace';

export const STUDIO_SCHEMA_VERSION = 9;

const SCHEMA_V1 = [
  "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS studios (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS studio_sessions (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), conversation_id TEXT NOT NULL UNIQUE, active_project_id TEXT, active_task_id TEXT, active_round_id TEXT, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), name TEXT NOT NULL, description TEXT, status TEXT NOT NULL CHECK (status IN ('active', 'archived')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT)",
  "CREATE TABLE IF NOT EXISTS creative_tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), task_type_id TEXT, name TEXT NOT NULL, intent_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed', 'archived')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS creative_rounds (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES creative_tasks(id), parent_round_id TEXT REFERENCES creative_rounds(id), purpose TEXT NOT NULL CHECK (purpose IN ('exploration', 'refinement', 'variation', 'edit', 'fill')), plan_json TEXT NOT NULL DEFAULT '{}', plan_version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL CHECK (status IN ('draft', 'awaiting_confirmation', 'active', 'completed', 'archived')), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS generation_runs (id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES creative_rounds(id), status TEXT NOT NULL, provider_snapshot_json TEXT NOT NULL, plan_snapshot_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, worker_id TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS run_items (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES generation_runs(id), sequence INTEGER NOT NULL, status TEXT NOT NULL, prompt_payload_json TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE, external_request_id TEXT, lease_token TEXT, lease_expires_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, retry_at TEXT, error_json TEXT, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(run_id, sequence))",
  "CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), kind TEXT NOT NULL CHECK (kind IN ('import', 'generated', 'export')), media_type TEXT NOT NULL, storage_path TEXT NOT NULL UNIQUE, content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL, source_json TEXT NOT NULL DEFAULT '{}', deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(studio_id, content_hash))",
  "CREATE TABLE IF NOT EXISTS asset_relations (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), relation_type TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, UNIQUE(asset_id, relation_type, target_type, target_id))",
  "CREATE TABLE IF NOT EXISTS review_decisions (id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), task_id TEXT REFERENCES creative_tasks(id), round_id TEXT REFERENCES creative_rounds(id), decision TEXT NOT NULL CHECK (decision IN ('keep', 'review', 'reject', 'derive')), feedback_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, manifest_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'exported')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS task_types (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, definition_json TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('official', 'user')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS style_kits (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), name TEXT NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(studio_id, name))",
  "CREATE TABLE IF NOT EXISTS brand_kits (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), name TEXT NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(studio_id, name))",
  "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, studio_id TEXT NOT NULL REFERENCES studios(id), entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, event_type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_projects_studio_status ON projects(studio_id, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON creative_tasks(project_id, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_rounds_task_status ON creative_rounds(task_id, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_runs_round_status ON generation_runs(round_id, status, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_run_items_claim ON run_items(status, retry_at, lease_expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_assets_studio_created ON assets(studio_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_events_studio_id ON events(studio_id, id)"
].join(';\n') + ';';

const SCHEMA_V2 = "CREATE TABLE IF NOT EXISTS command_receipts (idempotency_key TEXT PRIMARY KEY, command_name TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL)";
const SCHEMA_V3 = "CREATE TABLE IF NOT EXISTS media_commit_journal (asset_id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), staged_path TEXT NOT NULL, final_storage_path TEXT NOT NULL, media_type TEXT NOT NULL, content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL, source_json TEXT NOT NULL, run_id TEXT NOT NULL REFERENCES generation_runs(id), run_item_id TEXT NOT NULL REFERENCES run_items(id), created_at TEXT NOT NULL)";
const SCHEMA_V4 = "ALTER TABLE command_receipts ADD COLUMN request_hash TEXT";
const SCHEMA_V5 = [
  "CREATE TABLE IF NOT EXISTS round_plan_versions (id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES creative_rounds(id), plan_version INTEGER NOT NULL, plan_json TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('draft', 'awaiting_confirmation', 'confirmed')), created_at TEXT NOT NULL, confirmed_at TEXT, UNIQUE(round_id, plan_version))",
  "INSERT OR IGNORE INTO round_plan_versions (id, round_id, plan_version, plan_json, state, created_at, confirmed_at) SELECT 'planver-' || id || '-' || plan_version, id, plan_version, plan_json, CASE WHEN status = 'active' THEN 'confirmed' WHEN status = 'awaiting_confirmation' THEN 'awaiting_confirmation' ELSE 'draft' END, updated_at, CASE WHEN status = 'active' THEN updated_at ELSE NULL END FROM creative_rounds",
  "CREATE TABLE IF NOT EXISTS dry_run_previews (id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES creative_rounds(id), plan_version INTEGER NOT NULL, provider_snapshot_json TEXT NOT NULL, plan_snapshot_json TEXT NOT NULL, item_count INTEGER NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS dry_run_items (id TEXT PRIMARY KEY, preview_id TEXT NOT NULL REFERENCES dry_run_previews(id), sequence INTEGER NOT NULL, prompt_payload_json TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(preview_id, sequence))",
  "CREATE VIRTUAL TABLE IF NOT EXISTS studio_search USING fts5(studio_id UNINDEXED, entity_type UNINDEXED, entity_id UNINDEXED, content)",
  "INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT studio_id, 'project', id, name || ' ' || COALESCE(description, '') FROM projects",
  "INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT p.studio_id, 'task', t.id, t.name || ' ' || t.intent_json FROM creative_tasks t JOIN projects p ON p.id = t.project_id",
  "INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT p.studio_id, 'round', r.id, r.plan_json FROM creative_rounds r JOIN creative_tasks t ON t.id = r.task_id JOIN projects p ON p.id = t.project_id"
].join(';\n') + ';';
const SCHEMA_V6 = "CREATE TABLE IF NOT EXISTS asset_media_operations (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), asset_id TEXT NOT NULL, operation TEXT NOT NULL CHECK (operation IN ('import', 'trash', 'restore')), source_path TEXT NOT NULL, target_path TEXT NOT NULL, asset_json TEXT, relation_json TEXT, created_at TEXT NOT NULL)";
const SCHEMA_V7 = "CREATE TABLE IF NOT EXISTS run_resume_confirmations (id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES generation_runs(id), session_id TEXT NOT NULL REFERENCES studio_sessions(id), confirmed_at TEXT NOT NULL, UNIQUE(run_id, session_id))";
const SCHEMA_V8 = "CREATE TABLE IF NOT EXISTS delivery_export_journal (idempotency_key TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id), studio_id TEXT NOT NULL REFERENCES studios(id), directory_path TEXT NOT NULL, manifest_json TEXT NOT NULL, files_json TEXT NOT NULL, created_at TEXT NOT NULL)";
const SCHEMA_V9 = [
  "CREATE TRIGGER IF NOT EXISTS studio_search_projects_ai AFTER INSERT ON projects BEGIN INSERT INTO studio_search (studio_id, entity_type, entity_id, content) VALUES (NEW.studio_id, 'project', NEW.id, NEW.name || ' ' || COALESCE(NEW.description, '')); END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_projects_au AFTER UPDATE OF name, description ON projects BEGIN DELETE FROM studio_search WHERE entity_type = 'project' AND entity_id = NEW.id; INSERT INTO studio_search (studio_id, entity_type, entity_id, content) VALUES (NEW.studio_id, 'project', NEW.id, NEW.name || ' ' || COALESCE(NEW.description, '')); END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_projects_ad AFTER DELETE ON projects BEGIN DELETE FROM studio_search WHERE entity_type = 'project' AND entity_id = OLD.id; END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_tasks_ai AFTER INSERT ON creative_tasks BEGIN INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT p.studio_id, 'task', NEW.id, NEW.name || ' ' || NEW.intent_json FROM projects p WHERE p.id = NEW.project_id; END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_tasks_au AFTER UPDATE OF name, intent_json ON creative_tasks BEGIN DELETE FROM studio_search WHERE entity_type = 'task' AND entity_id = NEW.id; INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT p.studio_id, 'task', NEW.id, NEW.name || ' ' || NEW.intent_json FROM projects p WHERE p.id = NEW.project_id; END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_tasks_ad AFTER DELETE ON creative_tasks BEGIN DELETE FROM studio_search WHERE entity_type = 'task' AND entity_id = OLD.id; END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_rounds_ai AFTER INSERT ON creative_rounds BEGIN INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT p.studio_id, 'round', NEW.id, NEW.plan_json FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = NEW.task_id; END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_rounds_au AFTER UPDATE OF plan_json ON creative_rounds BEGIN DELETE FROM studio_search WHERE entity_type = 'round' AND entity_id = NEW.id; INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT p.studio_id, 'round', NEW.id, NEW.plan_json FROM creative_tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = NEW.task_id; END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_rounds_ad AFTER DELETE ON creative_rounds BEGIN DELETE FROM studio_search WHERE entity_type = 'round' AND entity_id = OLD.id; END"
].join(';\n') + ';';

export type StudioDatabase = DatabaseSyncType;
type DatabaseSyncConstructor = new (path: string) => StudioDatabase;

export interface StudioEventInput {
  studioId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

function withoutSqliteExperimentalWarning<T>(operation: () => T): T {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = function suppressedSqliteWarning(warning: string | Error, ...args: unknown[]): boolean | void {
    const message = String(warning instanceof Error ? warning.message : warning);
    if (message.includes('SQLite is an experimental feature')) return false;
    return originalEmitWarning.call(process, warning as never, ...(args as never[]));
  };
  try {
    return operation();
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

function loadDatabaseSync(): DatabaseSyncConstructor {
  return withoutSqliteExperimentalWarning(() => require('node:sqlite').DatabaseSync as DatabaseSyncConstructor);
}

export function openStudioDatabase(paths: StudioPaths, manifest: StudioManifest): StudioDatabase {
  fs.mkdirSync(paths.studioDir, { recursive: true });
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(paths.databasePath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  migrateStudioDatabase(db);
  const timestamp = nowIso();
  db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace_root = excluded.workspace_root, schema_version = excluded.schema_version, updated_at = excluded.updated_at').run(manifest.studioId, paths.workspaceRoot, STUDIO_SCHEMA_VERSION, manifest.createdAt, timestamp);
  return db;
}

export function closeStudioDatabase(db: StudioDatabase | null | undefined): void {
  if (db) db.close();
}

export function migrateStudioDatabase(db: StudioDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const migrations = [
    { version: 1, sql: SCHEMA_V1 },
    { version: 2, sql: SCHEMA_V2 },
      { version: 3, sql: SCHEMA_V3 },
      { version: 4, sql: SCHEMA_V4 },
      { version: 5, sql: SCHEMA_V5 },
      { version: 6, sql: SCHEMA_V6 },
      { version: 7, sql: SCHEMA_V7 },
      { version: 8, sql: SCHEMA_V8 },
      { version: 9, sql: SCHEMA_V9 }
  ];
  for (const migration of migrations) {
    const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version) as { version: number } | undefined;
    if (existing) continue;
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, nowIso());
    });
  }
}

const transactionDepth = new WeakMap<object, number>();

export function withTransaction<T>(db: StudioDatabase, operation: () => T): T {
  const existingDepth = transactionDepth.get(db as unknown as object) || 0;
  if (existingDepth > 0) return operation();
  transactionDepth.set(db as unknown as object, 1);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    transactionDepth.delete(db as unknown as object);
  }
}

export function appendStudioEvent(db: StudioDatabase, input: StudioEventInput): number {
  const result = db.prepare('INSERT INTO events (studio_id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    input.studioId,
    input.entityType,
    input.entityId,
    input.eventType,
    JSON.stringify(input.payload || {}),
    nowIso()
  );
  return Number(result.lastInsertRowid);
}

export function studioSchemaVersion(db: StudioDatabase): number | null {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  return row.version;
}
