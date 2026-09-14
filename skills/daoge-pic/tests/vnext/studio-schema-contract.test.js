const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, migrateStudioDatabase, openStudioDatabase, STUDIO_SCHEMA_VERSION, studioSchemaVersion } = require('../../dist/vnext/studio/database');
const { applyStudioMigration, dispatchStudioMigration, STUDIO_MIGRATIONS } = require('../../dist/vnext/studio/migrations');
const { ROUND_PURPOSES } = require('../../dist/vnext/domain/studio-commands');
const { ASSET_KINDS } = require('../../dist/vnext/domain/assets');

function workspaceRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-schema-'));
}

test('custom migration hooks are dispatched and false keeps a migration pending', () => {
  const root = workspaceRoot();
  const initialized = initializeStudio({ workspaceRoot: root });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    let called = 0;
    const migration = { version: 999, sql: "SELECT RAISE(ABORT, 'sql fallback must not run')", apply() { called += 1; return false; } };
    assert.equal(dispatchStudioMigration(db, migration), false);
    assert.equal(called, 1);
    const successful = { version: 1000, sql: "SELECT RAISE(ABORT, 'sql fallback must not run')", apply() { called += 1; } };
    assert.equal(dispatchStudioMigration(db, successful), true);
    assert.equal(called, 2);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('v17 to v18 rebuilds an existing runtime settings table and permits the widened limit', () => {
  const DatabaseSync = require('node:sqlite').DatabaseSync;
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE studios (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio-v17', '/tmp/studio-v17', 17, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    db.exec("CREATE TABLE studio_runtime_settings (studio_id TEXT PRIMARY KEY REFERENCES studios(id), max_worker_concurrency INTEGER NOT NULL CHECK (max_worker_concurrency BETWEEN 1 AND 100), updated_at TEXT NOT NULL)");
    db.prepare('INSERT INTO studio_runtime_settings (studio_id, max_worker_concurrency, updated_at) VALUES (?, ?, ?)').run('studio-v17', 100, '2026-01-01T00:00:00.000Z');
    applyStudioMigration(db, 18, '');
    db.prepare('UPDATE studio_runtime_settings SET max_worker_concurrency = ?, updated_at = ? WHERE studio_id = ?').run(1000, '2026-01-01T00:00:00.000Z', 'studio-v17');
    assert.equal(db.prepare('SELECT max_worker_concurrency FROM studio_runtime_settings WHERE studio_id = ?').get('studio-v17').max_worker_concurrency, 1000);
  } finally {
    db.close();
  }
});

test('migrations form a contiguous, unique sequence ending at the current schema version', () => {
  const versions = STUDIO_MIGRATIONS.map((migration) => migration.version);
  assert.deepEqual(versions, Array.from({ length: versions.length }, (_, index) => index + 1), 'versions must be 1..N with no gaps or duplicates');
  assert.equal(versions[versions.length - 1], STUDIO_SCHEMA_VERSION, 'adding a migration without bumping STUDIO_SCHEMA_VERSION would leave it unapplied');
  assert.deepEqual([...new Set(versions)], versions);
});

test('a freshly opened Studio records every migration and reports the current version', () => {
  const root = workspaceRoot();
  const initialized = initializeStudio({ workspaceRoot: root });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    assert.equal(studioSchemaVersion(db), STUDIO_SCHEMA_VERSION);
    const ledger = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version);
    assert.deepEqual(ledger, Array.from({ length: STUDIO_SCHEMA_VERSION }, (_, index) => index + 1));
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('migrating twice changes nothing: the ledger and the schema are stable', () => {
  const root = workspaceRoot();
  const initialized = initializeStudio({ workspaceRoot: root });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const before = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    migrateStudioDatabase(db);
    migrateStudioDatabase(db);
    const after = db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all();
    assert.deepEqual(after, before, 'a second migration must not recreate or alter anything');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get().count, STUDIO_SCHEMA_VERSION);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/**
 * SQLite CHECK constraints are the only place several enumerations are written
 * down twice — once in SQL, once in TypeScript. Extending one without the other
 * is invisible until a command writes a row the database refuses, so the pairs
 * are compared against the live schema. (Removing the CHECKs entirely would
 * need a table rebuild on every existing Studio, which is the reason they stay
 * and are kept in step instead.)
 */
function checkValues(db, table, column) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  assert.ok(row && row.sql, 'table ' + table + ' should exist');
  const match = new RegExp(column + "\\s+[^,]*CHECK\\s*\\(\\s*" + column + "\\s+IN\\s*\\(([^)]*)\\)\\)", 'i').exec(row.sql);
  assert.ok(match, 'expected a CHECK on ' + table + '.' + column);
  return match[1].split(',').map((value) => value.trim().replace(/^'|'$/g, '')).sort();
}

test('round purposes accepted in code match the database CHECK', () => {
  const root = workspaceRoot();
  const initialized = initializeStudio({ workspaceRoot: root });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    assert.deepEqual(checkValues(db, 'creative_rounds', 'purpose'), [...ROUND_PURPOSES].sort());
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('asset kinds accepted in code match the database CHECK', () => {
  const root = workspaceRoot();
  const initialized = initializeStudio({ workspaceRoot: root });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    assert.deepEqual(checkValues(db, 'assets', 'kind'), [...ASSET_KINDS].sort());
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
