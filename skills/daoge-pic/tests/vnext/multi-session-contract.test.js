const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { openOrReuseWorkbench } = require('../../dist/vnext/cli/daoge');
const { WorkbenchPresence } = require('../../dist/vnext/runtime/workbench-presence');
const { claimRunItems } = require('../../dist/vnext/runner/run-commands');
const { configureProvider } = require('./provider-test-helper');
const { requestJson, requestJsonAsWorkbench, workbenchCookie } = require('./local-studio-test-helper');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-multi-session-'));
}

test('Workbench presence claims are atomic, expiring, releasable only by their owner, and force bypasses presence', () => {
  let now = 1_000;
  const presence = new WorkbenchPresence({ now: () => now, claimTtlMs: 1_000, recentPresenceTtlMs: 2_000 });
  const firstToken = 'a'.repeat(43);
  const secondToken = 'b'.repeat(43);
  assert.deepEqual(presence.claim(firstToken), { claimed: true, reused: false, reason: 'opener-claim' });
  assert.deepEqual(presence.claim(secondToken), { claimed: false, reused: true, reason: 'open-claim-active' });
  assert.equal(presence.release(secondToken), false);
  assert.equal(presence.release(firstToken), true);

  const detach = presence.attachActiveConnection();
  assert.deepEqual(presence.claim(secondToken), { claimed: false, reused: true, reason: 'active-workbench' });
  assert.deepEqual(presence.claim(secondToken, true), { claimed: true, reused: false, reason: 'forced-opener-claim' });
  assert.equal(presence.release(secondToken), true);
  detach();
  assert.deepEqual(presence.claim(firstToken), { claimed: false, reused: true, reason: 'recent-workbench' });
  now += 2_001;
  assert.deepEqual(presence.claim(firstToken), { claimed: true, reused: false, reason: 'opener-claim' });
});

test('four concurrent CLI opens share one opener claim and opener failure releases only its own claim', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  let now = 10_000;
  let openerCalls = 0;
  const presence = new WorkbenchPresence({ now: () => now, claimTtlMs: 1_000, recentPresenceTtlMs: 5_000 });
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot, workbenchPresence: presence });
    const record = { pid: process.pid, url: started.url, capability: started.access.bearerToken, workspaceRoot, heartbeatAt: new Date().toISOString() };
    const outputs = await Promise.all(Array.from({ length: 4 }, () => openOrReuseWorkbench(record, false, async () => { openerCalls += 1; })));
    assert.equal(openerCalls, 1);
    assert.equal(outputs.filter((output) => output.opened && !output.reused).length, 1);
    assert.equal(outputs.filter((output) => !output.opened && output.reused).length, 3);
    assert.equal(JSON.stringify(outputs).includes('claimToken'), false);

    const unauthorized = await fetch(started.url + '/api/workbench/open-claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claimToken: 'x'.repeat(43) }) });
    assert.equal(unauthorized.status, 401);
    now += 1_001;
    await assert.rejects(openOrReuseWorkbench(record, true, async () => { throw new Error('deterministic opener failure'); }), /deterministic opener failure/);
    const recovered = await openOrReuseWorkbench(record, false, async () => { openerCalls += 1; });
    assert.equal(recovered.opened, true, 'the failed claimant must release its own claim');

    now += 1_001;
    presence.recordAuthenticatedConnection();
    const reused = await openOrReuseWorkbench(record, false, async () => { openerCalls += 1; });
    assert.deepEqual(reused, { opened: false, reused: true, reason: 'recent-workbench' });
    const forced = await openOrReuseWorkbench(record, true, async () => { openerCalls += 1; });
    assert.deepEqual(forced, { opened: true, reused: false, reason: 'forced-opener-claim' });
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
test('Session context rejects a stale version rather than overwriting newer navigation', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'context-version-test-key' });
    started = await startLocalStudioService({ workspaceRoot });
    const session = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'context-occ-session', body: { conversationId: 'context-occ-conversation' } });
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'context-occ-project', body: { name: 'Context OCC' } });
    const sessionId = session.body.data.id;
    const projectId = project.body.data.value.id;
    const first = await requestJson(started, '/api/sessions/' + sessionId + '/context', { method: 'POST', idempotencyKey: 'context-occ-first', body: { projectId, expectedVersion: 1 } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const stale = await requestJson(started, '/api/sessions/' + sessionId + '/context', { method: 'POST', idempotencyKey: 'context-occ-stale', body: { projectId, expectedVersion: 1 } });
    assert.equal(stale.status, 409, JSON.stringify(stale.body));
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});


