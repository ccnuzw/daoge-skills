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

test('等待重试与结果未知各有各的说法，不能掉进「原因没写明」兜底', async () => {
  const { failureAttribution } = await import('../../web/src/failure-copy-model.mjs');
  // retry_wait：系统自己在重试，**别催用户去改描述**（掉进兜底就会说成「没写明」，那是错的）。
  const waiting = failureAttribution({ status: 'retry_wait' });
  assert.equal(waiting.owner, 'system', '自动重试是系统那边的事');
  assert.match(waiting.advice, /自动重试/);
  assert.doesNotMatch(waiting.advice, /没写明/);
  // outcome_unknown：不是「你要改」也不是「等等就好」，是要人去核实一次；
  // 文案走人话邀请，**不许出现「结果未知」四个字**（方案 4.10 的两段式修正）。
  const unknownOutcome = failureAttribution({ status: 'outcome_unknown' });
  assert.match(unknownOutcome.label, /确认/, '要说「先确认出没出」');
  assert.match(unknownOutcome.advice, /服务商后台|看一眼/, '要给人一个能做的动作');
  assert.doesNotMatch(unknownOutcome.advice, /结果未知/);
});

test('失败状态清单是唯一来源：界面按它决定渲染，不在别处再写一遍', async () => {
  const { FAILURE_STATUSES, isFailureStatus, failureAttributionLine } = await import('../../web/src/failure-copy-model.mjs');
  assert.deepEqual([...FAILURE_STATUSES].sort(), ['blocked', 'failed', 'outcome_unknown', 'retry_wait']);
  assert.equal(isFailureStatus('succeeded'), false);
  assert.equal(isFailureStatus('pending'), false);
  assert.equal(isFailureStatus('failed'), true);
  // 非失败状态返回 null —— 界面据此不渲染，成功图上不会多一句「等一等就能过」。
  assert.equal(failureAttributionLine({ status: 'succeeded' }), null);
  assert.equal(failureAttributionLine({ status: 'pending' }), null);
  assert.ok(failureAttributionLine({ status: 'failed' }), '失败类状态必须给出归因');
});

test('批次摘要把「没成」与「被挡」分开说——两者的下一步不同', async () => {
  const { batchFailureSummary } = await import('../../web/src/failure-copy-model.mjs');
  assert.equal(batchFailureSummary({ failed: 2, blocked: 1 }), '2 张没成 · 1 张被挡');
  assert.equal(batchFailureSummary({ failed: 3 }), '3 张没成');
  assert.equal(batchFailureSummary({ blocked: 2 }), '2 张被挡');
  assert.equal(batchFailureSummary({}), '', '没有失败就什么都不说，不凑字');
});

test('接线：批次摘要在画布上用模型区分「没成」与「被挡」', () => {
  const canvas = (readSource('web/src/creative-lineage-canvas.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs'));
  assert.match(canvas, /failure-copy-model\.mjs/, '画布必须用这个模型');
  assert.match(canvas, /batchFailureSummary\(/, '批次摘要必须区分「没成」与「被挡」');
});

/**
 * ⚠️ 这一条是本项的要害。
 *
 * 归因最早只接在画布的 `RunItemActions` 上——而那条路径**自第 1 批 B2 起就不可达**
 * （`run_item` 节点已经不再创建），所以守卫当时锁的只是「字符串存在」，不是「用户看得见」。
 * 结果是：模型有单测、但**没有一处界面用它**，方案 4.10 的第三条呈现原则等于没交付。
 *
 * 现在它接在**真正可达的 Runs 视图**（`main.jsx` 的 `RunItemRow` / `RunItemDetailDialog`）上，
 * 所以断言也改成盯这条路径。
 */
test('接线：归因接在可达的 Runs 视图上（不是已经不可达的画布分支）', () => {
  // 批 E（第 9 批）迁移：运行面搬去 app/run-surfaces.jsx——归因跟着家走。
  const runs = readSource('web/src/app/run-surfaces.jsx');
  assert.match(runs, /failure-copy-model\.mjs/, '运行面必须引入归因模型');
  assert.match(runs, /failureAttributionLine\(item\)/, 'Runs 视图必须真的调用它');
  // 画布那条路径早就不存在了：代码与守卫都不该再提它。
  assert.doesNotMatch((readSource('web/src/creative-lineage-canvas.jsx') + '\n' + readSource('web/src/canvas/lineage-shared.mjs')), /failureAttribution/, '画布上不该再有归因（那条分支已不可达）');
});
