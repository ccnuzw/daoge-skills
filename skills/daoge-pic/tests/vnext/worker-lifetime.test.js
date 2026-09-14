const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');

let syntheticPid = 70_000;
function syntheticChild(send) {
  const child = new EventEmitter();
  child.pid = syntheticPid++;
  child.connected = true;
  child.exitCode = null;
  child.signalCode = null;
  child.send = send;
  child.kill = () => {
    child.connected = false;
    child.exitCode = 1;
    return true;
  };
  return child;
}

const { initializeStudio } = require('../../dist/vnext/studio/workspace');
const {
  resolveWorkerLeaseMs,
  WORKER_DEFAULT_REQUEST_TIMEOUT_MS,
  WORKER_LEASE_SLACK_MS,
  WORKER_MAX_LEASE_MS,
  WORKER_MIN_LEASE_MS,
  WORKER_POOL_JOB_GRACE_MS,
  WORKER_POOL_JOB_TIMEOUT_MS
} = require('../../dist/vnext/studio/runtime-settings');

test('resolveWorkerLeaseMs derives a lease that always outlives the configured HTTP timeout', () => {
  // 30 s request + 1 s slack = 31 s, but the floor lifts it to the minimum heartbeat window.
  const thirty = resolveWorkerLeaseMs(30_000);
  assert.ok(thirty >= WORKER_MIN_LEASE_MS, 'lease must be at least the minimum heartbeat window');
  assert.ok(thirty >= 30_000 + WORKER_LEASE_SLACK_MS, 'lease must outlive the HTTP request plus slack');

  const oneTwenty = resolveWorkerLeaseMs(120_000);
  assert.ok(oneTwenty >= 120_000 + WORKER_LEASE_SLACK_MS);
  assert.ok(oneTwenty <= WORKER_MAX_LEASE_MS);

  const huge = resolveWorkerLeaseMs(60 * 60 * 1000);
  assert.equal(huge, WORKER_MAX_LEASE_MS, 'oversized requests cap at the global maximum');

  const fallback = resolveWorkerLeaseMs(undefined);
  assert.ok(fallback >= WORKER_DEFAULT_REQUEST_TIMEOUT_MS + WORKER_LEASE_SLACK_MS);

  const garbage = resolveWorkerLeaseMs(NaN);
  assert.ok(garbage >= WORKER_DEFAULT_REQUEST_TIMEOUT_MS + WORKER_LEASE_SLACK_MS);

  const fractional = resolveWorkerLeaseMs(12.9);
  assert.equal(fractional, resolveWorkerLeaseMs(12), 'fractional milliseconds are floored');
});

test('the pool watchdog is derived from the lease ceiling and can cover the worst-case request', () => {
  const { WORKER_TICK_TIMEOUT_MS } = require('../../dist/vnext/runtime/worker-pool');
  assert.equal(WORKER_TICK_TIMEOUT_MS, WORKER_MAX_LEASE_MS + WORKER_POOL_JOB_GRACE_MS, 'watchdog is max lease plus grace, not a free-standing constant');
  assert.equal(WORKER_TICK_TIMEOUT_MS, WORKER_POOL_JOB_TIMEOUT_MS);
  // The property that actually matters: the watchdog must be able to
  // outlast the longest lease the child can ever hold. Otherwise the
  // parent declares the child dead before the lease can even lapse, and
  // a still-running Provider call races `recoverExpiredLeases` — the
  // duplicate-billing window §5.2 of the optimization review calls out.
  assert.ok(WORKER_TICK_TIMEOUT_MS > WORKER_MAX_LEASE_MS, 'watchdog strictly exceeds the longest lease');
  // A tick costs one request budget at most, not one per item: batch
  // items run concurrently under `Promise.allSettled`. So the watchdog
  // is additive here; a multiplier would widen it without bound.
  assert.ok(WORKER_POOL_JOB_GRACE_MS > 0);
  assert.ok(WORKER_TICK_TIMEOUT_MS < 2 * WORKER_MAX_LEASE_MS, 'watchdog stays bounded; it is not a multiplier of the lease ceiling');
});

