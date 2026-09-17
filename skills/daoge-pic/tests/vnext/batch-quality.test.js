const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 「质量指标跟着看的东西走」的守卫（方案 7.10.2）。
 *
 * 方案的判据：人在画布上选中一个批次，想看的就是**这一批**的质量——
 * 不是去项目总览翻一张项目级的大表。所以检查器要有「这一批」的那一份。
 * **项目级指标留在 project-overview（能力只加强不删）**——这里是加，不是搬走。
 */

test('评审分布的统计与既有口径一致（含回收站）', async () => {
  const { reviewDistribution } = await import('../../web/src/batch-quality-model.mjs');
  const assets = [
    { id: 'a', review: { decision: 'keep' } },
    { id: 'b', review: { decision: 'keep' } },
    { id: 'c', review: { decision: 'reject' } },
    { id: 'd', review: { decision: 'derive' } },
    { id: 'e', review: { decision: 'review' } },
    { id: 'f' },
    { id: 'g', deletedAt: '2026-09-17T00:00:00Z', review: { decision: 'keep' } },
    null
  ];
  // `null` 条目与「无决策」一样归入 unreviewed —— 这是既有口径（reviewDecisionCounts 的行为），模型保持一致。
  assert.deepEqual(reviewDistribution(assets), { keep: 2, review: 1, reject: 1, derive: 1, unreviewed: 2, trash: 1 });
  assert.deepEqual(reviewDistribution(null), { keep: 0, review: 0, reject: 0, derive: 0, unreviewed: 0, trash: 0 });
  assert.deepEqual(reviewDistribution([]), { keep: 0, review: 0, reject: 0, derive: 0, unreviewed: 0, trash: 0 });
});

test('质量摘要是人话：只说有的，不说零', async () => {
  const { batchQualityCopy } = await import('../../web/src/batch-quality-model.mjs');
  const full = batchQualityCopy({ keep: 2, review: 0, reject: 1, derive: 1, unreviewed: 2, trash: 0 }, 6);
  assert.match(full, /6 张图/);
  assert.match(full, /2 张已选定/);
  assert.match(full, /1 张不采用/);
  assert.match(full, /2 张还没定/, '待复核与未评审合并成「还没定」（0 + 2 = 2）——用户此刻只关心还有多少没处理');
  assert.doesNotMatch(full, /0 张/, '零的项不出现');

  assert.equal(batchQualityCopy({ keep: 0, review: 0, reject: 0, derive: 0, unreviewed: 0, trash: 0 }, 0), '', '空批次什么都不说');
});

test('接线：canvas 的统计委托给模型，检查器的批次视图渲染质量摘要', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  // 单一来源：canvas 自己不再手写一份统计。
  assert.match(canvas, /batch-quality-model\.mjs/, '画布必须用这个模型');
  // 旧的独立实现必须消失（否则两份口径迟早漂移）。
  assert.doesNotMatch(canvas, /function reviewDecisionCounts\(assets\) \{\s*return listValue\(assets\)\.reduce/, '旧的独立统计实现必须删掉，改为委托模型');
  // 检查器里真的渲染。
  assert.match(canvas, /batchQualityCopy\(/, '检查器必须渲染批次质量摘要');
  assert.match(canvas, /这一批的质量|batchQualityCopy/, '质量摘要要有落点');
});
