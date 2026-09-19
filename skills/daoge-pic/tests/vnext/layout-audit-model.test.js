const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * G5 · 布局预算的纯函数守卫（界面方案 §4 S1 / §8.1 / 批 A A6 · 决策 D6）。
 *
 * S1 是「可量化的口号」：审计覆盖层 `?audit=layout` 的数字由这个模型算出来。
 * 阈值取 D6 的三档表（工作台面 / 列表面 / 阅读面）。
 *
 * 判据（写死）：
 *   内容占比 = (视口高 − 顶部 chrome − 底部槽常驻 48) / 视口高
 *   顶部 chrome = topbar + status + header + toolbar
 *   首元素 y   = 第一个业务元素到视口顶部的距离
 */

const { webSourceExists } = require('./source-text');

async function model() {
  if (!webSourceExists('web/src/layout-audit.mjs')) assert.fail('布局预算模型尚未实现：web/src/layout-audit.mjs');
  return import('../../web/src/layout-audit.mjs');
}

const viewport = { width: 1440, height: 900 };

test('D6 三档阈值：达标时没有越界，越界时逐条报出', async () => {
  const { layoutBudgets } = await model();
  const ok = layoutBudgets({ kind: 'list', viewport, regions: { topbar: 56, status: 44, header: 88, toolbar: 48, bottom: 48, firstElementY: 200, bands: 2 } });
  assert.equal(ok.violations.length, 0, '列表面这个数字应当达标：' + JSON.stringify(ok.violations));
  assert.ok(ok.contentRatio > 0.55, '列表面内容占比要 ≥55%：' + ok.contentRatio);

  // 状态条在时阈值放宽 44：topChrome 236 仍越界（限额 224）、firstElementY 260 越界（限额 234）、横带 4 越界。
  const bad = layoutBudgets({ kind: 'workbench', viewport, regions: { topbar: 56, status: 44, header: 88, toolbar: 48, bottom: 48, firstElementY: 260, bands: 4 } });
  const ids = bad.violations.map((item) => item.id).sort();
  assert.deepEqual(ids, ['bands', 'firstElementY', 'topChrome'], '越界项要逐条报出（工作台面档）');
});

test('底部槽常驻计入主区、不计入顶部 chrome；展开态另报一个数', async () => {
  const { layoutBudgets } = await model();
  const base = { topbar: 56, status: 0, header: 56, toolbar: 48, firstElementY: 160, bands: 1 };
  const idle = layoutBudgets({ kind: 'workbench', viewport, regions: { ...base, bottom: 48 } });
  const open = layoutBudgets({ kind: 'workbench', viewport, regions: { ...base, bottom: 280 } });
  assert.equal(idle.topChrome, 160, '顶部 chrome 不含底部槽：56+0+56+48');
  assert.ok(open.contentRatio < idle.contentRatio, '展开态要按让位后重算，占比更小');
  assert.equal(layoutBudgets({ kind: 'workbench', viewport, regions: { ...base, bottom: 280 } }).violations.some((v) => v.id === 'contentRatio'), false, '展开态不设阈值（只看折叠态）');
});

test('未知 kind 直接报错，不许悄悄按某一档算', async () => {
  const { layoutBudgets } = await model();
  assert.throws(() => layoutBudgets({ kind: 'unknown', viewport, regions: {} }), /kind|档/);
});
