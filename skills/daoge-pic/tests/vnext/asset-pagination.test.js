const test = require('node:test');
const assert = require('node:assert/strict');

test('asset pagination defaults to 24 and only accepts supported page sizes', async () => {
  const { ASSET_PAGE_SIZES, DEFAULT_ASSET_PAGE_SIZE, normalizeAssetPageSize } = await import('../../web/src/asset-pagination.mjs');
  assert.deepEqual(ASSET_PAGE_SIZES, [16, 24, 32, 48, 64, 96]);
  assert.equal(DEFAULT_ASSET_PAGE_SIZE, 24);
  assert.equal(normalizeAssetPageSize(48), 48);
  assert.equal(normalizeAssetPageSize('96'), 96);
  assert.equal(normalizeAssetPageSize(20), 24);
});

test('asset pagination clamps pages and computes stable offsets', async () => {
  const { assetPageCount, assetPageOffset, clampAssetPage } = await import('../../web/src/asset-pagination.mjs');
  assert.equal(assetPageCount(0, 24), 1);
  assert.equal(assetPageCount(49, 24), 3);
  assert.equal(clampAssetPage(8, 49, 24), 3);
  assert.equal(clampAssetPage(-3, 49, 24), 1);
  assert.equal(assetPageOffset(3, 24), 48);
});
