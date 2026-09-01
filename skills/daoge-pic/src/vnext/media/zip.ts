import fs from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import { createVerifiedSnapshot, VerifiedManagedFile } from './archive';

export interface ZipEntryInput {
  name: string;
  filePath?: string;
  snapshot?: VerifiedManagedFile;
  contentHash?: string;
  byteSize?: number;
  mediaType?: string;
}

export interface ZipStreamOptions {
  maxEntries?: number;
  maxAggregateBytes?: number;
  maxEntryBytes?: number;
  chunkBytes?: number;
  snapshotDirectory?: string;
  signal?: AbortSignal;
  beforeWrite?: () => void;
}

interface ValidatedZipEntry extends ZipEntryInput {
  nameBytes: Buffer;
  pathByteSize: number;
}

interface OpenedZipEntry extends ValidatedZipEntry {
  file: VerifiedManagedFile;
}

interface CentralEntry {
  name: Buffer;
  crc: number;
  byteSize: number;
  offset: number;
  stamp: { date: number; time: number };
}

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_AGGREGATE_BYTES = 150 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 100 * 1024 * 1024;
const BUFFER_FIXTURE_MAX_BYTES = 8 * 1024 * 1024;
const ZIP32_MAX = 0xffffffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(value: number, bytes: Buffer): number {
  let next = value;
  for (const byte of bytes) next = CRC_TABLE[(next ^ byte) & 0xff] ^ (next >>> 8);
  return next >>> 0;
}

function dosTimestamp(date = new Date()): { date: number; time: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return { date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(), time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2) };
}

function localHeader(name: Buffer, stamp: { date: number; time: number }): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0808, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function dataDescriptor(crc: number, byteSize: number): Buffer {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(byteSize, 8);
  descriptor.writeUInt32LE(byteSize, 12);
  return descriptor;
}

function centralHeader(entry: CentralEntry): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0808, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(entry.stamp.time, 12);
  header.writeUInt16LE(entry.stamp.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.byteSize, 20);
  header.writeUInt32LE(entry.byteSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return header;
}

function endOfCentralDirectory(entryCount: number, centralSize: number, centralOffset: number): Buffer {
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return end;
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('ZIP streaming was aborted.');
    error.name = 'AbortError';
    throw error;
  }
}

