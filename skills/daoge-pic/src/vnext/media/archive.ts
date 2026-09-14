import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createId, sha256 } from '../shared/ids';
import { assertWorkspacePath, AssetBucket, ensureAssetBucket, ensureCacheDirectory, StudioPaths } from '../studio/workspace';

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const HASH_CHUNK_BYTES = 64 * 1024;
const HASH_YIELD_BYTES = 256 * 1024;

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

export type ManagedMediaRoot = AssetBucket | 'staging';

export interface StagedImage {
  stagingPath: string;
  mediaType: string;
  contentHash: string;
  byteSize: number;
}

export interface ArchivedImage {
  absolutePath: string;
  storagePath: string;
  mediaType: string;
  contentHash: string;
  byteSize: number;
}

export interface ManagedFileIdentity {
  absolutePath: string;
  mediaType: string;
  contentHash: string;
  byteSize: number;
}

export interface ManagedFileExpectation {
  contentHash?: string;
  byteSize?: number;
  mediaType?: string;
  minByteSize?: number;
  maxByteSize?: number;
  requireImage?: boolean;
}
export interface VerifiedSnapshotOptions {
  snapshotDirectory?: string;
}


export interface VerifiedManagedFile {
  absolutePath: string;
  mediaType: string | null;
  contentHash: string;
  byteSize: number;
  descriptor: number;
  createReadStream(highWaterMark?: number, range?: { start: number; end: number }): Readable;
  close(): void;
}

export class MediaValidationError extends Error {}
export class MediaArchiveError extends Error {}

/**
 * Detects the real image type from the leading bytes. Exported because a
 * content type declared by a remote party is a claim, not a fact: every path
 * that accepts bytes from a Provider must confirm them here rather than trust
 * the header.
 */
export function detectedMediaType(bytes: Buffer): string | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a')) return 'image/gif';
  return null;
}

function structurallyValidImage(bytes: Buffer, mediaType: string): boolean {
  if (mediaType === 'image/png') {
    if (bytes.length < 33) return false;
    let offset = 8;
    let sawHeader = false;
    let sawEnd = false;
    while (offset + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const end = offset + 12 + length;
      if (end > bytes.length) return false;
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (type === 'IHDR') {
        if (length !== 13 || sawHeader || bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0) return false;
        sawHeader = true;
      }
      if (type === 'IEND') {
        if (length !== 0 || !sawHeader) return false;
        sawEnd = true;
        break;
      }
      offset = end;
    }
    return sawEnd;
  }
  if (mediaType === 'image/gif') {
    return bytes.length >= 14 && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes[bytes.length - 1] === 0x3b;
  }
  if (mediaType === 'image/webp') {
    if (bytes.length < 20 || bytes.readUInt32LE(4) !== bytes.length - 8) return false;
    let offset = 12;
    let sawImageChunk = false;
    while (offset + 8 <= bytes.length) {
      const length = bytes.readUInt32LE(offset + 4);
      const end = offset + 8 + length + (length & 1);
      if (end > bytes.length) return false;
      const type = bytes.toString('ascii', offset, offset + 4);
      if (type === 'VP8 ' || type === 'VP8L' || type === 'VP8X') sawImageChunk = true;
      offset = end;
    }
    return offset === bytes.length && sawImageChunk;
  }
  if (mediaType === 'image/jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
    let offset = 2;
    while (offset < bytes.length - 2) {
      if (bytes[offset] !== 0xff) return false;
      while (offset < bytes.length && bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9) return offset === bytes.length;
      if (marker === 0xda) return true;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return false;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return false;
      offset += length;
    }
    return false;
  }
  return false;
}

function assertSafeAssetId(assetId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(assetId)) throw new MediaArchiveError('Asset id may contain only letters, numbers, underscores, and hyphens.');
  return assetId;
}

function workspaceStoragePath(paths: StudioPaths, filePath: string): string {
  const relative = path.relative(paths.workspaceRoot, filePath);
  if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new MediaArchiveError('Managed media must remain inside the Studio workspace.');
  return relative.split(path.sep).join('/');
}

