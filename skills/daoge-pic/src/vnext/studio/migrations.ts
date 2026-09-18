import type { StudioDatabase } from './database';
import { assetSearchContentSql, roundSearchContentSql } from './search-content';

/**
 * The Studio schema history, in one place.
 *
 * database.ts owns connections, integrity checks and event plumbing; every
 * schema change belongs here instead. The list is applied in order and its
 * highest version must equal STUDIO_SCHEMA_VERSION — the migration ledger is
 * compared against both, so a migration added without bumping the version is
 * caught rather than silently skipped.
 */
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
const SCHEMA_V19_RUNS = [
  "ALTER TABLE generation_runs ADD COLUMN execution_concurrency INTEGER NOT NULL DEFAULT 4 CHECK (execution_concurrency BETWEEN 1 AND 1000)",
  "ALTER TABLE generation_runs ADD COLUMN concurrency_source TEXT NOT NULL DEFAULT 'default' CHECK (concurrency_source IN ('default', 'explicit', 'serial'))",
  "UPDATE generation_runs SET execution_concurrency = requested_concurrency, concurrency_source = CASE WHEN requested_concurrency = 1 THEN 'serial' ELSE 'explicit' END WHERE requested_concurrency BETWEEN 1 AND 1000"
].join(';\n') + ';';
const SCHEMA_V19_PREFLIGHT = [
  "ALTER TABLE dry_run_previews ADD COLUMN execution_concurrency INTEGER NOT NULL DEFAULT 4 CHECK (execution_concurrency BETWEEN 1 AND 1000)",
  "ALTER TABLE dry_run_previews ADD COLUMN concurrency_source TEXT NOT NULL DEFAULT 'default' CHECK (concurrency_source IN ('default', 'explicit', 'serial'))"
].join(';\n') + ';';
const SCHEMA_V19 = "DROP TABLE IF EXISTS studio_runtime_settings";
const SCHEMA_V20 = [
  "ALTER TABLE generation_runs ADD COLUMN provider_profile_id TEXT",
  "ALTER TABLE generation_runs ADD COLUMN provider_config_version INTEGER",
  "UPDATE generation_runs SET provider_profile_id = json_extract(provider_snapshot_json, '$.profileId'), provider_config_version = CAST(json_extract(provider_snapshot_json, '$.configVersion') AS INTEGER) WHERE provider_profile_id IS NULL OR provider_config_version IS NULL",
  "CREATE INDEX IF NOT EXISTS idx_assets_studio_visibility_kind_created ON assets(studio_id, deleted_at, kind, created_at DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_asset_relations_target_ordered ON asset_relations(target_type, target_id, relation_type, created_at, asset_id)",
  "CREATE INDEX IF NOT EXISTS idx_asset_relations_asset_lookup ON asset_relations(asset_id, relation_type, target_type, target_id)",
  "CREATE INDEX IF NOT EXISTS idx_runs_claim_provider ON generation_runs(status, provider_profile_id, provider_config_version, created_at, id)",
  "CREATE INDEX IF NOT EXISTS idx_run_items_pending_run_sequence ON run_items(status, run_id, sequence)",
  "CREATE INDEX IF NOT EXISTS idx_run_items_recovery_lease ON run_items(status, lease_expires_at, run_id, sequence)",
  "CREATE INDEX IF NOT EXISTS idx_run_items_recovery_retry ON run_items(status, retry_at, run_id, sequence)",
  "CREATE INDEX IF NOT EXISTS idx_delivery_assets_asset_delivery ON delivery_assets(asset_id, delivery_id, sequence)",
  "CREATE TABLE IF NOT EXISTS studio_event_windows (studio_id TEXT PRIMARY KEY REFERENCES studios(id), earliest_id INTEGER NOT NULL, latest_id INTEGER NOT NULL, retained_count INTEGER NOT NULL CHECK (retained_count BETWEEN 1 AND 2000))",
  "DELETE FROM events WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY studio_id ORDER BY id DESC) AS position FROM events) WHERE position > 2000)",
  "INSERT INTO studio_event_windows (studio_id, earliest_id, latest_id, retained_count) SELECT studio_id, MIN(id), MAX(id), COUNT(*) FROM events GROUP BY studio_id ON CONFLICT(studio_id) DO UPDATE SET earliest_id = excluded.earliest_id, latest_id = excluded.latest_id, retained_count = excluded.retained_count",
  "CREATE TRIGGER IF NOT EXISTS studio_event_windows_after_delete AFTER DELETE ON events BEGIN UPDATE studio_event_windows SET earliest_id = (SELECT id FROM events WHERE studio_id = OLD.studio_id ORDER BY id LIMIT 1), latest_id = (SELECT id FROM events WHERE studio_id = OLD.studio_id ORDER BY id DESC LIMIT 1), retained_count = retained_count - 1 WHERE studio_id = OLD.studio_id AND EXISTS (SELECT 1 FROM events WHERE studio_id = OLD.studio_id); DELETE FROM studio_event_windows WHERE studio_id = OLD.studio_id AND NOT EXISTS (SELECT 1 FROM events WHERE studio_id = OLD.studio_id); END",
  "INSERT INTO task_types (id, studio_id, name, definition_json, source, created_at, updated_at) VALUES ('portrait-kv', NULL, '人物主视觉', '{\"summary\":\"头像、人物海报、品牌人物封面。\",\"fields\":[\"subject\",\"wardrobe\",\"expression\",\"setting\",\"composition\",\"identity_constraints\"]}', 'official', datetime('now'), datetime('now')), ('ecommerce-product', NULL, '电商商品图', '{\"summary\":\"商品主图、详情页和卖点视觉。\",\"fields\":[\"product\",\"platform\",\"selling_points\",\"background\",\"angle\",\"text_safe_area\"]}', 'official', datetime('now'), datetime('now')), ('brand-packaging', NULL, '品牌包装图', '{\"summary\":\"包装概念、瓶盒展示和品牌资产板。\",\"fields\":[\"brand\",\"package_type\",\"materials\",\"usage_scene\",\"brand_constraints\"]}', 'official', datetime('now'), datetime('now')), ('cinematic-storyboard', NULL, '电影分镜', '{\"summary\":\"短片、剧情或广告镜头序列。\",\"fields\":[\"story\",\"shot_list\",\"camera_language\",\"continuity\",\"aspect_ratio\"]}', 'official', datetime('now'), datetime('now')), ('campaign-poster', NULL, '品牌海报', '{\"summary\":\"新品 KV、横幅和竖版封面。\",\"fields\":[\"campaign\",\"headline_safe_area\",\"hero_subject\",\"cta_area\",\"brand_constraints\"]}', 'official', datetime('now'), datetime('now')), ('ui-mockup-board', NULL, '界面视觉板', '{\"summary\":\"产品界面、卡片、设备场景和概念稿。\",\"fields\":[\"product_flow\",\"device\",\"information_hierarchy\",\"visual_system\"]}', 'official', datetime('now'), datetime('now')), ('academic-figure-board', NULL, '学术图板', '{\"summary\":\"机制图、论文概览和科研海报。\",\"fields\":[\"topic\",\"claims\",\"diagram_structure\",\"label_policy\",\"evidence_constraints\"]}', 'official', datetime('now'), datetime('now')), ('type-layout-poster', NULL, '排版海报', '{\"summary\":\"双语排版、强标题区和编辑视觉。\",\"fields\":[\"copy\",\"language\",\"hierarchy\",\"safe_area\",\"typography_constraints\"]}', 'official', datetime('now'), datetime('now')) ON CONFLICT(id) DO UPDATE SET studio_id = NULL, name = excluded.name, definition_json = excluded.definition_json, source = 'official', updated_at = excluded.updated_at"
].join(';\n') + ';';
const SCHEMA_V21 = [
  "ALTER TABLE asset_media_operations ADD COLUMN owner_id TEXT",
  "ALTER TABLE asset_media_operations ADD COLUMN heartbeat_at TEXT",
  "ALTER TABLE media_commit_journal ADD COLUMN owner_id TEXT",
  "ALTER TABLE media_commit_journal ADD COLUMN heartbeat_at TEXT",
  "ALTER TABLE assets ADD COLUMN media_state TEXT NOT NULL DEFAULT 'available' CHECK (media_state IN ('available', 'missing', 'quarantined', 'verification_failed'))",
  "ALTER TABLE assets ADD COLUMN missing_at TEXT",
  "ALTER TABLE assets ADD COLUMN last_verified_at TEXT",
  "ALTER TABLE run_items ADD COLUMN lease_worker_id TEXT",
  "CREATE INDEX IF NOT EXISTS idx_asset_media_operations_recovery ON asset_media_operations(studio_id, heartbeat_at, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_media_commit_journal_recovery ON media_commit_journal(studio_id, heartbeat_at, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_run_items_worker_lease ON run_items(lease_worker_id, status, lease_expires_at)",
  "CREATE INDEX IF NOT EXISTS idx_command_receipts_created ON command_receipts(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_dry_run_previews_created ON dry_run_previews(created_at)"
].join(';\n') + ';';
const SCHEMA_V22 = [
  "CREATE INDEX IF NOT EXISTS idx_runs_round_created ON generation_runs(round_id, created_at DESC, id DESC)",
  "CREATE INDEX IF NOT EXISTS idx_rounds_task_created ON creative_rounds(task_id, created_at, id)",
  "CREATE INDEX IF NOT EXISTS idx_run_items_run_sequence ON run_items(run_id, sequence)",
  "CREATE INDEX IF NOT EXISTS idx_dry_run_previews_round_created ON dry_run_previews(round_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_events_studio_entity_type ON events(studio_id, entity_type, entity_id, event_type)",
  "CREATE INDEX IF NOT EXISTS idx_asset_media_operations_studio_created ON asset_media_operations(studio_id, created_at)"
].join(';\n') + ';';

