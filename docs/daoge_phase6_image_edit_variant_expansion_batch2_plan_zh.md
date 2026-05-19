# DAOGE 第六阶段图像编辑家族扩展计划（二）

## 目标

在 `image-edit` 已完成第一轮家族化的基础上，继续补两条更贴近真实业务的正式变体。

## 本批新增正式变体

- `material-replacement-edit`
- `lighting-consistency-fix`

## 设计原则

- 继续保留 `image-edit` 的强约束：先写清保留内容，再写清修改边界
- 新增变体必须对应高频真实需求，而不是概念性命名
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
- `references/templates/editing-workflows/image-edit.md`
- `references/examples/editing-workflows/image_edit.material_replacement_edit.example.json`
- `references/examples/editing-workflows/image_edit.lighting_consistency_fix.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. `image-edit` 注册表变体数从 `3` 提升到 `5`
2. 两个新入口出现在 catalog 和 HTML catalog
3. 两条入口实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
   - `warnings: []`
5. 覆盖检查中 `image-edit` 的 `missing` 为空
6. 全量 smoke 通过
