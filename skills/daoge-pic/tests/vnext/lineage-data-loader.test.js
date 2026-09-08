const test = require('node:test');
const assert = require('node:assert/strict');


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
  const route = { view: 'lineage', projectId: 'project_a', taskId: null, roundId: null, assetScope: 'project' };
  const assetResult = await loadCompleteLineageAssets(route, async (path) => {
    assetRequests.push(path);
    if (path.endsWith('offset=0')) return { assets: Array.from({ length: 500 }, (_, index) => ({ id: 'asset-' + index })), total: 501 };
    if (path.endsWith('offset=500')) return { assets: [{ id: 'asset-500' }], total: 501 };
    throw new Error('Unexpected asset path: ' + path);
  });
  assert.equal(assetResult.total, 501);
  assert.equal(assetResult.assets.length, 501);
  assert.deepEqual(assetRequests, [
    '/api/assets?scope=project&projectId=project_a&limit=500&offset=0',
    '/api/assets?scope=project&projectId=project_a&limit=500&offset=500'
  ]);
});
