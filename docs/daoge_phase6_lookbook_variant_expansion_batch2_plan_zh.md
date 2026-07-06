> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第六阶段：Lookbook 家族第二批正式变体扩展计划

## 目标

把 `lookbook` 从第一轮的基础家族化继续做深，补进更高频的商业系列展示入口，而不是停留在“统一系列 / 章节式 / 封面加展示”三个基础面。

## 本批范围

- `chapter-scene-progressive`
- `multi-outfit-commercial`

## 设计原则

- `chapter-scene-progressive` 强调章节推进、场景递进和系列叙事节奏
- `multi-outfit-commercial` 强调多款式商业展示、清晰换装和稳定系列镜头语言
- 两条都必须保持 `lookbook` 的系列逻辑，不与 `campaign-poster` 或 `detail-page-set` 混淆
- 每条新增变体都必须配套 `example + catalog + README + smoke + 真实 prepare`

## 交付物

- 注册表新增正式 `variants`
- 2 份新增 example
- catalog 和 README 接入
- smoke 覆盖新增
- 2 条真实 `prepare` 验证

## 验证标准

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`
- `node --test skills/interactive-image-batch/tests/smoke.test.js` 通过
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh` 通过
