const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { createProject, createRoundDraft, createTaskDraft } = require('../../dist/vnext/domain/studio-commands');
const { buildStudioProvenance } = require('../../dist/vnext/provenance/studio');

function addRecordFacts(db, studioId, projectId, taskId, roundId, referenceAssetIds = []) {
  const now = '2026-09-13T10:00:00.000Z';
  db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, provider_profile_id, provider_config_version, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('run-prov', roundId, 'completed', JSON.stringify({ providerId: 'openai-images', descriptorVersion: 3, configVersion: 7, model: 'gpt-image-safe', profileId: 'profile-prov' }), JSON.stringify({ operation: 'generate', prompt: 'private prompt that must not be returned', itemCount: 1, referenceAssetIds }), 'profile-prov', 7, 1, 'serial', 1, now, now);
  db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('item-prov', 'run-prov', 1, 'completed', JSON.stringify({ prompt: 'private prompt that must not be returned', referenceAssetIds }), 'request-prov', 1, now, now);
  db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset-prov', studioId, 'generated', 'image/png', 'generated/asset-prov.png', 'a'.repeat(64), 12, '{}', now, now);
  db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('relation-prov', 'asset-prov', 'output_of', 'run_item', 'item-prov', '{}', now);
  db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('review-prov', 'asset-prov', taskId, roundId, 'keep', JSON.stringify({ note: 'approved' }), now, now);
  db.prepare('INSERT INTO deliveries (id, project_id, name, manifest_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('delivery-prov', projectId, 'Approved export', JSON.stringify({ exportedAt: now }), 'exported', now, now);
  db.prepare('INSERT INTO delivery_assets (delivery_id, asset_id, sequence, source_snapshot_json, review_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('delivery-prov', 'asset-prov', 1, '{}', JSON.stringify({ id: 'review-prov', decision: 'keep' }), now);
}

test('studio provenance derives a canonical exported record without retaining prompt text', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-studio-prov-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const studioId = initialized.manifest.studioId;
    const project = createProject(db, { studioId, name: 'Provenance project', idempotencyKey: 'prov-project' }).value;
    const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'Provenance task', idempotencyKey: 'prov-task' }).value;
    const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', plan: {}, idempotencyKey: 'prov-round' }).value;
    addRecordFacts(db, studioId, project.id, task.id, round.id);

    const result = buildStudioProvenance(db, studioId, 'asset-prov');
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].record.provider.providerId, 'openai-images');
    assert.equal(result.records[0].record.review.decision, 'keep');
    assert.equal(result.records[0].record.exportReport.reportId, 'delivery-prov');
    assert.equal(result.records[0].canonicalJson.includes('private prompt'), false);
    assert.equal(result.retention.prompt_hash.action, 'redact');
    assert.equal(result.retention.prompt_hash.failClosed, false);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('studio provenance refuses causal inputs from an unrelated project', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-studio-prov-scope-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const studioId = initialized.manifest.studioId;
    const project = createProject(db, { studioId, name: 'Owner project', idempotencyKey: 'prov-scope-owner' }).value;
    const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'Owner task', idempotencyKey: 'prov-scope-task' }).value;
    const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', plan: {}, idempotencyKey: 'prov-scope-round' }).value;
    const foreignProject = createProject(db, { studioId, name: 'Foreign project', idempotencyKey: 'prov-scope-foreign' }).value;
    const now = '2026-09-13T10:00:00.000Z';
    db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset-foreign', studioId, 'import', 'image/png', 'imports/asset-foreign.png', 'c'.repeat(64), 12, '{}', now, now);
    db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('relation-foreign', 'asset-foreign', 'attached_to', 'project', foreignProject.id, '{}', now);
    addRecordFacts(db, studioId, project.id, task.id, round.id, ['asset-foreign']);

    const result = buildStudioProvenance(db, studioId, 'asset-prov');
    assert.equal(result.records.length, 0);
    assert.ok(result.issues.some((issue) => issue.code === 'invalid_value'));
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('studio provenance reports incomplete history instead of synthesizing export facts', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-studio-prov-incomplete-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const studioId = initialized.manifest.studioId;
    db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset-incomplete', studioId, 'generated', 'image/png', 'generated/incomplete.png', 'b'.repeat(64), 1, '{}', '2026-09-13T10:00:00.000Z', '2026-09-13T10:00:00.000Z');
    const result = buildStudioProvenance(db, studioId, 'asset-incomplete');
    assert.deepEqual(result.records, []);
    assert.equal(result.issues.length, 0);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
