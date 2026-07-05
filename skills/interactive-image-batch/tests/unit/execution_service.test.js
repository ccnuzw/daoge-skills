const test = require('node:test');
const assert = require('node:assert/strict');
const { dryRunResults } = require('../../src/domain/execution_service');

test('dry-run results keep global numbering across batch offsets', () => {
  const results = dryRunResults([{ prompt: 'a' }, { prompt: 'b' }], 2);
  assert.deepEqual(results.map((item) => item.index), [3, 4]);
  assert.deepEqual(results.map((item) => item.title), ['结果 3', '结果 4']);
});

test('dry-run results classify camelCase reference images as edit requests', () => {
  const [result] = dryRunResults([{ prompt: 'edit', referenceImages: ['a.png'] }]);
  assert.equal(result.requestMode, 'reference-assisted');
});

test('dry-run results do not let empty snake_case references hide camelCase references', () => {
  const [result] = dryRunResults([{ prompt: 'edit', reference_images: [], referenceImages: ['a.png'] }]);
  assert.equal(result.requestMode, 'reference-assisted');
});