const SCHEMA_V23 = [
  "CREATE TABLE IF NOT EXISTS canvas_layouts (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), project_id TEXT NOT NULL REFERENCES projects(id), scope_type TEXT NOT NULL CHECK (scope_type IN ('project', 'task', 'round')), scope_id TEXT NOT NULL, viewport_json TEXT NOT NULL DEFAULT '{\"x\":0,\"y\":0,\"k\":1}', settings_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(studio_id, project_id, scope_type, scope_id))",
  "CREATE TABLE IF NOT EXISTS canvas_node_layouts (id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES canvas_layouts(id) ON DELETE CASCADE, entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'task', 'round', 'plan', 'run', 'run_item', 'asset', 'shared_asset', 'delivery', 'group')), entity_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, group_id TEXT, updated_at TEXT NOT NULL, UNIQUE(layout_id, entity_type, entity_id))",
  "CREATE TABLE IF NOT EXISTS canvas_groups (id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES canvas_layouts(id) ON DELETE CASCADE, title TEXT NOT NULL, group_type TEXT NOT NULL CHECK (group_type IN ('task', 'round', 'run', 'delivery', 'custom')), x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_canvas_layouts_scope ON canvas_layouts(studio_id, project_id, scope_type, scope_id)",
  "CREATE INDEX IF NOT EXISTS idx_canvas_node_layouts_layout ON canvas_node_layouts(layout_id)",
  "CREATE INDEX IF NOT EXISTS idx_canvas_groups_layout ON canvas_groups(layout_id)"
].join(';\n') + ';';

const SCHEMA_V24 = [
  "ALTER TABLE canvas_node_layouts RENAME TO canvas_node_layouts_v23",
  "CREATE TABLE canvas_node_layouts (id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES canvas_layouts(id) ON DELETE CASCADE, entity_type TEXT NOT NULL CHECK (entity_type IN ('project', 'task', 'round', 'plan', 'run', 'run_item', 'asset', 'shared_asset', 'delivery', 'group', 'task_type', 'style_kit', 'brand_kit')), entity_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, group_id TEXT, updated_at TEXT NOT NULL, UNIQUE(layout_id, entity_type, entity_id))",
  "INSERT INTO canvas_node_layouts (id, layout_id, entity_type, entity_id, x, y, width, height, collapsed, group_id, updated_at) SELECT id, layout_id, entity_type, entity_id, x, y, width, height, collapsed, group_id, updated_at FROM canvas_node_layouts_v23",
  "DROP TABLE canvas_node_layouts_v23",
  "CREATE TABLE IF NOT EXISTS canvas_links (id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES canvas_layouts(id) ON DELETE CASCADE, source_type TEXT NOT NULL CHECK (source_type IN ('project', 'task', 'round', 'plan', 'run', 'run_item', 'asset', 'shared_asset', 'delivery', 'group', 'task_type', 'style_kit', 'brand_kit')), source_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK (target_type IN ('project', 'task', 'round', 'plan', 'run', 'run_item', 'asset', 'shared_asset', 'delivery', 'group', 'task_type', 'style_kit', 'brand_kit')), target_id TEXT NOT NULL, link_type TEXT NOT NULL CHECK (link_type IN ('reference', 'style', 'alternative', 'rejected', 'todo', 'context', 'custom')), label TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_canvas_node_layouts_layout ON canvas_node_layouts(layout_id)",
  "CREATE INDEX IF NOT EXISTS idx_canvas_links_layout ON canvas_links(layout_id)",
  "CREATE INDEX IF NOT EXISTS idx_canvas_links_source ON canvas_links(layout_id, source_type, source_id)",
  "CREATE INDEX IF NOT EXISTS idx_canvas_links_target ON canvas_links(layout_id, target_type, target_id)"
].join(';\n') + ';';

