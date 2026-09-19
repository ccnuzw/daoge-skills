const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { preflightGenerationPlan } = require('../../dist/vnext/runner/preflight');

/**
 * 计划「理解说明」的守卫（方案 9.8 · 施工单 C1 / 决策 D3）。
 *
 * 「它为什么这么理解」此前只能从计划反推（提示词 + 数量 + 规格）。9.8 给契约加一个
 * **可选**的 3–5 句结论性说明（不是推理链，推理过程仍不进库）。
 *
 * 三条必须成立：
 *   ① 契约里字段**可选**——旧计划（没有它）照样能跑预检；
 *   ② 新计划带上它也不改变预检结果（它只是说明，不是执行参数）；
 *   ③ 检查器能把它显示成人话。
 */

function providerStatusFor(overrides = {}) {
  return {
    configured: true,
    profileId: 'profile_1',
    profileName: 'Test',
    configVersion: 1,
    providerId: 'openai-images',
    model: 'gpt-image-2',
    referenceEnabled: false,
    endpointTrustMode: 'compatible_public',
    limits: { maxRunItems: 100, maxExecutionConcurrency: 10, maxRetryAttempts: 3, requestTimeoutMs: 60000 },
    descriptorVersion: 1,
    adapterVersion: 'http-image-v1',
    capabilities: { generate: true, edit: true, referenceImage: false, mask: true },
    ...overrides
  };
}

test('契约里 understanding 是可选的：旧计划照跑，新计划不改变预检结果', () => {
  const legacy = preflightGenerationPlan({ operation: 'generate', itemCount: 2, prompt: '两张静物' }, providerStatusFor());
  assert.equal(legacy.valid, true, JSON.stringify(legacy.issues || []));
  const withNote = preflightGenerationPlan({ operation: 'generate', itemCount: 2, prompt: '两张静物', understanding: '理解为：延续上一批的光影，只换背景。' }, providerStatusFor());
  assert.equal(withNote.valid, true);
  assert.equal(withNote.normalizedPlan.itemCount, legacy.normalizedPlan.itemCount, '说明不是执行参数，不该改变计划');
  assert.equal(withNote.normalizedPlan.prompt, legacy.normalizedPlan.prompt);
});

test('类型契约里有这个可选字段（协议 3.1.0 的加法）', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/vnext/runner/preflight.ts'), 'utf8');
  assert.match(source, /understanding\?: string/, 'PreflightPlan 要新增可选字段 understanding');
});

test('检查器能把说明翻成人话；没有说明时不硬凑', async () => {
  let mod;
  try {
    mod = await import('../../web/src/plan-understanding-model.mjs');
  } catch (error) {
    assert.fail('理解说明展示模型尚未实现：web/src/plan-understanding-model.mjs（' + error.code + '）');
  }
  if (typeof mod.understandingNote !== 'function') assert.fail('尚未实现：plan-understanding-model 的 understandingNote');
  assert.equal(mod.understandingNote({ prompt: 'x' }), '', '没有说明就返回空串，不硬凑一句话');
  const note = mod.understandingNote({ understanding: '理解为：延续上一批的光影，只换背景。' });
  assert.match(note, /理解为/);
});