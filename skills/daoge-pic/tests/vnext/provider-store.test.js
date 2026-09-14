const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const providerStore = require('../../dist/vnext/studio/provider-store');
const { openProviderDatabase, closeProviderDatabase, importLegacyProviderEnvOnce, importProviderEnvProfile, createProviderProfile, updateProviderProfile, copyProviderProfile, activateProviderProfile, deleteProviderProfile, listProviderProfiles, resolveActiveProviderConfig, providerStatus, recordProviderTestEvidence, clearProviderSecretCache } = providerStore;
const providerSecrets = require('../../dist/vnext/studio/provider-secrets');




function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-provider-store-')); }
function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

function create(db, key, name, active = false) {
  return createProviderProfile(db, { name, providerId: 'openai-images', model: 'gpt-image-2', baseUrl: 'https://provider.example.test/v1/full/path', apiKey: 'secret-' + key, options: { referenceEnabled: true }, active, idempotencyKey: key });
}

test('Provider.db enforces private SQLite settings, write-only summaries, CRUD, and one active Profile', () => {
  const root = workspace();
  let providerDb;
  let studioDb;
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    providerDb = openProviderDatabase(initialized.paths);
    studioDb = openStudioDatabase(initialized.paths, initialized.manifest);
    const first = create(providerDb, 'provider-first', 'Primary', true);
    assert.throws(() => createProviderProfile(providerDb, { name: 'Insecure', providerId: 'openai-images', model: 'gpt-image-2', baseUrl: 'http://public.example.test/v1', apiKey: 'insecure-secret', endpointTrustMode: 'compatible_public', active: false, idempotencyKey: 'provider-insecure' }), /必须使用 HTTPS/);
    const second = create(providerDb, 'provider-second', 'Secondary', false);
    assert.equal(first.active, true);
    assert.equal(first.referenceEnabled, true);
    assert.equal(first.descriptorVersion, 1);
    assert.equal(first.adapterVersion, 'http-image-v1');
    assert.equal(first.secretBackend, 'sqlite-plaintext');
    assert.equal(JSON.stringify(listProviderProfiles(providerDb)).includes('secret-provider-first'), false);
    assert.equal(JSON.stringify(listProviderProfiles(providerDb)).includes('/v1/full/path'), false);
    const copied = copyProviderProfile(providerDb, first.id, { name: 'Primary Copy', idempotencyKey: 'provider-copy' });
    assert.equal(copied.active, false);
    const activatedSecond = activateProviderProfile(providerDb, second.id, 'provider-activate');
    assert.equal(activatedSecond.impact.restartRequired, false);
    assert.equal(activatedSecond.configVersion, second.configVersion);
    assert.equal(listProviderProfiles(providerDb).filter((profile) => profile.active).length, 1);
    assert.equal(resolveActiveProviderConfig(providerDb).profileId, second.id);
    assert.equal(listProviderProfiles(providerDb).find((profile) => profile.id === first.id).configVersion, first.configVersion);
    const selected = listProviderProfiles(providerDb).find((profile) => profile.id === second.id);
    const updated = updateProviderProfile(providerDb, second.id, { expectedConfigVersion: selected.configVersion, baseUrl: { action: 'clear' }, apiKey: { action: 'replace', value: 'replacement-secret' }, options: { referenceEnabled: false }, idempotencyKey: 'provider-update' });
    assert.equal(updated.endpointSummary, null);
    assert.equal(updated.referenceEnabled, true);
    assert.equal(providerStatus(providerDb).configured, false);
    assert.equal(JSON.stringify(updated).includes('replacement-secret'), false);
    const reenabled = updateProviderProfile(providerDb, second.id, { expectedConfigVersion: updated.configVersion, baseUrl: { action: 'keep' }, apiKey: { action: 'keep' }, options: { referenceEnabled: true }, idempotencyKey: 'provider-reenable' });
    assert.equal(reenabled.referenceEnabled, true);
    assert.equal(listProviderProfiles(providerDb).find((profile) => profile.id === second.id).referenceEnabled, true);
    assert.throws(() => deleteProviderProfile(providerDb, second.id, 'provider-delete-active'), /需要显式确认 force/);
    const forcedDelete = deleteProviderProfile(providerDb, second.id, 'provider-delete-active-force', { force: true });
    assert.equal(forcedDelete.impact.restartRequired, false);
    activateProviderProfile(providerDb, first.id, 'provider-reactivate');
    const evidence = recordProviderTestEvidence(providerDb, first.id, { configVersion: first.configVersion, reachable: true, status: 204, warnings: ['fixture warning'] });
    assert.equal(evidence.status, 204);
    assert.equal(evidence.configVersion, first.configVersion);
    assert.equal(listProviderProfiles(providerDb).find((profile) => profile.id === first.id).lastTest.status, 204);
    const changedFirst = updateProviderProfile(providerDb, first.id, { expectedConfigVersion: first.configVersion, baseUrl: { action: 'keep' }, apiKey: { action: 'keep' }, options: { referenceEnabled: true }, idempotencyKey: 'provider-update-first' });
    assert.throws(() => recordProviderTestEvidence(providerDb, first.id, { configVersion: first.configVersion, reachable: true, status: 204 }), /配置已变化/);
    assert.equal(changedFirst.configVersion, first.configVersion + 1);
    deleteProviderProfile(providerDb, copied.id, 'provider-delete');
    assert.equal(listProviderProfiles(providerDb).some((profile) => profile.id === copied.id), false);
    assert.equal(studioDb.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE name = 'provider_profiles'").get().total, 0);
    assert.equal(providerDb.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
    assert.equal(providerDb.prepare('PRAGMA secure_delete').get().secure_delete, 1);
    assert.equal(providerDb.prepare('PRAGMA synchronous').get().synchronous, 2);
    assert.equal(providerDb.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    if (process.platform !== 'win32') assert.equal(fs.statSync(initialized.paths.providerDatabasePath).mode & 0o777, 0o600);
    assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /daoge-studio\/Provider\.db/);
  } finally {
    closeProviderDatabase(providerDb);
    closeStudioDatabase(studioDb);
    cleanup(root);
  }
});

test('module-global secret cache isolates identical references and versions across workspaces', () => {
  const roots = [workspace(), workspace()];
  const dbs = [];
  const pathFixtures = [];
  const originalCreate = providerSecrets.createProviderSecretStore;
  const reads = [];
  const stores = new Map();
  providerSecrets.createProviderSecretStore = (paths) => ({
    backend: 'linux-libsecret',
    store(reference, value) { stores.set(paths.workspaceRoot + '\0' + reference, value); return reference; },
    read(reference) {
      if (reference === 'shared:base_url' || reference === 'shared:api_key') reads.push(paths.workspaceRoot + '\0' + reference);
      return stores.get(paths.workspaceRoot + '\0' + reference) || '';
    },
    delete() {}
  });
  try {
    clearProviderSecretCache();
    for (const [index, root] of roots.entries()) {
      const initialized = initializeStudio({ workspaceRoot: root });
      pathFixtures.push(initialized.paths);
      const db = openProviderDatabase(initialized.paths);
      dbs.push(db);
      const profile = createProviderProfile(db, { name: 'Same Profile', providerId: 'openai-images', model: 'gpt-image-2', baseUrl: 'https://provider.example.test/v1', apiKey: 'workspace-secret-' + index, options: { referenceEnabled: true }, active: true, paths: initialized.paths, idempotencyKey: 'same-profile-' + index });
      // Force equal backend/reference/configVersion values to reproduce the
      // collision that a module-global cache must not permit.
      db.prepare('UPDATE provider_profiles SET base_url_secret_ref = ?, api_key_secret_ref = ?, config_version = 1 WHERE id = ?').run('shared:base_url', 'shared:api_key', profile.id);
      stores.set(root + '\0shared:base_url', 'https://workspace-' + index + '.example.test/v1');
      stores.set(root + '\0shared:api_key', 'workspace-secret-' + index);
    }
    const configs = roots.map((root, index) => resolveActiveProviderConfig(dbs[index], pathFixtures[index]));
    assert.equal(configs[0].configVersion, 1);
    assert.equal(configs[1].configVersion, 1);
    assert.equal(configs[0].apiKey, 'workspace-secret-0');
    assert.equal(configs[1].apiKey, 'workspace-secret-1');
    assert.deepEqual(reads, [roots[0] + '\0shared:base_url', roots[0] + '\0shared:api_key', roots[1] + '\0shared:base_url', roots[1] + '\0shared:api_key']);
  } finally {
    providerSecrets.createProviderSecretStore = originalCreate;
    clearProviderSecretCache();
    for (const db of dbs) closeProviderDatabase(db);
    roots.forEach(cleanup);
  }
});
test('secret cache clears on Provider rotation and database close', () => {
  const root = workspace();
  let db;
  const previous = process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
  const originalCreate = providerSecrets.createProviderSecretStore;
  const values = new Map();
  let reads = 0;
  providerSecrets.createProviderSecretStore = (paths, backend) => {
    if (backend !== 'linux-libsecret') return originalCreate(paths, backend);
    return { backend: 'linux-libsecret', store(reference, value) { values.set(reference, value); return reference; }, read(reference) { reads += 1; return values.get(reference) || ''; }, delete() {} };
  };
  try {
    process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = 'plaintext';
    const initialized = initializeStudio({ workspaceRoot: root });
    db = openProviderDatabase(initialized.paths);
    const profile = createProviderProfile(db, { name: 'Cache Rotation', providerId: 'openai-images', model: 'gpt-image-2', baseUrl: 'https://provider.example.test/v1', apiKey: 'cache-secret-a', active: true, idempotencyKey: 'cache-create' });
    db.prepare('UPDATE provider_profiles SET secret_backend = ?, base_url_secret_ref = ?, api_key_secret_ref = ?, base_url = ?, api_key = ? WHERE id = ?').run('linux-libsecret', 'shared:base_url', 'shared:api_key', '', '', profile.id);
    values.set('shared:base_url', 'https://provider.example.test/v1');
    values.set('shared:api_key', 'cache-secret-a');
    clearProviderSecretCache();
    assert.equal(resolveActiveProviderConfig(db, initialized.paths).apiKey, 'cache-secret-a');
    assert.equal(resolveActiveProviderConfig(db, initialized.paths).apiKey, 'cache-secret-a');
    assert.equal(reads, 2);
    values.set('shared:api_key', 'cache-secret-b');
    updateProviderProfile(db, profile.id, { expectedConfigVersion: profile.configVersion, baseUrl: { action: 'keep' }, apiKey: { action: 'replace', value: 'cache-secret-b' }, paths: initialized.paths, secretBackend: 'linux-libsecret', idempotencyKey: 'cache-rotate' });
    // The update path clears the module cache; the next resolve must re-read.
    db.prepare('UPDATE provider_profiles SET secret_backend = ?, base_url_secret_ref = ?, api_key_secret_ref = ? WHERE id = ?').run('linux-libsecret', 'shared:base_url', 'shared:api_key', profile.id);
    assert.equal(resolveActiveProviderConfig(db, initialized.paths).apiKey, 'cache-secret-b');
    assert.ok(reads >= 3);
  } finally {
    providerSecrets.createProviderSecretStore = originalCreate;
    if (previous === undefined) delete process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
    else process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = previous;
    closeProviderDatabase(db);
    cleanup(root);
  }
});

test('failed Linux cleanup remains ledgered until deletion succeeds', () => {
  const root = workspace();
  let db;
  const originalCreate = providerSecrets.createProviderSecretStore;
  let shouldFail = true;
  providerSecrets.createProviderSecretStore = (paths, backend) => {
    if (backend !== 'linux-libsecret') return originalCreate(paths, backend);
    return { backend: 'linux-libsecret', store() { return 'unused'; }, read() { return ''; }, delete() { if (shouldFail) throw new Error('libsecret unavailable'); } };
  };
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    db = openProviderDatabase(initialized.paths);
    db.prepare('INSERT INTO provider_secret_cleanup (backend, reference, created_at) VALUES (?, ?, ?)').run('linux-libsecret', 'stale:api_key', new Date().toISOString());
    closeProviderDatabase(db);
    db = null;
    assert.doesNotThrow(() => { db = openProviderDatabase(initialized.paths); });
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM provider_secret_cleanup').get().total, 1);
    closeProviderDatabase(db);
    db = null;
    shouldFail = false;
    db = openProviderDatabase(initialized.paths);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM provider_secret_cleanup').get().total, 0);
  } finally {
    providerSecrets.createProviderSecretStore = originalCreate;
    closeProviderDatabase(db);
    cleanup(root);
  }
});