const SCHEMA_V25 = "CREATE INDEX IF NOT EXISTS idx_run_items_run_status_sequence ON run_items(run_id, status, sequence)";
const SCHEMA_V26 = [
  "ALTER TABLE projects ADD COLUMN template_id TEXT",
  "ALTER TABLE projects ADD COLUMN template_version INTEGER"
].join(';\n') + ';';
const SCHEMA_V27 = [
  "CREATE TABLE IF NOT EXISTS usage_ledger (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), profile_id TEXT, project_id TEXT REFERENCES projects(id), task_id TEXT REFERENCES creative_tasks(id), round_id TEXT REFERENCES creative_rounds(id), run_id TEXT REFERENCES generation_runs(id), run_item_id TEXT REFERENCES run_items(id), unit TEXT NOT NULL, quantity REAL NOT NULL CHECK (quantity > 0), estimated_cost_minor INTEGER CHECK (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0), cost_unit TEXT, billing_state TEXT NOT NULL CHECK (billing_state IN ('estimated', 'billed', 'possibly_billed', 'unknown', 'not_billed')), estimate_source TEXT NOT NULL CHECK (estimate_source IN ('caller', 'provider', 'unknown')), idempotency_key TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(studio_id, idempotency_key), CHECK ((estimated_cost_minor IS NULL AND cost_unit IS NULL) OR (estimated_cost_minor IS NOT NULL AND cost_unit IS NOT NULL)) )",
  "CREATE INDEX IF NOT EXISTS idx_usage_ledger_studio_created ON usage_ledger(studio_id, created_at, id)",
  "CREATE INDEX IF NOT EXISTS idx_usage_ledger_attribution ON usage_ledger(studio_id, profile_id, project_id, task_id, round_id, run_id, run_item_id)",
  "CREATE TABLE IF NOT EXISTS budget_policies (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), profile_id TEXT, limit_cost_minor INTEGER NOT NULL CHECK (limit_cost_minor >= 0), cost_unit TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('hard')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(studio_id, profile_id))",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_policies_studio_profile ON budget_policies(studio_id, COALESCE(profile_id, ''))"
].join(';\n') + ';';
const SCHEMA_V27_DRY_RUN = "ALTER TABLE dry_run_previews ADD COLUMN usage_estimate_json TEXT NOT NULL DEFAULT '{\"unit\":\"unknown\",\"quantity\":0,\"estimatedCostMinor\":null,\"costUnit\":null,\"source\":\"unknown\"}'";
const SCHEMA_V28 = [
  "ALTER TABLE review_decisions ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version IN (1, 2))",
  "ALTER TABLE review_decisions ADD COLUMN context_json TEXT NOT NULL DEFAULT '{}'",
  "CREATE INDEX IF NOT EXISTS idx_review_decisions_context ON review_decisions(schema_version, updated_at DESC)"
].join(';\n') + ';';
const SCHEMA_V29 = [
  "CREATE TABLE IF NOT EXISTS confirmed_templates (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), template_id TEXT NOT NULL, template_type TEXT NOT NULL CHECK (template_type IN ('task_type', 'style_kit', 'brand_kit')), version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 1000000), name TEXT NOT NULL, definition_json TEXT NOT NULL, source_round_id TEXT NOT NULL REFERENCES creative_rounds(id), source_task_id TEXT NOT NULL REFERENCES creative_tasks(id), source_project_id TEXT NOT NULL REFERENCES projects(id), source_plan_version INTEGER NOT NULL CHECK (source_plan_version >= 1), provenance_json TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'archived')), created_at TEXT NOT NULL, archived_at TEXT, UNIQUE(studio_id, template_id, version), CHECK ((status = 'active' AND archived_at IS NULL) OR (status = 'archived' AND archived_at IS NOT NULL)))",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_confirmed_templates_active ON confirmed_templates(studio_id, template_id) WHERE status = 'active'",
  "CREATE INDEX IF NOT EXISTS idx_confirmed_templates_list ON confirmed_templates(studio_id, template_type, template_id, version DESC)",
  "CREATE TRIGGER IF NOT EXISTS confirmed_templates_immutable_update BEFORE UPDATE OF studio_id, template_id, template_type, version, name, definition_json, source_round_id, source_task_id, source_project_id, source_plan_version, provenance_json, created_at ON confirmed_templates BEGIN SELECT RAISE(ABORT, 'Confirmed template snapshots are immutable.'); END",
  "CREATE TRIGGER IF NOT EXISTS confirmed_templates_immutable_delete BEFORE DELETE ON confirmed_templates BEGIN SELECT RAISE(ABORT, 'Confirmed template snapshots cannot be deleted.'); END"
].join(';\n') + ';';

const SCHEMA_V30 = [
  "CREATE TABLE IF NOT EXISTS provider_concurrency_state (studio_id TEXT NOT NULL REFERENCES studios(id), profile_id TEXT NOT NULL, config_version INTEGER NOT NULL CHECK (config_version >= 1), target INTEGER NOT NULL CHECK (target BETWEEN 1 AND 100), cooldown_until_ms INTEGER NOT NULL CHECK (cooldown_until_ms >= 0), last_adjustment_at_ms INTEGER NOT NULL CHECK (last_adjustment_at_ms >= 0), last_reason TEXT NOT NULL CHECK (last_reason IN ('warmup', 'healthy', 'rate_limited', 'transient', 'unknown', 'memory_pressure')), max_observed_rss_bytes INTEGER NOT NULL CHECK (max_observed_rss_bytes >= 0), max_observed_external_bytes INTEGER NOT NULL CHECK (max_observed_external_bytes >= 0), updated_at TEXT NOT NULL, PRIMARY KEY (studio_id, profile_id, config_version))",
  "CREATE INDEX IF NOT EXISTS idx_provider_concurrency_state_updated ON provider_concurrency_state(studio_id, updated_at)"
].join(';\n') + ';';

