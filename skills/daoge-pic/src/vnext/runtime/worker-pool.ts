import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';
import { MAX_GLOBAL_CONCURRENCY, MAX_PROVIDER_CONCURRENCY } from '../studio/runtime-settings';
import { ProviderConcurrencyGovernor, ProviderConcurrencySnapshot, ProviderHealthSample, ProviderConcurrencyState } from './provider-concurrency';
import type { ResolvedProviderConfig } from '../studio/provider-config';
import { safeErrorSummary } from '../shared/safe-error';
import { closeStudioDatabase, openStudioDatabase, withTransaction, type StudioDatabase } from '../studio/database';
import { attachStudio } from '../studio/workspace';
import { nowIso } from '../shared/ids';

export interface WorkerPoolTick {
  claimed: number;
  succeeded: number;
  retrying: number;
  blocked: number;
  unknown: number;
  cancelled: number;
}
interface WorkerTickResponse {
  result: WorkerPoolTick;
  providerStats?: ProviderHealthSample;
}

export type ProcessPoolState = 'idle' | 'starting' | 'ready' | 'degraded' | 'failed' | 'stopping';
export interface ProcessPoolHealth {
  state: ProcessPoolState;
  targetSize: number;
  processCount: number;
  readyCount: number;
  busyCount: number;
  queuedCount: number;
  leaseRiskCount?: number;
  restartCount: number;
  lastError: string | null;
  dispatchReason?: 'not_started' | 'dispatched' | 'no_work' | 'starting' | 'backoff' | 'failed' | 'stopping';
  lastTickAt?: string | null;
  lastTickDurationMs?: number | null;
  lastTickResult?: WorkerPoolTick | null;
}

interface WorkerSlot {
  child: ChildProcess;
  ready: boolean;
  busy: boolean;
  pending: { resolve: (result: WorkerTickResponse) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout | undefined } | null;
  entry: string;
  restartTimer: NodeJS.Timeout | null;
  healthyTimer: NodeJS.Timeout | undefined;
  restartAttempts: number;
  failed: boolean;
}
export const MAX_GENERATION_WORKER_POOL_SIZE = 8;

export function generationWorkerPoolSize(parallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length): number {
  return Math.max(1, Math.min(MAX_GENERATION_WORKER_POOL_SIZE, parallelism - 1 || 1));
}
const EMPTY_RESULT: WorkerPoolTick = { claimed: 0, succeeded: 0, retrying: 0, blocked: 0, unknown: 0, cancelled: 0 };
const EMPTY_PROVIDER_STATS: ProviderHealthSample = { succeeded: 0, rateLimited: 0, transient: 0, unknown: 0, otherFailure: 0, maxRssBytes: 0, maxExternalBytes: 0 };
const WORKER_TICK_TIMEOUT_MS = 12 * 60 * 1000;
const WORKER_HEALTHY_WINDOW_MS = 30 * 1000;
const MAX_RESTART_ATTEMPTS = 8;
function nonNegativeMetric(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}


export class WorkerProcessPool {
  private readonly slots: WorkerSlot[] = [];
  private stopping = false;
  private activated = false;
  private exhausted = false;
  private restartCount = 0;
  private readonly maxSize: number;
  private readonly entry: string;
  private readonly governor = new ProviderConcurrencyGovernor(MAX_PROVIDER_CONCURRENCY);
  private readonly providerStateDb: StudioDatabase | null;
  private readonly providerStateIdentity: { studioId: string; profileId: string; configVersion: number } | null;
  private providerStateUnavailable = false;
  private providerStateProbed = false;
  private lastError: string | null = null;
  private retiring = false;
  private readonly providerConfig: ResolvedProviderConfig | null;
  private queueDepth = 0;
  private leaseRiskCount = 0;
  private dispatchReason: ProcessPoolHealth['dispatchReason'] = 'not_started';
  private lastTickAt: string | null = null;
  private lastTickDurationMs: number | null = null;
  private lastTickResult: WorkerPoolTick | null = null;

