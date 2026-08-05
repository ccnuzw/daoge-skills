const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTempDir } = require('../helpers/workspace_v2_test_utils');
const {
  initializeProject,
  openProjectDatabase,
  all,
  get,
  run,
  upsertRun,
  upsertPrompt,
  upsertRunItem,
  upsertAsset,
  upsertIssue,
  appendEvent,
} = require('../../src/db/repository');
const { projectDbPath, loadSqlite } = require('../../src/db/connection');
const { writeTinyPng } = require('../helpers/workspace_v2_test_utils');

function sqliteModule() {
  try {
    return loadSqlite();
  } catch {
    return null;
  }
}

function sqliteAvailable() {
  return sqliteModule() !== null;
}

test('db schema can create, migrate and read key records', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'DB contract' });
  assert.equal(fs.existsSync(path.join(outputDir, 'daoge.db')), true);
  const db = openProjectDatabase(outputDir);
  const tables = all(db, "SELECT name FROM sqlite_master WHERE type = 'table'", []).map((row) => row.name);
  [
    'schema_migrations',
    'projects',
    'runs',
    'run_items',
    'prompts',
    'assets',
    'run_assets',
    'asset_links',
    'issues',
    'selections',
    'tags',
    'asset_tags',
    'exports',
    'jobs',
    'events',
    'settings',
  ].forEach((name) => assert.equal(tables.includes(name), true, `missing ${name}`));
  const runId = upsertRun(db, project.projectId, { phase: 'prepare', title: '测试任务', promptCount: 1 });
  const promptId = upsertPrompt(db, project.projectId, runId, { index: 1, generation_prompt: '生成一张测试图' }, 'debug/prompts.generated.json');
  const issueId = upsertIssue(db, project.projectId, runId, { id: 'issue_001', title: '测试问题', type: 'needs_review', severity: 'attention', status: 'open' });
  assert.equal(all(db, 'SELECT * FROM runs WHERE id = ?', [runId]).length, 1);
  assert.equal(all(db, 'SELECT * FROM prompts WHERE id = ?', [promptId]).length, 1);
  assert.equal(all(db, 'SELECT * FROM issues WHERE id = ?', [issueId]).length, 1);
});

test('db migrates v2 core tables to schema v3', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  fs.mkdirSync(outputDir, { recursive: true });
  const { DatabaseSync } = sqliteModule();
  const db = new DatabaseSync(projectDbPath(outputDir));
  db.exec(`
    CREATE TABLE schema_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL, applied_at TEXT NOT NULL);
    INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, 'v2', '2026-01-01T00:00:00.000Z');
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, root_path TEXT NOT NULL UNIQUE, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL, title TEXT, provider TEXT, model TEXT, dry_run INTEGER NOT NULL DEFAULT 0, prompt_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0, failed_count INTEGER NOT NULL DEFAULT 0, skipped_count INTEGER NOT NULL DEFAULT 0, needs_review_count INTEGER NOT NULL DEFAULT 0, source_path TEXT, started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE prompts (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT, prompt_index TEXT, title TEXT, prompt_text TEXT NOT NULL, negative_prompt TEXT, params_json TEXT, source_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_prompts_project_index ON prompts(project_id, prompt_index);
    CREATE TABLE run_items (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT NOT NULL, prompt_id TEXT, item_index TEXT, title TEXT, status TEXT NOT NULL, output_path TEXT, error TEXT, request_mode TEXT, batch_number INTEGER, raw_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, user_status TEXT, user_state TEXT NOT NULL DEFAULT 'normal', title TEXT NOT NULL, path TEXT, thumb_path TEXT, mime TEXT, size_bytes INTEGER, width INTEGER, height INTEGER, sha256 TEXT, origin_run_id TEXT, origin_prompt_id TEXT, notes TEXT, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX idx_assets_project_path ON assets(project_id, path);
    CREATE TABLE issues (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, run_id TEXT, asset_id TEXT, type TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL, message TEXT, recommended_action TEXT, rerunnable INTEGER NOT NULL DEFAULT 0, metadata_json TEXT, resolved_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO projects VALUES ('p1', '旧项目', '${outputDir.replace(/'/g, "''")}', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO runs (id, project_id, phase, status, created_at, updated_at) VALUES ('r1', 'p1', 'prepare', 'ready', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO prompts VALUES ('prompt_old', 'p1', 'r1', '1', '旧提示词', 'old prompt', NULL, '{}', 'debug/prompts.generated.json', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO run_items VALUES ('item_old', 'p1', 'r1', 'prompt_old', '1', '旧结果', 'success', 'assets/results/001.png', NULL, NULL, NULL, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO assets VALUES ('asset_old', 'p1', 'result', 'ready', NULL, 'normal', '旧资产', 'assets/results/001.png', NULL, 'image/png', 10, 1, 1, 'sha', 'r1', 'prompt_old', NULL, '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO issues VALUES ('issue_old', 'p1', 'r1', 'asset_old', 'needs_review', 'attention', 'open', '旧问题', NULL, NULL, 1, '{}', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  `);
  db.close();
  const migrated = openProjectDatabase(outputDir);
  assert.equal(get(migrated, 'SELECT version FROM schema_migrations WHERE version = 3', []).version, 3);
  const assetColumns = all(migrated, 'PRAGMA table_info(assets)', []).map((column) => column.name);
  assert.equal(assetColumns.includes('origin_run_id'), false);
  assert.equal(assetColumns.includes('thumb_status'), true);
  assert.equal(all(migrated, 'SELECT * FROM run_assets WHERE run_id = ?', ['r1']).length, 1);
  assert.equal(all(migrated, 'SELECT * FROM prompts WHERE run_id = ? AND prompt_index = ?', ['r1', '1']).length, 1);
});