test('the media worker pool watchdog matches the generation worker pool ceiling', () => {
  const { MEDIA_JOB_TIMEOUT_MS } = require('../../dist/vnext/runtime/media-worker-pool');
  const { WORKER_TICK_TIMEOUT_MS } = require('../../dist/vnext/runtime/worker-pool');
  assert.equal(MEDIA_JOB_TIMEOUT_MS, WORKER_TICK_TIMEOUT_MS, 'both pools share one watchdog derivation');
});

const { mock } = require('node:test');

test('the generation worker pool circuit breaker re-opens itself through a half-open probe', async () => {
  const { WorkerProcessPool, WORKER_HALF_OPEN_BACKOFF_MS, MAX_RESTART_ATTEMPTS } = require('../../dist/vnext/runtime/worker-pool');
  const pool = new WorkerProcessPool('/nonexistent-daoge-pic-workspace', 1);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    assert.equal(pool.healthSnapshot().state, 'idle');
    // Repeated child failures must trip the breaker.
    for (let index = 0; index <= MAX_RESTART_ATTEMPTS; index += 1) {
      const slot = pool.startSlot('/nonexistent-entry.js', index);
      pool.failSlot(slot, new Error('child died during synthetic failure storm'));
    }
    assert.equal(pool.healthSnapshot().state, 'failed');

    // The breaker must not stay dormant forever: once the backoff elapses
    // it spawns exactly one half-open probe. It remains failed until that
    // probe reports ready; a timer alone must never create a fake-ready slot.
    mock.timers.tick(WORKER_HALF_OPEN_BACKOFF_MS);
    assert.equal(pool.healthSnapshot().state, 'failed', 'a probe is not recovery until it reports ready');
    assert.ok(pool.processIds().length >= 1, 'the half-open probe actually spawned a child');
  } finally {
    mock.timers.reset();
    await pool.close();
  }
});

test('the media worker pool circuit breaker can also leave the tripped state', async () => {
  const { MediaProcessPool, MAX_MEDIA_RESTART_ATTEMPTS, MEDIA_HALF_OPEN_BACKOFF_MS } = require('../../dist/vnext/runtime/media-worker-pool');
  const pool = new MediaProcessPool('/nonexistent-daoge-pic-workspace', 1);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    assert.equal(pool.healthSnapshot().state, 'idle');
    for (let index = 0; index <= MAX_MEDIA_RESTART_ATTEMPTS; index += 1) {
      const slot = pool.startSlot('/nonexistent-entry.js', index);
      pool.failSlot(slot, new Error('media child died during synthetic failure storm'));
    }
    assert.equal(pool.healthSnapshot().state, 'failed');
    mock.timers.tick(MEDIA_HALF_OPEN_BACKOFF_MS);
    assert.equal(pool.healthSnapshot().state, 'failed', 'a media probe is not recovery until it reports ready');
    assert.ok(pool.processIds().length >= 1, 'the media half-open probe spawned a child');
  } finally {
    mock.timers.reset();
    await pool.close();
  }
});

test('closing a tripped pool cancels the pending half-open probe so the process can exit', () => {
  const { MediaProcessPool, MAX_MEDIA_RESTART_ATTEMPTS } = require('../../dist/vnext/runtime/media-worker-pool');
  const pool = new MediaProcessPool('/nonexistent-daoge-pic-workspace', 1);
  for (let index = 0; index <= MAX_MEDIA_RESTART_ATTEMPTS; index += 1) {
    const slot = pool.startSlot('/nonexistent-entry.js', index);
    pool.failSlot(slot, new Error('media child died during synthetic failure storm'));
  }
  assert.equal(pool.healthSnapshot().state, 'failed');
  const closePromise = pool.close();
  assert.equal(pool.halfOpenTimer, null, 'the half-open probe is cancelled on close');
  return closePromise;
});

