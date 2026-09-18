const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase, STUDIO_SCHEMA_VERSION } = require('../../dist/vnext/studio/database');

/**
 * Schema 重建契约（规格书 §4 / 方案 7.1–7.5 / 7.7.1 / 7.7.3 / 施工单 0.3 第 6 条）。
 *
 * 本批是新库的一次性骨架重建：新表两张（studio_requests / studio_agents），
 * 五处既有表改造（assets / run_items / canvas_layouts / canvas_node_layouts / studio_sessions），
 * 外加搜索索引重建。这一组断言「结构真的到了」，不是「代码里写了」。
 *
 * 先写桩：现在这些表和列都还不存在，红是预期的。
 */

function temporaryStudio() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-schema2-'));
  const initialized = initializeStudio({ workspaceRoot: root });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  return { root, db };
}

function dispose(studio) {
  closeStudioDatabase(studio.db);
  fs.rmSync(studio.root, { recursive: true, force: true });
}

function tableSql(db, table) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  return row ? row.sql : null;
}

function columns(db, table) {
  return db.prepare('PRAGMA table_info(' + table + ')').all().map((row) => row.name);
}

test('版本递增且迁移仍连续：新库从零开始，旧环境不迁移', () => {
  assert.ok(STUDIO_SCHEMA_VERSION >= 35, '本批必须递增 STUDIO_SCHEMA_VERSION（规格书 §1：从 34 递增）');
  const studio = temporaryStudio();
  try {
    const ledger = studio.db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version);
    assert.equal(ledger.length, STUDIO_SCHEMA_VERSION);
  } finally {
    dispose(studio);
  }
});

test('新增请求队列表 studio_requests：状态用列表达 + 租约字段', () => {
  const studio = temporaryStudio();
  try {
    const sql = tableSql(studio.db, 'studio_requests');
    assert.ok(sql, 'studio_requests 必须存在');
    const cols = columns(studio.db, 'studio_requests');
    for (const column of ['id', 'studio_id', 'project_id', 'task_id', 'text', 'context_json', 'status', 'lease_token', 'lease_worker_id', 'lease_expires_at', 'attempts', 'result_round_id', 'created_at', 'accepted_at', 'done_at']) {
      assert.ok(cols.includes(column), 'studio_requests 缺列 ' + column);
    }
    assert.match(sql, /status\s+[^,]*CHECK\s*\(\s*status\s+IN\s*\([^)]*pending[^)]*accepted[^)]*done[^)]*rejected[^)]*\)/i, '状态必须是列 + CHECK，不是事件回放');
  } finally {
    dispose(studio);
  }
});

test('新增 agent 在场表 studio_agents：登记带身份申报', () => {
  const studio = temporaryStudio();
  try {
    assert.ok(tableSql(studio.db, 'studio_agents'), 'studio_agents 必须存在（agent 在场需要持久化事实源）');
    const cols = columns(studio.db, 'studio_agents');
    for (const column of ['id', 'studio_id', 'cli_name', 'cli_version', 'skill_name', 'skill_version', 'capabilities_json', 'registered_at', 'last_seen_at']) {
      assert.ok(cols.includes(column), 'studio_agents 缺列 ' + column);
    }
  } finally {
    dispose(studio);
  }
});

test('资产归属升格为约束：assets.project_id 可空外键', () => {
  const studio = temporaryStudio();
  try {
    assert.ok(columns(studio.db, 'assets').includes('project_id'), 'assets 必须有 project_id（方案 7.7.1）');
  } finally {
    dispose(studio);
  }
});

test('出图槽位与产出分开：run_items.asset_id 可空外键', () => {
  const studio = temporaryStudio();
  try {
    assert.ok(columns(studio.db, 'run_items').includes('asset_id'), 'run_items 必须有 asset_id（方案 7.2：空槽 = asset_id IS NULL）');
  } finally {
    dispose(studio);
  }
});

test('画布一项目一份：canvas_layouts 删掉 scope 两列', () => {
  const studio = temporaryStudio();
  try {
    const cols = columns(studio.db, 'canvas_layouts');
    assert.equal(cols.includes('scope_type'), false, 'scope_type 必须删除（方案 7.4）');
    assert.equal(cols.includes('scope_id'), false, 'scope_id 必须删除（方案 7.4）');
    assert.match(tableSql(studio.db, 'canvas_layouts'), /UNIQUE\s*\(\s*studio_id\s*,\s*project_id\s*\)/i, '一个项目只能有一份布局');
  } finally {
    dispose(studio);
  }
});

