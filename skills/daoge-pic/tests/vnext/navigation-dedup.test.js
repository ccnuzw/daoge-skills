const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource, readFrontendSource } = require('./source-text');

/**
 * G10 · 导航去重的守卫（界面宪法 §5.3 去重表 / 批 B B3）。
 *
 * 判据：**同一目的地在 rail 与页签里不得同名出现**；上下文条**不再承载导航**（只剩面包屑）。
 * 但这是「收」不是「删」——rail 的四个一级入口与资料区入口**一个都不能少**（红线 2.4）。
 */

function contextBarBlock() {
  const main = readSource('web/src/main.jsx');
  const start = main.indexOf('function WorkspaceContextBar');
  assert.ok(start !== -1, '找不到上下文条组件（它应当还在，只是降级为面包屑容器）');
  const next = main.indexOf('\nfunction ', start + 10);
  return main.slice(start, next === -1 ? undefined : next);
}

test('上下文条不再有导航页签（资产管理 / 创作平台 / 批次对比 / 计划 / 生成历史）', () => {
  const block = contextBarBlock();
  assert.equal(block.includes('task-local-tabs'), false, '旧的任务页签块应已删除：导航只在 rail，动作另有其位');
  for (const [view, label] of [['assets', '资产管理'], ['lineage', '创作平台'], ['studio-overview', '批次对比']]) {
    assert.equal(block.includes("onNavigate('" + view + "'"), false, '上下文条不该再导航到 ' + label + '（rail 已有）');
  }
});

test('rail 的一级入口与资料区入口一个都不能少（去重是「收」不是「删」）', () => {
  const navigation = readSource('web/src/workbench-navigation.jsx');
  for (const label of ['项目管理', '创作平台', '资产管理', '资产交付']) {
    assert.ok(navigation.includes(label), 'rail 缺少一级入口：' + label);
  }
  for (const label of ['规则资料', '共享素材']) {
    assert.ok(navigation.includes(label), 'rail 缺少资料区入口：' + label);
  }
  // 去重后，rail 是这些目的地的**唯一**常驻入口。
  const main = readFrontendSource();
  assert.equal(/view === 'deliveries' \? 'is-active'/.test(main), false, '交付不该再从页签里当导航项');
});
