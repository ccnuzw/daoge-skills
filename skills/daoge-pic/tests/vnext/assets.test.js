const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject } = require('../../dist/vnext/domain/studio-commands');
const { importStudioAsset, listStudioAssets, assetFilePath, recoverAssetMediaOperations, softDeleteAsset, restoreAsset, setReviewDecision } = require('../../dist/vnext/domain/assets');
const { archiveStagedImage, plannedArchivePath, stageImage } = require('../../dist/vnext/media/archive');

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

test('imports global assets once and relates them to projects without duplicated files', () => {
  const value = fixture();
  try {
    const first = importStudioAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, bytes: png, mediaType: 'image/png', originalFilename: 'brand-logo.png', targetType: 'project', targetId: value.project.value.id, source: { channel: 'drop' } });
    const second = importStudioAsset(value.db, value.initialized.paths, { studioId: value.initialized.manifest.studioId, bytes: png, mediaType: 'image/png', targetType: 'project', targetId: value.project.value.id, source: { channel: 'clipboard' } });
    assert.equal(second.id, first.id);
    assert.equal(listStudioAssets(value.db, value.initialized.manifest.studioId).length, 1);
    assert.equal(listStudioAssets(value.db, value.initialized.manifest.studioId, { targetType: 'project', targetId: value.project.value.id }).length, 1);
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
