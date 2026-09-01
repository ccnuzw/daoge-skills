const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-api-'));
}

async function requestJson(url, pathname, options = {}) {
  const response = await fetch(url + pathname, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  return { status: response.status, body: await response.json() };
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
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    fs.writeFileSync(initialized.paths.providerEnvPath, [
      'IMAGE_PROVIDER=openai-images',
      'OPENAI_BASE_URL=https://images.example.test/v1',
      'OPENAI_API_KEY=api-secret-never-in-http-response',
      'OPENAI_MODEL=gpt-image-2'
    ].join('\n') + '\n');
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath, ssePollMs: 20 });

    const health = await requestJson(started.url, '/api/health');
    assert.equal(health.status, 200);
    const provider = await requestJson(started.url, '/api/provider/status');
    assert.equal(provider.body.data.configured, true);
    assert.equal(JSON.stringify(provider.body).includes('api-secret-never-in-http-response'), false);
    const studio = await requestJson(started.url, '/api/studio');
    assert.equal(JSON.stringify(studio.body).includes(workspaceRoot), false);
    const providerDetails = await requestJson(started.url, '/api/provider/details');
    assert.match(providerDetails.body.data.providerEnvPath, /daoge-studio[\/]provider.env$/);
    assert.equal(JSON.stringify(providerDetails.body).includes('api-secret-never-in-http-response'), false);
    const runtimeBefore = await requestJson(started.url, '/api/runtime-settings');
    assert.equal(runtimeBefore.body.data.desired.maxWorkerConcurrency, 30);
    const runtimeUpdated = await requestJson(started.url, '/api/runtime-settings', { method: 'PUT', idempotencyKey: 'runtime-limit', body: { maxWorkerConcurrency: 30 } });
    assert.equal(runtimeUpdated.body.data.desired.maxWorkerConcurrency, 30);

    const project = await requestJson(started.url, '/api/projects', { method: 'POST', idempotencyKey: 'project', body: { name: 'API 项目' } });
    const task = await requestJson(started.url, '/api/tasks', { method: 'POST', idempotencyKey: 'task', body: { projectId: project.body.data.value.id, name: 'API 任务' } });
    const round = await requestJson(started.url, '/api/rounds', { method: 'POST', idempotencyKey: 'round', body: { taskId: task.body.data.value.id, purpose: 'exploration' } });
    const queuedBeforeConfirm = await requestJson(started.url, '/api/runs', { method: 'POST', idempotencyKey: 'queue-before-confirm', body: { roundId: round.body.data.value.id } });
    assert.equal(queuedBeforeConfirm.status, 400);
    assert.equal(queuedBeforeConfirm.body.error.code, 'invalid_command');

    const prepared = await requestJson(started.url, '/api/rounds/' + round.body.data.value.id + '/prepare', { method: 'POST', idempotencyKey: 'prepare', body: { expectedVersion: round.body.data.value.version, plan: { operation: 'generate', itemCount: 1, prompt: 'API fixture image' } } });
    const confirmed = await requestJson(started.url, '/api/rounds/' + round.body.data.value.id + '/confirm', { method: 'POST', idempotencyKey: 'confirm', body: { expectedVersion: prepared.body.data.value.version } });
    const preflight = await requestJson(started.url, '/api/rounds/' + round.body.data.value.id + '/preflight', { method: 'POST', idempotencyKey: 'preflight', body: {} });
    assert.equal(confirmed.status, 200);
    assert.equal(preflight.body.data.value.preflight.valid, true);
    assert.ok(preflight.body.data.value.preview.id);
    const history = await requestJson(started.url, '/api/rounds/' + round.body.data.value.id + '/plan-versions');
    assert.equal(history.body.data.planVersions[0].state, 'confirmed');
    const dryRuns = await requestJson(started.url, '/api/rounds/' + round.body.data.value.id + '/dry-runs');
    assert.equal(dryRuns.body.data.dryRuns[0].id, preflight.body.data.value.preview.id);
    const rejectedConcurrency = await requestJson(started.url, '/api/runs', { method: 'POST', idempotencyKey: 'queue-over-limit', body: { roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id, requestedConcurrency: 31 } });
    assert.equal(rejectedConcurrency.status, 400);
    const queued = await requestJson(started.url, '/api/runs', { method: 'POST', idempotencyKey: 'queue', body: { roundId: round.body.data.value.id, preflightId: preflight.body.data.value.preview.id, requestedConcurrency: 30 } });
    assert.equal(queued.status, 200);
    assert.equal(queued.body.data.value.status, 'queued');
    assert.equal(queued.body.data.value.requestedConcurrency, 30);
    assert.equal(JSON.stringify(queued.body).includes('api-secret-never-in-http-response'), false);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('local Studio service serves the built Workbench and managed image files', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath });
    const page = await fetch(started.url + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<div id=\"root\"><\/div>/);
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
    const upload = await fetch(started.url + '/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'idempotency-key': 'binary-upload', 'x-daoge-filename': 'fixture.png' },
      body: image
    });
    const uploadPayload = await upload.json();
    assert.equal(upload.status, 200);
    const media = await fetch(started.url + '/api/assets/' + uploadPayload.data.id + '/file');
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), image);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('asset write endpoints replay idempotency receipts without duplicate events', async () => {
  const workspaceRoot = temporaryWorkspace();
  let started;
  try {
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath });
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
    const upload = async (body = image) => {
      const response = await fetch(started.url + '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'upload-replay' }, body });
      return { status: response.status, body: await response.json() };
    };
    const firstUpload = await upload();
    const replayedUpload = await upload();
    assert.equal(firstUpload.body.data.id, replayedUpload.body.data.id);
    const conflictingUpload = await upload(Buffer.from('different request bytes'));
    assert.equal(conflictingUpload.status, 409);
    assert.equal(conflictingUpload.body.error.code, 'version_conflict');
    const beforeReview = await requestJson(started.url, '/api/events');
    const reviewOptions = { method: 'POST', idempotencyKey: 'review-replay', body: { decision: 'keep' } };
    const firstReview = await requestJson(started.url, '/api/assets/' + firstUpload.body.data.id + '/review', reviewOptions);
    const replayedReview = await requestJson(started.url, '/api/assets/' + firstUpload.body.data.id + '/review', reviewOptions);
    assert.deepEqual(firstReview.body.data, replayedReview.body.data);
    const conflictingReview = await requestJson(started.url, '/api/assets/' + firstUpload.body.data.id + '/review', { method: 'POST', idempotencyKey: 'review-replay', body: { decision: 'reject' } });
    assert.equal(conflictingReview.status, 409);
    assert.equal(conflictingReview.body.error.code, 'version_conflict');
    const afterReview = await requestJson(started.url, '/api/events');
    assert.equal(afterReview.body.data.events.length, beforeReview.body.data.events.length + 1);
    const trashOptions = { method: 'POST', idempotencyKey: 'trash-replay', body: {} };
    const trashed = await requestJson(started.url, '/api/assets/' + firstUpload.body.data.id + '/trash', trashOptions);
    const replayedTrash = await requestJson(started.url, '/api/assets/' + firstUpload.body.data.id + '/trash', trashOptions);
    assert.equal(trashed.body.data.deletedAt, replayedTrash.body.data.deletedAt);
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
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath, ssePollMs: 20 });
    controller = new AbortController();
    const sse = await fetch(started.url + '/api/events?after=0', { headers: { accept: 'text/event-stream' }, signal: controller.signal });
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
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath, ssePollMs: 20 });
    controller = new AbortController();
    const sse = await fetch(started.url + '/api/events?after=0', { headers: { accept: 'text/event-stream' }, signal: controller.signal });
    assert.equal(sse.status, 200);
    const reader = sse.body.getReader();
    const project = await requestJson(started.url, '/api/projects', { method: 'POST', idempotencyKey: 'sse-project', body: { name: 'SSE 项目' } });
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
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath, ssePollMs: 20 });
    await requestJson(started.url, '/api/projects', { method: 'POST', idempotencyKey: 'window-project', body: { name: '事件窗口项目' } });
    const earliest = await requestJson(started.url, '/api/events?after=0');
    const firstId = earliest.body.data.events[0].id;
    const replay = await fetch(started.url + '/api/events', { headers: { accept: 'application/json', 'last-event-id': String(firstId - 1) } });
    const replayBody = await replay.json();
    assert.equal(replayBody.data.snapshotRequired, false);
    assert.equal(replayBody.data.events[0].id, firstId);

    await requestJson(started.url, '/api/projects', { method: 'POST', idempotencyKey: 'window-project-next', body: { name: '事件窗口项目二' } });
    await requestJson(started.url, '/api/projects', { method: 'POST', idempotencyKey: 'window-project-latest', body: { name: '事件窗口项目三' } });
    started.service.db.prepare('DELETE FROM events WHERE id < (SELECT MAX(id) FROM events)').run();
    controller = new AbortController();
    const sse = await fetch(started.url + '/api/events', { headers: { accept: 'text/event-stream', 'last-event-id': String(firstId) }, signal: controller.signal });
    const reader = sse.body.getReader();
    const signal = await nextSseMessage(reader);
    assert.equal(signal.event, 'snapshot-required');
    assert.equal(signal.data.after, firstId);
    assert.equal(Number.isInteger(signal.data.cursor), true);
    assert.ok(signal.data.cursor >= firstId);
    assert.equal((await reader.read()).done, true);
    const recovered = await requestJson(started.url, '/api/events?after=' + signal.data.cursor);
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
    await assert.rejects(startLocalStudioService({ workspaceRoot, providerTemplatePath }, address.port), /EADDRINUSE/);
    await new Promise((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath }, address.port);
    assert.equal((await requestJson(started.url, '/api/health')).status, 200);
  } finally {
    if (blocker.listening) await new Promise((resolve) => blocker.close(() => resolve()));
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
