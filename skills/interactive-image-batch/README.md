# DAOGE Interactive Image Batch

## 先看这里

如果你是第一次使用这套 skill，先不要直接读完整 README。

先读：

- [START_HERE_中文.md](./START_HERE_中文.md)
- `references/examples/examples_catalog.html`
- [references/template_map_zh.md](./references/template_map_zh.md)

这份文档只讲：

- 普通用户从哪里开始
- 这条工作台主链长什么样
- 进阶能力放在哪里

## 终版工作台入口

当前 DAOGE 已收口为 **单一主链工作台**。普通用户默认只需要沿这条链路走：

1. `references/examples/examples_catalog.html`
2. `task_center.html`
3. `workspace/workspace_home.html`
4. `workspace/prepare_workspace.html`
5. `workspace/result_workspace.html`
6. `workspace/exception_workspace.html`
7. `workspace/run_record.html`

`review_board.html`、`rerun_board.html`、`run_overview.html`、`completion_board.html`、`prompt_preview.html`、`preflight_board.html`、`assets_board.html` 只在 `prepare-details` / `result-details` / `all` 这类深看模式里生成或强调。

新 DAOGE 的入口只围绕 workspace-first 主链组织产物。退役入口不再是产品页面；默认、`prepare-details`、`result-details`、`all` 都不会重新生成退役入口，目录里如有同名残留会在运行时清理。

如果你只是想快速上手，优先走这条路径：

```bash
node scripts/run_example_catalog_prepare.js --starter true
```

这条命令默认只列最常用的 6 个中文起步入口：

- `portrait`
- `studio`
- `ecommerce`
- `packaging`
- `cinematic`
- `oralboard`

如果你已经知道任务类型，也建议第一次先只记这 6 个中文起步入口：

```bash
node scripts/run_example_catalog_prepare.js --intent portrait
node scripts/run_example_catalog_prepare.js --intent studio
node scripts/run_example_catalog_prepare.js --intent ecommerce
node scripts/run_example_catalog_prepare.js --intent packaging
node scripts/run_example_catalog_prepare.js --intent cinematic
node scripts/run_example_catalog_prepare.js --intent oralboard
```

`interactive-image-batch` 是一套面向 DAOGE / 刀哥工作流的批量生图能力。

普通用户第一轮不需要理解 template、variant、manifest、slot、runtime 这些维护层概念。先按中文任务类型起步，再跟着工作台首页、准备工作台、结果工作台、异常工作台走即可。下面的能力说明主要给进阶使用者和维护者做全貌参考。

它不是一个“只会读提示词文件然后盲跑接口”的简易脚本，而是一套完整的批量生图工作流：

- 对话式参数收集
- 任务说明规范化
- 提示词分发策略
- 成批提示词生成
- 批次执行与失败续跑
- 预检、预览、看板、结果汇总
- 文生图 / 图生图 / 分镜板 / 局部重绘 的统一编排

这个项目的核心目标不是追求“所有模式统一到一个最新 API”，而是：

**优先成功率，保留现代路径，并且内置 fallback。**

---

## 适合什么场景

这套能力适合下面几类任务：

- 批量文生图
- 带参考图的图生图
- 带 mask 的局部重绘
- 分镜板 / 口播分镜 / 故事板生成
- 从 Markdown 提示词库批量生成提示词
- 多任务类型、多风格、多批次的可控出图

尤其适合：

- 已经有一套 `.env` 和 provider，需要稳定落地
- 需要在不同 provider 能力之间自动选择更稳的执行路径
- 不希望一次失败就整批废掉
- 需要把准备、执行、复跑、选图做成可追踪流程

---

## 核心能力

### 1. 结构化准备阶段

不是直接对用户输入做一次性提示词拼接，而是拆成多个中间产物：

- `task_spec.json`
- `prompt_strategy.json`
- `prompt_slots.json`
- `prompt_draft_bundle.json`
- `prompts.generated.json`

这让工作流更容易检查、复跑、调整和审计。

### 2. 面向分镜板与参考图的扩展

支持：

- `reference_images`
- `mask_image`
- `reference_bindings.json`
- 分镜格 / 素材位绑定
- continuity / camera move / shot id 等结构字段

适合做：

- 口播分镜板
- 连续角色分镜
- 局部修改某一格
- 保留同一人物设定的多图任务

### 3. 失败续跑与结果归档

运行结束后会生成一整套可追踪产物，例如：

