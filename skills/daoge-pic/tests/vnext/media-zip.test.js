const fs = require('node:fs');
const { createHash } = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createImageZip, writeImageZip } = require('../../dist/vnext/media/zip');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==', 'base64');

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

test('small ZIP convenience produces a standards-shaped archive containing streamed entry bytes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-zip-small-'));
  try {
    const filePath = path.join(directory, 'fixture.png');
    fs.writeFileSync(filePath, png);
    const archive = await createImageZip([{ name: 'image-001.png', filePath }]);
    assert.equal(archive.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
    assert.equal(archive.includes(Buffer.from('image-001.png')), true);
    assert.equal(archive.includes(png), true);
    assert.equal(archive.includes(Buffer.from('PK\x07\x08', 'binary')), true);
    assert.equal(archive.subarray(-22, -18).toString('ascii'), 'PK\x05\x06');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('production ZIP writer honors backpressure and never materializes a source-sized output chunk', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-zip-stream-'));
  try {
    const filePath = path.join(directory, 'large.bin');
    const sourceSize = 2 * 1024 * 1024;
    fs.writeFileSync(filePath, Buffer.alloc(sourceSize, 0x5a));
    let totalWritten = 0;
    let largestChunk = 0;
    let drainEvents = 0;
    let firstChunk = null;
    const sink = new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        if (!firstChunk) firstChunk = Buffer.from(chunk);
        totalWritten += chunk.length;
        largestChunk = Math.max(largestChunk, chunk.length);
        setImmediate(callback);
      }
    });
    sink.on('drain', () => { drainEvents += 1; });
    await writeImageZip([{ name: 'large.bin', filePath }], sink, { chunkBytes: 32 * 1024, maxEntryBytes: sourceSize, maxAggregateBytes: sourceSize });
    assert.equal(firstChunk.subarray(0, 4).toString('ascii'), 'PK\x03\x04');
    assert.ok(totalWritten > sourceSize);
    assert.ok(drainEvents > 0);
    assert.ok(largestChunk <= 32 * 1024);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ZIP yields to the event loop while calculating CRC for an in-memory source chunk', async () => {
  const bytes = Buffer.alloc(4 * 1024 * 1024, 0x5a);
  let closed = false;
  let eventLoopTurned = false;
  const snapshot = {
    absolutePath: 'memory://crc-fixture',
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    byteSize: bytes.length,
    descriptor: -1,
    mediaType: null,
    createReadStream: () => Readable.from([bytes]),
    close: () => { closed = true; }
  };
  const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  setImmediate(() => { eventLoopTurned = true; });
  await writeImageZip([{ name: 'crc-fixture.bin', snapshot }], sink, { chunkBytes: bytes.length, maxEntryBytes: bytes.length, maxAggregateBytes: bytes.length });
  assert.equal(eventLoopTurned, true);
  assert.equal(closed, true);
});

test('ZIP streams the verified inode when its pathname is replaced with same-size bytes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-zip-inode-'));
  try {
    const filePath = path.join(directory, 'fixture.bin');
    const original = Buffer.alloc(96 * 1024, 0x41);
    const replacement = Buffer.alloc(original.length, 0x42);
    fs.writeFileSync(filePath, original);
    const chunks = [];
    let swapped = false;
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        if (!swapped) {
          swapped = true;
          fs.renameSync(filePath, filePath + '.verified');
          fs.writeFileSync(filePath, replacement);
        }
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    await writeImageZip([{ name: 'fixture.bin', filePath, contentHash: createHash('sha256').update(original).digest('hex'), byteSize: original.length }], sink);
    const archive = Buffer.concat(chunks);
    assert.equal(archive.includes(original), true);
    assert.equal(archive.includes(replacement), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ZIP rejects a same-size in-place mutation before snapshotting without writing response bytes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-zip-mutated-before-'));
  const snapshots = path.join(directory, 'snapshots');
  fs.mkdirSync(snapshots);
  try {
    const filePath = path.join(directory, 'fixture.bin');
    const original = Buffer.alloc(128 * 1024, 0x41);
    fs.writeFileSync(filePath, original);
    const expectedHash = createHash('sha256').update(original).digest('hex');
    fs.writeFileSync(filePath, Buffer.alloc(original.length, 0x42));
    const chunks = [];
    const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    await assert.rejects(writeImageZip([{ name: 'fixture.bin', filePath, contentHash: expectedHash, byteSize: original.length }], sink, { snapshotDirectory: snapshots }), /hash|changed/);
    assert.equal(chunks.length, 0);
    assert.deepEqual(fs.readdirSync(snapshots), []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ZIP rejects a same-inode mutation during snapshotting before its first output byte and cleans staging', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-zip-mutated-during-'));
  const snapshots = path.join(directory, 'snapshots');
  fs.mkdirSync(snapshots);
  let mutation;
  try {
    const filePath = path.join(directory, 'fixture.bin');
    const original = Buffer.alloc(192 * 1024, 0x41);
    fs.writeFileSync(filePath, original);
    const expectedHash = createHash('sha256').update(original).digest('hex');
    mutation = mutateAfterAsyncRead(filePath, () => fs.writeFileSync(filePath, Buffer.alloc(original.length, 0x42)));
    const chunks = [];
    const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    await assert.rejects(writeImageZip([{ name: 'fixture.bin', filePath, contentHash: expectedHash, byteSize: original.length }], sink, { snapshotDirectory: snapshots, chunkBytes: 32 * 1024 }), /hash|changed/);
    assert.equal(mutation.mutated, true);
    assert.equal(chunks.length, 0);
    assert.deepEqual(fs.readdirSync(snapshots), []);
  } finally {
    if (mutation) mutation.restore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