  processIds(): number[] {
    return this.slots.flatMap((slot) => typeof slot.child.pid === 'number' && slot.child.pid > 0 ? [slot.child.pid] : []);
  }
  concurrencySnapshot(): ProviderConcurrencySnapshot {
    return this.governor.snapshot();
  }
  updateQueueMetrics(queueDepth: number, leaseRiskCount = 0): void {
    this.queueDepth = nonNegativeMetric(queueDepth);
    this.leaseRiskCount = nonNegativeMetric(leaseRiskCount);
  }
  healthSnapshot(): ProcessPoolHealth {
    const readyCount = this.slots.filter((slot) => slot.ready).length;
    const busyCount = this.slots.filter((slot) => slot.busy).length;
    const state: ProcessPoolState = this.stopping ? 'stopping' : this.providerStateUnavailable && this.providerConfig ? 'failed' : this.exhausted ? 'failed' : !this.activated ? 'idle' : readyCount === 0 ? 'starting' : this.slots.some((slot) => slot.failed || slot.restartAttempts > 0) ? 'degraded' : 'ready';
    return { state, targetSize: this.maxSize, processCount: this.processIds().length, readyCount, busyCount, queuedCount: this.queueDepth, leaseRiskCount: this.leaseRiskCount, restartCount: this.restartCount, lastError: this.lastError, dispatchReason: this.dispatchReason, lastTickAt: this.lastTickAt, lastTickDurationMs: this.lastTickDurationMs, lastTickResult: this.lastTickResult };
  }

  private probeProviderState(): boolean {
    if (this.providerStateProbed) return !this.providerStateUnavailable;
    this.providerStateProbed = true;
    this.persistProviderState();
    return !this.providerStateUnavailable;
  }

  retire(): void {
    this.retiring = true;
  }

  constructor(private readonly workspaceRoot: string, size = generationWorkerPoolSize(), providerConfig: ResolvedProviderConfig | null = null) {
    this.entry = path.resolve(__dirname, '../runner/worker-process.js');
    this.maxSize = Math.max(1, Math.min(MAX_GENERATION_WORKER_POOL_SIZE, Math.floor(size) || 1));
    this.providerConfig = providerConfig;
    let stateDb: StudioDatabase | null = null;
    let stateIdentity: { studioId: string; profileId: string; configVersion: number } | null = null;
    try {
      if (providerConfig) {
        if (!fs.existsSync(path.join(workspaceRoot, 'daoge-studio', 'studio.db'))) throw new Error('Studio database is missing; Provider concurrency state cannot be loaded.');
        const initialized = attachStudio(workspaceRoot);
        stateDb = openStudioDatabase(initialized.paths, initialized.manifest, { skipIntegrityCheck: true, attachOnly: true });
        stateIdentity = { studioId: initialized.manifest.studioId, profileId: providerConfig.profileId, configVersion: providerConfig.configVersion };
        const row = stateDb.prepare('SELECT target, cooldown_until_ms, last_adjustment_at_ms, last_reason, max_observed_rss_bytes, max_observed_external_bytes FROM provider_concurrency_state WHERE studio_id = ? AND profile_id = ? AND config_version = ?').get(stateIdentity.studioId, stateIdentity.profileId, stateIdentity.configVersion) as Record<string, unknown> | undefined;
        if (row) this.governor.restore({ target: Number(row.target), cooldownUntilMs: Number(row.cooldown_until_ms), lastAdjustmentAtMs: Number(row.last_adjustment_at_ms), lastReason: String(row.last_reason) as ProviderConcurrencyState['lastReason'], maxObservedRssBytes: Number(row.max_observed_rss_bytes), maxObservedExternalBytes: Number(row.max_observed_external_bytes) });
      }
    } catch (error) {
      closeStudioDatabase(stateDb);
      stateDb = null;
      stateIdentity = null;
      this.providerStateUnavailable = true;
      this.lastError = safeErrorSummary(error instanceof Error ? error.message : 'Provider concurrency state could not be loaded.') || null;
      this.dispatchReason = 'failed';
    }
    this.providerStateDb = stateDb;
    this.providerStateIdentity = stateIdentity;
  }
  private persistProviderState(): void {
    const db = this.providerStateDb;
    const identity = this.providerStateIdentity;
    if (this.providerStateUnavailable || !db || !identity) return;
    const state = this.governor.persistedState();
    try {
      withTransaction(db, () => {
        db.prepare('INSERT INTO provider_concurrency_state (studio_id, profile_id, config_version, target, cooldown_until_ms, last_adjustment_at_ms, last_reason, max_observed_rss_bytes, max_observed_external_bytes, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(studio_id, profile_id, config_version) DO UPDATE SET target = excluded.target, cooldown_until_ms = excluded.cooldown_until_ms, last_adjustment_at_ms = excluded.last_adjustment_at_ms, last_reason = excluded.last_reason, max_observed_rss_bytes = excluded.max_observed_rss_bytes, max_observed_external_bytes = excluded.max_observed_external_bytes, updated_at = excluded.updated_at').run(identity.studioId, identity.profileId, identity.configVersion, state.target, state.cooldownUntilMs, state.lastAdjustmentAtMs, state.lastReason, state.maxObservedRssBytes, state.maxObservedExternalBytes, nowIso());
      });
    } catch (error) {
      this.providerStateUnavailable = true;
      this.lastError = safeErrorSummary(error instanceof Error ? error.message : 'Provider concurrency state could not be saved.') || null;
      this.dispatchReason = 'failed';
    }
  }

