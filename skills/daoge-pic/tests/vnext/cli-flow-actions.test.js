const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { createProject } = require('../../dist/vnext/domain/studio-commands');
const { resolvePlanTarget, composePreflightAndRun } = require('../../dist/vnext/cli/flow-actions');
const { parseCommand } = require('../../dist/vnext/cli/daoge');
const { configureProvider } = require('./provider-test-helper');
const { requestJson, requestJsonAsWorkbench } = require('./local-studio-test-helper');

/**
 * `plan --project` 与 `run --auto-preflight`：把「本来要 2–3 条命令」的前后两步各收成一条。
 *
 * 这里全部对着**真实 daemon** 跑，因为要证明的不是"函数能返回字符串"，而是：自动补齐的
 * 任务/批次真的落了库、会话上下文真的绑上了、人工确认这条闸门真的没被绕过去。
 */

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-flow-actions-'));
}

function caller(value) {
  let counter = 0;
  return async (method, pathname, body = {}, idempotencyKey, operationName) => {
    counter += 1;
    // 复刻生产 api()：写入必须自带 idempotency key **或** operation name。
    // 之前这里默认补了一个 key，把「flow-actions 内部 POST 不带凭据」这个生产 bug 遮住了 ——
    // 严格模式下，任何忘记带凭据的合成流程都会在这里当场失败。
    if (method !== 'GET' && !idempotencyKey && !operationName) throw new Error('写入操作需要 idempotency key 或 operation name。');
    const response = await requestJson(value.started, pathname, {
      method,
      ...(method === 'GET' ? {} : { body }),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      ...(operationName === undefined ? {} : { headers: { 'x-daoge-operation-name': operationName } })
    });
    if (response.status >= 400 || response.body.ok !== true) throw new Error(response.body.error?.message || 'api failed: ' + pathname);
    return response.body.data;
  };
}

async function fixture() {
  const workspaceRoot = temporaryWorkspace();
  const initialized = initializeStudio({ workspaceRoot });
  configureProvider(initialized, { name: 'Flow Provider', apiKey: 'flow-secret-never-returned', model: 'gpt-image-2' });
  const started = await startLocalStudioService({ hardenAccess: false, workspaceRoot, ssePollMs: 20 });
  const studioId = initialized.manifest.studioId;
  const db = started.service.db;
  const project = createProject(db, { studioId, name: '花园小径', idempotencyKey: 'flow-project' }).value;
  return { workspaceRoot, initialized, started, studioId, db, project };
}

async function dispose(value) {
  await value.started.service.close();
  fs.rmSync(value.workspaceRoot, { recursive: true, force: true });
}

async function openSession(value, conversationId) {
  const opened = await requestJson(value.started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'flow-session-' + conversationId, body: { conversationId } });
  assert.equal(opened.status, 200, JSON.stringify(opened.body));
  return opened.body.data.id;
}

test('plan --project finds or creates the task and the draft round, and binds the session', async () => {
  const value = await fixture();
  try {
    const sessionId = await openSession(value, 'conv-flow-1');
    const call = caller(value);
    const first = await resolvePlanTarget(call, { project: '花园小径', session: sessionId });
    assert.equal(typeof first.roundId, 'string');
    assert.equal(first.expectedVersion, 1);
    assert.equal(typeof first.created.task, 'string');
    assert.equal(first.created.round, first.roundId);

    // 会话上下文必须一起绑上：否则随后的 round-status 只会回一堆 null。
    const status = await requestJson(value.started, '/api/sessions/' + encodeURIComponent(sessionId) + '/plan-status');
    assert.equal(status.body.data.context.round.id, first.roundId);

    // 再来一次：同一个项目、同一个任务，复用草稿批次而不是越建越多。
    const second = await resolvePlanTarget(call, { project: '花园小径', session: sessionId });
    assert.equal(second.roundId, first.roundId);
    assert.deepEqual(second.created, {});
    const tasks = await requestJson(value.started, '/api/projects/' + encodeURIComponent(value.project.id) + '/tasks');
    assert.equal(tasks.body.data.tasks.length, 1);
    const rounds = await requestJson(value.started, '/api/tasks/' + encodeURIComponent(first.created.task) + '/rounds');
    assert.equal(rounds.body.data.rounds.length, 1);
  } finally {
    await dispose(value);
  }
});

