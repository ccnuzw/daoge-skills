# DAOGE 第五阶段静态视觉子类扩容第三批计划

## 目标

继续扩充静态视觉主线中说明型、电商型、社媒系统型和投放测试型的高价值子类，补齐当前 catalog 中仍然偏薄的静态变体入口。

## 本批范围

1. `visual-doc-slide.policy-style-slide`
2. `detail-page-set.fit-and-material`
3. `social-grid.brand-feed-system`
4. `ab-ad-test.benefit-stack`

## 交付物

- 新增 4 个 `*.example.json`
- 更新 `references/examples/examples.catalog.json`
- 更新 `references/examples/README.md`
- 更新 `README.md`
- 更新 `tests/smoke.test.js`

## 验证要求

- 新入口可通过 `scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --output-dir out` 走到 `prepare`
- 至少抽 2 条真实演练，确认：
  - `duplicatePromptCount: 0`
  - `qualityGates.ok: true`
- 全量 smoke 通过
- 目录检查通过
