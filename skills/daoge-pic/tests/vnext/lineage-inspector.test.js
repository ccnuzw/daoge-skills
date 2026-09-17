const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 检查器的守卫（方案 4.5）。
 *
 * 检查器承载三件事：**它是什么**（属性）、**过程资产**（计划 / 提示词 / 历史，可看可复制）、
 * **确认闸门**（待确认时的按钮就在这里，人不用离开画布）。
 *
 * 这组断言还守着一个真实回归：B2 删掉「计划」节点之后，`PlanActions`
 * （计划详情 + 确认按钮）一度挂在一个永不成立的判断上 —— **确认入口随之消失**。
 * 删节点类型时不能只看"创建处"，还要看**谁在用它**。
 */

test('确认闸门与计划详情挂在批次上，而不是已被删除的计划节点上', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  // ① 不能挂在已删除的节点类型上（否则那段永远不渲染，等于没有）。
  assert.doesNotMatch(canvas, /entityType === 'plan' && <PlanActions/, '计划详情不能挂在已删除的 plan 节点上');
  assert.doesNotMatch(canvas, /entityType === 'plan' \? <PlanActions/, '计划详情不能挂在已删除的 plan 节点上');
  // ② 必须真的挂在批次上（B2 之后，「计划是批次的属性」）。
  assert.match(canvas, /entityType === 'round'[\s\S]{0,80}<PlanActions|isRound && <PlanActions/, '计划详情与确认闸门必须挂在批次节点上');
  // ③ 确认闸门本身必须存在。
  assert.match(canvas, /lineage-confirmation-callout/, '确认闸门必须在检查器里（人不用离开画布）');
  assert.match(canvas, /审阅并确认计划/, '确认按钮必须真的在检查器里');
});

test('检查器把三件事分清楚：它是什么 / 过程资产 / 确认', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  const styles = readSource('web/src/styles.css');
  // 检查器有明确的分区标题（不是一坨按钮堆在一起）。
  assert.match(canvas, /lineage-inspector-section|过程资产/, '检查器必须有「过程资产」分区');
  // 窄窗口退化为抽屉（8.9 #20）。
  assert.match(styles, /\.lineage-inspector/);
  assert.match(styles, /@media \(max-width:800px\)[\s\S]*lineage-inspector/, '窄窗口下检查器必须退化为抽屉');
});

test('过程资产给得出「看生成历史」的入口', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  // 方案 4.5：检查器承载过程资产（计划、提示词、快照、生成历史）——查看与复制。
  assert.match(canvas, /生成历史|看生成历史/, '过程资产里必须有「看生成历史」的入口');
});
