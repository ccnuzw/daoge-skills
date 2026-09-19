/**
 * 计划「理解说明」的展示（方案 9.8 · 施工单 C1）。纯函数，可单测。
 *
 * 契约里新增的 `understanding` 是**结论性说明**（3–5 句），不是推理链。
 * 检查器把它摆在计划旁边，人在按确认之前多一分判断依据：**它为什么这么理解**。
 *
 * 两条纪律：
 *   - 没有说明就**返回空串**（不硬凑一句话，也不编）；
 *   - 只做「显示」，不改计划、不参与预检（它本来就不是执行参数）。
 */
export function understandingNote(plan) {
  const text = typeof plan?.understanding === 'string' ? plan.understanding.trim() : '';
  return text ? '理解为：' + text.replace(/^理解为：?/, '') : '';
}