test('画布节点枚举收敛：entity_type 只允许 task / round / asset / group', () => {
  const studio = temporaryStudio();
  try {
    const sql = tableSql(studio.db, 'canvas_node_layouts');
    const match = /entity_type\s+[^,]*CHECK\s*\(\s*entity_type\s+IN\s*\(([^)]*)\)\)/i.exec(sql);
    assert.ok(match, 'canvas_node_layouts.entity_type 必须有 CHECK');
    const values = match[1].split(',').map((value) => value.trim().replace(/^'|'$/g, '')).sort();
    assert.deepEqual(values, ['asset', 'group', 'round', 'task'], '枚举收敛到 4 项，让 CHECK 替文档挡住违规（方案 7.5）');
  } finally {
    dispose(studio);
  }
});

test('会话指针归还 agent：studio_sessions 用 agent_* 而不是 active_*', () => {
  const studio = temporaryStudio();
  try {
    const cols = columns(studio.db, 'studio_sessions');
    for (const column of ['agent_project_id', 'agent_task_id', 'agent_round_id']) {
      assert.ok(cols.includes(column), 'studio_sessions 缺列 ' + column);
    }
    for (const column of ['active_project_id', 'active_task_id', 'active_round_id']) {
      assert.equal(cols.includes(column), false, column + ' 应改名归还 agent 独占（方案 7.7.3）');
    }
  } finally {
    dispose(studio);
  }
});

/**
 * 迁移必须**把已有数据搬过去**，不是只把结构改对。
 *
 * 这条是因为一个真实事故才写的：v38 重建画布时，新子表的外键写的是**旧父表名**，
 * 于是 `DROP TABLE canvas_layouts` 通过 `ON DELETE CASCADE` 把刚拷进去的
 * 节点位置**全部级联删除**——迁移静默成功，画布布局全丢。
 *
 * 原守卫只在一个**空库**上断言结构（表在、列在、枚举对），所以完全没看见。
 * 教训：结构契约要配一条「数据契约」。
 */