- `manifest.json`
- `job_state.json`
- `checkpoint.json`
- `stage_plan.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `rerun_candidates.json`
- `workspace/workspace_home.html`
- `workspace/result_workspace.html`
- `workspace/exception_workspace.html`
- `workspace/run_record.html`
- `review_board.html`（仅结果深看模式）
- `operations_report.md`（仅诊断归档）

这意味着：

- 跑挂了可以只补失败项
- 中断后可以跳过已完成项
- 批量任务可以分阶段推进
- 后续选图和复跑都有依据
- 还可以直接打开 HTML 审阅看板做“保留 / 复核 / 重跑”决策
- HTML 审阅看板会给出基础风险标签和启发式审阅分，方便先做一轮半自动筛选

现在的推荐浏览方式已经升级成 **工作台主链优先**：

- `task_center.html`
- `workspace/workspace_home.html`
- `workspace/prepare_workspace.html`
- `workspace/result_workspace.html`
- `workspace/exception_workspace.html`
- `workspace/run_record.html`

高级页只在深看模式里出现：

- 准备深看：`prompt_preview.html`、`preflight_board.html`、`assets_board.html`
- 结果深看：`review_board.html`、`run_overview.html`、`completion_board.html`、`rerun_board.html`
- 条件深看：`storyboard_board.html`

退役入口文件会由运行时清理；普通用户不需要打开或寻找它们。

Markdown 产物现在更适合作为：

- 归档副本
- 调试参考
- 补充说明

而不是主用户入口。

### 4. 可复用模板模式

注意：

这一节更偏“能力总览”，不是第一次使用时的推荐入口。

如果你的目标是“先跑起来”，请优先回到：

- [START_HERE_中文.md](./START_HERE_中文.md)
- `references/examples/README.md`

除了通用工作流，这个 skill 也支持模板化复用。

当前已经内置并适合长期复用的方向包括：

- `core-commercial`
  - `campaign-poster`
  - `studio-editorial`
  - `portrait-kv`
- `ecommerce-clean`
- `ecommerce-clean-soft-scene-commerce`
- `ecommerce-clean-material-focus-commerce`
- `ecommerce-clean-flatlay-commerce`
- `ecommerce-clean-platform-safe-packshot`
- `detail-page-set`
  - `social-grid`
  - `ab-ad-test`
  - `lookbook`
  - `brand-packaging-board`
  - `type-layout-poster`
- `narrative-and-board`
  - `cinematic-storyboard`
  - `oral-storyboard-board`
  - `illustrated-scene-set`
- `interface-and-information`
  - `ui-mockup-board`
  - `infographic-board`
  - `technical-diagram`
  - `visual-doc-slide`
  - `academic-figure-board`
  - `map-route-board`
- `identity-and-assets`
  - `avatar-profile-pack`
  - `image-edit`
  - `asset-prop-sheet`

其中 `oral-storyboard-board` 适合：

- 跨领域口播分镜板
- 导演式横版整板分镜
- 虚拟主理人 / 主持人口播提案板
- 左信息区 + 右侧分镜网格 + 底部KV 的整板任务

对应示例包见：

- `references/examples/finance-storyboard/`
- `references/examples/ui-mockups/ui_mockup_board.example.json`
- `references/examples/infographics/infographic_board.example.json`
- `references/examples/technical-diagrams/technical_diagram.example.json`
- `references/examples/avatars-and-profile/avatar_profile_pack.example.json`
- `references/examples/slides-and-visual-docs/visual_doc_slide.example.json`
- `references/examples/academic-figures/academic_figure_board.example.json`
- `references/examples/branding-and-packaging/brand_packaging_board.example.json`
- `references/examples/scenes-and-illustrations/illustrated_scene_set.example.json`
- `references/examples/maps/map_route_board.example.json`
- `references/examples/typography-and-text-layout/type_layout_poster.example.json`
- `references/examples/assets-and-props/asset_prop_sheet.example.json`
- `references/examples/README.md`

如果你想把 example 直接变成最小可执行输入，可以运行：

```bash
node scripts/build_example_quickstart.js \
  --example-file references/examples/ui-mockups/ui_mockup_board.example.json \
  --output-dir /tmp/daoge-example-quickstart
```

如果你想直接从 example 跑到预检面板，可以运行：

```bash
node scripts/run_example_quickstart_prepare.js \
  --example-file references/examples/ui-mockups/ui_mockup_board.example.json \
  --output-dir /tmp/daoge-example-prepare
```

如果你想先看可运行 example 列表，再一键进预检，可以运行：

```bash
node scripts/run_example_catalog_prepare.js --list true
node scripts/run_example_catalog_prepare.js --starter true
node scripts/run_example_catalog_prepare.js --intent ui
node scripts/run_example_catalog_prepare.js \
  --example-id ui-mockup-board \
  --output-dir /tmp/daoge-example-catalog-demo
```

如果你想直接体验 UI mockup 的高频子类，也可以运行：

```bash
node scripts/run_example_catalog_prepare.js \
  --example-id ui-mockup-board-chat-interface-scene \
  --output-dir /tmp/daoge-ui-chat-scene-demo
```

你也可以直接体验剩余两个 UI 高频尾项：

```bash
node scripts/run_example_catalog_prepare.js \
  --example-id ui-mockup-board-short-video-cover-ui \
  --output-dir /tmp/daoge-ui-short-video-demo
