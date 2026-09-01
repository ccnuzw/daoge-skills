const test = require('node:test');
const assert = require('node:assert/strict');

test('prompt presentation renders the expanded output shape and compares resolution and size independently', async () => {
  const { planDiff, planPresentation, planStateLabel } = await import('../../web/src/plan-presentation.mjs');
  const first = { operation: 'generate', itemCount: 2, prompt: '雨夜人物头像。', output: { aspectRatio: '1:1', resolution: { width: 1024, height: 1024 }, size: 'medium' }, referenceAssetIds: [] };
  const second = { operation: 'edit', itemCount: 1, prompt: '保留人物身份，改为 45 度侧脸。', output: { aspectRatio: '1:1', resolution: { width: 2048, height: 2048 }, size: 'large' }, referenceAssetIds: ['asset_anchor'] };

  assert.deepEqual(planPresentation(first), { operation: '生成', prompt: '雨夜人物头像。', itemCount: 2, references: [], aspectRatio: '1:1', resolution: '1024 × 1024', size: 'medium', dimensions: '未设置', output: '1:1 · 1024 × 1024 · medium', constraintCount: 1 });
  assert.equal(planStateLabel('confirmed'), '已确认');
  assert.equal(planStateLabel('awaiting_confirmation'), '待确认');
  assert.equal(planStateLabel('draft'), '草稿');
  assert.deepEqual(planDiff(first, second).map((entry) => entry.label), ['提示词', '操作', '数量', '分辨率', '输出尺寸', '参考素材']);
});
