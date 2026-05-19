# DAOGE 第五阶段头像资产变体补齐计划

## 目标

补齐 `avatar-profile-pack` 家族剩余的两个缺口变体：

1. `character-grid-portrait`
2. `cultural-portrait-series`

## 范围

本批只做：

- example 文件
- catalog 接入
- README / examples README 更新
- smoke 覆盖
- 真实 `prepare` 演练

## 交付物

- `references/examples/avatars-and-profile/avatar_profile_pack.character_grid_portrait.example.json`
- `references/examples/avatars-and-profile/avatar_profile_pack.cultural_portrait_series.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. 两个新增 `example-id` 出现在 catalog 和 HTML catalog
2. 两条入口实际跑通 `catalog -> quickstart -> prepare`
3. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
4. 全量 smoke 通过

## 收益

本批完成后，`avatar-profile-pack` 将从 `3/5` 补到 `5/5`，这条身份资产主线就可以视为补满。
