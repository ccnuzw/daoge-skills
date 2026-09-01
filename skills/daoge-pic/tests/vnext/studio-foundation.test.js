const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio, studioPaths, ensureAssetBucket, ensureDeliveriesDirectory, enforceSensitiveAccess } = require('../../dist/vnext/studio/workspace');
const { loadProviderConfig, providerSnapshot, providerStatus } = require('../../dist/vnext/studio/provider-config');
const { getStudioRuntimeSettings, updateStudioRuntimeSettings } = require('../../dist/vnext/studio/runtime-settings');
const { openStudioDatabase, closeStudioDatabase, appendStudioEvent, migrateStudioDatabase, studioSchemaVersion } = require('../../dist/vnext/studio/database');
const { openOrAttachStudioSession, archiveProject, createProject, createTaskDraft, createRoundDraft, prepareRoundForConfirmation, confirmRoundPlan, listRoundPlanVersions, VersionConflictError } = require('../../dist/vnext/domain/studio-commands');
const { stageImage, archiveStagedImage, validateImageBytes, MediaValidationError } = require('../../dist/vnext/media/archive');
const { assertRunTransition, assertRunItemTransition, StateTransitionError } = require('../../dist/vnext/domain/states');
const { searchStudio } = require('../../dist/vnext/domain/queries');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-vnext-'));
}

function cleanup(workspaceRoot) {
  fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

test('initializes a Studio without eagerly creating asset or delivery directories', () => {
  const workspaceRoot = temporaryWorkspace();
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    assert.equal(initialized.createdManifest, true);
    assert.equal(initialized.createdProviderEnv, true);
    assert.ok(fs.existsSync(initialized.paths.studioDir));
    assert.ok(fs.existsSync(initialized.paths.manifestPath));
    assert.ok(fs.existsSync(initialized.paths.providerEnvPath));
    assert.equal(fs.existsSync(initialized.paths.assetRoot), false);
    assert.equal(fs.existsSync(initialized.paths.deliveriesRoot), false);
    assert.match(fs.readFileSync(path.join(workspaceRoot, '.gitignore'), 'utf8'), /daoge-studio\/provider.env/);

    const next = initializeStudio({ workspaceRoot, providerTemplatePath });
    assert.equal(next.createdManifest, false);
    assert.equal(next.createdProviderEnv, false);
    assert.equal(next.manifest.studioId, initialized.manifest.studioId);

    const generatedDir = ensureAssetBucket(next.paths, 'generated');
    assert.ok(fs.existsSync(generatedDir));
    assert.equal(path.dirname(generatedDir), next.paths.assetRoot);
  } finally {
    cleanup(workspaceRoot);
  }
});

test('first initialization with a missing Provider template has zero persistent side effects', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-atomic-parent-'));
  const workspaceRoot = path.join(parent, 'new-workspace');
  try {
    assert.throws(() => initializeStudio({ workspaceRoot, providerTemplatePath: path.join(parent, 'missing-provider.env.example') }), /missing or cannot read/);
    assert.equal(fs.existsSync(workspaceRoot), false);
  } finally {
    cleanup(parent);
  }
});

test('existing manifests must declare the exact resolved workspace root', () => {
  const workspaceRoot = temporaryWorkspace();
  const studioDir = path.join(workspaceRoot, 'daoge-studio');
  fs.mkdirSync(studioDir);
  fs.writeFileSync(path.join(studioDir, 'provider.env'), 'IMAGE_PROVIDER=\n');
  fs.writeFileSync(path.join(studioDir, 'studio.json'), JSON.stringify({ schemaVersion: 1, studioId: 'studio-wrong-root', workspaceRoot: workspaceRoot + '-other', createdAt: new Date().toISOString() }));
  try {
    assert.throws(() => initializeStudio({ workspaceRoot, providerTemplatePath }), /workspaceRoot does not match/);
    assert.equal(fs.existsSync(path.join(studioDir, 'runtime')), false);
    assert.equal(fs.existsSync(path.join(workspaceRoot, '.gitignore')), false);
  } finally {
    cleanup(workspaceRoot);
  }
});

