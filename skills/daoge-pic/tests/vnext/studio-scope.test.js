const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { ENTITY_SCOPE_QUERIES, SCOPED_ENTITY_TYPES, existsInStudioSql, isInStudio, joinInStudioSql, notInStudioMessage, selectInStudioSql } = require('../../dist/vnext/domain/studio-scope');

const SRC_ROOT = path.join(__dirname, '../../src/vnext');
const TS = '2026-01-01T00:00:00.000Z';

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** 两个 Studio 各一条同名实体，用来证明归属判定真的在过滤，而不是只要 id 存在就放行。 */
function twoStudios() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-studio-scope-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const own = initialized.manifest.studioId;
  const foreign = 'studio_foreign_scope';
  db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(foreign, workspaceRoot + '-foreign', initialized.manifest.schemaVersion, TS, TS);

  const project = (studioId, id, name) => db.prepare('INSERT INTO projects (id, studio_id, name, description, status, version, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, studioId, name, null, 'active', 1, TS, TS, null);
  const task = (projectId, id, name) => db.prepare('INSERT INTO creative_tasks (id, project_id, task_type_id, name, intent_json, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, projectId, null, name, '{}', 'active', 1, TS, TS);
  const round = (taskId, id) => db.prepare('INSERT INTO creative_rounds (id, task_id, parent_round_id, purpose, plan_json, plan_version, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, taskId, null, 'exploration', '{}', 1, 'active', 1, TS, TS);
  const run = (roundId, id) => db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, roundId, 'paused', '{}', '{}', 1, TS, TS);
  const item = (runId, id) => db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, error_json, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, runId, 1, 'outcome_unknown', '{}', 'req_' + id, 1, '{}', '{}', TS, TS);
  const preview = (roundId, id) => db.prepare('INSERT INTO dry_run_previews (id, round_id, plan_version, provider_snapshot_json, plan_snapshot_json, item_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, roundId, 1, '{}', '{}', 1, TS);

  // 两条完全对称的链：一条挂在本 Studio，一条挂在外来 Studio。
  const ids = {};
  for (const [suffix, studioId] of [['own', own], ['foreign', foreign]]) {
    project(studioId, 'project_' + suffix, 'P-' + suffix);
    task('project_' + suffix, 'task_' + suffix, 'T-' + suffix);
    round('task_' + suffix, 'round_' + suffix);
    run('round_' + suffix, 'run_' + suffix);
    item('run_' + suffix, 'item_' + suffix);
    preview('round_' + suffix, 'preview_' + suffix);
    ids[suffix] = {
      project: 'project_' + suffix,
      creative_task: 'task_' + suffix,
      creative_round: 'round_' + suffix,
      generation_run: 'run_' + suffix,
      run_item: 'item_' + suffix,
      dry_run_preview: 'preview_' + suffix
    };
  }
  return { db, own, foreign, ids, cleanup: () => { closeStudioDatabase(db); fs.rmSync(workspaceRoot, { recursive: true, force: true }); } };
}

test('每条规则都带 Studio 谓词，且 SQL 拼接没有缺空格', () => {
  for (const type of SCOPED_ENTITY_TYPES) {
    const scope = ENTITY_SCOPE_QUERIES[type];
    assert.match(scope.where, /^[\w.]+\s*=\s*\?\s+AND\s+[\w.]*studio_id\s*=\s*\?$/, type + ' 的 where 必须是「实体 id + Studio id」两个绑定');
    assert.ok(scope.from.startsWith('FROM '), type + ' 的 from 必须以 FROM 开头');
    // `round_idJOIN` 这种缺空格的拼接在 SQLite 里不报错，只是静默查不到东西——必须挡在测试里。
    assert.doesNotMatch(scope.from, /[A-Za-z_](JOIN|WHERE)/, type + ' 的 from 有拼接缺空格');
    assert.doesNotMatch(scope.where, /[A-Za-z_](JOIN|WHERE)/, type + ' 的 where 有拼接缺空格');
  }
});

test('每条规则生成的 SQL 在真实库上都能 prepare', () => {
  const env = twoStudios();
  try {
    for (const type of SCOPED_ENTITY_TYPES) {
      assert.doesNotThrow(() => env.db.prepare(existsInStudioSql(type)), type);
      assert.doesNotThrow(() => env.db.prepare(selectInStudioSql(type, '1')), type);
    }
  } finally {
    env.cleanup();
  }
});

test('归属判定只认自己的 Studio：外来实体一律 false', () => {
  const env = twoStudios();
  try {
    for (const type of Object.keys(env.ids.own)) {
      assert.equal(isInStudio(env.db, type, env.ids.own[type], env.own), true, type + ' 本 Studio 的实体应当命中');
      assert.equal(isInStudio(env.db, type, env.ids.own[type], env.foreign), false, type + ' 用外来 Studio 查询必须落空');
      assert.equal(isInStudio(env.db, type, env.ids.foreign[type], env.own), false, type + ' 外来实体不能被本 Studio 认领');
      assert.equal(isInStudio(env.db, type, env.ids.foreign[type], env.foreign), true, type + ' 外来实体属于它自己的 Studio');
    }
  } finally {
    env.cleanup();
  }
});

test('追加条件的调用点：Studio 绑定在前，额外条件在后', () => {
  const env = twoStudios();
  try {
    // 这是 media/reconcile 与 server.ts 的同款用法：item 属于本 Studio **且**属于指定 run。
    const sql = selectInStudioSql('run_item', 'item.id') + ' AND item.run_id = ?';
    const row = env.db.prepare(sql).get(env.ids.own.run_item, env.own, env.ids.own.generation_run);
    assert.ok(row, '参数顺序 (id, studioId, 额外条件) 应当命中');
    assert.equal(env.db.prepare(sql).get(env.ids.own.run_item, env.foreign, env.ids.own.generation_run), undefined, '换了 Studio 就不该命中');
    assert.equal(env.db.prepare(sql).get(env.ids.own.run_item, env.own, 'run_foreign'), undefined, '换了 run 也不该命中');
  } finally {
    env.cleanup();
  }
});

test('joinInStudioSql 让「列出子资源」也能复用归属链', () => {
  const sql = joinInStudioSql('creative_round', 'JOIN round_plan_versions version ON version.round_id = round.id');
  assert.match(sql, /^FROM creative_rounds round JOIN round_plan_versions version ON version\.round_id = round\.id JOIN creative_tasks task /);
  assert.doesNotMatch(sql, /[A-Za-z_](JOIN|WHERE)/, '拼接缺空格会让 SQL 静默失效');
  const env = twoStudios();
  try {
    assert.doesNotThrow(() => env.db.prepare('SELECT version.id ' + sql + ' WHERE round.id = ? AND project.studio_id = ?'));
  } finally {
    env.cleanup();
  }
});

test('默认拒绝文案沿用「实体名 + id」的既有格式', () => {
  assert.equal(notInStudioMessage('creative_round', 'round_1'), 'Creative round not found in this Studio: round_1');
  assert.equal(notInStudioMessage('asset', 'ast_1'), 'Asset not found in this Studio: ast_1');
});

test('按主键定位实体的归属查询不再手写 JOIN 链', () => {
  // 这次收敛的理由是安全而不是整洁：每一处手写都要靠人记住补 `studio_id` 谓词，
  // 漏一处就是静默的跨租户读取。所以这条断言盯的是「又有人手写了一处」。
  const locate = /(?:^|[\s'"`])(?:SELECT|select)[^'"]*?\b\w+\.id\s*=\s*\?[^'"]*?studio_id\s*=\s*\?/;
  const skip = /migrations\.ts$|studio-scope\.ts$|studio_search|CREATE TRIGGER/;
  // 已知豁免：provenance/studio.ts 是按 delivery_assets 成员反查交付，不是按主键定位单个实体。
  const allowed = new Set([path.join(SRC_ROOT, 'provenance/studio.ts')]);
  const offenders = [];
  for (const file of walk(SRC_ROOT)) {
    if (skip.test(file) || allowed.has(file)) continue;
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (locate.test(line)) offenders.push(file.replace(SRC_ROOT, 'src/vnext') + ':' + (index + 1));
    });
  }
  assert.deepEqual(offenders, [], '发现手写的归属查询；请改用 studio-scope 的 isInStudio / selectInStudioSql / joinInStudioSql');
});
