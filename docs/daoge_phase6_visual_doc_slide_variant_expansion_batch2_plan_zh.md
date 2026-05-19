# DAOGE Phase 6 Visual Doc Slide 第二轮正式变体扩展计划

## 目标

把 `visual-doc-slide` 从当前 4 个正式变体扩到 6 个，补齐两条高频说明型页面入口：

- `data-summary-slide`
- `before-after-explainer-slide`

## 变体定位

### data-summary-slide

适合季度汇报、指标摘要、核心结论页和“先看结论再看支撑”的视觉文档页。

### before-after-explainer-slide

适合改造前后对照、流程优化前后对比、升级前后解释页。强调对照结构、结论差异和阅读顺序。

## 本批交付物

- 注册表正式变体定义更新
- 2 个新 example
- catalog 接入
- examples README 与主 README 更新
- smoke 回归覆盖
- 2 条真实 `prepare` 演练

## 验证要求

真实演练：

- `visual-doc-slide-data-summary-slide`
- `visual-doc-slide-before-after-explainer-slide`

预期：

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`

全量回归：

- `node --test skills/interactive-image-batch/tests/smoke.test.js`
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`