test('initialization keeps provider.env private without overwriting existing credentials', () => {
  const workspaceRoot = temporaryWorkspace();
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(initialized.paths.providerEnvPath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(initialized.paths.studioDir).mode & 0o777, 0o700);
      assert.equal(fs.statSync(initialized.paths.runtimeDir).mode & 0o777, 0o700);
    }

    const existing = 'IMAGE_PROVIDER=openai-images\nOPENAI_API_KEY=existing-secret\n';
    fs.writeFileSync(initialized.paths.providerEnvPath, existing, { mode: 0o666 });
    fs.chmodSync(initialized.paths.providerEnvPath, 0o666);
    fs.chmodSync(initialized.paths.studioDir, 0o755);
    fs.chmodSync(initialized.paths.runtimeDir, 0o755);

    const attached = initializeStudio({ workspaceRoot, providerTemplatePath });
    assert.equal(attached.createdProviderEnv, false);
    assert.equal(fs.readFileSync(attached.paths.providerEnvPath, 'utf8'), existing);
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(attached.paths.providerEnvPath).mode & 0o777, 0o600);
      assert.equal(fs.statSync(attached.paths.studioDir).mode & 0o777, 0o700);
      assert.equal(fs.statSync(attached.paths.runtimeDir).mode & 0o777, 0o700);
    }
  } finally {
    cleanup(workspaceRoot);
  }
});

test('Windows sensitive paths reset explicit Everyone/Users ACEs before removing inheritance and granting only trusted principals', () => {
  const calls = [];
  enforceSensitiveAccess('C:\\workspace with spaces\\provider.env', false, {
    platform: 'win32',
    username: 'DOMAIN\\current-user',
    run: (command, args) => calls.push({ command, args })
  });
  enforceSensitiveAccess('C:\\workspace with spaces\\runtime', true, {
    platform: 'win32',
    username: 'DOMAIN\\current-user',
    run: (command, args) => calls.push({ command, args })
  });
  assert.deepEqual(calls, [
    { command: 'icacls', args: ['C:\\workspace with spaces\\provider.env', '/reset'] },
    { command: 'icacls', args: ['C:\\workspace with spaces\\provider.env', '/inheritance:r'] },
    { command: 'icacls', args: ['C:\\workspace with spaces\\provider.env', '/grant:r', 'DOMAIN\\current-user:F', '*S-1-5-18:F', '*S-1-5-32-544:F'] },
    { command: 'icacls', args: ['C:\\workspace with spaces\\runtime', '/reset'] },
    { command: 'icacls', args: ['C:\\workspace with spaces\\runtime', '/inheritance:r'] },
    { command: 'icacls', args: ['C:\\workspace with spaces\\runtime', '/grant:r', 'DOMAIN\\current-user:(OI)(CI)F', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'] }
  ]);
});

test('Windows sensitive path hardening stops immediately when any ACL step fails', () => {
  const expected = [
    { command: 'icacls', args: ['C:\\workspace\\provider.env', '/reset'] },
    { command: 'icacls', args: ['C:\\workspace\\provider.env', '/inheritance:r'] },
    { command: 'icacls', args: ['C:\\workspace\\provider.env', '/grant:r', 'current-user:F', '*S-1-5-18:F', '*S-1-5-32-544:F'] }
  ];
  for (let failureIndex = 0; failureIndex < expected.length; failureIndex += 1) {
    const calls = [];
    assert.throws(() => enforceSensitiveAccess('C:\\workspace\\provider.env', false, {
      platform: 'win32',
      username: 'current-user',
      run: (command, args) => {
        calls.push({ command, args });
        if (calls.length - 1 === failureIndex) throw new Error('access denied');
      }
    }), /Cannot secure sensitive Studio path with Windows ACLs/);
    assert.deepEqual(calls, expected.slice(0, failureIndex + 1));
  }
});

test('loads provider.env without exposing API keys in the safe status or snapshot', () => {
  const workspaceRoot = temporaryWorkspace();
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    fs.writeFileSync(initialized.paths.providerEnvPath, [
      'IMAGE_PROVIDER=openai-images',
      'OPENAI_BASE_URL=https://images.example.test/v1',
      'OPENAI_API_KEY=secret-value-must-not-escape',
      'OPENAI_MODEL=gpt-image-2'
    ].join('\n') + '\n');

    const config = loadProviderConfig(initialized.paths);
    assert.ok(config);
    assert.equal(config.apiKey, 'secret-value-must-not-escape');
    const status = providerStatus(initialized.paths);
    assert.deepEqual(status, {
      providerId: 'openai-images',
      configured: true,
      missing: [],
      model: 'gpt-image-2',
      endpoint: 'https://images.example.test',
      capabilities: { generate: true, edit: true, referenceImage: true, mask: true }
    });
    assert.equal(Object.prototype.hasOwnProperty.call(config, 'workerConcurrency'), false);
    assert.equal(JSON.stringify(status).includes('secret-value-must-not-escape'), false);
    const snapshot = providerSnapshot(config);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'apiKey'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'workerConcurrency'), false);
    assert.equal(JSON.stringify(snapshot).includes('secret-value-must-not-escape'), false);
    fs.appendFileSync(initialized.paths.providerEnvPath, 'DAOGE_PIC_WORKER_CONCURRENCY=02\n');
    const legacyConcurrency = providerStatus(initialized.paths);
    assert.equal(legacyConcurrency.configured, true);
    assert.deepEqual(legacyConcurrency.missing, []);
  } finally {
    cleanup(workspaceRoot);
  }
});

