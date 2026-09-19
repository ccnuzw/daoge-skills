const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject } = require('../../dist/vnext/domain/studio-commands');

/**
 * 产出归属**读侧**的守卫（方案 7.7.1 · 第 2 批 A11 遗留 · 施工单 T1 · 决策 D4）。
 *
 * 第 2 批把归属从「关系表拼五跳」升格为 `assets.project_id` 列，但**只做了写入侧**；
 * 读侧仍拼五跳。本守卫锁住读侧以列为准：`assetBelongsToProject` 只认 `project_id`。
 *
 * 这是**对拍**思路：归属结果必须与写入侧一致，且不依赖关系链是否还在。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-attribution-read-'));
}

function readModule() {
  try {
    return require('../../dist/vnext/domain/output-attribution');
  } catch (error) {
    assert.fail('归属读侧模块尚未实现：src/vnext/domain/output-attribution.ts（' + error.code + '）');
  }
}

function setup() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const project = createProject(db, { studioId, name: '读侧项目', idempotencyKey: 'read-project' }).value;
  const otherProject = createProject(db, { studioId, name: '别的项目', idempotencyKey: 'read-other-project' }).value;
  const timestamp = new Date().toISOString();
  for (const id of ['asset_read_1', 'asset_read_2']) {
    db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, studioId, 'generated', 'image/png', 'daoge-assets/generated/' + id + '.png', 'hash-' + id, 10, '{}', timestamp, timestamp);
  }
  return { workspaceRoot, db, studioId, project, otherProject };
}

function dispose(fixture) {
  closeStudioDatabase(fixture.db);
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

test('归属读侧只认列：写死的 project_id 说了算', () => {
  const mod = readModule();
  if (typeof mod.assetBelongsToProject !== 'function') assert.fail('归属读侧尚未实现：output-attribution 的 assetBelongsToProject');
  const fixture = setup();
  try {
    const { attributeImportedAssetProject } = require('../../dist/vnext/domain/output-attribution');
    assert.equal(mod.assetBelongsToProject(fixture.db, { studioId: fixture.studioId, assetId: 'asset_read_1', projectId: fixture.project.id }), false, '还没归属时不算属于');
    attributeImportedAssetProject(fixture.db, { studioId: fixture.studioId, assetId: 'asset_read_1', projectId: fixture.project.id });
    assert.equal(mod.assetBelongsToProject(fixture.db, { studioId: fixture.studioId, assetId: 'asset_read_1', projectId: fixture.project.id }), true);
    assert.equal(mod.assetBelongsToProject(fixture.db, { studioId: fixture.studioId, assetId: 'asset_read_1', projectId: fixture.otherProject.id }), false, '别的项目不算');
    assert.equal(mod.assetBelongsToProject(fixture.db, { studioId: fixture.studioId, assetId: 'asset_read_2', projectId: fixture.project.id }), false, '没归属的图不算');
  } finally {
    dispose(fixture);
  }
});

test('项目读取对拍：列优先，列为空才回退关系链，且列能压过关系', () => {
  const { listScopedStudioAssets } = require('../../dist/vnext/domain/assets');
  const fixture = setup();
  try {
    const { attributeImportedAssetProject } = require('../../dist/vnext/domain/output-attribution');
    const link = (assetId, projectId) => fixture.db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, 'attached_to', 'project', ?, '{}', ?)")
      .run('rel_' + assetId + '_' + projectId, assetId, projectId, new Date().toISOString());
    // a1：只有列（无关系）→ 必须被读到（这正是迁移要的那条路）
    attributeImportedAssetProject(fixture.db, { studioId: fixture.studioId, assetId: 'asset_read_1', projectId: fixture.project.id });
    // a2：列为空 + 有 attached_to 关系 → 回退分支必须仍然读到（历史行不丢）
    link('asset_read_2', fixture.project.id);
    // a3：列指向别的项目 + 关系指向本项目 → **列赢**，不应出现在本项目
    fixture.db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, project_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('asset_read_3', fixture.studioId, 'generated', 'image/png', 'daoge-assets/generated/asset_read_3.png', 'hash-asset_read_3', 10, '{}', fixture.otherProject.id, new Date().toISOString(), new Date().toISOString());
    link('asset_read_3', fixture.project.id);
    const ids = listScopedStudioAssets(fixture.db, fixture.studioId, { scope: 'project', projectId: fixture.project.id }).map((asset) => asset.id).sort();
    assert.deepEqual(ids, ['asset_read_1', 'asset_read_2'], '列优先、空列回退、列压过关系');
  } finally {
    dispose(fixture);
  }
});