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
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  for (const type of REDUNDANT_NODE_TYPES) {
    const pattern = new RegExp("createNode\\('" + type + "'");
    assert.doesNotMatch(canvas, pattern, type + ' 不该再作为画布节点创建（方案 4.3 第二刀）');
  }
});

test('去冗余之后，图仍然知道自己属于哪一批', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  // 批次 → 图的归属必须保留：折叠批次时要能沿线找到它的图，展开时才知道铺什么。
  // （不锁具体写法，只锁这条关系存在：批次节点参与的 `generated` 边。）
  assert.match(canvas, /'generated'/, '必须保留「批次/运行 → 图」的生成关系');
  assert.match(canvas, /createNode\('round'/i, '批次节点本身必须还在（它是画布的主干）');
});

test('A7b 收敛：画布只铺「任务 / 批次 / 图」（项目是标题、资源/交付/共享素材各有其页）', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  for (const type of ['task', 'round', 'asset']) {
    assert.match(canvas, new RegExp("createNode\\('" + type + "'"), type + ' 节点必须保留');
  }
  // 方案 4.3/6.2/7.11：项目是画布的标题与边界；规则资料、交付、共享素材各有稳定入口。
  // 「收」= 换位置，不是删能力——这四条都有新家，所以不再各占一个画布节点。
  for (const type of ['project', 'delivery', 'shared_asset', 'task_type', 'style_kit', 'brand_kit']) {
    assert.doesNotMatch(canvas, new RegExp("createNode\\('" + type + "'"), type + ' 不该再作为画布节点创建（A7b）');
  }
});

test('折叠到批次级：批次节点可展开收起，且折叠是默认态', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  // 这组断言防的是 2026-09-17 核查发现的那个坑：`collapsed` 字段**存了却没有 UI 去改它**
  // （只随布局持久化，没有任何交互）。所以这里断言的不只是「有字段」，而是「有交互」。
  assert.match(canvas, /collapsible/, '批次节点必须被标记为可折叠');
  assert.match(canvas, /toggleNodeCollapsed/, '必须有切换折叠的实现（而不是只有初值）');
  assert.match(canvas, /defaultCollapsedFor/, '必须有「默认折叠」的判定——折叠是默认态，展开才是用户动作');
  // 展开某批次时要能看见它的图：折叠过滤必须挂在图上（图的归属批次）
  assert.match(canvas, /node\.roundId/, '图节点必须带归属批次，否则折叠时不知道该藏谁');
});

test('增量插入：新节点插进空位，重排只在用户点「自动整理」时发生', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  // ① 增量而不是全排：已有位置的节点一律跳过（方案 4.3 技术要点）。
  assert.match(canvas, /if \(next\[node\.key\]\) continue;/, '已有节点必须跳过——布局是增量插入，不是每次全排');
  // ② 新节点不能落在别人身上：来自固定公式的坐标可能与用户挪过的节点重叠。
  assert.match(canvas, /findFreeSlot/, '新节点必须沿轴避让已占用区域，而不是直接用公式坐标');
  // ③ 全量重排是**用户主动**的动作（方案：平时布局稳定，只有点「整理」才重排）。
  assert.match(canvas, /autoArrange/, '「自动整理」必须是用户主动触发的入口');
});

test('出图占位：还没出完的项先立占位格，让等待有形状（方案 4.9）', async () => {
  const { pendingRunItems } = await import('../../web/src/run-item-pagination.mjs');
  // 判据复用既有的状态分组（单一来源，不另写一份状态列表）：
  //   进行中（leased/requesting/receiving/persisting）+ 等待（pending/retry_wait/cancel_requested）= 还没出完；
  //   终态不占位——包括 failed / blocked / outcome_unknown：它们已经「有结果」了，哪怕是坏结果。
  const items = [
    { id: 'a', status: 'pending' },
    { id: 'b', status: 'requesting' },
    { id: 'c', status: 'succeeded' },
    { id: 'd', status: 'failed' },
    { id: 'e', status: 'retry_wait' },
    { id: 'f', status: 'cancelled' }
  ];
  assert.deepEqual(pendingRunItems(items).map((item) => item.id), ['a', 'b', 'e']);
  assert.deepEqual(pendingRunItems(null), []);
  assert.deepEqual(pendingRunItems([]), []);

  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  assert.match(canvas, /pendingRunItems/, '画布必须用这个判据铺占位');
  assert.match(canvas, /'placeholder'/, '必须真的创建占位节点（否则只是空谈）');
});

test('每一张归属图都与批次有连线（B2 删掉中间层之后，这是它唯一的入边）', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  // B2 删掉 run_item 节点时，item→asset 的边随之消失；round→asset 的线当时只补给了
  // 「无 output 来源」的图 —— 而有来源的（大部分图）丢了唯一的入边，展开批次后图与批次之间没有线。
  // 刀哥 2026-09-17 实机试用抓到了这个回归。
  assert.doesNotMatch(canvas, /!source && sourceRoundId\)? connect\(nodeKey\('round'/, '不许只给无来源的图连线');
  assert.match(canvas, /if \(sourceRoundId\) connect\(nodeKey\('round', sourceRoundId\), assetNode\.key, 'generated'/, '归属图必须全部与批次连线');
});

test('画布视图收敛为三种（2026-09-17 刀哥裁定）：全局 / 按图片 / 按交付', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  // 折叠 + 去冗余之后，「按批次」与全局重合、「按任务」与按图片重合 —— 刀哥裁定收敛。
  assert.match(canvas, /'全局'/);
  assert.match(canvas, /'按图片'/);
  assert.match(canvas, /'按交付'/);
  // 砍掉的两种不许回潮。
  assert.doesNotMatch(canvas, /'按任务'|'按批次'/, '已收敛的模式不许回潮');
  // 旧布局里存的 mode 值要归一化（flow→assets，rounds→map），不能落到"全显"兜底。
  assert.match(canvas, /mode === 'flow'\) return 'assets'/, '旧 mode 值必须归一化');
  assert.match(canvas, /mode === 'rounds'\) return 'map'/, '旧 mode 值必须归一化');
});

test('批次收起 = 这批的图全部收进，已选定/已交付/可继续也不例外', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  // 刀哥 2026-09-17 实机抓到：优化批次的图大多是已选定/可继续，而全局视图对这几类图
  // 有「无条件显示」的例外 —— 它们不服从折叠，批次**怎么都关不上**。
  // 折叠的本意就是「这批整体收成一个节点」；数量在摘要里、内容在展开后，一样不少。
  assert.doesNotMatch(
    canvas,
    /\|\| node\.selectedAsset \|\| node\.deliveredAsset \|\| node\.derivedAsset \|\| node\.entity\?\.review\?\.decision === 'keep'/,
    '折叠批次的图不许凭「已选定/已交付/可继续」逃过收起'
  );
  assert.match(canvas, /collapsedIntoBatch/, '折叠语义必须显式覆盖全部归属图');
});

test('退出编辑模式必须回到「选择」工具（编辑模式的工具状态不外溢）', () => {
  const canvas = (readSource('web/src/canvas/creator-workbench.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  // 刀哥 2026-09-17 实机：进编辑 → 退出 → 所有节点都无法选中。
  // 机制：编辑时用过「拖动画布」工具（tool='pan'），退出编辑后 tool 残留 ——
  // pan 模式下点节点是拖画布，永远不触发选中，且工具条高亮变化很不显眼。
  assert.match(
    canvas,
    /if \(!next\) setTool\('select'\)/,
    '退出编辑模式必须把工具复位为「选择」，否则编辑期间选过的工具会残留'
  );
});