test('creates the vNext schema and emits monotonic Studio events', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    assert.equal(studioSchemaVersion(db), 17);
    const studio = db.prepare('SELECT id, workspace_root FROM studios WHERE id = ?').get(initialized.manifest.studioId);
    assert.equal(studio.id, initialized.manifest.studioId);
    assert.equal(studio.workspace_root, initialized.paths.workspaceRoot);
    const first = appendStudioEvent(db, { studioId: initialized.manifest.studioId, entityType: 'studio', entityId: initialized.manifest.studioId, eventType: 'studio.initialized' });
    const second = appendStudioEvent(db, { studioId: initialized.manifest.studioId, entityType: 'studio', entityId: initialized.manifest.studioId, eventType: 'studio.checked' });
    assert.equal(second, first + 1);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});


test('stores the workspace concurrency ceiling outside provider.env', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    assert.deepEqual(getStudioRuntimeSettings(db, initialized.manifest.studioId).maxWorkerConcurrency, 30);
    assert.deepEqual(updateStudioRuntimeSettings(db, { studioId: initialized.manifest.studioId, maxWorkerConcurrency: 17 }).maxWorkerConcurrency, 17);
    assert.deepEqual(updateStudioRuntimeSettings(db, { studioId: initialized.manifest.studioId, maxWorkerConcurrency: 30 }).maxWorkerConcurrency, 30);
    assert.throws(() => updateStudioRuntimeSettings(db, { studioId: initialized.manifest.studioId, maxWorkerConcurrency: 31 }), /1 到 30/);
    assert.equal(JSON.stringify(providerStatus(initialized.paths)).includes('workerConcurrency'), false);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});

test('migrates v13 concurrency settings to the release range', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    const DatabaseSync = require('node:sqlite').DatabaseSync;
    db = new DatabaseSync(initialized.paths.databasePath);
    db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE studios (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE deliveries (id TEXT PRIMARY KEY); CREATE TABLE studio_runtime_settings (studio_id TEXT PRIMARY KEY REFERENCES studios(id), max_worker_concurrency INTEGER NOT NULL CHECK (max_worker_concurrency IN (1, 2, 4)), updated_at TEXT NOT NULL);");
    for (let version = 1; version <= 13; version += 1) db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, '2026-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_v13', workspaceRoot, 13, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO studio_runtime_settings (studio_id, max_worker_concurrency, updated_at) VALUES (?, ?, ?)').run('studio_v13', 4, '2026-01-01T00:00:00.000Z');
    migrateStudioDatabase(db);
    assert.equal(db.prepare('SELECT max_worker_concurrency FROM studio_runtime_settings WHERE studio_id = ?').get('studio_v13').max_worker_concurrency, 4);
    db.prepare('UPDATE studio_runtime_settings SET max_worker_concurrency = ? WHERE studio_id = ?').run(30, 'studio_v13');
    assert.equal(db.prepare('SELECT max_worker_concurrency FROM studio_runtime_settings WHERE studio_id = ?').get('studio_v13').max_worker_concurrency, 30);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});

