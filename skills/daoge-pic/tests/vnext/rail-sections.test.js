const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * G15 · rail 三区与「一张状态卡」的守卫（界面宪法 §5.3 / §4 S7 / 批 B B1）。
 *
 * 判据：
 *   ① rail 分三区（工作区 / 资料 / 状态），**每个区域一个稳定钩子**；
 *   ② 状态区只有**一张卡**——一行结论 + 点开明细 + 疑难入口（现在拆成两张：生成服务 / 运行状态）；
 *   ③ provider 退避/限流的结论落在**这张卡**里（S7 的唯一常显位置）。
 */

function railSource() {
  return readSource('web/src/workbench-navigation.jsx');
}

test('rail 三区各有稳定钩子', () => {
  const rail = railSource();
  for (const region of ['rail-workspace', 'rail-library', 'rail-status']) {
    assert.ok(rail.includes('data-region="' + region + '"'), 'rail 缺少区域钩子：' + region);
  }
});

test('状态区只有一张卡（两张合并成一张）', () => {
  const rail = railSource();
  assert.equal((rail.match(/rail-status-card/g) || []).length, 1, '状态卡只能有一张（现在是两张：生成服务 + 运行状态）');
  assert.equal(rail.includes('rail-status-details'), false, '旧的第二张卡（details 根）应已并入卡内折叠区');
});

test('provider 退避/限流的结论落在这张卡里（S7 唯一常显位置）', () => {
  const rail = railSource();
  assert.match(rail, /providerRuntimeNotice|runtimeReasonLabel/, '状态卡必须消费 provider 的运行时结论（限流/退避）');
});
