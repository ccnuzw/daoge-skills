const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 「我的配方」的守卫（方案 9.6 · 施工单 M1 / 决策 D4）。
 *
 * 用户侧跨项目复用：把一次可用的配置存成配方，下次发起时**带出来**。
 * 两条边界写死：
 *   - **带出 ≠ 自动执行**：配方只是把「起点」放好，仍然要人确认才出图（规格书 §2.3）；
 *   - **带出可改**：带出来的是草稿，不是命令。
 */

async function model() {
  try {
    return await import('../../web/src/recipe-model.mjs');
  } catch (error) {
    assert.fail('配方模型尚未实现：web/src/recipe-model.mjs（' + error.code + '）');
  }
}

function required(mod, name) {
  if (typeof mod[name] !== 'function') assert.fail('配方模型尚未实现：' + name);
  return mod[name];
}

test('能从一个可用批次里存出配方草稿（跨项目复用）', async () => {
  const mod = await model();
  const recipeDraftFrom = required(mod, 'recipeDraftFrom');
  const draft = recipeDraftFrom({
    plan: { prompt: '极简静物：白瓷杯，暖侧光', itemCount: 4, output: { aspectRatio: '4:5' } },
    task: { name: '静物系列' }
  });
  assert.equal(typeof draft.name, 'string');
  assert.equal(draft.name.length > 0, true, '配方要有名字（否则列表里认不出来）');
  assert.equal(draft.definition.prompt, '极简静物：白瓷杯，暖侧光');
  assert.equal(draft.definition.itemCount, 4);
});

test('配方带出的是「可改起点」，不是执行命令', async () => {
  const mod = await model();
  const recipeSuggestion = required(mod, 'recipeSuggestion');
  const suggestion = recipeSuggestion({ recipes: [{ id: 'rec_1', name: '静物四张', definition: { prompt: '白瓷杯暖光', itemCount: 4 } }], brief: '再来一组静物' });
  assert.equal(suggestion.applied, false, '带出≠执行：不许自动应用');
  assert.equal(suggestion.requiresConfirmation, true, '要经过人确认');
  assert.equal(typeof suggestion.draft?.prompt, 'string', '带出的是草稿（可改）');
});

test('没有可用的配方时不硬凑', async () => {
  const mod = await model();
  const recipeSuggestion = required(mod, 'recipeSuggestion');
  const none = recipeSuggestion({ recipes: [], brief: '随便出点什么' });
  assert.equal(none.applied, false);
  assert.equal(none.draft, null);
});