function managedRootPath(paths: StudioPaths, root: ManagedMediaRoot): string {
  return root === 'staging' ? path.join(paths.cacheDir, 'staging') : path.join(paths.assetRoot, root);
}

function assertStoredRelativePath(value: string): string[] {
  if (!value || value.includes('\0') || value.includes('\\') || path.isAbsolute(value)) throw new MediaArchiveError('Managed media journal path is invalid.');
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new MediaArchiveError('Managed media journal path is invalid.');
  return segments;
}

export function resolveManagedMediaPath(paths: StudioPaths, storedPath: string, root: ManagedMediaRoot, options: { mustExist?: boolean } = {}): string {
  const segments = assertStoredRelativePath(storedPath);
  const absolute = path.resolve(paths.workspaceRoot, ...segments);
  const expectedRoot = path.resolve(managedRootPath(paths, root));
  const relativeToRoot = path.relative(expectedRoot, absolute);
  if (!relativeToRoot || relativeToRoot === '..' || relativeToRoot.startsWith('..' + path.sep) || path.isAbsolute(relativeToRoot)) throw new MediaArchiveError('Managed media journal path is outside its required root.');
  try {
    assertWorkspacePath(paths, expectedRoot, { requireDirectory: true });
    assertWorkspacePath(paths, absolute);
  } catch (error) {
    throw new MediaArchiveError(error instanceof Error ? error.message : 'Managed media path is invalid.');
  }
  if (options.mustExist !== false) {
    let stat: fs.Stats;
    try { stat = fs.lstatSync(absolute); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new MediaArchiveError('Managed media file is missing.');
      throw error;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new MediaArchiveError('Managed media must be a regular file.');
  } else if (fs.existsSync(absolute)) {
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new MediaArchiveError('Managed media must be a regular file.');
  }
  return absolute;
}

function createVerifiedHandle(descriptor: number, absolutePath: string, identity: { mediaType: string | null; contentHash: string; byteSize: number }, closeDescriptor: () => void = () => fs.closeSync(descriptor)): VerifiedManagedFile {
  let closed = false;
  let streamCreated = false;
  let activeStream: Readable | undefined;
  return {
    absolutePath,
    ...identity,
    descriptor,
    createReadStream(highWaterMark = HASH_CHUNK_BYTES, range?: { start: number; end: number }): Readable {
      if (closed) throw new MediaArchiveError('Managed media handle is closed.');
      if (streamCreated) throw new MediaArchiveError('Managed media handle already has a stream.');
      if (identity.byteSize === 0) {
        activeStream = Readable.from([]);
        streamCreated = true;
        return activeStream;
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? identity.byteSize - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= identity.byteSize) throw new MediaArchiveError('Managed media stream range is invalid.');
      let offset = start;
      activeStream = new Readable({
        highWaterMark,
        read(size) {
          if (offset > end) return this.push(null);
          try {
            const bytes = Buffer.allocUnsafe(Math.min(Math.max(1, size), highWaterMark, end - offset + 1));
            const read = fs.readSync(descriptor, bytes, 0, bytes.length, offset);
            if (!read) return this.destroy(new MediaArchiveError('Verified media snapshot ended before its expected byte size.'));
            offset += read;
            this.push(bytes.subarray(0, read));
          } catch (error) {
            this.destroy(error as Error);
          }
        }
      });
      streamCreated = true;
      return activeStream;
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (activeStream && !activeStream.destroyed) activeStream.destroy();
      try {
        closeDescriptor();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EBADF') throw error;
      }
    }

  };
}

function validateOpenedIdentity(descriptor: number, filePath: string, pathIdentity: fs.Stats): fs.Stats {
  const opened = fs.fstatSync(descriptor);
  if (!opened.isFile() || opened.dev !== pathIdentity.dev || opened.ino !== pathIdentity.ino) throw new MediaArchiveError('Managed media changed while it was opened.');
  return opened;
}

function assertExpectedIdentity(identity: { mediaType: string | null; contentHash: string; byteSize: number }, expected: ManagedFileExpectation): void {
  if ((expected.requireImage || expected.mediaType) && !identity.mediaType) throw new MediaArchiveError('Managed media content type is unsupported.');
  if (expected.mediaType && identity.mediaType !== expected.mediaType) throw new MediaArchiveError('Managed media content type does not match its expected identity.');
  if (expected.contentHash && identity.contentHash !== expected.contentHash) throw new MediaArchiveError('Managed media content hash does not match its expected identity.');
  if (expected.byteSize !== undefined && (!Number.isSafeInteger(expected.byteSize) || identity.byteSize !== expected.byteSize)) throw new MediaArchiveError('Managed media size does not match its expected identity.');
}

function assertStructurallyValidImage(bytes: Buffer, mediaType: string | null): void {
  if (!mediaType || !structurallyValidImage(bytes, mediaType)) throw new MediaArchiveError('Managed media image bytes are truncated or structurally invalid.');
}

function assertImageFileStructure(filePath: string, mediaType: string | null): void {
  assertStructurallyValidImage(fs.readFileSync(filePath), mediaType);
}

async function assertImageFileStructureAsync(filePath: string, mediaType: string | null): Promise<void> {
  assertStructurallyValidImage(await fsp.readFile(filePath), mediaType);
}

export function openVerifiedManagedFile(filePath: string, expected: ManagedFileExpectation = {}): VerifiedManagedFile {
  let descriptor: number | undefined;
  try {
    const pathIdentity = fs.lstatSync(filePath);
    if (!pathIdentity.isFile() || pathIdentity.isSymbolicLink()) throw new MediaArchiveError('Managed media must be a regular file.');
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = validateOpenedIdentity(descriptor, filePath, pathIdentity);
    const minByteSize = expected.minByteSize ?? 0;
    const maxByteSize = expected.maxByteSize ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before.size) || before.size < minByteSize || before.size > maxByteSize) throw new MediaArchiveError('Managed media size is invalid.');
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    const header = Buffer.alloc(16);
    let headerBytes = 0;
    let offset = 0;
    while (offset < before.size) {
      const read = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, before.size - offset), offset);
      if (!read) break;
      if (headerBytes < header.length) {
        const copied = Math.min(read, header.length - headerBytes);
        chunk.copy(header, headerBytes, 0, copied);
        headerBytes += copied;
      }
      hash.update(chunk.subarray(0, read));
      offset += read;
    }
    const after = fs.fstatSync(descriptor);
    if (offset !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new MediaArchiveError('Managed media changed during verification.');
    const identity = { mediaType: detectedMediaType(header.subarray(0, headerBytes)), contentHash: hash.digest('hex'), byteSize: before.size };
    assertExpectedIdentity(identity, expected);
    if (expected.requireImage) assertImageFileStructure(filePath, identity.mediaType);
    const openDescriptor = descriptor;
    descriptor = undefined;
    return createVerifiedHandle(openDescriptor, path.resolve(filePath), identity);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    throw error;
  }
}

