const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBackupManifest } = require('../../dist/vnext/backup/manifest');
const { createRestoreDryRun } = require('../../dist/vnext/backup/restore');

const studio = {
  studioId: 'studio_restore_fixture',
  protocolName: 'daoge-pic-skill-protocol',
  protocolVersion: '2.0.0',
  runtimeVersion: '5.13.0'
};

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-restore-dry-run-'));
}
function put(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function allStrings(value) {
  return JSON.stringify(value);
}

test('restore dry-run computes create/replace/unchanged operations without writing', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'metadata/studio.json', '{"schemaVersion":1}');
    put(source, 'media/a.bin', 'source-a');
    put(source, 'media/b.bin', 'source-b');
    put(target, 'metadata/studio.json', '{"schemaVersion":1}');
    put(target, 'media/a.bin', 'old-a');
    const before = fs.readFileSync(path.join(target, 'media/a.bin'), 'utf8');
    const manifest = createBackupManifest({ workspaceRoot: source, studio, entries: [
      { path: 'media/b.bin', category: 'media' },
      { path: 'metadata/studio.json', category: 'metadata' },
      { path: 'media/a.bin', category: 'media' }
    ] });

    const result = createRestoreDryRun({ sourceRoot: source, targetRoot: target, manifest, studio });
    assert.equal(result.ready, true);
    assert.deepEqual(result.operations.map((item) => [item.path, item.action]), [
      ['media/a.bin', 'replace'],
      ['media/b.bin', 'create'],
      ['metadata/studio.json', 'unchanged']
    ]);
    assert.equal(result.operations.find((item) => item.path === 'media/b.bin').parentDirectoriesMissing, 0);
    assert.equal(fs.readFileSync(path.join(target, 'media/a.bin'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(target, 'media/b.bin')), false);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('restore dry-run fails closed for source drift and target symlink', () => {
  const source = workspace();
  const target = workspace();
  const outside = workspace();
  try {
    put(source, 'media/a.bin', 'source-a');
    put(target, 'media/a.bin', 'target-a');
    put(outside, 'outside.bin', 'outside');
    const manifest = createBackupManifest({ workspaceRoot: source, studio, entries: [{ path: 'media/a.bin', category: 'media' }] });
    put(source, 'media/a.bin', 'drifted');
    const drifted = createRestoreDryRun({ sourceRoot: source, targetRoot: target, manifest, studio });
    assert.equal(drifted.ready, false);
    assert.ok(drifted.issues.some((item) => item.code === 'source_manifest' && item.path === 'media/a.bin'));

    fs.writeFileSync(path.join(source, 'media/a.bin'), 'source-a');
    fs.rmSync(path.join(target, 'media/a.bin'));
    fs.symlinkSync(path.join(outside, 'outside.bin'), path.join(target, 'media/a.bin'));
    const symlinked = createRestoreDryRun({ sourceRoot: source, targetRoot: target, manifest, studio });
    assert.equal(symlinked.ready, false);
    assert.ok(symlinked.issues.some((item) => item.code === 'target_symbolic_link' && item.path === 'media/a.bin'));
    assert.equal(allStrings(symlinked).includes(source), false);
    assert.equal(allStrings(symlinked).includes(target), false);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('restore dry-run does not plan malformed or sensitive manifest paths', () => {
  const source = workspace();
  const target = workspace();
  try {
    put(source, 'metadata/studio.json', '{}');
    const result = createRestoreDryRun({
      sourceRoot: source,
      targetRoot: target,
      studio,
      manifest: {
        schemaVersion: 1,
        studio: { studioId: studio.studioId, protocol: { name: studio.protocolName, version: studio.protocolVersion }, runtimeVersion: studio.runtimeVersion },
        entries: [{ path: '../outside', category: 'metadata', required: true, byteSize: 1, sha256: '0'.repeat(64) }, { path: 'daoge-studio/Provider.db', category: 'database', required: true, byteSize: 1, sha256: '0'.repeat(64) }]
      }
    });
    assert.equal(result.ready, false);
    assert.equal(result.operations.length, 0);
    assert.ok(result.issues.some((item) => item.code === 'source_manifest'));
    assert.equal(allStrings(result).includes(source), false);
    assert.equal(allStrings(result).includes(target), false);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});
