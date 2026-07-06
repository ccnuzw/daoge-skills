# Examples Index

以下命令默认在 `skills/interactive-image-batch` 目录执行。

第一次使用不要从全量 catalog 开始。先跑最小 task spec：

```bash
node scripts/daoge.js prepare \
  --task-spec references/examples/task_spec.minimal.json \
  --output-dir /tmp/daoge-minimal
open /tmp/daoge-minimal/workspace/index.html
```

如果只想验流程：

```bash
node scripts/daoge.js execute \
  --output-dir /tmp/daoge-minimal \
  --dry-run true \
  --batch-size 1
```

示例目录用途：

- `task_spec.minimal.json`：新手最小可跑 task spec。
- `examples.catalog.json`：全量示例元数据索引，包含 `category`、`template_id`、`template_variant`、`example_file`。
- `examples_catalog.html`：可视化浏览页，只用于选型和复制统一入口命令。
- 各分类目录：任务类型参考示例；表格中的代表文件可直接 `prepare` 做预检，真实任务建议复制后改成自己的 `task_spec.json`。

## 适合谁

| 用途 | 看哪里 | 说明 |
| --- | --- | --- |
| 新手 | `task_spec.minimal.json`、`ui-mockups/`、`product-visuals/`、`poster-and-campaigns/` | 最容易理解输入、prepare 和 workspace |
| 进阶 | `branding-and-packaging/`、`infographics/`、`slides-and-visual-docs/`、`technical-diagrams/` | 适合结构化、商业或信息密度高任务 |
| 宿主接入 | `host-native/`、`storyboard/`、`finance-storyboard/`、`cinematic-sequences/` | 适合宿主读取 prompts、外部生成、再 ingest |
| 回归测试 | `examples.catalog.json`、`host-native/host_native_results.example.json`、`storyboard/*` | 适合检查 schema、catalog 和导入链路 |

## 分类索引

