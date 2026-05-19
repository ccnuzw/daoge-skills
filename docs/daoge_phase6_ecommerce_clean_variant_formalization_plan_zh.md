# DAOGE 第六阶段电商纯净图家族化计划

## 目标

把当前仍是单入口主链的 `ecommerce-clean` 升级成带正式 `variants` 的模板家族。

## 变体范围

- `white-clean-hero`
- `soft-scene-commerce`
- `material-focus-commerce`

其中 `white-clean-hero` 沿用现有基准 example，新增其余两个变体入口。

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
- `references/examples/product-visuals/ecommerce_clean.soft_scene_commerce.example.json`
- `references/examples/product-visuals/ecommerce_clean.material_focus_commerce.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. `ecommerce-clean` 在注册表中具备正式 `variants`
2. 两个新入口出现在 catalog 和 HTML catalog
3. 两条入口实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
5. 覆盖度复查中 `ecommerce-clean` 不再属于单入口模板
6. 全量 smoke 通过

## 收益

本批完成后，`ecommerce-clean` 会从单入口模板升级为 3 变体家族，后续只剩 `image-edit` 仍待正式家族化。