export async function openVerifiedManagedFileAsync(filePath: string, expected: ManagedFileExpectation = {}): Promise<VerifiedManagedFile> {
  let source: fs.promises.FileHandle | undefined;
  try {
    const pathIdentity = await fsp.lstat(filePath);
    if (!pathIdentity.isFile() || pathIdentity.isSymbolicLink()) throw new MediaArchiveError('Managed media must be a regular file.');
    source = await fsp.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = await source.stat();
    if (!before.isFile() || before.dev !== pathIdentity.dev || before.ino !== pathIdentity.ino) throw new MediaArchiveError('Managed media changed while it was opened.');
    const minByteSize = expected.minByteSize ?? 0;
    const maxByteSize = expected.maxByteSize ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before.size) || before.size < minByteSize || before.size > maxByteSize) throw new MediaArchiveError('Managed media size is invalid.');
    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    const header = Buffer.alloc(16);
    let headerBytes = 0;
    let offset = 0;
    while (offset < before.size) {
      const { bytesRead } = await source.read(chunk, 0, Math.min(chunk.length, before.size - offset), offset);
      if (!bytesRead) break;
      if (headerBytes < header.length) {
        const copied = Math.min(bytesRead, header.length - headerBytes);
        chunk.copy(header, headerBytes, 0, copied);
        headerBytes += copied;
      }
      hash.update(chunk.subarray(0, bytesRead));
      offset += bytesRead;
      if (offset % HASH_YIELD_BYTES === 0) await nextTurn();
    }
    const after = await source.stat();
    let afterPath: fs.Stats;
    try { afterPath = await fsp.lstat(filePath); }
    catch { throw new MediaArchiveError('Managed media path changed during verification.'); }
    if (!afterPath.isFile() || afterPath.isSymbolicLink() || afterPath.dev !== before.dev || afterPath.ino !== before.ino || offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new MediaArchiveError('Managed media changed during verification.');
    const identity = { mediaType: detectedMediaType(header.subarray(0, headerBytes)), contentHash: hash.digest('hex'), byteSize: before.size };
    assertExpectedIdentity(identity, expected);
    if (expected.requireImage) await assertImageFileStructureAsync(filePath, identity.mediaType);
    const reader = source;
    source = undefined;
    return createVerifiedHandle(reader.fd, path.resolve(filePath), identity, () => { void reader.close().catch(() => undefined); });
  } catch (error) {
    if (source) await source.close();
    throw error;
  }
}

