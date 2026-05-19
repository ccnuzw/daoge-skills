# DAOGE 第五阶段静态视觉子类扩容第五批计划

## 目标

继续补齐幻灯页、详情页、社媒和品牌海报中的高频典型子类，让静态视觉主线的 catalog 更接近一套完整的商业视觉入口库。

## 本批范围

1. `visual-doc-slide.dense-explainer-slides`
2. `detail-page-set.hero-plus-details`
3. `social-grid.nine-grid-launch`
4. `campaign-poster.people-hero`

## 交付物

- 新增 4 个 `*.example.json`
- 更新 `references/examples/examples.catalog.json`
- 更新 `references/examples/README.md`
- 更新 `README.md`
- 更新 `tests/smoke.test.js`

## 验证要求

- 新入口可通过 `run_example_catalog_prepare.js --example-id ...` 走到 `prepare`
- 至少抽 2 条真实演练，确认：
  - `duplicatePromptCount: 0`
  - `qualityGates.ok: true`
- 全量 smoke 通过
- 目录检查通过
