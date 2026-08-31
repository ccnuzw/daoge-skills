const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject, createRoundDraft, createTaskDraft } = require('../../dist/vnext/domain/studio-commands');
const { importStudioAsset, setReviewDecision } = require('../../dist/vnext/domain/assets');
const { getAssetProvenance, getRoundCreativeRecord, getTaskCreativeOverview, listAssetsWithReviewSummaries } = require('../../dist/vnext/domain/creative-records');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

test('P1 creative records connect task, round lineage, explicit run items, output assets, reviews, and safe provenance', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-creative-record-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '创作链项目', idempotencyKey: 'record-project' }).value;
    const task = createTaskDraft(db, { projectId: project.id, name: '主视觉', intent: { audience: '设计评审', objective: '建立稳定来源链' }, idempotencyKey: 'record-task' }).value;
    const parent = createRoundDraft(db, { taskId: task.id, purpose: 'exploration', plan: { direction: '构图探索' }, idempotencyKey: 'record-parent' }).value;
    const round = createRoundDraft(db, { taskId: task.id, purpose: 'refinement', parentRoundId: parent.id, plan: { direction: '保留结构并优化色彩' }, idempotencyKey: 'record-round' }).value;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, worker_id, started_at, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('run-record', round.id, 'completed', '{}', JSON.stringify({ itemCount: 1 }), 1, null, now, now, now, now);
    db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('item-record', 'run-record', 1, 'completed', '{}', 'request-record', 1, now, now);
    const asset = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png', source: { apiKey: 'must-not-leak', endpoint: 'https://private.example.test', storagePath: 'internal/asset.png', contentHash: 'must-not-leak-hash', note: '生成结果' } });
    db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('relation-record', asset.id, 'output_of', 'run_item', 'item-record', '{}', now);
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'review', taskId: task.id, roundId: round.id, feedback: { note: '先检查构图' } });
    setReviewDecision(db, { studioId: initialized.manifest.studioId, assetId: asset.id, decision: 'keep', taskId: task.id, roundId: round.id, feedback: { note: '保留为交付候选' } });

    const overview = getTaskCreativeOverview(db, initialized.manifest.studioId, task.id);
    assert.equal(overview.summary.roundCount, 2);
    assert.equal(overview.summary.runCount, 1);
    assert.equal(overview.summary.resultCount, 1);
    const record = getRoundCreativeRecord(db, initialized.manifest.studioId, round.id, 'run-record');
    assert.equal(record.selectedRunId, 'run-record');
    assert.equal(record.lineage.rounds[0].id, parent.id);
    assert.deepEqual(record.items[0].outputAssets.map((output) => output.id), [asset.id]);
    const display = listAssetsWithReviewSummaries(db, [asset], project.id)[0].display;
    assert.match(display.label, /^主视觉 · 优化第 \d+ 轮 · 运行 1 · 第 1 张$/);
    assert.equal(display.selectionText, display.label);
    const provenance = getAssetProvenance(db, initialized.manifest.studioId, asset.id);
    assert.equal(provenance.outputs[0].run.id, 'run-record');
    assert.equal(provenance.reviews.length, 2);
    assert.equal(provenance.reviews[1].decision, 'keep');
    const serialized = JSON.stringify({ record, provenance });
    assert.equal(serialized.includes('must-not-leak'), false);
    assert.equal(serialized.includes('private.example.test'), false);
    assert.equal(serialized.includes('internal/asset.png'), false);
    assert.equal(serialized.includes('must-not-leak-hash'), false);
    assert.equal(serialized.includes('request-record'), false);
    assert.throws(() => getRoundCreativeRecord(db, initialized.manifest.studioId, round.id, 'wrong-run'), /does not belong/);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