test('multiple runs keep prompt, asset ownership and issue history', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const imagePath = path.join(outputDir, 'assets', 'results', '001.png');
  writeTinyPng(imagePath);
  const project = initializeProject(outputDir, { name: 'History' });
  const db = project.db;
  const run1 = upsertRun(db, project.projectId, { phase: 'execute', title: '第一轮', generatedAt: '2026-01-01T00:00:00.000Z' });
  const prompt1 = upsertPrompt(db, project.projectId, run1, { index: 1, generation_prompt: '第一轮提示词' }, 'debug/prompts.generated.json');
  const item1 = upsertRunItem(db, project.projectId, run1, { index: 1, status: 'success', output: 'assets/results/001.png' });
  const asset1 = upsertAsset(db, project.projectId, outputDir, {
    id: 'result_001',
    kind: 'image_result',
    userTitle: '结果图',
    lifecycleStatus: 'ready_for_selection',
    path: 'assets/results/001.png',
    relationships: { sourceResultId: 'result_001' },
  }, run1);
  const issue1 = upsertIssue(db, project.projectId, run1, { id: 'same_issue', title: '同名问题', type: 'needs_review', severity: 'attention', status: 'open', sourceResultId: 'result_001' }, { assetIdByLegacyId: new Map([['result_001', asset1]]) });

  const run2 = upsertRun(db, project.projectId, { phase: 'execute', title: '第二轮', generatedAt: '2026-01-02T00:00:00.000Z' });
  const prompt2 = upsertPrompt(db, project.projectId, run2, { index: 1, generation_prompt: '第二轮提示词' }, 'debug/prompts.generated.json');
  upsertRunItem(db, project.projectId, run2, { index: 1, status: 'success', output: 'assets/results/001.png' });
  const asset2 = upsertAsset(db, project.projectId, outputDir, {
    id: 'result_001',
    kind: 'image_result',
    userTitle: '结果图',
    lifecycleStatus: 'ready_for_selection',
    path: 'assets/results/001.png',
    relationships: { sourceResultId: 'result_001' },
  }, run2);
  const issue2 = upsertIssue(db, project.projectId, run2, { id: 'same_issue', title: '同名问题新轮次', type: 'needs_review', severity: 'attention', status: 'open', sourceResultId: 'result_001' }, { assetIdByLegacyId: new Map([['result_001', asset2]]) });

  assert.notEqual(prompt1, prompt2);
  assert.notEqual(issue1, issue2);
  assert.equal(all(db, 'SELECT count(*) AS c FROM prompts WHERE prompt_index = ?', ['1'])[0].c, 2);
  assert.equal(all(db, 'SELECT count(*) AS c FROM issues WHERE title LIKE ?', ['同名问题%'])[0].c, 2);
  assert.equal(all(db, 'SELECT count(*) AS c FROM run_assets WHERE asset_id = ?', [asset1])[0].c, 2);
  assert.equal(all(db, "SELECT count(*) AS c FROM asset_links WHERE relation = 'prompt_result'", [])[0].c >= 2, true);
  assert.equal(get(db, 'SELECT prompt_id FROM run_items WHERE id = ?', [item1]).prompt_id, prompt1);
});

