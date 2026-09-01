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
    const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '恢复任务', idempotencyKey: 'journal-task' }).value;
    const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'journal-round' }).value;
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

test('generated media recovery rejects a malicious staged journal path outside staging', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-journal-path-'));
  const outsidePath = workspaceRoot + '-outside.png';
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '恶意路径', idempotencyKey: 'path-project' }).value;
    const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.id, name: '恶意路径', idempotencyKey: 'path-task' }).value;
    const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'path-round' }).value;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('run_bad_path', round.id, 'running', '{}', '{}', 1, now, now);
    db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('item_bad_path', 'run_bad_path', 1, 'persisting', '{}', 'request_bad_path', now, now);
    fs.writeFileSync(outsidePath, png);
    const planned = plannedArchivePath(initialized.paths, { assetId: 'asset_bad_path', bucket: 'generated', mediaType: 'image/png' });
    const outsideStoragePath = path.relative(workspaceRoot, outsidePath).split(path.sep).join('/');
    db.prepare('INSERT INTO media_commit_journal (asset_id, studio_id, staged_path, final_storage_path, media_type, content_hash, byte_size, source_json, run_id, run_item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset_bad_path', initialized.manifest.studioId, outsideStoragePath, planned.storagePath, 'image/png', require('node:crypto').createHash('sha256').update(png).digest('hex'), png.length, '{}', 'run_bad_path', 'item_bad_path', now);
    assert.equal(recoverGeneratedMediaCommits(db, initialized.paths, initialized.manifest.studioId), 0);
    assert.deepEqual(fs.readFileSync(outsidePath), png);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM media_commit_journal WHERE asset_id = ?').get('asset_bad_path').total, 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM events WHERE entity_id = ? AND event_type = 'media.commit_recovery_rejected'").get('asset_bad_path').total, 1);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outsidePath, { force: true });
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

test('reconciliation recursively quarantines same-name nested orphans without collisions', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-reconcile-nested-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const generated = path.join(initialized.paths.assetRoot, 'generated');
    const first = path.join(generated, 'a', 'nested');
    const second = path.join(generated, 'b', 'nested');
    fs.mkdirSync(first, { recursive: true });
    fs.mkdirSync(second, { recursive: true });
    fs.writeFileSync(path.join(first, 'same.png'), png);
    fs.writeFileSync(path.join(second, 'same.png'), png);
    assert.deepEqual(reconcileManagedMedia(db, initialized.paths, initialized.manifest.studioId), { quarantinedOrphans: 2, missingRows: 0 });
    const quarantined = fs.readdirSync(path.join(initialized.paths.assetRoot, 'trash')).filter((name) => name.endsWith('-same.png'));
    assert.equal(quarantined.length, 2);
    assert.equal(new Set(quarantined).size, 2);
    assert.equal(fs.existsSync(path.join(generated, 'a')), false);
    assert.deepEqual(reconcileManagedMedia(db, initialized.paths, initialized.manifest.studioId), { quarantinedOrphans: 0, missingRows: 0 });
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('reconciliation rejects symlinked asset and bucket roots without traversing outside', { skip: process.platform === 'win32' }, () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-reconcile-symlink-'));
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-reconcile-symlink-outside-'));
  const sentinelPath = path.join(outsideRoot, 'sentinel.png');
  fs.writeFileSync(sentinelPath, png);
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    fs.symlinkSync(outsideRoot, initialized.paths.assetRoot);
    assert.throws(() => reconcileManagedMedia(db, initialized.paths, initialized.manifest.studioId), /symbolic links/);
    assert.deepEqual(fs.readFileSync(sentinelPath), png);

    fs.unlinkSync(initialized.paths.assetRoot);
    fs.mkdirSync(initialized.paths.assetRoot);
    fs.symlinkSync(outsideRoot, path.join(initialized.paths.assetRoot, 'generated'));
    assert.throws(() => reconcileManagedMedia(db, initialized.paths, initialized.manifest.studioId), /symbolic links/);
    assert.deepEqual(fs.readFileSync(sentinelPath), png);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('generated media recovery retains a journal whose run item belongs to another Studio', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-journal-cross-studio-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const now = new Date().toISOString();
    const foreignStudioId = 'studio_foreign_journal';
    db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(foreignStudioId, workspaceRoot + '-foreign', 16, now, now);
    const project = createProject(db, { studioId: foreignStudioId, name: 'Foreign project', idempotencyKey: 'foreign-journal-project' }).value;
    const task = createTaskDraft(db, { studioId: foreignStudioId, projectId: project.id, name: 'Foreign task', idempotencyKey: 'foreign-journal-task' }).value;
    const round = createRoundDraft(db, { studioId: foreignStudioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'foreign-journal-round' }).value;
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('run_foreign_journal', round.id, 'running', '{}', '{}', 1, now, now);
    db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('item_foreign_journal', 'run_foreign_journal', 1, 'persisting', '{}', 'request_foreign_journal', now, now);
    const staged = stageImage(initialized.paths, png, 'image/png');
    const planned = plannedArchivePath(initialized.paths, { assetId: 'asset_cross_studio_journal', bucket: 'generated', mediaType: staged.mediaType });
    db.prepare('INSERT INTO media_commit_journal (asset_id, studio_id, staged_path, final_storage_path, media_type, content_hash, byte_size, source_json, run_id, run_item_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset_cross_studio_journal', initialized.manifest.studioId, path.relative(workspaceRoot, staged.stagingPath).split(path.sep).join('/'), planned.storagePath, staged.mediaType, staged.contentHash, staged.byteSize, '{}', 'run_foreign_journal', 'item_foreign_journal', now);

    assert.equal(recoverGeneratedMediaCommits(db, initialized.paths, initialized.manifest.studioId), 0);
    assert.equal(fs.existsSync(staged.stagingPath), true);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM media_commit_journal WHERE asset_id = ?').get('asset_cross_studio_journal').total, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM assets WHERE id = ?').get('asset_cross_studio_journal').total, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM asset_relations WHERE target_type = 'run_item' AND target_id = ?").get('item_foreign_journal').total, 0);
    const rejection = db.prepare("SELECT payload_json FROM events WHERE entity_id = ? AND event_type = 'media.commit_recovery_rejected'").get('asset_cross_studio_journal');
    assert.deepEqual(JSON.parse(rejection.payload_json), { reason: 'invalid_run_chain' });
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
