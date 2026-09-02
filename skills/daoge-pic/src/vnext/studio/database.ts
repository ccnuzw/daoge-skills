import fs from 'node:fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { nowIso } from '../shared/ids';
import { StudioManifest, StudioPaths } from './workspace';

export const STUDIO_SCHEMA_VERSION = 18;

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
const SCHEMA_V10 = [
  "CREATE TABLE IF NOT EXISTS delivery_assets (delivery_id TEXT NOT NULL REFERENCES deliveries(id), asset_id TEXT NOT NULL REFERENCES assets(id), sequence INTEGER NOT NULL, source_snapshot_json TEXT NOT NULL, review_snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (delivery_id, asset_id), UNIQUE (delivery_id, sequence))",
  "CREATE INDEX IF NOT EXISTS idx_delivery_assets_delivery_sequence ON delivery_assets(delivery_id, sequence)",
  "INSERT OR IGNORE INTO delivery_assets (delivery_id, asset_id, sequence, source_snapshot_json, review_snapshot_json, created_at) SELECT delivery.id, CAST(selected.value AS TEXT), CAST(selected.key AS INTEGER) + 1, COALESCE(asset.source_json, '{}'), COALESCE((SELECT json_object('id', review.id, 'decision', review.decision, 'feedback', review.feedback_json, 'taskId', review.task_id, 'roundId', review.round_id, 'createdAt', review.created_at) FROM review_decisions review WHERE review.asset_id = CAST(selected.value AS TEXT) ORDER BY review.created_at DESC, review.id DESC LIMIT 1), '{\"available\":false,\"reason\":\"legacy_unavailable\"}'), delivery.updated_at FROM deliveries delivery JOIN json_each(delivery.manifest_json, '$.assetIds') selected LEFT JOIN assets asset ON asset.id = CAST(selected.value AS TEXT)"
].join(';\n') + ';';
const SCHEMA_V11 = [
  "CREATE TABLE IF NOT EXISTS delivery_batches (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS delivery_batch_versions (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES delivery_batches(id), version_no INTEGER NOT NULL, predecessor_version_id TEXT REFERENCES delivery_batch_versions(id), status TEXT NOT NULL CHECK (status IN ('draft', 'ready', 'superseded')), manifest_json TEXT NOT NULL, created_at TEXT NOT NULL, prepared_at TEXT, superseded_at TEXT, UNIQUE(batch_id, version_no))",
  "CREATE TABLE IF NOT EXISTS delivery_batch_version_deliveries (version_id TEXT NOT NULL REFERENCES delivery_batch_versions(id), delivery_id TEXT NOT NULL REFERENCES deliveries(id), sequence INTEGER NOT NULL, delivery_snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (version_id, delivery_id), UNIQUE(version_id, sequence))",
  "CREATE INDEX IF NOT EXISTS idx_delivery_batches_project_updated ON delivery_batches(project_id, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_delivery_batch_versions_batch_number ON delivery_batch_versions(batch_id, version_no DESC)",
  "CREATE INDEX IF NOT EXISTS idx_delivery_batch_version_deliveries_version_sequence ON delivery_batch_version_deliveries(version_id, sequence)"
].join(';\n') + ';';
const SCHEMA_V12 = [
  "CREATE INDEX IF NOT EXISTS idx_asset_relations_target_lookup ON asset_relations(target_type, target_id, relation_type, asset_id)",
  "CREATE INDEX IF NOT EXISTS idx_review_decisions_asset_latest ON review_decisions(asset_id, created_at DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_delivery_batch_members_delivery ON delivery_batch_version_deliveries(delivery_id, version_id)"
].join(';\n') + ';';
const SCHEMA_V13 = [
  "CREATE TABLE IF NOT EXISTS studio_runtime_settings (studio_id TEXT PRIMARY KEY REFERENCES studios(id), max_worker_concurrency INTEGER NOT NULL CHECK (max_worker_concurrency BETWEEN 1 AND 30), updated_at TEXT NOT NULL)",
  "ALTER TABLE generation_runs ADD COLUMN requested_concurrency INTEGER"
].join(';\n') + ';';
const SCHEMA_V14 = [
  "ALTER TABLE studio_runtime_settings RENAME TO studio_runtime_settings_v13",
  "CREATE TABLE studio_runtime_settings (studio_id TEXT PRIMARY KEY REFERENCES studios(id), max_worker_concurrency INTEGER NOT NULL CHECK (max_worker_concurrency BETWEEN 1 AND 30), updated_at TEXT NOT NULL)",
  "INSERT INTO studio_runtime_settings (studio_id, max_worker_concurrency, updated_at) SELECT studio_id, max_worker_concurrency, updated_at FROM studio_runtime_settings_v13",
  "DROP TABLE studio_runtime_settings_v13"
].join(';\n') + ';';
const SCHEMA_V15 = [
  "CREATE TABLE IF NOT EXISTS command_receipts (idempotency_key TEXT PRIMARY KEY, command_name TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, request_hash TEXT)",
  "ALTER TABLE command_receipts RENAME TO command_receipts_v14",
  "CREATE TABLE command_receipts (studio_id TEXT NOT NULL REFERENCES studios(id), idempotency_key TEXT NOT NULL, command_name TEXT NOT NULL, request_hash TEXT, response_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (studio_id, idempotency_key))",
  "CREATE TABLE IF NOT EXISTS command_receipt_migration_quarantine (idempotency_key TEXT PRIMARY KEY, command_name TEXT NOT NULL, request_hash TEXT, response_json TEXT NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL)",
  "INSERT INTO command_receipts (studio_id, idempotency_key, command_name, request_hash, response_json, created_at) SELECT (SELECT id FROM studios), idempotency_key, command_name, request_hash, response_json, created_at FROM command_receipts_v14 WHERE (SELECT COUNT(*) FROM studios) = 1",
  "INSERT INTO command_receipt_migration_quarantine (idempotency_key, command_name, request_hash, response_json, created_at, reason) SELECT idempotency_key, command_name, request_hash, response_json, created_at, 'ambiguous_studio_scope' FROM command_receipts_v14 WHERE (SELECT COUNT(*) FROM studios) <> 1",
  "DROP TABLE command_receipts_v14"
].join(';\n') + ';';
const SCHEMA_V16 = [
  "CREATE TABLE IF NOT EXISTS asset_media_operations (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), asset_id TEXT NOT NULL, operation TEXT NOT NULL CHECK (operation IN ('import', 'trash', 'restore')), source_path TEXT NOT NULL, target_path TEXT NOT NULL, asset_json TEXT, relation_json TEXT, created_at TEXT NOT NULL)",
  "ALTER TABLE asset_media_operations ADD COLUMN expected_hash TEXT",
  "ALTER TABLE asset_media_operations ADD COLUMN expected_size INTEGER",
  "ALTER TABLE asset_media_operations ADD COLUMN expected_media_type TEXT",
  "ALTER TABLE asset_media_operations ADD COLUMN phase TEXT NOT NULL DEFAULT 'prepared' CHECK (phase IN ('prepared', 'moved'))",
  "UPDATE asset_media_operations SET expected_hash = json_extract(asset_json, '$.contentHash'), expected_size = json_extract(asset_json, '$.byteSize'), expected_media_type = json_extract(asset_json, '$.mediaType') WHERE operation = 'import' AND asset_json IS NOT NULL AND json_valid(asset_json) AND json_type(asset_json, '$') = 'object' AND json_extract(asset_json, '$.kind') = 'import' AND json_extract(asset_json, '$.mediaType') IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif') AND json_type(asset_json, '$.contentHash') = 'text' AND length(json_extract(asset_json, '$.contentHash')) = 64 AND json_extract(asset_json, '$.contentHash') NOT GLOB '*[^0-9a-f]*' AND json_type(asset_json, '$.byteSize') = 'integer' AND json_extract(asset_json, '$.byteSize') > 0 AND json_extract(asset_json, '$.byteSize') <= 9007199254740991",
].join(';\n') + ';';
const SCHEMA_V16_ASSET_BACKFILL = "UPDATE asset_media_operations SET expected_hash = (SELECT asset.content_hash FROM assets asset WHERE asset.id = asset_media_operations.asset_id AND asset.studio_id = asset_media_operations.studio_id AND asset.storage_path = asset_media_operations.source_path), expected_size = (SELECT asset.byte_size FROM assets asset WHERE asset.id = asset_media_operations.asset_id AND asset.studio_id = asset_media_operations.studio_id AND asset.storage_path = asset_media_operations.source_path), expected_media_type = (SELECT asset.media_type FROM assets asset WHERE asset.id = asset_media_operations.asset_id AND asset.studio_id = asset_media_operations.studio_id AND asset.storage_path = asset_media_operations.source_path) WHERE operation IN ('trash', 'restore') AND EXISTS (SELECT 1 FROM assets asset WHERE asset.id = asset_media_operations.asset_id AND asset.studio_id = asset_media_operations.studio_id AND asset.storage_path = asset_media_operations.source_path AND asset.media_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif') AND length(asset.content_hash) = 64 AND asset.content_hash NOT GLOB '*[^0-9a-f]*' AND typeof(asset.byte_size) = 'integer' AND asset.byte_size > 0 AND asset.byte_size <= 9007199254740991)";
const SCHEMA_V17 = [
  "CREATE TABLE IF NOT EXISTS delivery_export_journal (idempotency_key TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id), studio_id TEXT NOT NULL REFERENCES studios(id), directory_path TEXT NOT NULL, manifest_json TEXT NOT NULL, files_json TEXT NOT NULL, created_at TEXT NOT NULL)",
  "ALTER TABLE delivery_export_journal RENAME TO delivery_export_journal_v16",
  "CREATE TABLE delivery_export_journal (studio_id TEXT NOT NULL REFERENCES studios(id), idempotency_key TEXT NOT NULL, delivery_id TEXT NOT NULL REFERENCES deliveries(id), directory_path TEXT NOT NULL, manifest_json TEXT NOT NULL, files_json TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (studio_id, idempotency_key))",
  "INSERT INTO delivery_export_journal (studio_id, idempotency_key, delivery_id, directory_path, manifest_json, files_json, created_at) SELECT studio_id, idempotency_key, delivery_id, directory_path, manifest_json, files_json, created_at FROM delivery_export_journal_v16",
  "DROP TABLE delivery_export_journal_v16",
  "CREATE TABLE IF NOT EXISTS task_types (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, definition_json TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('official', 'user')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "ALTER TABLE task_types RENAME TO task_types_v16",
  "CREATE TABLE task_types (id TEXT PRIMARY KEY, studio_id TEXT REFERENCES studios(id), name TEXT NOT NULL, definition_json TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('official', 'user')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK ((source = 'official' AND studio_id IS NULL) OR (source = 'user' AND studio_id IS NOT NULL)))",
  "CREATE UNIQUE INDEX idx_task_types_official_name ON task_types(name) WHERE source = 'official'",
  "CREATE UNIQUE INDEX idx_task_types_user_studio_name ON task_types(studio_id, name) WHERE source = 'user'",
  "CREATE TABLE IF NOT EXISTS task_type_migration_quarantine (id TEXT PRIMARY KEY, name TEXT NOT NULL, definition_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, reason TEXT NOT NULL)",
  "INSERT INTO task_types (id, studio_id, name, definition_json, source, created_at, updated_at) SELECT id, NULL, name, definition_json, source, created_at, updated_at FROM task_types_v16 WHERE source = 'official'",
  "INSERT INTO task_types (id, studio_id, name, definition_json, source, created_at, updated_at) SELECT id, (SELECT id FROM studios), name, definition_json, source, created_at, updated_at FROM task_types_v16 WHERE source = 'user' AND (SELECT COUNT(*) FROM studios) = 1",
  "INSERT INTO task_type_migration_quarantine (id, name, definition_json, created_at, updated_at, reason) SELECT id, name, definition_json, created_at, updated_at, 'ambiguous_studio_scope' FROM task_types_v16 WHERE source = 'user' AND (SELECT COUNT(*) FROM studios) <> 1",
  "DROP TABLE task_types_v16"
].join(';\n') + ';';
const SCHEMA_V18 = [
  "ALTER TABLE studio_runtime_settings RENAME TO studio_runtime_settings_v17",
  "CREATE TABLE studio_runtime_settings (studio_id TEXT PRIMARY KEY REFERENCES studios(id), max_worker_concurrency INTEGER NOT NULL CHECK (max_worker_concurrency BETWEEN 1 AND 1000), updated_at TEXT NOT NULL)",
  "INSERT INTO studio_runtime_settings (studio_id, max_worker_concurrency, updated_at) SELECT studio_id, 1000, updated_at FROM studio_runtime_settings_v17",
  "DROP TABLE studio_runtime_settings_v17"
].join(';\n') + ';';
const SCHEMA_V18_CREATE = "CREATE TABLE studio_runtime_settings (studio_id TEXT PRIMARY KEY REFERENCES studios(id), max_worker_concurrency INTEGER NOT NULL CHECK (max_worker_concurrency BETWEEN 1 AND 1000), updated_at TEXT NOT NULL)";



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
      { version: 9, sql: SCHEMA_V9 },
    { version: 10, sql: SCHEMA_V10 },
    { version: 11, sql: SCHEMA_V11 },
    { version: 12, sql: SCHEMA_V12 },
    { version: 13, sql: SCHEMA_V13 },
    { version: 14, sql: SCHEMA_V14 },
    { version: 15, sql: SCHEMA_V15 },
    { version: 16, sql: SCHEMA_V16 },
    { version: 17, sql: SCHEMA_V17 },
    { version: 18, sql: SCHEMA_V18 }
  ];
  for (const migration of migrations) {
    const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version) as { version: number } | undefined;
    if (existing) continue;
    withTransaction(db, () => {
      if (migration.version === 18 && !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studio_runtime_settings'").get()) db.exec(SCHEMA_V18_CREATE);
      else db.exec(migration.sql);
      if (migration.version === 16 && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'assets'").get()) db.exec(SCHEMA_V16_ASSET_BACKFILL);
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
