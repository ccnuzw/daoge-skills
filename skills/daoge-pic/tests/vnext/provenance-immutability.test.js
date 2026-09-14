const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const test = require('node:test');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase, studioSchemaVersion, STUDIO_SCHEMA_VERSION } = require('../../dist/vnext/studio/database');
const { createProject, createRoundDraft, createTaskDraft } = require('../../dist/vnext/domain/studio-commands');
const {
  buildStudioProvenance,
  getPersistedStudioProvenance,
  getStudioProvenanceVersion,
  listStudioProvenanceVersions,
  persistStudioProvenance
} = require('../../dist/vnext/provenance/studio');

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function addRecordFacts(db, studioId, projectId, taskId, roundId) {
  const now = '2026-09-13T10:00:00.000Z';
  db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, provider_profile_id, provider_config_version, execution_concurrency, concurrency_source, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('run-prov', roundId, 'completed', JSON.stringify({ providerId: 'openai-images', descriptorVersion: 3, configVersion: 7, model: 'gpt-image-safe', profileId: 'profile-prov', baseUrl: 'https://private-provider.example.test/v1', apiKey: 'super-secret-key' }), JSON.stringify({ operation: 'generate', prompt: 'private prompt', itemCount: 1 }), 'profile-prov', 7, 1, 'serial', 1, now, now);
  db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('item-prov', 'run-prov', 1, 'completed', JSON.stringify({ prompt: 'private prompt' }), 'request-prov', 1, now, now);
  db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset-prov', studioId, 'generated', 'image/png', 'generated/asset-prov.png', 'a'.repeat(64), 12, '{}', now, now);
  db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('relation-prov', 'asset-prov', 'output_of', 'run_item', 'item-prov', '{}', now);
  db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('review-prov-1', 'asset-prov', taskId, roundId, 'keep', JSON.stringify({ note: 'first pass' }), now, now);
  db.prepare('INSERT INTO deliveries (id, project_id, name, manifest_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('delivery-prov', projectId, 'Approved export', JSON.stringify({ exportedAt: now }), 'exported', now, now);
  db.prepare('INSERT INTO delivery_assets (delivery_id, asset_id, sequence, source_snapshot_json, review_snapshot_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('delivery-prov', 'asset-prov', 1, '{}', JSON.stringify({ id: 'review-prov-1', decision: 'keep' }), now);
}

/** Re-reviewing the asset is the operation that used to silently rewrite
 * an already-anchored canonical body under the same record id. */
function addSecondReview(db, taskId, roundId) {
  const now = '2026-09-13T12:00:00.000Z';
  db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('review-prov-2', 'asset-prov', taskId, roundId, 'reject', JSON.stringify({ note: 'changed my mind' }), now, now);
}

function setupWorkspace() {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-prov-immutable-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const project = createProject(db, { studioId, name: 'Immutable provenance project', idempotencyKey: 'prov-imm-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'task', idempotencyKey: 'prov-imm-task' }).value;
  const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', plan: {}, idempotencyKey: 'prov-imm-round' }).value;
  addRecordFacts(db, studioId, project.id, task.id, round.id);
  return { workspaceRoot, initialized, db, studioId, taskId: task.id, roundId: round.id };
}

test('persisting the same canonical body repeatedly is idempotent and creates no versions', () => {
  const fixture = setupWorkspace();
  try {
    const built = buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov');
    const first = persistStudioProvenance(fixture.db, built, new Date('2026-09-13T11:00:00.000Z'));
    const second = persistStudioProvenance(fixture.db, built, new Date('2026-09-13T11:05:00.000Z'));
    const third = persistStudioProvenance(fixture.db, built, new Date('2026-09-13T11:10:00.000Z'));
    for (const result of [first, second, third]) {
      assert.equal(result.records.length, 1);
      assert.equal(result.records[0].versionCount, 1, 're-persisting an unchanged body must not bump the version count');
      assert.equal(result.records[0].superseded, false);
    }
    assert.equal(first.records[0].contentHash, third.records[0].contentHash);
    assert.match(third.records[0].contentHash, /^[a-f0-9]{64}$/);
    // A returned record must agree with what a later read finds; an earlier
    // implementation short-circuited the write and reported an updatedAt the
    // database did not contain.
    const reread = getPersistedStudioProvenance(fixture.db, fixture.studioId, third.records[0].recordId);
    assert.equal(reread.persistedAt, third.records[0].persistedAt, 'reported persistedAt must equal the stored updated_at');
    assert.equal(reread.updatedAt, third.records[0].updatedAt);
    assert.equal(reread.contentHash, third.records[0].contentHash);
    assert.equal(reread.versionCount, third.records[0].versionCount);
    assert.equal(third.records[0].contentHash, sha256(getPersistedStudioProvenance(fixture.db, fixture.studioId, third.records[0].recordId).canonicalJson));
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM provenance_record_versions').get().count, 0, 'no history to freeze when nothing changed');
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('a re-review does not destroy the previously anchored body: the old (recordId, contentHash) still resolves', () => {
  const fixture = setupWorkspace();
  try {
    // The situation the review flagged: hand this anchor to a third party,
    // then re-review the asset, and the anchor used to silently change.
    const initial = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T11:00:00.000Z'));
    const recordId = initial.records[0].recordId;
    const anchoredHash = initial.records[0].contentHash;
    const anchored = getPersistedStudioProvenance(fixture.db, fixture.studioId, recordId);
    assert.equal(initial.records[0].versionCount, 1);
    assert.equal(initial.records[0].superseded, false);

    addSecondReview(fixture.db, fixture.taskId, fixture.roundId);
    const afterReview = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T12:05:00.000Z'));
    assert.equal(afterReview.records[0].recordId, recordId, 'the record id stays stable, as designed');
    assert.notEqual(afterReview.records[0].contentHash, anchoredHash, 'the canonical body really did change');
    assert.equal(afterReview.records[0].versionCount, 2);
    assert.equal(afterReview.records[0].superseded, true);

    // The current record has moved on...
    const current = getPersistedStudioProvenance(fixture.db, fixture.studioId, recordId);
    assert.equal(current.contentHash, afterReview.records[0].contentHash);
    assert.equal(current.versionCount, 2);
    assert.equal(current.record.review.decision, 'reject');
    const currentVersion = getStudioProvenanceVersion(fixture.db, fixture.studioId, recordId, current.contentHash);
    assert.equal(currentVersion.recordedAt, '2026-09-13T12:05:00.000Z', 'the live version timestamp is the current body write time');

    // ...but the anchor still resolves to exactly what was anchored.
    const frozen = getStudioProvenanceVersion(fixture.db, fixture.studioId, recordId, anchoredHash);
    assert.equal(frozen.record.review.decision, 'keep', 'the frozen body still carries the original review');
    assert.equal(frozen.canonicalJson, anchored.canonicalJson, 'the frozen JSON is byte-for-byte the originally anchored canonical body');
    assert.equal(sha256(frozen.canonicalJson), anchoredHash, 'the returned body hashes to the anchored digest');
    assert.equal(frozen.versionNo, 1);
    assert.equal(frozen.supersededAt, '2026-09-13T12:05:00.000Z');
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('returning to a prior canonical body preserves distinct-body version semantics', () => {
  const fixture = setupWorkspace();
  try {
    const first = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T11:00:00.000Z'));
    const recordId = first.records[0].recordId;
    const firstHash = first.records[0].contentHash;
    addSecondReview(fixture.db, fixture.taskId, fixture.roundId);
    const second = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T12:05:00.000Z'));
    assert.notEqual(second.records[0].contentHash, firstHash);
    fixture.db.prepare('UPDATE review_decisions SET decision = ?, feedback_json = ?, created_at = ?, updated_at = ? WHERE id = ?').run('keep', JSON.stringify({ note: 'first pass' }), '2026-09-13T10:00:00.000Z', '2026-09-13T13:00:00.000Z', 'review-prov-2');
    const third = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T13:05:00.000Z'));
    assert.equal(third.records[0].contentHash, firstHash, 'A-B-A returns to the original digest');
    assert.equal(third.records[0].versionCount, 2, 'versionCount counts distinct canonical bodies, not transitions');
    const versions = listStudioProvenanceVersions(fixture.db, fixture.studioId, recordId);
    assert.equal(versions.length, 2, 'both distinct bodies remain frozen exactly once');
    assert.deepEqual(versions.map((version) => version.versionNo), [1, 2]);
    assert.equal(getStudioProvenanceVersion(fixture.db, fixture.studioId, recordId, firstHash).record.review.decision, 'keep');
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('provenance history is listed oldest-first and every body stays retrievable', () => {
  const fixture = setupWorkspace();
  try {
    const first = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T11:00:00.000Z'));
    const recordId = first.records[0].recordId;
    const firstHash = first.records[0].contentHash;

    addSecondReview(fixture.db, fixture.taskId, fixture.roundId);
    const second = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T12:05:00.000Z'));
    const secondHash = second.records[0].contentHash;

    const versions = listStudioProvenanceVersions(fixture.db, fixture.studioId, recordId);
    assert.equal(versions.length, 1, 'only the superseded body is archived; the live one stays in provenance_records');
    assert.equal(versions[0].versionNo, 1);
    assert.equal(sha256(versions[0].canonicalJson), firstHash);

    // Both bodies are reachable by hash, regardless of which is current.
    const old = getStudioProvenanceVersion(fixture.db, fixture.studioId, recordId, firstHash);
    const live = getStudioProvenanceVersion(fixture.db, fixture.studioId, recordId, secondHash);
    assert.equal(old.record.review.decision, 'keep');
    assert.equal(live.record.review.decision, 'reject');
    assert.equal(live.supersededAt, null, 'the live body is not marked superseded');
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('provenance versions stay Studio scoped', () => {
  const fixture = setupWorkspace();
  try {
    const first = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T11:00:00.000Z'));
    const recordId = first.records[0].recordId;
    addSecondReview(fixture.db, fixture.taskId, fixture.roundId);
    persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T12:05:00.000Z'));

    fixture.db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_prov_foreign', fixture.workspaceRoot + '-foreign', STUDIO_SCHEMA_VERSION, '2026-09-13T13:00:00.000Z', '2026-09-13T13:00:00.000Z');
    assert.deepEqual(listStudioProvenanceVersions(fixture.db, 'studio_prov_foreign', recordId), []);
    assert.throws(() => getStudioProvenanceVersion(fixture.db, 'studio_prov_foreign', recordId, first.records[0].contentHash), /not found/);
    assert.equal(listStudioProvenanceVersions(fixture.db, fixture.studioId, recordId).length, 1);
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('rows written before v33 get the same anchoring guarantee via a derived hash', () => {
  const fixture = setupWorkspace();
  try {
    assert.equal(studioSchemaVersion(fixture.db), STUDIO_SCHEMA_VERSION);
    const built = buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov');
    const persisted = persistStudioProvenance(fixture.db, built, new Date('2026-09-13T11:00:00.000Z'));
    const recordId = persisted.records[0].recordId;

    // Rewrite the row into the pre-v33 shape (blank hash, unset count) to
    // emulate a record that predates the migration.
    fixture.db.prepare('UPDATE provenance_records SET content_hash = \'\', version_count = 1 WHERE id = ? AND studio_id = ?').run(recordId, fixture.studioId);
    const legacy = getPersistedStudioProvenance(fixture.db, fixture.studioId, recordId);
    assert.equal(legacy.contentHash, sha256(legacy.canonicalJson), 'the hash is derived from the stored body rather than trusted from a blank column');
    assert.equal(legacy.contentHash, persisted.records[0].contentHash, 'and matches what a fresh write would have computed');
    assert.equal(legacy.versionCount, 1);
    const unchanged = persistStudioProvenance(fixture.db, built, new Date('2026-09-13T11:30:00.000Z'));
    assert.equal(unchanged.records[0].versionCount, 1, 'the first unchanged write backfills the legacy hash without inventing drift');
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM provenance_record_versions').get().count, 0);

    // The derived hash is also the one an old anchor resolves by.
    addSecondReview(fixture.db, fixture.taskId, fixture.roundId);
    persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T12:05:00.000Z'));
    const frozen = getStudioProvenanceVersion(fixture.db, fixture.studioId, recordId, legacy.contentHash);
    assert.equal(frozen.record.review.decision, 'keep', 'even a pre-v33 row is frozen correctly on its first drift');
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('persist rejects cross-Studio entry assets and deliveries before writing', () => {
  const fixture = setupWorkspace();
  try {
    const built = buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov');
    const now = '2026-09-13T13:00:00.000Z';
    fixture.db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio-prov-other', fixture.workspaceRoot + '-other', STUDIO_SCHEMA_VERSION, now, now);
    fixture.db.prepare('INSERT INTO projects (id, studio_id, name, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').run('project-prov-other', 'studio-prov-other', 'Other', 'active', now, now);
    fixture.db.prepare('INSERT INTO deliveries (id, project_id, name, manifest_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('delivery-prov-other', 'project-prov-other', 'Other delivery', '{}', 'exported', now, now);
    fixture.db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset-prov-other', 'studio-prov-other', 'generated', 'image/png', 'generated/asset-prov-other.png', 'b'.repeat(64), 12, '{}', now, now);
    assert.throws(() => persistStudioProvenance(fixture.db, { ...built, records: [{ ...built.records[0], assetId: 'asset-prov-other' }] }), /asset does not match|outside the Studio/);
    assert.throws(() => persistStudioProvenance(fixture.db, { ...built, records: [{ ...built.records[0], deliveryId: 'delivery-prov-other' }] }), /outside the Studio lineage/);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM provenance_records').get().count, 0);
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('reads reject non-canonical or hash-mismatched stored provenance', () => {
  const fixture = setupWorkspace();
  try {
    const persisted = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'));
    const recordId = persisted.records[0].recordId;
    fixture.db.prepare('UPDATE provenance_records SET content_hash = ? WHERE id = ?').run('f'.repeat(64), recordId);
    assert.throws(() => getPersistedStudioProvenance(fixture.db, fixture.studioId, recordId), /content hash does not match/);
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});

test('an unknown content hash is a clean not-found rather than a silent fallback to current', () => {
  const fixture = setupWorkspace();
  try {
    const first = persistStudioProvenance(fixture.db, buildStudioProvenance(fixture.db, fixture.studioId, 'asset-prov'), new Date('2026-09-13T11:00:00.000Z'));
    const recordId = first.records[0].recordId;
    const unknown = 'f'.repeat(64);
    assert.throws(() => getStudioProvenanceVersion(fixture.db, fixture.studioId, recordId, unknown), /not found/);
  } finally {
    closeStudioDatabase(fixture.db);
    fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
  }
});
