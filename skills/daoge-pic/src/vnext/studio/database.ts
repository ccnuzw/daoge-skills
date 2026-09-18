import fs from 'node:fs';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { nowIso } from '../shared/ids';
import { StudioManifest, StudioPaths } from './workspace';
import { afterStudioMigration, dispatchStudioMigration, STUDIO_MIGRATIONS } from './migrations';

export const STUDIO_SCHEMA_VERSION = 41;
export const STUDIO_EVENT_RETENTION = 2000;

export type StudioDatabase = DatabaseSyncType;
type DatabaseSyncConstructor = new (path: string) => StudioDatabase;

export interface OpenStudioDatabaseOptions {
  skipIntegrityCheck?: boolean;
  attachOnly?: boolean;
}

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

function assertSupportedStudioSchema(db: StudioDatabase): void {
  const migrationsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get();
  if (migrationsTable) {
    const migration = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
    if (migration.version !== null && Number(migration.version) > STUDIO_SCHEMA_VERSION) throw new Error('Studio database schema is newer than this DAOGE Pic runtime supports.');
  }
  const studiosTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studios'").get();
  if (studiosTable) {
    const studio = db.prepare('SELECT MAX(schema_version) AS version FROM studios').get() as { version: number | null };
    if (studio.version !== null && Number(studio.version) > STUDIO_SCHEMA_VERSION) throw new Error('Studio manifest schema is newer than this DAOGE Pic runtime supports.');
  }
}
const REQUIRED_SCHEMA_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  studios: ['id', 'workspace_root', 'schema_version'],
  studio_sessions: ['id', 'studio_id', 'version', 'agent_project_id', 'agent_task_id', 'agent_round_id'],
  projects: ['id', 'studio_id', 'template_id', 'template_version'],
  generation_runs: ['id', 'round_id', 'provider_profile_id', 'provider_config_version', 'usage_estimate_json'],
  run_items: ['id', 'run_id', 'status', 'lease_worker_id'],
  assets: ['id', 'studio_id', 'storage_path', 'content_hash', 'media_state', 'missing_at', 'last_verified_at'],
  asset_media_operations: ['id', 'studio_id', 'phase', 'owner_id', 'heartbeat_at'],
  usage_ledger: ['id', 'studio_id', 'unit', 'quantity', 'billing_state', 'estimate_source', 'idempotency_key'],
  confirmed_templates: ['id', 'studio_id', 'template_id', 'template_type', 'version', 'name', 'definition_json', 'source_round_id', 'source_task_id', 'source_project_id', 'source_plan_version', 'provenance_json', 'status'],
  provider_concurrency_state: ['studio_id', 'profile_id', 'config_version', 'target', 'cooldown_until_ms', 'last_adjustment_at_ms', 'last_reason', 'max_observed_rss_bytes', 'max_observed_external_bytes', 'updated_at'],
  provenance_records: ['id', 'studio_id', 'asset_id', 'delivery_id', 'canonical_json', 'retention_json', 'created_at', 'updated_at', 'content_hash', 'version_count'],
  provenance_record_versions: ['id', 'studio_id', 'record_id', 'asset_id', 'delivery_id', 'content_hash', 'canonical_json', 'retention_json', 'version_no', 'recorded_at', 'superseded_at'],
  budget_policies: ['id', 'studio_id', 'limit_cost_minor', 'cost_unit', 'mode'],
  media_commit_journal: ['asset_id', 'studio_id', 'owner_id', 'heartbeat_at'],
  delivery_export_journal: ['studio_id', 'idempotency_key', 'delivery_id'],
  canvas_layouts: ['id', 'studio_id', 'project_id', 'viewport_json', 'settings_json', 'version'],
  canvas_node_layouts: ['id', 'layout_id', 'entity_type', 'entity_id'],
  canvas_groups: ['id', 'layout_id', 'title', 'group_type'],
  canvas_links: ['id', 'layout_id', 'source_type', 'source_id', 'target_type', 'target_id', 'link_type'],
  studio_requests: ['id', 'studio_id', 'text', 'context_json', 'status', 'lease_token', 'lease_expires_at', 'attempts', 'created_at', 'updated_at'],
  studio_agents: ['id', 'studio_id', 'cli_name', 'capabilities_json', 'registered_at', 'last_seen_at'],
  events: ['id', 'studio_id', 'event_type'],
  schema_migrations: ['version', 'applied_at'],
  schema_migration_pending: ['version', 'state', 'reason', 'details_json', 'updated_at']
};

function isOpenRunMigrationPending(db: StudioDatabase): boolean {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration_pending'").get();
  if (!table) return false;
  return Boolean(db.prepare("SELECT 1 FROM schema_migration_pending WHERE version = 34 AND state = 'degraded' AND reason = 'open_run_conflict'").get());
}

/**
 * The degraded migration's version, when one is pending.
 *
 * v34 used to be the last migration, so "pending" could be spelled as
 * `STUDIO_SCHEMA_VERSION - 1`. Later migrations break that arithmetic: v34 can
 * be pending while the ledger would otherwise run past it. Read the version
 * from the marker instead of deriving it from the current schema version.
 */
