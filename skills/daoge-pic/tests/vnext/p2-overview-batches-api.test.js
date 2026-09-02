const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { fetchStudio, requestJson: json } = require('./local-studio-test-helper');



const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');


test('P2 searches safe projections, compares explicit task rounds, and keeps delivery batch versions immutable', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-p2-'));
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const project = await json(started, '/api/projects', { method: 'POST', key: 'p2-project', body: { name: 'P2 运营项目' } });
    const projectId = project.body.data.value.id;
    const task = await json(started, '/api/tasks', { method: 'POST', key: 'p2-task', body: { projectId, name: 'P2 安全检索任务', intent: { prompt: 'must-not-return-search-source', apiKey: 'must-not-return-secret', endpoint: 'https://private.example.test' } } });
    const taskId = task.body.data.value.id;
    const roundA = await json(started, '/api/rounds', { method: 'POST', key: 'p2-round-a', body: { taskId, purpose: 'exploration', plan: { operation: 'generate', itemCount: 2, prompt: 'must-not-return-plan-source' } } });
    const roundB = await json(started, '/api/rounds', { method: 'POST', key: 'p2-round-b', body: { taskId, purpose: 'variation', parentRoundId: roundA.body.data.value.id, plan: { operation: 'edit', itemCount: 1, prompt: 'must-not-return-plan-source' } } });
    const search = await json(started, '/api/search?q=' + encodeURIComponent('安全检索') + '&limit=1');
    assert.equal(search.status, 200);
    assert.equal(search.body.data.results[0].entityType, 'task');
    assert.equal(search.body.data.results[0].label, 'P2 安全检索任务');
    assert.equal(JSON.stringify(search.body.data).includes('must-not-return-search-source'), false);
    assert.equal(JSON.stringify(search.body.data).includes('private.example.test'), false);
    const overview = await json(started, '/api/tasks/' + taskId + '/studio-overview?round=' + roundA.body.data.value.id + '&round=' + roundB.body.data.value.id);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.overview.comparisons.length, 2);
    assert.equal(overview.body.data.overview.comparisons[0].round.plan.operation, 'generate');
    assert.equal(overview.body.data.overview.comparisons[1].round.plan.operation, 'edit');
    assert.equal(JSON.stringify(overview.body.data).includes('must-not-return-plan-source'), false);
    const otherTask = await json(started, '/api/tasks', { method: 'POST', key: 'p2-other-task', body: { projectId, name: '其他任务' } });
    const otherRound = await json(started, '/api/rounds', { method: 'POST', key: 'p2-other-round', body: { taskId: otherTask.body.data.value.id, purpose: 'exploration' } });
    const invalidComparison = await json(started, '/api/tasks/' + taskId + '/studio-overview?round=' + otherRound.body.data.value.id);
    assert.equal(invalidComparison.status, 400);

    const upload = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'p2-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': projectId }, body: png });
    const asset = (await upload.json()).data;
    await json(started, '/api/assets/' + asset.id + '/review', { method: 'POST', key: 'p2-keep', body: { decision: 'keep' } });
    const delivery = await json(started, '/api/deliveries', { method: 'POST', key: 'p2-delivery', body: { projectId, name: 'P2 已准备交付', assetIds: [asset.id] } });
    await json(started, '/api/deliveries/' + delivery.body.data.id + '/ready', { method: 'POST', key: 'p2-delivery-ready', body: {} });
    const batch = await json(started, '/api/delivery-batches', { method: 'POST', key: 'p2-batch-create', body: { projectId, name: 'P2 对外交付', deliveryIds: [delivery.body.data.id] } });
    assert.equal(batch.status, 200);
    const v1 = batch.body.data.versions[0];
    const frozenMembers = JSON.stringify(v1.members);
    assert.equal(v1.status, 'draft');
    const batchReady = await json(started, '/api/delivery-batch-versions/' + v1.id + '/ready', { method: 'POST', key: 'p2-batch-v1-ready', body: {} });
    assert.equal(batchReady.body.data.versions[0].status, 'ready');
    const revision = await json(started, '/api/delivery-batches/' + batch.body.data.id + '/revisions', { method: 'POST', key: 'p2-batch-revise', body: { deliveryIds: [delivery.body.data.id] } });
    const v2 = revision.body.data.versions[0];
    const detail = await json(started, '/api/delivery-batches/' + batch.body.data.id);
    const provenance = await json(started, '/api/assets/' + asset.id + '/provenance');
    assert.equal(provenance.body.data.provenance.deliveryBatches[0].id, batch.body.data.id);
    assert.equal(provenance.body.data.provenance.deliveryBatches[0].versionNo, 2);
    const historicalV1 = detail.body.data.batch.versions.find((version) => version.id === v1.id);
    assert.equal(historicalV1.status, 'ready');
    assert.equal(JSON.stringify(historicalV1.members), frozenMembers);
    assert.equal(v2.versionNo, 2);
    assert.equal(v2.status, 'draft');
    assert.equal(v2.predecessorVersionId, v1.id);
    const secondReady = await json(started, '/api/delivery-batch-versions/' + v1.id + '/ready', { method: 'POST', key: 'p2-batch-v1-ready-again', body: {} });
    assert.equal(secondReady.status, 400);
    assert.equal(JSON.stringify(detail.body.data).includes('storagePath'), false);
    assert.equal(JSON.stringify(detail.body.data).includes('contentHash'), false);
    assert.equal(JSON.stringify(detail.body.data).includes('private.example.test'), false);
    assert.equal(Number(started.service.db.prepare("SELECT COUNT(*) AS count FROM events WHERE event_type = 'run_item.requesting'").get().count), 0);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
