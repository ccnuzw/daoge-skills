const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson } = require('./local-studio-test-helper');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-run-items-'));
}

function countRows(db) {
  return Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS total FROM run_items GROUP BY status').all().map((row) => [row.status, row.total]));
}

test('run item API returns paged, filtered items with exact counts and output assets', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const session = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'run-items-session', body: { conversationId: 'run-items-conversation' } });
    const sessionId = session.body.data.id;
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'run-items-project', body: { name: '运行项分页项目', sessionId } });
    const task = await requestJson(started, '/api/tasks', { method: 'POST', idempotencyKey: 'run-items-task', body: { projectId: project.body.data.value.id, name: '运行项分页任务', sessionId } });
    const round = await requestJson(started, '/api/rounds', { method: 'POST', idempotencyKey: 'run-items-round', body: { taskId: task.body.data.value.id, purpose: 'exploration', sessionId } });
    const roundId = round.body.data.value.id;
    const now = new Date().toISOString();
    const db = started.service.db;
    db.prepare("INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES ('run_page', ?, 'partial', '{}', '{\"itemCount\":60,\"prompt\":\"paged fixture\"}', 4, 'default', 1, ?, ?)").run(roundId, now, now);
    const insertItem = db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, retry_at, error_json, result_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (let sequence = 1; sequence <= 60; sequence += 1) {
      const status = sequence <= 30 ? 'succeeded' : sequence <= 35 ? 'failed' : sequence <= 38 ? 'blocked' : sequence === 39 ? 'outcome_unknown' : sequence === 40 ? 'retry_wait' : 'pending';
      const error = ['failed', 'blocked', 'outcome_unknown'].includes(status) ? JSON.stringify({ summary: '安全错误 ' + sequence + ' /Users/apple/private-' + sequence + '.png', kind: 'fixture', code: String(sequence), endpoint: 'https://private.example.test/v1', apiKey: 'secret' }) : null;
      insertItem.run('item-' + sequence, 'run_page', sequence, status, '{}', 'request-' + sequence, status === 'succeeded' ? 1 : 2, status === 'retry_wait' ? now : null, error, status === 'succeeded' ? JSON.stringify({ assetId: 'asset-' + sequence, mediaType: 'image/png', byteSize: 68 }) : null, now, now);
    }
    db.prepare("INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, media_state, created_at, updated_at) VALUES ('asset-page-31', ?, 'generated', 'image/png', 'generated/page-31.png', ?, 68, '{}', 'available', ?, ?)").run(initialized.manifest.studioId, 'a'.repeat(64), now, now);
    db.prepare("INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, media_state, created_at, updated_at) VALUES ('asset-1', ?, 'generated', 'image/png', 'generated/page-1.png', ?, 68, '{}', 'available', ?, ?)").run(initialized.manifest.studioId, 'b'.repeat(64), now, now);
    db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES ('relation-page-31', 'asset-page-31', 'output_of', 'run_item', 'item-31', '{}', ?)").run(now);

    const page = await requestJson(started, '/api/runs/run_page/items?page=1&pageSize=25&status=failed&status=blocked&status=outcome_unknown&sort=sequence');
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.equal(page.body.data.total, 9);
    assert.equal(page.body.data.allTotal, 60);
    assert.equal(page.body.data.page, 1);
    assert.equal(page.body.data.pageSize, 25);
    assert.deepEqual(page.body.data.items.map((item) => item.sequence), [31, 32, 33, 34, 35, 36, 37, 38, 39]);
    assert.equal(page.body.data.items[0].updatedAt, now);
    assert.deepEqual(page.body.data.items[0].outputAssets, [{ id: 'asset-page-31', kind: 'generated', mediaType: 'image/png', deletedAt: null, mediaState: 'available' }]);
    assert.deepEqual(page.body.data.statusCounts, { ...Object.fromEntries(['leased', 'requesting', 'receiving', 'persisting', 'cancel_requested', 'cancelled'].map((status) => [status, 0])), ...countRows(db) });
    assert.equal(JSON.stringify(page.body).includes('private.example.test'), false);
    assert.equal(JSON.stringify(page.body).includes('secret'), false);
    assert.equal(JSON.stringify(page.body).includes('/Users/apple'), false);

    const resultFallback = await requestJson(started, '/api/runs/run_page/items?page=1&pageSize=25');
    assert.equal(resultFallback.status, 200, JSON.stringify(resultFallback.body));
    assert.deepEqual(resultFallback.body.data.items[0].outputAssets, [{ id: 'asset-1', kind: 'generated', mediaType: 'image/png', deletedAt: null, mediaState: 'available' }]);
    const sequence = await requestJson(started, '/api/runs/run_page/items?sequence=40&pageSize=25');
    assert.equal(sequence.body.data.total, 1);
    assert.equal(sequence.body.data.items[0].sequence, 40);
    const clamped = await requestJson(started, '/api/runs/run_page/items?page=9&pageSize=25');
    assert.equal(clamped.body.data.page, 3);
    assert.deepEqual(clamped.body.data.items.map((item) => item.sequence), [51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
    insertItem.run('item-unknown', 'run_page', 61, 'unknown_legacy', '{}', 'request-unknown', 1, null, null, null, now, now);
    const legacyStatus = await requestJson(started, '/api/runs/run_page/items?page=1&pageSize=100');
    assert.equal(legacyStatus.status, 200, JSON.stringify(legacyStatus.body));
    assert.equal(legacyStatus.body.data.total, 61);
    assert.equal(legacyStatus.body.data.allTotal, 61);
    assert.equal(legacyStatus.body.data.items.at(-1).status, 'unknown_legacy');
    assert.equal(Object.hasOwn(legacyStatus.body.data.statusCounts, 'unknown_legacy'), false);
    const invalid = await requestJson(started, '/api/runs/run_page/items?pageSize=24');
    assert.equal(invalid.status, 400);
    const summary = await requestJson(started, '/api/rounds/' + roundId + '/creative-record?runId=run_page&includeItems=0');
    assert.equal(summary.body.data.record.itemsIncluded, false);
    assert.deepEqual(summary.body.data.record.items, []);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
