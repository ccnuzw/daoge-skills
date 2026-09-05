const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService, streamVerifiedFileResponse } = require('../../dist/vnext/api/server');
const { fetchStudio, requestJson, requestJsonAsWorkbench, workbenchCookie } = require('./local-studio-test-helper');
const { configureProvider } = require('./provider-test-helper');
const { resolveActiveProviderConfig } = require('../../dist/vnext/studio/provider-store');
const { createImageProvider } = require('../../dist/vnext/providers/http-adapters');
const { GenerationWorker } = require('../../dist/vnext/runner/worker');
const { StudioGeneratedAssetPersister } = require('../../dist/vnext/media/generated-assets');




function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-api-'));
}

function recursiveKeys(value, keys = []) {
  if (Array.isArray(value)) for (const item of value) recursiveKeys(item, keys);
  else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { keys.push(key); recursiveKeys(item, keys); }
  return keys;
}

function studioDatabaseText(db) {
  const values = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const table of tables) {
    const quoted = '"' + table.name.replace(/"/g, '""') + '"';
    for (const row of db.prepare('SELECT * FROM ' + quoted).all()) {
      for (const value of Object.values(row)) if (typeof value === 'string') values.push(value);
    }
  }
  return values.join('\n');
}


async function nextSseMessage(reader) {
  const decoder = new TextDecoder();
  let text = '';
  while (!text.includes('\n\n')) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error('SSE stream closed before an event arrived.');
    text += decoder.decode(chunk.value, { stream: true });
  }
  const eventLine = text.split('\n').find((line) => line.startsWith('event: '));
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '));
  return { event: eventLine ? eventLine.slice(7) : 'message', data: JSON.parse(dataLine.slice(6)) };
}