export function createVerifiedSnapshot(filePath: string, expected: ManagedFileExpectation = {}, options: VerifiedSnapshotOptions = {}): VerifiedManagedFile {
  let sourceDescriptor: number | undefined;
  let snapshotDescriptor: number | undefined;
  let snapshotReadDescriptor: number | undefined;
  let snapshotPath = '';
  try {
    const sourcePathIdentity = fs.lstatSync(filePath);
    if (!sourcePathIdentity.isFile() || sourcePathIdentity.isSymbolicLink()) throw new MediaArchiveError('Managed media must be a regular file.');
    sourceDescriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = validateOpenedIdentity(sourceDescriptor, filePath, sourcePathIdentity);
    const minByteSize = expected.minByteSize ?? 0;
    const maxByteSize = expected.maxByteSize ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before.size) || before.size < minByteSize || before.size > maxByteSize) throw new MediaArchiveError('Managed media size is invalid.');

    const requestedDirectory = options.snapshotDirectory || path.join(os.tmpdir(), 'daoge-pic-verified-snapshots');
    fs.mkdirSync(requestedDirectory, { recursive: true, mode: 0o700 });
    const requestedStat = fs.lstatSync(requestedDirectory);
    if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) throw new MediaArchiveError('Verified snapshot directory is invalid.');
    const snapshotDirectory = fs.realpathSync(requestedDirectory);
    snapshotPath = path.join(snapshotDirectory, createId('snapshot') + '.part');
    snapshotDescriptor = fs.openSync(snapshotPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);

    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    const header = Buffer.alloc(16);
    let headerBytes = 0;
    let offset = 0;
    while (offset < before.size) {
      const read = fs.readSync(sourceDescriptor, chunk, 0, Math.min(chunk.length, before.size - offset), offset);
      if (!read) break;
      if (headerBytes < header.length) {
        const copied = Math.min(read, header.length - headerBytes);
        chunk.copy(header, headerBytes, 0, copied);
        headerBytes += copied;
      }
      hash.update(chunk.subarray(0, read));
      let written = 0;
      while (written < read) {
        const count = fs.writeSync(snapshotDescriptor, chunk, written, read - written, offset + written);
        if (!count) throw new MediaArchiveError('Verified snapshot could not be written completely.');
        written += count;
      }
      offset += read;
    }
    const after = fs.fstatSync(sourceDescriptor);
    let afterPath: fs.Stats;
    try { afterPath = fs.lstatSync(filePath); }
    catch { throw new MediaArchiveError('Managed media path changed while its verified snapshot was created.'); }
    if (!afterPath.isFile() || afterPath.isSymbolicLink() || afterPath.dev !== before.dev || afterPath.ino !== before.ino) throw new MediaArchiveError('Managed media path changed while its verified snapshot was created.');
    if (offset !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new MediaArchiveError('Managed media changed while its verified snapshot was created.');
    const identity = { mediaType: detectedMediaType(header.subarray(0, headerBytes)), contentHash: hash.digest('hex'), byteSize: offset };
    assertExpectedIdentity(identity, expected);
    const stagedIdentity = fs.fstatSync(snapshotDescriptor);
    if (!stagedIdentity.isFile() || stagedIdentity.size !== identity.byteSize) throw new MediaArchiveError('Verified snapshot was not written completely.');
    fs.fsyncSync(snapshotDescriptor);
    fs.closeSync(snapshotDescriptor);
    snapshotDescriptor = undefined;
    fs.chmodSync(snapshotPath, 0o400);
    const snapshotPathIdentity = fs.lstatSync(snapshotPath);
    snapshotReadDescriptor = fs.openSync(snapshotPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    validateOpenedIdentity(snapshotReadDescriptor, snapshotPath, snapshotPathIdentity);
    fs.unlinkSync(snapshotPath);
    const openDescriptor = snapshotReadDescriptor;
    snapshotReadDescriptor = undefined;
    fs.closeSync(sourceDescriptor);
    sourceDescriptor = undefined;
    return createVerifiedHandle(openDescriptor, snapshotPath, identity);
  } catch (error) {
    if (sourceDescriptor !== undefined) fs.closeSync(sourceDescriptor);
    if (snapshotDescriptor !== undefined) fs.closeSync(snapshotDescriptor);
    if (snapshotReadDescriptor !== undefined) fs.closeSync(snapshotReadDescriptor);
    if (snapshotPath) fs.rmSync(snapshotPath, { force: true });
    throw error;
  }
}