test('重建画布时已有节点位置必须搬过去，不能被 DROP 的级联删掉', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { initializeStudio } = require('../../dist/vnext/studio/workspace');
  const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
  const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
  const { createDryRunPreview, queueGenerationRun, listGenerationRunItems } = require('../../dist/vnext/runner/run-commands');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-canvas-migrate-'));
  // 先在 v37 上造好真实数据（v38 是画布重建那一条）。
  const initialized = initializeStudio({ workspaceRoot: root, schemaVersion: 37 });
  // ⚠️ 必须手动建到 v37 再写旧数据：`openStudioDatabase` 会立刻把 38/39 跑掉，
  // 那样就没有「旧结构」可测了。
  const DatabaseSync = require('node:sqlite').DatabaseSync;
  const { STUDIO_MIGRATIONS, dispatchStudioMigration } = require('../../dist/vnext/studio/migrations');
  let db = new DatabaseSync(initialized.paths.databasePath);
  let migrated = null;
  try {
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
    for (const migration of STUDIO_MIGRATIONS) {
      if (migration.version > 37) break;
      dispatchStudioMigration(db, migration);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
    }
    const studioId = initialized.manifest.studioId;
    db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, 37, ?, ?)').run(studioId, initialized.paths.workspaceRoot, new Date().toISOString(), new Date().toISOString());
    const project = createProject(db, { studioId, name: '迁移项目', idempotencyKey: 'migrate-project' }).value;
    const task = createTaskDraft(db, { studioId, projectId: project.id, name: '迁移任务', idempotencyKey: 'migrate-task' }).value;
    const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'migrate-round' }).value;
    const timestamp = new Date().toISOString();
    db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('asset_migrate_1', studioId, 'import', 'image/png', 'daoge-assets/imports/asset_migrate_1.png', 'hash-migrate-1', 10, '{}', timestamp, timestamp);
    // 旧模型：一个项目一份 project 作用域布局 + 一条 round 作用域布局。
    db.prepare("INSERT INTO canvas_layouts (id, studio_id, project_id, scope_type, scope_id, viewport_json, settings_json, version, created_at, updated_at) VALUES ('layout_project', ?, ?, 'project', ?, '{}', '{}', 1, ?, ?)").run(studioId, project.id, project.id, timestamp, timestamp);
    db.prepare("INSERT INTO canvas_layouts (id, studio_id, project_id, scope_type, scope_id, viewport_json, settings_json, version, created_at, updated_at) VALUES ('layout_round', ?, ?, 'round', ?, '{}', '{}', 1, ?, ?)").run(studioId, project.id, round.id, timestamp, timestamp);
    const insertNode = db.prepare('INSERT INTO canvas_node_layouts (id, layout_id, entity_type, entity_id, x, y, width, height, collapsed, group_id, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)');
    insertNode.run('node_task', 'layout_project', 'task', task.id, 10, 20, 240, 110, timestamp);
    insertNode.run('node_round', 'layout_project', 'round', round.id, 300, 20, 238, 108, timestamp);
    insertNode.run('node_asset', 'layout_project', 'asset', 'asset_migrate_1', 600, 20, 174, 220, timestamp);
    insertNode.run('node_project', 'layout_project', 'project', project.id, 0, 0, 250, 112, timestamp);
    insertNode.run('node_run_item', 'layout_project', 'run_item', task.id, 0, 0, 210, 102, timestamp);
    db.prepare("INSERT INTO canvas_groups (id, layout_id, title, group_type, x, y, width, height, metadata_json, created_at, updated_at) VALUES ('group_keep', 'layout_project', '这一批', 'round', 0, 0, 100, 100, '{}', ?, ?)").run(timestamp, timestamp);
    db.prepare("INSERT INTO canvas_links (id, layout_id, source_type, source_id, target_type, target_id, link_type, label, metadata_json, created_at, updated_at) VALUES ('link_keep', 'layout_project', 'asset', 'asset_migrate_1', 'round', ?, 'reference', '参考自', '{}', ?, ?)").run(round.id, timestamp, timestamp);
    db.prepare("INSERT INTO canvas_links (id, layout_id, source_type, source_id, target_type, target_id, link_type, label, metadata_json, created_at, updated_at) VALUES ('link_drop', 'layout_project', 'project', ?, 'run', 'x', 'custom', '旧类型', '{}', ?, ?)").run(project.id, timestamp, timestamp);
    // 旧结构里的「产出」只有关系表记得：新列必须能从它回填（v40）。
    const prepared = prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan: { operation: 'generate', itemCount: 1, prompt: '旧数据回填用提示词' }, expectedVersion: round.version, idempotencyKey: 'migrate-prepare' }).value;
    const confirmed = confirmRoundPlan(db, { studioId, roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'migrate-confirm' }).value;
    const { configureProvider } = require('./provider-test-helper');
    const { config, status } = configureProvider({ paths: initialized.paths, manifest: initialized.manifest }, { model: 'gpt-image-2', apiKey: 'memory-only-key' });
    const dryRun = createDryRunPreview(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, idempotencyKey: 'migrate-dry-run' }).value;
    const run = queueGenerationRun(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, preflightId: dryRun.preview.id, idempotencyKey: 'migrate-run' }).value;
    const item = listGenerationRunItems(db, run.id)[0];
    db.prepare("UPDATE run_items SET status = 'succeeded' WHERE id = ?").run(item.id);
    db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES ('rel_migrate_output', 'asset_migrate_1', 'output_of', 'run_item', ?, '{}', ?)").run(item.id, timestamp);
    db.close();
    db = null;

    // 重新打开 → 跑 38 / 39。
    migrated = openStudioDatabase(initialized.paths, initialized.manifest);
    assert.equal(migrated.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, STUDIO_SCHEMA_VERSION);

    const nodeIds = migrated.prepare('SELECT id FROM canvas_node_layouts ORDER BY id').all().map((row) => row.id);
    assert.deepEqual(nodeIds, ['node_asset', 'node_round', 'node_task'], '三种仍然存在的节点位置必须原样搬过去（项目/运行项节点按新枚举丢弃）');
    assert.equal(migrated.prepare("SELECT COUNT(*) AS c FROM canvas_groups WHERE id = 'group_keep'").get().c, 1, '分组必须搬过去');
    assert.equal(migrated.prepare("SELECT COUNT(*) AS c FROM canvas_links WHERE id = 'link_keep'").get().c, 1, '合法连线必须搬过去');
    assert.equal(migrated.prepare("SELECT COUNT(*) AS c FROM canvas_links WHERE id = 'link_drop'").get().c, 0, '旧类型的连线按新枚举丢弃');
    // 收敛：一个项目一份布局。
    assert.equal(migrated.prepare('SELECT COUNT(*) AS c FROM canvas_layouts').get().c, 1);
    assert.equal(migrated.prepare('SELECT COUNT(*) AS c FROM canvas_layouts WHERE project_id = ?').get(project.id).c, 1);
    assert.equal(migrated.prepare('PRAGMA foreign_key_check').all().length, 0, '重建后不得有外键违规');

    // 数据契约（v40）：迁移不只是把列加上，还要让旧数据在新列上「为真」。
    assert.equal(migrated.prepare('SELECT asset_id FROM run_items WHERE id = ?').get(item.id).asset_id, 'asset_migrate_1', '旧槽位的产出必须从关系表回填到 asset_id');
    assert.equal(migrated.prepare('SELECT project_id FROM assets WHERE id = ?').get('asset_migrate_1').project_id, project.id, '旧产出图的项目归属必须从 run 链回填');
    const indexed = migrated.prepare("SELECT content FROM studio_search WHERE entity_type = 'asset' AND entity_id = 'asset_migrate_1'").get();
    assert.ok(indexed, '旧图必须进搜索索引（否则升级后一张图都搜不到）');
    assert.match(indexed.content, /旧数据回填用提示词/, '索引内容要带上来源批次的提示词');
  } finally {
    if (db) db.close();
    if (migrated) closeStudioDatabase(migrated);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
