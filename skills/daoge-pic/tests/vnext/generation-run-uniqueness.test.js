const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase, studioSchemaVersion } = require('../../dist/vnext/studio/database');
const { createProject, createRoundDraft, createTaskDraft } = require('../../dist/vnext/domain/studio-commands');
const { OPEN_RUN_STATUSES } = require('../../dist/vnext/domain/states');

function studioFixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-runs-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const project = createProject(db, { studioId: initialized.manifest.studioId, name: '约束项目', idempotencyKey: 'constraint-project' }).value;
  const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '约束任务', idempotencyKey: 'constraint-task' }).value;
  const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'constraint-round' }).value;
  return { db, roundId: round.id };
}

function insertRun(db, id, roundId, status) {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(id, roundId, status, '{}', '{}', now, now);
}

test('a second open run for the same round is rejected by the database itself', () => {
  const { db, roundId } = studioFixture();
  try {
    insertRun(db, 'run-first', roundId, 'queued');
    assert.throws(() => insertRun(db, 'run-second', roundId, 'running'), (error) => /UNIQUE constraint failed/.test(String(error.message)));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM generation_runs WHERE round_id = ?').get(roundId).count, 1);
  } finally {
    closeStudioDatabase(db);
  }
});

test('the constraint covers every status the Studio still drives forward', () => {
  const { db, roundId } = studioFixture();
  try {
    insertRun(db, 'run-open', roundId, 'paused');
    for (const status of OPEN_RUN_STATUSES) {
      assert.throws(() => insertRun(db, 'run-conflict-' + status, roundId, status), /UNIQUE constraint failed/, 'status ' + status + ' must still own the round');
    }
  } finally {
    closeStudioDatabase(db);
  }
});

test('a finished or parked run does not block the history this database already contains', () => {
  const { db, roundId } = studioFixture();
  try {
    // Real Studio databases hold rounds that were re-run after ending in
    // `partial` or `failed`. A full UNIQUE(round_id) would refuse to migrate
    // them; the partial index must not.
    insertRun(db, 'run-partial-a', roundId, 'partial');
    insertRun(db, 'run-partial-b', roundId, 'partial');
    insertRun(db, 'run-completed', roundId, 'completed');
    insertRun(db, 'run-failed', roundId, 'failed');
    insertRun(db, 'run-cancelled', roundId, 'cancelled');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM generation_runs WHERE round_id = ?').get(roundId).count, 5);
    insertRun(db, 'run-queued', roundId, 'queued');
    assert.throws(() => insertRun(db, 'run-queued-again', roundId, 'queued'), /UNIQUE constraint failed/);
  } finally {
    closeStudioDatabase(db);
  }
});

test('a falsely completed conflicting v34 database becomes pending, then repairs without losing history', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-runs-conflict-'));
  const initialized = initializeStudio({ workspaceRoot, schemaVersion: 33 });
  let db = openStudioDatabase(initialized.paths, initialized.manifest);
  const project = createProject(db, { studioId: initialized.manifest.studioId, name: '冲突项目', idempotencyKey: 'conflict-project' }).value;
  const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '冲突任务', idempotencyKey: 'conflict-task' }).value;
  const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'conflict-round' }).value;
  // Simulate the broken legacy state: v34 is in the ledger even though its
  // unique index is absent, allowing conflicting open runs to exist.
  db.exec('DROP INDEX IF EXISTS idx_generation_runs_round_open');
  assert.equal(studioSchemaVersion(db), 34);
  insertRun(db, 'run-legacy-a', round.id, 'queued');
  insertRun(db, 'run-legacy-b', round.id, 'queued');
  closeStudioDatabase(db);

  const warnings = [];
  const onWarning = (warning) => warnings.push(warning);
  process.on('warning', onWarning);
  try {
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    // process.emitWarning delivers on the next tick.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.removeListener('warning', onWarning);
  }
  try {
    assert.equal(studioSchemaVersion(db), 33, 'v34 must remain pending rather than falsely claiming an absent index');
    assert.ok(warnings.some((warning) => warning.code === 'DAOGE_PIC_OPEN_RUN_CONFLICT'), 'the conflict must be visible rather than silently skipped');
    assert.equal(db.prepare("SELECT state FROM schema_migration_pending WHERE version = 34").get().state, 'degraded');
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'generation_runs_open_guard_insert'").get());
    assert.throws(() => insertRun(db, 'run-legacy-c', round.id, 'queued'), /already open|constraint/i);
    db.prepare("UPDATE generation_runs SET status = 'failed' WHERE id = 'run-legacy-b'").run();
    closeStudioDatabase(db);
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    assert.equal(studioSchemaVersion(db), 34, 'the next opener retries and completes v34 after repair');
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_generation_runs_round_open'").get());
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM generation_runs WHERE round_id = ?').get(round.id).count, 2, 'repair preserves both historical runs');
    assert.equal(db.prepare('SELECT 1 FROM schema_migration_pending WHERE version = 34').get(), undefined);
  } finally {
    closeStudioDatabase(db);
  }
});
