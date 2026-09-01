const test = require('node:test');
const assert = require('node:assert/strict');

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test('latest request gate prevents slow route A from overwriting fast route B', async () => {
  const { createLatestRequestGate } = await import('../../web/src/use-route-refresh.mjs');
  const gate = createLatestRequestGate();
  const slow = deferred();
  const writes = [];
  const requestA = gate.begin('route-A');
  const a = slow.promise.then((value) => { if (requestA.isCurrent()) writes.push(value); });
  const requestB = gate.begin('route-B');
  const b = Promise.resolve('B').then((value) => { if (requestB.isCurrent()) writes.push(value); });
  slow.resolve('A');
  await Promise.all([a, b]);
  assert.equal(requestA.signal.aborted, true);
  assert.deepEqual(writes, ['B']);
});

test('route refresh signature changes for popstate route and every scope dimension', async () => {
  const { routeRefreshSignature } = await import('../../web/src/use-route-refresh.mjs');
  const base = { view: 'assets', projectId: 'p1', taskId: 't1', roundId: 'r1', compareRoundIds: ['r1'], runId: 'run1', assetScope: 'round' };
  const popstate = { ...base, view: 'runs', runId: 'run2' };
  assert.notEqual(routeRefreshSignature(base), routeRefreshSignature(popstate));
  for (const scope of ['round', 'task', 'project', 'studio']) {
    assert.match(routeRefreshSignature({ ...base, assetScope: scope }), new RegExp(scope + '$'));
  }
  assert.equal(new Set(['round', 'task', 'project', 'studio'].map((scope) => routeRefreshSignature({ ...base, assetScope: scope }))).size, 4);
});