test('migrates v2/v14 receipt storage whether the legacy table is present or missing', () => {
  for (const legacyTablePresent of [false, true]) {
    const workspaceRoot = temporaryWorkspace();
    let db;
    try {
      const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
      const DatabaseSync = require('node:sqlite').DatabaseSync;
      db = new DatabaseSync(initialized.paths.databasePath);
      db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE studios (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE deliveries (id TEXT PRIMARY KEY)');
      for (let version = 1; version <= 14; version += 1) db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_receipt_migration', workspaceRoot, 14, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      if (legacyTablePresent) {
        db.exec('CREATE TABLE command_receipts (idempotency_key TEXT PRIMARY KEY, command_name TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, request_hash TEXT)');
        db.prepare('INSERT INTO command_receipts (idempotency_key, command_name, response_json, created_at, request_hash) VALUES (?, ?, ?, ?, ?)').run('legacy-key', 'legacy.command', '{"ok":true}', '2026-01-01T00:00:00.000Z', 'legacy-hash');
      }
      migrateStudioDatabase(db);
      const columns = db.prepare('PRAGMA table_info(command_receipts)').all().map((column) => column.name);
      assert.deepEqual(columns, ['studio_id', 'idempotency_key', 'command_name', 'request_hash', 'response_json', 'created_at']);
      const migrated = db.prepare('SELECT studio_id, command_name FROM command_receipts WHERE idempotency_key = ?').get('legacy-key');
      assert.deepEqual(migrated ? { studio_id: migrated.studio_id, command_name: migrated.command_name } : null, legacyTablePresent ? { studio_id: 'studio_receipt_migration', command_name: 'legacy.command' } : null);
      const primaryKey = db.prepare('PRAGMA table_info(command_receipts)').all().filter((column) => column.pk > 0).sort((a, b) => a.pk - b.pk).map((column) => column.name);
      assert.deepEqual(primaryKey, ['studio_id', 'idempotency_key']);
    } finally {
      closeStudioDatabase(db);
      cleanup(workspaceRoot);
    }
  }
});