test('local Studio API keeps Provider keys private and requires confirmed rounds before queueing', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { name: 'API Provider', model: 'gpt-image-2', apiKey: 'api-secret-never-in-http-response' });
    started = await startLocalStudioService({ workspaceRoot, ssePollMs: 20 });

    const health = await requestJson(started, '/api/health');
    assert.equal(health.status, 200);
    const profiles = await requestJson(started, '/api/providers');
    assert.equal(profiles.body.data.status.configured, true);
    assert.equal(JSON.stringify(profiles.body).includes('api-secret-never-in-http-response'), false);
    assert.equal(JSON.stringify(profiles.body).includes('https://images.example.test/v1'), false);
    const studio = await requestJson(started, '/api/studio');
    assert.equal(JSON.stringify(studio.body).includes(workspaceRoot), false);
    assert.equal(profiles.body.data.profiles[0].apiKeyConfigured, true);
    const profile = profiles.body.data.profiles[0];
    const updatedProfile = await requestJson(started, '/api/providers/' + profile.id, { method: 'PUT', idempotencyKey: 'provider-secret-update', body: { expectedConfigVersion: profile.configVersion, name: profile.name, providerId: profile.providerId, model: profile.model, baseUrl: { action: 'keep' }, apiKey: { action: 'replace', value: 'replacement-secret-never-returned' }, options: {} } });
    assert.equal(updatedProfile.body.data.apiKeyConfigured, true);
    const profilesAfterUpdate = await requestJson(started, '/api/providers');
    assert.equal(JSON.stringify(profilesAfterUpdate.body).includes('replacement-secret-never-returned'), false);

    const session = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'session', body: { conversationId: 'api-confirmation-conversation' } });
    const sessionId = session.body.data.id;
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'project', body: { name: 'API 项目', sessionId } });
    const task = await requestJson(started, '/api/tasks', { method: 'POST', idempotencyKey: 'task', body: { projectId: project.body.data.value.id, name: 'API 任务', sessionId } });
    const round = await requestJson(started, '/api/rounds', { method: 'POST', idempotencyKey: 'round', body: { taskId: task.body.data.value.id, purpose: 'exploration', sessionId } });
    const queuedBeforeConfirm = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: 'queue-before-confirm', body: { roundId: round.body.data.value.id } });
    assert.equal(queuedBeforeConfirm.status, 400);
    assert.equal(queuedBeforeConfirm.body.error.code, 'invalid_command');
    const prepared = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/prepare', { method: 'POST', idempotencyKey: 'prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'API fixture image' } } });
    assert.equal(prepared.status, 200, JSON.stringify(prepared.body));

    const challenge = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/confirmation-challenge', { method: 'POST', idempotencyKey: 'challenge', body: { sessionId } });
    assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
    const rejectedSkillConfirm = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/confirm', { method: 'POST', idempotencyKey: 'skill-confirm', body: { expectedVersion: prepared.body.data.value.version, sessionId, challenge: challenge.body.data.challenge } });
    assert.equal(rejectedSkillConfirm.status, 403);
    const cookie = await workbenchCookie(started);
    const rejectedInvalidChallenge = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/confirm', { cookie, idempotencyKey: 'invalid-confirm', body: { expectedVersion: prepared.body.data.value.version, sessionId, challenge: challenge.body.data.challenge + '-tampered' } });
    assert.equal(rejectedInvalidChallenge.status, 400);
    assert.equal(started.service.db.prepare("SELECT COUNT(*) AS total FROM command_receipts WHERE idempotency_key = 'invalid-confirm'").get().total, 0);
    assert.equal(started.service.db.prepare('SELECT status FROM creative_rounds WHERE id = ?').get(round.body.data.value.id).status, 'awaiting_confirmation');
    const confirmed = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/confirm', { cookie, idempotencyKey: 'confirm', body: { expectedVersion: prepared.body.data.value.version, sessionId, challenge: challenge.body.data.challenge } });
    const replayedConfirmation = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/confirm', { cookie, idempotencyKey: 'confirm', body: { expectedVersion: prepared.body.data.value.version, sessionId, challenge: challenge.body.data.challenge } });
    assert.equal(replayedConfirmation.status, 200, JSON.stringify(replayedConfirmation.body));
    assert.deepEqual(replayedConfirmation.body.data.value, confirmed.body.data.value);
    assert.deepEqual(replayedConfirmation.body.data.confirmation, confirmed.body.data.confirmation);
    assert.equal(replayedConfirmation.body.data.replayed, true);
    const rejectedWorkbenchPreflight = await requestJsonAsWorkbench(started, '/api/rounds/' + round.body.data.value.id + '/preflight', { cookie, idempotencyKey: 'workbench-preflight', body: { sessionId } });
    assert.equal(rejectedWorkbenchPreflight.status, 403);
    const rejectedPreflight = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/preflight', { method: 'POST', idempotencyKey: 'preflight-over-limit', body: { executionConcurrency: 1001, sessionId } });
    assert.equal(rejectedPreflight.status, 400);
    const preflight = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/preflight', { method: 'POST', idempotencyKey: 'preflight', body: { executionConcurrency: 1000, sessionId } });
    const parallelPreflight = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/preflight', { method: 'POST', idempotencyKey: 'parallel-preflight', body: { executionConcurrency: 1000, sessionId } });
    assert.equal(preflight.status, 200, JSON.stringify(preflight.body));
    assert.equal(confirmed.status, 200);
    assert.equal(preflight.body.data.value.preflight.valid, true);
    assert.equal(preflight.body.data.value.preview.executionConcurrency, 1000);
    assert.match(preflight.body.data.value.confirmToken, /^dgpct1\./);
    const history = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/plan-versions');
    assert.equal(history.body.data.planVersions[0].state, 'confirmed');
    const dryRuns = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/dry-runs');
    const missingToken = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: 'queue-without-token', body: { roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id } });
    assert.equal(missingToken.status, 400);
    assert.match(missingToken.body.error.message, /confirm_token/);
    const wrongPreflightToken = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: 'queue-wrong-token-binding', body: { roundId: round.body.data.value.id, preflightId: 'dryrun-wrong-binding', confirmToken: preflight.body.data.value.confirmToken } });
    assert.equal(wrongPreflightToken.status, 404);
    assert.deepEqual(new Set(dryRuns.body.data.dryRuns.map((preview) => preview.id)), new Set([preflight.body.data.value.preview.id, parallelPreflight.body.data.value.preview.id]));
    const rejectedConcurrency = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: 'queue-over-limit', body: { roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id, executionConcurrency: 1, confirmToken: preflight.body.data.value.confirmToken } });
    assert.equal(rejectedConcurrency.status, 400);
    const rejectedWorkbenchRun = await requestJsonAsWorkbench(started, '/api/runs', { cookie, idempotencyKey: 'workbench-run', body: { roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id, confirmToken: preflight.body.data.value.confirmToken } });
    assert.equal(rejectedWorkbenchRun.status, 403);
    const runRequest = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'queue' }, body: JSON.stringify({ roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id, confirmToken: preflight.body.data.value.confirmToken }) };
    const lostResponse = await fetchStudio(started, '/api/runs', runRequest);
    assert.equal(lostResponse.status, 200);
    await lostResponse.body.cancel();
    const queued = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: 'queue', body: { roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id, confirmToken: preflight.body.data.value.confirmToken } });
    assert.equal(queued.status, 200);
    assert.equal(queued.body.data.value.status, 'queued');
    assert.equal(queued.body.data.value.executionConcurrency, 1000);
    assert.equal(started.service.db.prepare('SELECT COUNT(*) AS total FROM generation_runs').get().total, 1);
    assert.equal(started.service.db.prepare("SELECT COUNT(*) AS total FROM command_receipts WHERE idempotency_key = 'queue'").get().total, 1);
    const duplicateRun = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: 'duplicate-queue', body: { roundId: round.body.data.value.id, preflightId: parallelPreflight.body.data.value.preview.id, confirmToken: parallelPreflight.body.data.value.confirmToken } });
    assert.equal(duplicateRun.status, 409);
    assert.match(duplicateRun.body.error.message, /已创建生成运行/);
    const duplicatePreflight = await requestJson(started, '/api/rounds/' + round.body.data.value.id + '/preflight', { method: 'POST', idempotencyKey: 'duplicate-preflight', body: { sessionId } });
    assert.equal(duplicatePreflight.status, 409);
    assert.equal(started.service.db.prepare('SELECT COUNT(*) AS total FROM generation_runs').get().total, 1);
    assert.equal(started.service.db.prepare("SELECT COUNT(*) AS total FROM command_receipts WHERE idempotency_key IN ('duplicate-queue', 'duplicate-preflight')").get().total, 0);
    const replayedWithDifferentKey = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: 'queue-replay-with-different-key', body: { roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id, confirmToken: preflight.body.data.value.confirmToken } });
    assert.equal(replayedWithDifferentKey.status, 400);
    assert.match(replayedWithDifferentKey.body.error.message, /不同的幂等键/);
    assert.equal(started.service.db.prepare('SELECT COUNT(*) AS total FROM generation_runs').get().total, 1);
    assert.equal(JSON.stringify(queued.body).includes('api-secret-never-in-http-response'), false);
    const runId = queued.body.data.value.id;
    const publicItems = await requestJson(started, '/api/runs/' + runId + '/items');
    assert.deepEqual(Object.keys(publicItems.body.data.items[0]).sort(), ['attempts', 'error', 'id', 'result', 'retryAt', 'runId', 'sequence', 'status']);
    const forbiddenItemKeys = new Set(['leaseToken', 'leaseExpiresAt', 'requestId', 'promptPayload', 'prompt_payload_json']);
    assert.equal(recursiveKeys(publicItems.body.data).some((key) => forbiddenItemKeys.has(key)), false);
    const paused = await requestJson(started, '/api/runs/' + runId + '/pause', { method: 'POST', idempotencyKey: 'pause-once', body: {} });
    assert.equal(paused.status, 200);
    const invalidTransition = await requestJson(started, '/api/runs/' + runId + '/pause', { method: 'POST', idempotencyKey: 'pause-twice', body: {} });
    assert.equal(invalidTransition.status, 409);
    assert.deepEqual(invalidTransition.body.error, { code: 'invalid_state_transition', message: 'Invalid run transition: paused -> pausing', details: { entity: 'run', from: 'paused', to: 'pausing' } });
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('active rounds can be reconfirmed after daemon restart', async () => {
  const workspaceRoot = temporaryWorkspace();
  let first;
  let second;
  try {
    initializeStudio({ workspaceRoot });
    first = await startLocalStudioService({ workspaceRoot });
    const session = await requestJson(first, '/api/sessions/open', { method: 'POST', idempotencyKey: 'restart-session', body: { conversationId: 'restart-reconfirm-conversation' } });
    const sessionId = session.body.data.id;
    const project = await requestJson(first, '/api/projects', { method: 'POST', idempotencyKey: 'restart-project', body: { name: '重启确认项目', sessionId } });
    const task = await requestJson(first, '/api/tasks', { method: 'POST', idempotencyKey: 'restart-task', body: { projectId: project.body.data.value.id, name: '重启确认任务', sessionId } });
    const round = await requestJson(first, '/api/rounds', { method: 'POST', idempotencyKey: 'restart-round', body: { taskId: task.body.data.value.id, purpose: 'exploration', sessionId } });
    const roundId = round.body.data.value.id;
    const prepared = await requestJson(first, '/api/rounds/' + roundId + '/prepare', { method: 'POST', idempotencyKey: 'restart-prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'restart reconfirm fixture' } } });
    const challenge = await requestJson(first, '/api/rounds/' + roundId + '/confirmation-challenge', { method: 'POST', idempotencyKey: 'restart-challenge-one', body: { sessionId } });
    const cookie = await workbenchCookie(first);
    const confirmed = await requestJsonAsWorkbench(first, '/api/rounds/' + roundId + '/confirm', { cookie, idempotencyKey: 'restart-confirm-one', body: { expectedVersion: prepared.body.data.value.version, sessionId, challenge: challenge.body.data.challenge } });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    await first.service.close();
    first = null;
    second = await startLocalStudioService({ workspaceRoot });
    const rechallenge = await requestJson(second, '/api/rounds/' + roundId + '/confirmation-challenge', { method: 'POST', idempotencyKey: 'restart-challenge-two', body: { sessionId } });
    assert.equal(rechallenge.status, 200, JSON.stringify(rechallenge.body));
    const newCookie = await workbenchCookie(second);
    const reconfirmed = await requestJsonAsWorkbench(second, '/api/rounds/' + roundId + '/confirm', { cookie: newCookie, idempotencyKey: 'restart-confirm-two', body: { expectedVersion: confirmed.body.data.value.version, sessionId, challenge: rechallenge.body.data.challenge } });
    assert.equal(reconfirmed.status, 200, JSON.stringify(reconfirmed.body));
    assert.equal(reconfirmed.body.data.value.status, 'active');
  } finally {
    if (first) await first.service.close();
    if (second) await second.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('preflight rejection before confirmation leaves no dry-run or receipt side effects', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { name: 'Preflight Gate Provider' });
    started = await startLocalStudioService({ workspaceRoot });
    const session = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'preflight-gate-session', body: { conversationId: 'preflight-gate-conversation' } });
    const sessionId = session.body.data.id;
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'preflight-gate-project', body: { name: '预检门禁项目', sessionId } });
    const task = await requestJson(started, '/api/tasks', { method: 'POST', idempotencyKey: 'preflight-gate-task', body: { projectId: project.body.data.value.id, name: '预检门禁任务', sessionId } });
    const round = await requestJson(started, '/api/rounds', { method: 'POST', idempotencyKey: 'preflight-gate-round', body: { taskId: task.body.data.value.id, purpose: 'exploration', sessionId } });
    const roundId = round.body.data.value.id;
    const prepared = await requestJson(started, '/api/rounds/' + roundId + '/prepare', { method: 'POST', idempotencyKey: 'preflight-gate-prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'preflight gate fixture' } } });
    const before = {
      previews: started.service.db.prepare('SELECT COUNT(*) AS total FROM dry_run_previews').get().total,
      items: started.service.db.prepare('SELECT COUNT(*) AS total FROM dry_run_items').get().total,
      receipts: started.service.db.prepare("SELECT COUNT(*) AS total FROM command_receipts WHERE idempotency_key = 'preflight-gate-rejected'").get().total
    };
    const rejected = await requestJson(started, '/api/rounds/' + roundId + '/preflight', { method: 'POST', idempotencyKey: 'preflight-gate-rejected', body: { sessionId, executionConcurrency: 1 } });
    assert.equal(rejected.status, 400);
    const after = {
      previews: started.service.db.prepare('SELECT COUNT(*) AS total FROM dry_run_previews').get().total,
      items: started.service.db.prepare('SELECT COUNT(*) AS total FROM dry_run_items').get().total,
      receipts: started.service.db.prepare("SELECT COUNT(*) AS total FROM command_receipts WHERE idempotency_key = 'preflight-gate-rejected'").get().total
    };
    assert.deepEqual(after, before);
    assert.equal(prepared.body.data.value.status, 'awaiting_confirmation');
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('run resume requires a Workbench re-confirmation bound to the run round after restart', async () => {
  const workspaceRoot = temporaryWorkspace();
  let first;
  let second;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { name: 'Resume Gate Provider' });
    first = await startLocalStudioService({ workspaceRoot });
    const session = await requestJson(first, '/api/sessions/open', { method: 'POST', idempotencyKey: 'resume-gate-session', body: { conversationId: 'resume-gate-conversation' } });
    const sessionId = session.body.data.id;
    const project = await requestJson(first, '/api/projects', { method: 'POST', idempotencyKey: 'resume-gate-project', body: { name: '恢复门禁项目', sessionId } });
    const task = await requestJson(first, '/api/tasks', { method: 'POST', idempotencyKey: 'resume-gate-task', body: { projectId: project.body.data.value.id, name: '恢复门禁任务', sessionId } });
    const round = await requestJson(first, '/api/rounds', { method: 'POST', idempotencyKey: 'resume-gate-round', body: { taskId: task.body.data.value.id, purpose: 'exploration', sessionId } });
    const roundId = round.body.data.value.id;
    const prepared = await requestJson(first, '/api/rounds/' + roundId + '/prepare', { method: 'POST', idempotencyKey: 'resume-gate-prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'resume gate fixture' } } });
    const challenge = await requestJson(first, '/api/rounds/' + roundId + '/confirmation-challenge', { method: 'POST', idempotencyKey: 'resume-gate-challenge', body: { sessionId } });
    const cookie = await workbenchCookie(first);
    const confirmed = await requestJsonAsWorkbench(first, '/api/rounds/' + roundId + '/confirm', { cookie, idempotencyKey: 'resume-gate-confirm', body: { expectedVersion: prepared.body.data.value.version, sessionId, challenge: challenge.body.data.challenge } });
    const preflight = await requestJson(first, '/api/rounds/' + roundId + '/preflight', { method: 'POST', idempotencyKey: 'resume-gate-preflight', body: { sessionId } });
    const queued = await requestJson(first, '/api/runs', { method: 'POST', idempotencyKey: 'resume-gate-run', body: { roundId, preflightId: preflight.body.data.value.preview.id, confirmToken: preflight.body.data.value.confirmToken } });
    assert.equal(queued.status, 200, JSON.stringify(queued.body));
    await first.service.close();
    first = null;

    second = await startLocalStudioService({ workspaceRoot });
    const newCookie = await workbenchCookie(second);
    const runId = queued.body.data.value.id;
    const rejectedBearer = await requestJson(second, '/api/runs/' + runId + '/resume', { method: 'POST', idempotencyKey: 'resume-gate-bearer', body: { sessionId } });
    assert.equal(rejectedBearer.status, 403);
    const rejectedWithoutReconfirmation = await requestJsonAsWorkbench(second, '/api/runs/' + runId + '/resume', { cookie: newCookie, method: 'POST', idempotencyKey: 'resume-gate-no-reconfirm', body: { sessionId } });
    assert.equal(rejectedWithoutReconfirmation.status, 400);
    assert.equal(second.service.db.prepare("SELECT COUNT(*) AS total FROM command_receipts WHERE idempotency_key = 'resume-gate-no-reconfirm'").get().total, 0);

    const rechallenge = await requestJson(second, '/api/rounds/' + roundId + '/confirmation-challenge', { method: 'POST', idempotencyKey: 'resume-gate-rechallenge', body: { sessionId } });
    const reconfirmed = await requestJsonAsWorkbench(second, '/api/rounds/' + roundId + '/confirm', { cookie: newCookie, idempotencyKey: 'resume-gate-reconfirm', body: { expectedVersion: confirmed.body.data.value.version, sessionId, challenge: rechallenge.body.data.challenge } });
    assert.equal(reconfirmed.status, 200, JSON.stringify(reconfirmed.body));
    const resumed = await requestJsonAsWorkbench(second, '/api/runs/' + runId + '/resume', { cookie: newCookie, method: 'POST', idempotencyKey: 'resume-gate-approved', body: { sessionId } });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.data.value.status, 'queued');
  } finally {
    if (first) await first.service.close();
    if (second) await second.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('Provider connection test returns an actionable client error when the endpoint probe fails', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { name: 'Probe Failure Provider' });
    started = await startLocalStudioService({
      workspaceRoot,
      providerProbe: async () => { throw new Error('fixture DNS failure'); }
    });
    const profiles = await requestJson(started, '/api/providers');
    const profile = profiles.body.data.profiles[0];
    const tested = await requestJson(started, '/api/providers/' + encodeURIComponent(profile.id) + '/test', { method: 'POST', idempotencyKey: 'provider-test-failure', body: {} });
    assert.equal(tested.status, 400);
    assert.deepEqual(tested.body.error, {
      code: 'invalid_command',
      message: '无法连接 Provider 端点。请检查 Base URL、网络和访问权限后重试。'
    });
    assert.doesNotMatch(JSON.stringify(tested.body), /fixture DNS failure|Studio 本地服务发生未预期错误/);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('local Provider response echoes are sanitized before database, API, and delivery persistence', async () => {
  const workspaceRoot = temporaryWorkspace();
  const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==';
  const apiKey = 'violet-credential-value-7LQ9M2';
  let responseMode = 'success';
  let baseUrl = '';
  let started;
  const providerServer = http.createServer((request, response) => {
    request.resume();
    request.once('end', () => {
      if (responseMode === 'success') {
        response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': apiKey });
        response.end(JSON.stringify({ data: [{ b64_json: pngBase64, revised_prompt: 'echo ' + apiKey + ' from ' + baseUrl }]}));
        return;
      }
      response.writeHead(400, { 'content-type': 'application/json', 'request-id': baseUrl });
      response.end(JSON.stringify({ error: { message: 'Rejected ' + apiKey + ' at ' + baseUrl } }));
    });
  });
  try {
    providerServer.listen(0, '127.0.0.1');
    await once(providerServer, 'listening');
    const address = providerServer.address();
    baseUrl = 'http://127.0.0.1:' + address.port + '/private/provider-base';
    const initialized = initializeStudio({ workspaceRoot });
    configureProvider(initialized, { name: 'Echo Provider', baseUrl, apiKey, model: 'echo-model' });
    started = await startLocalStudioService({ workspaceRoot });

    const session = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'echo-session', body: { conversationId: 'echo-confirmation-conversation' } });
    const sessionId = session.body.data.id;
    const cookie = await workbenchCookie(started);
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'echo-project', body: { name: '回显净化项目', sessionId } });
    const projectId = project.body.data.value.id;
    const task = await requestJson(started, '/api/tasks', { method: 'POST', idempotencyKey: 'echo-task', body: { projectId, name: '回显净化任务', sessionId } });
    const taskId = task.body.data.value.id;
    const queueRun = async (prefix) => {
      const round = await requestJson(started, '/api/rounds', { method: 'POST', idempotencyKey: prefix + '-round', body: { taskId, purpose: 'exploration', sessionId } });
      const roundId = round.body.data.value.id;
      const prepared = await requestJson(started, '/api/rounds/' + roundId + '/prepare', { method: 'POST', idempotencyKey: prefix + '-prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'provider echo fixture' } } });
      assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
      const challenge = await requestJsonAsWorkbench(started, '/api/rounds/' + roundId + '/confirmation-challenge', { cookie, idempotencyKey: prefix + '-challenge', body: { sessionId } });
      assert.equal(challenge.status, 200, JSON.stringify(challenge.body));
      await requestJsonAsWorkbench(started, '/api/rounds/' + roundId + '/confirm', { cookie, idempotencyKey: prefix + '-confirm', body: { expectedVersion: prepared.body.data.value.version, sessionId, challenge: challenge.body.data.challenge } });
      const preview = await requestJson(started, '/api/rounds/' + roundId + '/preflight', { method: 'POST', idempotencyKey: prefix + '-preflight', body: { executionConcurrency: 1, sessionId } });
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      const queued = await requestJson(started, '/api/runs', { method: 'POST', idempotencyKey: prefix + '-run', body: { roundId, preflightId: preview.body.data.value.preview.id, confirmToken: preview.body.data.value.confirmToken } });
      return { roundId, runId: queued.body.data.value.id };
    };

    const config = resolveActiveProviderConfig(started.service.providerDb);
    const worker = new GenerationWorker({
      db: started.service.db,
      workerId: 'provider-echo-worker',
      providerConfig: config,
      provider: createImageProvider(config),
      assetPersister: new StudioGeneratedAssetPersister({ db: started.service.db, paths: started.service.initialized.paths, studioId: started.service.initialized.manifest.studioId })
    });
    const successful = await queueRun('echo-success');
    assert.equal((await worker.processOnce(1)).succeeded, 1);
    responseMode = 'failure';
    const failed = await queueRun('echo-failure');
    assert.equal((await worker.processOnce(1)).blocked, 1);

    const assetRow = started.service.db.prepare("SELECT id, source_json FROM assets WHERE kind = 'generated'").get();
    const resultRow = started.service.db.prepare('SELECT result_json FROM run_items WHERE run_id = ?').get(successful.runId);
    const errorRow = started.service.db.prepare('SELECT error_json FROM run_items WHERE run_id = ?').get(failed.runId);
    assert.match(assetRow.source_json, /\[redacted-provider-secret\]/);
    assert.match(assetRow.source_json, /\[redacted-provider-url\]/);
    assert.equal(JSON.parse(assetRow.source_json).externalRequestId, null);
    assert.equal(Object.hasOwn(JSON.parse(assetRow.source_json).safeMeta, 'providerRequestId'), false);
    assert.match(resultRow.result_json, /\[redacted-provider-secret\]/);
    assert.match(errorRow.error_json, /\[redacted-provider-secret\]/);
    assert.match(errorRow.error_json, /\[redacted-provider-url\]/);

    const kept = await requestJson(started, '/api/assets/' + assetRow.id + '/review', { method: 'POST', idempotencyKey: 'echo-keep', body: { decision: 'keep' } });
    assert.equal(kept.status, 200);
    const delivery = await requestJson(started, '/api/deliveries', { method: 'POST', idempotencyKey: 'echo-delivery', body: { projectId, name: '回显净化交付', assetIds: [assetRow.id], includeCreativeRecord: true } });
    const deliveryId = delivery.body.data.id;
    await requestJson(started, '/api/deliveries/' + deliveryId + '/ready', { method: 'POST', idempotencyKey: 'echo-delivery-ready', body: {} });
    const exported = await requestJson(started, '/api/deliveries/' + deliveryId + '/export', { method: 'POST', idempotencyKey: 'echo-delivery-export', body: {} });
    const deliveryDetail = await requestJson(started, '/api/deliveries/' + deliveryId);
    const assetApi = await requestJson(started, '/api/assets?kind=generated');
    const successItemsApi = await requestJson(started, '/api/runs/' + successful.runId + '/items');
    const failedItemsApi = await requestJson(started, '/api/runs/' + failed.runId + '/items');
    const manifest = JSON.parse(started.service.db.prepare('SELECT manifest_json FROM deliveries WHERE id = ?').get(deliveryId).manifest_json);
    const creativeRecord = fs.readFileSync(path.join(workspaceRoot, manifest.exportDirectory, 'creative-record.json'), 'utf8');
    const apiText = JSON.stringify([assetApi.body, successItemsApi.body, failedItemsApi.body, delivery.body, exported.body, deliveryDetail.body]);
    const databaseText = studioDatabaseText(started.service.db);
    for (const sensitiveValue of [apiKey, baseUrl]) {
      assert.equal(databaseText.includes(sensitiveValue), false, 'studio.db must not persist exact Provider values');
      assert.equal(apiText.includes(sensitiveValue), false, 'Studio APIs must not expose exact Provider values');
      assert.equal(creativeRecord.includes(sensitiveValue), false, 'creative records must not contain exact Provider values');
    }
  } finally {
    if (started) await started.service.close();
    providerServer.closeAllConnections();
    if (providerServer.listening) await new Promise((resolve) => providerServer.close(resolve));
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('asset API returns filtered pages with the full scoped total', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'asset-page-project', body: { name: '分页项目' } });
    const projectId = project.body.data.value.id;
    const studioId = started.service.initialized.manifest.studioId;
    for (let index = 0; index < 35; index += 1) {
      const id = 'asset_api_page_' + String(index).padStart(2, '0');
      const kind = index < 30 ? 'generated' : 'import';
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      started.service.db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, studioId, kind, 'image/png', 'daoge-assets/' + kind + '/' + id + '.png', 'hash-' + id, 1, '{}', createdAt, createdAt);
      started.service.db.prepare('INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('relation-' + id, id, 'attached_to', 'project', projectId, '{}', createdAt);
    }
    const page = await requestJson(started, '/api/assets?scope=project&projectId=' + encodeURIComponent(projectId) + '&kind=generated&limit=16&offset=16');
    assert.equal(page.status, 200);
    assert.equal(page.body.data.total, 30);
    assert.equal(page.body.data.assets.length, 14);
    assert.equal(page.body.data.assets.every((asset) => asset.kind === 'generated'), true);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('local Studio service serves the built Workbench and managed image files', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const page = await fetch(started.url + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id=\"root\"><\/div>/);
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
    const upload = await fetchStudio(started, '/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'idempotency-key': 'binary-upload', 'x-daoge-filename': 'fixture.png' },
      body: image
    });
    const uploadPayload = await upload.json();
    assert.equal(upload.status, 200);
    const media = await fetchStudio(started, '/api/assets/' + uploadPayload.data.id + '/file');
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), image);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const jpegUpload = await fetchStudio(started, '/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'image/jpeg', 'idempotency-key': 'binary-jpeg-upload', 'x-daoge-filename': 'fixture.jpg' },
      body: jpeg
    });
    const jpegPayload = await jpegUpload.json();
    assert.equal(jpegUpload.status, 200);
    const jpegMedia = await fetchStudio(started, '/api/assets/' + jpegPayload.data.id + '/file');
    assert.equal(jpegMedia.status, 200);
    assert.equal(jpegMedia.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await jpegMedia.arrayBuffer()), jpeg);
    const importsDirectory = path.join(workspaceRoot, 'daoge-assets', 'imports');
    const storedImagePath = path.join(importsDirectory, fs.readdirSync(importsDirectory).find((file) => file.endsWith('.png')));
    const mutated = Buffer.alloc(image.length, 0x42);
    fs.writeFileSync(storedImagePath, mutated);
    const rejected = await fetchStudio(started, '/api/assets/' + uploadPayload.data.id + '/file');
    const rejectedBytes = Buffer.from(await rejected.arrayBuffer());
    assert.equal(rejected.status, 500);
    assert.equal(rejectedBytes.includes(mutated), false);
    assert.deepEqual(fs.readdirSync(path.join(workspaceRoot, 'daoge-studio', 'cache', 'staging')), []);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('delivery export API awaits the asynchronous large-file export path', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'async-api-project', body: { name: '异步 API 交付' } });
    const largePng = Buffer.alloc(8 * 1024 * 1024, 0);
    Buffer.from('iVBORw0KGgo=', 'base64').copy(largePng);
    const uploaded = await fetchStudio(started, '/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'idempotency-key': 'async-api-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': project.body.data.value.id },
      body: largePng
    });
    const asset = (await uploaded.json()).data;
    assert.equal(uploaded.status, 200);
    await requestJson(started, '/api/assets/' + asset.id + '/review', { method: 'POST', idempotencyKey: 'async-api-review', body: { decision: 'keep' } });
    const delivery = await requestJson(started, '/api/deliveries', { method: 'POST', idempotencyKey: 'async-api-delivery', body: { projectId: project.body.data.value.id, name: '异步导出', assetIds: [asset.id] } });
    await requestJson(started, '/api/deliveries/' + delivery.body.data.id + '/ready', { method: 'POST', idempotencyKey: 'async-api-ready', body: {} });
    let turnsWhilePending = 0;
    let pending = true;
    const timer = setInterval(() => { if (pending) turnsWhilePending += 1; }, 1);
    const exported = await requestJson(started, '/api/deliveries/' + delivery.body.data.id + '/export', { method: 'POST', idempotencyKey: 'async-api-export', body: {} });
    pending = false;
    clearInterval(timer);
    assert.equal(exported.status, 200);
    assert.equal(exported.body.data.delivery.status, 'exported');
    assert.ok(turnsWhilePending > 0);
    let completionTurns = 0;
    pending = true;
    const completionTimer = setInterval(() => { if (pending) completionTurns += 1; }, 1);
    const completed = await requestJson(started, '/api/deliveries/complete', { method: 'POST', idempotencyKey: 'async-api-complete', body: { phase: 'export', projectId: project.body.data.value.id, name: '异步完成', assetIds: [asset.id] } });
    pending = false;
    clearInterval(completionTimer);
    assert.equal(completed.status, 200);
    assert.equal(completed.body.data.stage, 'exported');
    assert.ok(completionTurns > 0);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('local Studio gates APIs with capability, exact origin, content type, Host, and Workbench cookie auth', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  let controller;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot, ssePollMs: 20 });

    assert.equal((await fetch(started.url + '/api/health')).status, 200);
    const missing = await fetch(started.url + '/api/studio');
    assert.equal(missing.status, 401);
    assert.equal((await missing.json()).error.code, 'unauthorized');
    const wrong = await fetch(started.url + '/api/studio', { headers: { authorization: 'Bearer wrong-capability' } });
    assert.equal(wrong.status, 401);
    assert.equal((await wrong.json()).error.code, 'unauthorized');
    assert.equal((await fetchStudio(started, '/api/studio')).status, 200);

    const invalidHostStatus = await new Promise((resolve, reject) => {
      const request = http.get(started.url + '/api/health', { headers: { host: 'attacker.example' } }, (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode));
      });
      request.once('error', reject);
    });
    assert.equal(invalidHostStatus, 403);

    const hostileOrigin = await fetchStudio(started, '/api/projects', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json', 'idempotency-key': 'hostile-origin' },
      body: JSON.stringify({ name: 'blocked' })
    });
    assert.equal(hostileOrigin.status, 403);
    assert.equal((await hostileOrigin.json()).error.code, 'forbidden');
    const plainText = await fetchStudio(started, '/api/projects', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'idempotency-key': 'plain-text' },
      body: JSON.stringify({ name: 'blocked' })
    });
    assert.equal(plainText.status, 415);
    assert.equal((await plainText.json()).error.code, 'unsupported_media_type');
    const unsupportedImage = await fetchStudio(started, '/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', 'idempotency-key': 'unsupported-image' },
      body: 'not an image'
    });
    assert.equal(unsupportedImage.status, 415);
    const invalidImage = await fetchStudio(started, '/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'idempotency-key': 'invalid-image-bytes' },
      body: Buffer.from('not a png')
    });
    assert.equal(invalidImage.status, 422);
    assert.equal((await invalidImage.json()).error.code, 'media_validation_failed');

    const badBootstrap = await fetch(started.url + '/api/auth/bootstrap', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ capability: started.access.bearerToken })
    });
    assert.equal(badBootstrap.status, 403);
    const bootstrap = await fetch(started.url + '/api/auth/bootstrap', {
      method: 'POST',
      headers: { origin: started.url, accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ capability: started.access.bearerToken })
    });
    assert.equal(bootstrap.status, 200);
    const setCookie = bootstrap.headers.get('set-cookie') || '';
    assert.match(setCookie, new RegExp('^' + started.access.cookieName + '='));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';', 1)[0];
    const cookieStudio = await fetch(started.url + '/api/studio', { headers: { cookie } });
    assert.equal(cookieStudio.status, 200);
    const claimWithoutJson = await fetchStudio(started, '/api/workbench/open-claim', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ claimToken: 'c'.repeat(43) }) });
    assert.equal(claimWithoutJson.status, 415);
    const hostileCookieClaim = await fetch(started.url + '/api/workbench/open-claim', { method: 'POST', headers: { cookie, origin: 'https://attacker.example', 'content-type': 'application/json' }, body: JSON.stringify({ claimToken: 'c'.repeat(43) }) });
    assert.equal(hostileCookieClaim.status, 403);
    const cookieWriteWithoutOrigin = await fetch(started.url + '/api/projects', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'idempotency-key': 'cookie-no-origin' },
      body: JSON.stringify({ name: 'blocked' })
    });
    assert.equal(cookieWriteWithoutOrigin.status, 403);
    const cookieProject = await fetch(started.url + '/api/projects', {
      method: 'POST',
      headers: { cookie, origin: started.url, 'content-type': 'application/json', 'idempotency-key': 'cookie-project' },
      body: JSON.stringify({ name: 'cookie project' })
    });
    assert.equal(cookieProject.status, 200);

    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
    const upload = await fetch(started.url + '/api/assets/import', {
      method: 'POST',
      headers: { cookie, origin: started.url, 'content-type': 'image/png', 'idempotency-key': 'cookie-image' },
      body: image
    });
    assert.equal(upload.status, 200);
    const asset = (await upload.json()).data;
    const media = await fetch(started.url + '/api/assets/' + asset.id + '/file', { headers: { cookie } });
    assert.equal(media.status, 200);
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), image);

    controller = new AbortController();
    const sse = await fetch(started.url + '/api/events?after=0', { headers: { cookie, accept: 'text/event-stream' }, signal: controller.signal });
    assert.equal(sse.status, 200);
    await sse.body.cancel();
    controller.abort();
  } finally {
    if (controller) controller.abort();
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('asset write endpoints replay idempotency receipts without duplicate events', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
    const upload = async (body = image) => {
      const response = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'upload-replay' }, body });
      return { status: response.status, body: await response.json() };
    };
    const firstUpload = await upload();
    const replayedUpload = await upload();
    assert.equal(firstUpload.body.data.id, replayedUpload.body.data.id);
    const conflictingUpload = await upload(Buffer.from('different request bytes'));
    assert.equal(conflictingUpload.status, 409);
    assert.equal(conflictingUpload.body.error.code, 'version_conflict');
    const beforeReview = await requestJson(started, '/api/events');
    const reviewOptions = { method: 'POST', idempotencyKey: 'review-replay', body: { decision: 'keep' } };
    const firstReview = await requestJson(started, '/api/assets/' + firstUpload.body.data.id + '/review', reviewOptions);
    const replayedReview = await requestJson(started, '/api/assets/' + firstUpload.body.data.id + '/review', reviewOptions);
    assert.deepEqual(firstReview.body.data, replayedReview.body.data);
    const conflictingReview = await requestJson(started, '/api/assets/' + firstUpload.body.data.id + '/review', { method: 'POST', idempotencyKey: 'review-replay', body: { decision: 'reject' } });
    assert.equal(conflictingReview.status, 409);
    assert.equal(conflictingReview.body.error.code, 'version_conflict');
    const afterReview = await requestJson(started, '/api/events');
    assert.equal(afterReview.body.data.events.length, beforeReview.body.data.events.length + 1);
    const trashOptions = { method: 'POST', idempotencyKey: 'trash-replay', body: {} };
    const trashed = await requestJson(started, '/api/assets/' + firstUpload.body.data.id + '/trash', trashOptions);
    const replayedTrash = await requestJson(started, '/api/assets/' + firstUpload.body.data.id + '/trash', trashOptions);
    assert.equal(trashed.body.data.deletedAt, replayedTrash.body.data.deletedAt);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('session open replays the same request and rejects idempotency key reuse for another conversation', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const options = { method: 'POST', idempotencyKey: 'session-open-replay', body: { conversationId: 'conversation-one' } };
    const opened = await requestJson(started, '/api/sessions/open', options);
    const replayed = await requestJson(started, '/api/sessions/open', options);
    assert.equal(opened.status, 200);
    assert.equal(replayed.status, 200);
    assert.deepEqual(replayed.body.data, opened.body.data);
    assert.equal(opened.body.data.conversationId, 'conversation-one');

    const conflicting = await requestJson(started, '/api/sessions/open', { method: 'POST', idempotencyKey: 'session-open-replay', body: { conversationId: 'conversation-two' } });
    assert.equal(conflicting.status, 409);
    assert.equal(conflicting.body.error.code, 'version_conflict');
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('daemon derives stable idempotency from operation-name without caller UUID storage', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const request = (body = { name: '命名操作项目', description: '稳定 payload' }) => fetchStudio(started, '/api/projects', { method: 'POST', headers: { 'content-type': 'application/json', 'x-daoge-operation-name': 'project:create:named-fixture' }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, body: await response.json() }));
    const first = await request();
    const replay = await request({ description: '稳定 payload', name: '命名操作项目' });
    assert.equal(first.status, 200);
    assert.equal(replay.status, 200);
    assert.equal(first.body.data.value.id, replay.body.data.value.id);
    assert.equal(replay.body.data.replayed, true);
    assert.equal(started.service.db.prepare("SELECT COUNT(*) AS total FROM projects WHERE name = '命名操作项目'").get().total, 1);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});


