const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 画布密度的守卫（对应方案 4.3 第二刀）。
 *
 * 判据来自方案第 2 节第 4 条：「只展示人会关注的主线」——
 * 实测三种节点是同一件事的层层展开，且量最大：
 * `run_item` 与 `asset` 近乎 1:1（1411 : 1219），`plan` 与 `run` 各只有 157 / 145 条。
 * 画布上单张最多 349 个节点（实测），其中大半是这三种。
 *
 * 去冗余之后画布只铺「任务 / 批次 / 图」——中间过程（计划、运行、出图槽位）
 * **不删能力**，只是不再各自占一个节点：它们在检查器与批次状态里还在。
 */

const REDUNDANT_NODE_TYPES = ['plan', 'run', 'run_item'];

test('去冗余：计划 / 运行 / 运行项不再各自成节点', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  for (const type of REDUNDANT_NODE_TYPES) {
    const pattern = new RegExp("createNode\\('" + type + "'");
    assert.doesNotMatch(canvas, pattern, type + ' 不该再作为画布节点创建（方案 4.3 第二刀）');
  }
});

test('去冗余之后，图仍然知道自己属于哪一批', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  // 批次 → 图的归属必须保留：折叠批次时要能沿线找到它的图，展开时才知道铺什么。
  // （不锁具体写法，只锁这条关系存在：批次节点参与的 `generated` 边。）
  assert.match(canvas, /'generated'/, '必须保留「批次/运行 → 图」的生成关系');
  assert.match(canvas, /createNode\('round'/i, '批次节点本身必须还在（它是画布的主干）');
});

test('画布仍保留「任务 / 批次 / 图」三层与项目、交付', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  for (const type of ['project', 'task', 'round', 'asset', 'delivery']) {
    assert.match(canvas, new RegExp("createNode\\('" + type + "'"), type + ' 节点必须保留');
  }
});
