import path from 'node:path';
import os from 'node:os';
import { fork, ChildProcess } from 'node:child_process';
import { MAX_ACTIVE_PROVIDER_REQUESTS, MAX_GLOBAL_CONCURRENCY } from '../studio/runtime-settings';

export interface WorkerPoolTick {
  claimed: number;
  succeeded: number;
  retrying: number;
  blocked: number;
  unknown: number;
  cancelled: number;
}

interface WorkerSlot {
  child: ChildProcess;
  ready: boolean;
  busy: boolean;
  pending: { resolve: (result: WorkerPoolTick) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout | undefined } | null;
  entry: string;
  restartTimer: NodeJS.Timeout | null;
  healthyTimer: NodeJS.Timeout | undefined;
  restartAttempts: number;
  failed: boolean;
}

export const MAX_GENERATION_WORKER_POOL_SIZE = 8;
const EMPTY_RESULT: WorkerPoolTick = { claimed: 0, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 };
const WORKER_TICK_TIMEOUT_MS = 12 * 60 * 1000;
const WORKER_HEALTHY_WINDOW_MS = 30 * 1000;
const MAX_RESTART_ATTEMPTS = 8;
export function generationWorkerPoolSize(parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length): number {
  return Math.max(1, Math.min(MAX_GENERATION_WORKER_POOL_SIZE, parallelism - 1 || 1));
}

export class WorkerProcessPool {
  private readonly slots: WorkerSlot[] = [];
  private stopping = false;

  processIds(): number[] {
    return this.slots.flatMap((slot) => typeof slot.child.pid === 'number' && slot.child.pid > 0 ? [slot.child.pid] : []);
  }

  constructor(private readonly workspaceRoot: string, size = generationWorkerPoolSize()) {
    const entry = path.resolve(__dirname, '../runner/worker-process.js');
    const workerCount = Math.max(1, Math.min(MAX_GENERATION_WORKER_POOL_SIZE, Math.floor(size) || 1));
    for (let index = 0; index < workerCount; index += 1) this.slots.push(this.startSlot(entry));
  }

  async processOnce(limit = MAX_GLOBAL_CONCURRENCY): Promise<WorkerPoolTick> {
    if (this.stopping) return EMPTY_RESULT;
    const ready = this.slots.filter((slot) => slot.ready && !slot.busy && slot.child.connected);
    if (!ready.length) return EMPTY_RESULT;
    const boundedLimit = Math.max(1, Math.min(MAX_ACTIVE_PROVIDER_REQUESTS, MAX_GLOBAL_CONCURRENCY, Number(limit) || 1));
    const base = Math.floor(boundedLimit / ready.length);
    let remainder = boundedLimit % ready.length;
    const tasks: Promise<WorkerPoolTick>[] = [];
    for (const slot of ready) {
      const capacity = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      if (capacity < 1) continue;
      slot.busy = true;
      tasks.push(new Promise<WorkerPoolTick>((resolve, reject) => {
        const timeout = setTimeout(() => this.failSlot(slot, new Error('Worker tick watchdog expired.')), WORKER_TICK_TIMEOUT_MS);
        slot.pending = { resolve, reject, timeout };
        slot.child.send?.({ type: 'tick', capacity, globalLimit: boundedLimit }, (error) => {
          if (!error) return;
          clearTimeout(timeout);
          slot.busy = false;
          slot.pending = null;
          reject(error);
        });
      }));
    }
    const results = await Promise.all(tasks);
    return results.reduce((total, result) => ({ claimed: total.claimed + result.claimed, succeeded: total.succeeded + result.succeeded, retrying: total.retrying + result.retrying, blocked: total.blocked + result.blocked, unknown: total.unknown + result.unknown, cancelled: total.cancelled + result.cancelled }), { ...EMPTY_RESULT });
  }

  async close(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const exits = this.slots.map((slot) => new Promise<void>((resolve) => {
      if (slot.restartTimer) {
        clearTimeout(slot.restartTimer);
        slot.restartTimer = null;
      }
      const timeout = setTimeout(() => { slot.child.kill('SIGKILL'); resolve(); }, 3000);
      slot.child.once('exit', () => { clearTimeout(timeout); resolve(); });
      if (slot.pending) {
        clearTimeout(slot.pending.timeout);
        slot.pending.reject(new Error('Worker pool is shutting down.'));
        slot.pending = null;
      }
      if (slot.child.connected) slot.child.send?.({ type: 'shutdown' });
      else if (slot.child.exitCode === null) slot.child.kill('SIGTERM');
      else { clearTimeout(timeout); resolve(); }
    }));
    await Promise.all(exits);
  }

  private startSlot(entry: string, restartAttempts = 0): WorkerSlot {
    const child = fork(entry, ['--workspace', this.workspaceRoot], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const slot: WorkerSlot = { child, ready: false, busy: false, pending: null, entry, restartTimer: null, healthyTimer: undefined, restartAttempts, failed: false };
    child.on('message', (message: { type?: unknown; result?: WorkerPoolTick; message?: unknown }) => {
      if (message?.type === 'ready') {
        slot.ready = true;
        clearTimeout(slot.healthyTimer);
        slot.healthyTimer = setTimeout(() => { slot.restartAttempts = 0; slot.healthyTimer = undefined; }, WORKER_HEALTHY_WINDOW_MS);
        return;
      }
      const pending = slot.pending;
      if (!pending) return;
      slot.pending = null;
      slot.busy = false;
      clearTimeout(pending.timeout);
      if (message?.type === 'tick-result' && message.result) pending.resolve(message.result);
      else pending.reject(new Error(typeof message?.message === 'string' ? message.message : 'Worker process failed.'));
    });
    child.on('error', (error) => this.failSlot(slot, error));
    child.on('exit', () => this.failSlot(slot, new Error('Worker process exited.')));
    return slot;
  }

  private failSlot(slot: WorkerSlot, error: Error): void {
    if (slot.failed) return;
    slot.failed = true;
    slot.ready = false;
    slot.busy = false;
    clearTimeout(slot.healthyTimer);
    slot.healthyTimer = undefined;
    if (slot.pending) {
      clearTimeout(slot.pending.timeout);
      slot.pending.reject(error);
      slot.pending = null;
    }
    if (this.stopping) return;
    if (slot.child.exitCode === null && slot.child.signalCode === null) slot.child.kill(error.message === 'Worker tick watchdog expired.' ? 'SIGKILL' : 'SIGTERM');
    if (slot.restartAttempts >= MAX_RESTART_ATTEMPTS) return;
    const delay = Math.min(30000, 100 * 2 ** Math.min(slot.restartAttempts, 8));
    const nextAttempts = slot.restartAttempts + 1;
    slot.restartTimer = setTimeout(() => {
      slot.restartTimer = null;
      if (this.stopping) return;
      const index = this.slots.indexOf(slot);
      if (index < 0) return;
      const replacement = this.startSlot(slot.entry, nextAttempts);
      this.slots[index] = replacement;
      this.dispatchAfterRestart();
    }, delay);
  }

  private dispatchAfterRestart(): void {
    if (!this.stopping) this.processOnce().catch(() => undefined);
  }
}