const SCHEMA_V31 = [
  "CREATE TABLE IF NOT EXISTS provenance_records (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), asset_id TEXT NOT NULL REFERENCES assets(id), delivery_id TEXT NOT NULL REFERENCES deliveries(id), canonical_json TEXT NOT NULL, retention_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(studio_id, id))",
  "CREATE INDEX IF NOT EXISTS idx_provenance_records_studio_asset ON provenance_records(studio_id, asset_id)",
  "CREATE INDEX IF NOT EXISTS idx_provenance_records_studio_delivery ON provenance_records(studio_id, delivery_id)"
].join(';\n') + ';';
const SCHEMA_V32 = "ALTER TABLE generation_runs ADD COLUMN usage_estimate_json TEXT NOT NULL DEFAULT '{\"unit\":\"unknown\",\"quantity\":0,\"estimatedCostMinor\":null,\"costUnit\":null,\"source\":\"unknown\"}'";
// Provenance records were mutable: `persistStudioProvenance` overwrote
// `canonical_json` in place, while the canonical body embeds the latest
// review — so re-reviewing an asset silently rewrote content that may
// already have been anchored externally under the same record id. v33 makes
// the *history* immutable instead: every distinct canonical body is frozen
// into `provenance_record_versions` keyed by its content hash, so an anchor
// of (recordId, contentHash) always resolves back to exactly that content.
const SCHEMA_V33 = [
  "CREATE TABLE IF NOT EXISTS provenance_record_versions (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), record_id TEXT NOT NULL, asset_id TEXT NOT NULL REFERENCES assets(id), delivery_id TEXT NOT NULL REFERENCES deliveries(id), content_hash TEXT NOT NULL, canonical_json TEXT NOT NULL, retention_json TEXT NOT NULL, version_no INTEGER NOT NULL CHECK (version_no >= 1), recorded_at TEXT NOT NULL, superseded_at TEXT)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_provenance_record_versions_content ON provenance_record_versions(studio_id, record_id, content_hash)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_provenance_record_versions_no ON provenance_record_versions(studio_id, record_id, version_no)",
  "CREATE INDEX IF NOT EXISTS idx_provenance_record_versions_record ON provenance_record_versions(studio_id, record_id, recorded_at)",
  "ALTER TABLE provenance_records ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE provenance_records ADD COLUMN version_count INTEGER NOT NULL DEFAULT 1"
].join(';\n') + ';';

// v34 makes "at most one open run per round" a database invariant instead of an
// application convention. The command layer already refuses a second run for a
// round, but that check is a read followed by an insert: two queue requests
// arriving together could both pass it. The index is partial because a full
// UNIQUE(round_id) does not hold on real data — rounds that ended in `partial`
// or `failed` have been re-run before, and refusing to migrate a database for
// that reason would be worse than tolerating the history.
const OPEN_RUN_STATUSES_SQL = "('draft', 'awaiting_confirmation', 'queued', 'running', 'pausing', 'paused', 'interrupted', 'resume_pending')";
const SCHEMA_V34 = "CREATE UNIQUE INDEX IF NOT EXISTS idx_generation_runs_round_open ON generation_runs(round_id) WHERE status IN " + OPEN_RUN_STATUSES_SQL;
const SCHEMA_V34_PENDING = "CREATE TABLE IF NOT EXISTS schema_migration_pending (version INTEGER PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ('degraded')), reason TEXT NOT NULL, details_json TEXT NOT NULL, updated_at TEXT NOT NULL)";
const SCHEMA_V34_GUARDS = [
  "CREATE TRIGGER IF NOT EXISTS generation_runs_open_guard_insert BEFORE INSERT ON generation_runs WHEN NEW.status IN " + OPEN_RUN_STATUSES_SQL + " AND EXISTS (SELECT 1 FROM generation_runs existing WHERE existing.round_id = NEW.round_id AND existing.status IN " + OPEN_RUN_STATUSES_SQL + ") BEGIN SELECT RAISE(ABORT, 'A generation run is already open for this round.'); END",
  "CREATE TRIGGER IF NOT EXISTS generation_runs_open_guard_update BEFORE UPDATE OF round_id, status ON generation_runs WHEN NEW.status IN " + OPEN_RUN_STATUSES_SQL + " AND (OLD.round_id <> NEW.round_id OR OLD.status NOT IN " + OPEN_RUN_STATUSES_SQL + ") AND EXISTS (SELECT 1 FROM generation_runs existing WHERE existing.id <> NEW.id AND existing.round_id = NEW.round_id AND existing.status IN " + OPEN_RUN_STATUSES_SQL + ") BEGIN SELECT RAISE(ABORT, 'A generation run is already open for this round.'); END"
].join(';\n') + ';';
const SCHEMA_V34_GUARD_NAMES = ['generation_runs_open_guard_insert', 'generation_runs_open_guard_update'] as const;

// v35 opens the 6.0.0 request-queue era. Two tables, both new rather than
// repurposed: `studio_requests` is the one queue the Workbench request entry
// and the Agent both consume, and `studio_agents` is where an Agent registers
// itself so Studio can answer "is anyone listening right now".
//
// The queue deliberately stores state in **columns**, not as an event replay:
// `events` is a rolling 2000-row window that fills up in days, so a request
// that had not been claimed yet could be evicted before anyone read it. A row
// per request cannot be evicted by event pruning.
//
// The lease columns copy the `run_items` pattern that already exists rather
// than inventing a second one: claim writes `lease_token` + `lease_expires_at`,
// and an expired lease can be claimed again. `attempts` counts consecutive
// expiries so that a request nobody finishes eventually fails instead of
// looping forever.
const SCHEMA_V35 = [
  "CREATE TABLE IF NOT EXISTS studio_requests (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), project_id TEXT REFERENCES projects(id), task_id TEXT REFERENCES creative_tasks(id), text TEXT NOT NULL, context_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'done', 'rejected', 'failed')), lease_token TEXT, lease_worker_id TEXT, lease_expires_at TEXT, attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0), result_round_id TEXT REFERENCES creative_rounds(id), result_json TEXT, created_at TEXT NOT NULL, accepted_at TEXT, done_at TEXT, updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS idx_studio_requests_queue ON studio_requests(studio_id, status, created_at, id)",
  "CREATE INDEX IF NOT EXISTS idx_studio_requests_lease ON studio_requests(studio_id, status, lease_expires_at)",
  "CREATE TABLE IF NOT EXISTS studio_agents (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), cli_name TEXT NOT NULL, cli_version TEXT, skill_name TEXT, skill_version TEXT, capabilities_json TEXT NOT NULL DEFAULT '{}', registered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, UNIQUE(studio_id, cli_name, skill_name))",
  "CREATE INDEX IF NOT EXISTS idx_studio_agents_presence ON studio_agents(studio_id, last_seen_at)"
].join(';\n') + ';';

// v36 makes two relationships into constraints instead of conventions.
//
// `assets.project_id`: today "which project does this image belong to" is a
// five-hop JOIN through `asset_relations -> run_items -> runs -> rounds ->
// tasks`. Adding the column means a generated image records its project at
// persist time, so project scope is a column rather than an agreement.
//
// `run_items.asset_id`: the produced image id currently lives inside
// `result_json`, so "which run produced this image" needs JSON parsing. A
// nullable column makes an empty slot exactly `asset_id IS NULL` — which is
// also the data foundation of the failure experience (257 empty slots).
const SCHEMA_V36 = [
  "ALTER TABLE assets ADD COLUMN project_id TEXT REFERENCES projects(id)",
  "ALTER TABLE run_items ADD COLUMN asset_id TEXT REFERENCES assets(id)",
  "CREATE INDEX IF NOT EXISTS idx_assets_project_created ON assets(project_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_run_items_asset ON run_items(asset_id)"
].join(';\n') + ';';

/**
 * v36 adds nullable columns. Re-runnable on purpose: a later pending migration
 * (v34 in degraded mode) causes later ledger rows to be rolled back, so this
 * migration may run again after the repair — ALTER TABLE ADD COLUMN is not
 * idempotent by itself, so the columns are checked first.
 */
