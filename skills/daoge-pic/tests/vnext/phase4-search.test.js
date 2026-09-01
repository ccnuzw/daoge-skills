const test = require('node:test');
const assert = require('node:assert/strict');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

function searchHarness() {
  const pending = new Map();
  const timers = [];
  const states = [];
  return {
    pending, timers, states,
    async create() {
      const { createStudioSearchCoordinator } = await import('../../web/src/studio-search-model.mjs');
      return createStudioSearchCoordinator({
        request: (query) => { const value = deferred(); pending.set(query, value); return value.promise; },
        schedule: (callback) => { timers.push(callback); return callback; },
        cancelSchedule: (callback) => { const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1); },
        delay: 0
      });
    },
    publish: (state) => states.push(state),
    runNext: () => timers.shift()()
  };
}

test('search coordinator suppresses stale results and publishes loading plus errors', async () => {
  const value = searchHarness();
  const coordinator = await value.create();
  coordinator.search('slow', value.publish);
  const runSlow = value.runNext();
  coordinator.search('fast', value.publish);
  const runFast = value.runNext();
  value.pending.get('fast').resolve([{ entityId: 'fast' }]);
  await runFast;
  value.pending.get('slow').resolve([{ entityId: 'slow' }]);
  await runSlow;
  assert.deepEqual(value.states, [
    { results: [], error: '', loading: true },
    { results: [], error: '', loading: true },
    { results: [{ entityId: 'fast' }], error: '', loading: false }
  ]);

  coordinator.search('broken', value.publish);
  const runBroken = value.runNext();
  value.pending.get('broken').reject(new Error('搜索失败'));
  await runBroken;
  assert.deepEqual(value.states.at(-1), { results: [], error: '搜索失败', loading: false });
  coordinator.dispose();
});

test('search keyboard model handles Arrow, Enter, and Escape deterministically', async () => {
  const { searchKeyAction } = await import('../../web/src/studio-search-model.mjs');
  assert.deepEqual(searchKeyAction(-1, 'ArrowDown', 3), { action: 'navigate', index: 0, preventDefault: true });
  assert.deepEqual(searchKeyAction(0, 'ArrowUp', 3), { action: 'navigate', index: 2, preventDefault: true });
  assert.deepEqual(searchKeyAction(1, 'Enter', 3), { action: 'commit', index: 1, preventDefault: true });
  assert.deepEqual(searchKeyAction(1, 'Escape', 3), { action: 'clear', index: -1, preventDefault: true });
});
