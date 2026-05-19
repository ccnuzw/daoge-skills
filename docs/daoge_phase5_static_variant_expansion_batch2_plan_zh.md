# DAOGE 第五阶段静态视觉子类扩容第二批计划

## 目标

继续扩充静态视觉主线下的高价值子类入口，不新增大类，只补现有大类中的代表性变体，并确保同时具备：

- 模板变体 example
- catalog 可见入口
- README 可发现性
- smoke 可回归验证
- 至少两条真实 `prepare` 演练

## 本批范围

1. `infographic-board.legend-heavy-infographic`
2. `technical-diagram.network-topology`
3. `brand-packaging-board.character-merch-board`
4. `avatar-profile-pack.themed-3d-icon`

## 交付物

- 新增 4 个 `*.example.json`
- 更新 `references/examples/examples.catalog.json`
- 更新 `references/examples/README.md`
- 更新 `README.md`
- 更新 `tests/smoke.test.js`

## 验证要求

- 新入口可通过 `run_example_catalog_prepare.js --example-id ...` 走到 `prepare`
- 真实抽查至少 2 条，确认：
  - `duplicatePromptCount: 0`
  - `qualityGates.ok: true`
- 全量 smoke 通过
- 目录检查通过