function applyAssetAttributionColumns(db: StudioDatabase): boolean {
  if (!tableExists(db, 'assets') || !tableExists(db, 'run_items')) return true;
  const statements: string[] = [];
  if (!columnsOf(db, 'assets').includes('project_id')) statements.push("ALTER TABLE assets ADD COLUMN project_id TEXT REFERENCES projects(id)");
  if (!columnsOf(db, 'run_items').includes('asset_id')) statements.push("ALTER TABLE run_items ADD COLUMN asset_id TEXT REFERENCES assets(id)");
  statements.push("CREATE INDEX IF NOT EXISTS idx_assets_project_created ON assets(project_id, created_at)");
  statements.push("CREATE INDEX IF NOT EXISTS idx_run_items_asset ON run_items(asset_id)");
  db.exec(statements.join(';\n') + ';');
  return true;
}

// v37 returns the session working pointer to its real owner. `active_*` was
// written by both sides — the Workbench stamped "what I am looking at" into the
// same columns the Agent used for "what I am operating on" — so the two facts
// overwrote each other. The interface's "where am I looking" is carried by the
// route now; these columns are the Agent's alone, so they are renamed to say so.
function applySessionPointerRename(db: StudioDatabase): boolean {
  if (!tableExists(db, 'studio_sessions')) return true;
  const columns = columnsOf(db, 'studio_sessions');
  // Re-runnable: once renamed the old column is gone. A pending v34 rolls later
  // ledger rows back, so this can run a second time.
  if (!columns.includes('active_project_id')) return true;
  // RENAME COLUMN rather than a table rebuild: `run_resume_confirmations`
  // holds a foreign key onto studio_sessions(id), and a full rebuild would
  // have to shut that constraint down to move the data.
  const renames: string[] = [];
  if (columns.includes('active_project_id')) renames.push('ALTER TABLE studio_sessions RENAME COLUMN active_project_id TO agent_project_id');
  if (columns.includes('active_task_id')) renames.push('ALTER TABLE studio_sessions RENAME COLUMN active_task_id TO agent_task_id');
  if (columns.includes('active_round_id')) renames.push('ALTER TABLE studio_sessions RENAME COLUMN active_round_id TO agent_round_id');
  db.exec(renames.join(';\n') + ';');
  return true;
}

const SCHEMA_V37 = 'SELECT 1;';

// v38 rebuilds the canvas around the form the plan settled on: a project owns
// exactly one layout, and the only things that get a persisted position are
// the three node kinds a creator actually talks about (task / round / asset)
// plus the auto-generated group.
//
// The old shape had a layout per scope (round 37 / task 16 / project 8 in the
// live data), which is why switching scope moved every node — and why so few
// projects ever had a project-scope layout. Dropping the two scope columns and
// keeping the project's most complete layout is the whole migration.
//
// The enum convergence is deliberate: "plan never goes on the canvas" stops
// being a sentence in a document and becomes something the database refuses.
const CANVAS_NODE_TYPES = "('task', 'round', 'asset', 'group')";

function applyCanvasLayoutRebuild(db: StudioDatabase): boolean {
  // A legacy/synthetic database may carry a version ledger without the canvas
  // tables (or without `projects` to anchor the foreign key). Skip rather than
  // abort the whole migration run.
  if (!tableExists(db, 'projects') || !tableExists(db, 'canvas_layouts') || !tableExists(db, 'canvas_node_layouts') || !tableExists(db, 'canvas_groups') || !tableExists(db, 'canvas_links')) return true;
  // Re-runnable: the scope columns are gone once the rebuild has happened.
  if (!columnsOf(db, 'canvas_layouts').includes('scope_type')) return true;
  // ⚠️ Order matters here, and the obvious order is wrong.
  //
  // The new child tables must reference the **temporary** parent name. If they
  // referenced `canvas_layouts` (the name the parent will eventually have, i.e.
  // the OLD table), then `DROP TABLE canvas_layouts` would cascade through
  // `ON DELETE CASCADE` and wipe every row just copied in — the migration would
  // silently succeed and leave zero node positions behind. That is exactly what
  // happened once; the regression is covered by
  // `schema-rebuild-contract.test.js` ("已有数据必须搬过去").
  //
  // So: temp parent → children referencing the temp parent → copy → drop the
  // old children → drop the old parent (nothing references it now) → rename the
  // parent last, which rewrites the children's foreign keys to the final name.
  db.exec([
    'CREATE TABLE canvas_layouts_v38 (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), project_id TEXT NOT NULL REFERENCES projects(id), viewport_json TEXT NOT NULL DEFAULT \'{"x":0,"y":0,"k":1}\', settings_json TEXT NOT NULL DEFAULT \'{}\', version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(studio_id, project_id))',
    // Keep the project-scope layout when there is one, else the most recently
    // touched layout for that project. The other scopes' positions are the
    // alternative views the one-layout design replaces.
    'INSERT INTO canvas_layouts_v38 (id, studio_id, project_id, viewport_json, settings_json, version, created_at, updated_at) SELECT id, studio_id, project_id, viewport_json, settings_json, version, created_at, updated_at FROM canvas_layouts layout WHERE layout.id = (SELECT candidate.id FROM canvas_layouts candidate WHERE candidate.studio_id = layout.studio_id AND candidate.project_id = layout.project_id ORDER BY (candidate.scope_type = \'project\') DESC, candidate.updated_at DESC, candidate.id LIMIT 1)',
    'CREATE TABLE canvas_node_layouts_v38 (id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES canvas_layouts_v38(id) ON DELETE CASCADE, entity_type TEXT NOT NULL CHECK (entity_type IN ' + CANVAS_NODE_TYPES + '), entity_id TEXT NOT NULL, x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, collapsed INTEGER NOT NULL DEFAULT 0, group_id TEXT, updated_at TEXT NOT NULL, UNIQUE(layout_id, entity_type, entity_id))',
    'CREATE TABLE canvas_groups_v38 (id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES canvas_layouts_v38(id) ON DELETE CASCADE, title TEXT NOT NULL, group_type TEXT NOT NULL CHECK (group_type IN (\'task\', \'round\', \'asset\', \'custom\')), x REAL NOT NULL, y REAL NOT NULL, width REAL NOT NULL, height REAL NOT NULL, metadata_json TEXT NOT NULL DEFAULT \'{}\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
    'CREATE TABLE canvas_links_v38 (id TEXT PRIMARY KEY, layout_id TEXT NOT NULL REFERENCES canvas_layouts_v38(id) ON DELETE CASCADE, source_type TEXT NOT NULL CHECK (source_type IN ' + CANVAS_NODE_TYPES + '), source_id TEXT NOT NULL, target_type TEXT NOT NULL CHECK (target_type IN ' + CANVAS_NODE_TYPES + '), target_id TEXT NOT NULL, link_type TEXT NOT NULL CHECK (link_type IN (\'reference\', \'style\', \'alternative\', \'rejected\', \'todo\', \'context\', \'custom\')), label TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT \'{}\', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)',
    'INSERT INTO canvas_node_layouts_v38 (id, layout_id, entity_type, entity_id, x, y, width, height, collapsed, group_id, updated_at) SELECT id, layout_id, entity_type, entity_id, x, y, width, height, collapsed, group_id, updated_at FROM canvas_node_layouts WHERE layout_id IN (SELECT id FROM canvas_layouts_v38) AND entity_type IN ' + CANVAS_NODE_TYPES,
    'INSERT INTO canvas_groups_v38 (id, layout_id, title, group_type, x, y, width, height, metadata_json, created_at, updated_at) SELECT id, layout_id, title, CASE WHEN group_type IN (\'task\', \'round\', \'asset\') THEN group_type ELSE \'custom\' END, x, y, width, height, metadata_json, created_at, updated_at FROM canvas_groups WHERE layout_id IN (SELECT id FROM canvas_layouts_v38)',
    'INSERT INTO canvas_links_v38 (id, layout_id, source_type, source_id, target_type, target_id, link_type, label, metadata_json, created_at, updated_at) SELECT id, layout_id, source_type, source_id, target_type, target_id, link_type, label, metadata_json, created_at, updated_at FROM canvas_links WHERE layout_id IN (SELECT id FROM canvas_layouts_v38) AND source_type IN ' + CANVAS_NODE_TYPES + ' AND target_type IN ' + CANVAS_NODE_TYPES,
    'DROP TABLE canvas_links',
    'DROP TABLE canvas_groups',
    'DROP TABLE canvas_node_layouts',
    // Nothing references the old parent any more (its children are gone, and the
    // new ones point at the temporary name), so this drop cannot cascade.
    'DROP TABLE canvas_layouts',
    'ALTER TABLE canvas_layouts_v38 RENAME TO canvas_layouts',
    'ALTER TABLE canvas_node_layouts_v38 RENAME TO canvas_node_layouts',
    'ALTER TABLE canvas_groups_v38 RENAME TO canvas_groups',
    'ALTER TABLE canvas_links_v38 RENAME TO canvas_links',
    'CREATE INDEX IF NOT EXISTS idx_canvas_layouts_project ON canvas_layouts(studio_id, project_id)',
    'CREATE INDEX IF NOT EXISTS idx_canvas_node_layouts_layout ON canvas_node_layouts(layout_id)',
    'CREATE INDEX IF NOT EXISTS idx_canvas_groups_layout ON canvas_groups(layout_id)',
    'CREATE INDEX IF NOT EXISTS idx_canvas_links_layout ON canvas_links(layout_id)',
    'CREATE INDEX IF NOT EXISTS idx_canvas_links_source ON canvas_links(layout_id, source_type, source_id)',
    'CREATE INDEX IF NOT EXISTS idx_canvas_links_target ON canvas_links(layout_id, target_type, target_id)'
  ].join(';\n') + ';');
  return true;
}

