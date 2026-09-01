const test = require('node:test');
const assert = require('node:assert/strict');

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
    this.onmessage = null;
    this.onopen = null;
    this.onerror = null;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  close() { this.closed = true; }
  async emit(type, data) {
    const message = { data: typeof data === 'string' ? data : JSON.stringify(data) };
    const listener = this.listeners.get(type);
    if (listener) await listener(message);
    else if (type === 'message' && this.onmessage) await this.onmessage(message);
  }
  open() { this.onopen?.(); }
}

function harness(options = {}) {
  const stored = new Map(options.initialCursor === undefined ? [] : [['daoge-pic:event-cursor:studio-a', String(options.initialCursor)]]);
  const sources = [];
  const timers = [];
  const requestErrors = [];
  const connectionErrors = [];
  const batches = [];
  let snapshots = 0;
  const callbacks = {
    onEventBatch: async (events) => { batches.push(events); return options.batchResult ?? true; },
    onSnapshot: async () => { snapshots += 1; return options.snapshotResult ?? true; },
    onRequestError: (value) => requestErrors.push(value),
    onConnectionError: (value) => connectionErrors.push(value)
  };
  return {
    stored, sources, timers, requestErrors, connectionErrors, batches,
    snapshotCount: () => snapshots,
    async create() {
      const { createStudioEventStream } = await import('../../web/src/use-studio-events.mjs');
      return createStudioEventStream({
        studioId: 'studio-a',
        storage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) },
        createEventSource: (url) => { const source = new FakeEventSource(url); sources.push(source); return source; },
        setTimer: (callback, delay) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return timer; },
        clearTimer: (timer) => { timer.cancelled = true; },
        random: () => 0,
        getCallbacks: () => callbacks,
        maxPendingEvents: options.maxPendingEvents ?? 100,
        batchDelayMs: 1
      });
    },
    runTimer(delay) {
      const timer = timers.find((entry) => !entry.cancelled && entry.delay === delay);
      assert.ok(timer, 'expected timer at delay ' + delay);
      timer.cancelled = true;
      return timer.callback();
    }
  };
}

test('studio events commit the maximum ordinary event id rather than arrival order', async () => {
  const value = harness();
  const stream = await value.create();
  await value.sources[0].emit('studio-event', { id: 9, entityType: 'asset', eventType: 'asset.reviewed' });
  await value.sources[0].emit('studio-event', { id: 4, entityType: 'asset', eventType: 'asset.reviewed' });
  await stream.flushNow();
  assert.equal(value.stored.get('daoge-pic:event-cursor:studio-a'), '9');
  assert.deepEqual(value.batches[0].map((event) => event.id), [9, 4]);
  stream.dispose();
});

test('snapshot-required replaces a higher local cursor with the authoritative lower cursor', async () => {
  const value = harness({ initialCursor: 12 });
  const stream = await value.create();
  await value.sources[0].emit('snapshot-required', { cursor: 3 });
  assert.equal(value.stored.get('daoge-pic:event-cursor:studio-a'), '3');
  value.runTimer(0);
  assert.equal(value.sources[1].url, '/api/events?after=3');
  stream.dispose();
});

test('failed ordinary refresh and failed snapshot do not commit observed cursors', async () => {
  const ordinary = harness({ initialCursor: 2, batchResult: false });
  const ordinaryStream = await ordinary.create();
  await ordinary.sources[0].emit('studio-event', { id: 7 });
  await ordinaryStream.flushNow();
  assert.equal(ordinary.stored.get('daoge-pic:event-cursor:studio-a'), '2');
  assert.equal(ordinary.requestErrors.length, 1);
  ordinaryStream.dispose();

  const snapshot = harness({ initialCursor: 8, snapshotResult: false });
  const snapshotStream = await snapshot.create();
  await snapshot.sources[0].emit('snapshot-required', { cursor: 1 });
  assert.equal(snapshot.stored.get('daoge-pic:event-cursor:studio-a'), '8');
  assert.equal(snapshot.requestErrors.length, 1);
  snapshotStream.dispose();
});

test('overflow refresh commits the observed cursor, closes the old stream, and reconnects immediately', async () => {
  const value = harness({ maxPendingEvents: 1 });
  const stream = await value.create();
  await value.sources[0].emit('studio-event', { id: 5 });
  await value.sources[0].emit('studio-event', { id: 6 });
  assert.equal(value.sources[0].closed, true);
  await stream.flushNow();
  assert.equal(value.snapshotCount(), 1);
  assert.equal(value.stored.get('daoge-pic:event-cursor:studio-a'), '6');
  value.runTimer(0);
  assert.equal(value.sources[1].url, '/api/events?after=6');
  stream.dispose();
});

test('event refresh classification stays bounded and includes plan invalidation', async () => {
  const { studioEventRefreshPlan } = await import('../../web/src/use-studio-events.mjs');
  const plan = studioEventRefreshPlan([
    { entityType: 'project', eventType: 'project.updated' },
    { entityType: 'creative_round', eventType: 'plan.confirmed' },
    { entityType: 'run_item', eventType: 'run_item.retry_wait' },
    ...Array.from({ length: 200 }, () => ({ entityType: 'asset', eventType: 'asset.reviewed' }))
  ]);
  assert.deepEqual(plan, { scope: 'all', taskOverview: true, creativeRecord: true, studioOverview: true, planVersions: true, maximumRefreshes: 5 });
});

test('opening a recovered SSE connection clears only connectionError, not requestError', async () => {
  const value = harness();
  const stream = await value.create();
  await value.sources[0].emit('studio-event', '{invalid json');
  assert.equal(value.requestErrors.length, 1);
  value.runTimer(500);
  value.sources[1].open();
  assert.equal(value.requestErrors.length, 1);
  assert.deepEqual(value.connectionErrors, ['']);
  stream.dispose();
});