test('migrates v15 media operation identity fields whether the legacy table is present or missing', () => {
  for (const legacyTablePresent of [false, true]) {
    const workspaceRoot = temporaryWorkspace();
    let db;
    try {
      const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
      const DatabaseSync = require('node:sqlite').DatabaseSync;
      db = new DatabaseSync(initialized.paths.databasePath);
      db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE studios (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE deliveries (id TEXT PRIMARY KEY); CREATE TABLE assets (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL, kind TEXT NOT NULL, media_type TEXT NOT NULL, storage_path TEXT NOT NULL, content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL)');
      for (let version = 1; version <= 15; version += 1) db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_v15_media', workspaceRoot, 15, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      if (legacyTablePresent) {
        db.exec("CREATE TABLE asset_media_operations (id TEXT PRIMARY KEY, studio_id TEXT NOT NULL REFERENCES studios(id), asset_id TEXT NOT NULL, operation TEXT NOT NULL CHECK (operation IN ('import', 'trash', 'restore')), source_path TEXT NOT NULL, target_path TEXT NOT NULL, asset_json TEXT, relation_json TEXT, created_at TEXT NOT NULL)");
        db.prepare('INSERT INTO asset_media_operations (id, studio_id, asset_id, operation, source_path, target_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('operation_v15', 'studio_v15_media', 'asset_v15', 'import', 'daoge-studio/cache/staging/source.part', 'daoge-assets/imports/asset_v15.png', '2026-01-01T00:00:00.000Z');
        const trustedHash = 'a'.repeat(64);
        const importMetadata = JSON.stringify({ kind: 'import', mediaType: 'image/png', contentHash: trustedHash, byteSize: 68, source: {} });
        db.prepare('INSERT INTO asset_media_operations (id, studio_id, asset_id, operation, source_path, target_path, asset_json, relation_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('operation_v15_import', 'studio_v15_media', 'asset_v15_import', 'import', 'daoge-studio/cache/staging/import.part', 'daoge-assets/imports/asset_v15_import.png', importMetadata, null, '2026-01-01T00:00:00.000Z');
        db.prepare('INSERT INTO assets (id, studio_id, kind, media_type, storage_path, content_hash, byte_size) VALUES (?, ?, ?, ?, ?, ?, ?)').run('asset_v15_trash', 'studio_v15_media', 'generated', 'image/png', 'daoge-assets/generated/asset_v15_trash.png', trustedHash, 68);
        db.prepare('INSERT INTO asset_media_operations (id, studio_id, asset_id, operation, source_path, target_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('operation_v15_trash', 'studio_v15_media', 'asset_v15_trash', 'trash', 'daoge-assets/generated/asset_v15_trash.png', 'daoge-assets/trash/asset_v15_trash.png', '2026-01-01T00:00:00.000Z');
      }
      migrateStudioDatabase(db);
      const columns = db.prepare('PRAGMA table_info(asset_media_operations)').all().map((column) => column.name);
      assert.deepEqual(columns, ['id', 'studio_id', 'asset_id', 'operation', 'source_path', 'target_path', 'asset_json', 'relation_json', 'created_at', 'expected_hash', 'expected_size', 'expected_media_type', 'phase']);
      assert.equal(studioSchemaVersion(db), 17);
      const migrated = db.prepare('SELECT expected_hash, expected_size, expected_media_type, phase FROM asset_media_operations WHERE id = ?').get('operation_v15');
      assert.deepEqual(migrated ? { ...migrated } : null, legacyTablePresent ? { expected_hash: null, expected_size: null, expected_media_type: null, phase: 'prepared' } : null);
      if (legacyTablePresent) {
        const trusted = db.prepare("SELECT id, expected_hash, expected_size, expected_media_type, phase FROM asset_media_operations WHERE id IN ('operation_v15_import', 'operation_v15_trash') ORDER BY id").all().map((row) => ({ ...row }));
        assert.deepEqual(trusted, [
          { id: 'operation_v15_import', expected_hash: 'a'.repeat(64), expected_size: 68, expected_media_type: 'image/png', phase: 'prepared' },
          { id: 'operation_v15_trash', expected_hash: 'a'.repeat(64), expected_size: 68, expected_media_type: 'image/png', phase: 'prepared' }
        ]);
      }
    } finally {
      closeStudioDatabase(db);
      cleanup(workspaceRoot);
    }
  }
});

test('keeps SQLite FTS search synchronized with project changes', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: 'FTS 检索项目', description: 'Product visual exploration', idempotencyKey: 'fts-project' });
    assert.deepEqual(searchStudio(db, initialized.manifest.studioId, 'visual').map((result) => result.entityId), [project.value.id]);
    db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?').run('FTS 更新项目', 'Updated description', project.value.id);
    assert.equal(searchStudio(db, initialized.manifest.studioId, 'visual').length, 0);
    assert.deepEqual(searchStudio(db, initialized.manifest.studioId, 'Updated').map((result) => result.entityId), [project.value.id]);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});

test('stages, validates, and atomically archives managed image bytes', () => {
  const workspaceRoot = temporaryWorkspace();
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
    const staged = stageImage(initialized.paths, png, 'image/png');
    assert.ok(fs.existsSync(staged.stagingPath));
    assert.equal(fs.existsSync(initialized.paths.assetRoot), false);
    const archived = archiveStagedImage(initialized.paths, staged, { assetId: 'asset_safe_1', bucket: 'generated' });
    assert.ok(fs.existsSync(archived.absolutePath));
    assert.equal(fs.existsSync(staged.stagingPath), false);
    assert.equal(archived.storagePath, 'daoge-assets/generated/asset_safe_1.png');
    assert.equal(archived.contentHash, validateImageBytes(png).contentHash);
    assert.throws(() => validateImageBytes(png, 'image/jpeg'), MediaValidationError);
  } finally {
    cleanup(workspaceRoot);
  }
});

