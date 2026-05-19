# DAOGE 第六阶段：Oral Storyboard 家族正式变体扩展计划

## 目标

把 `oral-storyboard-board` 从“基准横版 / 财经行业 / 主持人主导”三点结构，继续扩成更通用的口播整板家族，补进高频且跨行业可复用的正式变体。

## 本批范围

- `product-led`
- `educational-explainer`

## 设计原则

- 两条变体都必须保留整板结构，不退化成普通海报
- `product-led` 强调产品卖点拆解、产品层和主持人口播的协同
- `educational-explainer` 强调知识点解释、板书/图解层和连续口播逻辑
- 每条新增变体都必须配套 `example + storyboard manifest + catalog + README + smoke + 真实 prepare`

## 交付物

- 注册表新增正式 `variants`
- 2 份新 example
- 6 份 storyboard 配套 manifest
- catalog / README / intent 接入
- smoke 覆盖新增
- 2 条真实 `prepare` 验证

## 验证标准

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`
- `storyboardValidation.ok: true`
- `node --test skills/interactive-image-batch/tests/smoke.test.js` 通过
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh` 通过
