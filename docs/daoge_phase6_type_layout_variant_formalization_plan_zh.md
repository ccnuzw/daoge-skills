> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第六阶段排版海报家族化计划

## 目标

把当前仅有 `2` 个正式变体的 `type-layout-poster` 补成更完整的正式家族。

## 本批新增正式变体

- `editorial-phrase-block`
- `image-type-balance-poster`

## 设计原则

- 不新增新的大类，只在现有 `type-layout-poster` 家族内扩展高频变体
- 变体要和现有模板轴一致，优先围绕：
  - `headline_role`
  - `language_mode`
  - `type_dominance`
- 接入范围必须覆盖：
  - 注册表
  - example
  - catalog
  - README
  - smoke
  - 真实 `prepare` 演练

## 交付物

- `references/template_registry_zh.json`
- `references/examples/typography-and-text-layout/type_layout_poster.editorial_phrase_block.example.json`
- `references/examples/typography-and-text-layout/type_layout_poster.image_type_balance_poster.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. `type-layout-poster` 注册表变体数从 `2` 提升到 `4`
2. 两个新入口出现在 catalog 和 HTML catalog
3. 两条入口实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
   - `warnings: []`
5. 覆盖检查中 `type-layout-poster` 的 `missing` 为空
6. 全量 smoke 通过
