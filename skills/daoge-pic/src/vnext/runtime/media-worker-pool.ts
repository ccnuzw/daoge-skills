import path from 'node:path';
import os from 'node:os';
import { ChildProcess, fork } from 'node:child_process';
import type { MediaReconciliationResult } from '../media/reconcile';

export interface MediaSourceIdentity {
  contentHash: string;
  byteSize: number;
  mediaType: string;
}

export interface AssetMediaSource extends MediaSourceIdentity {
  kind: 'asset';
  storagePath: string;
  bucket: 'imports' | 'generated' | 'exports' | 'trash';
}

export interface DeliveryMediaSource extends MediaSourceIdentity {
  kind: 'delivery';
  directoryPath: string;
  name: string;
}

export type MediaSource = AssetMediaSource | DeliveryMediaSource;

export interface MediaZipEntry {
  name: string;
  source: MediaSource;
}

export interface StagedMedia {
  stagingPath: string;
  mediaType: string;
  contentHash: string;
  byteSize: number;
}

export type MediaJob =
  | { type: 'thumbnail'; contentHash: string; source: MediaSource }
  | { type: 'zip'; entries: MediaZipEntry[]; maxEntries: number; maxAggregateBytes: number; maxEntryBytes: number }
  | { type: 'archive-staged'; staged: StagedMedia; assetId: string; bucket: 'imports' | 'generated' | 'exports' }
  | { type: 'reconcile'; studioId: string };

export type MediaJobResult =
  | { type: 'thumbnail'; contentHash: string; path: string }
  | { type: 'zip'; path: string; contentHash: string; byteSize: number }
  | { type: 'archive-staged'; absolutePath: string; storagePath: string; mediaType: string; contentHash: string; byteSize: number }
  | { type: 'reconcile'; result: MediaReconciliationResult };

interface PendingJob {
  id: string;
  job: MediaJob;
  resolve: (result: MediaJobResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort: () => void;
}

interface WorkerSlot {
  child: ChildProcess;
  ready: boolean;
  active: PendingJob | null;
}

function defaultPoolSize(): number {
  const parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
  return Math.max(1, parallelism - 1);
}

function abortError(): Error {
  const error = new Error('Media worker job was aborted.');
  error.name = 'AbortError';
  return error;
}

export class MediaProcessPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: PendingJob[] = [];
  private stopping = false;
  private sequence = 0;

  constructor(private readonly workspaceRoot: string, size = defaultPoolSize()) {
    const entry = path.resolve(__dirname, '../runner/media-worker-process.js');
    const workerCount = Math.max(1, Math.floor(size) || 1);
    for (let index = 0; index < workerCount; index += 1) this.slots.push(this.startSlot(entry));
  }

  processIds(): number[] {
    return this.slots.flatMap((slot) => typeof slot.child.pid === 'number' && slot.child.pid > 0 ? [slot.child.pid] : []);
  }

  run<T extends MediaJobResult>(job: MediaJob, signal?: AbortSignal): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('Media worker pool is shutting down.'));
    if (signal?.aborted) return Promise.reject(abortError());
    return new Promise<T>((resolve, reject) => {
      const pending: PendingJob = {
        id: 'media-' + process.pid + '-' + (++this.sequence),
        job,
        resolve: resolve as (result: MediaJobResult) => void,
        reject,
        signal,
        abort: () => this.abort(pending)
      };
      signal?.addEventListener('abort', pending.abort, { once: true });
      this.queue.push(pending);
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const error = new Error('Media worker pool is shutting down.');
    for (const pending of this.queue.splice(0)) this.finish(pending, error);
    const exits = this.slots.map((slot) => new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { slot.child.kill('SIGKILL'); resolve(); }, 3000);
      slot.child.once('exit', () => { clearTimeout(timeout); resolve(); });
      if (slot.active) {
        this.finish(slot.active, error);
        slot.active = null;
      }
      if (slot.child.connected) slot.child.send?.({ type: 'shutdown' });
      else if (slot.child.exitCode === null) slot.child.kill('SIGTERM');
      else { clearTimeout(timeout); resolve(); }
    }));
    await Promise.all(exits);
  }

  private startSlot(entry: string): WorkerSlot {
    const child = fork(entry, ['--workspace', this.workspaceRoot], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const slot: WorkerSlot = { child, ready: false, active: null };
    child.on('message', (message: { type?: unknown; jobId?: unknown; result?: MediaJobResult; message?: unknown }) => {
      if (message?.type === 'ready') {
        slot.ready = true;
        this.dispatch();
        return;
      }
      const pending = slot.active;
      if (!pending || message?.jobId !== pending.id) return;
      slot.active = null;
      this.finish(pending, message.type === 'media-result' && message.result ? undefined : new Error(typeof message.message === 'string' ? message.message : 'Media worker failed.'), message.result);
      this.dispatch();
    });
    child.on('error', (error) => this.failSlot(slot, error));
    child.on('exit', () => this.failSlot(slot, new Error('Media worker process exited.')));
    return slot;
  }

  private dispatch(): void {
    if (this.stopping) return;
    for (const slot of this.slots) {
      const pending = this.queue[0];
      if (!pending || !slot.ready || slot.active || !slot.child.connected) continue;
      this.queue.shift();
      if (pending.signal?.aborted) {
        this.finish(pending, abortError());
        continue;
      }
      slot.active = pending;
      try {
        slot.child.send?.({ type: 'media-job', jobId: pending.id, job: pending.job }, (error) => {
          if (error && slot.active === pending) {
            slot.active = null;
            this.finish(pending, error);
            this.dispatch();
          }
        });
      } catch (error) {
        slot.active = null;
        this.finish(pending, error instanceof Error ? error : new Error('Unable to send media worker job.'));
      }
    }
  }

  private abort(pending: PendingJob): void {
    const queuedIndex = this.queue.indexOf(pending);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.finish(pending, abortError());
      return;
    }
    const slot = this.slots.find((candidate) => candidate.active === pending);
    if (slot?.child.connected) slot.child.send?.({ type: 'cancel', jobId: pending.id });
  }

  private failSlot(slot: WorkerSlot, error: Error): void {
    slot.ready = false;
    if (slot.active) {
      this.finish(slot.active, error);
      slot.active = null;
    }
    if (this.slots.every((candidate) => !candidate.ready && !candidate.active)) {
      for (const pending of this.queue.splice(0)) this.finish(pending, error);
    }
  }

  private finish(pending: PendingJob, error?: unknown, result?: MediaJobResult): void {
    pending.signal?.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error instanceof Error ? error : new Error('Media worker failed.'));
    else if (result) pending.resolve(result);
    else pending.reject(new Error('Media worker returned no result.'));
  }
}