```

如果你想先看一个可点击的 catalog 首页，可以运行：

```bash
node scripts/render_example_catalog_board.js
```

当前 example catalog 已覆盖：

- `ui-mockup-board`
- `ui-mockup-board-social-interface-mockup`
- `ui-mockup-board-live-commerce-ui`
- `ui-mockup-board-chat-interface-scene`
- `ui-mockup-board-product-card-overlay`
- `ui-mockup-board-short-video-cover-ui`
- `infographic-board`
- `technical-diagram`
- `academic-figure-board`
- `brand-packaging-board`
- `illustrated-scene-set`
- `map-route-board`
- `type-layout-poster`
- `asset-prop-sheet`
- `avatar-profile-pack`
- `visual-doc-slide`
- `visual-doc-slide-data-summary-slide`
- `visual-doc-slide-before-after-explainer-slide`
- `ecommerce-clean`
- `detail-page-set`
- `social-grid`
- `ab-ad-test`
- `image-edit`
- `image-edit-localized-fix`
- `image-edit-style-alignment-edit`
- `image-edit-material-replacement-edit`
- `image-edit-lighting-consistency-fix`
- `campaign-poster`
- `lookbook`
- `portrait-kv`
- `studio-editorial`
- `cinematic-storyboard`
- `oral-storyboard-board`
- `finance-oral-storyboard-board`
- `oral-storyboard-board-host-led`
- `oral-storyboard-board-product-led`
- `oral-storyboard-board-educational-explainer`

第一批变体级 example 入口已补入 catalog：

- `academic-figure-board-mechanism-diagram`
- `brand-packaging-board-cosmetic-packaging`
- `illustrated-scene-set-picture-book-scene`
- `map-route-board-store-distribution-map`
- `type-layout-poster-title-safe-poster`
- `type-layout-poster-editorial-phrase-block`
- `type-layout-poster-image-type-balance-poster`
- `asset-prop-sheet-game-screenshot-mockup`
- `asset-prop-sheet-prop-lineup-board`
- `asset-prop-sheet-collectible-item-sheet`

第二批变体级 example 入口新增：

- `academic-figure-board-multi-condition-comparison`
- `brand-packaging-board-beverage-label-design`
- `map-route-board-illustrated-city-map`
- `illustrated-scene-set-concept-scene`
- `illustrated-scene-set-minimalist-mood-scene`
- `cinematic-storyboard-micro-film`
- `cinematic-storyboard-vertical-short`
- `cinematic-storyboard-mood-sequence`
- `cinematic-storyboard-demo-explainer-sequence`
- `cinematic-storyboard-product-reveal-sequence`
- `infographic-board-step-by-step-infographic`
- `technical-diagram-sequence-diagram`
- `brand-packaging-board-mascot-brand-kit`
- `avatar-profile-pack-style-transfer-selfie`

第三批静态视觉子类入口新增：

- `infographic-board-legend-heavy-infographic`
- `technical-diagram-network-topology`
- `brand-packaging-board-character-merch-board`
- `avatar-profile-pack-themed-3d-icon`

第二十五批 Brand Packaging 第二波入口新增：

- `brand-packaging-board-gift-box-campaign-packaging`
- `brand-packaging-board-seasonal-limited-packaging`

第四批说明型 / 电商型 / 投放型入口新增：

- `visual-doc-slide-policy-style-slide`
- `detail-page-set-fit-and-material`
- `social-grid-brand-feed-system`
- `ab-ad-test-benefit-stack`

第五批说明页 / 详情页 / 社媒 / 海报入口新增：

- `visual-doc-slide-educational-diagram-slide`
- `detail-page-set-lifestyle-proof`
- `social-grid-ugc-polished`
- `campaign-poster-product-hero`

第六批高密度解释 / 主图细节 / 上新九宫格 / 人物海报入口新增：

- `visual-doc-slide-dense-explainer-slides`
- `detail-page-set-hero-plus-details`
- `social-grid-nine-grid-launch`
- `campaign-poster-people-hero`

第二十四批 Visual Doc Slide 第二波入口新增：

- `visual-doc-slide-data-summary-slide`
- `visual-doc-slide-before-after-explainer-slide`

第二十一批 Detail Page 第二波入口新增：

- `detail-page-set-comparison-proof-detail`
- `detail-page-set-feature-stack-page`

第二十二批 Social Grid 第二波入口新增：

- `social-grid-countdown-campaign-grid`
- `social-grid-benefit-carousel-grid`

第七批技术图 / 信息图说明型入口新增：

- `technical-diagram-flowchart-decision`
- `technical-diagram-state-machine`
- `infographic-board-comparison-infographic`
- `infographic-board-bento-grid-infographic`

第八批技术图 / 信息图尾项入口新增：

- `technical-diagram-er-diagram`
- `technical-diagram-mind-map-tech`
- `infographic-board-hand-drawn-infographic`

第九批 UI mockup 高频变体入口新增：

- `ui-mockup-board-social-interface-mockup`
- `ui-mockup-board-live-commerce-ui`
- `ui-mockup-board-chat-interface-scene`

第十批 UI mockup 尾项入口新增：

- `ui-mockup-board-product-card-overlay`
- `ui-mockup-board-short-video-cover-ui`

第十一批投放测试 / Campaign 延展入口新增：

- `ab-ad-test-audience-angle`
- `ab-ad-test-layout-test`
- `campaign-poster-campaign-extension`

第二十三批 A/B Ad Test 第二波入口新增：

- `ab-ad-test-hook-contrast-test`
- `ab-ad-test-cta-emphasis-test`

第二十批 Campaign Poster 第二波入口新增：

- `campaign-poster-headline-safe-kv`
- `campaign-poster-people-product-dual-hero`

第十二批头像资产补齐入口新增：

- `avatar-profile-pack-character-grid-portrait`
- `avatar-profile-pack-cultural-portrait-series`

第十三批学术图补齐入口新增：

- `academic-figure-board-method-pipeline-overview`
- `academic-figure-board-research-overview-poster`

第十四批地图路线补齐入口新增：

- `map-route-board-itinerary-day-trip-map`
- `map-route-board-food-map`

第十五批叙事与插画尾项补齐入口新增：

- `cinematic-storyboard-mood-sequence`
- `illustrated-scene-set-minimalist-mood-scene`

同时修正：

- `oral-storyboard-board` 基准入口的 `template_variant` 已统一为 `horizontal-board`

第十六批肖像与棚拍家族化入口新增：

- `portrait-kv-editorial-closeup`
- `portrait-kv-soft-character-focus`
- `studio-editorial-high-contrast-studio`
- `studio-editorial-soft-beauty-studio`

第十八批肖像与棚拍第二波入口新增：

- `portrait-kv-dramatic-gaze-kv`
- `portrait-kv-beauty-crop-kv`
- `studio-editorial-mono-backdrop-editorial`
- `studio-editorial-motion-pose-studio`

第二十一批肖像与棚拍第三波入口新增：

- `portrait-kv-emotion-contrast-kv`
- `portrait-kv-product-linked-portrait-kv`
- `studio-editorial-couture-minimal-studio`
- `studio-editorial-gesture-sequence-studio`

第十七批 Lookbook 家族化入口新增：

- `lookbook-chapter-lookbook`
- `lookbook-cover-and-range`

第十九批 Lookbook 第二波入口新增：

- `lookbook-chapter-scene-progressive`
- `lookbook-multi-outfit-commercial`

如果你是第一次上手，不建议直接从全部 20+ 入口里盲选。当前推荐起步入口是：

- `ui-mockup-board`
- `academic-figure-board`
- `brand-packaging-board`
- `brand-packaging-board-gift-box-campaign-packaging`
- `brand-packaging-board-seasonal-limited-packaging`
- `map-route-board`
- `type-layout-poster`
- `ecommerce-clean`
- `detail-page-set`
- `social-grid`
- `ab-ad-test`
- `ab-ad-test-hook-contrast-test`
- `ab-ad-test-cta-emphasis-test`
- `campaign-poster`
- `campaign-poster-headline-safe-kv`
- `lookbook`
- `lookbook-chapter-lookbook`
- `lookbook-cover-and-range`
- `lookbook-chapter-scene-progressive`
- `lookbook-multi-outfit-commercial`
- `lookbook-editorial-pairing-lookbook`
- `lookbook-detail-mix`
- `detail-page-set-comparison-proof-detail`
- `detail-page-set-feature-stack-page`
- `social-grid-countdown-campaign-grid`
- `social-grid-benefit-carousel-grid`
- `portrait-kv`
- `studio-editorial`
- `portrait-kv-editorial-closeup`
- `portrait-kv-soft-character-focus`
- `portrait-kv-dramatic-gaze-kv`
- `portrait-kv-beauty-crop-kv`
- `portrait-kv-emotion-contrast-kv`
- `portrait-kv-product-linked-portrait-kv`
- `portrait-kv-headline-safe-portrait-kv`
- `portrait-kv-profile-silhouette-kv`
- `studio-editorial-high-contrast-studio`
- `studio-editorial-soft-beauty-studio`
- `studio-editorial-mono-backdrop-editorial`
- `studio-editorial-motion-pose-studio`
- `studio-editorial-couture-minimal-studio`
- `studio-editorial-gesture-sequence-studio`
- `studio-editorial-sharp-tailoring-studio`
- `studio-editorial-beauty-detail-studio`
- `cinematic-storyboard`
- `oral-storyboard-board`
- `finance-oral-storyboard-board`
- `oral-storyboard-board-host-led`
- `oral-storyboard-board-product-led`
- `oral-storyboard-board-educational-explainer`

如果你更习惯按任务意图找入口，可以直接使用：

- `--intent ui`
- `--intent academic`
- `--intent packaging`
- `--intent map`
- `--intent typography`
- `--intent ecommerce`
- `--intent detail`
- `--intent social`
- `--intent abtest`
- `--intent poster`
- `--intent lookbook`
- `--intent portrait`
- `--intent studio`
- `--intent cinematic`
- `--intent oralboard`
- `--intent financeboard`
- `--intent hostboard`
- `--intent productboard`
- `--intent eduboard`
- `--intent expertboard`
- `--intent testimonialboard`

---

## 工作流概览

标准流程如下：

1. 读取用户需求或提示词库
2. 生成 `task_spec.json`
3. 验证并标准化 task spec
4. 生成 `prompt_strategy.json`
5. 生成 `prompt_slots.json`
6. 生成 `prompt_draft_bundle.json`
7. 生成最终 `prompts.generated.json`
8. 执行预检与预览
9. 分批执行 `run_batch.js`
10. 输出结果面板与复跑产物

如果是分镜板模式，还会附加：

- `content_manifest.json`
- `layout_manifest.json`
- `reference_bindings.json`
- `render_config.json`

---

## 运行模式

这个 skill 现在建议先判断运行模式，再决定走完整 runner 还是轻量路径。

推荐探测命令：

```bash
cd skills/interactive-image-batch
node scripts/detect_runtime_mode.js
```

当前建议模式：

- `local-batch-runner`
  - 有本地 `.env` 和有效凭证
  - 走完整 `prepare -> execute -> review -> rerun` 主线
- `host-native-image-tool`
  - 宿主自带图像工具
  - 保留 DAOGE 的 intake / template / prompt 规划
  - 不强制进入本地 execute
  - 推荐额外交付 `host_native_prompt_pack.json` 和可读摘要
- `prompt-advisor`
  - 只有 prompt 规划，不执行出图
- `local-runner-missing-credentials`
  - 本地 runner 存在，但缺少必要凭证
  - 此时应补凭证，或者降级到 host-native / advisor

### 为什么要加这一层

因为当前 skill 的强项是完整运行时，但并不是所有环境都适合走完整 runner。

第二阶段的目标不是削弱 DAOGE，而是让它在两类场景里都更合理：

- 有本地执行能力时：走强工作流
- 宿主已经能出图时：走轻量 host-native 路径

---

## 路由策略

这个项目当前采用的是“成功率优先”的路由策略。

### `prompt-only`

- 默认：`POST /v1/images/generations`
- 可选现代路径：`POST /v1/responses` + `image_generation`
- 如果显式开启 `--generate-path /v1/responses`
  - 先走 `Responses API`
  - 失败自动 fallback 到 `Images API`

### `reference-assisted`

适用于：

- 有 `reference_images`
- 没有 `mask_image`

路由策略：

- 默认：`POST /v1/images/edits`
- 可选现代路径：`POST /v1/responses` + `image_generation` + `input_image`
- 如果显式开启 `--edit-path /v1/responses`
  - 先走 `Responses API`
  - 失败自动 fallback 到 `Images API edits`
- 如果槽位被判定为 `reference-assisted`，但 `reference_images` 缺失或文件不存在，预检应直接阻断，而不是放到执行阶段再报错

### `masked-edit`

适用于：

- `reference_images + mask_image`
- 局部重绘 / inpainting

路由策略：

- 固定：`POST /v1/images/edits`

当前 runner **不会**把 `masked-edit` 强行切到 `Responses`，因为这条链路在不同 provider 上兼容性差，风险更高。
- 如果槽位被判定为 `masked-edit`，但 `reference_images` 或 `mask_image` 缺失，预检应直接阻断，因为执行阶段一定失败

### 为什么这么设计

原因很简单：

- `Images API` 仍然是正式路径，不是废弃路径
- `Responses API` 更现代，但 provider 差异更大
- 真正可用的策略不该是“统一”，而该是“默认稳 + 可升级 + 可回退”

---

## 模型位说明

这里有两个模型位，职责不同。

### `OPENAI_MODEL`

真正负责出图的模型。

常见值：

- `gpt-image-2`

### `OPENAI_RESPONSES_MODEL`

只在 `Responses` 路径下使用。

它不是出图模型本体，而是顶层 Responses 调度模型。

常见值：

- `gpt-5.4`
- `gpt-5.5`

当前脚本优先级如下：

1. `--responses-model`
2. `OPENAI_RESPONSES_MODEL`
3. 默认回落到 `gpt-5.4`

也就是说，它不是写死的，可以换，但前提是你的 provider 支持该模型走 `/v1/responses`。

---

## 安装到 Codex

### 用 `npx skills` 安装

项目级安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch
```

