const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 去问卷的守卫（方案 4.1 · 施工单 Q2）。
 *
 * 判据：**用户不必先认领 5 个「轮次目的」之一**，也能发起；purpose 由 agent 从话里推。
 * 但这是「换问法」不是「删能力」（红线 2.4）：「改一下」展开后，**今天那套控件一个都不能少**。
 */

async function model() {
  try {
    return await import('../../web/src/plan-questionnaire-model.mjs');
  } catch (error) {
    assert.fail('问法模型尚未实现：web/src/plan-questionnaire-model.mjs（' + error.code + '）');
  }
}

test('默认不再出现「先选目的」的问卷', async () => {
  const mod = await model();
  if (typeof mod.questionnaireVisible !== 'function') assert.fail('问法模型尚未实现：questionnaireVisible');
  assert.equal(mod.questionnaireVisible({ mode: 'default' }), false, '默认路径：说一句就够，不要先做选择题');
  assert.equal(mod.questionnaireVisible({ mode: 'advanced' }), true, '「改一下」时才展开');
});

test('「改一下」展开的控件一个都不少（红线 2.4：只加强不删）', async () => {
  const mod = await model();
  if (typeof mod.advancedControls !== 'function') assert.fail('问法模型尚未实现：advancedControls');
  const controls = mod.advancedControls();
  const ids = controls.map((control) => control.id);
  for (const required of ['purpose', 'count', 'aspectRatio', 'variationAxes', 'refinementGoals', 'keepConstraints', 'parentRound']) {
    assert.equal(ids.includes(required), true, '「改一下」里必须还有这些控件：' + required + '（实得 ' + ids.join(',') + '）');
  }
  for (const control of controls) {
    assert.equal(typeof control.label, 'string');
    assert.equal(control.label.length > 0, true);
  }
});