test('system policy reads legacy plaintext credentials but keeps them read-only', () => {
  const root = workspace();
  let db;
  const previous = process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
  try {
    process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = 'plaintext';
    const initialized = initializeStudio({ workspaceRoot: root });
    db = openProviderDatabase(initialized.paths);
    const profile = createProviderProfile(db, { name: 'Legacy Plaintext', providerId: 'openai-images', model: 'gpt-image-2', baseUrl: 'https://provider.example.test/v1', apiKey: 'legacy-plaintext-secret', active: true, idempotencyKey: 'legacy-plaintext' });
    db.prepare('UPDATE provider_profiles SET secret_backend_origin = ? WHERE id = ?').run('legacy', profile.id);
    process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = 'system';
    assert.equal(resolveActiveProviderConfig(db, initialized.paths).apiKey, 'legacy-plaintext-secret');
    assert.throws(() => updateProviderProfile(db, profile.id, { expectedConfigVersion: profile.configVersion, baseUrl: { action: 'keep' }, apiKey: { action: 'keep' }, paths: initialized.paths, idempotencyKey: 'reject-legacy-update' }), /read-only legacy data/);
    assert.equal(db.prepare('SELECT config_version FROM provider_profiles WHERE id = ?').get(profile.id).config_version, profile.configVersion, 'rejected update must be atomic');
    db.prepare('UPDATE provider_profiles SET secret_backend_origin = ? WHERE id = ?').run('explicit', profile.id);
    assert.throws(() => resolveActiveProviderConfig(db, initialized.paths), /Plaintext Provider credentials are disabled/);
  } finally {
    if (previous === undefined) delete process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND;
    else process.env.DAOGE_PIC_PROVIDER_SECRET_BACKEND = previous;
    closeProviderDatabase(db);
    cleanup(root);
  }
});

