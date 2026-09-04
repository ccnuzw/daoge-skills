const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson } = require('./local-studio-test-helper');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-session-plan-'));
}

test('Workbench session plan endpoint is read-only and projects current context without secrets', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const session = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'session', body: { conversationId: 'readonly-plan-conversation' } });
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'project', body: { name: '只读计划项目', sessionId: session.body.data.id } });
    const task = await requestJson(started, '/api/tasks', { method: 'POST', idempotencyKey: 'task', body: { projectId: project.body.data.value.id, name: '只读计划任务', sessionId: session.body.data.id } });
    const round = await requestJson(started, '/api/rounds', { method: 'POST', idempotencyKey: 'round', body: { taskId: task.body.data.value.id, purpose: 'exploration', sessionId: session.body.data.id } });
    await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/prepare', { method: 'POST', idempotencyKey: 'prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 2, prompt: '只读摘要', apiKey: 'must-not-project' } } });
    const status = await requestJson(started, '/api/sessions/' + session.body.data.id + '/plan-status');
    assert.equal(status.status, 200);
    assert.equal(status.body.data.context.project.name, '只读计划项目');
    assert.equal(status.body.data.context.task.name, '只读计划任务');
    assert.equal(status.body.data.context.round.status, 'awaiting_confirmation');
    assert.equal(status.body.data.confirmation.confirmed, false);
    assert.equal(JSON.stringify(status.body).includes('must-not-project'), false);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
