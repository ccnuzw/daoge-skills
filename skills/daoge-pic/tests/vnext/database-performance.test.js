const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { appendStudioEvent, closeStudioDatabase, openStudioDatabase, STUDIO_EVENT_RETENTION, studioSchemaVersion, subscribeStudioEvents, withTransaction } = require('../../dist/vnext/studio/database');
const { studioEventWindow } = require('../../dist/vnext/api/events');
const { listProjectSelectionAssets, setProjectAssetsSelected } = require('../../dist/vnext/domain/project-selections');
const { listDeliveries } = require('../../dist/vnext/domain/deliveries');
const { listAssetsWithReviewSummaries } = require('../../dist/vnext/domain/creative-records');
const { setReviewDecisions } = require('../../dist/vnext/domain/assets');
const { getTaskStudioOverview } = require('../../dist/vnext/domain/creative-records');
const { listTaskTypes } = require('../../dist/vnext/domain/libraries');

function counted(db) {
  let calls = 0;
  return {
    db: new Proxy(db, { get(target, property) { if (property === 'prepare') return (...args) => { calls += 1; return target.prepare(...args); }; const value = target[property]; return typeof value === 'function' ? value.bind(target) : value; } }),
    calls: () => calls
  };
}

function setup(count) {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-db-performance-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const timestamp = '2026-09-03T00:00:00.000Z';
  db.prepare("INSERT INTO projects (id, studio_id, name, status, created_at, updated_at) VALUES ('project-performance', ?, 'Performance', 'active', ?, ?)").run(studioId, timestamp, timestamp);
  const insertAsset = db.prepare("INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, 'import', 'image/png', ?, ?, 1, '{}', ?, ?)");
  const insertRelation = db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, 'selected_for', 'project', 'project-performance', '{}', ?)");
  const insertDelivery = db.prepare("INSERT INTO deliveries (id, project_id, name, manifest_json, status, created_at, updated_at) VALUES (?, 'project-performance', ?, '{}', 'draft', ?, ?)");
  const insertDeliveryAsset = db.prepare("INSERT INTO delivery_assets (delivery_id, asset_id, sequence, source_snapshot_json, review_snapshot_json, created_at) VALUES (?, ?, 1, '{}', '{}', ?)");
  const assets = [];
  for (let index = 0; index < count; index += 1) {
    const id = 'asset-performance-' + index;
    insertAsset.run(id, studioId, 'daoge-assets/imports/' + id + '.png', String(index).padStart(64, '0'), timestamp, timestamp);
    insertRelation.run('relation-performance-' + index, id, timestamp);
    insertDelivery.run('delivery-performance-' + index, 'Delivery ' + index, timestamp, timestamp);
    insertDeliveryAsset.run('delivery-performance-' + index, id, timestamp);
    assets.push({ id, studioId, kind: 'import', mediaType: 'image/png', storagePath: 'daoge-assets/imports/' + id + '.png', contentHash: String(index).padStart(64, '0'), byteSize: 1, source: {}, deletedAt: null });
  }
  return { workspaceRoot, db, studioId, assets };
}

test('v20 uses covering indexes and keeps Workbench list query counts constant as records grow', () => {
  const small = setup(1);
  const large = setup(64);
  try {
    assert.equal(studioSchemaVersion(large.db), 20);
    const assetPlan = large.db.prepare("EXPLAIN QUERY PLAN SELECT id FROM assets WHERE studio_id = ? AND deleted_at IS NULL AND kind = ? ORDER BY created_at DESC, id DESC LIMIT 24").all(large.studioId, 'import').map((row) => row.detail).join('\n');
    const selectionPlan = large.db.prepare("EXPLAIN QUERY PLAN SELECT asset.id FROM asset_relations selection JOIN assets asset ON asset.id = selection.asset_id WHERE selection.relation_type = 'selected_for' AND selection.target_type = 'project' AND selection.target_id = ? AND asset.studio_id = ? ORDER BY selection.created_at, selection.asset_id").all('project-performance', large.studioId).map((row) => row.detail).join('\n');
    assert.match(assetPlan, /idx_assets_studio_visibility_kind_created/);
    assert.match(selectionPlan, /idx_asset_relations_target_ordered/);

    for (const [fixture, expected] of [[small, 1], [large, 64]]) {
      const selection = counted(fixture.db);
      assert.equal(listProjectSelectionAssets(selection.db, { studioId: fixture.studioId, projectId: 'project-performance' }).length, expected);
      assert.equal(selection.calls(), 2);
      const deliveries = counted(fixture.db);
      assert.equal(listDeliveries(deliveries.db, 'project-performance').length, expected);
      assert.equal(deliveries.calls(), 2);
      const cards = counted(fixture.db);
      assert.equal(listAssetsWithReviewSummaries(cards.db, fixture.assets, 'project-performance').length, expected);
      assert.equal(cards.calls(), 2);
    }
    const batch = counted(large.db);
    const assetIds = large.assets.map((asset) => asset.id);
    assert.equal(setProjectAssetsSelected(batch.db, { studioId: large.studioId, projectId: 'project-performance', assetIds, selected: false }).changed, 64);
    assert.ok(batch.calls() <= 7, 'batch selection reads, prepared statements, and one aggregate event must remain constant');
    const reviews = counted(large.db);
    assert.equal(setReviewDecisions(reviews.db, { studioId: large.studioId, assetIds, decision: 'keep', emitEvent: false }), 64);
    assert.ok(reviews.calls() <= 2, 'batch reviews must validate and insert with constant prepared statements');
  } finally {
    closeStudioDatabase(small.db);
    closeStudioDatabase(large.db);
    fs.rmSync(small.workspaceRoot, { recursive: true, force: true });
    fs.rmSync(large.workspaceRoot, { recursive: true, force: true });
  }
});

