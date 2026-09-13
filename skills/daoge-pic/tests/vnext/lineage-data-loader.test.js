const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');


test('lineage data loader reads every run item and asset page', async () => {
  const { loadCompleteLineageAssets, loadCompleteLineageRunItems } = await import('../../web/src/lineage-data-loader.mjs');
  const runRequests = [];
  const runResponses = new Map([
    ['/api/runs/run_a/items?page=1&pageSize=100&sort=sequence', { items: Array.from({ length: 100 }, (_, index) => ({ id: 'a-' + (index + 1), sequence: index + 1 })), page: 1, pageSize: 100, total: 101, totalPages: 2, allTotal: 101 }],
    ['/api/runs/run_a/items?page=2&pageSize=100&sort=sequence', { items: [{ id: 'a-101', sequence: 101 }], page: 2, pageSize: 100, total: 101, totalPages: 2, allTotal: 101 }],
    ['/api/runs/run_b/items?page=1&pageSize=100&sort=sequence', { items: [{ id: 'b-1', sequence: 1 }], page: 1, pageSize: 100, total: 1, totalPages: 1, allTotal: 1 }]
  ]);
  const runResult = await loadCompleteLineageRunItems([{ id: 'run_a' }, { id: 'run_b' }], async (path) => {
    runRequests.push(path);
    return runResponses.get(path);
  });
  assert.equal(runResult.total, 102);
  assert.equal(runResult.loaded, 102);
  assert.deepEqual(runRequests, [...runResponses.keys()]);
  assert.equal(runResult.items.at(-1).id, 'b-1');


  const assetRequests = [];
  const assetPageEvents = [];
  const route = { view: 'lineage', projectId: 'project_a', taskId: null, roundId: null, assetScope: 'project' };
  const assetResult = await loadCompleteLineageAssets(route, async (path) => {
    assetRequests.push(path);
    if (path.endsWith('offset=0')) return { assets: Array.from({ length: 500 }, (_, index) => ({ id: 'asset-' + index })), total: 501 };
    if (path.endsWith('offset=500')) return { assets: [{ id: 'asset-500' }], total: 501 };
    throw new Error('Unexpected asset path: ' + path);
  }, undefined, (event) => assetPageEvents.push(event));
  assert.equal(assetResult.total, 501);
  assert.equal(assetResult.assets.length, 501);
  assert.deepEqual(assetRequests, [
    '/api/assets?scope=project&projectId=project_a&limit=500&offset=0',
    '/api/assets?scope=project&projectId=project_a&limit=500&offset=500'
  ]);
  assert.equal(assetPageEvents[0].replace, true);
  assert.equal(assetPageEvents[0].assets.length, 500);
  assert.equal(assetPageEvents.every((event) => event.loading === true), true);
  assert.equal(assetPageEvents.at(-1).assets[0].id, 'asset-500');
});

test('lineage run item page events retain aggregate totals while loading multiple runs', async () => {
  const { loadCompleteLineageRunItems } = await import('../../web/src/lineage-data-loader.mjs');
  const events = [];
  const responses = new Map([
    ['/api/runs/run_a/items?page=1&pageSize=100&sort=sequence', { items: [{ id: 'a-1' }], total: 2, totalPages: 2 }],
    ['/api/runs/run_a/items?page=2&pageSize=100&sort=sequence', { items: [{ id: 'a-2' }], total: 2, totalPages: 2 }],
    ['/api/runs/run_b/items?page=1&pageSize=100&sort=sequence', { items: [{ id: 'b-1' }], total: 1, totalPages: 1 }]
  ]);
  const result = await loadCompleteLineageRunItems([{ id: 'run_a' }, { id: 'run_b' }], async (path) => responses.get(path), undefined, (event) => events.push({ runId: event.runId, total: event.total, loading: event.loading, replace: event.replace }));
  assert.deepEqual(events, [
    { runId: 'run_a', total: 2, loading: true, replace: true },
    { runId: 'run_a', total: 2, loading: true, replace: false },
    { runId: 'run_b', total: 3, loading: true, replace: false }
  ]);
  assert.deepEqual(result, { items: [{ id: 'a-1' }, { id: 'a-2' }, { id: 'b-1' }], total: 3, loaded: 3 });
});

test('lineage pagination bounds concurrent page requests and preserves page order', async () => {
  const { LINEAGE_REQUEST_CONCURRENCY, loadCompleteLineageAssets } = await import('../../web/src/lineage-data-loader.mjs');
  let inFlight = 0;
  let maximumInFlight = 0;
  const route = { view: 'lineage', projectId: 'project_a', taskId: null, roundId: null, assetScope: 'project' };
  const result = await loadCompleteLineageAssets(route, async (requestPath) => {
    const offset = Number(new URL('http://studio.local' + requestPath).searchParams.get('offset'));
    if (offset === 0) return { assets: Array.from({ length: 500 }, (_, index) => ({ id: 'asset-' + index })), total: 3001 };
    inFlight += 1;
    maximumInFlight = Math.max(maximumInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, offset === 500 ? 5 : 0));
    inFlight -= 1;
    const count = offset === 3000 ? 1 : 500;
    return { assets: Array.from({ length: count }, (_, index) => ({ id: 'asset-' + (offset + index) })), total: 3001 };
  });
  assert.equal(maximumInFlight, LINEAGE_REQUEST_CONCURRENCY);
  assert.equal(result.assets.length, 3001);
  assert.equal(result.assets[500].id, 'asset-500');
  assert.equal(result.assets.at(-1).id, 'asset-3000');
});

test('lineage asset page failure never emits a completed loading event', async () => {
  const { loadCompleteLineageAssets } = await import('../../web/src/lineage-data-loader.mjs');
  const events = [];
  const route = { view: 'lineage', projectId: 'project_a', taskId: null, roundId: null, assetScope: 'project' };
  await assert.rejects(() => loadCompleteLineageAssets(route, async (requestPath) => {
    const offset = new URL('http://studio.local' + requestPath).searchParams.get('offset');
    if (offset === '0') return { assets: [{ id: 'asset-0' }], total: 501 };
    throw new Error('asset page unavailable');
  }, undefined, (event) => events.push(event)), /asset page unavailable/);
  assert.deepEqual(events, [{ assets: [{ id: 'asset-0' }], total: 501, loading: true, replace: true }]);
});

test('Workbench wires lineage asset coverage through every loading phase', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../web/src/main.jsx'), 'utf8');
  assert.match(source, /const EMPTY_LINEAGE_ASSET_COVERAGE = Object\.freeze\(\{ loaded: 0, total: 0, loading: true \}\)/);
  assert.match(source, /setLineageAssetCoverage\(EMPTY_LINEAGE_ASSET_COVERAGE\)/);
  assert.match(source, /setLineageAssetCoverage\(\{ loaded: streamedAssets\.length, total: nextTotal, loading: true \}\)/);
  assert.match(source, /setLineageAssetCoverage\(\{ loaded: nextAssets\.length, total: nextTotal, loading: false \}\)/);
  assert.match(source, /assetCoverage=\{lineageAssetCoverage\}/);
});
