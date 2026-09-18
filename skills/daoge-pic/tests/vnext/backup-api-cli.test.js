const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { importStudioAsset, softDeleteAsset } = require('../../dist/vnext/domain/assets');
const { recordUsageEvent } = require('../../dist/vnext/usage/ledger');
const { createBackupManifest } = require('../../dist/vnext/backup/manifest');
const { parseCommand, materializeStdinJson } = require('../../dist/vnext/cli/daoge');
const { STUDIO_SCHEMA_VERSION } = require('../../dist/vnext/studio/database');
const { RUNTIME_VERSION, SKILL_PROTOCOL_VERSION } = require('../../dist/vnext/shared/protocol');
const { configureProvider } = require('./provider-test-helper');
const { fetchStudio, requestJson, requestJsonAsWorkbench, workbenchCookie } = require('./local-studio-test-helper');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

function workspace(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function put(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
}

function safeStudio(studioId) {
  return { studioId, protocolName: 'daoge-pic-skill-protocol', protocolVersion: '2.0.0', runtimeVersion: '5.13.0' };
}

test('backup manifest API requires current Studio auth and exposes only safe relative entries', async () => {
  const root = workspace('daoge-pic-backup-api-');
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    configureProvider(initialized, { name: 'Runtime safety provider', baseUrl: 'https://runtime-secret.example.test/v1', apiKey: 'runtime-secret-never-returned' });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot: root, ssePollMs: 20 });
    fs.writeFileSync(path.join(initialized.paths.runtimeDir, 'daemon.json'), JSON.stringify({ provider: { profileId: 'runtime-profile', configVersion: 1, providerId: 'openai-images', model: 'runtime-model', endpoint: 'https://runtime-secret.example.test/v1' } }));
    const providerStatus = await requestJson(started, '/api/providers');
    const runtime = providerStatus.body.data.runtime;
    assert.equal(Object.hasOwn(runtime.desired, 'endpoint'), false);
    assert.equal(Object.hasOwn(runtime.active, 'endpoint'), false);
    assert.equal(JSON.stringify(runtime).includes('runtime-secret.example.test'), false);
    const asset = importStudioAsset(started.service.db, started.service.initialized.paths, { studioId: started.service.initialized.manifest.studioId, bytes: png, mediaType: 'image/png', originalFilename: 'deleted-fixture.png' });
    const deleted = softDeleteAsset(started.service.db, started.service.initialized.paths, { studioId: started.service.initialized.manifest.studioId, assetId: asset.id });
    assert.match(deleted.storagePath, /^daoge-assets\/trash\//);
    const unauthenticated = await fetch(started.url + '/api/backup/manifest', { headers: { accept: 'application/json', 'x-daoge-skill-protocol': 'daoge-pic-skill-protocol/3.0.0' } });
    assert.equal(unauthenticated.status, 401);

    const manifest = await requestJsonAsWorkbench(started, '/api/backup/manifest', { cookie: await workbenchCookie(started) });
    assert.equal(manifest.status, 200, JSON.stringify(manifest.body));
    const payload = manifest.body.data.manifest;
    assert.equal(payload.studio.studioId, started.service.initialized.manifest.studioId);
    assert.ok(payload.entries.some((entry) => entry.path === deleted.storagePath));
    assert.ok(payload.entries.some((entry) => entry.path === 'daoge-studio/studio.db'));
    assert.ok(payload.entries.some((entry) => entry.path === 'daoge-studio/studio.json'));
    assert.ok(payload.entries.every((entry) => !path.isAbsolute(entry.path) && !entry.path.endsWith('studio.db-wal') && !entry.path.endsWith('studio.db-shm') && !entry.path.includes('Provider.db') && !entry.path.includes('provider.env') && !entry.path.startsWith('daoge-studio/runtime/')));
    assert.equal(JSON.stringify(manifest.body).includes(root), false);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('backup manifest includes frozen exported delivery files and rejects a missing one', async () => {
  const root = workspace('daoge-pic-backup-api-delivery-');
  let started;
  try {
    initializeStudio({ workspaceRoot: root });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot: root, ssePollMs: 20 });
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'backup-delivery-project', body: { name: 'Backup delivery project' } });
    assert.equal(project.status, 200, JSON.stringify(project.body));
    const projectId = project.body.data.value.id;
    const upload = await fetchStudio(started, '/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'idempotency-key': 'backup-delivery-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': projectId },
      body: png
    });
    assert.equal(upload.status, 200);
    const asset = (await upload.json()).data;
    const review = await requestJson(started, '/api/assets/' + asset.id + '/review', { method: 'POST', idempotencyKey: 'backup-delivery-review', body: { decision: 'keep' } });
    assert.equal(review.status, 200, JSON.stringify(review.body));
    const delivery = await requestJson(started, '/api/deliveries', { method: 'POST', idempotencyKey: 'backup-delivery-create', body: { projectId, name: 'Backup delivery', assetIds: [asset.id], includeCreativeRecord: true } });
    assert.equal(delivery.status, 200, JSON.stringify(delivery.body));
    const deliveryId = delivery.body.data.id;
    const ready = await requestJson(started, '/api/deliveries/' + deliveryId + '/ready', { method: 'POST', idempotencyKey: 'backup-delivery-ready', body: {} });
    assert.equal(ready.status, 200, JSON.stringify(ready.body));
    const exported = await requestJson(started, '/api/deliveries/' + deliveryId + '/export', { method: 'POST', idempotencyKey: 'backup-delivery-export', body: {} });
    assert.equal(exported.status, 200, JSON.stringify(exported.body));
    const exportDirectory = exported.body.data.delivery.manifest.exportDirectory;
    assert.match(exportDirectory, /^daoge-deliveries\//);
    const expectedPaths = ['001.png', 'manifest.json', 'contact-sheet.html', 'creative-record.json'].map((name) => exportDirectory + '/' + name);
    const manifest = await requestJsonAsWorkbench(started, '/api/backup/manifest');
    assert.equal(manifest.status, 200, JSON.stringify(manifest.body));
    const entries = manifest.body.data.manifest.entries;
    for (const expectedPath of expectedPaths) {
      const entry = entries.find((item) => item.path === expectedPath);
      assert.ok(entry, expectedPath);
      assert.equal(entry.required, true);
    }
    assert.equal(JSON.stringify(manifest.body).includes(root), false);
    assert.equal(entries.every((entry) => !path.isAbsolute(entry.path)), true);
    assert.equal(entries.every((entry) => !entry.path.includes('Provider.db') && !entry.path.includes('provider.env') && !entry.path.startsWith('daoge-studio/runtime/')), true);
    fs.rmSync(path.join(root, ...expectedPaths[2].split('/')), { force: true });
    const rejected = await requestJsonAsWorkbench(started, '/api/backup/manifest');
    assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
    assert.match(rejected.body.error.message, /缺失|missing|不存在/i);
    assert.equal(JSON.stringify(rejected.body).includes(root), false);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('budget API profile queries use the global fallback policy and its usage scope', async () => {
  const root = workspace('daoge-pic-backup-api-budget-');
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    const configured = configureProvider(initialized, { name: 'Budget fallback provider', apiKey: 'budget-fallback-secret' });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot: root, ssePollMs: 20 });
    const studioId = initialized.manifest.studioId;
    recordUsageEvent(started.service.db, {
      studioId,
      estimate: { unit: 'image', quantity: 1, estimatedCostMinor: 25, costUnit: 'USD_minor', source: 'provider' },
      billingState: 'billed',
      idempotencyKey: 'backup-budget-usage'
    });
    const configuredBudget = await requestJson(started, '/api/budget', { method: 'POST', idempotencyKey: 'backup-global-budget', body: { limitCostMinor: 100, costUnit: 'USD_minor' } });
    assert.equal(configuredBudget.status, 200, JSON.stringify(configuredBudget.body));
    const global = await requestJson(started, '/api/budget');
    assert.equal(global.status, 200, JSON.stringify(global.body));
    assert.equal(global.body.data.policy.profileId, null);
    assert.equal(global.body.data.usage.knownCostMinor, 25);
    const profile = await requestJson(started, '/api/budget?profileId=' + encodeURIComponent(configured.config.profileId));
    assert.equal(profile.status, 200, JSON.stringify(profile.body));
    assert.equal(profile.body.data.policy.profileId, null);
    assert.equal(profile.body.data.policy.limitCostMinor, 100);
    assert.equal(profile.body.data.usage.knownCostMinor, 25);
    assert.equal(profile.body.data.usage.eventCount, global.body.data.usage.eventCount);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backup manifest checkpoints WAL before hashing and rejects an active database lock', async () => {
  const root = workspace('daoge-pic-backup-api-wal-');
  let started;
  try {
    initializeStudio({ workspaceRoot: root });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot: root, ssePollMs: 20 });
    importStudioAsset(started.service.db, started.service.initialized.paths, { studioId: started.service.initialized.manifest.studioId, bytes: png, mediaType: 'image/png', originalFilename: 'wal-fixture.png' });
    const databasePath = started.service.initialized.paths.databasePath;
    const walPath = databasePath + '-wal';
    assert.ok(fs.existsSync(walPath) && fs.statSync(walPath).size > 0, 'fixture must create a non-empty WAL');

    const cookie = await workbenchCookie(started);
    const manifest = await requestJsonAsWorkbench(started, '/api/backup/manifest', { cookie });
    assert.equal(manifest.status, 200, JSON.stringify(manifest.body));
    const entries = manifest.body.data.manifest.entries;
    assert.equal(entries.some((entry) => entry.path === 'daoge-studio/studio.db-wal' || entry.path === 'daoge-studio/studio.db-shm'), false);
    assert.equal(fs.existsSync(walPath) ? fs.statSync(walPath).size : 0, 0);
    assert.equal(entries.find((entry) => entry.path === 'daoge-studio/studio.db').byteSize, fs.statSync(databasePath).size);

    started.service.db.exec('BEGIN IMMEDIATE');
    try {
      const rejected = await requestJsonAsWorkbench(started, '/api/backup/manifest', { cookie });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
      assert.match(rejected.body.error.message, /checkpoint|锁定|WAL/);
    } finally {
      started.service.db.exec('ROLLBACK');
    }
  } finally {
    if (started) await started.service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backup POST APIs are Bearer-only, enforce allowlists, and keep source paths out of receipts', async () => {
  const root = workspace('daoge-pic-backup-api-write-');
  const source = workspace('daoge-pic-backup-source-');
  let started;
  try {
    initializeStudio({ workspaceRoot: root });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot: root, ssePollMs: 20 });
    put(source, 'metadata/studio.json', '{}');
    const sourceManifest = createBackupManifest({ workspaceRoot: source, studio: safeStudio(started.service.initialized.manifest.studioId), entries: [{ path: 'metadata/studio.json', category: 'metadata' }] });

    const cookie = await workbenchCookie(started);
    const cookieWrite = await requestJsonAsWorkbench(started, '/api/backup/restore-dry-run', { cookie, method: 'POST', idempotencyKey: 'backup-cookie-write', body: { sourceRoot: source, manifest: sourceManifest } });
    assert.equal(cookieWrite.status, 403);
    const unknownField = await requestJson(started, '/api/backup/restore-dry-run', { method: 'POST', idempotencyKey: 'backup-unknown-field', body: { sourceRoot: source, manifest: sourceManifest, unexpected: true } });
    assert.equal(unknownField.status, 400);

    const dryRun = await requestJson(started, '/api/backup/restore-dry-run', { method: 'POST', idempotencyKey: 'backup-dry-run', body: { sourceRoot: source, manifest: sourceManifest } });
    assert.equal(dryRun.status, 200, JSON.stringify(dryRun.body));
    assert.equal(JSON.stringify(dryRun.body).includes(source), false);
    const replay = await requestJson(started, '/api/backup/restore-dry-run', { method: 'POST', idempotencyKey: 'backup-dry-run', body: { sourceRoot: source, manifest: sourceManifest } });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.data.replayed, true);

    const absoluteManifest = { ...sourceManifest, entries: [{ ...sourceManifest.entries[0], path: path.join(source, 'metadata/studio.json') }] };
    const rollback = await requestJson(started, '/api/backup/rollback-point', { method: 'POST', idempotencyKey: 'backup-rollback-absolute', body: { manifest: absoluteManifest, runtimeVersion: '5.13.0', schemaVersion: 1 } });
    assert.equal(rollback.status, 400);
    assert.equal(JSON.stringify(rollback.body).includes(source), false);

    const upgrade = await requestJson(started, '/api/backup/upgrade-assess', { method: 'POST', idempotencyKey: 'backup-upgrade', body: { targetRuntimeVersion: RUNTIME_VERSION, targetSchemaVersion: STUDIO_SCHEMA_VERSION, targetProtocolVersion: SKILL_PROTOCOL_VERSION, rollbackPoint: null } });
    assert.equal(upgrade.status, 200, JSON.stringify(upgrade.body));
    assert.equal(upgrade.body.data.value.allowed, true);
    assert.equal(upgrade.body.data.runtimeFacts.currentSchemaVersion, STUDIO_SCHEMA_VERSION);
    assert.equal(upgrade.body.data.runtimeFacts.supportedSchemaVersion, STUDIO_SCHEMA_VERSION);
    assert.equal(upgrade.body.data.runtimeFacts.currentRuntimeVersion, RUNTIME_VERSION);
    assert.equal(upgrade.body.data.runtimeFacts.supportedProtocolRange, '>=3.0.0 <4.0.0');

    const selfCertified = await requestJson(started, '/api/backup/upgrade-assess', { method: 'POST', idempotencyKey: 'backup-upgrade-self', body: { targetRuntimeVersion: RUNTIME_VERSION, targetSchemaVersion: 9999, targetProtocolVersion: SKILL_PROTOCOL_VERSION, supportedSchemaVersion: 9999 } });
    assert.equal(selfCertified.status, 400);

    const future = await requestJson(started, '/api/backup/upgrade-assess', { method: 'POST', idempotencyKey: 'backup-upgrade-future', body: { targetRuntimeVersion: RUNTIME_VERSION, targetSchemaVersion: STUDIO_SCHEMA_VERSION + 1, targetProtocolVersion: SKILL_PROTOCOL_VERSION } });
    assert.equal(future.status, 200, JSON.stringify(future.body));
    assert.equal(future.body.data.value.allowed, false);
    assert.ok(future.body.data.value.issues.some((item) => item.code === 'schema_unsupported'));
  } finally {
    if (started) await started.service.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
});

