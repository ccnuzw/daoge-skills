const test = require('node:test');
const assert = require('node:assert/strict');

// 「素材用途」是上传、参考素材对话框、派生批次预设共用的判断，所以它从 main.jsx 里
// 搬进了纯模块 —— 这两个用例守的是搬完之后它还得是原来那个判断，而不是「文件还在」。
const MODEL = '../../web/src/reference-usage-model.mjs';

test('素材需求按有序规则判用途，先命中先赢', async () => {
  const { materialNeedUsagePreset } = await import(MODEL);
  assert.equal(materialNeedUsagePreset('需要一张遮罩图').usage, 'mask');
  assert.equal(materialNeedUsagePreset('品牌 Logo 规范').usage, 'brand');
  assert.equal(materialNeedUsagePreset('参考竞品画风').usage, 'style');
  assert.equal(materialNeedUsagePreset('平台渠道尺寸规格').usage, 'composition');
  assert.equal(materialNeedUsagePreset('整体色彩氛围').usage, 'color');
  assert.equal(materialNeedUsagePreset('不要这样的反例').usage, 'negative');
  assert.equal(materialNeedUsagePreset('产品主视觉').usage, 'subject');

  // 「主体遮罩」必须判成遮罩：遮罩规则排在主体前面。调顺序会改判一批需求。
  assert.equal(materialNeedUsagePreset('主体遮罩').usage, 'mask');
});

test('没有命中任何规则就回落到主体参考，并给出兜底提示', async () => {
  const { materialNeedUsagePreset } = await import(MODEL);
  const preset = materialNeedUsagePreset('随便传点什么');
  assert.equal(preset.usage, 'subject');
  assert.equal(preset.usageLabel, '主体参考');
  assert.match(preset.hint, /可导入图片或截图/);
});

test('空与非字符串的输入不会抛，一律回落到主体参考', async () => {
  const { materialNeedUsagePreset } = await import(MODEL);
  for (const input of ['', '   ', null, undefined, 0, {}]) {
    const preset = materialNeedUsagePreset(input);
    assert.equal(preset.usage, 'subject', String(input) + ' 应回落到主体参考');
    assert.equal(typeof preset.need, 'string', String(input) + ' 的需求名必须是字符串');
  }
  // 假值走 String(need || '') 变成空串；`{}` 是 truthy，会被 String() 原样转成
  // '[object Object]'。需求名实际只可能来自素材需求清单（都是字符串），这里只锁
  // 「不抛 + 回落」，不替它纠正类型。
  assert.equal(materialNeedUsagePreset(null).need, '');
  assert.equal(materialNeedUsagePreset('  遮罩  ').need, '遮罩', '需求名要去掉首尾空白');
});

test('导入 note 记下需求名与用途，调用方指定的用途优先', async () => {
  const { materialNeedReferenceNote } = await import(MODEL);
  assert.equal(materialNeedReferenceNote('品牌 Logo', undefined), '按素材需求导入：品牌 Logo · 品牌参考');
  assert.equal(materialNeedReferenceNote('品牌 Logo', 'style'), '按素材需求导入：品牌 Logo · 风格参考', '指定用途时以指定为准，需求名不丢');
});

test('每条规则的用途都必须是已注册的用途', async () => {
  // 写错 usage 不会报错，只会静默变成一个创作者看不懂的标签 —— 这条把它挡在提交前。
  const { MATERIAL_NEED_USAGE_RULES, REFERENCE_USAGE_LABELS } = await import(MODEL);
  const unknown = MATERIAL_NEED_USAGE_RULES.map((rule) => rule.usage).filter((usage) => !REFERENCE_USAGE_LABELS[usage]);
  assert.deepEqual(unknown, [], '规则里的 usage 必须在用途清单里注册过：' + unknown.join('、'));
});

test('用途清单自带人话标签，且没有重复 id', async () => {
  const { REFERENCE_USAGE_OPTIONS, REFERENCE_USAGE_LABELS } = await import(MODEL);
  assert.equal(Object.keys(REFERENCE_USAGE_LABELS).length, REFERENCE_USAGE_OPTIONS.length, '标签表由清单派生，重复 id 会让标签对不上');
  for (const option of REFERENCE_USAGE_OPTIONS) {
    assert.equal(REFERENCE_USAGE_LABELS[option.id], option.label, option.id + ' 的标签必须与清单一致');
    assert.match(option.description, /\S/, option.id + ' 缺面向创作者的人话说明');
  }
});
