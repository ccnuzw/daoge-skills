> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE Phase4 第三批模板扩容计划

## 目标

在前两批已经补完 `ui-mockups / infographics / technical-diagrams / avatars-and-profile / slides-and-visual-docs` 之后，继续对照 `gpt-image-2` 的剩余大类，补第三批最有结构价值的主链模板。

本批次优先：

1. `academic-figures`
2. `branding-and-packaging`
3. `scenes-and-illustrations`

## 为什么是这三类

### academic-figures

当前本地虽然已经有 `infographic-board` 和 `technical-diagram`，但还缺“学术图 / 论文图 / 研究展示图”这一类任务。

它和现有模板的边界：

- 比 `infographic-board` 更强调学术阅读结构、比较实验、机制图和论文图版式
- 比 `technical-diagram` 更强调研究表达，而不是工程关系图

### branding-and-packaging

当前本地有海报、详情页、Lookbook，但没有“品牌视觉系统板 / 包装设计板 / mascots / merch”这条主链。

它和现有模板的边界：

- 比 `campaign-poster` 更偏品牌系统和包装实体
- 比 `detail-page-set` 更偏品牌资产和包装语言，而不是卖点拆解

### scenes-and-illustrations

当前本地虽然已有分镜和海报，但没有“概念场景 / 氛围场景 / 绘本场景 / 治愈场景”这一类纯插画型场景模板。

它和现有模板的边界：

- 比 `campaign-poster` 更弱商业转化目标
- 比 `cinematic-storyboard` 更弱序列叙事结构
- 比 `infographic-board` 更偏画面氛围和插画表达

## 本批次主链模板建议

采用同样原则：一个大类优先只进一个主链模板。

### 1. academic-figures

建议主链模板：

- `academic-figure-board`

第一批变体：

- `graphical-abstract`
- `mechanism-diagram`
- `method-pipeline-overview`
- `multi-condition-comparison`
- `neural-network-architecture`
- `publication-chart`
- `qualitative-comparison-grid`
- `research-overview-poster`
- `scientific-schematic`

### 2. branding-and-packaging

建议主链模板：

- `brand-packaging-board`

第一批变体：

- `beverage-label-design`
- `brand-identity-board`
- `character-merch-board`
- `cosmetic-packaging`
- `full-mascot-brand-doc`
- `mascot-brand-kit`

### 3. scenes-and-illustrations

建议主链模板：

- `illustrated-scene-set`

第一批变体：

- `concept-scene`
- `healing-scene`
- `minimalist-mood-scene`
- `picture-book-scene`

## 暂缓类目

以下类目仍建议放到下一批：

- `maps`
- `typography-and-text-layout`
- `assets-and-props`

原因：

- `maps` 和 `infographics / visual-doc-slide` 交叉较强，适合单独做空间关系模板
- `typography-and-text-layout` 目前更像横切能力，而不是主链任务类型
- `assets-and-props` 数量较少，且和现有资产模板边界还需要再收

## 需要同步修改的层

本批次至少会改：

1. `references/template_registry_zh.json`
2. `references/templates/academic-figures/academic-figure-board.md`
3. `references/templates/branding-and-packaging/brand-packaging-board.md`
4. `references/templates/scenes-and-illustrations/illustrated-scene-set.md`
5. `scripts/detect_daoge_mode.js`
6. `references/dialogue_templates_zh.md`
7. `references/examples/*`
8. `tests/smoke.test.js`

## 完成标准

满足以下条件，本批次才算完成：

1. 新增 3 个主链模板
2. 注册表总模板数继续增长且主链校验全绿
3. `detect_daoge_mode.js` 能命中这 3 类任务
4. examples 至少各补 1 份最小示例
5. smoke 与统一入口全绿
