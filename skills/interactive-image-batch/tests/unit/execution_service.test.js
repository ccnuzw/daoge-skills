const test = require('node:test');
const assert = require('node:assert/strict');
const { dryRunResults, selectFailedPrompts } = require('../../src/domain/execution_service');

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

test('failed-only selection skips success and missing-material failures', () => {
  const prompts = [
    { index: 1, title: '成功项', prompt: 'ok' },
    { index: 2, title: '缺素材项', prompt: 'missing material' },
    { index: 3, title: '超时项', prompt: 'timeout' },
  ];
  const selected = selectFailedPrompts(prompts, {
    results: [
      { index: 1, status: 'success' },
      { index: 2, status: 'failed', reason: 'missing_material', error: '素材文件缺失', rerunnable: false },
      { index: 3, status: 'failed', error: 'timeout' },
    ],
  });
  assert.deepEqual(selected.map((item) => item.index), [3]);
  assert.equal(selected[0].title, '超时项');
});

test('failed-only selection skips plain failures without rerun signal', () => {
  const prompts = [
    { index: 1, title: '普通失败项', prompt: 'plain failed image' },
  ];
  const selected = selectFailedPrompts(prompts, {
    results: [
      { index: 1, status: 'failed', error: '生成失败' },
    ],
  });
  assert.deepEqual(selected, []);
});

test('dry-run missing material is a blocked issue, not a direct rerun candidate', () => {
  const [result] = dryRunResults([{
    prompt: 'edit',
    materialIssues: [{ message: '缺少参考图 refs/missing.png' }],
  }]);
  assert.equal(result.ok, false);
  assert.equal(result.rerunnable, false);
  assert.equal(result.reason, 'missing_material');
  assert.equal(result.worthRerun, false);
});