const SCHEMA_V38 = 'SELECT 1;';

// v39 makes search find what a person would search for (plan 7.8.1).
//
// Two problems: a round was indexed as its whole `plan_json` (so only
// `{"operation":"generate"}` matched, not "夜景"), and images were not indexed
// at all — a user could not search for a picture, which is the main character.
//
// The round triggers are replaced with a human projection (prompt + count +
// output spec). Images get the same treatment, and because an image's
// describing text comes from rows written around it (its producing run item,
// later reviews, later deliveries), the index row is refreshed by triggers on
// those tables rather than only at insert time.
const SEARCH_ROUND_TRIGGER_NAMES = ['studio_search_rounds_ai', 'studio_search_rounds_au', 'studio_search_rounds_ad'];
const SEARCH_ASSET_TRIGGER_NAMES = [
  'studio_search_assets_ai', 'studio_search_assets_ad',
  'studio_search_assets_relation_ai',
  'studio_search_assets_review_ai', 'studio_search_assets_review_au', 'studio_search_assets_review_ad',
  'studio_search_assets_delivery_ai', 'studio_search_assets_delivery_ad'
];

function assetRefreshStatements(event: string, table: string, targetAssetExpression: string): string[] {
  const content = assetSearchContentSql('asset');
  const refresh = "DELETE FROM studio_search WHERE entity_type = 'asset' AND entity_id = " + targetAssetExpression + "; INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT asset.studio_id, 'asset', asset.id, " + content + " FROM assets asset WHERE asset.id = " + targetAssetExpression + " AND " + content + " <> '';";
  return ["CREATE TRIGGER IF NOT EXISTS " + event + " AFTER " + table + " BEGIN " + refresh + " END"];
}

const SCHEMA_V39 = [
  ...SEARCH_ROUND_TRIGGER_NAMES.map((name) => 'DROP TRIGGER IF EXISTS ' + name),
  ...SEARCH_ASSET_TRIGGER_NAMES.map((name) => 'DROP TRIGGER IF EXISTS ' + name),
  "DELETE FROM studio_search WHERE entity_type = 'round'",
  "INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT project.studio_id, 'round', round.id, " + roundSearchContentSql('round.plan_json') + " FROM creative_rounds round JOIN creative_tasks task ON task.id = round.task_id JOIN projects project ON project.id = task.project_id WHERE " + roundSearchContentSql('round.plan_json') + " <> ''",
  "CREATE TRIGGER IF NOT EXISTS studio_search_rounds_ai AFTER INSERT ON creative_rounds BEGIN INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT project.studio_id, 'round', NEW.id, " + roundSearchContentSql('NEW.plan_json') + " FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = NEW.task_id AND " + roundSearchContentSql('NEW.plan_json') + " <> ''; END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_rounds_au AFTER UPDATE OF plan_json ON creative_rounds BEGIN DELETE FROM studio_search WHERE entity_type = 'round' AND entity_id = NEW.id; INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT project.studio_id, 'round', NEW.id, " + roundSearchContentSql('NEW.plan_json') + " FROM creative_tasks task JOIN projects project ON project.id = task.project_id WHERE task.id = NEW.task_id AND " + roundSearchContentSql('NEW.plan_json') + " <> ''; END",
  "CREATE TRIGGER IF NOT EXISTS studio_search_rounds_ad AFTER DELETE ON creative_rounds BEGIN DELETE FROM studio_search WHERE entity_type = 'round' AND entity_id = OLD.id; END",
  // An image row is indexed as soon as it exists (filename / revisedPrompt) and
  // refreshed whenever the facts around it change.
  ...assetRefreshStatements('studio_search_assets_ai', 'INSERT ON assets', 'NEW.id'),
  ...assetRefreshStatements('studio_search_assets_ad', 'DELETE ON assets', 'OLD.id'),
  ...assetRefreshStatements('studio_search_assets_relation_ai', "INSERT ON asset_relations WHEN NEW.relation_type = 'output_of' AND NEW.target_type = 'run_item'", 'NEW.asset_id'),
  ...assetRefreshStatements('studio_search_assets_review_ai', 'INSERT ON review_decisions', 'NEW.asset_id'),
  ...assetRefreshStatements('studio_search_assets_review_au', 'UPDATE ON review_decisions', 'NEW.asset_id'),
  ...assetRefreshStatements('studio_search_assets_review_ad', 'DELETE ON review_decisions', 'OLD.asset_id'),
  ...assetRefreshStatements('studio_search_assets_delivery_ai', 'INSERT ON delivery_assets', 'NEW.asset_id'),
  ...assetRefreshStatements('studio_search_assets_delivery_ad', 'DELETE ON delivery_assets', 'OLD.asset_id')
].join(';\n') + ';';

