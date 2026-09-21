const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CURSOR_KEY = 'daoge-pic:event-cursor:studio-a';
const MODEL_PATH = '../../web/src/studio-events-model.mjs';
const FACADE_PATH = '../../web/src/use-studio-events.mjs';

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
}

function mapStorage(initialCursor) {
  const values = new Map(initialCursor === undefined ? [] : [[CURSOR_KEY, String(initialCursor)]]);
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); }
  };
}

/** 用临时目录当 sessionStorage：验证游标跨「重新加载」也不回退（os.tmpdir + path.join，Windows 同样是合法路径）。 */
function tempStorage(dir) {
  const file = path.join(dir, 'session-storage.json');
  const readAll = () => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
  };
  return {
    file,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(readAll(), key) ? readAll()[key] : null),
    setItem: (key, value) => { const all = readAll(); all[key] = String(value); fs.writeFileSync(file, JSON.stringify(all), 'utf8'); }
  };
}

function harness(options = {}) {
  const sources = [];
  const timers = [];
  const batches = [];
  const decisions = [];
  const requestErrors = [];
  const connectionErrors = [];
  const cursorsAtSnapshot = [];
  const storage = options.storage || mapStorage(options.initialCursor);
  const callbacks = {
    onEventBatch: async (events, decision) => { batches.push(events); decisions.push(decision); return options.batchResult ?? true; },
    onSnapshot: async () => { cursorsAtSnapshot.push(storage.getItem(CURSOR_KEY)); return options.snapshotResult ?? true; },
    onRequestError: (value) => requestErrors.push(value),
    onConnectionError: (value) => connectionErrors.push(value),
    onReconnected: () => {}
  };
  return {
    storage, sources, timers, batches, decisions, requestErrors, connectionErrors, cursorsAtSnapshot,
    async create(createStream) {
      return createStream({
        studioId: 'studio-a',
        storage,
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

test('游标只前进：乱序/重复 id 都取本批最大值，且被接收的事件保持到达顺序', async () => {
  const model = await import(MODEL_PATH);
  const facade = await import(FACADE_PATH);

  assert.equal(model.advanceEventCursor(9, 4), 9);
  assert.equal(model.advanceEventCursor(4, 9), 9);
  assert.equal(model.advanceEventCursor(4, 'not-a-cursor'), 4);
  assert.equal(model.advanceEventCursor(undefined, 5), 5);
  assert.equal(model.acceptEventId(9, 9), 0);
  assert.equal(model.acceptEventId(9, 4), 0);
  assert.equal(model.acceptEventId(9, 10), 10);
  assert.equal(model.acceptEventId(0, 0), 0);
  assert.equal(model.studioEventBatchCursor(9, [{ id: 4 }, { id: 12 }, { id: 7 }]), 12);
  assert.equal(model.studioEventBatchCursor(9, [{ id: 'x' }, {}]), 9);

  const value = harness();
  const stream = await value.create(facade.createStudioEventStream);
  await value.sources[0].emit('studio-event', { id: 9, entityType: 'asset', eventType: 'asset.reviewed' });
  await value.sources[0].emit('studio-event', { id: 4, entityType: 'asset', eventType: 'asset.reviewed' });
  await value.sources[0].emit('studio-event', { id: 9, entityType: 'asset', eventType: 'asset.reviewed' });
  await stream.flushNow();
  assert.deepEqual(value.batches[0].map((event) => event.id), [9, 4, 9]);
  assert.equal(value.storage.getItem(CURSOR_KEY), '9');
  assert.equal(stream.state().cursor, 9);
  // 已提交 9 之后，迟到的 4 与重复的 9 都不再进批次，游标也不动。
  await value.sources[0].emit('studio-event', { id: 4, entityType: 'asset', eventType: 'asset.reviewed' });
  await value.sources[0].emit('studio-event', { id: 9, entityType: 'asset', eventType: 'asset.reviewed' });
  await stream.flushNow();
  assert.equal(value.batches.length, 1);
  assert.equal(value.storage.getItem(CURSOR_KEY), '9');
  assert.equal(stream.state().cursor, 9);
  stream.dispose();
});

test('snapshot-required 先恢复权威快照，恢复之前游标原地不动', async () => {
  const model = await import(MODEL_PATH);
  const facade = await import(FACADE_PATH);

  assert.deepEqual(model.studioSnapshotRecovery({ currentCursor: 12, snapshotCursor: 3 }), { requiresSnapshot: true, snapshotCursor: 3, cursor: 12, authoritativeReplace: false });
  assert.deepEqual(model.studioSnapshotRecovery({ currentCursor: 12, snapshotCursor: 3, snapshotRestored: true }), { requiresSnapshot: false, snapshotCursor: 3, cursor: 3, authoritativeReplace: true });
  // 非法 snapshotCursor 归零：交给服务端从头重放，绝不会停在「快照之前」的某个中间位置。
  assert.equal(model.studioSnapshotRecovery({ currentCursor: 12, snapshotRestored: true }).cursor, 0);

  const value = harness({ initialCursor: 12 });
  const stream = await value.create(facade.createStudioEventStream);
  await value.sources[0].emit('studio-event', { id: 20, entityType: 'asset', eventType: 'asset.reviewed' });
  assert.equal(stream.state().pending, 1);
  await value.sources[0].emit('snapshot-required', { cursor: 3 });
  // 快照回调执行的当下，持久化游标仍然是 12（没有「先推进再补快照」）。
  assert.deepEqual(value.cursorsAtSnapshot, ['12']);
  assert.equal(value.batches.length, 0);
  assert.equal(value.storage.getItem(CURSOR_KEY), '3');
  assert.equal(stream.state().cursor, 3);
  assert.deepEqual(stream.state().domains, []);
  value.runTimer(0);
  assert.equal(value.sources[1].url, '/api/events?after=3');
  stream.dispose();
});

test('快照恢复失败时停在 held 位置，不推进也不回退', async () => {
  const facade = await import(FACADE_PATH);
  const value = harness({ initialCursor: 8, snapshotResult: false });
  const stream = await value.create(facade.createStudioEventStream);
  await value.sources[0].emit('snapshot-required', { cursor: 1 });
  assert.deepEqual(value.cursorsAtSnapshot, ['8']);
  assert.equal(value.storage.getItem(CURSOR_KEY), '8');
  assert.equal(value.requestErrors.length, 1);
  assert.equal(stream.state().cursor, 8);
  stream.dispose();
});

test('重新加载后依然从持久化游标续接：迟到/重复 id 不会把它拉回去', async () => {
  const facade = await import(FACADE_PATH);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-pic-studio-events-'));
  try {
    const storage = tempStorage(dir);
    storage.setItem(CURSOR_KEY, '9');
    const value = harness({ storage });
    const stream = await value.create(facade.createStudioEventStream);
    assert.equal(value.sources[0].url, '/api/events?after=9');
    await value.sources[0].emit('studio-event', { id: 4, entityType: 'asset', eventType: 'asset.reviewed' });
    await value.sources[0].emit('studio-event', { id: 9, entityType: 'asset', eventType: 'asset.reviewed' });
    await stream.flushNow();
    assert.equal(value.batches.length, 0);
    assert.equal(storage.getItem(CURSOR_KEY), '9');
    stream.dispose();

    // 同一份 sessionStorage 上开新连接（等价于一次重新加载）：位置必须还是 9。
    const reopened = harness({ storage });
    const second = await reopened.create(facade.createStudioEventStream);
    assert.equal(new URL(reopened.sources[0].url, 'http://localhost').searchParams.get('after'), '9');
    await reopened.sources[0].emit('studio-event', { id: 10, entityType: 'asset', eventType: 'asset.reviewed' });
    await second.flushNow();
    assert.equal(storage.getItem(CURSOR_KEY), '10');
    second.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('域刷新列表稳定、去重、按字典序，且由刷新计划推导（同一套规则）', async () => {
  const model = await import(MODEL_PATH);
  const facade = await import(FACADE_PATH);
  const domainsOf = (events) => model.studioRefreshDomains(model.studioEventRefreshPlan(events));

  const cases = [
    [[{ entityType: 'asset', eventType: 'asset.reviewed' }], ['asset', 'item', 'selection']],
    [[{ entityType: 'asset', eventType: 'asset.shared_across_projects' }], ['asset', 'item', 'shared-asset']],
    [[{ entityType: 'project', eventType: 'project.updated' }], ['asset', 'delivery', 'run']],
    [[{ entityType: 'delivery', eventType: 'delivery.exported' }], ['delivery', 'run']],
    [[{ entityType: 'run_item', eventType: 'run_item.retry_wait' }], ['delivery', 'item', 'run']],
    [[{ entityType: 'creative_round', eventType: 'plan.confirmed' }], ['delivery', 'item', 'plan', 'run']],
    [[{ entityType: 'canvas_layout', eventType: 'canvas_layout.updated' }], ['canvas-layout']],
    [[{ entityType: 'request', eventType: 'request.accepted' }], ['request']],
    [[{ entityType: 'mystery', eventType: 'mystery.happened' }], []]
  ];
  for (const [events, expected] of cases) {
    assert.deepEqual(domainsOf(events), expected, JSON.stringify(events));
    assert.deepEqual(domainsOf(events), [...expected].sort(), '域列表必须按字典序');
    assert.equal(new Set(domainsOf(events)).size, domainsOf(events).length, '域列表必须去重');
  }
  // 重复事件不改变（也不加长）域列表；并集批量只多不少。
  const many = Array.from({ length: 250 }, () => ({ entityType: 'asset', eventType: 'asset.reviewed' }));
  assert.deepEqual(domainsOf(many), domainsOf([{ entityType: 'asset', eventType: 'asset.reviewed' }]));
  assert.deepEqual(
    domainsOf([{ entityType: 'asset', eventType: 'asset.reviewed' }, { entityType: 'request', eventType: 'request.done' }]),
    ['asset', 'item', 'request', 'selection']
  );
  // 门面转发的计划与模型是同一份规则（不存在第二份判断）。
  const mixed = [{ entityType: 'project', eventType: 'project.updated' }, { entityType: 'run_item', eventType: 'run_item.retry_wait' }];
  assert.deepEqual(facade.studioEventRefreshPlan(mixed), model.studioEventRefreshPlan(mixed));
});

test('未知名事件/畸形输入不影响状态也不抛错，只推进协议游标', async () => {
  const model = await import(MODEL_PATH);
  const facade = await import(FACADE_PATH);

  for (const input of [undefined, null, 'nonsense', 42, [{}, null, undefined]]) {
    const plan = model.studioEventRefreshPlan(input);
    const inert = Object.entries(plan).every(([key, value]) => {
      if (key === 'scope') return value === 'context';
      return key === 'maximumRefreshes' ? value === 0 : value === false;
    });
    assert.equal(inert, true, String(input));
    assert.deepEqual(model.studioRefreshDomains(plan), []);
  }
  assert.deepEqual(model.studioRefreshDomains(null), []);
  assert.equal(model.studioEventBatchCursor(3, null), 3);
  assert.deepEqual(model.studioEventBatchDecision(null), { cursor: 0, plan: model.studioEventRefreshPlan([]), domains: [] });
  assert.equal(model.studioSnapshotRecovery().requiresSnapshot, true);

  const value = harness();
  const stream = await value.create(facade.createStudioEventStream);
  await value.sources[0].emit('studio-event', { id: 11, entityType: 'mystery', eventType: 'mystery.happened', payload: { token: 'secret' } });
  await stream.flushNow();
  assert.equal(value.requestErrors.length, 0);
  assert.deepEqual(value.decisions[0].domains, []);
  assert.deepEqual(stream.state().domains, []);
  assert.equal(stream.state().cursor, 11);
  assert.equal(value.storage.getItem(CURSOR_KEY), '11');
  stream.dispose();
});

test('批次决策随事件一起交给刷新回调，且与模型输出一致', async () => {
  const model = await import(MODEL_PATH);
  const facade = await import(FACADE_PATH);
  const value = harness({ initialCursor: 2 });
  const stream = await value.create(facade.createStudioEventStream);
  await value.sources[0].emit('studio-event', { id: 5, entityType: 'asset', eventType: 'asset.reviewed' });
  await value.sources[0].emit('studio-event', { id: 7, entityType: 'asset', eventType: 'asset.trashed' });
  await stream.flushNow();
  const decision = value.decisions[0];
  assert.deepEqual(Object.keys(decision).sort(), ['cursor', 'domains', 'plan']);
  assert.equal(decision.cursor, 7);
  assert.deepEqual(decision.domains, ['asset', 'item', 'selection']);
  assert.deepEqual(decision.plan, facade.studioEventRefreshPlan(value.batches[0]));
  assert.deepEqual(decision, model.studioEventBatchDecision(value.batches[0], 2));
  assert.deepEqual(stream.state().domains, ['asset', 'item', 'selection']);
  assert.equal(value.storage.getItem(CURSOR_KEY), '7');
  stream.dispose();
});

test('刷新回调失败时不提交游标，也不更新域列表', async () => {
  const facade = await import(FACADE_PATH);
  const value = harness({ initialCursor: 2, batchResult: false });
  const stream = await value.create(facade.createStudioEventStream);
  await value.sources[0].emit('studio-event', { id: 5, entityType: 'asset', eventType: 'asset.reviewed' });
  await stream.flushNow();
  assert.equal(value.storage.getItem(CURSOR_KEY), '2');
  assert.equal(stream.state().cursor, 2);
  assert.deepEqual(stream.state().domains, []);
  assert.equal(value.requestErrors.length, 1);
  stream.dispose();
});