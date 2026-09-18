/**
 * 「批次目的」枚举 → 人话 label 的**后端来源**。
 *
 * 前端有一份完全相同的映射（`web/src/purpose-labels.mjs`），因为两边跑在不同的
 * 模块系统里（TS/CJS 与 Vite/ESM），没法真的共用一个文件。项目对这类情形的做法是
 * 「两份 + 一条守卫把它们钉在一起」——守卫见 `tests/vnext/purpose-labels.test.js`
 *（与 `studio-schema-contract` 用 CHECK 对 TS 枚举是同一个套路）。
 *
 * 它存在的理由：搜索结果的 label 曾经直接拼英文枚举 `refinement`；协议字段可以继续
 * 留在库里，但**拼给用户看的时候必须翻译**（方案 7.9.1 / 7.9.3）。
 */

export const PURPOSE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  exploration: '探索新方向',
  refinement: '精修当前结果',
  variation: '生成更多变体',
  edit: '局部修改',
  fill: '补图 / 扩图'
});

/** 未知 / 空值返回空串——调用方据此不渲染，而不是把英文枚举漏到界面上。 */
export function purposeLabel(purpose: unknown): string {
  return PURPOSE_LABELS[String(purpose || '')] || '';
}
