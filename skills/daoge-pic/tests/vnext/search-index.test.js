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
const { searchStudio } = require('../../dist/vnext/domain/queries');
const { PURPOSE_LABELS } = require('../../dist/vnext/shared/purpose-labels');
const { readSource } = require('./source-text');

/**
 * 搜索索引守卫（方案 7.8.1，施工单 A10）。
 *
 * 修的是两件具体的事：
 *   ① 批次被整段 `plan_json` 索引，于是搜「夜景」搜不到，只有 `{"operation":"generate"}` 能命中；
 *   ② 图是主角却一条都没进索引，「搜一张图」在数据层就是断的。
 * 顺带把搜索结果的 label 从英文枚举改成人话。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-search-'));
}

function setup() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const { config, status } = configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'memory-only-key' });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const project = createProject(db, { studioId, name: '夜雨街头', idempotencyKey: 'project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: '人物头像', idempotencyKey: 'task' }).value;
  const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'round' }).value;
  const prepared = prepareRoundForConfirmation(db, { studioId, roundId: round.id, plan: { operation: 'generate', itemCount: 4, prompt: '夜景人像，暖光背景', output: { aspectRatio: '1:1' } }, expectedVersion: round.version, idempotencyKey: 'prepare' }).value;
  const confirmed = confirmRoundPlan(db, { studioId, roundId: round.id, expectedVersion: prepared.version, idempotencyKey: 'confirm' }).value;
  const dryRun = createDryRunPreview(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, idempotencyKey: 'dry-run' }).value;
  const run = queueGenerationRun(db, { studioId, roundId: confirmed.id, providerConfig: config, providerStatus: status, preflightId: dryRun.preview.id, idempotencyKey: 'run' }).value;
  const item = listGenerationRunItems(db, run.id)[0];
  const timestamp = new Date().toISOString();
  db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset_search_1', studioId, 'generated', 'image/png', 'daoge-assets/generated/asset_search_1.png', 'hash-search-1', 10, '{"revisedPrompt":"warmer"}', timestamp, timestamp);
  db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('rel-search-1', 'asset_search_1', 'output_of', 'run_item', item.id, '{}', timestamp);
  return { workspaceRoot, initialized, db, studioId, project, task, round: confirmed, run, item };
}

function dispose(fixture) {
  closeStudioDatabase(fixture.db);
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

test('批次按人话索引：搜「夜景」能找到，搜结构字段不再命中', () => {
  const fixture = setup();
  try {
    const byPrompt = searchStudio(fixture.db, fixture.studioId, '夜景');
    const roundHit = byPrompt.find((result) => result.entityType === 'round');
    assert.ok(roundHit, 'prompt 里的人话必须能搜到批次');
    assert.equal(roundHit.entityId, fixture.round.id);
    // label 是人话：任务名 + 目的人话，不含英文枚举。
    assert.match(roundHit.label, /人物头像/);
    assert.match(roundHit.label, /探索新方向/);
    assert.doesNotMatch(roundHit.label, /exploration/);
    // 结构字段不再是索引内容。
    assert.equal(searchStudio(fixture.db, fixture.studioId, 'operation').length, 0, '整段 plan_json 不应再进索引');
  } finally {
    dispose(fixture);
  }
});

test('图进索引：按来源批次的 prompt、文件名、评审反馈与交付名都能搜到', () => {
  const fixture = setup();
  try {
    const byPrompt = searchStudio(fixture.db, fixture.studioId, '暖光');
    assert.equal(byPrompt.some((result) => result.entityType === 'asset' && result.entityId === 'asset_search_1'), true, '产出图必须能按来源批次的 prompt 搜到');
    const assetResult = byPrompt.find((result) => result.entityType === 'asset');
    assert.equal(assetResult.projectId, fixture.project.id, '图的结果必须带得回项目');
    assert.equal(assetResult.roundId, fixture.round.id, '图的结果必须指向产出它的批次');

    // 评审反馈进入索引（触发 review_decisions 的刷新）。
    // ⚠️ 已知限制：fts5 用的是 unicode61 分词 + 前缀查询（`term*`），中文连续串是一个 token，
    // 所以只能匹配 token 开头，不能匹配中间的任意子串。这是既有实现的行为，不是本项引入的，
    // 因此断言按「词首匹配」写（评审意见通常也以关键词开头）。
    const timestamp = new Date().toISOString();
    fixture.db.prepare('INSERT INTO review_decisions (id, asset_id, decision, feedback_json, schema_version, context_json, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)').run('review-search-1', 'asset_search_1', 'reject', JSON.stringify({ note: '廉价金属质感' }), '{}', timestamp, timestamp);
    const byFeedback = searchStudio(fixture.db, fixture.studioId, '廉价');
    assert.equal(byFeedback.some((result) => result.entityType === 'asset'), true, '评审反馈必须能搜到图');
  } finally {
    dispose(fixture);
  }
});

test('图片文件名可搜，删除后索引同步消失', () => {
  const fixture = setup();
  try {
    const timestamp = new Date().toISOString();
    fixture.db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset_search_import', fixture.studioId, 'import', 'image/png', 'daoge-assets/imports/asset_search_import.png', 'hash-search-import', 10, JSON.stringify({ originalFilename: '主角参考图.png' }), timestamp, timestamp);
    // 导入图靠 attached_to 关系拿到项目归属（图的搜索必须回到某个项目上下文）。
    fixture.db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('rel-search-import', 'asset_search_import', 'attached_to', 'project', fixture.project.id, '{}', timestamp);
    const byFilename = searchStudio(fixture.db, fixture.studioId, '主角参考图');
    assert.equal(byFilename.some((result) => result.entityId === 'asset_search_import'), true, '导入图必须能按文件名搜到');
    assert.match(searchStudio(fixture.db, fixture.studioId, '主角参考图').find((result) => result.entityId === 'asset_search_import').label, /主角参考图/);

    fixture.db.prepare('DELETE FROM asset_relations WHERE asset_id = ?').run('asset_search_import');
    fixture.db.prepare('DELETE FROM assets WHERE id = ?').run('asset_search_import');
    assert.equal(searchStudio(fixture.db, fixture.studioId, '主角参考图').length, 0, '删除资产必须删掉索引行');
  } finally {
    dispose(fixture);
  }
});

test('前后端两份「目的人话」翻译必须逐值一致（跨模块系统，用守卫钉住）', async () => {
  const frontend = (await import('../../web/src/purpose-labels.mjs')).PURPOSE_LABELS;
  assert.deepEqual(Object.keys(PURPOSE_LABELS).sort(), Object.keys(frontend).sort(), '枚举集合必须一致');
  for (const key of Object.keys(frontend)) assert.equal(PURPOSE_LABELS[key], frontend[key], key + ' 的人话必须两边一致');
  // 后端确实在用它拼 label（不是只定义了没人用）。
  assert.match(readSource('src/vnext/domain/queries.ts'), /purposeLabel\(/, 'searchStudio 的 label 必须走翻译表');
});