function pendingMigrationVersion(db: StudioDatabase): number | null {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migration_pending'").get();
  if (!table) return null;
  const row = db.prepare("SELECT version FROM schema_migration_pending WHERE state = 'degraded' LIMIT 1").get() as { version: number } | undefined;
  return row ? Number(row.version) : null;
}

function assertOpenRunMigrationProtection(db: StudioDatabase, pending: boolean): void {
  if (pending) {
    for (const name of ['generation_runs_open_guard_insert', 'generation_runs_open_guard_update']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?").get(name)) throw new Error('Studio database pending open-run migration is missing degraded write guards.');
    }
    return;
  }
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_generation_runs_round_open'").get()) throw new Error('Studio database is missing the one-open-run-per-round constraint.');
}

function assertStudioSchemaIntegrity(db: StudioDatabase): void {
  const pendingOpenRunMigration = isOpenRunMigrationPending(db);
  const expectedVersion = pendingOpenRunMigration ? Number(pendingMigrationVersion(db)) - 1 : STUDIO_SCHEMA_VERSION;
  const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>;
  if (migrations.length !== expectedVersion || migrations.some((row, index) => Number(row.version) !== index + 1)) throw new Error('Studio database migration ledger is incomplete or non-contiguous.');
  assertOpenRunMigrationProtection(db, pendingOpenRunMigration);
  for (const [table, columns] of Object.entries(REQUIRED_SCHEMA_COLUMNS)) {
    const actual = new Set((db.prepare('PRAGMA table_info(' + table + ')').all() as Array<{ name: string }>).map((row) => row.name));
    if (columns.some((column) => !actual.has(column))) throw new Error('Studio database schema is missing required columns in ' + table + '.');
  }
  const quickCheck = db.prepare('PRAGMA quick_check').all() as Array<Record<string, unknown>>;
  if (quickCheck.some((row) => Object.values(row)[0] !== 'ok')) throw new Error('Studio database quick integrity check failed.');
  if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Studio database foreign-key integrity check failed.');
}

const COMMAND_RECEIPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const DRY_RUN_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export function pruneStudioEphemeralRecords(db: StudioDatabase, now = new Date()): { receipts: number; dryRuns: number } {
  const receiptCutoff = new Date(now.getTime() - COMMAND_RECEIPT_RETENTION_MS).toISOString();
  const dryRunCutoff = new Date(now.getTime() - DRY_RUN_RETENTION_MS).toISOString();
  return withTransaction(db, () => {
    const dryRuns = db.prepare('SELECT id FROM dry_run_previews WHERE created_at < ? LIMIT 1000').all(dryRunCutoff) as Array<{ id: string }>;
    if (dryRuns.length) {
      const placeholders = dryRuns.map(() => '?').join(', ');
      const ids = dryRuns.map((row) => row.id);
      db.prepare('DELETE FROM dry_run_items WHERE preview_id IN (' + placeholders + ')').run(...ids);
      db.prepare('DELETE FROM dry_run_previews WHERE id IN (' + placeholders + ')').run(...ids);
    }
    const receipts = db.prepare('DELETE FROM command_receipts WHERE created_at < ?').run(receiptCutoff);
    return { receipts: Number(receipts.changes), dryRuns: dryRuns.length };
  });
}

