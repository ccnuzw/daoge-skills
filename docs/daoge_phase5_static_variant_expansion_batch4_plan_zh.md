# DAOGE 第五阶段静态视觉子类扩容第四批计划

## 目标

继续扩充说明页、详情页、社媒和品牌海报这四条静态主线中的代表性子类入口，让 catalog 更像可直接上手的产品目录，而不是只有主链样例。

## 本批范围

1. `visual-doc-slide.educational-diagram-slide`
2. `detail-page-set.lifestyle-proof`
3. `social-grid.ugc-polished`
4. `campaign-poster.product-hero`

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
