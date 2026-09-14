const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { createProject, createTaskDraft, createRoundDraft } = require('../../dist/vnext/domain/studio-commands');
const { getQualityMetrics } = require('../../dist/vnext/domain/quality-metrics');
const { requestJson } = require('./local-studio-test-helper');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-quality-metrics-'));
}

function insertRun(db, runId, roundId, status, timestamp) {
  db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(runId, roundId, status, '{}', '{}', 1, timestamp, timestamp);
}

function insertItem(db, itemId, runId, sequence, status, error, timestamp) {
  db.prepare('INSERT INTO run_items (id, run_id, sequence, status, prompt_payload_json, request_id, attempts, error_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(itemId, runId, sequence, status, '{}', 'request-' + itemId, 1, error ? JSON.stringify(error) : null, timestamp, timestamp);
}

function insertAsset(db, assetId, studioId, timestamp) {
  db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(assetId, studioId, 'generated', 'image/png', 'generated/' + assetId + '.png', assetId.padEnd(64, '0').slice(0, 64), 12, '{}', timestamp, timestamp);
}

function insertAssetRelation(db, relationId, assetId, relationType, targetType, targetId, timestamp) {
  db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(relationId, assetId, relationType, targetType, targetId, '{}', timestamp);
}

function populate(db, studioId) {
  const project = createProject(db, { studioId, name: 'Quality project', idempotencyKey: 'quality-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'Quality task', idempotencyKey: 'quality-task' }).value;
  const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'quality-round' }).value;
  const otherProject = createProject(db, { studioId, name: 'Other project', idempotencyKey: 'other-quality-project' }).value;
  const otherTask = createTaskDraft(db, { studioId, projectId: otherProject.id, name: 'Other task', idempotencyKey: 'other-quality-task' }).value;
  const otherRound = createRoundDraft(db, { studioId, taskId: otherTask.id, purpose: 'exploration', idempotencyKey: 'other-quality-round' }).value;
  const timestamp = '2026-09-13T12:00:00.000Z';

  insertRun(db, 'quality-run', round.id, 'partial', timestamp);
  insertItem(db, 'quality-success', 'quality-run', 1, 'succeeded', null, timestamp);
  insertItem(db, 'quality-rate-limit', 'quality-run', 2, 'failed', { kind: 'provider', code: 'HTTP_429', summary: 'https://secret.example/private /Users/private.png' }, '2026-09-13T12:01:00.000Z');
  insertItem(db, 'quality-invalid', 'quality-run', 3, 'blocked', { kind: 'validation', code: 'invalid_input' }, timestamp);
  insertItem(db, 'quality-unknown', 'quality-run', 4, 'outcome_unknown', { kind: 'provider', code: 'unknown_outcome' }, timestamp);
  insertItem(db, 'quality-pending', 'quality-run', 5, 'pending', null, timestamp);

  insertRun(db, 'other-quality-run', otherRound.id, 'completed', timestamp);
  insertItem(db, 'other-quality-failed', 'other-quality-run', 1, 'failed', { kind: 'other', code: 'other_failure' }, timestamp);

  insertAsset(db, 'quality-asset', studioId, timestamp);
  insertAsset(db, 'other-quality-asset', studioId, timestamp);
  db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('quality-review', 'quality-asset', task.id, round.id, 'keep', '{}', timestamp, timestamp);
  db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('other-quality-review', 'other-quality-asset', otherTask.id, otherRound.id, 'reject', '{}', timestamp, timestamp);
  return { project, studioId };
}

test('quality metrics aggregate scoped outcomes and safe failure patterns', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const context = populate(started.service.db, initialized.manifest.studioId);
    const metrics = getQualityMetrics(started.service.db, context.studioId, { projectId: context.project.id });

    assert.equal(metrics.runs.total, 1);
    assert.equal(metrics.runs.byStatus.partial, 1);
    assert.equal(metrics.runItems.total, 5);
    assert.equal(metrics.runItems.terminal, 4);
    assert.equal(metrics.runItems.successful, 1);
    assert.equal(metrics.runItems.successRate, 0.25);
    assert.equal(metrics.runItems.byStatus.failed, 1);
    assert.equal(metrics.runItems.byStatus.outcome_unknown, 1);
    assert.equal(metrics.reviews.total, 1);
    assert.deepEqual(metrics.reviews.byDecision, { keep: 1, review: 0, reject: 0, derive: 0 });
    assert.equal(metrics.reviews.keepRate, 1);
    assert.deepEqual(metrics.failurePatterns.map((pattern) => ({ key: pattern.key, count: pattern.count })), [
      { key: 'provider:http_429', count: 1 },
      { key: 'provider:unknown_outcome', count: 1 },
      { key: 'validation:invalid_input', count: 1 }
    ]);
    assert.equal(JSON.stringify(metrics).includes('secret.example'), false);
    assert.equal(JSON.stringify(metrics).includes('/Users/private.png'), false);

    const response = await requestJson(started, '/api/projects/' + context.project.id + '/quality-metrics');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.data.metrics.runItems.byStatus, metrics.runItems.byStatus);
    assert.equal(response.body.data.metrics.scope.projectId, context.project.id);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('project quality metrics isolate explicit reviews and global shared-asset attribution', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    db = require('../../dist/vnext/studio/database').openStudioDatabase(initialized.paths, initialized.manifest);
    const studioId = initialized.manifest.studioId;
    const project = createProject(db, { studioId, name: 'Review metrics project', idempotencyKey: 'review-metrics-project' }).value;
    const otherProject = createProject(db, { studioId, name: 'Other review metrics project', idempotencyKey: 'other-review-metrics-project' }).value;
    const otherTask = createTaskDraft(db, { studioId, projectId: otherProject.id, name: 'Other review metrics task', idempotencyKey: 'other-review-metrics-task' }).value;
    const timestamp = '2026-09-13T12:00:00.000Z';
    const addReview = (id, assetId, taskId, roundId, decision) => db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, assetId, taskId, roundId, decision, '{}', timestamp, timestamp);
    const addSharedProjectAsset = (assetId, ownerProjectId) => {
      insertAsset(db, assetId, studioId, timestamp);
      insertAssetRelation(db, 'relation-' + assetId + '-project', assetId, 'attached_to', 'project', ownerProjectId, timestamp);
      insertAssetRelation(db, 'relation-' + assetId + '-shared', assetId, 'shared_across_projects', 'studio', studioId, timestamp);
    };

    addSharedProjectAsset('review-metrics-explicit-foreign', project.id);
    addReview('review-metrics-explicit-foreign', 'review-metrics-explicit-foreign', otherTask.id, null, 'reject');
    addSharedProjectAsset('review-metrics-global-owned', project.id);
    addReview('review-metrics-global-owned', 'review-metrics-global-owned', null, null, 'keep');
    addSharedProjectAsset('review-metrics-global-foreign', otherProject.id);
    addReview('review-metrics-global-foreign', 'review-metrics-global-foreign', null, null, 'keep');
    insertAsset(db, 'review-metrics-shared-only-target', studioId, timestamp);
    insertAssetRelation(db, 'relation-review-metrics-shared-only-target', 'review-metrics-shared-only-target', 'shared_across_projects', 'studio', studioId, timestamp);
    db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, schema_version, context_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('review-metrics-shared-only-target-review', 'review-metrics-shared-only-target', null, null, 'review', '{}', 2, JSON.stringify({ schemaVersion: 2, source: 'manual', projectId: project.id, tags: [], criteria: [] }), timestamp, timestamp);
    insertAsset(db, 'review-metrics-shared-only-foreign-context', studioId, timestamp);
    insertAssetRelation(db, 'relation-review-metrics-shared-only-foreign-context', 'review-metrics-shared-only-foreign-context', 'shared_across_projects', 'studio', studioId, timestamp);
    db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, schema_version, context_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('review-metrics-shared-only-foreign-context-review', 'review-metrics-shared-only-foreign-context', null, null, 'reject', '{}', 2, JSON.stringify({ schemaVersion: 2, source: 'manual', projectId: otherProject.id, tags: [], criteria: [] }), timestamp, timestamp);
    const studioReviews = getQualityMetrics(db, studioId).reviews;
    assert.deepEqual(studioReviews.byDecision, { keep: 2, review: 1, reject: 2, derive: 0 });
    assert.equal(studioReviews.total, 5);

    const projectReviews = getQualityMetrics(db, studioId, { projectId: project.id }).reviews;
    assert.deepEqual(projectReviews.byDecision, { keep: 1, review: 1, reject: 0, derive: 0 });
    assert.equal(projectReviews.total, 2);
    const otherProjectReviews = getQualityMetrics(db, studioId, { projectId: otherProject.id }).reviews;
    assert.deepEqual(otherProjectReviews.byDecision, { keep: 1, review: 0, reject: 2, derive: 0 });
    assert.equal(otherProjectReviews.total, 3);
  } finally {
    if (db) require('../../dist/vnext/studio/database').closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
test('project quality metrics include reviews explicitly attributed to a current round', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    db = require('../../dist/vnext/studio/database').openStudioDatabase(initialized.paths, initialized.manifest);
    const studioId = initialized.manifest.studioId;
    const project = createProject(db, { studioId, name: 'Round review metrics project', idempotencyKey: 'round-review-metrics-project' }).value;
    const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'Round review metrics task', idempotencyKey: 'round-review-metrics-task' }).value;
    const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'refinement', idempotencyKey: 'round-review-metrics-round' }).value;
    const timestamp = '2026-09-13T12:00:00.000Z';
    insertAsset(db, 'round-review-metrics-asset', studioId, timestamp);
    db.prepare('INSERT INTO review_decisions (id, asset_id, task_id, round_id, decision, feedback_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('round-review-metrics-review', 'round-review-metrics-asset', null, round.id, 'review', '{}', timestamp, timestamp);
    const metrics = getQualityMetrics(db, studioId, { projectId: project.id });
    assert.deepEqual(metrics.reviews.byDecision, { keep: 0, review: 1, reject: 0, derive: 0 });
    assert.equal(metrics.reviews.total, 1);
  } finally {
    if (db) require('../../dist/vnext/studio/database').closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('quality metrics reject projects outside the current Studio', () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    started = require('../../dist/vnext/studio/database').openStudioDatabase(initialized.paths, initialized.manifest);
    assert.throws(() => getQualityMetrics(started, initialized.manifest.studioId, { projectId: 'missing-project' }), /Project not found/);
  } finally {
    if (started) require('../../dist/vnext/studio/database').closeStudioDatabase(started);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('cancelled run items do not count against the terminal success rate', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot });
    const db = started.service.db;
    const studioId = initialized.manifest.studioId;
    const project = createProject(db, { studioId, name: 'Cancel project', idempotencyKey: 'cancel-project' }).value;
    const task = createTaskDraft(db, { studioId, projectId: project.id, name: 'Cancel task', idempotencyKey: 'cancel-task' }).value;
    const round = createRoundDraft(db, { studioId, taskId: task.id, purpose: 'exploration', idempotencyKey: 'cancel-round' }).value;
    const timestamp = '2026-09-14T00:00:00.000Z';
    insertRun(db, 'cancel-run', round.id, 'partial', timestamp);
    insertItem(db, 'cancel-success', 'cancel-run', 1, 'succeeded', null, timestamp);
    insertItem(db, 'cancel-failed', 'cancel-run', 2, 'failed', { kind: 'provider', code: 'timeout' }, timestamp);
    insertItem(db, 'cancel-cancelled-a', 'cancel-run', 3, 'cancelled', null, timestamp);
    insertItem(db, 'cancel-cancelled-b', 'cancel-run', 4, 'cancelled', null, timestamp);

    const metrics = getQualityMetrics(db, studioId, { projectId: project.id });
    assert.equal(metrics.runItems.total, 4);
    assert.equal(metrics.runItems.terminal, 4);
    assert.equal(metrics.runItems.cancelled, 2);
    assert.equal(metrics.runItems.settled, 2);
    assert.equal(metrics.runItems.successRate, 0.5);

    const api = await requestJson(started, '/api/projects/' + project.id + '/quality-metrics');
    assert.equal(api.status, 200, JSON.stringify(api.body));
    assert.equal(api.body.data.metrics.runItems.settled, 2);
    assert.equal(api.body.data.metrics.runItems.successRate, 0.5);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
