const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio, studioPaths, ensureAssetBucket } = require('../../dist/vnext/studio/workspace');
const { loadProviderConfig, providerSnapshot, providerStatus } = require('../../dist/vnext/studio/provider-config');
const { openStudioDatabase, closeStudioDatabase, appendStudioEvent, studioSchemaVersion } = require('../../dist/vnext/studio/database');
const { openOrAttachStudioSession, archiveProject, createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan, listRoundPlanVersions, VersionConflictError } = require('../../dist/vnext/domain/studio-commands');
const { stageImage, archiveStagedImage, validateImageBytes, MediaValidationError } = require('../../dist/vnext/media/archive');
const { assertRunTransition, assertRunItemTransition, StateTransitionError } = require('../../dist/vnext/domain/states');
const { searchStudio } = require('../../dist/vnext/domain/queries');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-vnext-'));
}

function cleanup(workspaceRoot) {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

test('initializes a Studio without eagerly creating asset or delivery directories', () => {
  const workspaceRoot = temporaryWorkspace();
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    assert.equal(initialized.createdManifest, true);
    assert.equal(initialized.createdProviderEnv, true);
    assert.ok(fs.existsSync(initialized.paths.studioDir));
    assert.ok(fs.existsSync(initialized.paths.manifestPath));
    assert.ok(fs.existsSync(initialized.paths.providerEnvPath));
    assert.equal(fs.existsSync(initialized.paths.assetRoot), false);
    assert.equal(fs.existsSync(initialized.paths.deliveriesRoot), false);
    assert.match(fs.readFileSync(path.join(workspaceRoot, '.gitignore'), 'utf8'), /daoge-studio\/provider.env/);

    const next = initializeStudio({ workspaceRoot, providerTemplatePath });
    assert.equal(next.createdManifest, false);
    assert.equal(next.createdProviderEnv, false);
    assert.equal(next.manifest.studioId, initialized.manifest.studioId);

    const generatedDir = ensureAssetBucket(next.paths, 'generated');
    assert.ok(fs.existsSync(generatedDir));
    assert.equal(path.dirname(generatedDir), next.paths.assetRoot);
  } finally {
    cleanup(workspaceRoot);
  }
});

test('loads provider.env without exposing API keys in the safe status or snapshot', () => {
  const workspaceRoot = temporaryWorkspace();
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    fs.writeFileSync(initialized.paths.providerEnvPath, [
      'IMAGE_PROVIDER=openai-images',
      'OPENAI_BASE_URL=https://images.example.test/v1',
      'OPENAI_API_KEY=secret-value-must-not-escape',
      'OPENAI_MODEL=gpt-image-2'
    ].join('\n') + '\n');

    const config = loadProviderConfig(initialized.paths);
    assert.ok(config);
    assert.equal(config.apiKey, 'secret-value-must-not-escape');
    const status = providerStatus(initialized.paths);
    assert.deepEqual(status, {
      providerId: 'openai-images',
      configured: true,
      missing: [],
      model: 'gpt-image-2',
      endpoint: 'https://images.example.test',
      capabilities: { generate: true, edit: true, referenceImage: true, mask: true }
    });
    assert.equal(JSON.stringify(status).includes('secret-value-must-not-escape'), false);
    const snapshot = providerSnapshot(config);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'apiKey'), false);
    assert.equal(JSON.stringify(snapshot).includes('secret-value-must-not-escape'), false);
  } finally {
    cleanup(workspaceRoot);
  }
});

test('creates the vNext schema and emits monotonic Studio events', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    assert.equal(studioSchemaVersion(db), 10);
    const studio = db.prepare('SELECT id, workspace_root FROM studios WHERE id = ?').get(initialized.manifest.studioId);
    assert.equal(studio.id, initialized.manifest.studioId);
    assert.equal(studio.workspace_root, initialized.paths.workspaceRoot);
    const first = appendStudioEvent(db, { studioId: initialized.manifest.studioId, entityType: 'studio', entityId: initialized.manifest.studioId, eventType: 'studio.initialized' });
    const second = appendStudioEvent(db, { studioId: initialized.manifest.studioId, entityType: 'studio', entityId: initialized.manifest.studioId, eventType: 'studio.checked' });
    assert.equal(second, first + 1);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});


test('keeps SQLite FTS search synchronized with project changes', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'FTS 检索项目', description: 'Product visual exploration', idempotencyKey: 'fts-project' });
    assert.deepEqual(searchStudio(db, initialized.manifest.studioId, 'visual').map((result) => result.entityId), [project.value.id]);
    db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?').run('FTS 更新项目', 'Updated description', project.value.id);
    assert.equal(searchStudio(db, initialized.manifest.studioId, 'visual').length, 0);
    assert.deepEqual(searchStudio(db, initialized.manifest.studioId, 'Updated').map((result) => result.entityId), [project.value.id]);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});

test('stages, validates, and atomically archives managed image bytes', () => {
  const workspaceRoot = temporaryWorkspace();
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
    const staged = stageImage(initialized.paths, png, 'image/png');
    assert.ok(fs.existsSync(staged.stagingPath));
    assert.equal(fs.existsSync(initialized.paths.assetRoot), false);
    const archived = archiveStagedImage(initialized.paths, staged, { assetId: 'asset_safe_1', bucket: 'generated' });
    assert.ok(fs.existsSync(archived.absolutePath));
    assert.equal(fs.existsSync(staged.stagingPath), false);
    assert.equal(archived.storagePath, 'daoge-assets/generated/asset_safe_1.png');
    assert.equal(archived.contentHash, validateImageBytes(png).contentHash);
    assert.throws(() => validateImageBytes(png, 'image/jpeg'), MediaValidationError);
  } finally {
    cleanup(workspaceRoot);
  }
});

