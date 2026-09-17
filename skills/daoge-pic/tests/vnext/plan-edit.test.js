const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 「手工改计划」的守卫（方案 4.5）。
 *
 * 底层机制早就对：写计划带 `expectedVersion`、`plan_version` 与 `version` 双递增
 * → **改后旧确认自动失效**，所以「改完必须提示重新确认」不是客套，是流程的一部分。
 * 缺的只是界面。守卫盯三件事：只暴露人改得动的字段、别把工程字段弄丢、改完要提示。
 */

test('编辑计划：只覆盖「提示词」与「数量」，其余字段原样保留', async () => {
  const { applyPlanEdit, planEditForm, planEditIssues } = await import('../../web/src/plan-edit-model.mjs');
  const saved = {
    operation: 'edit',
    itemCount: 4,
    prompt: '夜景，暖光',
    referenceAssetIds: ['asset_1', 'asset_2'],
    maskAssetId: 'asset_3',
    output: { aspectRatio: '4:5' },
    itemPrompts: ['第一张的描述']
  };
  const form = planEditForm(saved);
  assert.deepEqual(form, { prompt: '夜景，暖光', itemCount: 4 });

  const next = applyPlanEdit(saved, { prompt: '夜景，暖光，更亮', itemCount: 6 });
  assert.equal(next.prompt, '夜景，暖光，更亮');
  assert.equal(next.itemCount, 6);
  // ⚠️ 写计划是**整份替换**：漏字段就等于把引用素材、遮罩、输出规格删掉。
  assert.deepEqual(next.referenceAssetIds, ['asset_1', 'asset_2'], '引用素材不能被改计划弄丢');
  assert.equal(next.maskAssetId, 'asset_3', '遮罩不能被弄丢');
  assert.deepEqual(next.output, { aspectRatio: '4:5' }, '输出规格不能被弄丢');
  assert.equal(next.operation, 'edit', '操作类型不由这个界面改，但必须原样带回');

  // 表单校验给的是人话，不是错误码。
  assert.deepEqual(planEditIssues({ prompt: '有内容', itemCount: 4 }), []);
  assert.deepEqual(planEditIssues({ prompt: '   ', itemCount: 4 }), ['提示词不能空着。']);
  assert.deepEqual(planEditIssues({ prompt: 'x', itemCount: 0 }), ['数量要在 1 到 1000 之间。']);
  assert.deepEqual(planEditIssues({ prompt: 'x', itemCount: 5000 }), ['数量要在 1 到 1000 之间。']);
  assert.deepEqual(planEditIssues({ prompt: 'x', itemCount: 1.5 }), ['数量要在 1 到 1000 之间。']);
});

test('接线：检查器里有「编辑计划」，且写计划带 expectedVersion、改完提示重新确认', () => {
  const canvas = readSource('web/src/creative-lineage-canvas.jsx');
  assert.match(canvas, /plan-edit-model\.mjs/, '画布必须用这个模型');
  assert.match(canvas, /编辑计划/, '检查器里必须有「编辑计划」入口');
  assert.match(canvas, /rounds\/[^']*\/plan|rounds\/' \+[^\n]*'\/plan/, '必须调用写计划的端点');
  // 不带 version 的写入会覆盖别人的改动 —— 确认闸门就靠这个版本对得上。
  assert.match(canvas, /expectedVersion/, '写计划必须带 expectedVersion');
  // 方案 4.5：改完必须明确提示「计划已更新，请重新确认」，否则会有两种误会。
  assert.match(canvas, /重新确认/, '改完必须提示重新确认');
});
