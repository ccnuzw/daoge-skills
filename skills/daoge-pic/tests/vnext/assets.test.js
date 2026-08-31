const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject, createRoundDraft, createTaskDraft } = require('../../dist/vnext/domain/studio-commands');
const { importStudioAsset, listScopedStudioAssets, listSharedStudioAssets, listStudioAssets, assetFilePath, recoverAssetMediaOperations, setStudioAssetShared, softDeleteAsset, restoreAsset, setReviewDecision } = require('../../dist/vnext/domain/assets');
const { archiveStagedImage, plannedArchivePath, stageImage } = require('../../dist/vnext/media/archive');
const { setProjectAssetSelected } = require('../../dist/vnext/domain/project-selections');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

function fixture() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-assets-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const project = createProject(db, { studioId: initialized.manifest.studioId, name: '资产项目', idempotencyKey: 'project' });
  return { workspaceRoot, initialized, db, project };
}

function cleanup(value) {
  closeStudioDatabase(value.db);
  fs.rmSync(value.workspaceRoot, { recursive: true, force: true });
}

test('imports project assets once and shares them only by explicit action', () => {
  const value = fixture();
  try {
    const first = importStudioAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, bytes: png, mediaType: 'image/png', originalFilename: 'brand-logo.png', targetType: 'project', targetId: value.project.value.id, source: { channel: 'drop' } });
    const second = importStudioAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: value.project.value.id, source: { channel: 'clipboard' } });
    assert.equal(second.id, first.id);
    assert.equal(listStudioAssets(value.db, value.initialized.manifest.studioId).length, 1);
    assert.equal(listStudioAssets(value.db, value.initialized.manifest.studioId, { targetType: 'project', targetId: value.project.value.id }).length, 1);
    setProjectAssetSelected(value.db, { studioId: value.initialized.manifest.studioId, projectId: value.project.value.id, assetId: first.id, selected: true });
    assert.deepEqual(listStudioAssets(value.db, value.initialized.manifest.studioId, { targetType: 'project', targetId: value.project.value.id }).map((asset) => asset.id), [first.id]);
    assert.deepEqual(listSharedStudioAssets(value.db, value.initialized.manifest.studioId), []);
    assert.deepEqual(setStudioAssetShared(value.db, { studioId: value.initialized.manifest.studioId, assetId: first.id, shared: true }), { assetId: first.id, shared: true, changed: true });
    assert.deepEqual(listSharedStudioAssets(value.db, value.initialized.manifest.studioId).map((asset) => asset.id), [first.id]);
    assert.deepEqual(setStudioAssetShared(value.db, { studioId: value.initialized.manifest.studioId, assetId: first.id, shared: false }), { assetId: first.id, shared: false, changed: true });
    assert.deepEqual(listSharedStudioAssets(value.db, value.initialized.manifest.studioId), []);
    assert.equal(fs.existsSync(assetFilePath(value.initialized.paths, first)), true);
    assert.equal(fs.readdirSync(path.join(value.workspaceRoot, 'daoge-assets', 'imports')).length, 1);
  } finally {
    cleanup(value);
  }
});


test('does not restore a deleted asset when its trash media is missing', () => {
  const value = fixture();
  try {
    const asset = importStudioAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, bytes: png, mediaType: 'image/png' });
    const trashed = softDeleteAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, assetId: asset.id });
    fs.rmSync(assetFilePath(value.initialized.paths, trashed), { force: true });
    assert.throws(() => restoreAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, assetId: asset.id }), /missing/);
    assert.ok(value.db.prepare('SELECT deleted_at FROM assets WHERE id = ?').get(asset.id).deleted_at);
  } finally { cleanup(value); }
});

