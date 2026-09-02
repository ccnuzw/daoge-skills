const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { fetchStudio, requestJson: json } = require('./local-studio-test-helper');



const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');


test('creative library HTTP API exposes reusable kits without sensitive definition fields', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-library-api-'));
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const taskType = await json(started, '/api/task-types', { method: 'POST', key: 'library-task-type', body: { name: '系列商品图', definition: { summary: '连续商品构图', fields: ['product', 'angle'], secret_token: 'not-public' } } });
    assert.equal(taskType.status, 200);
    assert.equal(JSON.stringify(taskType.body.data).includes('not-public'), false);
    started.service.db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('other-library-studio', workspaceRoot + '-other', 17, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    started.service.db.prepare('INSERT INTO task_types (id, studio_id, name, definition_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('other-library-task-type', 'other-library-studio', '其他 Studio 类型', '{}', 'user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    const taskTypes = await json(started, '/api/task-types');
    assert.equal(taskTypes.body.data.taskTypes.some((item) => item.id === taskType.body.data.id), true);
    assert.equal(taskTypes.body.data.taskTypes.some((item) => item.id === 'other-library-task-type'), false);
    assert.equal(taskTypes.body.data.taskTypes.some((item) => item.id === 'campaign-poster' && item.studioId === null), true);
    const project = await json(started, '/api/projects', { method: 'POST', key: 'library-project', body: { name: '资料库任务项目' } });
    const currentTaskType = await json(started, '/api/tasks', { method: 'POST', key: 'library-current-task-type', body: { projectId: project.body.data.value.id, name: '当前 Studio 类型任务', taskTypeId: taskType.body.data.id } });
    assert.equal(currentTaskType.status, 200);
    const officialTaskType = await json(started, '/api/tasks', { method: 'POST', key: 'library-official-task-type', body: { projectId: project.body.data.value.id, name: '官方类型任务', taskTypeId: 'campaign-poster' } });
    assert.equal(officialTaskType.status, 200);
    const foreignTaskType = await json(started, '/api/tasks', { method: 'POST', key: 'library-foreign-task-type', body: { projectId: project.body.data.value.id, name: '跨 Studio 类型任务', taskTypeId: 'other-library-task-type' } });
    assert.equal(foreignTaskType.status, 404);
    const uploaded = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'library-import' }, body: png });
    const asset = (await uploaded.json()).data;
    const initialShared = await json(started, '/api/shared-assets');
    assert.deepEqual(initialShared.body.data.assets, []);
    const shared = await json(started, '/api/assets/' + asset.id + '/shared', { method: 'POST', key: 'library-share', body: { shared: true } });
    assert.equal(shared.status, 200);
    const sharedList = await json(started, '/api/shared-assets');
    assert.deepEqual(sharedList.body.data.assets.map((item) => item.id), [asset.id]);
    assert.equal(JSON.stringify(sharedList.body.data).includes('storagePath'), false);
    assert.equal(JSON.stringify(sharedList.body.data).includes('contentHash'), false);
    const style = await json(started, '/api/style-kits', { method: 'POST', key: 'library-style', body: { name: '夜景编辑感', definition: { summary: '冷暖对比', api_key: 'not-public' }, assetIds: [asset.id] } });
    assert.equal(style.status, 200);
    assert.equal(JSON.stringify(style.body.data).includes('not-public'), false);
    const missingTarget = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'library-missing-target', 'x-daoge-target-type': 'project', 'x-daoge-target-id': 'project_missing' }, body: png });
    assert.equal(missingTarget.status, 404);
    const list = await json(started, '/api/style-kits');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.styleKits[0].assetIds, [asset.id]);
    assert.equal(JSON.stringify(list.body.data).includes('not-public'), false);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
