const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { configureProvider } = require('./provider-test-helper');
const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const { createDryRunPreview, queueGenerationRun, listGenerationRunItems } = require('../../dist/vnext/runner/run-commands');
const { attributeOutputAsset, attributeImportedAssetProject, projectIdForRun } = require('../../dist/vnext/domain/output-attribution');

/**
 * 产出归属（方案 7.7.1 / 7.2，施工单 A11）。
 *
 * 「这张图属于哪个项目」过去要跳五跳才查得到；现在产出图落库即写死 `assets.project_id`。
 * 「这个槽位产出了哪张图」过去藏在 `run_items.result_json` 里；现在是 `asset_id` 列，
 * 空槽 = `asset_id IS NULL`。
 *
 * 两条写的都必须**幂等且不可覆盖**：重跑或复用同一张图，不能把图挪到别的项目，
 * 也不能覆盖槽位的第一个产出。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-attribution-'));
}

function setupRun() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const { config, status } = configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'memory-only-key' });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const project = createProject(db, { studioId, name: '归属项目', idempotencyKey: 'project' }).value;
  const otherProject = createProject(db, { studioId, name: '另一个项目', idempotencyKey: 'other-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: '任务', idempotencyKey: 'task' }).value;
  const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'round' }).value;
  const prepared = prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan: { operation: 'generate', itemCount: 1, prompt: 'one image' }, expectedVersion: round.version, idempotencyKey: 'prepare' }).value;
  const confirmed = confirmRoundPlan(db, { studioId, roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'confirm' }).value;
  const dryRun = createDryRunPreview(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, idempotencyKey: 'dry-run' }).value;
  const run = queueGenerationRun(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, preflightId: dryRun.preview.id, idempotencyKey: 'run' }).value;
  const item = listGenerationRunItems(db, run.id)[0];
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset_attr_1', studioId, 'generated', 'image/png', 'daoge-assets/generated/asset_attr_1.png', 'hash-attr-1', 10, '{}', timestamp, timestamp);
  db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset_attr_2', studioId, 'generated', 'image/png', 'daoge-assets/generated/asset_attr_2.png', 'hash-attr-2', 10, '{}', timestamp, timestamp);
  return { workspaceRoot, initialized, db, studioId, project, otherProject, run, item };
}

function dispose(fixture) {
  closeStudioDatabase(fixture.db);
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

test('产出图落库即写死项目，槽位直连 asset_id（不再解析 result_json）', () => {
  const fixture = setupRun();
  try {
    assert.equal(fixture.db.prepare('SELECT project_id FROM assets WHERE id = ?').get('asset_attr_1').project_id, null);
    assert.equal(fixture.db.prepare('SELECT asset_id FROM run_items WHERE id = ?').get(fixture.item.id).asset_id, null);
    attributeOutputAsset(fixture.db, { studioId: fixture.studioId, assetId: 'asset_attr_1', runId: fixture.run.id, runItemId: fixture.item.id });
    assert.equal(fixture.db.prepare('SELECT project_id FROM assets WHERE id = ?').get('asset_attr_1').project_id, fixture.project.id);
    assert.equal(fixture.db.prepare('SELECT asset_id FROM run_items WHERE id = ?').get(fixture.item.id).asset_id, 'asset_attr_1');
    assert.equal(projectIdForRun(fixture.db, fixture.studioId, fixture.run.id), fixture.project.id);
  } finally {
    dispose(fixture);
  }
});

test('重跑或复用不能挪动项目、也不能覆盖槽位的第一个产出', () => {
  const fixture = setupRun();
  try {
    attributeOutputAsset(fixture.db, { studioId: fixture.studioId, assetId: 'asset_attr_1', runId: fixture.run.id, runItemId: fixture.item.id });
    // 第二次带着另一个资产进来：槽位已有产出，不允许被改写。
    attributeOutputAsset(fixture.db, { studioId: fixture.studioId, assetId: 'asset_attr_2', runId: fixture.run.id, runItemId: fixture.item.id });
    assert.equal(fixture.db.prepare('SELECT asset_id FROM run_items WHERE id = ?').get(fixture.item.id).asset_id, 'asset_attr_1', '第一个产出必须留住');
    // 图已有项目归属，不允许被挪走。
    attributeImportedAssetProject(fixture.db, { studioId: fixture.studioId, assetId: 'asset_attr_1', projectId: fixture.otherProject.id });
    assert.equal(fixture.db.prepare('SELECT project_id FROM assets WHERE id = ?').get('asset_attr_1').project_id, fixture.project.id, '已有归属的图不能被挪到别的项目');
  } finally {
    dispose(fixture);
  }
});

test('跨 Studio 的调用什么都不写：项目按 run 链推导，链不匹配即拒绝', () => {
  const fixture = setupRun();
  try {
    assert.equal(projectIdForRun(fixture.db, 'studio_other', fixture.run.id), null);
    attributeOutputAsset(fixture.db, { studioId: 'studio_other', assetId: 'asset_attr_1', runId: fixture.run.id, runItemId: fixture.item.id });
    assert.equal(fixture.db.prepare('SELECT project_id FROM assets WHERE id = ?').get('asset_attr_1').project_id, null, 'Studio 不匹配时不得写归属');
    assert.equal(fixture.db.prepare('SELECT asset_id FROM run_items WHERE id = ?').get(fixture.item.id).asset_id, null, 'Studio 不匹配时也不得认领槽位');
  } finally {
    dispose(fixture);
  }
});
