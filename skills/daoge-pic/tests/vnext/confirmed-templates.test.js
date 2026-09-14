const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase, studioSchemaVersion, STUDIO_SCHEMA_VERSION } = require('../../dist/vnext/studio/database');
const { createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const {
  CONFIRMED_TEMPLATE_LIMITS,
  saveConfirmedTemplate,
  listConfirmedTemplates,
  getConfirmedTemplate,
  archiveConfirmedTemplate,
  rollbackConfirmedTemplate
} = require('../../dist/vnext/domain/confirmed-templates');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-confirmed-template-'));
}

function createFixture() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const studioId = initialized.manifest.studioId;
  const project = createProject(db, { studioId, name: '模板沉淀项目', idempotencyKey: 'confirmed-template-project' }).value;
  const task = createTaskDraft(db, { studioId, projectId: project.id, name: '人物主视觉任务', idempotencyKey: 'confirmed-template-task' }).value;
  const round = createRoundDraft(db, {
    studioId,
    taskId: task.id,
    purpose: 'exploration',
    plan: { operation: 'generation', itemCount: 2, output: { mediaType: 'image/png', aspectRatio: '1:1' } },
    idempotencyKey: 'confirmed-template-round'
  }).value;
  const prepared = prepareRoundForConfirmation(db, {
    studioId,
    roundId: round.id,
    expectedVersion: round.version,
    plan: { operation: 'generation', itemCount: 2, output: { mediaType: 'image/png', aspectRatio: '1:1' } },
    idempotencyKey: 'confirmed-template-prepare'
  }).value;
  const confirmed = confirmRoundPlan(db, {
    studioId,
    roundId: round.id,
    expectedVersion: prepared.version,
    idempotencyKey: 'confirmed-template-confirm'
  }).value;
  return { workspaceRoot, initialized, db, studioId, project, task, round: confirmed };
}

function dispose(fixture) {
  closeStudioDatabase(fixture?.db);
  fs.rmSync(fixture?.workspaceRoot, { recursive: true, force: true });
}

function saveInput(fixture, patch = {}) {
  return {
    studioId: fixture.studioId,
    templateType: 'task_type',
    name: '人物视觉模板',
    definition: { summary: '人物视觉构图规则', fields: ['subject', 'composition'] },
    roundId: fixture.round.id,
    provenance: { summary: '用户确认的人物视觉方向。', source: 'manual-confirmation' },
    ...patch
  };
}

test('saves only from the current confirmed plan and preserves immutable versions', () => {
  const fixture = createFixture();
  try {
    assert.equal(studioSchemaVersion(fixture.db), STUDIO_SCHEMA_VERSION);
    const first = saveConfirmedTemplate(fixture.db, saveInput(fixture));
    assert.equal(first.version, 1);
    assert.equal(first.status, 'active');
    assert.equal(first.templateType, 'task_type');
    assert.deepEqual(first.definition, { fields: ['subject', 'composition'], summary: '人物视觉构图规则' });
    assert.deepEqual(first.source, {
      roundId: fixture.round.id,
      taskId: fixture.task.id,
      projectId: fixture.project.id,
      planVersion: fixture.round.planVersion
    });
    assert.equal(first.provenance.kind, 'confirmed_round_plan');
    assert.equal(first.provenance.summary, '用户确认的人物视觉方向。');

    const second = saveConfirmedTemplate(fixture.db, saveInput(fixture, {
      templateId: first.templateId,
      definition: { summary: '第二版构图规则', fields: ['subject', 'lighting'] }
    }));
    assert.equal(second.version, 2);
    assert.equal(second.status, 'active');
    assert.equal(getConfirmedTemplate(fixture.db, fixture.studioId, first.templateId, 1).definition.summary, '人物视觉构图规则');
    assert.equal(getConfirmedTemplate(fixture.db, { studioId: fixture.studioId, templateId: first.templateId }).version, 2);

    const all = listConfirmedTemplates(fixture.db, { studioId: fixture.studioId, templateId: first.templateId });
    assert.deepEqual(all.map((item) => [item.version, item.status]), [[2, 'active'], [1, 'archived']]);
    assert.deepEqual(listConfirmedTemplates(fixture.db, fixture.studioId, { includeArchived: false }).map((item) => item.version), [2]);

    assert.throws(() => fixture.db.prepare('UPDATE confirmed_templates SET definition_json = ? WHERE id = ?').run('{}', first.id), /immutable/);
    assert.throws(() => fixture.db.prepare('DELETE FROM confirmed_templates WHERE id = ?').run(first.id), /cannot be deleted/);
  } finally {
    dispose(fixture);
  }
});

test('supports all allowed types and explicit archive and rollback without rewriting history', () => {
  const fixture = createFixture();
  try {
    const types = ['task_type', 'style_kit', 'brand_kit'];
    const saved = types.map((templateType, index) => saveConfirmedTemplate(fixture.db, saveInput(fixture, {
      templateType,
      name: '模板类型 ' + index,
      definition: { summary: '安全模板 ' + index, fields: ['subject'] }
    })));
    assert.deepEqual(saved.map((item) => item.templateType), types);

    const archived = archiveConfirmedTemplate(fixture.db, { studioId: fixture.studioId, templateId: saved[0].templateId });
    assert.equal(archived.status, 'archived');
    assert.equal(getConfirmedTemplate(fixture.db, fixture.studioId, saved[0].templateId, 1).status, 'archived');
    assert.equal(listConfirmedTemplates(fixture.db, { studioId: fixture.studioId, templateId: saved[0].templateId, includeArchived: false }).length, 0);

    const rolledBack = rollbackConfirmedTemplate(fixture.db, { studioId: fixture.studioId, templateId: saved[0].templateId, version: 1 });
    assert.equal(rolledBack.status, 'active');
    assert.equal(rolledBack.version, 1);
    assert.equal(rolledBack.definition.summary, '安全模板 0');
    assert.equal(getConfirmedTemplate(fixture.db, fixture.studioId, saved[0].templateId, 1).definition.summary, '安全模板 0');
    assert.equal(listConfirmedTemplates(fixture.db, { studioId: fixture.studioId, templateId: saved[0].templateId, includeArchived: false })[0].version, 1);
  } finally {
    dispose(fixture);
  }
});