test('event windows use one bounded query and task type reads never seed in a GET path', () => {
  const fixture = setup(1);
  try {
    const before = fixture.db.prepare("SELECT COUNT(*) AS total FROM task_types WHERE source = 'official'").get().total;
    const taskTypes = counted(fixture.db);
    assert.ok(listTaskTypes(taskTypes.db, fixture.studioId).length >= 8);
    assert.equal(taskTypes.calls(), 2);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS total FROM task_types WHERE source = 'official'").get().total, before);
    for (let index = 0; index <= STUDIO_EVENT_RETENTION + 1; index += 1) appendStudioEvent(fixture.db, { studioId: fixture.studioId, entityType: 'asset', entityId: 'asset-performance-0', eventType: 'asset.updated', payload: { index } });
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS total FROM events WHERE studio_id = ?').get(fixture.studioId).total, STUDIO_EVENT_RETENTION);
    const events = counted(fixture.db);
    const window = studioEventWindow(events.db, fixture.studioId, 0);
    assert.equal(events.calls(), 1);
    assert.equal(window.events.length, 100);
    assert.equal(studioEventWindow(fixture.db, fixture.studioId, 1).snapshotRequired, true);
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('event insertion, retention metadata, and post-commit notification share one transaction boundary', async () => {
  const fixture = setup(1);
  let notifications = 0;
  const unsubscribe = subscribeStudioEvents(fixture.studioId, () => { notifications += 1; });
  try {
    assert.throws(() => withTransaction(fixture.db, () => {
      appendStudioEvent(fixture.db, { studioId: fixture.studioId, entityType: 'asset', entityId: 'rolled-back', eventType: 'asset.updated' });
      throw new Error('rollback');
    }), /rollback/);
    await Promise.resolve();
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS total FROM events WHERE entity_id = 'rolled-back'").get().total, 0);
    assert.equal(notifications, 0);
    const id = appendStudioEvent(fixture.db, { studioId: fixture.studioId, entityType: 'asset', entityId: 'committed', eventType: 'asset.updated' });
    await Promise.resolve();
    const window = fixture.db.prepare('SELECT latest_id, retained_count FROM studio_event_windows WHERE studio_id = ?').get(fixture.studioId);
    assert.equal(window.latest_id, id);
    assert.equal(window.retained_count, 1);
    assert.equal(notifications, 1);
  } finally {
    unsubscribe();
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('task comparisons preserve explicit rounds while bounding run history and query count', () => {
  const fixture = setup(1);
  try {
    const timestamp = '2026-09-03T00:00:00.000Z';
    fixture.db.prepare("INSERT INTO creative_tasks (id, project_id, name, intent_json, status, created_at, updated_at) VALUES ('task-performance', 'project-performance', 'Task', '{}', 'active', ?, ?)").run(timestamp, timestamp);
    fixture.db.prepare("INSERT INTO creative_rounds (id, task_id, purpose, plan_json, status, created_at, updated_at) VALUES ('round-performance', 'task-performance', 'exploration', '{}', 'active', ?, ?)").run(timestamp, timestamp);
    const insertRun = fixture.db.prepare("INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES (?, 'round-performance', 'completed', '{}', '{}', 4, 'default', 1, ?, ?)");
    const insertItem = fixture.db.prepare("INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, created_at, updated_at) VALUES (?, ?, 1, 'succeeded', '{}', ?, 1, ?, ?)");
    const insertOutput = fixture.db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, 'asset-performance-0', 'output_of', 'run_item', ?, '{}', ?)");
    for (let index = 0; index < 30; index += 1) {
      const runId = 'task-run-' + String(index).padStart(2, '0');
      const itemId = 'task-item-' + String(index).padStart(2, '0');
      insertRun.run(runId, timestamp, timestamp);
      insertItem.run(itemId, runId, 'request-' + index, timestamp, timestamp);
      insertOutput.run('task-output-' + index, itemId, timestamp);
    }
    const overview = counted(fixture.db);
    const result = getTaskStudioOverview(overview.db, fixture.studioId, 'task-performance', ['round-performance']);
    assert.deepEqual(result.selectedRoundIds, ['round-performance']);
    assert.equal(result.comparisons.length, 1);
    assert.equal(result.comparisons[0].summary.runCount, 30);
    assert.equal(result.comparisons[0].runs.length, 24);
    assert.equal(result.comparisons[0].runsTruncated, true);
    assert.ok(overview.calls() <= 9, 'comparison reads must remain bounded by batches, not runs');
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});
