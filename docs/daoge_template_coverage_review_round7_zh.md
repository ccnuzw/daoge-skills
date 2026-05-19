# DAOGE 模板覆盖盘点 Round 7

日期：2026-05-19

## 当前基线

- 主链模板：`22`
- catalog 入口：`113`
- 显式 `variants` 家族覆盖：`22 / 22`

## 本轮关注家族

### 已进入舒适覆盖区间

- `ab-ad-test`: `6`
- `campaign-poster`: `6`
- `detail-page-set`: `6`
- `social-grid`: `6`

这些家族已经不再属于“优先继续补”的对象。继续加量的边际收益开始下降，更适合封板或等待真实业务反馈后再决定是否新增正式变体。

### 仍值得优先继续扩的家族

- `visual-doc-slide`: `4`
- `image-edit`: `5`
- `oral-storyboard-board`: `5`

其中优先级最高的是 `visual-doc-slide`，原因：

1. 它仍然只有 `4` 个正式变体，明显低于当前核心商业家族的 `6` 变体区间。
2. 说明页 / 汇报页 / 结构页在真实业务里仍有很多稳定高频子类。
3. 它属于 `interface-and-information` 主线，继续扩不会和已经很厚的 `core-commercial` 家族重复。

## 对 `ab-ad-test` 的判断

经过第二轮正式变体扩展后，`ab-ad-test` 当前已覆盖：

- `single-variable`
- `benefit-stack`
- `audience-angle`
- `layout-test`
- `hook-contrast-test`
- `cta-emphasis-test`

结论：

- **短期封板**
- 下一次再扩，应基于真实投放试运行反馈，而不是继续凭空造 catalog 入口

## 下一步建议

下一批正式变体扩展优先建议：

1. `visual-doc-slide`

建议优先补的两条：

- `data-summary-slide`
- `before-after-explainer-slide`

原因：

- 一条偏“汇报摘要 / 数据总结”
- 一条偏“对照说明 / 改造前后”
- 与现有
  - `policy-style-slide`
  - `educational-diagram-slide`
  - `dense-explainer-slides`
  - `visual-report-page`
  边界清晰，不重复

## 结论

Round 7 之后，`ab-ad-test` 可以封板；下一条最值得继续扩的家族是 `visual-doc-slide`。