test('legacy provider.env imports exactly once while new workspaces never create it', () => {
  const root = workspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    assert.equal(fs.existsSync(initialized.paths.providerEnvPath), false);
    fs.writeFileSync(initialized.paths.providerEnvPath, 'IMAGE_PROVIDER=openai-images\nOPENAI_BASE_URL=https://legacy.example.test/v1\nOPENAI_API_KEY=legacy-secret\nOPENAI_MODEL=legacy-model\n', { mode: 0o600 });
    db = openProviderDatabase(initialized.paths);
    assert.equal(importLegacyProviderEnvOnce(db, initialized.paths), true);
    const imported = resolveActiveProviderConfig(db, initialized.paths);
    assert.equal(imported.model, 'legacy-model');
    fs.writeFileSync(initialized.paths.providerEnvPath, 'IMAGE_PROVIDER=openai-images\nOPENAI_BASE_URL=https://changed.example.test/v1\nOPENAI_API_KEY=changed-secret\nOPENAI_MODEL=changed-model\n', { mode: 0o600 });
    assert.equal(importLegacyProviderEnvOnce(db, initialized.paths), false);
    assert.equal(resolveActiveProviderConfig(db, initialized.paths).model, 'legacy-model');
  } finally { closeProviderDatabase(db); cleanup(root); }
});

