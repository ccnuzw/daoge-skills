> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第六阶段：Campaign Poster 家族第二批正式变体扩展计划

## 目标

把 `campaign-poster` 从第一轮的基础主视觉家族继续做深，补进两条更高频、边界更清晰的商业海报正式变体。

## 本批范围

- `headline-safe-kv`
- `people-product-dual-hero`

## 设计原则

- `headline-safe-kv` 强调强标题区、安全留白和广告主视觉层级
- `people-product-dual-hero` 强调人物与产品双主角同屏，而不是偏人物或偏产品单边倾斜
- 两条都必须保持品牌海报属性，不退化成普通棚拍或电商图
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
