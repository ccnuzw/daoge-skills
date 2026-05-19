# DAOGE 模板覆盖度盘点 Round 12

日期：2026-05-19

## 盘点目的

在 `oral-storyboard-board` 第二轮正式变体扩展完成后，重新评估：

1. `oral-storyboard-board` 是否已经进入舒适覆盖区间
2. 当前是否还存在结构性缺口
3. 下一条最值得继续扩正式 `variants` 的家族是谁

## 当前基线

- 主链模板：22
- catalog 入口：132
- 显式 `variants` 覆盖：22 / 22
- 结构性缺口：0

结论：

- 当前体系仍然不存在“注册表声明了正式变体，但 catalog/example 没跟上”的结构性问题
- 当前阶段继续扩展时，优先级判断已经完全进入“业务价值排序”，不是“结构补缺”

## `oral-storyboard-board` 当前状态

当前正式变体：

- `horizontal-board`
- `host-led`
- `industry-led`
- `product-led`
- `educational-explainer`
- `expert-led`
- `testimonial-led`

判断：

- `variant_count = 7`
- `catalog_variant_count = 7`
- `missing = []`

结论：

- `oral-storyboard-board` 已进入舒适覆盖区间
- 这条家族现在可以短期封板

## 当前仍偏轻但已完整覆盖的家族

### 4 变体家族

- `asset-prop-sheet`
- `illustrated-scene-set`
- `type-layout-poster`

### 5 变体家族

- `ecommerce-clean`
- `image-edit`
- `portrait-kv`
- `studio-editorial`

说明：

- 上面这些家族都已经完成了显式 `variants` 的结构闭环
- 现在的问题不是“有没有覆盖”，而是“继续加一轮变体的业务收益是否值得”
- 4 变体家族虽然数量更轻，但未必比 `portrait-fashion` 或 `editing-ops` 更值得优先扩

## 下一条最值得继续扩的家族

### 第一优先级：`portrait-kv` / `studio-editorial`

原因：

1. 这两条同属 `portrait-fashion` 家族，当前都只有 5 个正式变体
2. 它们已经具备：
   - 正式 `variants`
   - example / catalog
   - onboarding 入口
   - 真实 `prepare` 验证
3. 当前商业静态视觉里，人物商业主视觉和棚拍编辑感仍然是很高频的真实需求
4. 继续扩展时适合成对规划，而不是单独零散补

建议优先考虑的方向：

- `portrait-kv`
  - 更强的情绪对照型 KV
  - 更强的产品联动型人物主视觉
- `studio-editorial`
  - 更强的极简高定棚拍
  - 更强的动态动作棚拍延展

### 第二优先级：`ecommerce-clean` / `image-edit`

原因：

- 当前也都是 5 变体
- 但这两条线更适合结合真实业务试运行来反推是否需要新增正式变体
- 继续凭空扩 catalog 的收益，不一定高于真实任务反馈

### 第三优先级：`asset-prop-sheet` / `illustrated-scene-set` / `type-layout-poster`

原因：

- 这三条确实只有 4 个正式变体
- 但它们的当前覆盖已经相对稳定
- 如果没有明确任务牵引，继续补的收益低于 `portrait-fashion`

## 当前建议短期封板的家族

- `lookbook`
- `oral-storyboard-board`
- `brand-packaging-board`
- `cinematic-storyboard`
- `visual-doc-slide`
- `ab-ad-test`
- `detail-page-set`
- `social-grid`

说明：

- 这些家族已经进入舒适覆盖区间
- 短期内不建议再无差别加量
- 更适合转向真实业务试运行或等待明确新任务驱动再扩

## 结论

Round 12 的核心结论有三条：

1. `oral-storyboard-board` 现在已经进入舒适覆盖区间，可短期封板
2. 当前显式 `variants` 体系仍保持 `22 / 22` 全覆盖，结构性缺口为 0
3. 下一条最值得继续扩正式 `variants` 的家族，不再是 `oral-storyboard-board`，而是 `portrait-kv / studio-editorial`

## 建议动作

下一步建议直接进入：

- `portrait-fashion` 下一轮正式变体扩展

建议优先从这两条同步补起：

1. `portrait-kv`
2. `studio-editorial`