test('explicit import-env creates a write-only Profile without making provider.env a runtime source', () => {
  const root = workspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    fs.writeFileSync(initialized.paths.providerEnvPath, 'IMAGE_PROVIDER=xai-grok-image\nXAI_IMAGE_BASE_URL=https://explicit.example.test/v1/private\nXAI_IMAGE_API_KEY=explicit-secret\nXAI_IMAGE_MODEL=grok-imagine\n', { mode: 0o600 });
    db = openProviderDatabase(initialized.paths);
    const imported = importProviderEnvProfile(db, initialized.paths, 'explicit-import');
    assert.equal(imported.providerId, 'xai-grok-image');
    assert.equal(imported.active, true);
    assert.equal(JSON.stringify(imported).includes('explicit-secret'), false);
    assert.equal(JSON.stringify(imported).includes('/v1/private'), false);
    assert.equal(importProviderEnvProfile(db, initialized.paths, 'explicit-import').id, imported.id);
    fs.writeFileSync(initialized.paths.providerEnvPath, 'IMAGE_PROVIDER=xai-grok-image\nXAI_IMAGE_BASE_URL=https://changed.example.test/v1\nXAI_IMAGE_API_KEY=changed-secret\nXAI_IMAGE_MODEL=changed-model\n', { mode: 0o600 });
    const repeated = importProviderEnvProfile(db, initialized.paths, 'explicit-import-second');
    assert.equal(repeated.name, imported.name + ' (2)');
    assert.equal(repeated.active, false);
    assert.equal(importProviderEnvProfile(db, initialized.paths, 'explicit-import-second').id, repeated.id);
    assert.equal(listProviderProfiles(db).length, 2);
    assert.equal(resolveActiveProviderConfig(db, initialized.paths).model, 'grok-imagine');
  } finally { closeProviderDatabase(db); cleanup(root); }
});

test('Provider.db rejects symbolic links', { skip: process.platform === 'win32' }, () => {
  const root = workspace();
  const outside = path.join(root, 'outside.db');
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    fs.writeFileSync(outside, 'not sqlite');
    fs.symlinkSync(outside, initialized.paths.providerDatabasePath);
    assert.throws(() => openProviderDatabase(initialized.paths), /symbolic link|real file/);
  } finally { cleanup(root); }
});

test('rejects a future Provider database schema and releases the failed connection', () => {
  const root = workspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    db = openProviderDatabase(initialized.paths);
    db.prepare('INSERT INTO provider_schema (version, applied_at) VALUES (?, ?)').run(999, '2026-09-04T00:00:00.000Z');
    closeProviderDatabase(db);
    db = null;
    assert.throws(() => openProviderDatabase(initialized.paths), /Provider database schema is newer/);
    const DatabaseSync = require('node:sqlite').DatabaseSync;
    db = new DatabaseSync(initialized.paths.providerDatabasePath);
    db.prepare('DELETE FROM provider_schema WHERE version = 999').run();
    closeProviderDatabase(db);
    db = null;
    db = openProviderDatabase(initialized.paths);
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM provider_schema').get().version, 3);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type = 'table' AND name = 'provider_secret_cleanup'").get().total, 1);
  } finally {
    closeProviderDatabase(db);
    cleanup(root);
  }
});
