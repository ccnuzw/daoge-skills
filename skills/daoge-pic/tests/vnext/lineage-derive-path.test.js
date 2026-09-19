const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 「照它再来」路径唯一的守卫（方案 4.3 / 4.8-4 · 施工单 G3 · 决策 D1）。
 *
 * 编制施工单时核出**两条并存路径**：选片条 / 资产卡的 `openDerivedRoundDialog`（本地建草稿，能用）
 * 与节点菜单的 `canDerive: false`（禁用）。D1 拍板走**本地草稿**。
 *
 * 本守卫锁两件事：
 *   ① 只有一种路径（`DERIVE_PATH === 'draft'`）——不许两套并存各说各话；
 *   ② 「照它再来」只对有来源的对象可用（图 / 批次），任务这种结构节点不该给。
 */

async function model() {
  try {
    return await import('../../web/src/derive-path-model.mjs');
  } catch (error) {
    assert.fail('derive 路径模型尚未实现：web/src/derive-path-model.mjs（' + error.code + '）');
  }
}

test('derive 只有一条路径：本地草稿', async () => {
  const { DERIVE_PATH } = await model();
  assert.equal(DERIVE_PATH, 'draft', 'D1 拍板：复制出来是草稿，不是执行命令');
});

test('图与批次可以「照它再来」，任务不行', async () => {
  const { deriveAvailability } = await model();
  assert.deepEqual(deriveAvailability({ entityType: 'asset' }), { available: true, path: 'draft' });
  assert.equal(deriveAvailability({ entityType: 'round' }).available, true);
  assert.equal(deriveAvailability({ entityType: 'task' }).available, false, '任务没有「再来一批」的语义');
  assert.equal(deriveAvailability(null).available, false, '没有对象时不给动作');
});