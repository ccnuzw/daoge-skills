const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { importStudioAsset, softDeleteAsset } = require('../../dist/vnext/domain/assets');
const { StudioAssetResolver } = require('../../dist/vnext/media/asset-resolver');

const skillRoot = path.resolve(__dirname, '../..');
const providerTemplatePath = path.join(skillRoot, 'references', 'provider.env.example');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

test('resolves only active Studio asset IDs for references and masks', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-'));
  const initialized = initializeStudio({ workspaceRoot, providerTemplatePath });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const reference = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png' });
    const mask = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: Buffer.concat([png, Buffer.from('mask')]), mediaType: 'image/png' });
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    const resolved = resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id], maskAssetId: mask.id });
    assert.equal(resolved.referenceAssets.length, 1);
    assert.deepEqual(resolved.referenceAssets[0].bytes, png);
    assert.equal(resolved.maskAsset.assetId, mask.id);
    assert.throws(() => resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: ['/arbitrary/unmanaged.png'] }), /not found/);
    softDeleteAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, assetId: reference.id });
    assert.throws(() => resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id] }), /not found/);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