test('backup CLI schemas are JSON-only and preserve path/body marker conventions', () => {
  const root = '/tmp/daoge-cli-backup';
  const restore = parseCommand(['backup-restore-dry-run', '--workspace', root, '--source-root', '/tmp/source-backup', '--manifest', '@-', '--operation-name', 'backup.restore:dry-run']);
  assert.equal(restore.request.method, 'POST');
  assert.equal(restore.request.pathname, '/api/backup/restore-dry-run');
  assert.equal(restore.request.body.sourceRoot, '/tmp/source-backup');
  assert.deepEqual(restore.request.body.manifest, { __daogeJsonStdin: true });
  assert.equal(restore.request.idempotencyKey, undefined);
  assert.equal(restore.request.operationName, 'backup.restore:dry-run');
  assert.throws(() => materializeStdinJson({ manifest: restore.request.body.manifest, expectedStudio: restore.request.body.manifest }), /最多只能使用一个/);

  const manifest = parseCommand(['backup-manifest', '--workspace', root]);
  assert.equal(manifest.request.method, 'GET');
  assert.equal(manifest.request.pathname, '/api/backup/manifest');
  assert.deepEqual(manifest.request.body, {});
  const upgrade = parseCommand(['backup-upgrade-assess', '--workspace', root, '--target-runtime-version', '5.14.2', '--target-schema-version', '33', '--target-protocol-version', '2.0.0', '--rollback-point', '@-']);
  assert.deepEqual(upgrade.request.body.rollbackPoint, { __daogeJsonStdin: true });
  assert.equal(upgrade.request.body.currentSchemaVersion, undefined);
  assert.equal(upgrade.request.body.supportedSchemaVersion, undefined);
  assert.equal(upgrade.request.body.supportedProtocolRange, undefined);
  assert.throws(() => parseCommand(['backup-upgrade-assess', '--workspace', root, '--current-runtime-version', '5.13.0', '--target-runtime-version', '5.14.2', '--target-schema-version', '33', '--target-protocol-version', '2.0.0']), /未知参数|--current-runtime-version/);
  const rollback = parseCommand(['backup-rollback-point', '--workspace', root, '--manifest', '{}', '--runtime-version', '5.13.0', '--schema-version', '1']);
  assert.equal(rollback.request.pathname, '/api/backup/rollback-point');
  assert.equal(rollback.request.body.runtimeVersion, '5.13.0');
  assert.equal(rollback.request.body.schemaVersion, 1);
});

