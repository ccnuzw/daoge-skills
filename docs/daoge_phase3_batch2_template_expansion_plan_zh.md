# DAOGE Phase3 第二批模板扩容计划

## 目标

在第一批 `ui-mockups / infographics / technical-diagrams` 已经落稳的基础上，继续补齐 `gpt-image-2` 中剩余最有结构价值的两类：

1. `avatars-and-profile`
2. `slides-and-visual-docs`

本批次仍然遵循同一原则：

- 一个大类优先只进入一个主链模板
- 小分类优先做 `variants`
- 不和现有 `portrait-kv`、`infographic-board`、`technical-diagram` 产生主链重叠

## 边界判断

### avatars-and-profile

对照 `gpt-image-2`，这一类下面的典型子模板包括：

- `character-grid-portrait`
- `cultural-portrait-series`
- `sticker-set`
- `style-transfer-selfie`
- `themed-3d-icon`

这类任务和当前 `portraits-and-characters` 的差异在于：

- `portrait-kv` / `studio-editorial` 偏品牌肖像、棚拍大片、人物主视觉
- `avatars-and-profile` 更偏头像资产、身份图、角色贴纸、系列化 profile 资产
- 核心不是“海报感”或“品牌主视觉”，而是“身份一致性 + 头像裁切 + 小尺寸可读性 + 套系化”

因此第二批应新增独立主链模板，而不是继续塞进 `portrait-kv`。

建议主链模板名：

- `avatar-profile-pack`

第一批变体覆盖：

- `character-grid-portrait`
- `cultural-portrait-series`
- `sticker-set`
- `style-transfer-selfie`
- `themed-3d-icon`

### slides-and-visual-docs

对照 `gpt-image-2`，这一类下面的典型子模板包括：

- `dense-explainer-slides`
- `educational-diagram-slide`
- `policy-style-slide`
- `visual-report-page`

这类任务和当前 `infographic-board`、`technical-diagram` 的差异在于：

- `infographic-board` 偏单页信息结构、数据卡片、阅读路径
- `technical-diagram` 偏节点关系、流程语义、工程结构
- `slides-and-visual-docs` 偏“幻灯页 / 汇报页 / 报告页”的页面级编排
- 核心不是单一图解，而是“标题区 + 正文区 + 侧注区 + 图像区 + 汇报版心”的页面结构

因此也应新增独立主链模板。

建议主链模板名：

- `visual-doc-slide`

第一批变体覆盖：

- `dense-explainer-slides`
- `educational-diagram-slide`
- `policy-style-slide`
- `visual-report-page`

## 需要同步修改的文件层

本批次至少会改这些文件：

1. `references/template_registry_zh.json`
2. `references/templates/avatars-and-profile/avatar-profile-pack.md`
3. `references/templates/slides-and-visual-docs/visual-doc-slide.md`
4. `scripts/detect_daoge_mode.js`
5. `references/dialogue_templates_zh.md`
6. `tests/smoke.test.js`

## 检测层约束

新增两个主链模板时，检测优先级需要特别注意：

- `avatar-profile-pack` 必须优先避开 `portrait-kv`
- `visual-doc-slide` 必须优先避开 `infographic-board` 与 `technical-diagram`

也就是说：

- “头像 / profile / sticker / 自拍风格迁移 / 角色系列”应优先走 `avatars-and-profile`
- “slide / 幻灯页 / visual report / explainer page / 汇报页”应优先走 `slides-and-visual-docs`
- 只有当需求明显偏单张信息图或纯技术图时，才回落到现有模板

## 验证要求

完成后必须跑：

1. `node skills/interactive-image-batch/scripts/validate_template_registry.js`
2. `node skills/interactive-image-batch/scripts/render_template_registry_report.js --report-file skills/interactive-image-batch/references/template_registry_validation_report.json`
3. `node --test skills/interactive-image-batch/tests/smoke.test.js`
4. `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`
5. 目录检查命令

## 完成标准

满足以下条件，本批次才算完成：

1. 新增 2 个主链模板文档
2. 注册表模板总数增长且主链校验全绿
3. `detect_daoge_mode.js` 能正确识别 avatar/profile 与 slide/doc 两类
4. 中文任务入口已出现新增任务类型说明
5. smoke 全绿