test('an explicit round is honoured, and its current version is read back for the caller', async () => {
  const value = await fixture();
  try {
    const call = caller(value);
    const created = await resolvePlanTarget(call, { project: value.project.id, session: await openSession(value, 'conv-flow-2') });
    const explicit = await resolvePlanTarget(call, { roundId: created.roundId });
    assert.equal(explicit.roundId, created.roundId);
    assert.equal(explicit.expectedVersion, created.expectedVersion);
    const pinned = await resolvePlanTarget(call, { roundId: created.roundId, expectedVersion: 7 });
    assert.equal(pinned.expectedVersion, 7, '显式版本号优先，用于乐观并发');
  } finally {
    await dispose(value);
  }
});

test('plan target resolution refuses to guess between same-named projects and lists candidates', async () => {
  const value = await fixture();
  try {
    createProject(value.db, { studioId: value.studioId, name: '花园小径', idempotencyKey: 'flow-project-dup' });
    const call = caller(value);
    await assert.rejects(() => resolvePlanTarget(call, { project: '花园小径' }), /歧义/);
    await assert.rejects(() => resolvePlanTarget(call, { project: '不存在的项目' }), /没有找到项目/);
    await assert.rejects(() => resolvePlanTarget(call, {}), /需要 --round/);
  } finally {
    await dispose(value);
  }
});

async function confirmRound(value, sessionId, plan) {
  const call = caller(value);
  const created = await resolvePlanTarget(call, { project: value.project.id, session: sessionId });
  const prepared = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(created.roundId) + '/plan', {
    method: 'POST',
    idempotencyKey: 'flow-prepare',
    body: { expectedVersion: created.expectedVersion, plan }
  });
  assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
  const challenge = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(created.roundId) + '/confirmation-challenge', {
    method: 'POST',
    idempotencyKey: 'flow-challenge',
    body: { sessionId }
  });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  const confirmed = await requestJsonAsWorkbench(value.started, '/api/rounds/' + encodeURIComponent(created.roundId) + '/confirm', {
    method: 'POST',
    idempotencyKey: 'flow-confirm',
    body: { sessionId, expectedVersion: challenge.body.data.expectedVersion, challenge: challenge.body.data.challenge }
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  return created.roundId;
}

const PLAN = { operation: 'generate', itemCount: 2, prompt: '花园小径上的橘猫与木漏日光', itemPrompts: ['第一张：远景', '第二张：近景'], output: { aspectRatio: '1:1' } };

test('run --auto-preflight queues the single run after the human gate, without retyping ids', async () => {
  const value = await fixture();
  try {
    const sessionId = await openSession(value, 'conv-flow-3');
    const roundId = await confirmRound(value, sessionId, PLAN);
    const composed = await composePreflightAndRun(caller(value), { roundId, sessionId });
    assert.equal(typeof composed.preflight.preflightId, 'string');
    assert.equal(composed.run.id.length > 0, true);
    assert.equal(composed.run.status, 'queued');
    const runs = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(roundId) + '/runs');
    assert.equal(runs.body.data.runs.length, 1, '一条命令只允许产生一个运行');
    assert.equal(JSON.stringify(composed).includes('flow-secret-never-returned'), false);
  } finally {
    await dispose(value);
  }
});

