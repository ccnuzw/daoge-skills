# DAOGE 第五阶段叙事与插画尾项补齐计划

## 目标

补齐当前覆盖度盘点里剩余的真实缺口，并纠正一处已发现的 variant 命名漂移：

1. `cinematic-storyboard.mood-sequence`
2. `illustrated-scene-set.minimalist-mood-scene`
3. `oral-storyboard-board` 基准入口从旧命名 `product-host-board` 统一纠偏到注册表主链命名 `horizontal-board`

## 范围

本批只做：

- example 文件
- storyboard 配套 manifest / render config
- catalog 接入
- README / examples README 更新
- 模板文档命名纠偏
- smoke 覆盖
- 真实 `prepare` 演练
- 第二轮覆盖度盘点文档

## 交付物

- `references/examples/cinematic-sequences/cinematic_storyboard.mood_sequence.example.json`
- `references/examples/cinematic-sequences/cinematic_storyboard.mood_sequence.content_manifest.json`
- `references/examples/cinematic-sequences/cinematic_storyboard.mood_sequence.render_config.json`
- `references/examples/scenes-and-illustrations/illustrated_scene_set.minimalist_mood_scene.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `references/templates/cinematic-sequences/oral-storyboard-board.md`
- `tests/smoke.test.js`
- `docs/daoge_template_coverage_review_round2_zh.md`

## 验证要求

1. `cinematic-storyboard-mood-sequence` 和 `illustrated-scene-set-minimalist-mood-scene` 出现在 catalog 和 HTML catalog
2. `oral-storyboard-board` 基准入口的 `template_variant` 统一为 `horizontal-board`
3. `cinematic-storyboard-mood-sequence`、`illustrated-scene-set-minimalist-mood-scene`、`oral-storyboard-board` 实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
5. 新一轮覆盖度盘点确认主链模板剩余缺口清零
6. 全量 smoke 通过

## 收益

本批完成后，当前注册表中有显式 `variants` 的模板家族将全部补齐，叙事链和插画链进入“主链 + 变体例子全覆盖”状态。
