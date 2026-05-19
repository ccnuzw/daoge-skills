# DAOGE Phase 6 A/B Ad Test 第二轮正式变体扩展计划

## 目标

把 `ab-ad-test` 从当前 4 个正式变体扩到 6 个，补齐更贴近真实投放优化的两条正式变体：

- `hook-contrast-test`
- `cta-emphasis-test`

## 变体定位

### hook-contrast-test

适合测试首屏钩子差异，例如“直接产品结论”“问题式冲突感”“氛围式吸引”和“结果先行”的第一眼表达差别。

### cta-emphasis-test

适合测试 CTA 区域强弱、按钮存在感、底部转化引导结构和主体让位程度。

## 本批交付物

- 注册表正式变体定义更新
- 2 个新 example
- catalog 接入
- examples README 与主 README 更新
- smoke 回归覆盖
- 2 条真实 `prepare` 演练

## 验证要求

真实演练：

- `ab-ad-test-hook-contrast-test`
- `ab-ad-test-cta-emphasis-test`

预期：

- `duplicatePromptCount: 0`
- `qualityGates.ok: true`
- `warnings: []`

全量回归：

- `node --test skills/interactive-image-batch/tests/smoke.test.js`
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`

