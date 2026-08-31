const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

test('trailing refresh queue coalesces an event burst into one current and one trailing refresh', async () => {
  const { createTrailingTaskQueue } = await import(path.join(__dirname, '../../web/src/refresh-coordinator.mjs'));
  const first = deferred();
  let calls = 0;
  const queue = createTrailingTaskQueue(async () => {
    calls += 1;
    if (calls === 1) await first.promise;
  });
  const current = queue.request();
  queue.request();
  queue.request();
  assert.equal(calls, 1);
  first.resolve();
  await current;
  assert.equal(calls, 2);
});

test('trailing refresh queue drops queued work after disposal', async () => {
  const { createTrailingTaskQueue } = await import(path.join(__dirname, '../../web/src/refresh-coordinator.mjs'));
  const first = deferred();
  let calls = 0;
  const queue = createTrailingTaskQueue(async () => {
    calls += 1;
    await first.promise;
  });
  const current = queue.request();
  queue.request();
  queue.dispose();
  first.resolve();
  await current;
  assert.equal(calls, 1);
});
