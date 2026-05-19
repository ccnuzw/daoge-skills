# DAOGE 模板展示贴脸化覆盖回看

日期：2026-05-18

## 目标

这份回看文档用于回答两个问题：

1. 当前哪些主链模板已经完成“展示贴脸化”
2. 哪些模板仍然沿用默认的 `场景 / 服装 / 构图` 展示语义

这里的“展示贴脸化”特指：

- `prompt_preview.md`
- `prompt_preview.html`
- `daoge_preflight_dashboard.md`
- `preflight_board.html`

这 4 个用户可见页面会根据模板家族切换摘要字段，而不是统一显示 `主场景 / 主服装 / 主构图`。

## 已覆盖模板

当前已在 [`template_display_profile.js`](../skills/interactive-image-batch/scripts/template_display_profile.js) 中显式覆盖的主链模板共 10 个：

1. `ui-mockup-board`
2. `infographic-board`
3. `technical-diagram`
4. `avatar-profile-pack`
5. `visual-doc-slide`
6. `academic-figure-board`
7. `brand-packaging-board`
8. `map-route-board`
9. `type-layout-poster`
10. `asset-prop-sheet`

这些模板当前都会在摘要层使用更贴合任务的字段，例如：

- 学术图：`主图类型 / 主比较模式 / 主版面结构`
- 技术图：`主图解类型 / 主表达目标 / 主结构布局`
- 信息图：`主信息层级 / 主信息目标 / 主版面结构`
- 地图：`主地图类型 / 主路线逻辑 / 主导览结构`
- 排版海报：`主标题角色 / 主语言模式 / 主版面结构`
- 品牌包装：`主包装形态 / 主品牌资产范围 / 主展示结构`
- 视觉文档页：`主页面角色 / 主版区结构 / 主版面节奏`
- UI：`主界面载体 / 主模块重点 / 主版面结构`
- 头像：`主资产用途 / 主裁切策略 / 主头像结构`
- 资产道具：`主资产角色 / 主表面风格 / 主展示结构`

## 未覆盖模板

当前仍然沿用默认展示语义的主链模板共 12 个：

1. `campaign-poster`
2. `studio-editorial`
3. `ecommerce-clean`
4. `lookbook`
5. `portrait-kv`
6. `image-edit`
7. `oral-storyboard-board`
8. `cinematic-storyboard`
9. `social-grid`
10. `ab-ad-test`
11. `detail-page-set`
12. `illustrated-scene-set`

## 这些未覆盖模板的判断

并不是所有未覆盖模板都应该继续做一轮“字段语义化”。

### 建议暂不优先继续做的

- `campaign-poster`
- `studio-editorial`
- `portrait-kv`
- `illustrated-scene-set`

原因：

- 这些模板本身就更接近“场景 / 服装 / 构图 / 风格”这套摄影或插画语义
- 默认摘要字段和任务语言并没有明显冲突
- 当前问题不是“词错了”，而更多是示例质量或风格表达是否足够强

### 建议下一批优先处理的

- `ecommerce-clean`
- `detail-page-set`
- `social-grid`
- `ab-ad-test`
- `image-edit`

原因：

- 这几类虽然能跑通，但任务目标本质上更偏“用途 / 页面角色 / 对比意图 / 编辑边界”
- 默认 `场景 / 服装 / 构图` 对真实用户理解帮助有限
- 它们属于“产品感还能明显提升”的类型

### 需要谨慎评估后再做的

- `lookbook`
- `oral-storyboard-board`
- `cinematic-storyboard`

原因：

- 它们不是不能语义化，而是如果硬切字段，很容易和当前已有 storyboard / slot / shot 语义打架
- 适合单独设计，不适合直接照搬当前这套三字段摘要策略

## 当前结论

当前展示贴脸化已经覆盖 10/22 个主链模板，占比约 45%。

但这 10 个已经覆盖了最容易出现“默认字段明显不贴脸”的高价值非人物模板家族，所以这轮工作的真实覆盖价值高于数字表面占比。

当前最合理的推进方式不是继续平均铺所有剩余模板，而是：

1. 先停下来做这一轮覆盖回看
2. 再挑 3 到 5 个“默认字段确实不贴脸”的模板做最后一批
3. 然后结束第二轮试运行修正主线，转入第三轮体验层优化

## 建议的下一批候选

如果继续做最后一批，建议优先顺序如下：

1. `detail-page-set`
2. `ecommerce-clean`
3. `ab-ad-test`
4. `social-grid`
5. `image-edit`

这 5 个做完之后，这条“展示贴脸化”主线基本就可以视为完成。
