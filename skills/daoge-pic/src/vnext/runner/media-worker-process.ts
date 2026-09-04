import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { archiveStagedImageAsync, openVerifiedManagedFileAsync, resolveManagedMediaPath, VerifiedManagedFile } from '../media/archive';
import { openImageThumbnail, resolveImageThumbnailPath } from '../media/thumbnails';
import { writeImageZip } from '../media/zip';
import { openDeliveryExportFileAsync } from '../domain/deliveries';
import { reconcileManagedMediaAsync } from '../media/reconcile';
import { closeStudioDatabase, openStudioDatabase, StudioDatabase } from '../studio/database';
import { ensureCacheDirectory, initializeStudio, StudioPaths } from '../studio/workspace';
import type { MediaJob, MediaJobResult, MediaSource, MediaZipEntry } from '../runtime/media-worker-pool';
import { createId } from '../shared/ids';

function valueAfter(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || '').trim() || null : null;
}

function send(message: Record<string, unknown>): void {
  if (process.send) process.send(message);
}

function assetSourcePath(paths: StudioPaths, source: Extract<MediaSource, { kind: 'asset' }>): string {
  return resolveManagedMediaPath(paths, source.storagePath, source.bucket);
}

async function openSource(paths: StudioPaths, source: MediaSource): Promise<VerifiedManagedFile> {
  if (source.kind === 'asset') return openVerifiedManagedFileAsync(assetSourcePath(paths, source), { contentHash: source.contentHash, byteSize: source.byteSize, mediaType: source.mediaType, requireImage: true, maxByteSize: 100 * 1024 * 1024 });
  return openDeliveryExportFileAsync(paths, { directoryPath: source.directoryPath, name: source.name, contentHash: source.contentHash, byteSize: source.byteSize, mediaType: source.mediaType });
}

async function thumbnail(paths: StudioPaths, job: Extract<MediaJob, { type: 'thumbnail' }>, signal: AbortSignal): Promise<MediaJobResult> {
  if (signal.aborted) throw abortError();
  const opened = await openImageThumbnail(paths, job.contentHash, () => openSource(paths, job.source));
  opened.close();
  return { type: 'thumbnail', contentHash: job.contentHash, path: resolveImageThumbnailPath(paths, job.contentHash) };
}

async function zip(paths: StudioPaths, job: Extract<MediaJob, { type: 'zip' }>, signal: AbortSignal): Promise<MediaJobResult> {
  const snapshots: VerifiedManagedFile[] = [];
  const outputPath = path.join(ensureCacheDirectory(paths, 'staging'), createId('zip') + '.part');
  const output = fs.createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
  try {
    const entries: MediaZipEntry[] = [];
    for (const entry of job.entries) {
      if (signal.aborted) throw abortError();
      snapshots.push(await openSource(paths, entry.source));
      entries.push({ name: entry.name, source: entry.source });
    }
    const zipEntries = entries.map((entry, index) => ({ name: entry.name, snapshot: snapshots[index], contentHash: entry.source.contentHash, byteSize: entry.source.byteSize, mediaType: entry.source.mediaType }));
    await writeImageZip(zipEntries, output, { maxEntries: job.maxEntries, maxAggregateBytes: job.maxAggregateBytes, maxEntryBytes: job.maxEntryBytes, signal });
    output.end();
    await once(output, 'close');
    await fsp.chmod(outputPath, 0o400);
    const verified = await openVerifiedManagedFileAsync(outputPath, { minByteSize: 1, maxByteSize: job.maxAggregateBytes + job.maxEntries * 1024 + 64 * 1024 });
    const result = { type: 'zip' as const, path: outputPath, contentHash: verified.contentHash, byteSize: verified.byteSize };
    verified.close();
    return result;
  } catch (error) {
    output.destroy();
    await fsp.rm(outputPath, { force: true });
    throw error;
  } finally {
    for (const snapshot of snapshots) snapshot.close();
  }
}

async function archiveStaged(paths: StudioPaths, job: Extract<MediaJob, { type: 'archive-staged' }>): Promise<MediaJobResult> {
  const archived = await archiveStagedImageAsync(paths, job.staged, { assetId: job.assetId, bucket: job.bucket });
  return { type: 'archive-staged', ...archived };
}

async function execute(paths: StudioPaths, db: StudioDatabase, job: MediaJob, signal: AbortSignal): Promise<MediaJobResult> {
  if (job.type === 'thumbnail') return thumbnail(paths, job, signal);
  if (job.type === 'zip') return zip(paths, job, signal);
  if (job.type === 'archive-staged') return archiveStaged(paths, job);
  return { type: 'reconcile', result: await reconcileManagedMediaAsync(db, paths, job.studioId) };
}

function abortError(): Error {
  const error = new Error('Media worker job was aborted.');
  error.name = 'AbortError';
  return error;
}

async function main(): Promise<void> {
  const workspaceRoot = valueAfter(process.argv.slice(2), '--workspace');
  if (!workspaceRoot) throw new Error('Media worker process requires --workspace.');
  const initialized = initializeStudio({ workspaceRoot });
  const paths = initialized.paths;
  const db = openStudioDatabase(paths, initialized.manifest);
  let stopping = false;
  const jobs = new Map<string, AbortController>();
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    for (const controller of jobs.values()) controller.abort();
    if (!jobs.size) { closeStudioDatabase(db); process.exit(0); }
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('message', (message: { type?: unknown; jobId?: unknown; job?: MediaJob }) => {
    if (message?.type === 'shutdown') return shutdown();
    if (message?.type === 'cancel' && typeof message.jobId === 'string') { jobs.get(message.jobId)?.abort(); return; }
    if (message?.type !== 'media-job' || typeof message.jobId !== 'string' || !message.job || stopping || jobs.has(message.jobId)) return;
    const controller = new AbortController();
    jobs.set(message.jobId, controller);
    void execute(paths, db, message.job, controller.signal).then((result) => send({ type: 'media-result', jobId: message.jobId, result }), (error) => send({ type: 'media-error', jobId: message.jobId, message: error instanceof Error ? error.message : 'media worker failed' })).finally(() => {
      jobs.delete(message.jobId as string);
      if (stopping && !jobs.size) { closeStudioDatabase(db); process.exit(0); }
    });
  });
  send({ type: 'ready', pid: process.pid });
}

void main().catch((error) => {
  send({ type: 'fatal', message: error instanceof Error ? error.message : 'media worker process failed' });
  process.stderr.write((error instanceof Error ? error.message : 'Media worker process failed.') + '\n');
  process.exitCode = 1;
});