function applySearchIndexRebuild(db: StudioDatabase): boolean {
  if (!tableExists(db, 'studio_search')) return true;
  if (!tableExists(db, 'assets') || !tableExists(db, 'creative_rounds') || !tableExists(db, 'asset_relations') || !tableExists(db, 'review_decisions') || !tableExists(db, 'delivery_assets')) return true;
  db.exec(SCHEMA_V39);
  return true;
}

const SCHEMA_V39_SQL = 'SELECT 1;';

// v40 backfills the two relationships v36/v38 introduced as columns but only
// wired for *new* rows, plus the asset half of the search index.
//
// Migrating a database that already has data means the new columns must be true
// for the old rows too — otherwise "which project is this image in" and "which
// image did this slot produce" are NULL for everything, and search still cannot
// find a single picture. Nullable columns made the schema correct; this makes
// the existing data correct.
const SCHEMA_V40 = [
  // Slot → output image, from the relation that already recorded it.
  "UPDATE run_items SET asset_id = (SELECT relation.asset_id FROM asset_relations relation WHERE relation.relation_type = 'output_of' AND relation.target_type = 'run_item' AND relation.target_id = run_items.id ORDER BY relation.created_at, relation.asset_id LIMIT 1) WHERE asset_id IS NULL AND EXISTS (SELECT 1 FROM asset_relations relation WHERE relation.relation_type = 'output_of' AND relation.target_type = 'run_item' AND relation.target_id = run_items.id)",
  // Generated image → project, via the run chain.
  "UPDATE assets SET project_id = (SELECT task.project_id FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id WHERE item.asset_id = assets.id ORDER BY run.created_at, item.sequence LIMIT 1) WHERE project_id IS NULL AND EXISTS (SELECT 1 FROM run_items item JOIN generation_runs run ON run.id = item.run_id JOIN creative_rounds round ON round.id = run.round_id JOIN creative_tasks task ON task.id = round.task_id WHERE item.asset_id = assets.id)",
  // Imported image → project, from the explicit attachment.
  "UPDATE assets SET project_id = (SELECT relation.target_id FROM asset_relations relation WHERE relation.asset_id = assets.id AND relation.target_type = 'project' ORDER BY relation.created_at LIMIT 1) WHERE project_id IS NULL AND EXISTS (SELECT 1 FROM asset_relations relation WHERE relation.asset_id = assets.id AND relation.target_type = 'project')"
].join(';\n') + ';';

function applySearchAssetBackfill(db: StudioDatabase): boolean {
  // Synthetic/legacy databases may carry a version ledger without these tables
  // (the v2/v14/v15/v16 migration fixtures do). Skip rather than abort the run.
  if (!tableExists(db, 'run_items') || !tableExists(db, 'assets') || !tableExists(db, 'asset_relations')) return true;
  db.exec(SCHEMA_V40);
  if (!tableExists(db, 'studio_search')) return true;
  const content = assetSearchContentSql('asset');
  db.exec("DELETE FROM studio_search WHERE entity_type = 'asset'");
  db.exec("INSERT INTO studio_search (studio_id, entity_type, entity_id, content) SELECT asset.studio_id, 'asset', asset.id, " + content + " FROM assets asset WHERE " + content + " <> ''");
  return true;
}

const SCHEMA_V40_SQL = 'SELECT 1;';

// v41 fixes the identity of a registered agent: **one CLI is one row**.
//
// v35 keyed the table on `(studio_id, cli_name, skill_name)` with a nullable
// `skill_name`. SQLite treats every NULL as distinct in a UNIQUE constraint, so
// registering the same CLI first without a skill and then with one produced two
// rows — and the skill-less row could never be matched again (lookup binds
// `skill_name IS ?`), so it lingered forever as a ghost.
//
// The declared skill list already lives in `capabilities_json`; `skill_name` /
// `skill_version` are just a denormalized convenience for the status card. So
// the identity collapses to `(studio_id, cli_name)` and duplicates are merged,
// preferring the row that actually declared a skill.
const SCHEMA_V41 = [
  "CREATE TABLE studio_agents_v41 (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), cli_name TEXT NOT NULL, cli_version TEXT, skill_name TEXT, skill_version TEXT, capabilities_json TEXT NOT NULL DEFAULT '{}', registered_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, UNIQUE(studio_id, cli_name))",
  "INSERT INTO studio_agents_v41 (id, studio_id, cli_name, cli_version, skill_name, skill_version, capabilities_json, registered_at, last_seen_at) SELECT id, studio_id, cli_name, cli_version, skill_name, skill_version, capabilities_json, registered_at, last_seen_at FROM studio_agents agent WHERE agent.id = (SELECT candidate.id FROM studio_agents candidate WHERE candidate.studio_id = agent.studio_id AND candidate.cli_name = agent.cli_name ORDER BY (candidate.skill_name IS NOT NULL) DESC, candidate.last_seen_at DESC, candidate.id LIMIT 1)",
  'DROP TABLE studio_agents',
  'ALTER TABLE studio_agents_v41 RENAME TO studio_agents',
  'CREATE INDEX IF NOT EXISTS idx_studio_agents_presence ON studio_agents(studio_id, last_seen_at)'
].join(';\n') + ';';

function applyAgentIdentityFix(db: StudioDatabase): boolean {
  if (!tableExists(db, 'studio_agents')) return true;
  // Re-runnable: once the unique key is `(studio_id, cli_name)` this migration
  // has already happened (the old shape cannot be reconstructed).
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'studio_agents'").get() as { sql: string } | undefined;
  if (!schema || !/UNIQUE\s*\(\s*studio_id\s*,\s*cli_name\s*,\s*skill_name\s*\)/i.test(schema.sql)) return true;
  db.exec(SCHEMA_V41);
  return true;
}

const SCHEMA_V41_SQL = 'SELECT 1;';

export interface StudioMigration {
  readonly version: number;
  readonly sql: string;
  /** Special-cased application for migrations that inspect the database first.
   * Returning false leaves the migration pending and omits its ledger row. */
  readonly apply?: (db: StudioDatabase) => void | boolean;
}

