# DAOGE Phase 6 Social Grid 第二轮正式变体扩展计划

## 目标

把 `social-grid` 从当前 4 个正式变体扩到 6 个，补齐更高频的社媒矩阵入口：

- `countdown-campaign-grid`
- `benefit-carousel-grid`

## 变体定位

### countdown-campaign-grid

适合发售倒计时、大促预热、活动节点递进式发布。强调数字节奏、封面冲击和系列连续感。

### benefit-carousel-grid

适合把多个卖点拆成一组可连续浏览的社媒矩阵。强调封面、卖点卡、细节卡和情绪卡之间的节奏统一。

## 本批交付物

- 注册表正式变体定义更新
- 2 个新 example
- catalog 接入
- examples README 与主 README 更新
- smoke 回归覆盖
- 2 条真实 `prepare` 演练

## 验证要求

真实演练：

- `social-grid-countdown-campaign-grid`
- `social-grid-benefit-carousel-grid`

预期：

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`

全量回归：

- `node --test skills/interactive-image-batch/tests/smoke.test.js`
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`

