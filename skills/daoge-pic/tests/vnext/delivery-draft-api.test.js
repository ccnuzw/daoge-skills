const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

async function json(url, pathname, options = {}) {
  const response = await fetch(url + pathname, { method: options.method || 'GET', headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.key ? { 'idempotency-key': options.key } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json() };
}

test('P1 delivery HTTP API enforces keep-only drafts and explicit draft ready export transitions', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-api-'));
  let started;
  try {
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath });
    const project = await json(started.url, '/api/projects', { method: 'POST', key: 'delivery-project', body: { name: 'HTTP 交付项目' } });
    const projectId = project.body.data.value.id;
    const uploadResponse = await fetch(started.url + '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'delivery-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': projectId }, body: png });
    const asset = (await uploadResponse.json()).data;
    assert.equal(JSON.stringify(asset).includes('storagePath'), false);
    assert.equal(JSON.stringify(asset).includes('contentHash'), false);
    const listed = await json(started.url, '/api/assets?scope=project&projectId=' + projectId);
    assert.equal(JSON.stringify(listed.body.data.assets).includes('storagePath'), false);
    assert.equal(JSON.stringify(listed.body.data.assets).includes('contentHash'), false);
    const blocked = await json(started.url, '/api/deliveries', { method: 'POST', key: 'delivery-blocked', body: { projectId, name: '未评审', assetIds: [asset.id] } });
    assert.equal(blocked.status, 400);
    const reviewed = await json(started.url, '/api/assets/' + asset.id + '/review', { method: 'POST', key: 'delivery-keep', body: { decision: 'keep' } });
    assert.equal(reviewed.status, 200);
    const draft = await json(started.url, '/api/deliveries', { method: 'POST', key: 'delivery-draft', body: { projectId, name: 'P1 草稿', assetIds: [asset.id] } });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.data.status, 'draft');
    assert.equal(draft.body.data.items[0].review.decision, 'keep');
    const exportBlocked = await json(started.url, '/api/deliveries/' + draft.body.data.id + '/export', { method: 'POST', key: 'delivery-premature-export', body: {} });
    assert.equal(exportBlocked.status, 400);
    const ready = await json(started.url, '/api/deliveries/' + draft.body.data.id + '/ready', { method: 'POST', key: 'delivery-ready', body: {} });
    assert.equal(ready.body.data.status, 'ready');
    const exported = await json(started.url, '/api/deliveries/' + draft.body.data.id + '/export', { method: 'POST', key: 'delivery-export', body: {} });
    assert.equal(exported.status, 200);
    assert.equal(exported.body.data.delivery.status, 'exported');
    const detail = await json(started.url, '/api/deliveries/' + draft.body.data.id);
    assert.equal(detail.body.data.delivery.items[0].review.decision, 'keep');
    assert.equal(JSON.stringify(detail.body.data.delivery).includes('contentHash'), false);
    assert.equal(JSON.stringify(detail.body.data.delivery).includes('storagePath'), false);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
