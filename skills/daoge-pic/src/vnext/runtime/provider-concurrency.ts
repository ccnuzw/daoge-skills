import os from 'node:os';
import { MAX_PROVIDER_CONCURRENCY } from '../studio/runtime-settings';

export const INITIAL_PROVIDER_CONCURRENCY = 16;
export const MIN_PROVIDER_CONCURRENCY = 1;
export const PROVIDER_CONCURRENCY_ADJUSTMENT_MS = 5000;
export const PROVIDER_RATE_LIMIT_COOLDOWN_MS = 30000;
export const PROVIDER_TRANSIENT_COOLDOWN_MS = 10000;
export const PROVIDER_MEMORY_PRESSURE_COOLDOWN_MS = 15000;

export type ProviderOutcome = 'success' | 'rate_limited' | 'transient' | 'unknown' | 'other_failure';

export interface ProviderHealthSample {
  succeeded: number;
  rateLimited: number;
  transient: number;
  unknown: number;
  otherFailure: number;
  maxRssBytes: number;
  maxExternalBytes: number;
}

export interface ProviderConcurrencySnapshot {
  max: number;
  target: number;
  active: number;
  lastReason: 'warmup' | 'healthy' | 'rate_limited' | 'transient' | 'unknown' | 'memory_pressure';
  cooldownUntil: string | null;
  maxObservedRssBytes: number;
  maxObservedExternalBytes: number;
}

const MiB = 1024 * 1024;
const memoryPressureBytes = Math.max(512 * MiB, Math.min(2 * 1024 * MiB, Math.floor(os.totalmem() * 0.1)));

function normalizedRequested(value: number, max: number): number {
  return Math.max(MIN_PROVIDER_CONCURRENCY, Math.min(max, Number.isInteger(value) ? value : MIN_PROVIDER_CONCURRENCY));
}

export class ProviderConcurrencyGovernor {
  private target: number;
  private active = 0;
  private cooldownUntilMs = 0;
  private lastAdjustmentAt = 0;
  private lastReason: ProviderConcurrencySnapshot['lastReason'] = 'warmup';
  private maxObservedRssBytes = 0;
  private maxObservedExternalBytes = 0;

  constructor(
    private readonly max = MAX_PROVIDER_CONCURRENCY,
    private readonly now: () => number = () => Date.now(),
    initial = INITIAL_PROVIDER_CONCURRENCY
  ) {
    if (!Number.isInteger(max) || max < MIN_PROVIDER_CONCURRENCY) throw new Error('Provider concurrency maximum must be a positive integer.');
    this.target = Math.max(MIN_PROVIDER_CONCURRENCY, Math.min(max, Math.floor(initial) || MIN_PROVIDER_CONCURRENCY));
  }

  capacity(requested: number): number {
    if (this.cooldownUntilMs > this.now()) return 0;
    const normalized = normalizedRequested(requested, this.max);
    return Math.min(normalized, this.target);
  }

  begin(granted: number): void {
    this.active += Math.max(0, Math.floor(granted) || 0);
  }

  record(sample: ProviderHealthSample): void {
    this.active = 0;
    this.maxObservedRssBytes = Math.max(this.maxObservedRssBytes, Math.max(0, Number(sample.maxRssBytes) || 0));
    this.maxObservedExternalBytes = Math.max(this.maxObservedExternalBytes, Math.max(0, Number(sample.maxExternalBytes) || 0));
    const now = this.now();
    const memoryPressure = Math.max(0, Number(sample.maxRssBytes) || 0) >= memoryPressureBytes || Math.max(0, Number(sample.maxExternalBytes) || 0) >= memoryPressureBytes;
    const hasRateLimit = sample.rateLimited > 0;
    const hasTransient = sample.transient > 0;
    const hasUnknown = sample.unknown > 0;
    if (memoryPressure) {
      this.target = Math.max(MIN_PROVIDER_CONCURRENCY, Math.floor(this.target / 2));
      this.cooldownUntilMs = now + PROVIDER_MEMORY_PRESSURE_COOLDOWN_MS;
      this.lastReason = 'memory_pressure';
      this.lastAdjustmentAt = now;
      return;
    }
    if (hasRateLimit) {
      this.target = Math.max(MIN_PROVIDER_CONCURRENCY, Math.floor(this.target / 2));
      this.cooldownUntilMs = now + PROVIDER_RATE_LIMIT_COOLDOWN_MS;
      this.lastReason = 'rate_limited';
      this.lastAdjustmentAt = now;
      return;
    }
    if (hasTransient || hasUnknown) {
      this.target = Math.max(MIN_PROVIDER_CONCURRENCY, Math.floor(this.target * 0.75));
      this.cooldownUntilMs = now + PROVIDER_TRANSIENT_COOLDOWN_MS;
      this.lastReason = hasUnknown ? 'unknown' : 'transient';
      this.lastAdjustmentAt = now;
      return;
    }
    if (sample.succeeded > 0 && now >= this.cooldownUntilMs && now - this.lastAdjustmentAt >= PROVIDER_CONCURRENCY_ADJUSTMENT_MS) {
      this.target = Math.min(this.max, this.target + Math.max(1, Math.ceil(this.target * 0.25)));
      this.lastReason = 'healthy';
      this.lastAdjustmentAt = now;
    }
  }

  snapshot(): ProviderConcurrencySnapshot {
    return {
      max: this.max,
      target: this.target,
      active: this.active,
      lastReason: this.lastReason,
      cooldownUntil: this.cooldownUntilMs > this.now() ? new Date(this.cooldownUntilMs).toISOString() : null,
      maxObservedRssBytes: this.maxObservedRssBytes,
      maxObservedExternalBytes: this.maxObservedExternalBytes
    };
  }
}