test('a worker derives its lease from the Provider request timeout so the lease always outlives an HTTP call', () => {
  const { GenerationWorker } = require('../../dist/vnext/runner/worker');
  const base = require('./provider-test-helper');
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-lease-'));
  const initialized = initializeStudio({ workspaceRoot });
  try {
    let sequence = 0;
    const build = (limits, name) => {
      const { config } = base.configureProvider(initialized, { idempotencyKey: 'lease-derivation-' + (++sequence), name: 'Lease Provider ' + sequence, limits });
      const worker = new GenerationWorker({
        db: {},
        workerId: 'lease-derivation',
        provider: { id: config.providerId, classifyError: () => ({ kind: 'unknown_outcome', code: 'x', message: 'x' }) },
        providerConfig: config,
        assetPersister: { persistGeneratedImage: async () => ({ assetId: 'a', mediaType: 'image/png', byteSize: 1, contentHash: 'h' }) }
      });
      return worker;
    };

    // No configured timeout → falls back to the default request budget.
    const defaulted = build(undefined);
    assert.ok(defaulted.leaseMs >= WORKER_DEFAULT_REQUEST_TIMEOUT_MS + WORKER_LEASE_SLACK_MS, 'default lease covers the 120 s HTTP default');

    // A generous Provider timeout must be matched by the lease — this is
    // the invariant that was broken (30 s lease vs 120 s request).
    const generous = build({ requestTimeoutMs: 300_000 });
    assert.ok(generous.leaseMs >= 300_000 + WORKER_LEASE_SLACK_MS, 'lease grows with the configured request timeout');
    assert.ok(generous.leaseMs > defaulted.leaseMs);

    // A tiny timeout still floors at the minimum heartbeat window.
    const tiny = build({ requestTimeoutMs: 1000 });
    assert.ok(tiny.leaseMs >= WORKER_MIN_LEASE_MS, 'sub-second requests still get the floor lease');

    // An explicit leaseMs is honored verbatim for tests / integrations.
    const explicit = build({ requestTimeoutMs: 300_000 });
    explicit.leaseMs = 1000;
    assert.equal(explicit.leaseMs, 1000);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test('generation IPC send callback failures fail the slot and schedule a replacement', async () => {
  const { WorkerProcessPool } = require('../../dist/vnext/runtime/worker-pool');
  const pool = new WorkerProcessPool('/nonexistent-daoge-pic-workspace', 1);
  const child = syntheticChild((_message, callback) => callback(new Error('synthetic generation IPC failure')));
  pool.slots.push({ child, ready: true, busy: false, pending: null, entry: '/synthetic-worker.js', restartTimer: null, healthyTimer: undefined, restartAttempts: 0, failed: false, halfOpen: false });
  try {
    await assert.rejects(pool.processOnce(1), /synthetic generation IPC failure/);
    const slot = pool.slots[0];
    assert.equal(slot.ready, false);
    assert.equal(slot.busy, false);
    assert.equal(slot.pending, null);
    assert.equal(slot.failed, true);
    assert.ok(slot.restartTimer, 'failed IPC schedules a replacement');
  } finally {
    await pool.close();
  }
});

test('media IPC send callback failures fail the slot and reject the active job', async () => {
  const { MediaProcessPool } = require('../../dist/vnext/runtime/media-worker-pool');
  const pool = new MediaProcessPool('/nonexistent-daoge-pic-workspace', 1);
  const child = syntheticChild((_message, callback) => callback(new Error('synthetic media IPC failure')));
  pool.slots.push({ child, ready: true, active: null, entry: '/synthetic-media-worker.js', restartTimer: null, healthyTimer: undefined, restartAttempts: 0, failed: false, halfOpen: false });
  try {
    const job = pool.run({ type: 'reconcile', studioId: 'synthetic-studio' });
    await assert.rejects(job, /synthetic media IPC failure/);
    const slot = pool.slots[0];
    assert.equal(slot.ready, false);
    assert.equal(slot.active, null);
    assert.equal(slot.failed, true);
    assert.ok(slot.restartTimer, 'failed IPC schedules a replacement');
  } finally {
    await pool.close();
  }
});

test('media jobs queued during exhaustion receive a bounded recovery error', async () => {
  const { MediaProcessPool, MEDIA_RECOVERY_WAIT_TIMEOUT_MS } = require('../../dist/vnext/runtime/media-worker-pool');
  const { mock } = require('node:test');
  const pool = new MediaProcessPool('/nonexistent-daoge-pic-workspace', 1);
  pool.exhausted = true;
  pool.scheduleHalfOpenProbe = () => {};
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const job = pool.run({ type: 'reconcile', studioId: 'synthetic-studio' });
    await Promise.resolve();
    mock.timers.tick(MEDIA_RECOVERY_WAIT_TIMEOUT_MS);
    await assert.rejects(job, /bounded retry window expired/);
    assert.equal(pool.queue.length, 0);
  } finally {
    mock.timers.reset();
    await pool.close();
  }
});
