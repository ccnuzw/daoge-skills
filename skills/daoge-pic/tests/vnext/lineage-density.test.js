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

test('折叠到批次级：批次节点可展开收起，且折叠是默认态', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  // 这组断言防的是 2026-09-17 核查发现的那个坑：`collapsed` 字段**存了却没有 UI 去改它**
  // （只随布局持久化，没有任何交互）。所以这里断言的不只是「有字段」，而是「有交互」。
  assert.match(canvas, /collapsible/, '批次节点必须被标记为可折叠');
  assert.match(canvas, /toggleNodeCollapsed/, '必须有切换折叠的实现（而不是只有初值）');
  assert.match(canvas, /defaultCollapsedFor/, '必须有「默认折叠」的判定——折叠是默认态，展开才是用户动作');
  // 展开某批次时要能看见它的图：折叠过滤必须挂在图上（图的归属批次）
  assert.match(canvas, /node\.roundId/, '图节点必须带归属批次，否则折叠时不知道该藏谁');
});

test('增量插入：新节点插进空位，重排只在用户点「自动整理」时发生', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  // ① 增量而不是全排：已有位置的节点一律跳过（方案 4.3 技术要点）。
  assert.match(canvas, /if \(next\[node\.key\]\) continue;/, '已有节点必须跳过——布局是增量插入，不是每次全排');
  // ② 新节点不能落在别人身上：来自固定公式的坐标可能与用户挪过的节点重叠。
  assert.match(canvas, /findFreeSlot/, '新节点必须沿轴避让已占用区域，而不是直接用公式坐标');
  // ③ 全量重排是**用户主动**的动作（方案：平时布局稳定，只有点「整理」才重排）。
  assert.match(canvas, /autoArrange/, '「自动整理」必须是用户主动触发的入口');
});
