const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');
const { asideMetrics, ASIDE_METRIC_KEYS } = require('../../web/src/aside-model.mjs');

/**
 * G21 · 指标四项进右栏顶部（界面批 C · C5）。
 *
 * 判据：① 四项 = 成果 / 未定 / 不采用 / 运行（原焦点条的创作决策统计，一个不丢）；
 *       ② **不新增事实源**：只从画布已有的图数据与运行列表派生（不许多一次 fetch）；
 *       ③ 无选中也在（见 aside-unified）。
 */
test('四项指标的算法在模型里，且数字口径与旧横带一致', () => {
  const graph = { metrics: { selected: 3, reviews: { unreviewed: 2, review: 1, reject: 4, keep: 1 } } };
  const runs = [{ id: 'a' }, { id: 'b' }];
  const metrics = asideMetrics({ graph, runs, statusText: () => '已完成 2' });
  assert.deepEqual(metrics.map((item) => item.key), ASIDE_METRIC_KEYS);
  assert.deepEqual(metrics.map((item) => item.label), ['成果', '未定', '不采用', '运行']);
  assert.deepEqual(metrics.map((item) => item.value), [3, 3, 4, 2]);
  assert.equal(metrics[3].title, '已完成 2');
  // 成果为空时回落到 reviews.keep（与旧实现同口径）
  assert.equal(asideMetrics({ graph: { metrics: { reviews: { keep: 5 } } }, runs: [] })[0].value, 5);
});

test('画布只消费模型，不自己算、也不新增请求', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.match(canvas, /import \{ asideMetrics, asideSubject \} from '\.\/aside-model\.mjs'/, '必须走右栏模型');
  assert.match(canvas, /const inspectorMetrics = asideMetrics\(\{ graph, runs, statusText: \(list\) => statusCountText\(runStatusCounts\(list\)\) \}\)/, '四项只从既有事实源派生');
  assert.doesNotMatch(canvas, /fetch\(/, '画布不许为指标新增请求');
  const model = readSource('web/src/aside-model.mjs');
  for (const label of ['成果', '未定', '不采用', '运行']) assert.ok(model.includes("'" + label + "'"), '标签必须住在模型里（' + label + '）');
});
