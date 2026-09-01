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
  const openAiVertical = resolveOutputSpec({ providerId: 'openai-images', model: 'fixture-model', output: { aspectRatio: '9:16', resolution: '1K' } });
  assert.deepEqual(openAiVertical, { ok: true, output: { aspectRatio: '9:16', resolution: '1K', size: '576x1024' }, transport: { size: '576x1024' } });
  assert.deepEqual(resolveOutputSpec({ providerId: 'openai-images', model: 'fixture-model', output: openAiVertical.output }), openAiVertical);
  const conflictingResolution = resolveOutputSpec({ providerId: 'openai-images', model: 'fixture-model', output: { aspectRatio: '9:16', resolution: '2K', size: '576x1024' } });
  assert.equal(conflictingResolution.ok, false);
  assert.equal(conflictingResolution.code, 'inconsistent_output_spec');
  const openAiMissingSize = resolveOutputSpec({ providerId: 'openai-images', model: 'fixture-model', output: { aspectRatio: '16:9' } });
  assert.equal(openAiMissingSize.ok, false);
  assert.equal(openAiMissingSize.code, 'aspect_requires_explicit_size');
  const invalid = resolveOutputSpec({ providerId: 'gemini-image', model: 'fixture-model', output: { aspectRatio: '0:1' } });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'invalid_aspect_ratio');
  const conflicting = resolveOutputSpec({ providerId: 'gemini-image', model: 'fixture-model', output: { size: '1024x1024', aspectRatio: '16:9' } });
  assert.equal(conflicting.ok, false);
  assert.equal(conflicting.code, 'inconsistent_output_spec');
});