test('recovers a journaled import after media moved before the database commit', () => {
  const value = fixture();
  try {
    const staged = stageImage(value.initialized.paths, png, 'image/png');
    const assetId = 'asset_import_journal';
    const planned = plannedArchivePath(value.initialized.paths, { assetId, bucket: 'imports', mediaType: staged.mediaType });
    const now = new Date().toISOString();
    value.db.prepare('INSERT INTO asset_media_operations (id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('assetop_import_journal', value.initialized.manifest.studioId, assetId, 'import', path.relative(value.workspaceRoot, staged.stagingPath).split(path.sep).join('/'), planned.storagePath, JSON.stringify({ kind: 'import', mediaType: staged.mediaType, contentHash: staged.contentHash, byteSize: staged.byteSize, source: { channel: 'recovery-test' } }), null, now);
    archiveStagedImage(value.initialized.paths, staged, { assetId, bucket: 'imports' });
    assert.equal(recoverAssetMediaOperations(value.db, value.initialized.paths, value.initialized.manifest.studioId), 1);
    assert.equal(listStudioAssets(value.db, value.initialized.manifest.studioId)[0].id, assetId);
    assert.equal(value.db.prepare('SELECT COUNT(*) AS total FROM asset_media_operations').get().total, 0);
  } finally { cleanup(value); }
});

test('soft deletes and restores assets without encoding review state in folders', () => {
  const value = fixture();
  try {
    const asset = importStudioAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: value.project.value.id });
    setReviewDecision(value.db, { studioId: value.initialized.manifest.studioId, assetId: asset.id, decision: 'keep', feedback: { composition: 'approved' } });
    assert.equal(value.db.prepare('SELECT decision FROM review_decisions WHERE asset_id = ?').get(asset.id).decision, 'keep');
    setReviewDecision(value.db, { studioId: value.initialized.manifest.studioId, assetId: asset.id, decision: 'derive', feedback: { direction: '保留构图并探索材质' } });
    const feedbackHistory = value.db.prepare('SELECT decision, feedback_json FROM review_decisions WHERE asset_id = ? ORDER BY created_at, rowid').all(asset.id);
    assert.equal(feedbackHistory.length, 2);
    assert.equal(feedbackHistory[1].decision, 'derive');
    assert.match(feedbackHistory[1].feedback_json, /探索材质/);
    const trashed = softDeleteAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, assetId: asset.id });
    assert.match(trashed.storagePath, /^daoge-assets\/trash\//);
    assert.equal(fs.existsSync(assetFilePath(value.initialized.paths, trashed)), true);
    assert.equal(listStudioAssets(value.db, value.initialized.manifest.studioId).length, 0);
    assert.deepEqual(listStudioAssets(value.db, value.initialized.manifest.studioId, { deletedOnly: true }).map((item) => item.id), [asset.id]);
    assert.deepEqual(listScopedStudioAssets(value.db, value.initialized.manifest.studioId, { scope: 'project', projectId: value.project.value.id, deletedOnly: true }).map((item) => item.id), [asset.id]);
    const restored = restoreAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, assetId: asset.id });
    assert.match(restored.storagePath, /^daoge-assets\/imports\//);
    assert.equal(restored.deletedAt, null);
    assert.equal(fs.existsSync(assetFilePath(value.initialized.paths, restored)), true);
    assert.equal(fs.existsSync(path.join(value.workspaceRoot, 'daoge-assets', 'selected')), false);
    assert.equal(fs.existsSync(path.join(value.workspaceRoot, 'daoge-assets', 'review')), false);
  } finally {
    cleanup(value);
  }
});

test('lists assets by round, task, project, and Studio without cross-project leakage or duplicates', () => {
  const value = fixture();
  try {
    const projectId = value.project.value.id;
    const task = createTaskDraft(value.db, { projectId, name: '范围任务', intent: {}, idempotencyKey: 'scope-task' }).value;
    const round = createRoundDraft(value.db, { taskId: task.id, purpose: 'exploration', plan: {}, idempotencyKey: 'scope-round' }).value;
    const otherProject = createProject(value.db, { studioId: value.initialized.manifest.studioId, name: '另一项目', idempotencyKey: 'scope-project-b' }).value;
    const createdAt = new Date().toISOString();
    const addAsset = (id, relationType, targetType, targetId) => {
      value.db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, value.initialized.manifest.studioId, 'generated', 'image/png', 'daoge-assets/generated/' + id + '.png', 'hash-' + id, 1, '{}', createdAt, createdAt);
      value.db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('relation-' + id, id, relationType, targetType, targetId, '{}', createdAt);
    };
    value.db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('run_scope', round.id, 'completed', '{}', '{}', createdAt, createdAt);
    value.db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('item_scope', 'run_scope', 1, 'succeeded', '{}', 'request_scope', 1, createdAt, createdAt);
    addAsset('asset_project', 'attached_to', 'project', projectId);
    addAsset('asset_task', 'attached_to', 'creative_task', task.id);
    addAsset('asset_round', 'attached_to', 'creative_round', round.id);
    addAsset('asset_output', 'output_of', 'run_item', 'item_scope');
    value.db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('relation-output-duplicate', 'asset_output', 'attached_to', 'run_item', 'item_scope', '{}', createdAt);
    addAsset('asset_other_project', 'attached_to', 'project', otherProject.id);
    const ids = (scope) => listScopedStudioAssets(value.db, value.initialized.manifest.studioId, scope).map((asset) => asset.id).sort();
    assert.deepEqual(ids({ scope: 'round', projectId, taskId: task.id, roundId: round.id }), ['asset_output', 'asset_round']);
    assert.deepEqual(ids({ scope: 'task', projectId, taskId: task.id }), ['asset_output', 'asset_round', 'asset_task']);
    assert.deepEqual(ids({ scope: 'project', projectId }), ['asset_output', 'asset_project', 'asset_round', 'asset_task']);
    assert.deepEqual(ids({ scope: 'studio' }), ['asset_other_project', 'asset_output', 'asset_project', 'asset_round', 'asset_task']);
    assert.throws(() => listScopedStudioAssets(value.db, value.initialized.manifest.studioId, { scope: 'round', projectId: otherProject.id, taskId: task.id, roundId: round.id }), /not part/);
  } finally {
    cleanup(value);
  }
});
