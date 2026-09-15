const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBackupManifest } = require('../../dist/vnext/backup/manifest');
const { buildUpgradeRollbackPoint, evaluateUpgradeCompatibility, validateUpgradeRollbackPoint } = require('../../dist/vnext/backup/upgrade');

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-upgrade-')); }
const studio = { studioId: 'upgrade-studio', protocolName: 'daoge-pic-skill-protocol', protocolVersion: '2.0.0', runtimeVersion: '5.13.0' };

test('upgrade compatibility requires a matching path-free rollback point for changes', () => {
  const root = workspace();
  try {
    fs.mkdirSync(path.join(root, 'metadata'), { recursive: true });
    fs.writeFileSync(path.join(root, 'metadata', 'studio.json'), '{}');
    const manifest = createBackupManifest({ workspaceRoot: root, studio, entries: [{ path: 'metadata/studio.json', category: 'metadata' }] });
    const point = buildUpgradeRollbackPoint({ manifest, runtimeVersion: '5.13.0', schemaVersion: 27, createdAt: '2026-09-13T00:00:00.000Z' });
    assert.equal(validateUpgradeRollbackPoint(point), true);
    assert.equal(Object.hasOwn(point, 'workspaceRoot'), false);
    assert.equal(JSON.stringify(point).includes(root), false);
    assert.equal(evaluateUpgradeCompatibility({ currentRuntimeVersion: '5.13.0', targetRuntimeVersion: '5.13.0', currentSchemaVersion: 27, targetSchemaVersion: 27, supportedSchemaVersion: 27, targetProtocolVersion: '2.0.0', rollbackPoint: null }).allowed, true);
    assert.equal(evaluateUpgradeCompatibility({ currentRuntimeVersion: '5.13.0', targetRuntimeVersion: '5.14.1', currentSchemaVersion: 27, targetSchemaVersion: 27, supportedSchemaVersion: 27, targetProtocolVersion: '2.0.0', rollbackPoint: point }).allowed, true);
    assert.equal(evaluateUpgradeCompatibility({ currentRuntimeVersion: '5.13.0', targetRuntimeVersion: '5.14.1', currentSchemaVersion: 27, targetSchemaVersion: 28, supportedSchemaVersion: 28, targetProtocolVersion: '2.0.0', rollbackPoint: null }).issues.some((item) => item.code === 'rollback_missing'), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('upgrade compatibility rejects downgrade, unsupported protocol, future schema, and mismatched checkpoint', () => {
  const common = { currentRuntimeVersion: '5.13.0', targetRuntimeVersion: '5.13.0', currentSchemaVersion: 27, targetSchemaVersion: 26, supportedSchemaVersion: 27, targetProtocolVersion: '3.0.0' };
  const result = evaluateUpgradeCompatibility(common);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.issues.map((item) => item.code), ['schema_downgrade', 'protocol_incompatible', 'rollback_missing']);
  const mismatch = evaluateUpgradeCompatibility({ ...common, targetSchemaVersion: 28, supportedSchemaVersion: 28, targetProtocolVersion: '2.0.0', rollbackPoint: { version: 1, runtimeVersion: '5.12.0', schemaVersion: 26, manifestChecksum: '0'.repeat(64), createdAt: '2026-09-13T00:00:00.000Z' } });
  assert.equal(mismatch.issues.some((item) => item.code === 'rollback_mismatch'), true);
  const future = evaluateUpgradeCompatibility({ ...common, targetSchemaVersion: 29, supportedSchemaVersion: 28, targetProtocolVersion: '2.0.0' });
  assert.equal(future.issues.some((item) => item.code === 'schema_unsupported'), true);
});
