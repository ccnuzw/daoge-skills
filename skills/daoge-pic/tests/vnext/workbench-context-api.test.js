const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');

async function requestJson(url, pathname, options = {}) {
  const response = await fetch(url + pathname, {
    method: options.method || 'GET',
    headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
}

test('Workbench Session context is readable, validates hierarchy, and never selects an implicit run', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-workbench-context-'));
  let started;
  try {
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath });
    const opened = await requestJson(started.url, '/api/sessions/open', { method: 'POST', idempotencyKey: 'context-session-open', body: { conversationId: 'workbench-test-context' } });
    assert.equal(opened.status, 200);
    const session = opened.body.data;
    const initial = await requestJson(started.url, '/api/sessions/' + session.id);
    assert.deepEqual(initial.body.data.session.activeProjectId, null);
    const project = await requestJson(started.url, '/api/projects', { method: 'POST', idempotencyKey: 'context-project', body: { name: 'P0 项目' } });
    const task = await requestJson(started.url, '/api/tasks', { method: 'POST', idempotencyKey: 'context-task', body: { projectId: project.body.data.value.id, name: 'P0 任务' } });
    const round = await requestJson(started.url, '/api/rounds', { method: 'POST', idempotencyKey: 'context-round', body: { taskId: task.body.data.value.id, purpose: 'exploration' } });
    const updated = await requestJson(started.url, '/api/sessions/' + session.id + '/context', { method: 'POST', idempotencyKey: 'context-select-round', body: { projectId: project.body.data.value.id, taskId: task.body.data.value.id, roundId: round.body.data.value.id } });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.data, { ...session, activeProjectId: project.body.data.value.id, activeTaskId: task.body.data.value.id, activeRoundId: round.body.data.value.id, version: session.version + 1 });
    const restored = await requestJson(started.url, '/api/sessions/' + session.id);
    assert.equal(restored.body.data.session.activeRoundId, round.body.data.value.id);
    const roundRuns = await requestJson(started.url, '/api/rounds/' + round.body.data.value.id + '/runs');
    assert.deepEqual(roundRuns.body.data.runs, []);
    const scopedAssets = await requestJson(started.url, '/api/assets?scope=round&projectId=' + project.body.data.value.id + '&taskId=' + task.body.data.value.id + '&roundId=' + round.body.data.value.id);
    assert.equal(scopedAssets.status, 200);
    assert.deepEqual(scopedAssets.body.data.assets, []);
    const invalid = await requestJson(started.url, '/api/assets?scope=round&projectId=wrong-project&taskId=' + task.body.data.value.id + '&roundId=' + round.body.data.value.id);
    assert.equal(invalid.status, 400);
    const missing = await requestJson(started.url, '/api/sessions/missing-session');
    assert.equal(missing.status, 404);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
