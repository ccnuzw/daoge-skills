> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第六阶段：Portrait Fashion 家族第二批正式变体扩展计划

## 目标

把 `portrait-kv` 和 `studio-editorial` 作为同一批 `portrait-fashion` 家族继续做深，不再停留在第一轮基础变体，而是补齐更贴近真实商业人物视觉需求的第二批正式变体。

## 本批范围

### `portrait-kv`

- `dramatic-gaze-kv`
- `beauty-crop-kv`

### `studio-editorial`

- `mono-backdrop-editorial`
- `motion-pose-studio`

## 设计原则

- `portrait-kv` 继续沿“眼神张力 / 裁切策略 / 近景品牌主视觉”深化
- `studio-editorial` 继续沿“背景控制 / 灯光组织 / 姿态动势”深化
- 变体命名必须和现有家族边界清晰区分，避免与 `campaign-poster`、`lookbook` 混淆
- 每个新增变体都必须配套 `example + catalog + README + smoke + 真实 prepare`

## 交付物

- 注册表新增正式 `variants`
- 4 份新增 example
- catalog 和 README 接入
- smoke 覆盖新增
- 4 条真实 `prepare` 验证

## 验证标准

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`
- `node --test skills/interactive-image-batch/tests/smoke.test.js` 通过
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh` 通过