export function openStudioDatabase(paths: StudioPaths, manifest: StudioManifest, options: OpenStudioDatabaseOptions = {}): StudioDatabase {
  if (options.attachOnly) {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(paths.databasePath); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('Studio database is missing; initialize the daemon before attaching a worker.');
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Studio database must be an existing regular file.');
  } else {
    fs.mkdirSync(paths.studioDir, { recursive: true });
  }
  const DatabaseSync = loadDatabaseSync();
  const db = new DatabaseSync(paths.databasePath);
  try {
    // busy_timeout must be active before journal_mode: concurrent daemon
    // openers can otherwise fail immediately while another connection is
    // negotiating WAL or holding the migration write lock.
    db.exec(options.attachOnly
      ? 'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA synchronous = FULL;'
      : 'PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    assertSupportedStudioSchema(db);
    if (options.attachOnly) {
      const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode?: unknown } | undefined;
      if (String(journal?.journal_mode || '').toLowerCase() !== 'wal') throw new Error('Studio database requires WAL mode before a worker can attach.');
      const current = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
      const pendingVersion = pendingMigrationVersion(db);
      if (Number(current.version) !== STUDIO_SCHEMA_VERSION && !(pendingVersion !== null && Number(current.version) === pendingVersion - 1)) throw new Error('Studio database requires daemon migration before a worker can attach.');
      if (!options.skipIntegrityCheck) assertStudioSchemaIntegrity(db);
      return db;
    }
    migrateStudioDatabase(db);
    assertSupportedStudioSchema(db);
    const timestamp = nowIso();
    const currentSchemaVersion = studioSchemaVersion(db) ?? STUDIO_SCHEMA_VERSION;
    db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET workspace_root = excluded.workspace_root, schema_version = excluded.schema_version, updated_at = excluded.updated_at').run(manifest.studioId, paths.workspaceRoot, currentSchemaVersion, manifest.createdAt, timestamp);
    if (!options.skipIntegrityCheck) assertStudioSchemaIntegrity(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
export function closeStudioDatabase(db: StudioDatabase | null | undefined): void {
  if (db) db.close();
}

export function migrateStudioDatabase(db: StudioDatabase): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  assertSupportedStudioSchema(db);
  for (const migration of STUDIO_MIGRATIONS) {
    let migrationPending = false;
    withTransaction(db, () => {
      // The ledger check must happen after BEGIN IMMEDIATE. Two openers may
      // both observe an absent row before either takes the write lock; the
      // lock-local recheck ensures only the winner executes a non-idempotent
      // migration and the waiter simply observes its committed ledger row.
      const existing = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(migration.version) as { version: number } | undefined;
      if (existing) {
        // Early v34 builds warned on conflicting data but still wrote the
        // ledger row, permanently claiming an index they never installed.
        // Reconcile that false completion under the same migration lock.
        if (migration.version !== 34 || db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_generation_runs_round_open'").get()) return;
        if (!dispatchStudioMigration(db, migration)) {
          db.prepare('DELETE FROM schema_migrations WHERE version = 34').run();
          migrationPending = true;
        }
        return;
      }
      if (!dispatchStudioMigration(db, migration)) {
        migrationPending = true;
        return;
      }
      afterStudioMigration(db, migration.version);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, nowIso());
    });
    // A pending migration is a durable degraded state. Do not apply any
    // subsequent migrations until this one has succeeded on a later opener —
    // and drop any later ledger rows, so "pending at V" always means the
    // ledger is exactly 1..V-1. Later migrations are written to be idempotent
    // (CREATE IF NOT EXISTS / column-existence guards), so re-applying them
    // after the repair is safe.
    if (migrationPending) {
      db.prepare('DELETE FROM schema_migrations WHERE version > ?').run(migration.version);
      break;
    }
  }
}

const transactionDepth = new WeakMap<object, number>();
const transactionEventNotifications = new WeakMap<object, Set<string>>();
const eventListeners = new Map<string, Set<() => void>>();
const pendingEventNotifications = new Set<string>();

export function subscribeStudioEvents(studioId: string, listener: () => void): () => void {
  const listeners = eventListeners.get(studioId) || new Set<() => void>();
  listeners.add(listener);
  eventListeners.set(studioId, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) eventListeners.delete(studioId);
  };
}

function notifyStudioEvents(studioId: string): void {
  if (pendingEventNotifications.has(studioId)) return;
  pendingEventNotifications.add(studioId);
  queueMicrotask(() => {
    pendingEventNotifications.delete(studioId);
    for (const listener of eventListeners.get(studioId) || []) listener();
  });
}

export function withTransaction<T>(db: StudioDatabase, operation: () => T): T {
  const existingDepth = transactionDepth.get(db as unknown as object) || 0;
  if (existingDepth > 0) return operation();
  // Do not mark the connection as nested until BEGIN actually succeeds. If
  // SQLITE_BUSY is raised here, leaked bookkeeping would make the next call
  // run without a transaction and therefore without rollback protection.
  db.exec('BEGIN IMMEDIATE');
  transactionDepth.set(db as unknown as object, 1);
  transactionEventNotifications.set(db as unknown as object, new Set());
  try {
    const result = operation();
    db.exec('COMMIT');
    for (const studioId of transactionEventNotifications.get(db as unknown as object) || []) notifyStudioEvents(studioId);
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    transactionDepth.delete(db as unknown as object);
    transactionEventNotifications.delete(db as unknown as object);
  }
}

export function appendStudioEvent(db: StudioDatabase, input: StudioEventInput): number {
  return withTransaction(db, () => {
    const result = db.prepare('INSERT INTO events (studio_id, entity_type, entity_id, event_type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(input.studioId, input.entityType, input.entityId, input.eventType, JSON.stringify(input.payload || {}), nowIso());
    const id = Number(result.lastInsertRowid);
    const window = db.prepare('SELECT earliest_id, retained_count FROM studio_event_windows WHERE studio_id = ?').get(input.studioId) as { earliest_id: number; retained_count: number } | undefined;
    if (!window) db.prepare('INSERT INTO studio_event_windows (studio_id, earliest_id, latest_id, retained_count) VALUES (?, ?, ?, 1)').run(input.studioId, id, id);
    else if (window.retained_count < STUDIO_EVENT_RETENTION) db.prepare('UPDATE studio_event_windows SET latest_id = ?, retained_count = retained_count + 1 WHERE studio_id = ?').run(id, input.studioId);
    else {
      db.prepare('DELETE FROM events WHERE studio_id = ? AND id = ?').run(input.studioId, window.earliest_id);
      db.prepare('UPDATE studio_event_windows SET latest_id = ?, retained_count = ? WHERE studio_id = ?').run(id, STUDIO_EVENT_RETENTION, input.studioId);
    }
    const pending = transactionEventNotifications.get(db as unknown as object);
    if (pending) pending.add(input.studioId);
    return id;
  });
}

export function studioSchemaVersion(db: StudioDatabase): number | null {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number | null };
  return row.version;
}
