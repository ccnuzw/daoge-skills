const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 失败文案的守卫（方案 4.10）。
 *
 * 两句方案原话钉在这里：
 *   「失败是结果的一部分」——批次状态里要说，而不是弹窗；
 *   「分清是我的问题还是系统的问题」——下一步完全不同：改描述 vs 等一等。
 * 归因宁可说「原因没写明」，也不瞎猜 —— 错怪哪一边都会让人做错下一步。
 */

test('归因：被挡 = 我的问题；服务信号 = 系统的问题；没写明就说没写明', async () => {
  const { failureAttribution } = await import('../../web/src/failure-copy-model.mjs');
  // 被挡（blocked）：内容审核挡的，改请求才过得去。
  assert.equal(failureAttribution({ status: 'blocked' }).owner, 'me');
  // 服务侧信号：限流 / 超时 / 网络 / 5xx。
  assert.equal(failureAttribution({ status: 'failed', error: { summary: 'rate limit exceeded' } }).owner, 'system');
  assert.equal(failureAttribution({ status: 'failed', error: { summary: 'connection timeout' } }).owner, 'system');
  assert.equal(failureAttribution({ status: 'failed', error: { summary: 'upstream 503' } }).owner, 'system');
  // 请求侧信号：审核词 / 参数。
  assert.equal(failureAttribution({ status: 'failed', error: { summary: '内容审核未通过' } }).owner, 'me');
  assert.equal(failureAttribution({ status: 'failed', error: { summary: 'invalid parameter: size' } }).owner, 'me');
  // ⚠️ 摘要里什么都没有 → 老实说「原因没写明」，不猜。
  const unknown = failureAttribution({ status: 'failed' });
  assert.equal(unknown.owner, 'unknown');
  assert.match(unknown.advice, /没写明/);
});

test('批次摘要把「没成」与「被挡」分开说——两者的下一步不同', async () => {
  const { batchFailureSummary } = await import('../../web/src/failure-copy-model.mjs');
  assert.equal(batchFailureSummary({ failed: 2, blocked: 1 }), '2 张没成 · 1 张被挡');
  assert.equal(batchFailureSummary({ failed: 3 }), '3 张没成');
  assert.equal(batchFailureSummary({ blocked: 2 }), '2 张被挡');
  assert.equal(batchFailureSummary({}), '', '没有失败就什么都不说，不凑字');
});

test('接线：批次摘要用模型区分两类失败，检查器里给归因', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.match(canvas, /failure-copy-model\.mjs/, '画布必须用这个模型');
  assert.match(canvas, /batchFailureSummary\(/, '批次摘要必须区分「没成」与「被挡」');
  assert.match(canvas, /failureAttribution\(/, '检查器里必须给归因（我的问题 / 系统的问题）');
});