test('persists confirmed creative context with idempotency and optimistic versions', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    const session = openOrAttachStudioSession(db, { studioId: initialized.manifest.studioId, conversationId: 'conversation-1' });
    assert.equal(openOrAttachStudioSession(db, { studioId: initialized.manifest.studioId, conversationId: 'conversation-1' }).id, session.id);

    const createdProject = createProject(db, { studioId: initialized.manifest.studioId, name: '新品发布', sessionId: session.id, idempotencyKey: 'project-1' });
    const replayedProject = createProject(db, { studioId: initialized.manifest.studioId, name: '新品发布', sessionId: session.id, idempotencyKey: 'project-1' });
    assert.equal(createdProject.replayed, false);
    assert.equal(replayedProject.replayed, true);
    assert.equal(replayedProject.value.id, createdProject.value.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM projects').get().total, 1);
    assert.throws(() => createProject(db, { studioId: initialized.manifest.studioId, name: '不应创建', idempotencyKey: 'project-1' }), /Idempotency key/);

    const task = createTaskDraft(db, { projectId: createdProject.value.id, name: '产品主视觉', intent: { format: 'landscape' }, sessionId: session.id, idempotencyKey: 'task-1' });
    const round = createRoundDraft(db, { taskId: task.value.id, purpose: 'exploration', sessionId: session.id, idempotencyKey: 'round-1' });
    const context = db.prepare('SELECT active_project_id, active_task_id, active_round_id FROM studio_sessions WHERE id = ?').get(session.id);
    assert.equal(context.active_project_id, createdProject.value.id);
    assert.equal(context.active_task_id, task.value.id);
    assert.equal(context.active_round_id, round.value.id);
    const prepared = prepareRoundForConfirmation(db, { roundId: round.value.id, plan: { prompt: 'clean product image' }, expectedVersion: round.value.version, idempotencyKey: 'prepare-1' });
    assert.equal(prepared.value.status, 'awaiting_confirmation');
    assert.equal(prepared.value.planVersion, 2);
    assert.throws(() => confirmRoundPlan(db, { roundId: round.value.id, expectedVersion: 1, idempotencyKey: 'confirm-conflict' }), VersionConflictError);
    const confirmed = confirmRoundPlan(db, { roundId: round.value.id, expectedVersion: prepared.value.version, idempotencyKey: 'confirm-1' });
    assert.equal(confirmed.value.status, 'active');
    assert.equal(confirmed.value.version, 3);
    const versions = listRoundPlanVersions(db, round.value.id);
    assert.deepEqual(versions.map((version) => [version.planVersion, version.state]), [[2, 'confirmed'], [1, 'draft']]);
    assert.equal(versions[0].plan.prompt, 'clean product image');
    const eventTypes = db.prepare('SELECT event_type FROM events ORDER BY id').all().map((row) => row.event_type);
    assert.deepEqual(eventTypes, ['session.attached', 'session.context_updated', 'project.created', 'session.context_updated', 'task.draft_created', 'session.context_updated', 'round.draft_created', 'round.awaiting_confirmation', 'round.confirmed']);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});


test('archives a project and its creative context only after unfinished runs are absent', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '归档项目', idempotencyKey: 'archive-project' });
    const task = createTaskDraft(db, { projectId: project.value.id, name: '归档任务', idempotencyKey: 'archive-task' });
    const round = createRoundDraft(db, { taskId: task.value.id, purpose: 'exploration', idempotencyKey: 'archive-round' });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('run_archive_guard', round.value.id, 'queued', '{}', '{}', now, now);
    assert.throws(() => archiveProject(db, { projectId: project.value.id, idempotencyKey: 'archive-while-queued' }), /unfinished/);
    db.prepare("UPDATE generation_runs SET status = 'paused' WHERE id = ?").run('run_archive_guard');
    const archived = archiveProject(db, { projectId: project.value.id, idempotencyKey: 'archive-command' });
    assert.equal(archived.value.status, 'archived');
    assert.equal(db.prepare('SELECT status FROM creative_tasks WHERE id = ?').get(task.value.id).status, 'archived');
    assert.equal(db.prepare('SELECT status FROM creative_rounds WHERE id = ?').get(round.value.id).status, 'archived');
    assert.throws(() => createTaskDraft(db, { projectId: project.value.id, name: '不应创建', idempotencyKey: 'archived-task' }), /archived/);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});

test('enforces vNext run and run item transition contracts', () => {
  assert.doesNotThrow(() => assertRunTransition('draft', 'awaiting_confirmation'));
  assert.doesNotThrow(() => assertRunTransition('resume_pending', 'queued'));
  assert.doesNotThrow(() => assertRunItemTransition('requesting', 'outcome_unknown'));
  assert.doesNotThrow(() => assertRunItemTransition('outcome_unknown', 'failed'));
  assert.throws(() => assertRunTransition('completed', 'queued'), StateTransitionError);
  assert.throws(() => assertRunItemTransition('succeeded', 'pending'), StateTransitionError);
});
