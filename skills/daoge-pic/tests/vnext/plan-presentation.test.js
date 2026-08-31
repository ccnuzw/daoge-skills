const test = require('node:test');
const assert = require('node:assert/strict');

test('prompt presentation renders readable plan fields and compares confirmed versions', async () => {
  const { planDiff, planPresentation, planStateLabel } = await import('../../web/src/plan-presentation.mjs');
  const first = { operation: 'generate', itemCount: 2, prompt: '雨夜人物头像。', output: { aspectRatio: '1:1' }, referenceAssetIds: [] };
  const second = { operation: 'edit', itemCount: 1, prompt: '保留人物身份，改为 45 度侧脸。', output: { aspectRatio: '1:1' }, referenceAssetIds: ['asset_anchor'] };

  assert.deepEqual(planPresentation(first), { operation: '生成', prompt: '雨夜人物头像。', itemCount: 2, references: [], output: '1:1', constraintCount: 1 });
  assert.equal(planStateLabel('confirmed'), '已确认');
  assert.equal(planStateLabel('awaiting_confirmation'), '待确认');
  assert.equal(planStateLabel('draft'), '草稿');
  assert.deepEqual(planDiff(first, second).map((entry) => entry.label), ['提示词', '操作', '数量', '参考素材']);
});