test('local Studio service closes even while a Workbench SSE stream remains open', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  let controller;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot, ssePollMs: 20 });
    controller = new AbortController();
    const sse = await fetchStudio(started, '/api/events?after=0', { headers: { accept: 'text/event-stream' }, signal: controller.signal });
    assert.equal(sse.status, 200);
    let timeout;
    await Promise.race([
      started.service.close(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Studio service close was blocked by SSE.')), 500); })
    ]);
    clearTimeout(timeout);
    started = null;
  } finally {
    if (controller) controller.abort();
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('SSE replays Studio events after a cursor without a page refresh', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  let controller;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot, ssePollMs: 20 });
    controller = new AbortController();
    const sse = await fetchStudio(started, '/api/events?after=0', { headers: { accept: 'text/event-stream' }, signal: controller.signal });
    assert.equal(sse.status, 200);
    const reader = sse.body.getReader();
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'sse-project', body: { name: 'SSE 项目' } });
    assert.equal(project.status, 200);
    const event = await nextSseMessage(reader);
    assert.equal(event.event, 'studio-event');
    assert.equal(event.data.eventType, 'project.created');
    assert.equal(event.data.payload.name, 'SSE 项目');
    await reader.cancel();
    controller.abort();
  } finally {
    if (controller) controller.abort();
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('SSE honors Last-Event-ID and requests a snapshot for an unavailable event window', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  let controller;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot, ssePollMs: 20 });
    await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'window-project', body: { name: '事件窗口项目' } });
    const earliest = await requestJson(started, '/api/events?after=0');
    const firstId = earliest.body.data.events[0].id;
    const replay = await fetchStudio(started, '/api/events', { headers: { accept: 'application/json', 'last-event-id': String(firstId - 1) } });
    const replayBody = await replay.json();
    assert.equal(replayBody.data.snapshotRequired, false);
    assert.equal(replayBody.data.events[0].id, firstId);

    await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'window-project-next', body: { name: '事件窗口项目二' } });
    await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'window-project-latest', body: { name: '事件窗口项目三' } });
    started.service.db.prepare('DELETE FROM events WHERE id < (SELECT MAX(id) FROM events)').run();
    controller = new AbortController();
    const sse = await fetchStudio(started, '/api/events', { headers: { accept: 'text/event-stream', 'last-event-id': String(firstId) }, signal: controller.signal });
    const reader = sse.body.getReader();
    const signal = await nextSseMessage(reader);
    assert.equal(signal.event, 'snapshot-required');
    assert.equal(signal.data.after, firstId);
    assert.equal(Number.isInteger(signal.data.cursor), true);
    assert.ok(signal.data.cursor >= firstId);
    assert.equal((await reader.read()).done, true);
    const recovered = await requestJson(started, '/api/events?after=' + signal.data.cursor);
    assert.equal(recovered.body.data.snapshotRequired, false);
    controller.abort();
  } finally {
    if (controller) controller.abort();
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('local Studio releases its database after a fixed port bind failure', async () => {
  const workspaceRoot = temporaryWorkspace();
  const blocker = http.createServer();
  let started;
  try {
    await new Promise((resolve, reject) => blocker.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve()));
    const address = blocker.address();
    assert.ok(address && typeof address !== 'string');
    await assert.rejects(startLocalStudioService({ workspaceRoot }, address.port), /EADDRINUSE/);
    await new Promise((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
    started = await startLocalStudioService({ workspaceRoot }, address.port);
    assert.equal((await requestJson(started, '/api/health')).status, 200);
  } finally {
    if (blocker.listening) await new Promise((resolve) => blocker.close(() => resolve()));
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('verified file response closes its source handle when the API client aborts', async () => {
  const source = new PassThrough();
  let handleCloses = 0;
  const opened = {
    byteSize: 3,
    createReadStream() { return source; },
    close() { handleCloses += 1; }
  };
  const response = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  response.writeHead = () => response;
  streamVerifiedFileResponse({ headers: {} }, response, opened, { 'content-type': 'image/png' }, '"test-image"');
  const sourceClosed = once(source, 'close');
  response.destroy();
  await sourceClosed;
  assert.equal(source.destroyed, true);
  assert.equal(handleCloses, 1);
});
