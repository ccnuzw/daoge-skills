const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 回执的守卫（方案 4.1 · 施工单 Q1 / Q3）。
 *
 * 4.1 把「出图问法」倒过来：用户不必先认领 5 个「轮次目的」，
 * 由 **agent** 把判断摆回来——**「我准备这么出：…」**，人只需要核对那一句。
 *
 * 两件事必须成立：
 *   ① 回执说人话，且**包含唯一那道必答题**——有没有上一批（明示且可否决）；
 *   ② 回执可读 = 用户不需要认识那 5 个术语。
 *
 * 纯函数：由已有的批次 + 计划算出，不新增状态（红线 2.1）。
 */

async function model() {
  try {
    return await import('../../web/src/request-progress-model.mjs');
  } catch (error) {
    assert.fail('回执模型尚未实现：web/src/request-progress-model.mjs（' + error.code + '）');
  }
}

function receiptModel(mod) {
  if (typeof mod.receiptFor !== 'function') assert.fail('回执尚未实现：request-progress-model 的 receiptFor');
  return mod;
}

const round = { id: 'rnd_1', planVersion: 2, plan: { itemCount: 4, output: { aspectRatio: '4:5' } } };

test('回执说人话：有上一批就明示承接，没有就说从零开始', async () => {
  const mod = receiptModel(await model());
  const inherited = mod.receiptFor({ request: { id: 'req_1' }, round: { ...round, plan: { ...round.plan, requestId: 'req_1', parentRoundId: 'rnd_parent' } }, plan: { ...round.plan, parentRoundId: 'rnd_parent' } });
  assert.equal(inherited.ready, true);
  assert.equal(inherited.lines.some((line) => /承接|上一批|上一步/.test(line)), true, '有上游必须说出来：' + JSON.stringify(inherited.lines));
  const fresh = mod.receiptFor({ request: { id: 'req_2' }, round, plan: round.plan });
  assert.equal(fresh.ready, true);
  assert.equal(fresh.lines.some((line) => /从零|全新|首个/.test(line)), true, '没有上游也要说清楚');
});

test('回执带上数量与规格，且不出现那 5 个内部术语', async () => {
  const mod = receiptModel(await model());
  const receipt = mod.receiptFor({ request: { id: 'req_3' }, round, plan: round.plan });
  assert.equal(receipt.lines.some((line) => /4 张/.test(line)), true, '要说几张');
  assert.equal(receipt.lines.some((line) => /4:5/.test(line)), true, '要说规格');
  const text = receipt.lines.join(' ');
  for (const term of ['exploration', 'variation', 'refinement', 'purpose', '轮次目的']) {
    assert.equal(text.includes(term), false, '回执里不该出现内部术语：' + term);
  }
});

test('上一批是必答题：明示、可否决', async () => {
  const mod = receiptModel(await model());
  if (typeof mod.parentDecision !== 'function') assert.fail('必答题尚未实现：request-progress-model 的 parentDecision');
  const suggested = mod.parentDecision({ parentRoundId: null, suggestedParentId: 'rnd_parent' });
  assert.equal(suggested.required, true, '「有没有上一批」必须问');
  assert.equal(suggested.suggested, 'rnd_parent', '可以给建议');
  assert.equal(suggested.revocable, true, '建议必须可否决（猜错代价高）');
  const explicit = mod.parentDecision({ parentRoundId: 'rnd_parent', suggestedParentId: 'rnd_parent' });
  assert.equal(explicit.suggested, 'rnd_parent');
  assert.equal(explicit.required, true);
});