/**
 * Creates the same unlink-on-open snapshot as createVerifiedSnapshot without
 * monopolizing the event loop while hashing or copying large media files.
 */
export async function createVerifiedSnapshotAsync(filePath: string, expected: ManagedFileExpectation = {}, options: VerifiedSnapshotOptions = {}): Promise<VerifiedManagedFile> {
  let source: fs.promises.FileHandle | undefined;
  let snapshot: fs.promises.FileHandle | undefined;
  let snapshotReader: fs.promises.FileHandle | undefined;
  let snapshotPath = '';
  try {
    const sourcePathIdentity = await fsp.lstat(filePath);
    if (!sourcePathIdentity.isFile() || sourcePathIdentity.isSymbolicLink()) throw new MediaArchiveError('Managed media must be a regular file.');
    source = await fsp.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = await source.stat();
    if (!before.isFile() || before.dev !== sourcePathIdentity.dev || before.ino !== sourcePathIdentity.ino) throw new MediaArchiveError('Managed media changed while it was opened.');
    const minByteSize = expected.minByteSize ?? 0;
    const maxByteSize = expected.maxByteSize ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(before.size) || before.size < minByteSize || before.size > maxByteSize) throw new MediaArchiveError('Managed media size is invalid.');

    const requestedDirectory = options.snapshotDirectory || path.join(os.tmpdir(), 'daoge-pic-verified-snapshots');
    await fsp.mkdir(requestedDirectory, { recursive: true, mode: 0o700 });
    const requestedStat = await fsp.lstat(requestedDirectory);
    if (!requestedStat.isDirectory() || requestedStat.isSymbolicLink()) throw new MediaArchiveError('Verified snapshot directory is invalid.');
    const snapshotDirectory = await fsp.realpath(requestedDirectory);
    snapshotPath = path.join(snapshotDirectory, createId('snapshot') + '.part');
    snapshot = await fsp.open(snapshotPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);

    const hash = createHash('sha256');
    const chunk = Buffer.allocUnsafe(HASH_CHUNK_BYTES);
    const header = Buffer.alloc(16);
    let headerBytes = 0;
    let offset = 0;
    let bytesSinceYield = 0;
    while (offset < before.size) {
      const { bytesRead } = await source.read(chunk, 0, Math.min(chunk.length, before.size - offset), offset);
      if (!bytesRead) break;
      if (headerBytes < header.length) {
        const copied = Math.min(bytesRead, header.length - headerBytes);
        chunk.copy(header, headerBytes, 0, copied);
        headerBytes += copied;
      }
      hash.update(chunk.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await snapshot.write(chunk, written, bytesRead - written, offset + written);
        if (!result.bytesWritten) throw new MediaArchiveError('Verified snapshot could not be written completely.');
        written += result.bytesWritten;
      }
      offset += bytesRead;
      bytesSinceYield += bytesRead;
      if (bytesSinceYield >= HASH_YIELD_BYTES) {
        bytesSinceYield = 0;
        await nextTurn();
      }
    }
    const after = await source.stat();
    let afterPath: fs.Stats;
    try { afterPath = await fsp.lstat(filePath); }
    catch { throw new MediaArchiveError('Managed media path changed while its verified snapshot was created.'); }
    if (!afterPath.isFile() || afterPath.isSymbolicLink() || afterPath.dev !== before.dev || afterPath.ino !== before.ino) throw new MediaArchiveError('Managed media path changed while its verified snapshot was created.');
    if (offset !== before.size || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new MediaArchiveError('Managed media changed while its verified snapshot was created.');
    const identity = { mediaType: detectedMediaType(header.subarray(0, headerBytes)), contentHash: hash.digest('hex'), byteSize: offset };
    assertExpectedIdentity(identity, expected);
    const stagedIdentity = await snapshot.stat();
    if (!stagedIdentity.isFile() || stagedIdentity.size !== identity.byteSize) throw new MediaArchiveError('Verified snapshot was not written completely.');
    await snapshot.sync();
    await snapshot.close();
    snapshot = undefined;
    await fsp.chmod(snapshotPath, 0o400);
    const snapshotPathIdentity = await fsp.lstat(snapshotPath);
    snapshotReader = await fsp.open(snapshotPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = await snapshotReader.stat();
    if (!opened.isFile() || opened.dev !== snapshotPathIdentity.dev || opened.ino !== snapshotPathIdentity.ino) throw new MediaArchiveError('Managed media changed while it was opened.');
    await fsp.unlink(snapshotPath);
    const reader = snapshotReader;
    const descriptor = reader.fd;
    snapshotReader = undefined;
    await source.close();
    source = undefined;
    return createVerifiedHandle(descriptor, snapshotPath, identity, () => { void reader.close().catch(() => undefined); });
  } catch (error) {
    if (source) await source.close();
    if (snapshot) await snapshot.close();
    if (snapshotReader) await snapshotReader.close();
    if (snapshotPath) await fsp.rm(snapshotPath, { force: true });
    throw error;
  }
}

export function inspectManagedImageFile(paths: StudioPaths, storedPath: string, root: ManagedMediaRoot, expected?: { mediaType: string; contentHash: string; byteSize: number }): ManagedFileIdentity {
  const absolutePath = resolveManagedMediaPath(paths, storedPath, root);
  const opened = openVerifiedManagedFile(absolutePath, { ...expected, minByteSize: 1, maxByteSize: MAX_IMAGE_BYTES, requireImage: true });
  try {
    if (!opened.mediaType) throw new MediaArchiveError('Managed media content type is unsupported.');
    return { absolutePath: opened.absolutePath, mediaType: opened.mediaType, contentHash: opened.contentHash, byteSize: opened.byteSize };
  } finally {
    opened.close();
  }
}

export async function inspectManagedImageFileAsync(paths: StudioPaths, storedPath: string, root: ManagedMediaRoot, expected?: { mediaType: string; contentHash: string; byteSize: number }): Promise<ManagedFileIdentity> {
  const absolutePath = resolveManagedMediaPath(paths, storedPath, root);
  const opened = await openVerifiedManagedFileAsync(absolutePath, { ...expected, minByteSize: 1, maxByteSize: MAX_IMAGE_BYTES, requireImage: true });
  try {
    if (!opened.mediaType) throw new MediaArchiveError('Managed media content type is unsupported.');
    return { absolutePath: opened.absolutePath, mediaType: opened.mediaType, contentHash: opened.contentHash, byteSize: opened.byteSize };
  } finally {
    opened.close();
  }
}

export function validateImageBytes(bytes: Buffer, declaredMediaType?: string): { mediaType: string; contentHash: string; byteSize: number } {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new MediaValidationError('Image data is required.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new MediaValidationError('Image exceeds the 100 MB Studio limit.');
  const mediaType = detectedMediaType(bytes);
  if (!mediaType) throw new MediaValidationError('Only PNG, JPEG, WebP, and GIF images can be imported.');
  if (declaredMediaType && declaredMediaType !== mediaType) throw new MediaValidationError('Declared image type does not match file content.');
  if (!structurallyValidImage(bytes, mediaType)) throw new MediaValidationError('Image bytes are truncated or structurally invalid.');
  return { mediaType, contentHash: sha256(bytes), byteSize: bytes.length };
}

export function stageImage(paths: StudioPaths, bytes: Buffer, declaredMediaType?: string): StagedImage {
  const validated = validateImageBytes(bytes, declaredMediaType);
  const stagingDir = ensureCacheDirectory(paths, 'staging');
  const stagingPath = path.join(stagingDir, createId('media') + '.part');
  fs.writeFileSync(stagingPath, bytes, { flag: 'wx' });
  return { stagingPath, ...validated };
}

export async function stageImageStream(paths: StudioPaths, source: AsyncIterable<Buffer | Uint8Array | string> | Iterable<Buffer | Uint8Array | string>, declaredMediaType?: string, options: { deferValidation?: boolean } = {}): Promise<StagedImage> {
  const stagingDir = ensureCacheDirectory(paths, 'staging');
  const stagingPath = path.join(stagingDir, createId('media') + '.part');
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fsp.open(stagingPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    const hash = createHash('sha256');
    const header = Buffer.alloc(16);
    let headerBytes = 0;
    let byteSize = 0;
    for await (const value of source) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      if (!chunk.length) continue;
      byteSize += chunk.length;
      if (byteSize > MAX_IMAGE_BYTES) throw new MediaValidationError('Image exceeds the 100 MB Studio limit.');
      if (headerBytes < header.length) {
        const copied = Math.min(chunk.length, header.length - headerBytes);
        chunk.copy(header, headerBytes, 0, copied);
        headerBytes += copied;
      }
      let consumed = 0;
      while (consumed < chunk.length) {
        const part = chunk.subarray(consumed, Math.min(chunk.length, consumed + HASH_YIELD_BYTES));
        hash.update(part);
        let written = 0;
        while (written < part.length) {
          const result = await handle.write(part, written, part.length - written, byteSize - chunk.length + consumed + written);
          if (!result.bytesWritten) throw new MediaArchiveError('Staged media could not be written completely.');
          written += result.bytesWritten;
        }
        consumed += part.length;
        if (consumed < chunk.length) await nextTurn();
      }
    }
    if (!byteSize) throw new MediaValidationError('Image data is required.');
    const mediaType = detectedMediaType(header.subarray(0, headerBytes));
    if (!options.deferValidation && !mediaType) throw new MediaValidationError('Only PNG, JPEG, WebP, and GIF images can be imported.');
    if (!options.deferValidation && declaredMediaType && declaredMediaType !== mediaType) throw new MediaValidationError('Declared image type does not match file content.');
    if (!options.deferValidation) assertStructurallyValidImage(await fsp.readFile(stagingPath), mediaType);
    await handle.sync();
    await handle.close();
    handle = undefined;
    return { stagingPath, mediaType: mediaType || '', contentHash: hash.digest('hex'), byteSize };
  } catch (error) {
    if (handle) await handle.close();
    await fsp.rm(stagingPath, { force: true });
    throw error;
  }
}

export function stageImageBytesAsync(paths: StudioPaths, bytes: Buffer, declaredMediaType?: string): Promise<StagedImage> {
  if (!Buffer.isBuffer(bytes)) throw new MediaValidationError('Image data is required.');
  return stageImageStream(paths, [bytes], declaredMediaType);
}
export async function stageImageFileAsync(paths: StudioPaths, sourcePath: string, declaredMediaType?: string): Promise<StagedImage> {
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  const handle = await fsp.open(sourcePath, flags);
  const stream = handle.createReadStream({ autoClose: false });
  try {
    return await stageImageStream(paths, stream, declaredMediaType);
  } finally {
    stream.destroy();
    await handle.close().catch(() => undefined);
  }
}

export function plannedArchivePath(paths: StudioPaths, input: { assetId: string; bucket: AssetBucket; mediaType: string }): { absolutePath: string; storagePath: string } {
  const assetId = assertSafeAssetId(input.assetId);
  const extension = MIME_EXTENSIONS[input.mediaType];
  if (!extension) throw new MediaArchiveError('Unsupported archived media type.');
  const absolutePath = path.join(ensureAssetBucket(paths, input.bucket), assetId + '.' + extension);
  const storagePath = workspaceStoragePath(paths, absolutePath);
  resolveManagedMediaPath(paths, storagePath, input.bucket, { mustExist: false });
  return { absolutePath, storagePath };
}

export function archiveStagedImage(paths: StudioPaths, staged: StagedImage, input: { assetId: string; bucket: AssetBucket }): ArchivedImage {
  const assetId = assertSafeAssetId(input.assetId);
  const stagedStoragePath = workspaceStoragePath(paths, staged.stagingPath);
  const validated = inspectManagedImageFile(paths, stagedStoragePath, 'staging', { mediaType: staged.mediaType, contentHash: staged.contentHash, byteSize: staged.byteSize });
  const planned = plannedArchivePath(paths, { assetId, bucket: input.bucket, mediaType: validated.mediaType });
  if (fs.existsSync(planned.absolutePath)) throw new MediaArchiveError('An asset already exists at the target path.');
  try {
    fs.renameSync(validated.absolutePath, planned.absolutePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') throw new MediaArchiveError('Studio staging and asset storage must be on the same filesystem for atomic media writes.');
    throw error;
  }
  const archived = inspectManagedImageFile(paths, planned.storagePath, input.bucket, { mediaType: validated.mediaType, contentHash: validated.contentHash, byteSize: validated.byteSize });
  return { absolutePath: archived.absolutePath, storagePath: planned.storagePath, mediaType: archived.mediaType, contentHash: archived.contentHash, byteSize: archived.byteSize };
}

export async function archiveStagedImageAsync(paths: StudioPaths, staged: StagedImage, input: { assetId: string; bucket: AssetBucket }): Promise<ArchivedImage> {
  const assetId = assertSafeAssetId(input.assetId);
  const stagedStoragePath = workspaceStoragePath(paths, staged.stagingPath);
  const validated = await inspectManagedImageFileAsync(paths, stagedStoragePath, 'staging', { mediaType: staged.mediaType, contentHash: staged.contentHash, byteSize: staged.byteSize });
  const planned = plannedArchivePath(paths, { assetId, bucket: input.bucket, mediaType: validated.mediaType });
  try {
    await fsp.lstat(planned.absolutePath);
    throw new MediaArchiveError('An asset already exists at the target path.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    await fsp.rename(validated.absolutePath, planned.absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EXDEV') throw new MediaArchiveError('Studio staging and asset storage must be on the same filesystem for atomic media writes.');
    throw error;
  }
  const archived = await inspectManagedImageFileAsync(paths, planned.storagePath, input.bucket, { mediaType: validated.mediaType, contentHash: validated.contentHash, byteSize: validated.byteSize });
  return { absolutePath: archived.absolutePath, storagePath: planned.storagePath, mediaType: archived.mediaType, contentHash: archived.contentHash, byteSize: archived.byteSize };
}

export function discardStagedImage(staged: StagedImage): void {
  fs.rmSync(staged.stagingPath, { force: true });
}
