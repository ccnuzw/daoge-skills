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

test('creative library HTTP API exposes reusable kits without sensitive definition fields', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-library-api-'));
  let started;
  try {
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath });
    const taskType = await json(started.url, '/api/task-types', { method: 'POST', key: 'library-task-type', body: { name: '系列商品图', definition: { summary: '连续商品构图', fields: ['product', 'angle'], secret_token: 'not-public' } } });
    assert.equal(taskType.status, 200);
    assert.equal(JSON.stringify(taskType.body.data).includes('not-public'), false);
    const uploaded = await fetch(started.url + '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'library-import' }, body: png });
    const asset = (await uploaded.json()).data;
    const initialShared = await json(started.url, '/api/shared-assets');
    assert.deepEqual(initialShared.body.data.assets, []);
    const shared = await json(started.url, '/api/assets/' + asset.id + '/shared', { method: 'POST', key: 'library-share', body: { shared: true } });
    assert.equal(shared.status, 200);
    const sharedList = await json(started.url, '/api/shared-assets');
    assert.deepEqual(sharedList.body.data.assets.map((item) => item.id), [asset.id]);
    assert.equal(JSON.stringify(sharedList.body.data).includes('storagePath'), false);
    assert.equal(JSON.stringify(sharedList.body.data).includes('contentHash'), false);
    const style = await json(started.url, '/api/style-kits', { method: 'POST', key: 'library-style', body: { name: '夜景编辑感', definition: { summary: '冷暖对比', api_key: 'not-public' }, assetIds: [asset.id] } });
    assert.equal(style.status, 200);
    assert.equal(JSON.stringify(style.body.data).includes('not-public'), false);
    const missingTarget = await fetch(started.url + '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'library-missing-target', 'x-daoge-target-type': 'project', 'x-daoge-target-id': 'project_missing' }, body: png });
    assert.equal(missingTarget.status, 404);
    const list = await json(started.url, '/api/style-kits');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.styleKits[0].assetIds, [asset.id]);
    assert.equal(JSON.stringify(list.body.data).includes('not-public'), false);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