test('run_items rejects prompt_id from a different run at database layer', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Same run guard' });
  const db = project.db;
  const run1 = upsertRun(db, project.projectId, { phase: 'prepare', title: '第一轮', generatedAt: '2026-01-01T00:00:00.000Z' });
  const run2 = upsertRun(db, project.projectId, { phase: 'execute', title: '第二轮', generatedAt: '2026-01-02T00:00:00.000Z' });
  const prompt1 = upsertPrompt(db, project.projectId, run1, { index: 1, generation_prompt: '第一轮提示词' }, 'debug/prompts.generated.json');
  assert.throws(() => run(db, `
    INSERT INTO run_items (
      id, project_id, run_id, prompt_id, item_index, title, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `, ['bad_item', project.projectId, run2, prompt1, '1', '跨轮结果', 'success']), /same run/);
});

test('prompts cannot move runs while referenced by run_items', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Prompt guard' });
  const db = project.db;
  const run1 = upsertRun(db, project.projectId, { phase: 'prepare', title: '第一轮', generatedAt: '2026-01-01T00:00:00.000Z' });
  const run2 = upsertRun(db, project.projectId, { phase: 'prepare', title: '第二轮', generatedAt: '2026-01-02T00:00:00.000Z' });
  const prompt1 = upsertPrompt(db, project.projectId, run1, { index: 1, generation_prompt: '第一轮提示词' }, 'debug/prompts.generated.json');
  upsertRunItem(db, project.projectId, run1, { index: 1, status: 'success' });
  assert.throws(() => run(db, 'UPDATE prompts SET run_id = ? WHERE id = ?', [run2, prompt1]), /cannot change/);
});

test('events append by default and dedupe only when key is provided', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  const project = initializeProject(outputDir, { name: 'Event contract' });
  const db = openProjectDatabase(outputDir);
  appendEvent(db, {
    projectId: project.projectId,
    eventType: 'asset_selected',
    entityType: 'asset',
    entityId: 'asset_1',
    message: '选择一次',
  });
  appendEvent(db, {
    projectId: project.projectId,
    eventType: 'asset_selected',
    entityType: 'asset',
    entityId: 'asset_1',
    message: '选择两次',
  });
  assert.equal(all(db, "SELECT count(*) AS c FROM events WHERE event_type = 'asset_selected'", [])[0].c, 2);

  const firstDedupeId = appendEvent(db, {
    projectId: project.projectId,
    eventType: 'asset_created',
    entityType: 'asset',
    entityId: 'asset_1',
    message: '同步资产',
    dedupeKey: `${project.projectId}|asset_created|asset_1`,
  });
  const secondDedupeId = appendEvent(db, {
    projectId: project.projectId,
    eventType: 'asset_created',
    entityType: 'asset',
    entityId: 'asset_1',
    message: '同步资产',
    dedupeKey: `${project.projectId}|asset_created|asset_1`,
  });
  assert.equal(secondDedupeId, firstDedupeId);
  assert.equal(all(db, "SELECT count(*) AS c FROM events WHERE event_type = 'asset_created'", [])[0].c, 1);
});

test('appendEvent does not swallow unexpected constraint errors', () => {
  if (!sqliteAvailable()) return;
  const outputDir = path.join(makeTempDir(), 'out');
  initializeProject(outputDir, { name: 'Event errors' });
  const db = openProjectDatabase(outputDir);
  assert.throws(() => appendEvent(db, {
    eventType: 'asset_selected',
    entityType: 'asset',
    entityId: 'asset_1',
    message: '缺 projectId',
  }), /NOT NULL|constraint|cannot be bound/i);
});
