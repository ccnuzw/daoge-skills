> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE Phase 6 Portrait Fashion 正式变体扩展 Batch 3

日期：2026-05-19

## 目标

在 `portrait-kv` 与 `studio-editorial` 都已达到 5 个正式变体的基础上，继续把 `portrait-fashion` 家族从“基础成熟”推进到“更接近舒适覆盖区间”。

本批新增：

### `portrait-kv`

- `emotion-contrast-kv`
- `product-linked-portrait-kv`

### `studio-editorial`

- `couture-minimal-studio`
- `gesture-sequence-studio`

## 设计原则

- `portrait-kv` 继续沿“情绪控制 / 品牌人物主视觉 / 产品联动”深化
- `studio-editorial` 继续沿“极简高定棚拍 / 动作序列感棚拍”深化
- 新增变体不能和已有：
  - `dramatic-gaze-kv`
  - `beauty-crop-kv`
  - `mono-backdrop-editorial`
  - `motion-pose-studio`
  语义重叠
- 每个新增变体都必须完成：
  - 注册表
  - example
  - catalog
  - README
  - smoke
  - 真实 `prepare`

## 交付物

- 注册表新增 4 个正式变体
- 新增 4 份 example
- catalog 与 README 接入
- smoke 覆盖新增
- 4 条真实 `prepare` 验证

## 验证标准

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`
- `node --test skills/interactive-image-batch/tests/smoke.test.js` 通过
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh` 通过
