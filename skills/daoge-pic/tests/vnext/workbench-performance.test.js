const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

test('asset pagination and filtering plan exactly one scoped asset request', async () => {
  const { assetRefreshRequests } = await import('../../web/src/asset-refresh-plan.mjs');
  const route = { view: 'assets', assetScope: 'project', projectId: 'project a', taskId: null, roundId: null };
  assert.deepEqual(assetRefreshRequests(route, { page: 3, pageSize: 24, filter: 'generated' }), ['/api/assets?scope=project&projectId=project+a&limit=24&offset=48&kind=generated']);
  assert.deepEqual(assetRefreshRequests({ ...route, view: 'projects' }, { page: 1, pageSize: 24, filter: 'all' }), []);
});

test('thumbnail URL prefers server-provided values and leaves originals for preview or download', async () => {
  const { assetOriginalUrl, assetThumbnailUrl, deliveryThumbnailUrl } = await import('../../web/src/asset-media-url.mjs');
  assert.equal(assetThumbnailUrl({ id: 'asset/a' }), '/api/assets/asset%2Fa/thumbnail');
  assert.equal(assetThumbnailUrl({ id: 'asset-a', thumbnailUrl: 'https://media.local/thumb.webp' }), 'https://media.local/thumb.webp');
  assert.equal(assetOriginalUrl({ id: 'asset/a' }, true), '/api/assets/asset%2Fa/file?download=1');
  assert.equal(deliveryThumbnailUrl('delivery/a', 2), '/api/deliveries/delivery%2Fa/files/2?variant=thumbnail');
});

test('multi-image imports stay within the configured concurrency ceiling', async () => {
  const { ASSET_IMPORT_CONCURRENCY, mapWithConcurrency } = await import('../../web/src/bounded-concurrency.mjs');
  assert.equal(ASSET_IMPORT_CONCURRENCY, 4);
  const gates = Array.from({ length: 9 }, deferred);
  let active = 0;
  let peak = 0;
  const work = mapWithConcurrency(gates, async (gate) => {
    active += 1;
    peak = Math.max(peak, active);
    await gate.promise;
    active -= 1;
  }, ASSET_IMPORT_CONCURRENCY);
  await Promise.resolve();
  assert.equal(peak, ASSET_IMPORT_CONCURRENCY);
  for (const gate of gates) gate.resolve();
  await work;
  assert.ok(peak > 1);
});

test('event refresh queue merges trailing event plans into one bounded follow-up refresh', async () => {
  const { createEventRefreshQueue } = await import('../../web/src/refresh-coordinator.mjs');
  const first = deferred();
  const plans = [];
  const applied = [];
  const queue = createEventRefreshQueue({
    refresh: async (plan) => { plans.push(plan); if (plans.length === 1) await first.promise; return true; },
    applyPlan: (plan) => applied.push(plan)
  });
  const current = queue.request({ scope: 'context', taskOverview: true, creativeRecord: false, studioOverview: false, planVersions: false });
  queue.request({ scope: 'all', taskOverview: false, creativeRecord: true, studioOverview: false, planVersions: false, refreshContext: true, refreshAssets: true });
  queue.request({ scope: 'context', taskOverview: false, creativeRecord: false, studioOverview: true, planVersions: true, refreshContext: false, refreshAssets: true });
  first.resolve();
  await current;
  await Promise.resolve();
  assert.equal(plans.length, 2);
  assert.deepEqual(plans[1], { scope: 'all', taskOverview: false, creativeRecord: true, studioOverview: true, planVersions: true, refreshContext: true, refreshAssets: true, refreshSelection: false, refreshSharedAssets: false });
  assert.equal(applied.length, 2);
  queue.dispose();
});

test('Workbench keeps asset refresh, deferred list filtering, and selection loading independent', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const delivery = fs.readFileSync(path.join(skillRoot, 'web/src/creator-delivery.jsx'), 'utf8');
  const shared = fs.readFileSync(path.join(skillRoot, 'web/src/shared-assets.jsx'), 'utf8');
  assert.match(main, /const refreshAssets = useCallback/);
  assert.match(main, /assetRefreshPath\(route/);
  assert.doesNotMatch(main, /contextKey:/);
  assert.match(main, /\}, \[activeProjectId\]\);/);
  assert.match(main, /useDeferredValue\(query\)/);
  assert.match(main, /assetThumbnailUrl\(asset\).*loading="lazy" decoding="async"/);
  assert.match(shared, /assetThumbnailUrl\(asset\).*loading="lazy" decoding="async"/);
  assert.match(delivery, /assetById\.get\(item\.assetId\)/);
  assert.doesNotMatch(delivery, /assets\.find\(/);
  assert.match(main, /selection\/batch/);
  assert.doesNotMatch(main, /Promise\.all\(candidates\.map/);
});
