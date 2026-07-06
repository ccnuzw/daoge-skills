# DAOGE v2 模板与 Prompt 质量审计

日期：2026-07-06

范围：`skills/interactive-image-batch` 的自然语言 brief 识别、默认 prompt 生成、工作台命名、尺寸语义和用户可见文本。

验证方式：仅运行 `prepare`，不调用真实 provider。验证产物放在仓库上级隔离目录：

```text
../daoge-goal7-template-prompt-validation/out/<case-id>
```

检查文件：

- `debug/task_spec.normalized.json`
- `debug/prompts.generated.json`
- `internal/run_plan.json`
- `internal/workspace_state.json`
- `workspace/index.html`
- `workspace/prepare.html`

## 初始问题

初始 20 条自然语言 brief 中，11 条回落到 `portrait`，包括社媒九宫格、技术流程图、信息图、地图路线、UI mockup、学术图、排版海报、图像局部修改、横图 banner、竖版短视频封面等。另有商品主图、campaign 海报因“瓶”等词被误归到包装类。

默认 prompt 主要问题：

- 所有任务都写入 `styling: refined wardrobe`，非人物任务泄漏人物造型语义。
- `variation_requirements` 被整组塞进每条 prompt，批量差异不成立。
- prompt 缺少稳定结构，主体、用途、场景、构图、风格、约束没有清楚分段。
- 尺寸只记录在 run plan，未影响构图文案。
- 默认标题过长但仍比 catalog 名称好；需保留用户 brief 并生成短标题。

## 修复后矩阵

| Case | Brief 类型 | 识别结果 | 尺寸 | 结果 | 等级 |
|---|---|---:|---:|---|---|
| product-hero | 产品主图 | `ecommerce` | 1024x1024 | prompt 含商品主体、平台安全区、方图构图 | P0 已解 |
| ecommerce-detail | 电商详情页 | `ecommerce` | 1024x1536 | prompt 含详情页层级和卖点材质 | P0 已解 |
| packaging-gift | 包装礼盒 | `packaging` | 1536x1024 | prompt 含外盒/内盒/套组和材质 | P0 已解 |
| brand-visual | 品牌视觉 | `packaging` | 1536x1024 | prompt 保留“不要人物”，无人物造型字段 | P0 已解 |
| campaign-poster | campaign 海报 | `campaign-poster` | 1024x1536 | prompt 含主视觉、标题区、CTA 区、竖版构图 | P0 已解 |
| social-grid | 社媒九宫格 | `social-grid` | 1024x1024 | prompt 含九宫格系统和内容差异 | P0 已解 |
| avatar-profile | 头像/profile | `avatar-profile-pack` | 1024x1024 | prompt 含圆形裁切和身份识别 | P0 已解 |
| portrait-studio | 人像棚拍 | `studio` | 1024x1536 | prompt 含棚拍光线、半身人像和官网用途 | P0 已解 |
| storyboard | 分镜 | `cinematic` | 1536x1024 | prompt 含镜头节奏和横版构图 | P0 已解 |
| oral-storyboard | 口播分镜 | `oralboard` | 1536x1024 | prompt 含主持人、演播厅、三段节奏 | P0 已解 |
| technical-flow | 技术流程图 | `technical-diagram` | 1536x1024 | prompt 含节点、箭头、层级和横图说明 | P0 已解 |
| infographic | 信息图 | `infographic-board` | 1024x1536 | prompt 含信息层级、阅读路径和竖图说明 | P0 已解 |
| map-route | 地图路线 | `map-route-board` | 1536x1024 | prompt 含地点、路线颜色、标注密度 | P0 已解 |
| ui-mockup | UI mockup | `ui-mockup-board` | 1024x1536 | prompt 含组件层级、设备画面和真实 UI 结构 | P0 已解 |
| academic-figure | 学术图 | `academic-figure-board` | 1536x1024 | prompt 含机制、阶段、科研图形摘要 | P0 已解 |
| type-poster | 字体排版海报 | `type-layout-poster` | 1024x1536 | prompt 含标题区、副标题区、排版节奏 | P0 已解 |
| image-edit-local | 图像局部修改 | `image-edit` | 1024x1024 | prompt 含保留主体、修改范围和光线一致性 | P0 已解 |
| style-transfer | 参考图风格迁移 | `image-edit` | 1024x1024 | prompt 含保留商品轮廓和构图 | P0 已解 |
| banner-horizontal | 横图 banner | `campaign-poster` | 1536x1024 | prompt 含左右分区和横图安全区 | P0 已解 |
| short-video-cover | 竖版短视频封面 | `campaign-poster` | 1024x1536 | prompt 含顶部标题安全区和竖版构图 | P0 已解 |

## 修复内容

- `inferTaskId` 改为加权关键词识别，并吸收 catalog 与 registry 触发词。
- `task_catalog_zh.json` 增补常见用户任务 id，保证 run plan 标题和摘要不再回落到错误大类。
- `prompt_builder` 改成任务画像驱动，默认 prompt 包含主体、用途、场景、视觉重点、光线、构图、风格、文字策略和约束。
- 非人物任务不再写 `wardrobe` 字段，默认 negative prompt 也不再出现手部、解剖等人物负面词。
- `variation_requirements` 按 prompt 分发，避免每条 prompt 都塞同一组差异要求。
- 尺寸和 brief 中的方图、横图、竖版、短视频、banner、海报语义会影响构图文案。
- prompt 标题从用户 brief 摘短句生成，避免用 catalog 默认名替代用户任务。

## 测试覆盖

- unit：中文 brief 识别矩阵。
- unit：非人物任务不泄漏 `wardrobe` / `portrait`。
- unit：variation requirement 按条分发。
- unit：尺寸比例影响构图文案。
- integration：20 条自然语言 brief 全量 prepare。
- artifacts：工作台页面和生成 prompt 用户文本不出现内部工程词。
- contracts：example catalog 不指向旧 workspace 入口，前 40 个 example 文件可抽取 `content_brief`。

## 剩余风险

- registry 仍保留作者侧字段，如 `required_slot_fields`、`template_doc`、`variants`。这些字段属于内部参考资料，不应直接展示给普通用户。
- example README 仍包含作者侧说明，后续可单独整理成“用户 quickstart”和“作者参考”两层。
