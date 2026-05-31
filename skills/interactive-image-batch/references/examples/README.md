# Examples Index

如果你是第一次使用，不要先从这个文件开始。

请先读：

- [../../START_HERE_中文.md](../../START_HERE_中文.md)

这个目录用于存放 `interactive-image-batch` 的示例输入和示例结构。

约束：

- `examples` 只承担“示例”和“上手参考”职责
- 它不是模板契约来源
- 模板规则的事实来源仍然是：
  - `references/template_registry_zh.json`
  - `references/templates/*`
  - `references/template_authoring_zh.md`

## 当前示例目录

- `examples.catalog.json`
  - 可运行 example 的目录索引
- `storyboard/`
  - 通用分镜结构示例
- `finance-storyboard/`
  - 财经口播分镜示例
- `host-native/`
  - host-native 结果契约和 quickstart 示例
- `ui-mockups/`
  - UI 界面视觉稿最小示例
- `infographics/`
  - 信息图最小示例
- `technical-diagrams/`
  - 技术图解最小示例
- `avatars-and-profile/`
  - 头像资产包最小示例
- `slides-and-visual-docs/`
  - 幻灯页 / 视觉文档页最小示例
- `academic-figures/`
  - 学术图 / 论文图 / 研究概览图最小示例
- `branding-and-packaging/`
  - 品牌包装板 / 包装系统板最小示例
- `scenes-and-illustrations/`
  - 插画场景 / 绘本场景最小示例
- `maps/`
  - 地图路线板最小示例
- `typography-and-text-layout/`
  - 排版海报最小示例
- `assets-and-props/`
  - 资产道具板最小示例
- `product-visuals/`
  - 电商主图 / 详情页组图最小示例
- `social-campaigns/`
  - 社媒九宫格最小示例
- `performance-creatives/`
  - 广告 A/B 测试组最小示例
- `editing-workflows/`
  - 图像编辑最小示例
- `poster-and-campaigns/`
  - 品牌海报 / 联名主视觉最小示例
- `grids-and-collages/`
  - 系列 Lookbook 最小示例
- `portraits-and-characters/`
  - 肖像主视觉 / 棚拍大片最小示例
- `cinematic-sequences/`
  - 电影分镜组 / 口播分镜整板最小示例

## 使用建议

- 想看模板边界：先读 `references/templates/*`
- 想看最小可用输入：再读这里的 `*.example.json`
- 想做新模板：先读 `references/template_authoring_zh.md`

## Quickstart

如果你想把某个 example 直接转成最小 `task_spec` 和 `prompt_strategy`，可以运行：

```bash
node scripts/build_example_quickstart.js \
  --example-file references/examples/ui-mockups/ui_mockup_board.example.json \
  --output-dir /tmp/daoge-example-quickstart
```

输出：

- `task_spec.quickstart.json`
- `prompt_strategy.quickstart.json`

这两个文件可以继续交给：

- `scripts/validate_task_spec.js`
- `scripts/validate_prompt_strategy.js`
- 后续也可以接 `scripts/daoge_prepare_run.js`

如果你想直接从 example 跑到完整预检面板，可以运行：

```bash
node scripts/run_example_quickstart_prepare.js \
  --example-file references/examples/ui-mockups/ui_mockup_board.example.json \
  --output-dir /tmp/daoge-example-prepare
```

它会自动生成 quickstart 输入、通过校验、补齐最小 prompt draft，并产出：

- `prepare/preflight_board.html`
- `prepare/prompt_preview.html`
- `prepare/daoge_preflight_dashboard.md`

如果你不想手写路径，可以先列出 catalog：

```bash
node scripts/run_example_catalog_prepare.js --list true
```

如果你是第一次使用，建议先看推荐起步入口：

```bash
node scripts/run_example_catalog_prepare.js --starter true
```

如果你已经知道自己要做什么类型的任务，也可以直接按任务意图进入：

```bash
node scripts/run_example_catalog_prepare.js --intent ui
node scripts/run_example_catalog_prepare.js --intent academic
node scripts/run_example_catalog_prepare.js --intent packaging
node scripts/run_example_catalog_prepare.js --intent map
node scripts/run_example_catalog_prepare.js --intent typography
node scripts/run_example_catalog_prepare.js --intent cinematic
node scripts/run_example_catalog_prepare.js --intent oralboard
node scripts/run_example_catalog_prepare.js --intent financeboard
node scripts/run_example_catalog_prepare.js --intent hostboard
node scripts/run_example_catalog_prepare.js --intent productboard
node scripts/run_example_catalog_prepare.js --intent eduboard
node scripts/run_example_catalog_prepare.js --intent expertboard
node scripts/run_example_catalog_prepare.js --intent testimonialboard
```

如果你想先打开一个可点击的中文模板展示板，可以运行：

```bash
node scripts/render_example_catalog_board.js
```

默认会生成：

- `references/examples/examples_catalog.html`

这份 `examples_catalog.html` 就是当前 skill 的中文模板展示板，适合普通用户先浏览任务类型和入口，再决定是否继续看命令或内部字段。

当前 catalog 已包含：

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
- `ecommerce-clean-soft-scene-commerce`
- `ecommerce-clean-material-focus-commerce`
- `ecommerce-clean-flatlay-commerce`
- `ecommerce-clean-platform-safe-packshot`
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
- `oral-storyboard-board-expert-led`
- `oral-storyboard-board-testimonial-led`

第一批变体级入口还包括：

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

第二批变体级入口新增：

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

第三批静态子类入口新增：

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

第十四批地图路线补齐入口新增：

- `map-route-board-itinerary-day-trip-map`
- `map-route-board-food-map`

推荐第一次上手优先从这些入口开始：

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

再按 example id 一键生成预检面板：

```bash
node scripts/run_example_catalog_prepare.js \
  --example-id ui-mockup-board \
  --output-dir /tmp/daoge-example-catalog-demo
```

如果你想直接体验 UI mockup 的高频子类，也可以运行：

```bash
node scripts/run_example_catalog_prepare.js \
  --example-id ui-mockup-board-social-interface-mockup \
  --output-dir /tmp/daoge-ui-social-mockup-demo
```

也可以直接体验剩余两个 UI 高频尾项：

```bash
node scripts/run_example_catalog_prepare.js \
  --example-id ui-mockup-board-product-card-overlay \
  --output-dir /tmp/daoge-ui-product-card-demo
```
