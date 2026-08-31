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
const pngVariant = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function json(url, pathname, options = {}) {
  const response = await fetch(url + pathname, { method: options.method || 'GET', headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.key ? { 'idempotency-key': options.key } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, body: await response.json() };
}

test('P1 delivery HTTP API carries project selection through keep-only draft, ready, and export transitions', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-api-'));
  let started;
  try {
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath });
    const project = await json(started.url, '/api/projects', { method: 'POST', key: 'delivery-project', body: { name: 'HTTP 交付项目' } });
    const projectId = project.body.data.value.id;
    const uploadResponse = await fetch(started.url + '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'delivery-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': projectId }, body: png });
    const asset = (await uploadResponse.json()).data;
    const variantUploadResponse = await fetch(started.url + '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'delivery-upload-variant', 'x-daoge-target-type': 'project', 'x-daoge-target-id': projectId }, body: pngVariant });
    const variantAsset = (await variantUploadResponse.json()).data;
    assert.equal(JSON.stringify(asset).includes('storagePath'), false);
    assert.equal(JSON.stringify(asset).includes('contentHash'), false);
    const originalDownload = await fetch(started.url + '/api/assets/' + asset.id + '/file?download=1');
    assert.equal(originalDownload.status, 200);
    assert.match(originalDownload.headers.get('content-disposition') || '', /attachment; filename="daoge-pic-image\.png"/);
    assert.deepEqual(Buffer.from(await originalDownload.arrayBuffer()), png);
    const listed = await json(started.url, '/api/assets?scope=project&projectId=' + projectId);
    assert.equal(JSON.stringify(listed.body.data.assets).includes('storagePath'), false);
    assert.equal(JSON.stringify(listed.body.data.assets).includes('contentHash'), false);
    assert.equal(listed.body.data.assets[0].display.label, '导入素材');
    assert.equal(listed.body.data.assets[0].display.selectionText, '导入素材');
    const projectArchive = await fetch(started.url + '/api/projects/' + projectId + '/assets/archive?assetId=' + asset.id + '&assetId=' + variantAsset.id);
    assert.equal(projectArchive.status, 200);
    assert.equal(projectArchive.headers.get('content-type'), 'application/zip');
    assert.match(projectArchive.headers.get('content-disposition') || '', /attachment; filename="daoge-pic-project-images\.zip"/);
    const projectArchiveBytes = Buffer.from(await projectArchive.arrayBuffer());
    assert.equal(projectArchiveBytes.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
    assert.equal(projectArchiveBytes.includes(png), true);
    assert.equal(projectArchiveBytes.includes(pngVariant), true);
    const blocked = await json(started.url, '/api/deliveries', { method: 'POST', key: 'delivery-blocked', body: { projectId, name: '未评审', assetIds: [asset.id] } });
    assert.equal(blocked.status, 400);
    const reviewed = await json(started.url, '/api/assets/' + asset.id + '/review', { method: 'POST', key: 'delivery-keep', body: { decision: 'keep' } });
    assert.equal(reviewed.status, 200);
    const reviewedVariant = await json(started.url, '/api/assets/' + variantAsset.id + '/review', { method: 'POST', key: 'delivery-keep-variant', body: { decision: 'keep' } });
    assert.equal(reviewedVariant.status, 200);
    const selected = await json(started.url, '/api/projects/' + projectId + '/selection/assets/' + asset.id, { method: 'POST', key: 'delivery-select-keep', body: { selected: true } });
    assert.equal(selected.status, 200);
    const selectedVariant = await json(started.url, '/api/projects/' + projectId + '/selection/assets/' + variantAsset.id, { method: 'POST', key: 'delivery-select-keep-variant', body: { selected: true } });
    assert.equal(selectedVariant.status, 200);
    const selection = await json(started.url, '/api/projects/' + projectId + '/selection');
    assert.deepEqual(new Set(selection.body.data.selection.assets.map((item) => item.id)), new Set([asset.id, variantAsset.id]));
    const draft = await json(started.url, '/api/deliveries', { method: 'POST', key: 'delivery-draft', body: { projectId, name: 'P1 草稿', assetIds: [asset.id, variantAsset.id], includeCreativeRecord: true } });
    assert.equal(draft.status, 200);
    assert.equal(draft.body.data.status, 'draft');
    assert.equal(draft.body.data.items[0].review.decision, 'keep');
    const updated = await json(started.url, '/api/deliveries/' + draft.body.data.id + '/items', { method: 'PUT', key: 'delivery-update-keeps-record', body: { assetIds: [asset.id, variantAsset.id] } });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.manifest.includeCreativeRecord, true);
    const exportBlocked = await json(started.url, '/api/deliveries/' + draft.body.data.id + '/export', { method: 'POST', key: 'delivery-premature-export', body: {} });
    assert.equal(exportBlocked.status, 400);
    const ready = await json(started.url, '/api/deliveries/' + draft.body.data.id + '/ready', { method: 'POST', key: 'delivery-ready', body: {} });
    assert.equal(ready.body.data.status, 'ready');
    const trashed = await json(started.url, '/api/assets/' + asset.id + '/trash', { method: 'POST', key: 'delivery-trash-after-ready', body: {} });
    assert.equal(trashed.status, 200);
    const unavailableOriginal = await fetch(started.url + '/api/assets/' + asset.id + '/file');
    assert.equal(unavailableOriginal.status, 404);
    const exported = await json(started.url, '/api/deliveries/' + draft.body.data.id + '/export', { method: 'POST', key: 'delivery-export', body: {} });
    assert.equal(exported.status, 200);
    const frozenDownload = await fetch(started.url + '/api/deliveries/' + draft.body.data.id + '/files/1?download=1');
    assert.equal(frozenDownload.status, 200);
    assert.match(frozenDownload.headers.get('content-disposition') || '', /attachment; filename="daoge-pic-delivery-image\.png"/);
    assert.deepEqual(Buffer.from(await frozenDownload.arrayBuffer()), png);
    const deliveryArchive = await fetch(started.url + '/api/deliveries/' + draft.body.data.id + '/archive?sequence=2');
    assert.equal(deliveryArchive.status, 200);
    assert.equal(deliveryArchive.headers.get('content-type'), 'application/zip');
    assert.match(deliveryArchive.headers.get('content-disposition') || '', /attachment; filename="daoge-pic-delivery-images\.zip"/);
    const deliveryArchiveBytes = Buffer.from(await deliveryArchive.arrayBuffer());
    assert.equal(deliveryArchiveBytes.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
    assert.equal(deliveryArchiveBytes.includes(png), false);
    assert.equal(deliveryArchiveBytes.includes(pngVariant), true);
    const invalidArchive = await json(started.url, '/api/deliveries/' + draft.body.data.id + '/archive?sequence=not-a-number');
    assert.equal(invalidArchive.status, 400);
    assert.equal(invalidArchive.body.error.code, 'invalid_command');
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