test('run --auto-preflight stops before queueing when the human gate has not been passed', async () => {
  const value = await fixture();
  try {
    const sessionId = await openSession(value, 'conv-flow-4');
    const call = caller(value);
    const created = await resolvePlanTarget(call, { project: value.project.id, session: sessionId });
    await requestJson(value.started, '/api/rounds/' + encodeURIComponent(created.roundId) + '/plan', { method: 'POST', idempotencyKey: 'flow-prepare-unconfirmed', body: { expectedVersion: created.expectedVersion, plan: PLAN } });
    await assert.rejects(() => composePreflightAndRun(call, { roundId: created.roundId, sessionId }), /人工确认|预检/);
    const runs = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(created.roundId) + '/runs');
    assert.equal(runs.body.data.runs.length, 0, '没过闸门就不得产生运行');
  } finally {
    await dispose(value);
  }
});

test('a fresh session reusing an existing draft round still gets a confirmation challenge', async () => {
  const value = await fixture();
  try {
    const first = await resolvePlanTarget(caller(value), { project: '花园小径', session: await openSession(value, 'conv-bind-1') });
    const sessionB = await openSession(value, 'conv-bind-2');
    const second = await resolvePlanTarget(caller(value), { project: '花园小径', session: sessionB });
    assert.equal(second.roundId, first.roundId);
    assert.deepEqual(second.created, {}, '已有 draft 批次应被复用而不是新建');

    // 会话 B 必须被绑到这个批次：服务端建挑战时强校验 session.agentRoundId === roundId。
    const status = await requestJson(value.started, '/api/sessions/' + encodeURIComponent(sessionB) + '/plan-status');
    assert.equal(status.body.data.context.round.id, first.roundId);

    const prepared = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(second.roundId) + '/plan', { method: 'POST', idempotencyKey: 'bind-plan', body: { expectedVersion: second.expectedVersion, plan: PLAN } });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
    const challenge = await requestJson(value.started, '/api/rounds/' + encodeURIComponent(second.roundId) + '/confirmation-challenge', { method: 'POST', idempotencyKey: 'bind-challenge', body: { sessionId: sessionB } });
    assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
  } finally {
    await dispose(value);
  }
});

test('the two composed commands parse with their documented flags and keep their guards', () => {
  const root = path.join(os.tmpdir(), 'daoge-pic-flow');
  const plan = parseCommand(['plan', '--workspace', root, '--project', '花园小径', '--plan', '{}', '--challenge', 'true', '--session', 'session_1']);
  assert.deepEqual(plan.planTarget, { project: '花园小径', session: 'session_1' });
  assert.equal(plan.planChallenge.sessionId, 'session_1');
  const auto = parseCommand(['run', '--workspace', root, '--round', 'round_1', '--auto-preflight', 'true', '--session', 'session_1', '--wait', 'true']);
  assert.equal(auto.runCompose.roundId, 'round_1');
  assert.equal(auto.runCompose.wait, true);
  assert.equal(auto.runCompose.timeoutMs, 300000);
  assert.equal(Object.hasOwn(auto.runCompose, 'concurrency'), false, '并发是预检的输入，run 不接受它');
  assert.throws(() => parseCommand(['run', '--workspace', root, '--round', 'round_1', '--auto-preflight', 'true']), /需要 --session/);
  assert.throws(() => parseCommand(['run', '--workspace', root, '--round', 'round_1']), /需要 --preflight/);
  assert.throws(() => parseCommand(['run', '--workspace', root, '--round', 'round_1', '--preflight', 'dry_1']), /需要 --confirm-token/);
  assert.throws(() => parseCommand(['run', '--workspace', root, '--round', 'round_1', '--preflight', 'dry_1', '--confirm-token', 'tok', '--concurrency', '4']), /未知或不适用于/);
  assert.throws(() => parseCommand(['run', '--workspace', root, '--round', 'round_1', '--preflight', 'dry_1', '--confirm-token', 'tok', '--wait', 'true']), /--wait 只能与 --auto-preflight/);
  assert.throws(() => parseCommand(['plan', '--workspace', root, '--plan', '{}']), /需要 --round，或用 --project/);
});