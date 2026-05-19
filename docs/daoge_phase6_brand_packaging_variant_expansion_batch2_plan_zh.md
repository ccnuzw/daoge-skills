# DAOGE Phase 6 Brand Packaging 第二轮正式变体扩展计划

## 目标

把 `brand-packaging-board` 从当前 5 个正式变体扩到 7 个，补齐更高频的包装商业入口：

- `gift-box-campaign-packaging`
- `seasonal-limited-packaging`

## 变体定位

### gift-box-campaign-packaging

适合节日礼盒、联名礼盒、活动礼赠套组和 campaign packaging 板。强调套组层级、开盒体验和品牌礼赠感。

### seasonal-limited-packaging

适合春夏秋冬、节庆、限定款和主题季包装延展。强调季节主题、限定语义和包装系统一致性。

## 本批交付物

- 注册表正式变体定义更新
- 2 个新 example
- catalog 接入
- examples README 与主 README 更新
- smoke 回归覆盖
- 2 条真实 `prepare` 演练

## 验证要求

真实演练：

- `brand-packaging-board-gift-box-campaign-packaging`
- `brand-packaging-board-seasonal-limited-packaging`

预期：

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`

全量回归：

- `node --test skills/interactive-image-batch/tests/smoke.test.js`
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`

