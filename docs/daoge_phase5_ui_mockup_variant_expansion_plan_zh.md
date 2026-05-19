# DAOGE 第五阶段 UI Mockup 变体扩容计划

## 目标

按覆盖度盘点结果，优先补齐 `ui-mockup-board` 家族当前最薄的高频子类入口，并保证新增入口不是“只存在于文档里”，而是完整接入：

- example 文件
- catalog 入口
- README / examples README
- smoke 回归
- 至少两条真实 `prepare` 演练

## 本批范围

本批固定补 3 个高优先级变体：

1. `social-interface-mockup`
2. `live-commerce-ui`
3. `chat-interface-scene`

## 交付物

- `references/examples/ui-mockups/ui_mockup_board.social_interface_mockup.example.json`
- `references/examples/ui-mockups/ui_mockup_board.live_commerce_ui.example.json`
- `references/examples/ui-mockups/ui_mockup_board.chat_interface_scene.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. 新增 3 个 `example-id` 出现在 catalog 中
2. 至少 2 个新入口实际跑通 `catalog -> quickstart -> prepare`
3. `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
4. 全量 smoke 通过

## 备注

这一批不新增新的 onboarding intent。优先把 `ui-mockup-board` 现有主链做深，后续如果这些变体被证明高频，再考虑是否单独暴露更细的 intent。
