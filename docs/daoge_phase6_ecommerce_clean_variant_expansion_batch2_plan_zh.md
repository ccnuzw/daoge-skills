# DAOGE 第六阶段电商主图家族扩展计划（二）

## 目标

在 `ecommerce-clean` 已完成第一轮家族化的基础上，再补两条高频真实业务变体。

## 本批新增正式变体

- `flatlay-commerce`
- `platform-safe-packshot`

## 设计原则

- 仍然保持在 `ecommerce-clean` 家族内部，不新增大类
- 新变体必须服务真实电商主图高频需求，而不是与 `detail-page-set` 重叠
- 接入范围覆盖：
  - 注册表
  - 模板文档
  - example
  - catalog
  - README
  - smoke
  - 真实 `prepare`

## 交付物

- `references/template_registry_zh.json`
- `references/templates/product-visuals/ecommerce-clean.md`
- `references/examples/product-visuals/ecommerce_clean.flatlay_commerce.example.json`
- `references/examples/product-visuals/ecommerce_clean.platform_safe_packshot.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. `ecommerce-clean` 注册表变体数从 `3` 提升到 `5`
2. 两个新入口出现在 catalog 和 HTML catalog
3. 两条入口实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
   - `warnings: []`
5. 覆盖检查中 `ecommerce-clean` 的 `missing` 为空
6. 全量 smoke 通过
