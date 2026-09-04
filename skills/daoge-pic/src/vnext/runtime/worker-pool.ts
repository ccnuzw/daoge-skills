import path from 'node:path';
import os from 'node:os';
import { fork, ChildProcess } from 'node:child_process';
import { MAX_GLOBAL_CONCURRENCY } from '../studio/runtime-settings';

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
  pending: { resolve: (result: WorkerPoolTick) => void; reject: (error: Error) => void } | null;
}

const EMPTY_RESULT: WorkerPoolTick = { claimed: 0, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 };

export function generationWorkerPoolSize(parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length): number {
  return Math.max(1, parallelism - 1 || 1);
}

export class WorkerProcessPool {
  private readonly slots: WorkerSlot[] = [];
  private stopping = false;

  processIds(): number[] {
    return this.slots.flatMap((slot) => typeof slot.child.pid === 'number' && slot.child.pid > 0 ? [slot.child.pid] : []);
  }

  constructor(private readonly workspaceRoot: string, size = generationWorkerPoolSize()) {
    const entry = path.resolve(__dirname, '../runner/worker-process.js');
    for (let index = 0; index < size; index += 1) this.slots.push(this.startSlot(entry));
  }

  async processOnce(limit = MAX_GLOBAL_CONCURRENCY): Promise<WorkerPoolTick> {
    if (this.stopping) return EMPTY_RESULT;
    const ready = this.slots.filter((slot) => slot.ready && !slot.busy && slot.child.connected);
    if (!ready.length) return EMPTY_RESULT;
    const boundedLimit = Math.max(1, Math.min(MAX_GLOBAL_CONCURRENCY, Number(limit) || 1));
    const base = Math.floor(boundedLimit / ready.length);
    let remainder = boundedLimit % ready.length;
    const tasks: Promise<WorkerPoolTick>[] = [];
    for (const slot of ready) {
      const capacity = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      if (capacity < 1) continue;
      slot.busy = true;
      tasks.push(new Promise<WorkerPoolTick>((resolve, reject) => {
        slot.pending = { resolve, reject };
        slot.child.send?.({ type: 'tick', capacity }, (error) => {
          if (!error) return;
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
      const timeout = setTimeout(() => { slot.child.kill('SIGKILL'); resolve(); }, 3000);
      slot.child.once('exit', () => { clearTimeout(timeout); resolve(); });
      if (slot.pending) {
        slot.pending.reject(new Error('Worker pool is shutting down.'));
        slot.pending = null;
      }
      if (slot.child.connected) slot.child.send?.({ type: 'shutdown' });
      else if (slot.child.exitCode === null) slot.child.kill('SIGTERM');
      else { clearTimeout(timeout); resolve(); }
    }));
    await Promise.all(exits);
  }

  private startSlot(entry: string): WorkerSlot {
    const child = fork(entry, ['--workspace', this.workspaceRoot], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const slot: WorkerSlot = { child, ready: false, busy: false, pending: null };
    child.on('message', (message: { type?: unknown; result?: WorkerPoolTick; message?: unknown }) => {
      if (message?.type === 'ready') {
        slot.ready = true;
        return;
      }
      const pending = slot.pending;
      if (!pending) return;
      slot.pending = null;
      slot.busy = false;
      if (message?.type === 'tick-result' && message.result) pending.resolve(message.result);
      else pending.reject(new Error(typeof message?.message === 'string' ? message.message : 'Worker process failed.'));
    });
    child.on('exit', () => {
      slot.ready = false;
      slot.busy = false;
      if (slot.pending) {
        slot.pending.reject(new Error('Worker process exited.'));
        slot.pending = null;
      }
    });
    return slot;
  }
}
