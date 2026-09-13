const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { createProject, createRoundDraft, createTaskDraft, prepareRoundForConfirmation, confirmRoundPlan } = require('../../dist/vnext/domain/studio-commands');
const { parseCommand } = require('../../dist/vnext/cli/daoge');

const skillRoot = path.resolve(__dirname, '../..');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-confirmed-template-api-'));
}

async function setupFixture() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  let started;
  try {
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot, ssePollMs: 20 });
    const db = started.service.db;
    const studioId = initialized.manifest.studioId;
    const project = createProject(db, { studioId, name: '模板 API 项目', idempotencyKey: 'template-api-project' }).value;
    const task = createTaskDraft(db, { studioId, projectId: project.id, name: '模板 API 任务', idempotencyKey: 'template-api-task' }).value;
    const round = createRoundDraft(db, {
      studioId,
      taskId: task.id,
      purpose: 'exploration',
      plan: { operation: 'generation', itemCount: 1, output: { mediaType: 'image/png', aspectRatio: '1:1' } },
      idempotencyKey: 'template-api-round'
    }).value;
    const prepared = prepareRoundForConfirmation(db, {
      studioId,
      roundId: round.id,
      expectedVersion: round.version,
      plan: { operation: 'generation', itemCount: 1, output: { mediaType: 'image/png', aspectRatio: '1:1' } },
      idempotencyKey: 'template-api-prepare'
    }).value;
    const confirmed = confirmRoundPlan(db, {
      studioId,
      roundId: round.id,
      expectedVersion: prepared.version,
      idempotencyKey: 'template-api-confirm'
    }).value;
    return { workspaceRoot, initialized, started, studioId, round: confirmed };
  } catch (error) {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    throw error;
  }
}

async function dispose(fixture) {
  await fixture.started.service.close();
  fs.rmSync(fixture.workspaceRoot, { recursive: true, force: true });
}