全局安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch -g
```

也可以直接从 skill 路径安装：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/interactive-image-batch -a codex
```

安装完成后建议重启 Codex。

说明：

- `references/examples/examples_catalog.html` 属于这个 skill 包内文件
- 使用 `npx skills` 安装 `interactive-image-batch` 时，它会随 skill 一起安装
- 手动复制 `skills/interactive-image-batch/` 时，只要整目录复制完整，这份中文任务展示板也会一起带过去

### 手动安装

把 `skills/interactive-image-batch` 复制到以下任一目录：

- 项目级：`.agents/skills/interactive-image-batch/`
- 全局：`~/.codex/skills/interactive-image-batch/`

如果你是手动覆盖更新，也建议重启 Codex，让新版本 skill 被重新加载。

说明：

- 手动安装时，不要只复制 `SKILL.md`
- 应把整个 `interactive-image-batch` 目录完整复制过去，这样 `references/examples/examples_catalog.html`、任务地图、脚本和示例资源都会一起生效

---

## 快速开始

### 1. 准备环境

建议准备一个 `.env`：

```env
OPENAI_BASE_URL=https://your-provider.example.com
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-image-2
OPENAI_RESPONSES_MODEL=gpt-5.4
```

### 2. 准备 prompts 文件

最小可运行格式：

