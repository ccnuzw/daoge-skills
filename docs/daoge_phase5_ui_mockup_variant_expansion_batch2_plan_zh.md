> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第五阶段 UI Mockup 变体扩容第二批计划

## 目标

继续补齐 `ui-mockup-board` 家族剩余高频子类，让这条家族从“高频覆盖可用”推进到“接近补满”。

## 本批范围

固定补 2 个尾项变体：

1. `product-card-overlay`
2. `short-video-cover-ui`

## 交付物

- `references/examples/ui-mockups/ui_mockup_board.product_card_overlay.example.json`
- `references/examples/ui-mockups/ui_mockup_board.short_video_cover_ui.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. 两个新增 `example-id` 出现在 catalog 和 HTML catalog
2. 两条入口实际跑通 `catalog -> quickstart -> prepare`
3. 两条入口 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
4. 全量 smoke 通过

## 说明

本批完成后，`ui-mockup-board` 将只剩最后一个低优先级尾项，届时可以转入全局覆盖度复盘，而不是继续只盯单一家族。