test('backup manifest accepts delivery exports written with the legacy frozen-file shape', async () => {
  const root = workspace('daoge-pic-backup-legacy-delivery-');
  let started;
  try {
    initializeStudio({ workspaceRoot: root });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot: root, ssePollMs: 20 });
    const project = await requestJson(started, '/api/projects', { method: 'POST', idempotencyKey: 'legacy-delivery-project', body: { name: 'Legacy delivery project' } });
    const projectId = project.body.data.value.id;
    const upload = await fetchStudio(started, '/api/assets/import', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'idempotency-key': 'legacy-delivery-upload', 'x-daoge-target-type': 'project', 'x-daoge-target-id': projectId },
      body: png
    });
    const asset = (await upload.json()).data;
    await requestJson(started, '/api/assets/' + asset.id + '/review', { method: 'POST', idempotencyKey: 'legacy-delivery-review', body: { decision: 'keep' } });
    const delivery = await requestJson(started, '/api/deliveries', { method: 'POST', idempotencyKey: 'legacy-delivery-create', body: { projectId, name: 'Legacy delivery', assetIds: [asset.id], includeCreativeRecord: false } });
    const deliveryId = delivery.body.data.id;
    await requestJson(started, '/api/deliveries/' + deliveryId + '/ready', { method: 'POST', idempotencyKey: 'legacy-delivery-ready', body: {} });
    const exported = await requestJson(started, '/api/deliveries/' + deliveryId + '/export', { method: 'POST', idempotencyKey: 'legacy-delivery-export', body: {} });
    assert.equal(exported.status, 200, JSON.stringify(exported.body));

    const stored = JSON.parse(started.service.db.prepare('SELECT manifest_json FROM deliveries WHERE id = ?').get(deliveryId).manifest_json);
    assert.ok(Array.isArray(stored.exportFiles) && stored.exportFiles.every((file) => typeof file.contentHash === 'string'));
    const legacy = {
      ...stored,
      files: stored.exportFiles.map((file, index) => ({ sequence: index + 1, file: file.name, mediaType: 'image/png', contentHash: file.contentHash }))
    };
    delete legacy.exportFiles;
    started.service.db.prepare('UPDATE deliveries SET manifest_json = ? WHERE id = ?').run(JSON.stringify(legacy), deliveryId);

    const manifest = await requestJsonAsWorkbench(started, '/api/backup/manifest');
    assert.equal(manifest.status, 200, JSON.stringify(manifest.body));
    const paths = manifest.body.data.manifest.entries.map((entry) => entry.path);
    assert.ok(paths.includes(stored.exportDirectory + '/001.png'), JSON.stringify(paths.slice(0, 8)));
    assert.equal(JSON.stringify(manifest.body).includes(root), false);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backup manifest pages past the 500-row asset clamp instead of truncating silently', async () => {
  const root = workspace('daoge-pic-backup-page-');
  let started;
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    started = await startLocalStudioService({ hardenAccess: false, workspaceRoot: root, ssePollMs: 20 });
    const studioId = initialized.manifest.studioId;
    const timestamp = new Date().toISOString();
    const total = 620;
    const insert = started.service.db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size, source_json, deleted_at, created_at, updated_at, media_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)');
    for (let index = 0; index < total; index += 1) {
      const relative = 'daoge-assets/generated/seed-' + String(index).padStart(4, '0') + '.png';
      const absolute = path.join(root, ...relative.split('/'));
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, 'seed-' + index);
      insert.run('asset_seed_' + index, studioId, 'generated', 'image/png', relative, index.toString(16).padStart(64, '0'), 8, '{}', timestamp, timestamp, 'available');
    }
    const manifest = await requestJsonAsWorkbench(started, '/api/backup/manifest');
    assert.equal(manifest.status, 200, JSON.stringify(manifest.body));
    const seeded = manifest.body.data.manifest.entries.filter((entry) => entry.path.includes('seed-'));
    assert.equal(seeded.length, total);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
