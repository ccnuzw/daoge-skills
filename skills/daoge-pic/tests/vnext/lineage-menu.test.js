const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 菜单重设的守卫（方案 4.4）。
 *
 * 判据只有一条：**这个动作有没有「作用对象」** —— 有 → 右键菜单；没有 → 工具栏。
 * 守卫盯三件事：菜单**随状态变**（候选 / 已选定 / 已交付 三套不同）、**全是动词**、**3–4 项**。
 */

const asset = (extra = {}) => ({ entityType: 'asset', entity: { review: {} }, ...extra });
const ids = (items) => items.map((item) => item.id);

test('菜单随对象状态变：候选 / 已选定 / 已交付 三套完全不同', async () => {
  const { nodeMenuItems } = await import('../../web/src/lineage-menu-model.mjs');
  const candidate = nodeMenuItems(asset(), { canDeliver: true });
  const chosen = nodeMenuItems(asset({ selectedAsset: true }), { canDeliver: true });
  const delivered = nodeMenuItems(asset({ deliveredAsset: true }), { canDeliver: true });

  assert.deepEqual(ids(candidate), ['keep', 'reject', 'deliver', 'detail']);
  assert.deepEqual(ids(chosen), ['unkeep', 'deliver', 'detail']);
  assert.deepEqual(ids(delivered), ['open-delivery', 'download', 'detail']);

  // 「三套不同」是这一项的核心，所以直接断言三者的 id 集合互不相同。
  assert.notDeepEqual(ids(candidate), ids(chosen));
  assert.notDeepEqual(ids(chosen), ids(delivered));
  assert.notDeepEqual(ids(candidate), ids(delivered));
});

test('每张菜单 3–4 项，且全是动词', async () => {
  const { nodeMenuItems, MENU_ITEM_LIMIT } = await import('../../web/src/lineage-menu-model.mjs');
  // 占位是**唯一的例外**：它还在生成，此刻没有可做的决定，只有「详情」——
  // 与其为凑项数塞一个无意义的动作，不如老实只给一格。
  assert.deepEqual(ids(nodeMenuItems({ entityType: 'placeholder', entity: {} })), ['detail']);

  const samples = [
    nodeMenuItems(asset(), { canDeliver: true }),
    nodeMenuItems(asset({ selectedAsset: true }), { canDeliver: true }),
    nodeMenuItems(asset({ deliveredAsset: true })),
    nodeMenuItems({ entityType: 'round', entity: {} }, { canReview: true, canDeliver: true }),
    nodeMenuItems({ entityType: 'task', entity: {} }),
    nodeMenuItems({ entityType: 'project', entity: {} })
  ];
  for (const items of samples) {
    assert.ok(items.length >= 3 && items.length <= MENU_ITEM_LIMIT, '菜单项数应在 3–4（详情占一格）之间：' + JSON.stringify(ids(items)));
    assert.equal(items[items.length - 1].id, 'detail', '「详情」永远在最后一格');
    // 全是动词：不许出现「计划信息」「运行」这类名词项（方案 4.4 明文）。
    for (const item of items) {
      assert.doesNotMatch(item.label, /计划信息|运行$|状态$|属性$|信息$/, '菜单项必须是动词：' + item.label);
    }
  }
});

test('批次菜单随折叠状态换说法；依赖队列的动作默认不出现', async () => {
  const { nodeMenuItems } = await import('../../web/src/lineage-menu-model.mjs');
  const collapsed = nodeMenuItems({ entityType: 'round', entity: {} }, { collapsed: true });
  const expanded = nodeMenuItems({ entityType: 'round', entity: {} }, { collapsed: false });
  assert.equal(collapsed[0].id, 'toggle');
  assert.equal(expanded[0].id, 'toggle');
  assert.notEqual(collapsed[0].label, expanded[0].label, '折叠与展开两种状态下的说法必须不同');

  // 「照它再来几张」要经队列派给 agent——本批没有队列，默认不该出现。
  assert.equal(nodeMenuItems(asset()).some((item) => item.id === 'derive'), false);
  // 但模型留了开关，队列做完（三批）传 canDerive 就能开。
  assert.equal(nodeMenuItems(asset(), { canDerive: true }).some((item) => item.id === 'derive'), true);
});

test('接线：画布的右键菜单与浮出工具条都用这个模型', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.match(canvas, /lineage-menu-model\.mjs/, '画布必须用这个模型');
  assert.match(canvas, /nodeMenuItems\(/, '菜单必须按节点算项');
  // 可发现性（方案 4.4）：右键有先天缺陷，选中时要有同内容的浮出工具条。
  assert.match(canvas, /lineage-node-toolbar|nodeActionBar|浮出/, '选中节点时必须有浮出工具条');
});
