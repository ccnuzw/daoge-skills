const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { assetFilePath, importStudioAsset, softDeleteAsset } = require('../../dist/vnext/domain/assets');
const { StudioAssetResolver } = require('../../dist/vnext/media/asset-resolver');
const { MAX_IMAGE_REQUEST_MEDIA_BYTES, MAX_IMAGE_REQUEST_REFERENCE_ASSETS } = require('../../dist/vnext/providers/contracts');



const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

function largePng(fill = 0x41) {
  return Buffer.concat([png, Buffer.alloc(192 * 1024 - png.length, fill)]);
}

function sameSizeReplacement(bytes, fill = 0x42) {
  return Buffer.concat([bytes.subarray(0, 16), Buffer.alloc(bytes.length - 16, fill)]);
}

function trackSnapshotDescriptors(paths) {
  const directory = path.join(paths.cacheDir, 'staging');
  const originalOpenSync = fs.openSync;
  const originalCloseSync = fs.closeSync;
  const openDescriptors = new Set();
  fs.openSync = function (filePath, ...args) {
    const descriptor = originalOpenSync.call(fs, filePath, ...args);
    if (typeof filePath === 'string' && path.dirname(filePath) === directory && filePath.endsWith('.part')) openDescriptors.add(descriptor);
    return descriptor;
  };
  fs.closeSync = function (descriptor, ...args) {
    try { return originalCloseSync.call(fs, descriptor, ...args); }
    finally { openDescriptors.delete(descriptor); }
  };
  return {
    assertClean() {
      assert.equal(openDescriptors.size, 0, 'verified snapshot descriptors must be closed');
      assert.deepEqual(fs.readdirSync(directory), [], 'verified snapshot files must be unlinked');
    },
    restore() {
      fs.openSync = originalOpenSync;
      fs.closeSync = originalCloseSync;
    }
  };
}

function mutateAfterAsyncRead(filePath, mutate) {
  const originalOpen = fs.promises.open;
  let mutated = false;
  fs.promises.open = async function (openedPath, ...args) {
    const handle = await originalOpen.call(fs.promises, openedPath, ...args);
    if (openedPath === filePath && (args[0] & fs.constants.O_ACCMODE) === fs.constants.O_RDONLY) {
      const read = handle.read.bind(handle);
      handle.read = async function (...readArgs) {
        const result = await read(...readArgs);
        if (!mutated && result.bytesRead && readArgs[3] === 0) {
          mutated = true;
          mutate();
        }
        return result;
      };
    }
    return handle;
  };
  return { get mutated() { return mutated; }, restore() { fs.promises.open = originalOpen; } };
}

test('resolves only active Studio asset IDs for references and masks', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const reference = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png' });
    const mask = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: Buffer.concat([png, Buffer.from('mask')]), mediaType: 'image/png' });
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    const resolved = await resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id], maskAssetId: mask.id });
    assert.equal(resolved.assets.referenceAssets.length, 1);
    assert.deepEqual(resolved.assets.referenceAssets[0].bytes, png);
    assert.equal(resolved.assets.maskAsset.assetId, mask.id);
    resolved.release();
    await assert.rejects(resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: ['/arbitrary/unmanaged.png'] }), /not found/);
    softDeleteAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, assetId: reference.id });
    await assert.rejects(resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id] }), /not found/);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects reference count and aggregate media limits before allocating snapshots', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-limits-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    await assert.rejects(resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: Array.from({ length: MAX_IMAGE_REQUEST_REFERENCE_ASSETS + 1 }, (_, index) => 'asset-' + index) }), /最多支持/);
    const reference = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png' });
    db.prepare('UPDATE assets SET byte_size = ? WHERE id = ?').run(MAX_IMAGE_REQUEST_MEDIA_BYTES + 1, reference.id);
    await assert.rejects(resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id] }), /合计不能超过/);
    assert.deepEqual(fs.readdirSync(path.join(initialized.paths.cacheDir, 'staging')), []);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('returns verified reference and mask bytes and cleans async snapshots', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-frozen-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  try {
    const referenceBytes = largePng(0x31);
    const maskBytes = largePng(0x32);
    const reference = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: referenceBytes, mediaType: 'image/png' });
    const mask = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: maskBytes, mediaType: 'image/png' });
    const resolved = await new StudioAssetResolver({ db, paths: initialized.paths }).resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id], maskAssetId: mask.id });
    assert.deepEqual(resolved.assets.referenceAssets[0].bytes, referenceBytes);
    assert.deepEqual(resolved.assets.maskAsset.bytes, maskBytes);
    resolved.release();
    assert.deepEqual(fs.readdirSync(path.join(initialized.paths.cacheDir, 'staging')), []);
  } finally {
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a same-size reference replacement before snapshotting and leaves no snapshot behind', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-replaced-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  let tracker;
  try {
    const original = largePng();
    const reference = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: original, mediaType: 'image/png' });
    fs.writeFileSync(assetFilePath(initialized.paths, reference), sameSizeReplacement(original));
    tracker = trackSnapshotDescriptors(initialized.paths);
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    await assert.rejects(resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id] }), /hash|identity|changed/);
    assert.deepEqual(fs.readdirSync(path.join(initialized.paths.cacheDir, 'staging')), []);
  } finally {
    if (tracker) tracker.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects an in-place mask mutation during snapshotting and closes partial snapshots', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-mask-mutation-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  let mutation;
  try {
    const original = largePng();
    const mask = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: original, mediaType: 'image/png' });
    const filePath = assetFilePath(initialized.paths, mask);
    mutation = mutateAfterAsyncRead(filePath, () => fs.writeFileSync(filePath, sameSizeReplacement(original)));
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    await assert.rejects(resolver.resolve({ studioId: initialized.manifest.studioId, maskAssetId: mask.id }), /hash|identity|changed/);
    assert.equal(mutation.mutated, true);
    assert.deepEqual(fs.readdirSync(path.join(initialized.paths.cacheDir, 'staging')), []);
  } finally {
    if (mutation) mutation.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a reference path rename during snapshotting and closes partial snapshots', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-path-race-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  let mutation;
  try {
    const original = largePng();
    const reference = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: original, mediaType: 'image/png' });
    const filePath = assetFilePath(initialized.paths, reference);
    mutation = mutateAfterAsyncRead(filePath, () => {
      fs.renameSync(filePath, filePath + '.verified');
      fs.writeFileSync(filePath, sameSizeReplacement(original));
    });
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    await assert.rejects(resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id] }), /path|changed/);
    assert.equal(mutation.mutated, true);
    assert.deepEqual(fs.readdirSync(path.join(initialized.paths.cacheDir, 'staging')), []);
  } finally {
    if (mutation) mutation.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a managed mask path replaced by a symlink', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-symlink-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  let tracker;
  try {
    const mask = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: png, mediaType: 'image/png' });
    const filePath = assetFilePath(initialized.paths, mask);
    fs.renameSync(filePath, filePath + '.verified');
    fs.symlinkSync(filePath + '.verified', filePath);
    tracker = trackSnapshotDescriptors(initialized.paths);
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    await assert.rejects(resolver.resolve({ studioId: initialized.manifest.studioId, maskAssetId: mask.id }), /symbolic|regular file|symlink/);
    assert.deepEqual(fs.readdirSync(path.join(initialized.paths.cacheDir, 'staging')), []);
  } finally {
    if (tracker) tracker.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
