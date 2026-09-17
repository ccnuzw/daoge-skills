// 「手工改计划」的表单逻辑（方案 4.5）。
//
// 底层机制早就是对的（核查过）：写计划未登记在鉴权表 → cookie 也能写；`confirmRoundPlan` 带 `expectedVersion`；
// 写计划时 `plan_version` 与 `version` **双递增** → **改后旧确认自动失效**；`round_plan_versions` 每改一次留快照。
// 缺的只是界面。这里放「界面要的那点逻辑」，所以能真跑单测。
//
// 一条重要克制：**只让人改「提示词」与「数量」两项**，其余字段（引用素材、遮罩、输出规格…）**原样保留**。
// 把整个计划做成 JSON 编辑框才是真的把人当工程师——那不是以人为本。

/** 与 SKILL.md 的并发/数量域保持一致（1..1000）。 */
export const PLAN_ITEM_COUNT_MAX = 1000;

/** 从已保存的计划里取出可编辑的两项。计划是只读来源，不改它。
 * @param {any} [plan] */
export function planEditForm(plan = {}) {
  const source = plan && typeof plan === 'object' ? plan : {};
  const count = Number(source.itemCount);
  return {
    prompt: typeof source.prompt === 'string' ? source.prompt : '',
    itemCount: Number.isInteger(count) && count > 0 ? count : 1
  };
}

/** 表单的问题（人话，直接给用户看）。空数组 = 可以保存。
 * @param {any} [form] */
export function planEditIssues(form = {}) {
  const issues = [];
  if (!String(form.prompt || '').trim()) issues.push('提示词不能空着。');
  const count = Number(form.itemCount);
  if (!Number.isInteger(count) || count < 1 || count > PLAN_ITEM_COUNT_MAX) {
    issues.push('数量要在 1 到 ' + PLAN_ITEM_COUNT_MAX + ' 之间。');
  }
  return issues;
}

/**
 * 把改动合并回计划：**只覆盖这两项，其余原样带回**。
 * 这一点很关键——写计划是整份替换，漏字段就等于把引用素材/遮罩/输出规格删了。
 * @param {any} [plan]
 * @param {any} [form]
 */
export function applyPlanEdit(plan = {}, form = {}) {
  const source = plan && typeof plan === 'object' ? plan : {};
  return { ...source, prompt: String(form.prompt || ''), itemCount: Number(form.itemCount) };
}
