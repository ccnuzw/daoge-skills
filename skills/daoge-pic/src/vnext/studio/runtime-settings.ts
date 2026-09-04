import { InvalidCommandError } from '../domain/studio-commands';

export const MIN_EXECUTION_CONCURRENCY = 1;
export const MAX_GLOBAL_CONCURRENCY = 1000;
export const MAX_WORKER_BATCH_CONCURRENCY = 64;
// Provider responses are buffered before persistence; keep the process-level ceiling bounded even when a durable run requests 1000 items.
export const MAX_ACTIVE_PROVIDER_REQUESTS = 4;
export const DEFAULT_EXECUTION_CONCURRENCY = 4;
export type ConcurrencySource = 'default' | 'explicit' | 'serial';

export interface FrozenExecutionConcurrency {
  executionConcurrency: number;
  concurrencySource: ConcurrencySource;
}

export function resolveExecutionConcurrency(value: unknown, source?: unknown): FrozenExecutionConcurrency {
  if (value === undefined || value === null || value === '') return { executionConcurrency: DEFAULT_EXECUTION_CONCURRENCY, concurrencySource: 'default' };
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < MIN_EXECUTION_CONCURRENCY || normalized > MAX_GLOBAL_CONCURRENCY) throw new InvalidCommandError('本次运行并发只能是 1 到 1000 的整数。');
  const requestedSource = String(source || '').trim();
  if (requestedSource && !['explicit', 'serial'].includes(requestedSource)) throw new InvalidCommandError('并发来源只能是 explicit 或 serial。');
  if (requestedSource === 'serial' && normalized !== 1) throw new InvalidCommandError('串行运行的并发必须为 1。');
  return { executionConcurrency: normalized, concurrencySource: requestedSource === 'serial' ? 'serial' : 'explicit' };
}
