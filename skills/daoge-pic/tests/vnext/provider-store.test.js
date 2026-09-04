const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { openStudioDatabase, closeStudioDatabase } = require('../../dist/vnext/studio/database');
const { openProviderDatabase, closeProviderDatabase, importLegacyProviderEnvOnce, importProviderEnvProfile, createProviderProfile, updateProviderProfile, copyProviderProfile, activateProviderProfile, deleteProviderProfile, listProviderProfiles, resolveActiveProviderConfig, providerStatus } = require('../../dist/vnext/studio/provider-store');




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
    const second = create(providerDb, 'provider-second', 'Secondary', false);
    assert.equal(first.active, true);
    assert.equal(first.referenceEnabled, true);
    assert.equal(JSON.stringify(listProviderProfiles(providerDb)).includes('secret-provider-first'), false);
    assert.equal(JSON.stringify(listProviderProfiles(providerDb)).includes('/v1/full/path'), false);
    const copied = copyProviderProfile(providerDb, first.id, { name: 'Primary Copy', idempotencyKey: 'provider-copy' });
    assert.equal(copied.active, false);
    activateProviderProfile(providerDb, second.id, 'provider-activate');
    assert.equal(listProviderProfiles(providerDb).filter((profile) => profile.active).length, 1);
    assert.equal(resolveActiveProviderConfig(providerDb).profileId, second.id);
    const selected = listProviderProfiles(providerDb).find((profile) => profile.id === second.id);
    const updated = updateProviderProfile(providerDb, second.id, { expectedConfigVersion: selected.configVersion, baseUrl: { action: 'clear' }, apiKey: { action: 'replace', value: 'replacement-secret' }, options: { referenceEnabled: false }, idempotencyKey: 'provider-update' });
    assert.equal(updated.endpointSummary, null);
    assert.equal(updated.referenceEnabled, false);
    assert.equal(providerStatus(providerDb).configured, false);
    assert.equal(JSON.stringify(updated).includes('replacement-secret'), false);
    const reenabled = updateProviderProfile(providerDb, second.id, { expectedConfigVersion: updated.configVersion, baseUrl: { action: 'keep' }, apiKey: { action: 'keep' }, options: { referenceEnabled: true }, idempotencyKey: 'provider-reenable' });
    assert.equal(reenabled.referenceEnabled, true);
    assert.equal(listProviderProfiles(providerDb).find((profile) => profile.id === second.id).referenceEnabled, true);
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

test('legacy provider.env imports exactly once while new workspaces never create it', () => {
  const root = workspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot: root });
    assert.equal(fs.existsSync(initialized.paths.providerEnvPath), false);
    fs.writeFileSync(initialized.paths.providerEnvPath, 'IMAGE_PROVIDER=openai-images\nOPENAI_BASE_URL=https://legacy.example.test/v1\nOPENAI_API_KEY=legacy-secret\nOPENAI_MODEL=legacy-model\n', { mode: 0o600 });
    db = openProviderDatabase(initialized.paths);
    assert.equal(importLegacyProviderEnvOnce(db, initialized.paths), true);
    const imported = resolveActiveProviderConfig(db);
    assert.equal(imported.model, 'legacy-model');
    fs.writeFileSync(initialized.paths.providerEnvPath, 'IMAGE_PROVIDER=openai-images\nOPENAI_BASE_URL=https://changed.example.test/v1\nOPENAI_API_KEY=changed-secret\nOPENAI_MODEL=changed-model\n', { mode: 0o600 });
    assert.equal(importLegacyProviderEnvOnce(db, initialized.paths), false);
    assert.equal(resolveActiveProviderConfig(db).model, 'legacy-model');
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
    assert.equal(resolveActiveProviderConfig(db).model, 'grok-imagine');
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
    assert.equal(db.prepare('SELECT MAX(version) AS version FROM provider_schema').get().version, 1);
  } finally {
    closeProviderDatabase(db);
    cleanup(root);
  }
});
