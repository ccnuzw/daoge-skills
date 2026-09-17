/**
 * 「素材用途」这一个概念的单一来源。
 *
 * 用途不是上传时才有的概念：参考素材对话框、派生批次的预设、导入引导清单都要问
 * 「这张图是拿来干什么的」。过去这组常量和规则散在 main.jsx 里，任何想复用它的模块
 * 都只能反向 import main.jsx —— 于是它们谁也搬不动。这里把它们收成一个纯模块：
 * 没有 React、没有 JSX、没有 DOM，可以被任何一侧引用，也可以被单测直接跑。
 */

/**
 * 创作者能选的用途。顺序即 UI 里的展示顺序。
 * @type {Array<{ id: string, label: string, description: string }>}
 */
export const REFERENCE_USAGE_OPTIONS = [
  { id: 'subject', label: '主体参考', description: '尽量保持主体身份、轮廓或核心特征。' },
  { id: 'style', label: '风格参考', description: '提取画风、质感和色调，不复制具体内容。' },
  { id: 'composition', label: '构图参考', description: '参考画面布局、视角和主体位置。' },
  { id: 'color', label: '色彩参考', description: '参考配色、明暗关系和整体氛围。' },
  { id: 'brand', label: '品牌参考', description: '参考 Logo、产品、品牌色或固定视觉规范。' },
  { id: 'mask', label: '遮罩图', description: '用于局部编辑范围；生成前仍会按生成服务的能力校验。' },
  { id: 'negative', label: '反例 / 不要这样', description: '说明不希望出现的方向，由 Agent 在计划中转成约束。' }
];

/** 用途 id → 人话标签。 */
export const REFERENCE_USAGE_LABELS = Object.fromEntries(REFERENCE_USAGE_OPTIONS.map((option) => [option.id, option.label]));

/** 没有命中任何规则时的兜底说明。 */
const DEFAULT_MATERIAL_NEED_HINT = '可导入图片或截图；如果只是文字信息，请在创作意图或备注里说明。';

/**
 * 从「素材需求」的人话描述猜用途。
 *
 * **规则是有序的，先命中先赢** —— 「主体遮罩」要判成遮罩而不是主体，靠的就是
 * 遮罩规则排在前面。调整顺序等于改判一批需求，动之前先看
 * `tests/vnext/reference-usage-model.test.js` 里锁死的几条。
 *
 * @type {Array<{ pattern: RegExp, usage: string, hint: string }>}
 */
export const MATERIAL_NEED_USAGE_RULES = [
  { pattern: /遮罩|蒙版|修改区域|重绘区域/, usage: 'mask', hint: '适合导入黑白或透明遮罩；生成前仍会按生成服务的能力核算一遍。' },
  { pattern: /Logo|品牌|规范|色板|品牌包/i, usage: 'brand', hint: '适合导入 Logo、品牌色、品牌规范截图或固定视觉规范。' },
  { pattern: /风格|竞品|历史视觉|系列参考|参考封面|画法|质感/, usage: 'style', hint: '适合导入风格样张；Agent 只提取画风、质感和语气。' },
  { pattern: /构图|版式|安全区|尺寸|规格|平台|渠道|场景关键词/, usage: 'composition', hint: '适合导入版式、安全区、平台规格或构图参考截图。' },
  { pattern: /色彩|配色|光线|光影|氛围/, usage: 'color', hint: '适合导入色彩、明暗关系或氛围参考。' },
  { pattern: /反例|不要|禁改|禁忌|不允许|限制|不可改变|保持|一致性/, usage: 'negative', hint: '适合导入不希望延续的方向；文字约束请同时写进创作意图。' },
  { pattern: /主体|产品|商品|角色|人物|原图|已选|已确认|待发布|主视觉|封面|输入素材/, usage: 'subject', hint: '适合导入主体、产品、角色或已选结果，用于保持身份和轮廓。' }
];

/**
 * 一条素材需求 → 导入时该用的预设（用途、标签、给创作者的提示）。
 *
 * @param {unknown} need 素材需求的人话描述
 * @returns {{ need: string, usage: string, usageLabel: string, hint: string }}
 */
export function materialNeedUsagePreset(need) {
  const label = String(need || '').trim();
  const matched = MATERIAL_NEED_USAGE_RULES.find((rule) => rule.pattern.test(label));
  const usage = matched?.usage || 'subject';
  return { need: label, usage, usageLabel: REFERENCE_USAGE_LABELS[usage] || usage, hint: matched?.hint || DEFAULT_MATERIAL_NEED_HINT };
}

/**
 * 记进参考素材时写的那句 note。
 * @param {unknown} need 素材需求描述
 * @param {string} [usage] 调用方指定的用途；不传就用规则猜出来的
 * @returns {string}
 */
export function materialNeedReferenceNote(need, usage) {
  const preset = materialNeedUsagePreset(need);
  return '按素材需求导入：' + preset.need + ' · ' + (REFERENCE_USAGE_LABELS[usage || preset.usage] || usage || preset.usage);
}
