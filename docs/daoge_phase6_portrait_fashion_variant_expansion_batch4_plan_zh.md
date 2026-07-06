> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第六阶段 Portrait-Fashion 第四波正式变体扩展计划

## 目标

继续补强 `portrait-kv` 与 `studio-editorial` 两条 `portrait-fashion` 主线，让它们从“已经完整”进入“更贴近真实商业人物分型”的覆盖区间。

## 本轮新增正式变体

### portrait-kv

- `headline-safe-portrait-kv`
- `profile-silhouette-kv`

### studio-editorial

- `sharp-tailoring-studio`
- `beauty-detail-studio`

## 预期交付

- 注册表补齐正式 `variants`
- 新增 4 份 example
- 接入 `examples.catalog.json`
- 更新 `references/examples/README.md`
- 更新主 `README.md`
- 增补 smoke 用例
- 真实跑通 4 条 `catalog -> quickstart -> prepare`

## 验证标准

- 新增 4 条入口全部通过真实 `prepare`
- `prompt_validation_report.json` 全部满足：
  - `duplicatePromptCount = 0`
  - `qualityGates.ok = true`
  - `warnings = []`
- `node --test skills/interactive-image-batch/tests/smoke.test.js` 通过
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh` 输出 `[smoke] done`
