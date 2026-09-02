const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { closeStudioDatabase, openStudioDatabase } = require('../../dist/vnext/studio/database');
const { assetFilePath, importStudioAsset, softDeleteAsset } = require('../../dist/vnext/domain/assets');
const { StudioAssetResolver } = require('../../dist/vnext/media/asset-resolver');



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

test('resolves only active Studio asset IDs for references and masks', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-'));
  const initialized = initializeStudio({ workspaceRoot });
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

test('returns frozen reference and mask bytes after their live paths are replaced and closes every snapshot', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-frozen-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const originalReadSync = fs.readSync;
  let tracker;
  try {
    const referenceBytes = largePng(0x31);
    const maskBytes = largePng(0x32);
    const reference = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: referenceBytes, mediaType: 'image/png' });
    const mask = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: maskBytes, mediaType: 'image/png' });
    const swaps = [reference, mask].map((asset, index) => {
      const filePath = assetFilePath(initialized.paths, asset);
      return { filePath, identity: fs.statSync(filePath), replacement: sameSizeReplacement(index ? maskBytes : referenceBytes, 0x51 + index), swapped: false };
    });
    let activeSwap = 0;
    fs.readSync = function (...args) {
      const target = swaps[activeSwap];
      if (target && args[4] === 0) {
        const opened = fs.fstatSync(args[0]);
        if (opened.dev !== target.identity.dev || opened.ino !== target.identity.ino) {
          fs.renameSync(target.filePath, target.filePath + '.verified');
          fs.writeFileSync(target.filePath, target.replacement);
          target.swapped = true;
          activeSwap += 1;
        }
      }
      return originalReadSync.apply(fs, args);
    };
    tracker = trackSnapshotDescriptors(initialized.paths);
    const resolved = new StudioAssetResolver({ db, paths: initialized.paths }).resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id], maskAssetId: mask.id });
    assert.deepEqual(resolved.referenceAssets[0].bytes, referenceBytes);
    assert.deepEqual(resolved.maskAsset.bytes, maskBytes);
    assert.deepEqual(swaps.map((entry) => entry.swapped), [true, true]);
    tracker.assertClean();
  } finally {
    fs.readSync = originalReadSync;
    if (tracker) tracker.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a same-size reference replacement before snapshotting and leaves no snapshot behind', () => {
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
    assert.throws(() => resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id] }), /hash|identity|changed/);
    tracker.assertClean();
  } finally {
    if (tracker) tracker.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects an in-place mask mutation during snapshotting and closes partial snapshots', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-mask-mutation-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const originalReadSync = fs.readSync;
  let tracker;
  try {
    const original = largePng();
    const mask = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: original, mediaType: 'image/png' });
    const filePath = assetFilePath(initialized.paths, mask);
    const identity = fs.statSync(filePath);
    let mutated = false;
    fs.readSync = function (...args) {
      const read = originalReadSync.apply(fs, args);
      const opened = fs.fstatSync(args[0]);
      if (!mutated && args[4] === 0 && opened.dev === identity.dev && opened.ino === identity.ino) {
        mutated = true;
        fs.writeFileSync(filePath, sameSizeReplacement(original));
      }
      return read;
    };
    tracker = trackSnapshotDescriptors(initialized.paths);
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    assert.throws(() => resolver.resolve({ studioId: initialized.manifest.studioId, maskAssetId: mask.id }), /hash|identity|changed/);
    assert.equal(mutated, true);
    tracker.assertClean();
  } finally {
    fs.readSync = originalReadSync;
    if (tracker) tracker.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a reference path rename during snapshotting and closes partial snapshots', () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-resolver-path-race-'));
  const initialized = initializeStudio({ workspaceRoot });
  const db = openStudioDatabase(initialized.paths, initialized.manifest);
  const originalReadSync = fs.readSync;
  let tracker;
  try {
    const original = largePng();
    const reference = importStudioAsset(db, initialized.paths, { studioId: initialized.manifest.studioId, bytes: original, mediaType: 'image/png' });
    const filePath = assetFilePath(initialized.paths, reference);
    const identity = fs.statSync(filePath);
    let renamed = false;
    fs.readSync = function (...args) {
      const read = originalReadSync.apply(fs, args);
      const opened = fs.fstatSync(args[0]);
      if (!renamed && args[4] === 0 && opened.dev === identity.dev && opened.ino === identity.ino) {
        renamed = true;
        fs.renameSync(filePath, filePath + '.verified');
        fs.writeFileSync(filePath, sameSizeReplacement(original));
      }
      return read;
    };
    tracker = trackSnapshotDescriptors(initialized.paths);
    const resolver = new StudioAssetResolver({ db, paths: initialized.paths });
    assert.throws(() => resolver.resolve({ studioId: initialized.manifest.studioId, referenceAssetIds: [reference.id] }), /path|changed/);
    assert.equal(renamed, true);
    tracker.assertClean();
  } finally {
    fs.readSync = originalReadSync;
    if (tracker) tracker.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('rejects a managed mask path replaced by a symlink', () => {
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
    assert.throws(() => resolver.resolve({ studioId: initialized.manifest.studioId, maskAssetId: mask.id }), /symbolic|regular file|symlink/);
    tracker.assertClean();
  } finally {
    if (tracker) tracker.restore();
    closeStudioDatabase(db);
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