| 目录 | 用途 | 适合 | task 类型 | 起步命令 |
| --- | --- | --- | --- | --- |
| `ui-mockups/` | UI 界面视觉稿、设备界面、产品页面 | 新手 | `ui-mockup-board` | `node scripts/daoge.js prepare --task-spec references/examples/ui-mockups/ui_mockup_board.example.json --output-dir /tmp/daoge-ui` |
| `product-visuals/` | 电商主图、详情页组图、商品可读性 | 新手 | `ecommerce-clean`、`detail-page-set` | `node scripts/daoge.js prepare --task-spec references/examples/product-visuals/ecommerce_clean.example.json --output-dir /tmp/daoge-ecommerce` |
| `poster-and-campaigns/` | 活动海报、品牌主视觉、人物商品海报 | 新手 | `campaign-poster` | `node scripts/daoge.js prepare --task-spec references/examples/poster-and-campaigns/campaign_poster.example.json --output-dir /tmp/daoge-poster` |
| `portraits-and-characters/` | 肖像主视觉、棚拍大片、角色形象 | 新手 / 进阶 | `portrait-kv`、`studio-editorial` | `node scripts/daoge.js prepare --task-spec references/examples/portraits-and-characters/portrait_kv.example.json --output-dir /tmp/daoge-portrait` |
| `branding-and-packaging/` | 品牌包装板、标签、礼盒、角色周边 | 进阶 | `brand-packaging-board` | `node scripts/daoge.js prepare --task-spec references/examples/branding-and-packaging/brand_packaging_board.example.json --output-dir /tmp/daoge-packaging` |
| `infographics/` | 信息图、步骤图、对比图、图文说明 | 进阶 | `infographic-board` | `node scripts/daoge.js prepare --task-spec references/examples/infographics/infographic_board.example.json --output-dir /tmp/daoge-infographic` |
| `technical-diagrams/` | 架构图、流程图、状态机、ER 图 | 进阶 | `technical-diagram` | `node scripts/daoge.js prepare --task-spec references/examples/technical-diagrams/technical_diagram.example.json --output-dir /tmp/daoge-diagram` |
| `slides-and-visual-docs/` | 汇报页、解释页、视觉文档页 | 进阶 | `visual-doc-slide` | `node scripts/daoge.js prepare --task-spec references/examples/slides-and-visual-docs/visual_doc_slide.example.json --output-dir /tmp/daoge-slide` |
| `academic-figures/` | 论文图、研究概览、机制图 | 进阶 | `academic-figure-board` | `node scripts/daoge.js prepare --task-spec references/examples/academic-figures/academic_figure_board.example.json --output-dir /tmp/daoge-academic` |
| `maps/` | 地图路线板、门店分布、城市导览 | 进阶 | `map-route-board` | `node scripts/daoge.js prepare --task-spec references/examples/maps/map_route_board.example.json --output-dir /tmp/daoge-map` |
| `typography-and-text-layout/` | 排版海报、标题安全区、短句视觉 | 进阶 | `type-layout-poster` | `node scripts/daoge.js prepare --task-spec references/examples/typography-and-text-layout/type_layout_poster.example.json --output-dir /tmp/daoge-type` |
| `assets-and-props/` | 道具资产板、游戏截图 mockup、收藏品 | 进阶 | `asset-prop-sheet` | `node scripts/daoge.js prepare --task-spec references/examples/assets-and-props/asset_prop_sheet.example.json --output-dir /tmp/daoge-props` |
| `avatars-and-profile/` | 头像包、贴纸包、profile 系列资产 | 新手 / 进阶 | `avatar-profile-pack` | `node scripts/daoge.js prepare --task-spec references/examples/avatars-and-profile/avatar_profile_pack.example.json --output-dir /tmp/daoge-avatar` |
| `social-campaigns/` | 九宫格、倒计时、品牌 feed、轮播图 | 进阶 | `social-grid` | `node scripts/daoge.js prepare --task-spec references/examples/social-campaigns/social_grid.example.json --output-dir /tmp/daoge-social` |
| `performance-creatives/` | 广告 A/B 测试、投放素材组 | 进阶 | `ab-ad-test` | `node scripts/daoge.js prepare --task-spec references/examples/performance-creatives/ab_ad_test.example.json --output-dir /tmp/daoge-ab` |
| `editing-workflows/` | 局部修图、风格统一、材质替换 | 进阶 | `image-edit` | `node scripts/daoge.js prepare --task-spec references/examples/editing-workflows/image_edit.example.json --output-dir /tmp/daoge-edit` |
| `grids-and-collages/` | Lookbook、系列拼贴、章节组图 | 进阶 | `lookbook` | `node scripts/daoge.js prepare --task-spec references/examples/grids-and-collages/lookbook.example.json --output-dir /tmp/daoge-lookbook` |
| `scenes-and-illustrations/` | 插画场景、绘本场景、概念场景 | 新手 / 进阶 | `illustrated-scene-set` | `node scripts/daoge.js prepare --task-spec references/examples/scenes-and-illustrations/illustrated_scene_set.example.json --output-dir /tmp/daoge-scene` |
| `cinematic-sequences/` | 电影分镜、口播分镜、短片镜头组 | 宿主接入 / 进阶 | `cinematic-storyboard`、`oral-storyboard-board` | `node scripts/daoge.js prepare --task-spec references/examples/cinematic-sequences/cinematic_storyboard.example.json --output-dir /tmp/daoge-cinematic` |
| `storyboard/` | 通用分镜结构示例 | 宿主接入 / 回归测试 | storyboard manifests | 先按目录内 manifest 整理 `task_spec.json`，再 `prepare` |
| `finance-storyboard/` | 财经口播分镜结构示例 | 宿主接入 / 回归测试 | `finance-oral-storyboard-board` | `node scripts/daoge.js prepare --task-spec references/examples/finance-storyboard/finance_oral_storyboard_board.example.json --output-dir /tmp/daoge-finance` |
| `host-native/` | 宿主结果 schema、quickstart、回填示例 | 宿主接入 / 回归测试 | `host_native_results` | 先 `node scripts/daoge.js prepare --task-spec references/examples/task_spec.minimal.json --output-dir /tmp/daoge-host`；宿主生成自己的 `host_native_results.json` 后再 `ingest`。目录内 example 只作 schema 参考 |

## 使用顺序

1. 先跑 `task_spec.minimal.json`。
2. 再从上表选接近任务的分类。
3. 复制对应 `*.example.json` 为自己的 `task_spec.json`。
4. 跑 `prepare`，打开 `workspace/index.html`。
5. 要本地出图就跑 `execute`；要宿主出图就让宿主读取 `debug/prompts.generated.json` 后跑 `ingest`。

## 注意

- `examples` 只承担示例和上手参考，不是模板契约来源。
- 模板事实来源仍是 `references/template_registry_zh.json`、`references/templates/*`、`references/template_authoring_zh.md`。
- 当前用户文档只推荐 `node scripts/daoge.js`。
- 不再推荐复制旧示例参数命令。