test('rejects symlinked media directory components without touching external paths', { skip: process.platform === 'win32' }, () => {
  const workspaceRoot = temporaryWorkspace();
  const linkedWorkspaceRoot = workspaceRoot + '-linked';
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-media-symlink-outside-'));
  const sentinelPath = path.join(outsideRoot, 'sentinel.txt');
  const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(sentinelPath, 'do not touch');
  try {
    fs.symlinkSync(outsideRoot, linkedWorkspaceRoot);
    assert.throws(() => initializeStudio({ workspaceRoot: linkedWorkspaceRoot, providerTemplatePath }), /symbolic links/);
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'do not touch');
    fs.unlinkSync(linkedWorkspaceRoot);

    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    fs.symlinkSync(outsideRoot, initialized.paths.cacheDir);
    assert.throws(() => stageImage(initialized.paths, imageBytes, 'image/png'), /symbolic links/);
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'do not touch');

    fs.unlinkSync(initialized.paths.cacheDir);
    const staged = stageImage(initialized.paths, imageBytes, 'image/png');
    fs.symlinkSync(outsideRoot, initialized.paths.assetRoot);
    assert.throws(() => archiveStagedImage(initialized.paths, staged, { assetId: 'asset_symlink_root', bucket: 'generated' }), /symbolic links/);
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'do not touch');

    fs.unlinkSync(initialized.paths.assetRoot);
    fs.mkdirSync(initialized.paths.assetRoot);
    fs.symlinkSync(outsideRoot, path.join(initialized.paths.assetRoot, 'generated'));
    assert.throws(() => archiveStagedImage(initialized.paths, staged, { assetId: 'asset_symlink_bucket', bucket: 'generated' }), /symbolic links/);
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'do not touch');

    fs.symlinkSync(outsideRoot, path.join(initialized.paths.assetRoot, 'trash'));
    assert.throws(() => ensureAssetBucket(initialized.paths, 'trash'), /symbolic links/);
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'do not touch');

    fs.symlinkSync(outsideRoot, initialized.paths.deliveriesRoot);
    assert.throws(() => ensureDeliveriesDirectory(initialized.paths), /symbolic links/);
    assert.equal(fs.readFileSync(sentinelPath, 'utf8'), 'do not touch');
  } finally {
    cleanup(workspaceRoot);
    fs.rmSync(linkedWorkspaceRoot, { force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
});

test('persists confirmed creative context with idempotency and optimistic versions', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    const session = openOrAttachStudioSession(db, { studioId: initialized.manifest.studioId, conversationId: 'conversation-1' });
    assert.equal(openOrAttachStudioSession(db, { studioId: initialized.manifest.studioId, conversationId: 'conversation-1' }).id, session.id);

    const createdProject = createProject(db, { studioId: initialized.manifest.studioId, name: '新品发布', sessionId: session.id, idempotencyKey: 'project-1' });
    const replayedProject = createProject(db, { studioId: initialized.manifest.studioId, name: '新品发布', sessionId: session.id, idempotencyKey: 'project-1' });
    assert.equal(createdProject.replayed, false);
    assert.equal(replayedProject.replayed, true);
    assert.equal(replayedProject.value.id, createdProject.value.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM projects').get().total, 1);
    assert.throws(() => createProject(db, { studioId: initialized.manifest.studioId, name: '不应创建', idempotencyKey: 'project-1' }), /Idempotency key/);

    const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: createdProject.value.id, name: '产品主视觉', intent: { format: 'landscape' }, sessionId: session.id, idempotencyKey: 'task-1' });
    const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.value.id, purpose: 'exploration', sessionId: session.id, idempotencyKey: 'round-1' });
    const context = db.prepare('SELECT active_project_id, active_task_id, active_round_id FROM studio_sessions WHERE id = ?').get(session.id);
    assert.equal(context.active_project_id, createdProject.value.id);
    assert.equal(context.active_task_id, task.value.id);
    assert.equal(context.active_round_id, round.value.id);
    const prepared = prepareRoundForConfirmation(db, { studioId: initialized.manifest.studioId, roundId: round.value.id, plan: { prompt: 'clean product image' }, expectedVersion: round.value.version, idempotencyKey: 'prepare-1' });
    assert.equal(prepared.value.status, 'awaiting_confirmation');
    assert.equal(prepared.value.planVersion, 2);
    assert.throws(() => confirmRoundPlan(db, { studioId: initialized.manifest.studioId, roundId: round.value.id, expectedVersion: 1, idempotencyKey: 'confirm-conflict' }), VersionConflictError);
    const confirmed = confirmRoundPlan(db, { studioId: initialized.manifest.studioId, roundId: round.value.id, expectedVersion: prepared.value.version, idempotencyKey: 'confirm-1' });
    assert.equal(confirmed.value.status, 'active');
    assert.equal(confirmed.value.version, 3);
    const versions = listRoundPlanVersions(db, initialized.manifest.studioId, round.value.id);
    assert.deepEqual(versions.map((version) => [version.planVersion, version.state]), [[2, 'confirmed'], [1, 'draft']]);
    assert.equal(versions[0].plan.prompt, 'clean product image');
    const eventTypes = db.prepare('SELECT event_type FROM events ORDER BY id').all().map((row) => row.event_type);
    assert.deepEqual(eventTypes, ['session.attached', 'session.context_updated', 'project.created', 'session.context_updated', 'task.draft_created', 'session.context_updated', 'round.draft_created', 'round.awaiting_confirmation', 'round.confirmed']);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});


