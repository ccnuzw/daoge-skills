const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BACKUP_MANIFEST_SCHEMA_VERSION,
  backupManifestChecksum,
  createBackupManifest,
  serializeBackupManifest,
  snapshotBackupFile,
  validateBackupManifest
} = require('../../dist/vnext/backup/manifest');

function temporaryWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-backup-manifest-'));
}

const studio = {
  studioId: 'studio_backup_fixture',
  protocolName: 'daoge-pic-skill-protocol',
  protocolVersion: '2.0.0',
  runtimeVersion: '5.13.0'
};

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

test('backup manifest sorts paths and excludes mtime from identity', () => {
  const root = temporaryWorkspace();
  try {
    writeFile(root, 'media/z.bin', 'same bytes');
    writeFile(root, 'metadata/studio.json', '{"safe":true}');
    const entries = [
      { path: 'media/z.bin', category: 'media', required: true },
      { path: 'metadata/studio.json', category: 'metadata', required: true }
    ];
    const first = createBackupManifest({ workspaceRoot: root, studio, entries });
    assert.equal(first.schemaVersion, BACKUP_MANIFEST_SCHEMA_VERSION);
    assert.deepEqual(first.entries.map((entry) => entry.path), ['media/z.bin', 'metadata/studio.json']);
    assert.equal(Object.hasOwn(first.entries[0], 'mtimeMs'), false);

    const oldTime = new Date('2020-01-01T00:00:00.000Z');
    fs.utimesSync(path.join(root, 'media/z.bin'), oldTime, oldTime);
    const second = createBackupManifest(root, studio, [...entries].reverse());
    assert.deepEqual(first, second);
    assert.equal(backupManifestChecksum(first), backupManifestChecksum(second));
    assert.equal(serializeBackupManifest(first), serializeBackupManifest(second));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backup manifest rejects traversal, absolute, symlink, directory, and sensitive entries', () => {
  const root = temporaryWorkspace();
  const outside = temporaryWorkspace();
  try {
    writeFile(root, 'safe.txt', 'safe');
    writeFile(root, 'secret.txt', 'do not include');
    fs.mkdirSync(path.join(root, 'directory'));
    fs.symlinkSync(path.join(outside, 'outside.txt'), path.join(root, 'linked.txt'));
    const make = (entry) => createBackupManifest({ workspaceRoot: root, studio, entries: [entry] });
    assert.throws(() => make({ path: '../outside.txt', category: 'reference' }), /relative|traverse/i);
    assert.throws(() => make({ path: path.join(root, 'safe.txt'), category: 'reference' }), /relative|workspace/i);
    assert.throws(() => make({ path: 'linked.txt', category: 'reference' }), /symbolic|link/i);
    assert.throws(() => make({ path: 'directory', category: 'reference' }), /regular|file/i);
    assert.throws(() => make({ path: 'safe.txt', category: 'secret' }), /category|supported/i);
    assert.throws(() => make({ path: 'secret.txt', category: 'reference' }), /sensitive/i);
    assert.throws(() => make({ path: 'daoge-studio/provider.env', category: 'reference' }), /sensitive/i);
    assert.throws(() => make({ path: 'daoge-studio/Provider.db', category: 'database' }), /sensitive/i);
    assert.throws(() => createBackupManifest({ workspaceRoot: root, studio, entries: [{ path: 'safe.txt', category: 'reference' }, { path: 'safe.txt', category: 'reference' }] }), /duplicate/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('validation detects same-size replacement with a safe relative mismatch', () => {
  const root = temporaryWorkspace();
  try {
    writeFile(root, 'media/image.bin', 'AAAA');
    const manifest = createBackupManifest({ workspaceRoot: root, studio, entries: [{ path: 'media/image.bin', category: 'media' }] });
    writeFile(root, 'media/image.bin', 'BBBB');
    const result = validateBackupManifest({ workspaceRoot: root, manifest, studio });
    assert.equal(result.valid, false);
    assert.ok(result.mismatches.some((item) => item.code === 'hash' && item.path === 'media/image.bin'));
    assert.ok(result.mismatches.every((item) => !item.path || !path.isAbsolute(item.path)));
    assert.ok(!JSON.stringify(result).includes(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('manifest stores only safe references and never file contents or credentials', () => {
  const root = temporaryWorkspace();
  try {
    writeFile(root, 'daoge-studio/provider-profile.json', '{"apiKey":"sk-secret-value","endpoint":"https://provider.example.test"}');
    const manifest = createBackupManifest({
      workspaceRoot: root,
      studio,
      filesByCategory: { reference: ['daoge-studio/provider-profile.json'] }
    });
    const serialized = serializeBackupManifest(manifest);
    assert.match(serialized, /provider-profile\.json/);
    assert.doesNotMatch(serialized, /sk-secret-value|provider\.example\.test|apiKey/);
    assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a supplied snapshot is honoured instead of re-reading the file', () => {
  const root = temporaryWorkspace();
  try {
    writeFile(root, 'media/big.bin', 'actual bytes on disk');
    const observed = snapshotBackupFile(root, 'media/big.bin');
    assert.equal(observed.byteSize, 'actual bytes on disk'.length);
    assert.match(observed.sha256, /^[a-f0-9]{64}$/);

    const reused = createBackupManifest({
      workspaceRoot: root,
      studio,
      entries: [{ path: 'media/big.bin', category: 'media', required: true, snapshot: observed }]
    });
    assert.equal(reused.entries[0].sha256, observed.sha256);
    assert.equal(reused.entries[0].byteSize, observed.byteSize);

    const asserted = { byteSize: 7, sha256: '1'.repeat(64) };
    const substituted = createBackupManifest({
      workspaceRoot: root,
      studio,
      entries: [{ path: 'media/big.bin', category: 'media', required: true, snapshot: asserted }]
    });
    assert.equal(substituted.entries[0].sha256, asserted.sha256);
    assert.equal(substituted.entries[0].byteSize, 7);

    for (const snapshot of [{ byteSize: -1, sha256: '1'.repeat(64) }, { byteSize: 3, sha256: 'not-a-hash' }, 'nope']) {
      assert.throws(() => createBackupManifest({
        workspaceRoot: root,
        studio,
        entries: [{ path: 'media/big.bin', category: 'media', required: true, snapshot }]
      }), /snapshot/);
    }

    assert.equal(snapshotBackupFile(root, 'media/missing.bin'), null);
    assert.throws(() => snapshotBackupFile(root, '../escape.bin'), /relative|path|escape/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
