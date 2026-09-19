const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readSource, webSourceExists } = require('./source-text');

/**
 * G4 · 状态槽的守卫（界面方案 §4 S7 / §5.1 / 批 A A4）。
 *
 * 判据：**同一时刻只渲染一条状态**；优先级写死在模型里；`alert` 级永不折叠（第 4 批新增的
 * provider 全挂/磁盘满提示属 alert 级——折叠它等于把「整层不可用」藏起来）。
 *
 * 现状：7 条条件状态条常驻在 shell 里（方案 F2）。
 */

function requireModule(relative, label) {
  if (!webSourceExists(relative)) assert.fail(label + '尚未实现：' + relative);
  return require(path.resolve(__dirname, '../..', relative));
}

test('状态槽模型存在，且优先级按 S7 写死', () => {
  const model = requireModule('web/src/status-slot-model.mjs', '状态槽模型');
  if (typeof model.statusSlotPlan !== 'function') assert.fail('状态槽模型尚未实现：statusSlotPlan');
  const order = ['runtime-danger', 'provider-outage', 'connection-error', 'request-error', 'cancel-undo', 'notice'];
  assert.deepEqual(model.STATUS_PRIORITY, order, '优先级顺序必须与 S7 一致');
  const plan = model.statusSlotPlan([
    { id: 'notice', tone: 'notice' },
    { id: 'provider-outage', tone: 'provider-outage' },
    { id: 'runtime-danger', tone: 'runtime-danger' }
  ]);
  assert.equal(plan.primary.id, 'runtime-danger', '同一时刻只出一条，且取最高优先级');
  assert.equal(plan.overflowCount, 2, '其余折叠为「还有 N 条」');
  assert.equal(plan.primary.folded, false, 'alert 级永不折叠');
});

test('状态槽组件存在，且 shell 里只有一处接入', () => {
  // ⚠️ 不能 require `.jsx`（JSX 语法进不了 require）——用 source-text 的单一入口读源码。
  assert.equal(webSourceExists('web/src/components/StatusSlot.jsx'), true, '状态槽组件尚未实现：web/src/components/StatusSlot.jsx');
  assert.match(readSource('web/src/components/StatusSlot.jsx'), /data-region="status"/, '状态槽必须带 data-region="status"（测试只认钩子）');
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  assert.equal((main.match(/<StatusSlot /g) || []).length, 1, 'shell 里状态槽只许接一处（常驻横带 ≤3 的一半靠它）');
});