async function writeWithBackpressure(output: Writable, bytes: Buffer, signal?: AbortSignal): Promise<void> {
  assertNotAborted(signal);
  if (output.destroyed || output.writableEnded) throw new Error('ZIP output stream is unavailable.');
  if (output.write(bytes)) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      output.removeListener('drain', onDrain);
      output.removeListener('error', onError);
      output.removeListener('close', onClose);
      signal?.removeEventListener('abort', onAbort);
    };
    const onDrain = (): void => { cleanup(); resolve(); };
    const onError = (error: Error): void => { cleanup(); reject(error); };
    const onClose = (): void => { cleanup(); reject(new Error('ZIP output stream closed before draining.')); };
    const onAbort = (): void => { cleanup(); const error = new Error('ZIP streaming was aborted.'); error.name = 'AbortError'; reject(error); };
    output.once('drain', onDrain);
    output.once('error', onError);
    output.once('close', onClose);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function validateZipEntries(entries: ZipEntryInput[], options: ZipStreamOptions = {}): ValidatedZipEntry[] {
  const maxEntries = Math.min(0xffff, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
  const maxAggregateBytes = Math.min(ZIP32_MAX, options.maxAggregateBytes ?? DEFAULT_MAX_AGGREGATE_BYTES);
  const maxEntryBytes = Math.min(ZIP32_MAX, options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES);
  if (!entries.length) throw new Error('A ZIP archive requires at least one image.');
  if (entries.length > maxEntries) throw new Error('ZIP archive entry limit exceeded.');
  const names = new Set<string>();
  let aggregateBytes = 0;
  return entries.map((entry) => {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    if (!nameBytes.length || nameBytes.length > 255 || nameBytes.includes(0) || entry.name.includes('/') || entry.name.includes('\\') || entry.name === '.' || entry.name === '..') throw new Error('ZIP entry names must be simple file names.');
    if (names.has(entry.name)) throw new Error('ZIP entry names must be unique.');
    names.add(entry.name);
    if (Boolean(entry.filePath) === Boolean(entry.snapshot)) throw new Error('ZIP entries require exactly one source.');
    let sourceByteSize: number;
    if (entry.snapshot) {
      sourceByteSize = entry.snapshot.byteSize;
      if (entry.contentHash && entry.snapshot.contentHash !== entry.contentHash) throw new Error('ZIP snapshot hash does not match its entry identity.');
      if (entry.byteSize !== undefined && entry.snapshot.byteSize !== entry.byteSize) throw new Error('ZIP snapshot size does not match its entry identity.');
      if (entry.mediaType && entry.snapshot.mediaType !== entry.mediaType) throw new Error('ZIP snapshot media type does not match its entry identity.');
    } else {
      if (!entry.filePath) throw new Error('ZIP file source is missing.');
      const stat = fs.lstatSync(entry.filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ZIP sources must be regular files.');
      sourceByteSize = stat.size;
    }
    if (sourceByteSize > maxEntryBytes) throw new Error('ZIP entry byte limit exceeded.');
    aggregateBytes += sourceByteSize;
    if (aggregateBytes > maxAggregateBytes) throw new Error('ZIP aggregate byte limit exceeded.');
    return { ...entry, nameBytes, pathByteSize: sourceByteSize };
  });
}

function openZipEntries(entries: ValidatedZipEntry[], options: ZipStreamOptions, opened: OpenedZipEntry[]): void {
  const maxAggregateBytes = Math.min(ZIP32_MAX, options.maxAggregateBytes ?? DEFAULT_MAX_AGGREGATE_BYTES);
  const maxEntryBytes = Math.min(ZIP32_MAX, options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES);
  let aggregateBytes = 0;
  for (const entry of entries) {
    assertNotAborted(options.signal);
    let file = entry.snapshot;
    if (!file) {
      if (!entry.filePath) throw new Error('ZIP file source is missing.');
      file = createVerifiedSnapshot(entry.filePath, { contentHash: entry.contentHash, byteSize: entry.byteSize, mediaType: entry.mediaType, requireImage: Boolean(entry.mediaType), maxByteSize: Math.min(maxEntryBytes, maxAggregateBytes - aggregateBytes) }, { snapshotDirectory: options.snapshotDirectory });
    }
    aggregateBytes += file.byteSize;
    if (aggregateBytes > maxAggregateBytes) throw new Error('ZIP aggregate byte limit exceeded.');
    opened.push({ ...entry, file });
  }
}

/** Streams a stored ZIP sequentially. Only central-directory metadata is retained in memory. */
export async function writeImageZip(entries: ZipEntryInput[], output: Writable, options: ZipStreamOptions = {}): Promise<void> {
  const opened: OpenedZipEntry[] = [];
  const maxAggregateBytes = Math.min(ZIP32_MAX, options.maxAggregateBytes ?? DEFAULT_MAX_AGGREGATE_BYTES);
  const maxEntryBytes = Math.min(ZIP32_MAX, options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES);
  const chunkBytes = Math.min(1024 * 1024, Math.max(16 * 1024, options.chunkBytes ?? 64 * 1024));
  const stamp = dosTimestamp();
  const central: CentralEntry[] = [];
  let offset = 0;
  let aggregateBytes = 0;
  try {
    const validated = validateZipEntries(entries, options);
    openZipEntries(validated, options, opened);
    options.beforeWrite?.();
    for (const entry of opened) {
      assertNotAborted(options.signal);
      const local = localHeader(entry.nameBytes, stamp);
      const localOffset = offset;
      await writeWithBackpressure(output, local, options.signal);
      await writeWithBackpressure(output, entry.nameBytes, options.signal);
      offset += local.length + entry.nameBytes.length;
      let crc = 0xffffffff;
      let byteSize = 0;
      const source = entry.file.createReadStream(chunkBytes);
      const abortSource = (): void => {
        const error = new Error('ZIP streaming was aborted.');
        error.name = 'AbortError';
        source.destroy(error);
      };
      options.signal?.addEventListener('abort', abortSource, { once: true });
      try {
        for await (const value of source) {
          const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
          for (let chunkOffset = 0; chunkOffset < bytes.length; chunkOffset += chunkBytes) {
            const chunk = bytes.subarray(chunkOffset, Math.min(bytes.length, chunkOffset + chunkBytes));
            byteSize += chunk.length;
            aggregateBytes += chunk.length;
            if (byteSize > maxEntryBytes || aggregateBytes > maxAggregateBytes || byteSize > ZIP32_MAX) throw new Error('ZIP source changed beyond its validated byte limit.');
            crc = updateCrc32(crc, chunk);
            await writeWithBackpressure(output, chunk, options.signal);
            offset += chunk.length;
          }
        }

      } finally {
        options.signal?.removeEventListener('abort', abortSource);
        if (!source.readableEnded && !source.destroyed) source.destroy();
      }
      if (byteSize !== entry.file.byteSize) throw new Error('ZIP source size changed during streaming.');
      crc = (crc ^ 0xffffffff) >>> 0;
      const descriptor = dataDescriptor(crc, byteSize);
      await writeWithBackpressure(output, descriptor, options.signal);
      offset += descriptor.length;
      central.push({ name: entry.nameBytes, crc, byteSize, offset: localOffset, stamp });
    }
    const centralOffset = offset;
    for (const entry of central) {
      const header = centralHeader(entry);
      await writeWithBackpressure(output, header, options.signal);
      await writeWithBackpressure(output, entry.name, options.signal);
      offset += header.length + entry.name.length;
    }
    const centralSize = offset - centralOffset;
    if (offset > ZIP32_MAX || centralSize > ZIP32_MAX) throw new Error('ZIP32 archive size limit exceeded.');
    await writeWithBackpressure(output, endOfCentralDirectory(central.length, centralSize, centralOffset), options.signal);
  } finally {
    const handles = new Set<VerifiedManagedFile>();
    for (const entry of entries) if (entry.snapshot) handles.add(entry.snapshot);
    for (const entry of opened) handles.add(entry.file);
    for (const handle of handles) handle.close();
  }
}

/** Small-fixture convenience. Production archive responses must use writeImageZip directly. */
export async function createImageZip(entries: ZipEntryInput[]): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  await writeImageZip(entries, output, { maxAggregateBytes: BUFFER_FIXTURE_MAX_BYTES, maxEntryBytes: BUFFER_FIXTURE_MAX_BYTES });
  output.end();
  return Buffer.concat(chunks);
}