```json
[
  {
    "index": 1,
    "slug": "hero-cover",
    "title": "Hero Cover",
    "generation_prompt": "生成一张16:9科技财经风横版主视觉，蓝金质感，单人物，画面干净高级。"
  }
]
```

### 3. 执行默认文生图

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output \
  --env-file /abs/path/.env
```

### 4. 执行无 mask 参考图模式

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output \
  --env-file /abs/path/.env \
  --edit-path /v1/responses \
  --responses-model gpt-5.4
```

### 5. 执行 prompt-only 的 Responses 模式

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output \
  --env-file /abs/path/.env \
  --generate-path /v1/responses \
  --responses-model gpt-5.4
```

### 6. 桌面端 / 附件素材导入到 storyboard

如果你的参考图和遮罩图来自桌面端上传、聊天附件、临时下载目录，不想自己手动整理成固定路径，可以先走素材导入层：

```bash
node scripts/import_reference_assets.js \
  --task-spec /abs/path/task_spec.storyboard.json \
  --output-dir /abs/path/run_output \
  --references /abs/path/ref_01.png,/abs/path/ref_02.png \
  --masks /abs/path/mask_01.png \
  --slot-order shot_1,shot_2,shot_3
```

它会自动完成：

- 把素材复制到 `run_output/assets/reference/` 和 `run_output/assets/masks/`
- 生成 `reference_bindings.imported.json`
- 生成带更新后的 `storyboard_plan.reference_bindings` 的 `task_spec.with_imported_assets.json`

如果你已经有更明确的素材说明，也可以直接用 `assets_manifest.json`：

```json
{
  "reference_assets": [
    { "path": "/abs/path/desktop_ref.png", "slot_id": "shot_1", "label": "桌面上传参考图" }
  ],
  "mask_assets": [
    { "path": "/abs/path/desktop_mask.png", "slot_id": "shot_2", "label": "遮罩图", "notes": "只改右下角" }
  ]
}
```

然后在 prepare 阶段直接接入：

```bash
node scripts/daoge_prepare_run.js \
  --task-spec /abs/path/task_spec.storyboard.json \
  --strategy-file /abs/path/prompt_strategy.json \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/run_output \
  --import-reference-assets true \
  --assets-manifest /abs/path/assets_manifest.json
```

这条链路适合“素材来源很多、路径不稳定、但想保持 preflight 强校验”的场景。

当前素材接入层分成两级：

- 规则分析层：默认可用
  - 根据文件名、`slot_id`、`shot_3`、`mask`、`遮罩` 这类信号自动推断
  - 会按 slot 顺序做兜底绑定
  - 会输出 `reference_asset_analysis.json`
- 视觉分析层：可选启用
  - 通过 `--enable-vision-analysis true`
  - 会读取图片内容并返回推荐的 `slot_id` / `reference` / `mask`
  - 高置信度推荐会用于没有显式 `slot_id` 的素材
  - 它是“推荐增强层”，不是无条件覆盖用户显式绑定

视觉分析示例：

```bash
node scripts/import_reference_assets.js \
  --task-spec /abs/path/task_spec.storyboard.json \
  --output-dir /abs/path/run_output \
  --references /abs/path/desktop_upload_01.png \
  --enable-vision-analysis true \
  --env-file /abs/path/.env
