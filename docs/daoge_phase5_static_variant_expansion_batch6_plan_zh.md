> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第五阶段静态视觉子类扩容第六批计划

## 目标

把技术图和信息图这两条高频说明型主线再往下补一层，新增更典型的流程图、状态机、对比信息图和 Bento 信息板入口。

## 本批范围

1. `technical-diagram.flowchart-decision`
2. `technical-diagram.state-machine`
3. `infographic-board.comparison-infographic`
4. `infographic-board.bento-grid-infographic`

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
