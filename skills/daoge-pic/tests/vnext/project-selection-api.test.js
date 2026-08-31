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

test('project visual selection persists as scoped Studio asset relations', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-selection-api-'));
  let started;
  try {
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath });
    const projectA = await json(started.url, '/api/projects', { method: 'POST', key: 'selection-project-a', body: { name: '项目 A' } });
    const projectB = await json(started.url, '/api/projects', { method: 'POST', key: 'selection-project-b', body: { name: '项目 B' } });
    const projectAId = projectA.body.data.value.id;
    const projectBId = projectB.body.data.value.id;
    const upload = await fetch(started.url + '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'selection-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': projectAId }, body: png });
    const asset = (await upload.json()).data;
    const secondUpload = await fetch(started.url + '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'selection-upload-second', 'x-daoge-target-type': 'project', 'x-daoge-target-id': projectAId }, body: pngVariant });
    const secondAsset = (await secondUpload.json()).data;

    const [selected, selectedSecond] = await Promise.all([
      json(started.url, '/api/projects/' + projectAId + '/selection/assets/' + asset.id, { method: 'POST', key: 'selection-add', body: { selected: true } }),
      json(started.url, '/api/projects/' + projectAId + '/selection/assets/' + secondAsset.id, { method: 'POST', key: 'selection-add-second', body: { selected: true } })
    ]);
    assert.equal(selected.status, 200);
    assert.equal(selectedSecond.status, 200);
    assert.equal(JSON.stringify(selected.body).includes('storagePath'), false);
    assert.equal(JSON.stringify(selected.body).includes('contentHash'), false);

    const replay = await json(started.url, '/api/projects/' + projectAId + '/selection/assets/' + asset.id, { method: 'POST', key: 'selection-add', body: { selected: true } });
    assert.equal(replay.status, 200);
    const missingKey = await json(started.url, '/api/projects/' + projectAId + '/selection/assets/' + asset.id, { method: 'POST', body: { selected: true } });
    assert.equal(missingKey.status, 400);
    const conflictingReplay = await json(started.url, '/api/projects/' + projectAId + '/selection/assets/' + asset.id, { method: 'POST', key: 'selection-add', body: { selected: false } });
    assert.equal(conflictingReplay.status, 409);
    assert.equal(conflictingReplay.body.error.code, 'version_conflict');
    const foreign = await json(started.url, '/api/projects/' + projectBId + '/selection/assets/' + asset.id, { method: 'POST', key: 'selection-foreign', body: { selected: true } });
    assert.equal(foreign.status, 400);

    const listed = await json(started.url, '/api/projects/' + projectAId + '/selection');
    assert.deepEqual(listed.body.data.selection.assets.map((item) => item.id).sort(), [asset.id, secondAsset.id].sort());
    await json(started.url, '/api/assets/' + asset.id + '/trash', { method: 'POST', key: 'selection-trash', body: {} });
    const hidden = await json(started.url, '/api/projects/' + projectAId + '/selection');
    assert.deepEqual(hidden.body.data.selection.assets.map((item) => item.id), [secondAsset.id]);
    await json(started.url, '/api/assets/' + asset.id + '/restore', { method: 'POST', key: 'selection-restore', body: {} });
    const restored = await json(started.url, '/api/projects/' + projectAId + '/selection');
    assert.deepEqual(restored.body.data.selection.assets.map((item) => item.id).sort(), [asset.id, secondAsset.id].sort());
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
