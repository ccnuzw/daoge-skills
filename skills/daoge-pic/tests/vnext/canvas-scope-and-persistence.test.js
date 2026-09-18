const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * A7b + A7c 的画布守卫。
 *
 * A7b：画布只铺「任务 / 批次 / 图」。项目是标题、规则资料/交付/共享素材各有其页——
 *      都有新家，所以不再各占一个节点（「收」= 换位置，不是删能力）。
 * A7c：`canvas_node_layouts` 只存**用户动过**的节点；没记录 = 自动布局算的。
 */

test('A7b：共享素材 / 交付 / 规则资料节点不再上画布，但图的「已共享 / 已交付」标记还在', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  for (const type of ['shared_asset', 'delivery', 'task_type', 'style_kit', 'brand_kit']) {
    assert.equal(canvas.includes("createNode('" + type + "'"), false, type + ' 不该再作为画布节点创建');
  }
  // 图的两种标记是图自己的状态，不随节点类型消失。
  assert.match(canvas, /deliveredAsset/, '图仍要能显示「已交付」');
  assert.match(canvas, /sharedAsset/, '图仍要能显示「已共享」');
  // 资料面板（拖入画布）已经没有节点可放，入口必须一并撤掉，不能留个点了没反应的按钮。
  assert.doesNotMatch(canvas, /ResourcePanel|lineage-resource|x-daoge-resource/, '资料面板与拖拽入口必须撤掉');
});

test('A7c：保存只落「用户动过」的节点，其余交给自动布局', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  // 唯一判据是一个显式集合，而不是「位置和公式不一样吗」这种事后猜测。
  assert.match(canvas, /explicitKeysRef/, '必须有「哪些算人动过」的单一判据');
  assert.match(canvas, /markExplicit/, '必须有标记入口');
  // 保存时的筛选：既要是画布会铺的类型，也要在人动过的集合里。
  assert.match(canvas, /PERSISTED_NODE_TYPES\.has\(node\.entityType\) && explicitKeysRef\.current\.has\(node\.key\)/, '保存必须只落用户动过的节点');
  // 读取时：先按公式铺满，再用库里的用户位置覆盖——否则「没记录 = 自动布局」不成立，
  // 而且未记录的节点会被误判成新节点、触发避让，把列布局打散。
  assert.match(canvas, /① 自动布局/, '读取必须先铺自动布局');
  assert.match(canvas, /② 覆盖/, '读取必须再用用户位置覆盖');
  assert.match(canvas, /explicitKeysRef\.current = new Set\(layoutNodes\.map/, '库里有记录的才算人动过');
});

test('A7c：哪些动作算「人动过」（拖拽 / 微调 / 折叠 / 分组 / 自动整理）', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  // 拖拽：只有真的动过（超过阈值）才算，防「点一下也标成手动布局」。
  assert.match(canvas, /dragRef\.current\.moved = true;[\s\S]{0,200}explicitKeysRef\.current\.add/, '拖拽越过阈值必须标记');
  // 键盘微调 / 折叠 / 分组 / 取消分组。
  assert.match(canvas, /markExplicit\(selectedKeys\)/, '键盘微调要标记');
  assert.match(canvas, /markExplicit\(\[node\.key\]\)/, '折叠要标记（否则「存了却没人改」的老问题会换一种形式回来）');
  assert.match(canvas, /markExplicit\(affected\)/, '取消分组要标记');
  // 自动整理：刀哥裁定「整理结果当作一次显式布局存下」。
  const arrangeStart = canvas.indexOf('const autoArrange = useCallback');
  const arrange = canvas.slice(arrangeStart, arrangeStart + 1400);
  assert.match(arrange, /markExplicit\(graph\.nodes\.map/, '自动整理的结果必须整体算显式布局');
});

test('A7c：撤销/重做要把「哪些算人动过」一起回退', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.match(canvas, /explicitKeys: \[\.\.\.\(explicitKeys \|\| EMPTY_SET\)\]/, '快照必须带上显式集合');
  assert.match(canvas, /hasOwn\(patch, 'explicitKeys'\)/, '恢复快照必须能还原显式集合');
  assert.match(canvas, /applyLayoutSnapshot\(previous\);[\s\S]{0,160}persistLayout\(\)/, '撤销要落库');
});
