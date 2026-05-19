# DAOGE 第五阶段静态视觉子类扩容第七批计划

## 目标

补齐技术图与信息图说明型主线里剩余的高频代表变体，让这两条线从“常用入口可用”推进到“谱系基本完整”。

## 本批范围

1. `technical-diagram.er-diagram`
2. `technical-diagram.mind-map-tech`
3. `infographic-board.hand-drawn-infographic`

## 交付物

- 新增 3 个 `*.example.json`
- 更新 `references/examples/examples.catalog.json`
- 更新 `references/examples/README.md`
- 更新 `README.md`
- 更新 `tests/smoke.test.js`

## 验证要求

- 新入口可通过 `run_example_catalog_prepare.js --example-id ...` 走到 `prepare`
- 至少抽 2 条真实演练，确认：
  - `duplicatePromptCount: 0`
  - `qualityGates.ok: true`
  - `warnings: []`
- 全量 smoke 通过
- 目录检查通过