function tableExists(db: StudioDatabase, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function columnsOf(db: StudioDatabase, table: string): string[] {
  return (db.prepare('PRAGMA table_info(' + table + ')').all() as Array<{ name: string }>).map((row) => row.name);
}

/**
 * Installs the "one open run per round" index. Conflicting historical rows are
 * never deleted or silently rewritten. Instead the migration remains pending,
 * durable degraded guards reject further duplicate opens, and the runner avoids
 * claiming work from any conflicted round. After an operator resolves the
 * conflicting statuses, the next opener retries this migration, installs the
 * unique index, clears the degraded marker and records v34 as complete.
 */
function applyOpenRunConstraint(db: StudioDatabase): boolean {
  db.exec(SCHEMA_V34_PENDING);
  if (!tableExists(db, 'generation_runs')) {
    db.prepare('DELETE FROM schema_migration_pending WHERE version = 34').run();
    return true;
  }
  const conflicts = db.prepare('SELECT round_id, COUNT(*) AS open_runs FROM generation_runs WHERE status IN ' + OPEN_RUN_STATUSES_SQL + ' GROUP BY round_id HAVING open_runs > 1 ORDER BY round_id').all() as Array<{ round_id: string; open_runs: number }>;
  if (conflicts.length) {
    db.exec(SCHEMA_V34_GUARDS);
    db.prepare("INSERT INTO schema_migration_pending (version, state, reason, details_json, updated_at) VALUES (34, 'degraded', 'open_run_conflict', ?, datetime('now')) ON CONFLICT(version) DO UPDATE SET state = excluded.state, reason = excluded.reason, details_json = excluded.details_json, updated_at = excluded.updated_at").run(JSON.stringify({ conflicts }));
    process.emitWarning('Studio database has ' + conflicts.length + ' round(s) with more than one open generation run; migration v34 remains pending in degraded mode for ' + conflicts.map((row) => row.round_id).join(', ').slice(0, 200) + '.', { code: 'DAOGE_PIC_OPEN_RUN_CONFLICT' });
    return false;
  }
  db.exec(SCHEMA_V34);
  for (const name of SCHEMA_V34_GUARD_NAMES) db.exec('DROP TRIGGER IF EXISTS ' + name);
  db.prepare('DELETE FROM schema_migration_pending WHERE version = 34').run();
  return true;
}

export function dispatchStudioMigration(db: StudioDatabase, migration: StudioMigration): boolean {
  const result = migration.apply ? migration.apply(db) : applyStudioMigration(db, migration.version, migration.sql);
  return result !== false;
}

export const STUDIO_MIGRATIONS: readonly StudioMigration[] = [
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
  { version: 18, sql: SCHEMA_V18 },
  { version: 19, sql: SCHEMA_V19 },
  { version: 20, sql: SCHEMA_V20 },
  { version: 21, sql: SCHEMA_V21 },
  { version: 22, sql: SCHEMA_V22 },
  { version: 23, sql: SCHEMA_V23 },
  { version: 24, sql: SCHEMA_V24 },
  { version: 25, sql: SCHEMA_V25 },
  { version: 26, sql: SCHEMA_V26 },
  { version: 27, sql: SCHEMA_V27 },
  { version: 28, sql: SCHEMA_V28 },
  { version: 29, sql: SCHEMA_V29 },
  { version: 30, sql: SCHEMA_V30 },
  { version: 31, sql: SCHEMA_V31 },
  { version: 32, sql: SCHEMA_V32 },
  { version: 33, sql: SCHEMA_V33 },
  { version: 34, sql: SCHEMA_V34, apply: applyOpenRunConstraint },
  { version: 35, sql: SCHEMA_V35 },
  { version: 36, sql: SCHEMA_V36, apply: applyAssetAttributionColumns },
  { version: 37, sql: SCHEMA_V37, apply: applySessionPointerRename },
  { version: 38, sql: SCHEMA_V38, apply: applyCanvasLayoutRebuild },
  { version: 39, sql: SCHEMA_V39_SQL, apply: applySearchIndexRebuild },
  { version: 40, sql: SCHEMA_V40_SQL, apply: applySearchAssetBackfill },
  { version: 41, sql: SCHEMA_V41_SQL, apply: applyAgentIdentityFix }
];
/**
 * Some migrations cannot run unconditionally: they were written when the
 * target table might not exist yet (a Studio created before that feature), or
 * they add a column that an earlier partial run may already have added.
 */
export function applyStudioMigration(db: StudioDatabase, version: number, sql: string): void | boolean {
  if (version === 18) {
    // v18 widens the CHECK bound. Existing v13/v17 tables must be rebuilt;
    // merely returning when the table exists leaves the old constraint active.
    if (!tableExists(db, 'studio_runtime_settings')) db.exec(SCHEMA_V18_CREATE);
    else db.exec(SCHEMA_V18);
    return;
  }
  if (version === 19) {
    if (tableExists(db, 'generation_runs')) db.exec(SCHEMA_V19_RUNS);
    if (tableExists(db, 'dry_run_previews')) db.exec(SCHEMA_V19_PREFLIGHT);
    db.exec(SCHEMA_V19);
    return;
  }
  if (version === 20 || version === 21 || version === 22) {
    const required = version === 20
      ? ['generation_runs', 'assets', 'asset_relations', 'run_items', 'delivery_assets', 'events', 'task_types']
      : version === 21
        ? ['asset_media_operations', 'media_commit_journal', 'assets', 'run_items', 'command_receipts', 'dry_run_previews']
        : ['generation_runs', 'run_items', 'dry_run_previews', 'events', 'asset_media_operations'];
    if (required.every((name) => tableExists(db, name))) db.exec(sql);
    return;
  }
  if (version === 25) {
    if (tableExists(db, 'run_items')) db.exec(sql);
    return;
  }
  if (version === 26) {
    if (tableExists(db, 'projects')) db.exec(sql);
    return;
  }
  if (version === 27) {
    db.exec(sql);
    if (tableExists(db, 'dry_run_previews') && !columnsOf(db, 'dry_run_previews').includes('usage_estimate_json')) db.exec(SCHEMA_V27_DRY_RUN);
    return;
  }
  if (version === 28) {
    if (tableExists(db, 'review_decisions')) db.exec(sql);
    return;
  }
  if (version === 32) {
    if (tableExists(db, 'generation_runs') && !columnsOf(db, 'generation_runs').includes('usage_estimate_json')) db.exec(sql);
    return;
  }
  if (version === 34) return applyOpenRunConstraint(db);
  db.exec(sql);
}

/** Work that runs after a migration is recorded, keyed by version. */
export function afterStudioMigration(db: StudioDatabase, version: number): void {
  if (version === 16 && tableExists(db, 'assets')) db.exec(SCHEMA_V16_ASSET_BACKFILL);
}