test('archives a project and its creative context only after unfinished runs are absent', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    db = openStudioDatabase(initialized.paths, initialized.manifest);
    const project = createProject(db, { studioId: initialized.manifest.studioId, name: '归档项目', idempotencyKey: 'archive-project' });
    const task = createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.value.id, name: '归档任务', idempotencyKey: 'archive-task' });
    const round = createRoundDraft(db, { studioId: initialized.manifest.studioId, taskId: task.value.id, purpose: 'exploration', idempotencyKey: 'archive-round' });
    const now = new Date().toISOString();
    db.prepare('INSERT INTO generation_runs (id, round_id, status, provider_snapshot_json, plan_snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('run_archive_guard', round.value.id, 'queued', '{}', '{}', now, now);
    assert.throws(() => archiveProject(db, { studioId: initialized.manifest.studioId, projectId: project.value.id, idempotencyKey: 'archive-while-queued' }), /unfinished/);
    db.prepare("UPDATE generation_runs SET status = 'paused' WHERE id = ?").run('run_archive_guard');
    const archived = archiveProject(db, { studioId: initialized.manifest.studioId, projectId: project.value.id, idempotencyKey: 'archive-command' });
    assert.equal(archived.value.status, 'archived');
    assert.equal(db.prepare('SELECT status FROM creative_tasks WHERE id = ?').get(task.value.id).status, 'archived');
    assert.equal(db.prepare('SELECT status FROM creative_rounds WHERE id = ?').get(round.value.id).status, 'archived');
    assert.throws(() => createTaskDraft(db, { studioId: initialized.manifest.studioId, projectId: project.value.id, name: '不应创建', idempotencyKey: 'archived-task' }), /archived/);
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});

test('enforces vNext run and run item transition contracts', () => {
  assert.doesNotThrow(() => assertRunTransition('draft', 'awaiting_confirmation'));
  assert.doesNotThrow(() => assertRunTransition('resume_pending', 'queued'));
  assert.doesNotThrow(() => assertRunItemTransition('requesting', 'outcome_unknown'));
  assert.doesNotThrow(() => assertRunItemTransition('outcome_unknown', 'failed'));
  assert.throws(() => assertRunTransition('completed', 'queued'), StateTransitionError);
  assert.throws(() => assertRunItemTransition('succeeded', 'pending'), StateTransitionError);
});

