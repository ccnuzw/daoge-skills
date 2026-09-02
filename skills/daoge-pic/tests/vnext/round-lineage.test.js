const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject, createRoundDraft, createTaskDraft } = require('../../dist/vnext/domain/studio-commands');




test('round lineage requires an existing parent in the same creative task', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-round-lineage-'));
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'Lineage project', idempotencyKey: 'lineage-project' }).value;
    const taskA = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: 'Task A', idempotencyKey: 'lineage-task-a' }).value;
    const taskB = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: 'Task B', idempotencyKey: 'lineage-task-b' }).value;
    const parent = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: taskA.id, purpose: 'exploration', idempotencyKey: 'lineage-parent' }).value;
    const child = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: taskA.id, purpose: 'variation', parentRoundId: parent.id, idempotencyKey: 'lineage-child' }).value;
    assert.equal(child.parentRoundId, parent.id);
    assert.throws(() => createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: taskA.id, purpose: 'variation', parentRoundId: 'round_missing', idempotencyKey: 'lineage-missing' }), /Parent creative round not found/);
    assert.throws(() => createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: taskB.id, purpose: 'variation', parentRoundId: parent.id, idempotencyKey: 'lineage-cross-task' }), /Parent creative round must belong to the same task/);
  } finally {
    if (db) closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
