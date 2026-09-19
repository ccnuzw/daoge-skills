const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource, readStyles } = require('./source-text');

/**
 * G17/G22 · 一条 48px 工具条（界面批 C · C1）。
 *
 * 判据：① 四条旧 chrome **不再作为常驻横带**（焦点条/筛选条/工作区摘要退场）；
 *       ② 工具条带 `data-region="toolbar"`（否则布局审计看不见它——批 C 编单时抓到的假绿）；
 *       ③ **清点表逐条在**：收掉的每个控件都必须有新家，一个都不能丢（批 B 丢过「安全重启」）。
 */
test('四条 chrome 收成一条，且打过 toolbar 标（审计才看得见）', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.doesNotMatch(canvas, /lineage-focus-strip/, '焦点条必须退场（模式进工具条，指标进右栏）');
  assert.doesNotMatch(canvas, /LineageWorkspaceSummary/, '工作区摘要组件不得留在画布里');
  assert.doesNotMatch(canvas, /lineage-filterbar/, '筛选条不得再是常驻横带');
  assert.doesNotMatch(canvas, /lineage-workspace-summary/, '旧摘要容器不得残留');
  assert.match(canvas, /<header [^>]*data-region="toolbar"/, '工具条必须带 data-region="toolbar"');
  const styles = readStyles();
  assert.doesNotMatch(styles, /\.lineage-focus-strip/, '焦点条的 CSS 也必须退场（不留死样式冒充还在）');
  assert.match(styles, /\.lineage-toolbar \{ display: flex;[\s\S]{0,160}min-height: 48px; height: 48px;/, '工具条高度是硬约束：48px');
  assert.doesNotMatch(styles, /\.lineage-workspace-summary/, '旧摘要容器的样式也必须退场');
});

test('清点表：收掉的控件每个都有新家（一个不丢）', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  const toolbar = canvas.slice(canvas.indexOf('data-region="toolbar"'), canvas.indexOf('</header>', canvas.indexOf('data-region="toolbar"')));
  // 工具条本体的动作
  for (const label of ['适应全部', '适应选择', '新建批次', '编辑模式', '选择', '拖动画布', '自动整理', '自动整理', '重置视图', '撤销', '重做', '吸附', '小地图', '快捷键']) {
    assert.ok(toolbar.includes(label), '工具条里必须还有「' + label + '」');
  }
  // 编辑设置浮层（原样保留）
  assert.match(canvas, /lineage-edit-menu/, '编辑设置菜单必须还在');
  assert.match(canvas, /lineage-template-select/, '布局模板选择必须还在');
  // 模式（原焦点条）：按钮形态不变，仍是三选一
  assert.match(canvas, /aria-pressed=\{mode === value\} title=\{description\} onClick=\{\(\) => onMode\(value\)\}><strong>\{label\}<\/strong><\/button>/, '模式按钮必须原样保留（只是换了家）');
  assert.match(canvas, /mode === value \? 'is-active' : ''/, '选中态必须还在');
  // 筛选与背景（原筛选条）
  for (const label of ['筛选', '背景']) assert.ok(toolbar.includes(label), '工具条里必须还有「' + label + '」（浮层入口）');
  assert.match(canvas, /FILTERS\.map\(/, '筛选键必须还在');
  assert.match(canvas, /BACKGROUNDS\.map\(/, '背景键必须还在');
  // 统计（原筛选条尾部）
  for (const label of ['资产', '单张出图记录', '已选', '异常', '分组', '标注', '已虚拟化', '活动窗口上限', '批量选片']) {
    assert.ok(toolbar.includes(label), '统计浮层里必须还有「' + label + '」');
  }
  // 导出与文字谱系（原工具条尾部）
  for (const label of ['导出摘要', '文字谱系']) assert.ok(toolbar.includes(label), '工具条里必须还有「' + label + '」');
  // 搜索（原搜索条）
  assert.match(canvas, /搜索谱系节点/, '搜索输入必须还在（无障碍名不变）');
  assert.match(canvas, /lineage-search-results/, '搜索结果下拉必须还在');
});

test('工具条唯一：画布只有一条常驻横带', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.equal((canvas.match(/data-region="toolbar"/g) || []).length, 1, '整张画布只允许一条打标工具条');
  const stage = canvas.slice(canvas.indexOf('lineage-stage'), canvas.indexOf('lineage-shell'));
  assert.equal((stage.match(/<header /g) || []).length, 1, '画布区只允许一条 header 横带（编辑态只换段）');
});