```

### 7. 自然语言绑定入口

如果你已经知道素材和分镜的大致关系，但不想自己手写 `assets_manifest.json`，现在也可以直接给中文绑定说明。

例如：

```bash
node scripts/import_reference_assets.js \
  --task-spec /abs/path/task_spec.storyboard.json \
  --output-dir /abs/path/run_output \
  --references /abs/path/1.png,/abs/path/2.png,/abs/path/3.png \
  --slot-order shot_1,shot_2 \
  --binding-text "前两张按上传顺序对应 shot_1、shot_2，最后一张是 shot_2 的遮罩图"
```

或直接接入 prepare：

```bash
node scripts/daoge_prepare_run.js \
  --task-spec /abs/path/task_spec.storyboard.json \
  --strategy-file /abs/path/prompt_strategy.json \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/run_output \
  --import-reference-assets true \
  --references /abs/path/1.png,/abs/path/2.png \
  --slot-order shot_1,shot_2 \
  --binding-text "第一张给 shot_1，最后一张是 shot_2 的遮罩图"
```

当前支持的自然语言模式主要包括：

- `按上传顺序对应 shot_1、shot_2`
- `第一张给 shot_1`
- `最后一张是 shot_2 的遮罩图`
- `前两张按顺序给 shot_1 和 shot_2`

这层的目标是减少手工写 JSON，不是完全替代显式绑定。复杂多图场景下，仍然推荐你最终看一眼 `reference_asset_analysis.json`。

### 8. LLM 绑定意图草案与绑定规划器

如果你希望系统先“理解你的中文说明”，再落成正式绑定，而不是直接靠规则解析，可以启用 LLM 规划链路。

这条链路会分成两步：

1. `binding_intent_draft.json`
   - LLM 负责理解用户说明
   - 输出候选 `asset_intents`、`slot_order`、`prompt_only_slots`
2. `binding_plan.json`
   - 规划器把草案规整成可执行的 `reference_assets` / `mask_assets`
   - 然后再交给导入器落盘和生成 `reference_bindings.imported.json`

示例：

```bash
node scripts/daoge_prepare_run.js \
  --task-spec /abs/path/task_spec.storyboard.json \
  --strategy-file /abs/path/prompt_strategy.json \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/run_output \
  --import-reference-assets true \
  --use-llm-binding-planner true \
  --references /abs/path/1.png,/abs/path/2.png \
  --slot-order shot_1,shot_2 \
  --binding-text "第一张给 shot_1，最后一张是 shot_2 的遮罩图" \
  --env-file /abs/path/.env
```

这条链路的设计原则是：

- LLM 只产出 `draft`
- 规划器产出 `plan`
- 导入器只消费 `plan`

这样做是为了避免让 LLM 直接改最终执行绑定。

另外，prepare 现在会额外生成：

- `binding_confirmation.md`

它会把当前绑定理解整理成一段人能直接确认的话，例如：

- 第 1 张 -> `shot_1`（参考图）
- 第 2 张 -> `shot_2`（遮罩图）
- 哪些 slot 保持 `prompt-only`

这份摘要就是给你在真正执行前快速确认用的，不用只盯着 JSON。

### 9. 真实 provider 联网回归

如果你想验证当前 `.env` 对应的真实 provider 是否真的能跑通 `prompt-only / reference-assisted / masked-edit`，现在有单独脚本：

```bash
node scripts/run_real_provider_smoke.js \
  --env-file /abs/path/.env \
  --output-dir /abs/path/real_provider_smoke
```

默认它只做安全预检，不会直接发真实请求。  
只有你显式加上：

```bash
--confirm-live-run true
```

它才会真正执行最小真实 smoke。

产物包括：

- `real_provider_smoke_report.md`

这份报告会明确写出：

- 是否真的执行了联网调用
- 当前使用的模型位
- 每个模式是否执行
- 输出目录在哪里

---

## Prompt 文件格式

最关键字段只有一个：

- `generation_prompt` 或 `prompt`

推荐字段：

- `index`
- `slug`
- `title`
- `style_family`
- `scene`
- `wardrobe`
- `lighting`
- `mood`
- `composition`
- `text_policy`
- `negative_prompt`
- `source_refs`
- `notes`

支持参考图字段：

- `reference_images`
- `mask_image`
- `reference_mode`

示例：

```json
[
  {
    "index": 1,
    "slug": "storyboard-board",
    "title": "Semiconductor Storyboard",
    "style_family": "财经口播分镜板",
    "composition": "16:9 横版分镜板",
    "reference_images": [
      "/abs/path/ref1.png",
      "/abs/path/ref2.png"
    ],
    "generation_prompt": "生成一张16:9横版真实提案级财经口播分镜板，统一同一位二次元/CG主播人物。"
  }
]
```

---

## 推荐运行策略

如果你想要最稳的默认配置，我建议这样理解：

### 默认最稳

- 文生图：`Images API`
- 无 mask 图生图：已验证 provider 支持时，再切 `Responses`
- 有 mask 图生图：保持 `Images API edits`

### 何时启用 Responses

适合以下情况：

- provider 明确更偏好 `/v1/responses`
- 你已经验证过该 provider 的参考图链路能通
- 你想把文生图 / 图生图尽量向统一链路靠拢

### 何时不要强切 Responses

- 你不确定 provider 是否完整兼容
- 你在跑大批量正式任务
- 你在做 `masked-edit`

---

## 常用脚本

### 预检与准备

- `scripts/daoge_prepare_run.js`
- `scripts/validate_task_spec.js`
- `scripts/validate_prompt_strategy.js`
- `scripts/validate_prompt_bundle.js`
- `scripts/validate_storyboard_bundle.js`

### 产物生成

- `scripts/scaffold_prompt_bundle.js`
- `scripts/materialize_prompt_drafts.js`
- `scripts/render_prompt_preview.js`
- `scripts/render_preflight_dashboard.js`
- `scripts/build_host_native_prompt_pack.js`

### 执行与汇总

- `scripts/run_batch.js`
- `scripts/render_completion_report.js`

---

## 输出产物

每次执行通常会产出：

- `prompts.generated.json`
- `batch_plan.json`
- `stage_plan.json`
- `manifest.json`
- `job_state.json`
- `checkpoint.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `rerun_candidates.json`
- `operations_report.md`

