const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 圈选发起的守卫（方案 4.3 第四刀 / 4.5 · 施工单 G1）。
 *
 * 「编排 = 选中 + 说一句」：在画布上圈住几张图，说一句，这几张必须进请求上下文。
 *
 * 现状核实（编制施工单时）：画布多选（`selectedKeys`）与请求 composer 的 `assetIds`
 * （来自「选片」`selectedAssetIds`）是**两条链**——圈选不生效。本守卫锁住那条新链。
 *
 * 纯函数：只做「画布圈选 + 选片 → 去重后的 assetIds」，不碰 DOM、不造影子状态
 * （持久化仍由既有选片 / 评审承担，见红线 2.1）。
 */

async function model() {
  try {
    return await import('../../web/src/canvas-request-context.mjs');
  } catch (error) {
    assert.fail('圈选发起模型尚未实现：web/src/canvas-request-context.mjs（' + error.code + '）');
  }
}

test('画布圈选与选片合并去重，圈选在前', async () => {
  const { requestContextAssetIds } = await model();
  const merged = requestContextAssetIds({
    canvasAssetIds: ['asset_b', 'asset_a'],
    selectedAssetIds: ['asset_a', 'asset_c']
  });
  assert.deepEqual(merged, ['asset_b', 'asset_a', 'asset_c'], '去重且圈选在前');
});

test('只有选片时退回选片，只有圈选时用圈选', async () => {
  const { requestContextAssetIds } = await model();
  assert.deepEqual(requestContextAssetIds({ selectedAssetIds: ['asset_only'] }), ['asset_only']);
  assert.deepEqual(requestContextAssetIds({ canvasAssetIds: ['asset_canvas'] }), ['asset_canvas']);
  assert.deepEqual(requestContextAssetIds({}), [], '什么都没有就是空');
});

test('脏输入被过滤，不把 undefined / 空串塞进上下文', async () => {
  const { requestContextAssetIds } = await model();
  assert.deepEqual(requestContextAssetIds({ canvasAssetIds: ['asset_a', '', null, undefined], selectedAssetIds: [null, 'asset_a'] }), ['asset_a']);
});