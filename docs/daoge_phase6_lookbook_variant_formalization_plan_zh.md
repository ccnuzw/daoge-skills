# DAOGE 第六阶段 Lookbook 家族化计划

## 目标

把当前仍是单入口主链的 `lookbook` 升级成带正式 `variants` 的模板家族。

## 变体范围

- `series-unified`
- `chapter-lookbook`
- `cover-and-range`

其中 `series-unified` 沿用现有基准 example，新增其余两个变体入口。

## 范围

本批只做：

- 注册表补 `variants`
- 新增 2 个 example
- catalog 接入
- README / examples README 更新
- smoke 覆盖
- 真实 `prepare` 演练

## 交付物

- `references/template_registry_zh.json`
- `references/examples/grids-and-collages/lookbook.chapter_lookbook.example.json`
- `references/examples/grids-and-collages/lookbook.cover_and_range.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. `lookbook` 在注册表中具备正式 `variants`
2. 两个新入口出现在 catalog 和 HTML catalog
3. 两条入口实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
5. 覆盖度复查中 `lookbook` 不再属于单入口模板
6. 全量 smoke 通过

## 收益

本批完成后，`lookbook` 会从单入口模板升级为 3 变体家族，为后续继续家族化 `ecommerce-clean` 和 `image-edit` 提供同一套范式。
