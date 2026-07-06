> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第六阶段资产道具板家族化计划

## 目标

把当前只有 `2` 个正式变体的 `asset-prop-sheet` 扩成更完整的正式家族。

## 本批新增正式变体

- `prop-lineup-board`
- `collectible-item-sheet`

## 设计原则

- 仍然保持在 `asset-prop-sheet` 家族内部，不新增大类
- 新变体继续围绕现有模板轴扩展：
  - `asset_role`
  - `surface_style`
  - `presentation_mode`
- 接入范围必须包含：
  - 注册表
  - example
  - catalog
  - README
  - smoke
  - 真实 `prepare`

## 交付物

- `references/template_registry_zh.json`
- `references/examples/assets-and-props/asset_prop_sheet.prop_lineup_board.example.json`
- `references/examples/assets-and-props/asset_prop_sheet.collectible_item_sheet.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. `asset-prop-sheet` 注册表变体数从 `2` 提升到 `4`
2. 两个新入口出现在 catalog 和 HTML catalog
3. 两条入口实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
   - `warnings: []`
5. 覆盖检查中 `asset-prop-sheet` 的 `missing` 为空
6. 全量 smoke 通过
