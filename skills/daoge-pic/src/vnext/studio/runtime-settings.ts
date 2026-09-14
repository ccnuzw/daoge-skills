import { InvalidCommandError } from '../domain/studio-commands';

export const MIN_EXECUTION_CONCURRENCY = 1;
export const MAX_GLOBAL_CONCURRENCY = 1000;
// This is the bounded Provider target. The governor may temporarily run below it.
export const MAX_PROVIDER_CONCURRENCY = 100;
// Keep one child from monopolizing the daemon while the parent distributes the global target.
export const MAX_WORKER_BATCH_CONCURRENCY = MAX_PROVIDER_CONCURRENCY;
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

// =====================================================================
// Worker lifetime — single source of truth shared by the parent pool
// (`runtime/worker-pool.ts`, `runtime/media-worker-pool.ts`) and the
// GenerationWorker child (`runner/worker.ts`). §5.2 of the optimization
// review flagged that these were independent constants, 24x apart.
// =====================================================================
// Fallback when a plan omits `output.timeoutMs` and the Provider has no
// `limits.requestTimeoutMs`. MUST match `providers/http-adapters.ts`
// `request.output.timeoutMs || 120000` — if those drift apart the lease
// silently under-covers the real HTTP budget.
// =====================================================================
export const WORKER_DEFAULT_REQUEST_TIMEOUT_MS = 120_000;
// The largest Provider request budget accepted by Provider/retry input
// validation. A lease is deliberately allowed to be larger than this:
// otherwise a request at this exact ceiling loses the safety cushion when
// the final lease value is clamped.
export const WORKER_MAX_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
// Floor: even a 1-second request gets a lease worth renewing, otherwise
// a single stalled event-loop turn can outrun the lease and let
// `recoverExpiredLeases` reclaim an item whose Provider call is still
// running — the duplicate-billing window.
export const WORKER_MIN_LEASE_MS = 60_000;
// Cushion between the largest possible HTTP request and lease expiry.
export const WORKER_LEASE_SLACK_MS = 1000;
// Hard upper bound on a per-item lease. This is request ceiling + slack,
// not the request ceiling itself, so even a maximum-length HTTP request
// is still covered strictly beyond its timeout.
export const WORKER_MAX_LEASE_MS = WORKER_MAX_REQUEST_TIMEOUT_MS + WORKER_LEASE_SLACK_MS;
// Grace added to the maximum lease to get the pool watchdog. Note this
// is *additive*, not a multiplier: `worker.ts` processes a batch's items
// concurrently (`Promise.allSettled`), so a tick costs at most one request
// budget, not one per claimed item. Multiplying instead would widen the
// watchdog past what corruption actually costs us.
export const WORKER_POOL_JOB_GRACE_MS = 2 * 60 * 1000;
// Parent-side watchdog for both pools. Derived from `WORKER_MAX_LEASE_MS`
// so the two can never drift apart again; lands at 12 min, i.e. the
// longest possible request plus grace.
export const WORKER_POOL_JOB_TIMEOUT_MS = WORKER_MAX_LEASE_MS + WORKER_POOL_JOB_GRACE_MS;

export function resolveWorkerLeaseMs(requestTimeoutMs: unknown): number {
  const requested = Number(requestTimeoutMs);
  const safeRequest = Number.isFinite(requested) && requested > 0 ? Math.min(WORKER_MAX_REQUEST_TIMEOUT_MS, Math.max(1000, Math.floor(requested))) : WORKER_DEFAULT_REQUEST_TIMEOUT_MS;
  // The lease must outlive the HTTP request by the cushion, and must
  // never drop below the floor heartbeat window.
  return Math.min(WORKER_MAX_LEASE_MS, Math.max(WORKER_MIN_LEASE_MS, safeRequest + WORKER_LEASE_SLACK_MS));
}
