import path from 'node:path';
import os from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';
import type { MediaReconciliationResult } from '../media/reconcile';
import { safeErrorSummary } from '../shared/safe-error';
import type { ProcessPoolHealth, ProcessPoolState } from './worker-pool';

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
  | { type: 'reconcile'; studioId: string; recoverAssetOperations?: boolean };

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
  timeout: NodeJS.Timeout | undefined;
  abort: () => void;
}

interface WorkerSlot {
  child: ChildProcess;
  ready: boolean;
  active: PendingJob | null;
  entry: string;
  restartTimer: NodeJS.Timeout | null;
  healthyTimer: NodeJS.Timeout | undefined;
  restartAttempts: number;
  failed: boolean;
}
const MAX_MEDIA_WORKER_POOL_SIZE = 4;
const MAX_MEDIA_QUEUE_LENGTH = 256;
const MEDIA_HEALTHY_WINDOW_MS = 30 * 1000;
const MEDIA_JOB_TIMEOUT_MS = 15 * 60 * 1000;

function defaultPoolSize(parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length): number {
  return Math.max(1, Math.min(MAX_MEDIA_WORKER_POOL_SIZE, parallelism - 1));
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
  private activated = false;
  private exhausted = false;
  private restartCount = 0;
  private lastError: string | null = null;
  private readonly entry: string;
  private readonly maxSize: number;

  constructor(private readonly workspaceRoot: string, size = defaultPoolSize()) {
    this.entry = path.resolve(__dirname, '../runner/media-worker-process.js');
    this.maxSize = Math.max(1, Math.min(MAX_MEDIA_WORKER_POOL_SIZE, Math.floor(size) || 1));
  }

  processIds(): number[] {
    return this.slots.flatMap((slot) => typeof slot.child.pid === 'number' && slot.child.pid > 0 ? [slot.child.pid] : []);
  }
  healthSnapshot(): ProcessPoolHealth {
    const readyCount = this.slots.filter((slot) => slot.ready).length;
    const busyCount = this.slots.filter((slot) => slot.active).length;
    const state: ProcessPoolState = this.stopping ? 'stopping' : this.exhausted ? 'failed' : !this.activated ? 'idle' : readyCount === 0 ? 'starting' : this.slots.some((slot) => slot.failed || slot.restartAttempts > 0) ? 'degraded' : 'ready';
    return { state, targetSize: this.maxSize, processCount: this.processIds().length, readyCount, busyCount, queuedCount: this.queue.length, restartCount: this.restartCount, lastError: this.lastError };
  }

  run<T extends MediaJobResult>(job: MediaJob, signal?: AbortSignal): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('Media worker pool is shutting down.'));
    if (this.exhausted) return Promise.reject(new Error('Media worker pool is unavailable until the Studio daemon restarts.'));
    this.activated = true;
    if (signal?.aborted) return Promise.reject(abortError());
    if (this.queue.length >= MAX_MEDIA_QUEUE_LENGTH) return Promise.reject(new Error('Media worker queue is full; retry after current work completes.'));
    return new Promise<T>((resolve, reject) => {
      const pending: PendingJob = {
        id: 'media-' + process.pid + '-' + (++this.sequence),
        job,
        resolve: resolve as (result: MediaJobResult) => void,
        reject,
        signal,
        timeout: undefined,
        abort: () => this.abort(pending)
      };
      signal?.addEventListener('abort', pending.abort, { once: true });
      this.queue.push(pending);
      this.ensureCapacity();
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const error = new Error('Media worker pool is shutting down.');
    for (const pending of this.queue.splice(0)) this.finish(pending, error);
    const exits = this.slots.map((slot) => new Promise<void>((resolve) => {
      if (slot.restartTimer) {
        clearTimeout(slot.restartTimer);
        slot.restartTimer = null;
      }
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

  private ensureCapacity(): void {
    if (this.stopping || this.exhausted) return;
    const active = this.slots.filter((slot) => slot.active).length;
    const target = Math.min(this.maxSize, Math.max(1, this.queue.length + active));
    while (this.slots.length < target) this.slots.push(this.startSlot(this.entry));
  }

  private startSlot(entry: string, restartAttempts = 0): WorkerSlot {
    const child = spawn(process.execPath, [entry, '--workspace', this.workspaceRoot], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    const slot: WorkerSlot = { child, ready: false, active: null, entry, restartTimer: null, healthyTimer: undefined, restartAttempts, failed: false };
    child.on('message', (message: { type?: unknown; jobId?: unknown; result?: MediaJobResult; message?: unknown }) => {
      if (message?.type === 'ready') {
        slot.ready = true;
        this.lastError = null;
        clearTimeout(slot.healthyTimer);
        slot.healthyTimer = setTimeout(() => { slot.restartAttempts = 0; slot.healthyTimer = undefined; }, MEDIA_HEALTHY_WINDOW_MS);
        this.dispatch();
        return;
      }
      if (message?.type === 'fatal') {
        this.failSlot(slot, new Error(typeof message.message === 'string' ? message.message : 'Media worker failed during startup.'));
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
      pending.timeout = setTimeout(() => this.failSlot(slot, new Error('Media worker job watchdog expired.')), MEDIA_JOB_TIMEOUT_MS);
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
    if (slot.failed) return;
    slot.failed = true;
    slot.ready = false;
    this.lastError = safeErrorSummary(error.message) || 'Media worker process failed.';
    clearTimeout(slot.healthyTimer);
    slot.healthyTimer = undefined;
    if (slot.active) {
      this.finish(slot.active, error);
      slot.active = null;
    }
    if (this.stopping) return;
    if (slot.child.exitCode === null && slot.child.signalCode === null) slot.child.kill(error.message === 'Media worker job watchdog expired.' ? 'SIGKILL' : 'SIGTERM');
    if (slot.restartAttempts >= 8) {
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots.splice(index, 1);
      this.exhausted = true;
      for (const pending of this.queue.splice(0)) this.finish(pending, new Error('Media worker pool is unavailable after repeated child-process failures.'));
      return;
    }
    const delay = Math.min(30000, 100 * 2 ** Math.min(slot.restartAttempts, 8));
    const nextAttempts = slot.restartAttempts + 1;
    this.restartCount += 1;
    slot.restartTimer = setTimeout(() => {
      slot.restartTimer = null;
      if (this.stopping) return;
      const index = this.slots.indexOf(slot);
      if (index < 0) return;
      this.slots[index] = this.startSlot(slot.entry, nextAttempts);
    }, delay);
  }

  private finish(pending: PendingJob, error?: unknown, result?: MediaJobResult): void {
    clearTimeout(pending.timeout);
    pending.timeout = undefined;
    pending.signal?.removeEventListener('abort', pending.abort);
    if (error) pending.reject(error instanceof Error ? error : new Error('Media worker failed.'));
    else if (result) pending.resolve(result);
    else pending.reject(new Error('Media worker returned no result.'));
  }
}
