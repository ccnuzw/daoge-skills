/**
 * 出图问法的形态（方案 4.1 · 施工单 Q2）。纯函数，可单测。
 *
 * 4.1 的判断：`purpose` **不是分类字段，是一组默认参数的入口**——
 * 要求用户「先认领一个套餐，再说需求」，顺序是反的。所以默认路径**不再出现**这道选择题；
 * 想自己定的人点**「改一下」**，展开的还是今天那套控件（红线 2.4：只加强不删）。
 *
 * 边界：**不动** `purpose` 字段、5 个枚举、那套默认参数、后端契约、表结构；
 * 这里只回答「默认显示什么、改一下展开什么」。
 */

/** 「改一下」展开的控件清单（与建立批次对话框一一对应；一个都不能少）。 */
export const ADVANCED_CONTROLS = Object.freeze([
  { id: 'purpose', label: '批次目的' },
  { id: 'parentRound', label: '父批次' },
  { id: 'count', label: '目标数量' },
  { id: 'aspectRatio', label: '画幅' },
  { id: 'variationAxes', label: '希望变化的维度' },
  { id: 'refinementGoals', label: '希望精修的目标' },
  { id: 'keepConstraints', label: '希望保持不变' },
  { id: 'editInstruction', label: '要修改什么' },
  { id: 'fillInstruction', label: '扩展或补充方向' }
]);

export function advancedControls() {
  return ADVANCED_CONTROLS.map((control) => ({ ...control }));
}

/**
 * 默认不显示「先选目的」的问卷；只有人自己点开「改一下」才显示。
 * @param {{ mode?: 'default'|'advanced' }} [input]
 */
export function questionnaireVisible(input = {}) {
  return input.mode === 'advanced';
}

/** 没选目的时的兜底：取最中性的「从零探索」，并明说这是系统推的、可改。 */
export const DEFAULT_PURPOSE = 'exploration';

export function defaultPurposeNote() {
  return '系统会按你的描述判断批次目的；想自己定，点「改一下」。';
}