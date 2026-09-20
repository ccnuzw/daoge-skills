const test = require('node:test');
const assert = require('node:assert/strict');

const { isDismissKey, shouldDismissOnChange, shouldDismissOnPointerDown, shouldDismissOnSelect } = require('../../web/src/disclosure-model.mjs');
const { readSource, readFrontendSource } = require('./source-text');

/**
 * 浮层收回的守卫（界面宪法 §5.2「点开切换」）。
 *
 * 判据三条，全部来自本次实机复现：
 *   ① 面板里选完一项 → **收**（浏览器不会替你收；`<details>` 的 open 属性谁都不碰）；
 *   ② 点浮层之外 → 收（否则菜单会一直挂着，挡住下面的画布）；
 *   ③ Esc → 收（键盘用户不该被留在展开的面板里）。
 *
 * 纯判断在 `web/src/disclosure-model.mjs`，这里同时盯住「调用点真的用了它」——
 * 靠自觉的写法正是这批 20 多个浮层里 18 个漏掉的原因。
 */

/** 假 DOM：只实现判据用到的那点接口（contains / closest）。 */
function node({ contains = () => false } = {}) {
  return { contains };
}
function element({ closest = () => null } = {}) {
  return { closest };
}

test('Esc 认，别的键不认', () => {
  assert.equal(isDismissKey('Escape'), true);
  assert.equal(isDismissKey('escape'), true, '大小写不该影响判定');
  assert.equal(isDismissKey('Enter'), false);
  assert.equal(isDismissKey(' '), false);
  assert.equal(isDismissKey(undefined), false, '没有 key 的合成事件不该被当成 Esc');
});

test('点浮层之外才收，点里面不收', () => {
  const panel = node({ contains: (target) => target === 'inside' });
  assert.equal(shouldDismissOnPointerDown({ open: true, node: panel, target: 'outside' }), true);
  assert.equal(shouldDismissOnPointerDown({ open: true, node: panel, target: 'inside' }), false, '面板里点一下不该把面板点没了');
  assert.equal(shouldDismissOnPointerDown({ open: false, node: panel, target: 'outside' }), false, '本来就没开，什么都不用做');
  assert.equal(shouldDismissOnPointerDown({ open: true, node: panel, target: null }), false, '拿不到 target 时不动它');
  assert.equal(shouldDismissOnPointerDown({}), false);
});

test('选中面板里的按钮就收，点面板空白不收', () => {
  // 真实情形：点在按钮里的图标上 —— target 是 svg，closest 找到包住它的那个按钮。
  const item = { tag: 'button' };
  const inside = element({ closest: (selector) => (selector.includes('button') ? item : null) });
  const foreignItem = { tag: 'button' };
  const outside = element({ closest: () => foreignItem });
  const panel = node({ contains: (target) => target === inside || target === item });
  assert.equal(shouldDismissOnSelect({ node: panel, target: inside }), true);
  assert.equal(shouldDismissOnSelect({ node: panel, target: outside }), false, '别的浮层里的按钮不该把这一层关掉');
  assert.equal(shouldDismissOnSelect({ node: panel, target: element({ closest: () => null }) }), false, '点的是说明文字，不是动作');
  assert.equal(shouldDismissOnSelect({ node: panel, target: null }), false);
  assert.equal(shouldDismissOnSelect({}), false);
});

test('判据看的是「点到了按钮」，不是「点在按钮的哪一层」', () => {
  // 真实点击落在图标或文字上：closest 会往上找到那个按钮。
  const svg = element({ closest: (selector) => (selector.includes('button') ? { tag: 'button' } : null) });
  const panel = node({ contains: () => true });
  assert.equal(shouldDismissOnSelect({ node: panel, target: svg }), true);
});

test('下拉选完（change）也收；点开下拉的那一刻不收', () => {
  const selectItem = { tag: 'select' };
  const select = element({ closest: (selector) => (selector === 'select' ? selectItem : null) });
  const panel = node({ contains: (target) => target === select || target === selectItem });
  assert.equal(shouldDismissOnChange({ node: panel, target: select }), true, '值变了就是「选完了」');
  assert.equal(shouldDismissOnChange({ node: panel, target: element({ closest: () => ({ tag: 'select' }) }) }), false, '面板外的下拉不该关掉这一层');
  assert.equal(shouldDismissOnChange({ node: panel, target: element({ closest: () => ({ tag: 'button' }) }) }), false, '按钮走 shouldDismissOnSelect，不走这条');
  assert.equal(shouldDismissOnChange({ node: panel, target: null }), false);
  assert.equal(shouldDismissOnChange({}), false);
  // 两条判据各管各的：同一个 target 不可能两边都命中（select ≠ button/菜单项）
  assert.equal(shouldDismissOnSelect({ node: panel, target: select }), false);
});

test('调用点真的走同一个浮层组件（不许再手写裸 details）', () => {
  const hosts = [
    'web/src/app/shell-pieces.jsx',
    'web/src/canvas/creator-workbench.jsx',
    'web/src/canvas/lineage-inspector.jsx',
    'web/src/views/assets.jsx',
    'web/src/asset-state-legend.jsx',
    'web/src/workbench-navigation.jsx',
    'web/src/creative-action-launcher.jsx',
    'web/src/components/StatusSlot.jsx'
  ];
  const offenders = hosts.filter((file) => !readSource(file).includes('<Disclosure'));
  assert.deepEqual(offenders, [], '这些地方还留着裸 details 菜单：' + offenders.join('、'));

  const stillRaw = hosts.filter((file) => readSource(file).includes('<details'));
  assert.deepEqual(stillRaw, [], '这些地方又写回了裸 details：' + stillRaw.join('、'));
});

test('顶栏与画布工具条的菜单项仍带 role="menuitem"（无障碍语义不许在改造中丢）', () => {
  const breadcrumb = readSource('web/src/app/shell-pieces.jsx');
  assert.match(breadcrumb, /role="menuitem"/, '面包屑的选项仍然是菜单项');
  const frontend = readFrontendSource();
  assert.match(frontend, /summary=\{|<summary/, 'summary 仍然是显式传入的（键盘与读屏行为不变）');
});