function requestJson(started, pathname, options = {}) {
  return fetch(started.url + pathname, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      authorization: 'Bearer ' + started.access.bearerToken,
      'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0',
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(options.key ? { 'idempotency-key': options.key } : {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
}


test('confirmed-template API is Bearer-only, scoped, versioned, and idempotent', async () => {
  const fixture = await setupFixture();
  try {
    const empty = await requestJson(fixture.started, '/api/confirmed-templates');
    assert.equal(empty.status, 200, JSON.stringify(empty.body));
    assert.deepEqual(empty.body.data.templates, []);

    const saveBody = {
      templateType: 'task_type',
      name: '人物模板',
      definition: { summary: '安全构图规则', fields: ['subject', 'composition'] },
      roundId: fixture.round.id,
      provenance: { summary: '来自确认轮次。', source: 'manual-confirmation' }
    };
    const first = await requestJson(fixture.started, '/api/confirmed-templates', { method: 'POST', key: 'template-api-save-v1', body: saveBody });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.replayed, false);
    assert.equal(first.body.data.value.version, 1);
    assert.equal(first.body.data.value.status, 'active');
    const templateId = first.body.data.value.templateId;

    const replay = await requestJson(fixture.started, '/api/confirmed-templates', { method: 'POST', key: 'template-api-save-v1', body: saveBody });
    assert.deepEqual(replay.body.data.value, first.body.data.value);
    assert.equal(replay.body.data.replayed, true);

    const second = await requestJson(fixture.started, '/api/confirmed-templates', {
      method: 'POST',
      key: 'template-api-save-v2',
      body: { ...saveBody, templateId, definition: { summary: '第二版安全构图规则', fields: ['subject', 'lighting'] } }
    });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.data.value.version, 2);

    const detail = await requestJson(fixture.started, '/api/confirmed-templates/' + encodeURIComponent(templateId) + '?version=1');
    assert.equal(detail.status, 200, JSON.stringify(detail.body));
    assert.equal(detail.body.data.template.version, 1);
    assert.equal(detail.body.data.template.status, 'archived');

    const filtered = await requestJson(fixture.started, '/api/confirmed-templates?templateType=task_type&templateId=' + encodeURIComponent(templateId) + '&includeArchived=false');
    assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
    assert.deepEqual(filtered.body.data.templates.map((template) => template.version), [2]);

    const archive = await requestJson(fixture.started, '/api/confirmed-templates/' + encodeURIComponent(templateId) + '/archive', { method: 'POST', key: 'template-api-archive', body: {} });
    assert.equal(archive.status, 200, JSON.stringify(archive.body));
    assert.equal(archive.body.data.replayed, false);
    assert.equal(archive.body.data.value.status, 'archived');
    const activeAfterArchive = await requestJson(fixture.started, '/api/confirmed-templates?includeArchived=0');
    assert.deepEqual(activeAfterArchive.body.data.templates, []);
    const archived = await requestJson(fixture.started, '/api/confirmed-templates?includeArchived=true');
    assert.deepEqual(archived.body.data.templates.map((template) => template.version), [2, 1]);

    const rollback = await requestJson(fixture.started, '/api/confirmed-templates/' + encodeURIComponent(templateId) + '/rollback', { method: 'POST', key: 'template-api-rollback', body: { version: 1 } });
    assert.equal(rollback.status, 200, JSON.stringify(rollback.body));
    assert.equal(rollback.body.data.value.version, 1);
    assert.equal(rollback.body.data.value.status, 'active');
    const activeAfterRollback = await requestJson(fixture.started, '/api/confirmed-templates?includeArchived=false');
    assert.deepEqual(activeAfterRollback.body.data.templates.map((template) => template.version), [1]);

    const missing = await requestJson(fixture.started, '/api/confirmed-templates/missing-template');
    assert.equal(missing.status, 404);
  } finally {
    await dispose(fixture);
  }
});

test('confirmed-template API rejects Workbench Cookie reads and writes', async () => {
  const fixture = await setupFixture();
  try {
    const cookieResponse = await fetch(fixture.started.url + '/api/auth/bootstrap', {
      method: 'POST',
      headers: { origin: fixture.started.url, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ capability: fixture.started.access.bearerToken })
    });
    assert.equal(cookieResponse.status, 200);
    const cookie = (cookieResponse.headers.get('set-cookie') || '').split(';', 1)[0];
    const headers = { accept: 'application/json', cookie, 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/2.0.0' };
    const getResponse = await fetch(fixture.started.url + '/api/confirmed-templates', { headers });
    assert.equal(getResponse.status, 403);
    const postResponse = await fetch(fixture.started.url + '/api/confirmed-templates', {
      method: 'POST',
      headers: { ...headers, origin: fixture.started.url, 'content-type': 'application/json', 'idempotency-key': 'template-cookie-write' },
      body: JSON.stringify({ templateType: 'task_type', name: '拒绝模板', definition: { summary: '不可写入' }, roundId: fixture.round.id })
    });
    assert.equal(postResponse.status, 403);
    assert.equal(fixture.started.service.db.prepare('SELECT COUNT(*) AS total FROM confirmed_templates').get().total, 0);
  } finally {
    await dispose(fixture);
  }
});

test('CLI exposes structured confirmed-template commands with encoded query and mutation contracts', () => {
  const root = '/tmp/daoge-template-cli';
  const listed = parseCommand(['template-list', '--workspace', root, '--type', 'task_type', '--template', 'ctemplate-1', '--include-archived', 'false']);
  assert.equal(listed.request.method, 'GET');
  assert.equal(listed.request.pathname, '/api/confirmed-templates?templateType=task_type&templateId=ctemplate-1&includeArchived=false');

  const fetched = parseCommand(['template-get', '--workspace', root, '--template', 'ctemplate-1', '--version', '2']);
  assert.equal(fetched.request.method, 'GET');
  assert.equal(fetched.request.pathname, '/api/confirmed-templates/ctemplate-1?version=2');

  const saved = parseCommand(['template-save', '--workspace', root, '--type', 'task_type', '--name', '人物模板', '--definition', '{"summary":"安全规则"}', '--round', 'round-1', '--template', 'ctemplate-1', '--provenance', '{"summary":"来自确认轮次"}', '--plan-version', '3', '--idempotency-key', 'template-save-once']);
  assert.equal(saved.request.method, 'POST');
  assert.equal(saved.request.pathname, '/api/confirmed-templates');
  assert.deepEqual(saved.request.body, {
    templateType: 'task_type',
    name: '人物模板',
    definition: { summary: '安全规则' },
    roundId: 'round-1',
    templateId: 'ctemplate-1',
    provenance: { summary: '来自确认轮次' },
    planVersion: 3
  });
  assert.equal(saved.request.idempotencyKey, 'template-save-once');

  const archived = parseCommand(['template-archive', '--workspace', root, '--template', 'ctemplate-1', '--operation-name', 'confirmed_templates.archive:ctemplate-1']);
  assert.equal(archived.request.pathname, '/api/confirmed-templates/ctemplate-1/archive');
  assert.deepEqual(archived.request.body, {});
  assert.equal(archived.request.idempotencyKey, undefined);
  assert.equal(archived.request.operationName, 'confirmed_templates.archive:ctemplate-1');

  const rolledBack = parseCommand(['template-rollback', '--workspace', root, '--template', 'ctemplate-1', '--version', '2', '--idempotency-key', 'template-rollback-once']);
  assert.equal(rolledBack.request.pathname, '/api/confirmed-templates/ctemplate-1/rollback');
  assert.deepEqual(rolledBack.request.body, { version: 2 });
  assert.equal(rolledBack.request.idempotencyKey, 'template-rollback-once');

  assert.throws(() => parseCommand(['template-list', '--workspace', root, '--include-archived', 'maybe']), /只能是 true 或 false/);
  assert.throws(() => parseCommand(['template-get', '--workspace', root, '--template', 'ctemplate-1', '--version', '0']), /正整数/);

  const help = spawnSync(process.execPath, [path.join(skillRoot, 'scripts', 'daoge.js'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  for (const command of ['template-list', 'template-get', 'template-save', 'template-archive', 'template-rollback']) assert.match(help.stdout, new RegExp('daoge ' + command + '\\b'));
});

