const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { requestJson: json } = require('./local-studio-test-helper');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');


test('delivery, image archive, and shared asset APIs reject IDs outside the current Studio', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-delivery-scope-'));
  let started;
  try {
    initializeStudio({ workspaceRoot, providerTemplatePath });
    started = await startLocalStudioService({ workspaceRoot, providerTemplatePath });
    const db = started.service.db;
    const timestamp = '2026-01-01T00:00:00.000Z';
    db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_foreign', workspaceRoot + '-foreign', 12, timestamp, timestamp);
    db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('asset_foreign', 'studio_foreign', 'import', 'image/png', 'daoge-assets/imports/foreign.png', 'foreign_hash', 1, '{}', null, timestamp, timestamp);
    db.prepare("INSERT INTO asset_relations (id, asset_id, relation_type, target_type, target_id, metadata_json, created_at) VALUES (?, ?, 'shared_across_projects', 'studio', 'studio_foreign', '{}', ?)").run('relation_foreign_shared', 'asset_foreign', timestamp);
    db.prepare('INSERT INTO projects (id, studio_id, name, description, status, version, created_at, updated_at, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('project_foreign', 'studio_foreign', 'Foreign project', null, 'active', 1, timestamp, timestamp, null);
    db.prepare('INSERT INTO deliveries (id, project_id, name, manifest_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('delivery_foreign', 'project_foreign', 'Foreign delivery', '{"exportDirectory":"daoge-deliveries/foreign","files":[]}', 'exported', timestamp, timestamp);
    const sharedBefore = await json(started, '/api/shared-assets');
    assert.equal(sharedBefore.status, 200);
    assert.deepEqual(sharedBefore.body.data.assets, []);
    const checks = [
      ['/api/projects/project_foreign/deliveries', {}],
      ['/api/projects/project_foreign/assets/archive?assetId=asset_foreign', {}],
      ['/api/assets/asset_foreign/shared', { method: 'POST', key: 'foreign-share', body: { shared: true } }],
      ['/api/deliveries/delivery_foreign', {}],
      ['/api/deliveries/delivery_foreign/archive?sequence=1', {}],
      ['/api/deliveries/delivery_foreign/files/1?download=1', {}],
      ['/api/deliveries', { method: 'POST', key: 'foreign-create', body: { projectId: 'project_foreign', name: 'Blocked', assetIds: [] } }],
      ['/api/deliveries/delivery_foreign/items', { method: 'PUT', key: 'foreign-update', body: { assetIds: [] } }],
      ['/api/deliveries/delivery_foreign/ready', { method: 'POST', key: 'foreign-ready', body: {} }],
      ['/api/deliveries/delivery_foreign/draft', { method: 'POST', key: 'foreign-draft', body: {} }],
      ['/api/deliveries/delivery_foreign/export', { method: 'POST', key: 'foreign-export', body: {} }]
    ];
    for (const [pathname, options] of checks) {
      const response = await json(started, pathname, options);
      assert.equal(response.status, 404, pathname);
      assert.equal(response.body.error.code, 'not_found', pathname);
    }
    const sharedAfter = await json(started, '/api/shared-assets');
    assert.equal(sharedAfter.status, 200);
    assert.deepEqual(sharedAfter.body.data.assets, []);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