  async processOnce(limit = MAX_GLOBAL_CONCURRENCY): Promise<WorkerPoolTick> {
    const startedAt = Date.now();
    if (this.stopping) {
      this.dispatchReason = 'stopping';
      this.recordTick(EMPTY_RESULT, startedAt);
      return EMPTY_RESULT;
    }
    this.activated = true;
    if (!this.probeProviderState()) {
      this.dispatchReason = 'failed';
      this.recordTick(EMPTY_RESULT, startedAt);
      return EMPTY_RESULT;
    }
    if (this.providerStateUnavailable) {
      this.dispatchReason = 'failed';
      this.recordTick(EMPTY_RESULT, startedAt);
      return EMPTY_RESULT;
    }
    this.ensureCapacity(1);
    const ready = this.slots.filter((slot) => slot.ready && !slot.busy && slot.child.connected);
    if (!ready.length) {
      this.dispatchReason = 'starting';
      this.recordTick(EMPTY_RESULT, startedAt);
      return EMPTY_RESULT;
    }
    const requestedLimit = Math.max(1, Math.min(MAX_GLOBAL_CONCURRENCY, Number(limit) || 1));
    const boundedLimit = this.governor.capacity(requestedLimit);
    if (!boundedLimit) {
      this.dispatchReason = 'backoff';
      this.recordTick(EMPTY_RESULT, startedAt);
      return EMPTY_RESULT;
    }
    const base = Math.floor(boundedLimit / ready.length);
    let remainder = boundedLimit % ready.length;
    const tasks: Promise<WorkerTickResponse>[] = [];
    for (const slot of ready) {
      const capacity = base + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
      if (capacity < 1) continue;
      slot.busy = true;
      tasks.push(new Promise<WorkerTickResponse>((resolve, reject) => {
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
    this.governor.begin(boundedLimit);
    try {
      const responses = await Promise.all(tasks);
      const providerStats = responses.reduce((total, response) => {
        const sample = response.providerStats || EMPTY_PROVIDER_STATS;
        return {
          succeeded: total.succeeded + (Number(sample.succeeded) || 0),
          rateLimited: total.rateLimited + (Number(sample.rateLimited) || 0),
          transient: total.transient + (Number(sample.transient) || 0),
          unknown: total.unknown + (Number(sample.unknown) || 0),
          otherFailure: total.otherFailure + (Number(sample.otherFailure) || 0),
          maxRssBytes: Math.max(total.maxRssBytes, Number(sample.maxRssBytes) || 0),
          maxExternalBytes: Math.max(total.maxExternalBytes, Number(sample.maxExternalBytes) || 0)
        };
      }, { ...EMPTY_PROVIDER_STATS });
      this.governor.record(providerStats);
      this.persistProviderState();
      const result = responses.reduce((total, response) => {
        const tick = response.result;
        return { claimed: total.claimed + tick.claimed, succeeded: total.succeeded + tick.succeeded, retrying: total.retrying + tick.retrying, blocked: total.blocked + tick.blocked, unknown: total.unknown + tick.unknown, cancelled: total.cancelled + tick.cancelled };
      }, { ...EMPTY_RESULT });
      this.dispatchReason = this.providerStateUnavailable ? 'failed' : result.claimed === 0 && this.queueDepth === 0 ? 'no_work' : 'dispatched';
      this.recordTick(result, startedAt);
      if (!this.retiring && result.claimed >= boundedLimit && this.slots.length < this.maxSize) this.ensureCapacity(this.slots.length + 1);
      return result;
    } catch (error) {
      this.dispatchReason = 'failed';
      this.recordTick(EMPTY_RESULT, startedAt);
      this.governor.record({ ...EMPTY_PROVIDER_STATS, unknown: 1 });
      this.persistProviderState();
      throw error;
    }
  }
  private recordTick(result: WorkerPoolTick, startedAt: number): void {
    this.lastTickAt = new Date().toISOString();
    this.lastTickDurationMs = Math.max(0, Date.now() - startedAt);
    this.lastTickResult = { ...result };
  }

  async close(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.dispatchReason = 'stopping';
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
    this.persistProviderState();
    closeStudioDatabase(this.providerStateDb);
  }

  private ensureCapacity(target: number): void {
    if (this.stopping || this.exhausted) return;
    const bounded = Math.min(this.maxSize, Math.max(1, target));
    while (this.slots.length < bounded) this.slots.push(this.startSlot(this.entry));
  }
  private startSlot(entry: string, restartAttempts = 0): WorkerSlot {
    const args = [entry, '--workspace', this.workspaceRoot];
    if (this.providerConfig) args.push('--provider-profile-id', this.providerConfig.profileId, '--provider-config-version', String(this.providerConfig.configVersion), '--provider-config-ipc');
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    const slot: WorkerSlot = { child, ready: false, busy: false, pending: null, entry, restartTimer: null, healthyTimer: undefined, restartAttempts, failed: false };
    child.on('message', (message: { type?: unknown; result?: WorkerPoolTick; providerStats?: ProviderHealthSample; message?: unknown }) => {
      if (message?.type === 'ready') {
        slot.ready = true;
        this.lastError = null;
        clearTimeout(slot.healthyTimer);
        slot.healthyTimer = setTimeout(() => { slot.restartAttempts = 0; slot.healthyTimer = undefined; }, WORKER_HEALTHY_WINDOW_MS);
        return;
      }
      if (message?.type === 'fatal') {
        this.failSlot(slot, new Error(typeof message.message === 'string' ? message.message : 'Worker process failed during startup.'));
        return;
      }
      const pending = slot.pending;
      if (!pending) return;
      slot.pending = null;
      slot.busy = false;
      clearTimeout(pending.timeout);
      if (message?.type === 'tick-result' && message.result) pending.resolve({ result: message.result, providerStats: message.providerStats });
      else pending.reject(new Error(typeof message?.message === 'string' ? message.message : 'Worker process failed.'));
    });
    child.on('error', (error) => this.failSlot(slot, error));
    child.on('exit', () => this.failSlot(slot, new Error('Worker process exited.')));
    if (this.providerConfig) {
      child.once('spawn', () => {
        if (!child.connected) return this.failSlot(slot, new Error('Worker process IPC channel is unavailable.'));
        child.send?.({ type: 'configure-provider', config: this.providerConfig }, (error) => {
          if (error) this.failSlot(slot, error);
        });
      });
    }
    return slot;
  }

  private failSlot(slot: WorkerSlot, error: Error): void {
    if (slot.failed) return;
    slot.failed = true;
    slot.ready = false;
    slot.busy = false;
    this.lastError = safeErrorSummary(error.message) || 'Worker process failed.';
    clearTimeout(slot.healthyTimer);
    slot.healthyTimer = undefined;
    if (slot.pending) {
      clearTimeout(slot.pending.timeout);
      slot.pending.reject(error);
      slot.pending = null;
    }
    if (this.stopping) return;
    if (slot.child.exitCode === null && slot.child.signalCode === null) slot.child.kill(error.message === 'Worker tick watchdog expired.' ? 'SIGKILL' : 'SIGTERM');
    if (slot.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots.splice(index, 1);
      this.exhausted = true;
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
      const replacement = this.startSlot(slot.entry, nextAttempts);
      this.slots[index] = replacement;
      this.dispatchAfterRestart();
    }, delay);
  }

  private dispatchAfterRestart(): void {
    if (!this.stopping) this.processOnce().catch(() => undefined);
  }
}