test('fails closed for unconfirmed, missing, and cross-Studio source context', () => {
  const fixture = createFixture();
  const other = createFixture();
  try {
    const draft = createRoundDraft(fixture.db, {
      studioId: fixture.studioId,
      taskId: fixture.task.id,
      purpose: 'variation',
      plan: { operation: 'generation', itemCount: 1 },
      idempotencyKey: 'confirmed-template-draft-round'
    }).value;
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { roundId: draft.id })), /confirmed round/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { roundId: 'round-does-not-exist' })), /not available/);
    assert.throws(() => saveConfirmedTemplate(other.db, saveInput(fixture)), /not available/);

    const saved = saveConfirmedTemplate(fixture.db, saveInput(fixture));
    assert.equal(getConfirmedTemplate(other.db, other.studioId, saved.templateId), null);
    assert.deepEqual(listConfirmedTemplates(other.db, { studioId: other.studioId, templateId: saved.templateId }), []);
  } finally {
    dispose(fixture);
    dispose(other);
  }
});

test('rejects unsupported types, sensitive values, malformed context, and oversized input', () => {
  const fixture = createFixture();
  try {
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { templateType: 'project' })), /not supported/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { name: 'https://example.test/template' })), /sensitive/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { definition: { prompt: 'do not persist raw prompt' } })), /sensitive/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { definition: { endpoint: 'https://provider.example/v1' } })), /sensitive/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { definition: { source: '/private/input.png' } })), /sensitive content/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { provenance: 'POST /v1/images with bearer secret' })), /sensitive/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { definition: { summary: 'x'.repeat(CONFIRMED_TEMPLATE_LIMITS.maxStringLength + 1) } })), /sensitive content|size limit/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { name: 'x'.repeat(CONFIRMED_TEMPLATE_LIMITS.maxNameLength + 1) })), /length|sensitive/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { templateId: 'x'.repeat(129) })), /safe identifier/);
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { roundId: fixture.round.id, sourceRoundId: 'different-round' })), /same round/);
  } finally {
    dispose(fixture);
  }
});

test('reading a stored snapshot never re-applies the sensitive-content scan', () => {
  const fixture = createFixture();
  try {
    assert.throws(() => saveConfirmedTemplate(fixture.db, saveInput(fixture, { definition: { fileFormat: 'webp' } })), /sensitive|unsupported/i);

    const timestamp = new Date().toISOString();
    const legacyDefinition = JSON.stringify({ fileFormat: 'webp', promptStyle: 'cinematic', notes: ['kept'] });
    const provenance = JSON.stringify({ kind: 'confirmed_round_plan', summary: '旧规则下写入的快照。', confirmedAt: timestamp });
    fixture.db.prepare('INSERT INTO confirmed_templates (id, studio_id, template_id, template_type, version, name, definition_json, source_round_id, source_task_id, source_project_id, source_plan_version, provenance_json, status, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .run('template_legacy_row', fixture.studioId, 'template_legacy', 'task_type', 1, '旧快照', legacyDefinition, fixture.round.id, fixture.task.id, fixture.project.id, 1, provenance, 'active', timestamp);

    const read = getConfirmedTemplate(fixture.db, { studioId: fixture.studioId, templateId: 'template_legacy' });
    assert.equal(read?.templateId, 'template_legacy');
    assert.deepEqual(read?.definition, { fileFormat: 'webp', notes: ['kept'], promptStyle: 'cinematic' });

    const listed = listConfirmedTemplates(fixture.db, { studioId: fixture.studioId });
    assert.equal(listed.some((item) => item.templateId === 'template_legacy'), true);

    // Structural validation is deliberately kept on the read path: records are immutable once written, so
    // this row can only be produced by out-of-contract database edits.
    let tooDeep = { leaf: true };
    for (let depth = 0; depth < CONFIRMED_TEMPLATE_LIMITS.maxDepth + 1; depth += 1) tooDeep = { nested: tooDeep };
    fixture.db.prepare('INSERT INTO confirmed_templates (id, studio_id, template_id, template_type, version, name, definition_json, source_round_id, source_task_id, source_project_id, source_plan_version, provenance_json, status, created_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)')
      .run('template_corrupt_row', fixture.studioId, 'template_corrupt', 'task_type', 1, '越界快照', JSON.stringify(tooDeep), fixture.round.id, fixture.task.id, fixture.project.id, 1, provenance, 'active', timestamp);
    assert.throws(() => getConfirmedTemplate(fixture.db, { studioId: fixture.studioId, templateId: 'template_corrupt' }), /nesting|unsupported/i);
  } finally {
    dispose(fixture);
  }
});
