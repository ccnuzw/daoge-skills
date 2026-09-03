const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const { archiveStagedImageAsync, openVerifiedManagedFileAsync, stageImageBytesAsync } = require('../../dist/vnext/media/archive');
const { startLocalStudioService } = require('../../dist/vnext/api/server');
const { fetchStudio } = require('./local-studio-test-helper');

test('Workbench thumbnails are bounded WebP derivatives with immutable conditional caching and original byte ranges', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-thumbnail-api-'));
  let started;
  try {
    initializeStudio({ workspaceRoot });
    started = await startLocalStudioService({ workspaceRoot });
    const original = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#4f765c' } }).png().toBuffer();
    const upload = await fetchStudio(started, '/api/assets/import', { method: 'POST', headers: { 'content-type': 'image/png', 'idempotency-key': 'thumbnail-upload' }, body: original });
    assert.equal(upload.status, 200);
    const assetId = (await upload.json()).data.id;

    const thumbnail = await fetchStudio(started, '/api/assets/' + encodeURIComponent(assetId) + '/thumbnail');
    assert.equal(thumbnail.status, 200);
    assert.equal(thumbnail.headers.get('content-type'), 'image/webp');
    assert.match(thumbnail.headers.get('cache-control') || '', /immutable/);
    const etag = thumbnail.headers.get('etag');
    assert.ok(etag);
    const thumbnailBytes = Buffer.from(await thumbnail.arrayBuffer());
    assert.ok(thumbnailBytes.length < original.length);
    const metadata = await sharp(thumbnailBytes).metadata();
    assert.ok(Math.max(metadata.width, metadata.height) <= 512);

    const cached = await fetchStudio(started, '/api/assets/' + encodeURIComponent(assetId) + '/thumbnail', { headers: { 'if-none-match': etag } });
    assert.equal(cached.status, 304);
    assert.equal((await cached.arrayBuffer()).byteLength, 0);
    const weakCached = await fetchStudio(started, '/api/assets/' + encodeURIComponent(assetId) + '/thumbnail', { headers: { 'if-none-match': 'W/' + etag } });
    assert.equal(weakCached.status, 304);
    assert.equal(fs.readdirSync(path.join(workspaceRoot, 'daoge-studio', 'cache', 'thumbs')).filter((name) => name.endsWith('.webp')).length, 1);

    const range = await fetchStudio(started, '/api/assets/' + encodeURIComponent(assetId) + '/file', { headers: { range: 'bytes=0-7' } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get('accept-ranges'), 'bytes');
    assert.match(range.headers.get('content-range') || '', /^bytes 0-7\//);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), original.subarray(0, 8));
    const multipartFallback = await fetchStudio(started, '/api/assets/' + encodeURIComponent(assetId) + '/file', { headers: { range: 'bytes=0-1,4-5' } });
    assert.equal(multipartFallback.status, 200);
    assert.deepEqual(Buffer.from(await multipartFallback.arrayBuffer()), original);
  } finally {
    if (started) await started.service.close();
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('asynchronous verified reads yield while hashing large media', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-async-verify-'));
  const filePath = path.join(directory, 'large.png');
  try {
    const bytes = Buffer.alloc(32 * 1024 * 1024);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    fs.writeFileSync(filePath, bytes);
    let eventLoopTurned = false;
    setImmediate(() => { eventLoopTurned = true; });
    const opened = await openVerifiedManagedFileAsync(filePath, { mediaType: 'image/png', byteSize: bytes.length, requireImage: true });
    opened.close();
    assert.equal(eventLoopTurned, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('generated and imported media staging plus archival yield between large chunks', async () => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-async-stage-'));
  try {
    const initialized = initializeStudio({ workspaceRoot });
    const bytes = Buffer.alloc(32 * 1024 * 1024);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    let stagingYielded = false;
    setImmediate(() => { stagingYielded = true; });
    const staged = await stageImageBytesAsync(initialized.paths, bytes, 'image/png');
    assert.equal(stagingYielded, true);
    let archiveYielded = false;
    setImmediate(() => { archiveYielded = true; });
    const archived = await archiveStagedImageAsync(initialized.paths, staged, { assetId: 'async-stage', bucket: 'imports' });
    assert.equal(archiveYielded, true);
    assert.equal(archived.byteSize, bytes.length);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
