const test = require('node:test');
const assert = require('node:assert/strict');

test('output specification resolves Provider transports without ratio fallbacks', async () => {
  const { resolveOutputSpec } = await import('../../dist/vnext/providers/output-spec.js');
  const compatible = resolveOutputSpec({ providerId: 'gemini-openai-compatible', model: 'fixture-model', output: { aspectRatio: '8:10' } });
  assert.deepEqual(compatible, { ok: true, output: { aspectRatio: '4:5' }, transport: { size: '4:5' } });
  const nativeGemini = resolveOutputSpec({ providerId: 'gemini-image', model: 'fixture-model', output: { aspectRatio: '16:9' } });
  assert.deepEqual(nativeGemini.transport, { aspectRatio: '16:9' });
  const xai = resolveOutputSpec({ providerId: 'xai-grok-image', model: 'fixture-model', output: { aspectRatio: '9:16' } });
  assert.deepEqual(xai.transport, { size: '1024x1024', aspectRatio: '9:16' });
  const openAiWide = resolveOutputSpec({ providerId: 'openai-images', model: 'fixture-model', output: { aspectRatio: '16:9' } });
  assert.equal(openAiWide.ok, false);
  assert.equal(openAiWide.code, 'aspect_ratio_unsupported');
  const invalid = resolveOutputSpec({ providerId: 'gemini-image', model: 'fixture-model', output: { aspectRatio: '0:1' } });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'invalid_aspect_ratio');
  const conflicting = resolveOutputSpec({ providerId: 'gemini-image', model: 'fixture-model', output: { size: '1024x1024', aspectRatio: '16:9' } });
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.code, 'inconsistent_output_spec');
});