test('migrates v16 journals and task types without assigning ambiguous user data across Studios', () => {
  for (const studioCount of [1, 2]) {
    const workspaceRoot = temporaryWorkspace();
    let db;
    try {
      const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
      const DatabaseSync = require('node:sqlite').DatabaseSync;
      db = new DatabaseSync(initialized.paths.databasePath);
      db.exec("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE studios (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE deliveries (id TEXT PRIMARY KEY); CREATE TABLE delivery_export_journal (idempotency_key TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES deliveries(id), studio_id TEXT NOT NULL REFERENCES studios(id), directory_path TEXT NOT NULL, manifest_json TEXT NOT NULL, files_json TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE task_types (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, definition_json TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('official', 'user')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
      for (let version = 1; version <= 16; version += 1) db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_migration_a', workspaceRoot, 16, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      if (studioCount === 2) db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('studio_migration_b', workspaceRoot + '-second', 16, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO deliveries (id) VALUES (?)').run('delivery_migration_a');
      db.prepare('INSERT INTO delivery_export_journal (idempotency_key, delivery_id, studio_id, directory_path, manifest_json, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('legacy-export-key', 'delivery_migration_a', 'studio_migration_a', 'daoge-deliveries/legacy', '{}', '[]', '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO task_types (id, name, definition_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('official_migration_type', '旧官方类型', '{}', 'official', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      db.prepare('INSERT INTO task_types (id, name, definition_json, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('user_migration_type', '旧用户类型', '{}', 'user', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      migrateStudioDatabase(db);
      assert.equal(studioSchemaVersion(db), 17);
      const journalPrimaryKey = db.prepare('PRAGMA table_info(delivery_export_journal)').all().filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name);
      assert.deepEqual(journalPrimaryKey, ['studio_id', 'idempotency_key']);
      const migratedJournal = db.prepare('SELECT studio_id, delivery_id FROM delivery_export_journal WHERE idempotency_key = ?').get('legacy-export-key');
      assert.deepEqual(migratedJournal ? { ...migratedJournal } : null, { studio_id: 'studio_migration_a', delivery_id: 'delivery_migration_a' });
      const migratedOfficial = db.prepare('SELECT studio_id FROM task_types WHERE id = ?').get('official_migration_type');
      assert.deepEqual(migratedOfficial ? { ...migratedOfficial } : null, { studio_id: null });
      const migratedUser = db.prepare('SELECT studio_id FROM task_types WHERE id = ?').get('user_migration_type');
      assert.deepEqual(migratedUser ? { ...migratedUser } : null, studioCount === 1 ? { studio_id: 'studio_migration_a' } : null);
      const quarantinedUser = db.prepare('SELECT reason FROM task_type_migration_quarantine WHERE id = ?').get('user_migration_type');
      assert.deepEqual(quarantinedUser ? { ...quarantinedUser } : null, studioCount === 2 ? { reason: 'ambiguous_studio_scope' } : null);
    } finally {
      closeStudioDatabase(db);
      cleanup(workspaceRoot);
    }
  }
});

test('quarantines v14 command receipts when more than one Studio exists during v15 migration', () => {
  const workspaceRoot = temporaryWorkspace();
  let db;
  try {
    const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
    const DatabaseSync = require('node:sqlite').DatabaseSync;
    db = new DatabaseSync(initialized.paths.databasePath);
    db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE studios (id TEXT PRIMARY KEY, workspace_root TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE deliveries (id TEXT PRIMARY KEY); CREATE TABLE command_receipts (idempotency_key TEXT PRIMARY KEY, command_name TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, request_hash TEXT)');
    for (let version = 1; version <= 14; version += 1) db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, '2026-01-01T00:00:00.000Z');
    for (const [id, root] of [['studio_receipt_a', workspaceRoot], ['studio_receipt_b', workspaceRoot + '-second']]) db.prepare('INSERT INTO studios (id, workspace_root, schema_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, root, 14, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    db.prepare('INSERT INTO command_receipts (idempotency_key, command_name, response_json, created_at, request_hash) VALUES (?, ?, ?, ?, ?)').run('ambiguous-receipt', 'legacy.command', '{"ok":true}', '2026-01-01T00:00:00.000Z', 'legacy-hash');
    migrateStudioDatabase(db);
    assert.equal(db.prepare('SELECT COUNT(*) AS total FROM command_receipts WHERE idempotency_key = ?').get('ambiguous-receipt').total, 0);
    const quarantinedReceipt = db.prepare('SELECT reason FROM command_receipt_migration_quarantine WHERE idempotency_key = ?').get('ambiguous-receipt');
    assert.deepEqual(quarantinedReceipt ? { ...quarantinedReceipt } : null, { reason: 'ambiguous_studio_scope' });
  } finally {
    closeStudioDatabase(db);
    cleanup(workspaceRoot);
  }
});
