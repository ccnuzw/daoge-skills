const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { importStudioAsset } = require('../../dist/vnext/domain/assets');
const { reconcileManagedMedia, recoverGeneratedMediaCommits } = require('../../dist/vnext/media/reconcile');
const { createProject, createRoundDraft, createTaskDraft } = require('../../dist/vnext/domain/studio-commands');
const { archiveStagedImage, plannedArchivePath, stageImage } = require('../../dist/vnext/media/archive');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');


test('recovers a generated media journal after bytes were archived before the asset database commit', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-journal-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '恢复项目', idempotencyKey: 'journal-project' }).value;
    const task = createTaskDraft(db, { projectId: project.id, name: '恢复任务', idempotencyKey: 'journal-task' }).value;
    const round = createRoundDraft(db, { taskId: task.id, purpose: 'exploration', idempotencyKey: 'journal-round' }).value;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('run_journal', round.id, 'running', '{}', '{}', 1, now, now);
    db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('item_journal', 'run_journal', 1, 'persisting', '{}', 'request_journal', now, now);
    const staged = stageImage(initialized.paths, png, 'image/png');
    const planned = plannedArchivePath(initialized.paths, { assetId: 'asset_journal', bucket: 'generated', mediaType: staged.mediaType });
    db.prepare('INSERT INTO media_commit_journal (asset_id, studio_id, staged_path, final_storage_path, media_type, content_hash, byte_size, source_json, run_id, run_item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset_journal', initialized.manifest.studioId, path.relative(workspaceRoot, staged.stagingPath).split(path.sep).join('/'), planned.storagePath, staged.mediaType, staged.contentHash, staged.byteSize, JSON.stringify({ runId: 'run_journal', runItemId: 'item_journal' }), 'run_journal', 'item_journal', now);
    archiveStagedImage(initialized.paths, staged, { assetId: 'asset_journal', bucket: 'generated' });
    assert.equal(recoverGeneratedMediaCommits(db, initialized.paths, initialized.manifest.studioId), 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM media_commit_journal').get().total, 0);
    assert.equal(db.prepare('SELECT storage_path FROM assets WHERE id = ?').get('asset_journal').storage_path, planned.storagePath);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('startup media reconciliation quarantines orphan binaries and records missing database media once', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-reconcile-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png' });
    fs.rmSync(path.join(workspaceRoot, asset.storagePath));
    const orphanDir = path.join(initialized.paths.assetRoot, 'generated');
    fs.mkdirSync(orphanDir, { recursive: true });
    fs.writeFileSync(path.join(orphanDir, 'untracked.png'), png);
    const first = reconcileManagedMedia(db, initialized.paths, initialized.manifest.studioId);
    assert.deepEqual(first, { quarantinedOrphans: 1, missingRows: 1 });
    assert.equal(fs.existsSync(path.join(orphanDir, 'untracked.png')), false);
    assert.equal(fs.readdirSync(path.join(initialized.paths.assetRoot, 'trash')).some((name) => name.endsWith('untracked.png')), true);
    const second = reconcileManagedMedia(db, initialized.paths, initialized.manifest.studioId);
    assert.deepEqual(second, { quarantinedOrphans: 0, missingRows: 0 });
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
