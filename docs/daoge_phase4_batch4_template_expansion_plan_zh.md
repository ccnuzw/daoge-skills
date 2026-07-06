> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE Phase4 第四批模板扩容计划

## 目标

在前三批已经补完：

- `ui-mockups`
- `infographics`
- `technical-diagrams`
- `avatars-and-profile`
- `slides-and-visual-docs`
- `academic-figures`
- `branding-and-packaging`
- `scenes-and-illustrations`

之后，继续对照 `gpt-image-2` 的剩余大类，补第四批收口型主链模板。

本批次目标：

1. `maps`
2. `typography-and-text-layout`
3. `assets-and-props`

## 为什么是这三类

### maps

当前本地虽然已有 `infographic-board`、`technical-diagram` 和 `visual-doc-slide`，但还缺“空间关系 / 路线表达 / 城市导览 / 分布地图”这类任务。

它和现有模板的边界：

- 比 `infographic-board` 更强调地理锚点、路线层级和空间导览
- 比 `technical-diagram` 更强调真实或拟态空间关系，而不是系统结构

### typography-and-text-layout

当前本地虽然很多模板都涉及 `text_policy`，但还缺“标题主导型排版画面 / 双语排版视觉 / 安全文字海报”这类以文字版心为主任务。

它和现有模板的边界：

- 比 `campaign-poster` 更强调字块排布，而不是商业主视觉
- 比 `visual-doc-slide` 更强调海报式文字主导，而不是页面结构

### assets-and-props

当前本地有 `avatar-profile-pack`，但还缺“图标资产 / 道具资产 / 游戏截图 mockup / skeuomorphic icons”这类小型可复用视觉资产任务。

它和现有模板的边界：

- 比 `avatar-profile-pack` 更偏独立资产，而不是 identity 头像
- 比 `brand-packaging-board` 更偏单体资产可读性，而不是系统包装板

## 本批次主链模板建议

继续采用同样原则：一个大类优先只进一个主链模板。

### 1. maps

建议主链模板：

- `map-route-board`

第一批变体：

- `illustrated-city-map`
- `travel-route-map`
- `store-distribution-map`
- `itinerary-day-trip-map`
- `food-map`

### 2. typography-and-text-layout

建议主链模板：

- `type-layout-poster`

第一批变体：

- `bilingual-layout-visual`
- `title-safe-poster`

### 3. assets-and-props

建议主链模板：

- `asset-prop-sheet`

第一批变体：

- `retro-skeuomorphic-icons`
- `game-screenshot-mockup`

## 分层建议

沿用现有四层结构，避免为最后三个大类再扩新的 tier：

- `map-route-board`
  - `tier`: `interface-and-information`
  - `family`: `map-and-route`
- `type-layout-poster`
  - `tier`: `core-commercial`
  - `family`: `typography-layout`
- `asset-prop-sheet`
  - `tier`: `identity-and-assets`
  - `family`: `prop-assets`

## 需要同步修改的层

本批次至少会改：

1. `references/template_registry_zh.json`
2. `references/templates/maps/map-route-board.md`
3. `references/templates/typography-and-text-layout/type-layout-poster.md`
4. `references/templates/assets-and-props/asset-prop-sheet.md`
5. `scripts/detect_daoge_mode.js`
6. `references/dialogue_templates_zh.md`
7. `references/examples/*`
8. `references/examples/examples.catalog.json`
9. `tests/smoke.test.js`
10. `README.md`

## 完成标准

满足以下条件，本批次才算完成：

1. 新增 3 个主链模板
2. 注册表模板总数继续增长且校验全绿
3. `detect_daoge_mode.js` 能命中这 3 类任务
4. examples 至少各补 1 份最小示例
5. catalog、README 和 examples README 都能看到新类目
6. smoke 与统一入口全绿