如果走的是 `host-native-image-tool` 轻量路径，推荐至少保留：

- `prompts.generated.json`
- `host_native_prompt_pack.json`
- `host_native_summary.md`
- `host_native_summary.html`

这组产物的目标不是伪装本地 execute 已发生，而是给宿主原生图像工具留下一份可交接、可审阅、可复用的最小 prompt 包。

推荐命令：

```bash
node scripts/build_host_native_prompt_pack.js \
  --prompts-file /abs/path/prompts.generated.json \
  --task-spec /abs/path/task_spec.normalized.json \
  --strategy-file /abs/path/prompt_strategy.normalized.json \
  --runtime-mode-file /abs/path/runtime_mode.json \
  --output-dir /abs/path/output_dir
```

如果宿主原生图像工具已经完成出图，还可以把结果回填进 DAOGE 的审阅和归档链：

```bash
node scripts/ingest_host_native_results.js \
  --prompt-pack-file /abs/path/host_native_prompt_pack.json \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

`host_native_results.json` 不要求模拟完整 runner 结果，但建议至少包含：

- `index`
- `title`
- `output`
- `slotId`
- `requestMode`
- `status`
- `error`

现在这份结果文件已经有正式契约与示例：

- schema: `references/host_native_results.schema.json`
- example: `references/examples/host-native/host_native_results.example.json`
- adapter playbook: `references/host_native_adapter_playbook_zh.md`
- adapter quickstart: `references/examples/host-native/adapter_quickstart.example.md`

推荐先独立校验：

```bash
node scripts/validate_host_native_results.js \
  --results-file /abs/path/host_native_results.json
```

如果你是在接一个新的宿主环境，不要只看这里，优先继续读：

- `references/host_native_adapter_playbook_zh.md`
- `references/examples/host-native/adapter_quickstart.example.md`

导入后会补出一条轻量结果链，包括：

- `manifest.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `workspace/workspace_home.html`
- `workspace/result_workspace.html`
- `workspace/exception_workspace.html`
- `workspace/run_record.html`

如果显式开启结果深看模式，才会额外生成或强调：

- `review_board.html`
- `completion_board.html`

如果开启联系图，还会有：

- `contact_sheet.png`
- `contact_sheet_index.md`

---

## 失败续跑

这个项目是按“可恢复”来设计的。

### 只补失败项

```bash
node scripts/run_batch.js \
  --resume-manifest /abs/path/manifest.json \
  --failed-only true \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/rerun_output \
  --env-file /abs/path/.env
```

### 中断后跳过已完成项

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/original_output \
  --env-file /abs/path/.env \
  --skip-existing true