test('four agent conversations retain independent Session context, project ownership, Runs, and fair queue claims', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { model: 'gpt-image-2', apiKey: 'multi-session-test-key' });
    started = await startLocalStudioService({ workspaceRoot });

    const sessions = await Promise.all(Array.from({ length: 4 }, (_, index) => requestJson(started, '/api/sessions/open', {
      method: 'POST',
      idempotencyKey: 'session-' + index,
      body: { conversationId: 'real-conversation-' + index }
    }).then((response) => response.body.data)));
    assert.equal(new Set(sessions.map((session) => session.id)).size, 4);

    const cookie = await workbenchCookie(started);
    const contexts = [];
    for (let index = 0; index < sessions.length; index += 1) {
      const prefix = 'agent-' + index;
      const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: prefix + '-project', body: { name: '项目 ' + index, sessionId: sessions[index].id } });
      const projectId = project.body.data.value.id;
      const task = await requestJson(started, '/api/tasks', { method: 'POST', idempotencyKey: prefix + '-task', body: { projectId, name: '任务 ' + index, sessionId: sessions[index].id } });
      const taskId = task.body.data.value.id;
      const round = await requestJson(started, '/api/rounds', { method: 'POST', idempotencyKey: prefix + '-round', body: { taskId, purpose: 'exploration', sessionId: sessions[index].id } });
      const roundId = round.body.data.value.id;
      const context = await requestJson(started, '/api/sessions/' + sessions[index].id + '/context', { method: 'POST', idempotencyKey: prefix + '-context', body: { projectId, taskId, roundId } });
      assert.equal(context.status, 200);
      const prepared = await requestJson(started, '/api/rounds/' + roundId + '/prepare', { method: 'POST', idempotencyKey: prefix + '-prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'isolated prompt ' + index } } });
      assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
      const challenge = await requestJsonAsWorkbench(started, '/api/rounds/' + roundId + '/confirmation-challenge', { cookie, idempotencyKey: prefix + '-challenge', body: { sessionId: sessions[index].id } });
      assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
      await requestJsonAsWorkbench(started, '/api/rounds/' + roundId + '/confirm', { cookie, idempotencyKey: prefix + '-confirm', body: { expectedVersion: prepared.body.data.value.version, sessionId: sessions[index].id, challenge: challenge.body.data.challenge } });
      const preview = await requestJson(started, '/api/rounds/' + roundId + '/preflight', { method: 'POST', idempotencyKey: prefix + '-preflight', body: { executionConcurrency: 1, sessionId: sessions[index].id } });
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      const queued = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: prefix + '-run', body: { roundId, preflightId: preview.body.data.value.preview.id, confirmToken: preview.body.data.value.confirmToken } });
      contexts.push({ sessionId: sessions[index].id, projectId, taskId, roundId, runId: queued.body.data.value.id });
    }

    for (const expected of contexts) {
      const restored = await requestJson(started, '/api/sessions/' + expected.sessionId);
      assert.deepEqual({
        projectId: restored.body.data.session.activeProjectId,
        taskId: restored.body.data.session.activeTaskId,
        roundId: restored.body.data.session.activeRoundId
      }, { projectId: expected.projectId, taskId: expected.taskId, roundId: expected.roundId });
      const runs = await requestJson(started, '/api/rounds/' + expected.roundId + '/runs');
      assert.deepEqual(runs.body.data.runs.map((run) => run.id), [expected.runId]);
      const items = await requestJson(started, '/api/runs/' + expected.runId + '/items');
      assert.equal(items.body.data.items.length, 1);
    }

    const claims = claimRunItems(started.service.db, { workerId: 'shared-daemon-worker', limit: 4, leaseMs: 30_000, now: new Date('2026-09-02T00:00:00.000Z') });
    assert.equal(claims.length, 4);
    assert.deepEqual(new Set(claims.map((claim) => claim.runId)), new Set(contexts.map((context) => context.runId)));
    assert.equal(new Set(claims.map((claim) => claim.studioId)).size, 1);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
