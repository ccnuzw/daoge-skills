const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase, studioSchemaVersion, STUDIO_SCHEMA_VERSION } = require('../../dist/vnext/studio/database');
const { createProject, createRoundDraft, createTaskDraft } = require('../../dist/vnext/domain/studio-commands');
const { buildStudioProvenance, getPersistedStudioProvenance, persistStudioProvenance } = require('../../dist/vnext/provenance/studio');
const { getAssetProvenance } = require('../../dist/vnext/domain/creative-records');

function addRecordFacts(db, studioId, projectId, taskId, roundId) {
  const now = '2026-09-13T10:00:00.000Z';
  db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, provider_profile_id, provider_config_version, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('run-prov-persist', roundId, 'completed', JSON.stringify({ providerId: 'openai-images', descriptorVersion: 3, configVersion: 7, model: 'gpt-image-safe', profileId: 'profile-prov', baseUrl: 'https://private-provider.example.test/v1', apiKey: 'super-secret-key' }), JSON.stringify({ operation: 'generate', prompt: 'private prompt that must never be stored', itemCount: 1, absolutePath: '/Users/example/private.png' }), 'profile-prov', 7, 1, 'serial', 1, now, now);
  db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('item-prov-persist', 'run-prov-persist', 1, 'completed', JSON.stringify({ prompt: 'private prompt that must never be stored', request: { url: 'https://private-provider.example.test/v1/images' } }), 'request-prov', 1, now, now);
  db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset-prov-persist', studioId, 'generated', 'image/png', 'generated/asset-prov-persist.png', 'a'.repeat(64), 12, JSON.stringify({ sourceUrl: 'https://source.example.test/private.png' }), now, now);
  db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('relation-prov-persist', 'asset-prov-persist', 'output_of', 'run_item', 'item-prov-persist', '{}', now);
  db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('review-prov-persist', 'asset-prov-persist', taskId, roundId, 'keep', JSON.stringify({ note: 'full reviewer feedback must not be stored' }), now, now);
  db.prepare('INSERT INTO deliveries (id, project_id, name, manifest_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('delivery-prov-persist', projectId, 'Approved export', JSON.stringify({ exportedAt: now }), 'exported', now, now);
  db.prepare('INSERT INTO delivery_assets (delivery_id, asset_id, sequence, source_snapshot_json, review_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('delivery-prov-persist', 'asset-prov-persist', 1, '{}', JSON.stringify({ id: 'review-prov-persist', decision: 'keep' }), now);
}

function setupWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-provenance-persist-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const project = createProject(db, { studioId, name: 'Provenance persistence project', idempotencyKey: 'prov-persist-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'Provenance persistence task', idempotencyKey: 'prov-persist-task' }).value;
  const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', plan: {}, idempotencyKey: 'prov-persist-round' }).value;
  addRecordFacts(db, studioId, project.id, task.id, round.id);
  return { workspaceRoot, initialized, db, studioId };
}

test('provenance records persist canonically, survive reopen, and remain Studio scoped', () => {
  const fixture = setupWorkspace();
  try {
    assert.equal(studioSchemaVersion(fixture.db), STUDIO_SCHEMA_VERSION);
    const eventCount = fixture.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
    const built = buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov-persist');
    assert.equal(built.records.length, 1);

    const first = persistStudioProvenance(fixture.db, built, new Date('2026-09-13T11:00:00.000Z'));
    const second = persistStudioProvenance(fixture.db, built, new Date('2026-09-13T11:05:00.000Z'));
    assert.equal(first.records.length, 1);
    assert.equal(second.records.length, 1);
    assert.equal(first.records[0].recordId, second.records[0].recordId);
    assert.equal(second.records[0].createdAt, '2026-09-13T11:00:00.000Z');
    assert.equal(second.records[0].updatedAt, '2026-09-13T11:05:00.000Z');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM provenance_records').get().count, 1);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, eventCount);

    const row = fixture.db.prepare('SELECT canonical_json, retention_json FROM provenance_records WHERE id = ? AND studio_id = ?').get(second.records[0].recordId, fixture.studioId);
    const storedText = row.canonical_json + '\n' + row.retention_json;
    assert.equal(storedText.includes('private prompt'), false);
    assert.equal(storedText.includes('https://'), false);
    assert.equal(storedText.includes('/Users/'), false);
    assert.equal(storedText.includes('super-secret-key'), false);
    assert.equal(storedText.includes('full reviewer feedback'), false);
    const retention = JSON.parse(row.retention_json);
    assert.deepEqual(Object.keys(retention).sort(), ['export_report', 'generated_asset', 'prompt_hash', 'review', 'source_asset']);
    assert.equal(retention.prompt_hash.action, 'redact');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM assets WHERE id = ? AND studio_id = ?').get('asset-prov-persist', fixture.studioId).count, 1);

    fixture.db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_provenance_foreign', fixture.workspaceRoot + '-foreign', STUDIO_SCHEMA_VERSION, '2026-09-13T11:10:00.000Z', '2026-09-13T11:10:00.000Z');
    assert.throws(() => getPersistedStudioProvenance(fixture.db, 'studio_provenance_foreign', second.records[0].recordId), /not found/);

    closeStudioDatabase(fixture.db);
    fixture.db = openStudioDatabase(fixture.initialized.paths, fixture.initialized.manifest, { attachOnly: true });
    const reopened = getPersistedStudioProvenance(fixture.db, fixture.studioId, second.records[0].recordId);
    assert.equal(reopened.record.recordId, second.records[0].recordId);
    assert.equal(reopened.assetId, 'asset-prov-persist');
    assert.equal(reopened.deliveryId, 'delivery-prov-persist');
    assert.equal(reopened.persistedAt, '2026-09-13T11:05:00.000Z');
    assert.equal(reopened.retention.prompt_hash.action, 'redact');
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('asset provenance GET is read-only and reuses persisted timestamps', () => {
  const fixture = setupWorkspace();
  try {
    const eventCount = fixture.db.prepare('SELECT COUNT(*) AS count FROM events').get().count;
    const first = getAssetProvenance(fixture.db, fixture.studioId, 'asset-prov-persist');
    assert.equal(first.canonicalProvenance.records.length, 1);
    assert.deepEqual(first.canonicalProvenance.persistedRecords, []);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM provenance_records').get().count, 0);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, eventCount);
    for (const key of ['asset', 'outputs', 'lineages', 'reviews', 'relations', 'deliveries', 'deliveryBatches', 'canonicalProvenance']) assert.equal(Object.hasOwn(first, key), true);

    const built = buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov-persist');
    persistStudioProvenance(fixture.db, built, new Date('2026-09-13T11:00:00.000Z'));
    const second = getAssetProvenance(fixture.db, fixture.studioId, 'asset-prov-persist');
    const third = getAssetProvenance(fixture.db, fixture.studioId, 'asset-prov-persist');
    assert.equal(second.canonicalProvenance.records[0].persistedAt, '2026-09-13T11:00:00.000Z');
    assert.equal(third.canonicalProvenance.records[0].updatedAt, '2026-09-13T11:00:00.000Z');
    assert.equal(third.canonicalProvenance.persistedRecords.length, 1);
    assert.equal(fixture.db.prepare('SELECT updated_at FROM provenance_records WHERE asset_id = ?').get('asset-prov-persist').updated_at, '2026-09-13T11:00:00.000Z');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM events').get().count, eventCount);
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});
