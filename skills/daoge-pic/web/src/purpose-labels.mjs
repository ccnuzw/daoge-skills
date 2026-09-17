// 「批次目的」枚举 → 人话 label 的**唯一来源**。
//
// 为什么要单独一个模块：这份映射此前只存在于 main.jsx 的 ROUND_PURPOSE_OPTIONS 里，
// 于是同一个枚举在两处两种待遇 —— 选片路径说「精修当前结果」，搜索结果却直接渲染英文枚举 `refinement`。
// 两个消费方都从这里取，新增枚举时只改这一处。
// （守卫：tests/vnext/purpose-labels.test.js）

export const PURPOSE_LABELS = Object.freeze({
  exploration: '探索新方向',
  refinement: '精修当前结果',
  variation: '生成更多变体',
  edit: '局部修改',
  fill: '补图 / 扩图'
});

/** 未知 / 空值返回空串——调用方据此不渲染，而不是把英文枚举漏到界面上。 */
export function purposeLabel(purpose) {
  return PURPOSE_LABELS[purpose] || '';
}
