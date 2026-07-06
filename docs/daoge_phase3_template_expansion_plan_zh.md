> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE Phase3 模板扩容计划

## 目标

回到 `interactive-image-batch` skill 本体，补齐当前相对 `gpt-image-2` 明显缺失的结构型模板大类，同时保持现有模板治理原则不被破坏：

- 不追求把对方所有 markdown 文件逐个照搬
- 不让主链模板数量无节制膨胀
- 继续坚持“结构差异建模板，行业差异做变体或示例”
- 同步兼顾 `host-native` 轻量路径和完整 DAOGE 工作流

## 当前缺口

对照 `gpt-image-2` 的 references 分类，`interactive-image-batch` 目前已经具备：

- `poster-and-campaigns`
- `portraits-and-characters`
- `product-visuals`
- `grids-and-collages`
- `editing-workflows`
- `cinematic-sequences`
- `social-campaigns`
- `performance-creatives`

当前仍然明显缺失的高价值结构型大类：

1. `ui-mockups`
2. `infographics`
3. `technical-diagrams`
4. `avatars-and-profile`
5. `slides-and-visual-docs`

其中前 3 类最适合优先进入主链模板，因为它们和现有模板相比，确实存在稳定的结构规则差异：

- `ui-mockups`
  - 不是海报，也不是电商图
  - 重点是界面层级、组件可读性、设备框架、屏幕密度和 overlay 结构
- `infographics`
  - 不是普通拼贴
  - 重点是信息层级、模块分组、图标/数据/流程块关系和排版安全区
- `technical-diagrams`
  - 不是信息图，也不是故事板
  - 重点是节点关系、箭头语义、层级抽象、图例与标签区的结构性约束

## 扩容策略

采用“**一个大类一个主链模板，多个小分类作为模板变体**”的方式扩容。

原因：

- 更符合 `template_authoring_zh.md` 中“先扩已有模板，扩不动再新建”的原则
- 保持注册表可维护
- 更容易在运行时注入统一的 `required_slot_fields`、`prompt_sections`、`variant_axes`
- 后续可以继续在每个主链模板下补派生文档或 example，而不是把主链模板炸成几十个

## 第一批落地范围

### 1. `ui-mockups`

新增主链模板：

- `ui-mockup-board`

第一批覆盖的小分类变体：

- `landing-page-case-study`
- `social-interface-mockup`
- `live-commerce-ui`
- `product-card-overlay`
- `short-video-cover-ui`
- `chat-interface-scene`

### 2. `infographics`

新增主链模板：

- `infographic-board`

第一批覆盖的小分类变体：

- `comparison-infographic`
- `step-by-step-infographic`
- `bento-grid-infographic`
- `kpi-dashboard-infographic`
- `legend-heavy-infographic`
- `hand-drawn-infographic`

### 3. `technical-diagrams`

新增主链模板：

- `technical-diagram`

第一批覆盖的小分类变体：

- `system-architecture`
- `flowchart-decision`
- `sequence-diagram`
- `network-topology`
- `er-diagram`
- `state-machine`
- `mind-map-tech`

## 第二批候选范围

第一批稳定后，再考虑：

1. `avatars-and-profile`
2. `slides-and-visual-docs`

这两类也重要，但当前优先级略低：

- `avatars-and-profile` 和现有 `portraits-and-characters` 存在边界重叠，需要先明确“头像资产模板”和“人物大片模板”的断层
- `slides-and-visual-docs` 可能和 `infographics`、`technical-diagrams` 存在交叉，需要先观察第一批模板的使用反馈

## 需要同步落地的文件层

第一批必须同步修改：

1. `references/template_registry_zh.json`
2. `references/templates/ui-mockups/ui-mockup-board.md`
3. `references/templates/infographics/infographic-board.md`
4. `references/templates/technical-diagrams/technical-diagram.md`
5. `scripts/detect_daoge_mode.js`
6. `references/dialogue_templates_zh.md`
7. 视情况补充 `tests/smoke.test.js`

## 轻量路径要求

本次扩容不只服务完整 DAOGE 运行链，也要兼容轻量路径。

因此新增模板必须满足：

- 在 `detect_daoge_mode.js` 中可被稳定命中
- 在新手菜单和任务解释里可被用户自然选中
- 在 `host-native` 轻量交接链中也能给出清晰的任务类型摘要

## 验证要求

本批次完成后，必须跑以下校验：

1. `node skills/interactive-image-batch/scripts/validate_template_registry.js`
2. `node skills/interactive-image-batch/scripts/render_template_registry_report.js`
3. `node --test skills/interactive-image-batch/tests/smoke.test.js`
4. `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`
5. 目录检查命令

## 完成标准

满足以下条件，第一批扩容才算完成：

1. 新增 3 个主链模板文档
2. 注册表主链校验全绿
3. 模板报告可正常渲染
4. `detect_daoge_mode.js` 能识别至少 3 类新增任务
5. 中文任务入口和任务类型说明已覆盖新增类目
6. smoke 回归全绿
