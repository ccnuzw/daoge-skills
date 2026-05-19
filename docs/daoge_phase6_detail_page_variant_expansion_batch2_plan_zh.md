# DAOGE Phase 6 Detail Page 第二轮正式变体扩展计划

## 目标

把 `detail-page-set` 从当前 4 个正式变体扩到 6 个，补齐更高频的电商详情页结构入口：

- `comparison-proof-detail`
- `feature-stack-page`

## 本批交付物

- 注册表正式变体定义更新
- 2 个新 example
- catalog 接入
- examples README 与主 README 更新
- smoke 回归覆盖
- 2 条真实 `prepare` 演练

## 变体定义

### comparison-proof-detail

适合前后对比、功能差异证明、优势比较等详情页结构。强调对比关系清晰、主体一致、标注区稳定。

### feature-stack-page

适合一页内连续堆叠多个卖点模块，强调模块层级、说明位留白、商品主体与功能信息并存。

## 验证要求

真实演练：

- `detail-page-set-comparison-proof-detail`
- `detail-page-set-feature-stack-page`

预期：

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`

全量回归：

- `node --test skills/interactive-image-batch/tests/smoke.test.js`
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`