```

### 只改一个分镜 slot

适合：

- 局部重跑
- 只改一格
- 复用上次输出当参考图

相关参数：

- `--resume-manifest`
- `--select-slot-ids`
- `--select-indexes`
- `--reuse-output-as-reference true`
- 对 storyboard / local-edit，优先按 `slot_id` 复用上一轮成功输出，避免因为 prompt 顺序变化误绑到底图

---

## 分镜板模式

如果你在做分镜板，推荐使用以下文件来分离职责：

- `content_manifest.json`
  - 讲内容结构和叙事
- `layout_manifest.json`
  - 讲版式和区域
- `reference_bindings.json`
  - 讲参考图绑定关系
- `render_config.json`
  - 讲尺寸、风格和渲染策略

这样做的好处是：

- 不会把“文案结构、镜头结构、视觉结构、运行参数”揉成一条巨型 prompt
- 更适合真实提案板和连续分镜任务

---

## 脚本分层

当前脚本已经做了基础模块化，不再把 runner 全部逻辑堆在一个大文件里。

### runner 主入口

- `scripts/run_batch.js`
  - 只保留参数解析、执行编排、阶段控制、结果汇总

### runner 子模块

- `scripts/run_batch_cli.js`
  - runner CLI 参数与命令拼接辅助
- `scripts/run_batch_selection.js`
  - `resume-manifest`、`failed-only`、`select-slot-ids`、`reuse-output-as-reference`
- `scripts/run_batch_transport.js`
  - `images/generations`、`images/edits`、`responses` 路径与 fallback
- `scripts/run_batch_executor.js`
  - 单条执行、批次执行、contact sheet
- `scripts/run_batch_runtime.js`
  - job state、checkpoint、暂停策略、进度日志
- `scripts/run_batch_artifacts.js`
  - `success.json`、`failed.json`、`selection_board.md`、`operations_report.md`
- `scripts/run_batch_shared.js`
  - runner 内部共享纯函数
- `scripts/script_utils.js`
  - 跨脚本共用的 `parseArgs/readJson/writeJson/chunkArray/resolvePromptFileForRerun`

### prepare / preflight 主链路

- `scripts/daoge_prepare_run.js`
- `scripts/validate_task_spec.js`
- `scripts/validate_prompt_strategy.js`
- `scripts/detect_daoge_mode.js`
- `scripts/scaffold_prompt_bundle.js`
- `scripts/materialize_prompt_drafts.js`
- `scripts/validate_prompt_bundle.js`
- `scripts/render_prompt_preview.js`
- `scripts/render_preflight_dashboard.js`

分层目标是：

- 主入口保留编排语义
- 请求层、续跑层、产物层、运行态拆开
- 改动某一层时，尽量不影响整条 runner 链路

---

## 目录结构

```text
interactive-image-batch/
├── README.md
├── SKILL.md
├── agents/
├── references/
└── scripts/
```

- `SKILL.md`
  - skill 行为规范和对话工作流
- `references/`
  - 模板、说明、示例、运行预设
- `scripts/`
  - 准备、校验、执行、汇总脚本

---

## 适配建议

不同 provider 对图像接口的兼容度差异很大。

建议按下面顺序接入：

1. 先验证默认 `Images API`
2. 再验证 `reference-assisted` 的 `Responses`
3. 再决定是否启用 `prompt-only` 的 `Responses`
4. 不要先碰 `masked-edit + Responses`

换句话说：

**先跑稳，再升级。**

---

## 当前项目取舍

这个项目刻意选择了工程化取舍，而不是追“理论上最统一”：

- 保留 `Images API`
- 增加 `Responses API`
- 用显式开关控制
- 在关键路径上保留 fallback
- 对 `masked-edit` 保守处理

这让它更适合真实生产，而不是只适合 demo。

---

## 开发与回归

这个 skill 现在自带最小自动化 smoke tests。

统一回归入口：

```bash
skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

它会顺序执行：

- `scripts/*.js` 全量 `node --check`
- `scripts/detect_runtime_mode.js`
- `scripts/validate_template_registry.js`
- `scripts/build_host_native_prompt_pack.js` 的最小 fixture 产物检查
- `scripts/ingest_host_native_results.js` 的最小 fixture 结果回填检查
- `skills/interactive-image-batch/tests/smoke.test.js`

当前 smoke 覆盖：

- `run_batch.js --dry-run`
- `daoge_prepare_run.js` 最小 preflight
- `template_registry_zh.json` 与模板文档主链一致性校验
- mock provider 下的 `prompt-only` 执行路径
- mock provider 下的 `reference-assisted` 执行路径

建议规则：

- 改 `scripts/` 后先跑一次统一 smoke
- 改 `references/template_registry_zh.json` 或 `references/templates/*` 后也先跑一次统一 smoke
- 改 `run_batch*`、`render_*`、`validate_*`、`daoge_prepare_run.js` 时不要跳过回归
- 新增执行分支时，优先补 fixture 和 smoke tests，再继续扩功能
- 如果只改模板文档，也不要只靠肉眼检查，至少跑到 `validate_template_registry.js` 为绿

如果你是在接新的 `host-native` 宿主，不要直接从脚本开始翻，推荐按这个顺序读：

1. `references/host_native_integration_sop_zh.md`
2. `references/host_native_adapter_playbook_zh.md`
3. `references/examples/host-native/adapter_quickstart.example.md`
4. `references/host_native_results.schema.json`
5. `references/examples/host-native/host_native_results.example.json`

如果这次已经完成了一个新宿主接入，建议顺手补一份归档：

- `docs/host_native_adapter_archive_template_zh.md`

## 模板维护 SOP

如果你要新增、修改或清理模板，推荐固定按下面 4 步走，不要跳步。

### 1. 先判断这是“基础模板”还是“派生模板”

- 如果变化发生在结构层：
  - 必问字段不同
  - `prompt_sections` 不同
  - `quality_rules` 或 `anti_patterns` 不同
  - 需要独立触发词和主链检测
  - 这才考虑新增基础模板
- 如果变化只是行业语义、场景语义或示例差异：
  - 优先做派生模板文档
  - 不要急着加入 `template_registry_zh.json`

判断标准以：

- `references/template_authoring_zh.md`

为准。

### 2. 更新模板文档和注册表

基础模板最少要同步两处：

- `references/templates/<category>/<template>.md`
- `references/template_registry_zh.json`

模板文档至少应具备这些章节：

- `适用范围`
- `不适用范围`
- `必问字段`
- `推荐字段`
- `模板变体`
- `推荐 variant_axes`
- `自动补全建议`
- `强约束`
- `反模式`

如果只是派生模板文档，应明确写清：

- 依附的主模板是谁
- 本文档补充的行业语义是什么
- 为什么不进入注册表主链

### 3. 跑模板主链校验

最小校验命令：

```bash
cd skills/interactive-image-batch
node scripts/validate_template_registry.js
node scripts/render_template_registry_report.js \
  --report-file references/template_registry_validation_report.json
```

你应该至少看到三份产物：

- `references/template_registry_validation_report.json`
- `references/template_registry_report.md`
- `references/template_registry_report.html`

如果这里不绿，不要继续往下交付。

### 4. 跑统一 smoke

最终统一入口：

```bash
skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

只有这条入口跑通，才说明：

- 脚本语法没坏
- 模板主链没漂移
- smoke tests 没被模板改动带崩

建议把它当成模板改动的默认收尾动作，而不是可选动作。

---

## License / Usage

请按你自己的仓库策略补充 license、组织说明或内部接入规范。
