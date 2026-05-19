# DAOGE 第五阶段 A/B 测试与 Campaign 延展补齐计划

## 目标

按覆盖度盘点的第二优先级，补齐静态商业主线里仍然缺失的三条高频变体入口：

1. `ab-ad-test.audience-angle`
2. `ab-ad-test.layout-test`
3. `campaign-poster.campaign-extension`

## 范围

这批只做：

- example 文件
- catalog 接入
- README / examples README 更新
- smoke 覆盖
- 至少两条真实 `prepare` 演练

## 交付物

- `references/examples/performance-creatives/ab_ad_test.audience_angle.example.json`
- `references/examples/performance-creatives/ab_ad_test.layout_test.example.json`
- `references/examples/poster-and-campaigns/campaign_poster.campaign_extension.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. 三个新增 `example-id` 出现在 catalog 和 HTML catalog
2. 至少两条入口实际跑通 `catalog -> quickstart -> prepare`
3. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
4. 全量 smoke 通过

## 收益

本批完成后：

- `ab-ad-test` 将从 `2/4` 补到 `4/4`
- `campaign-poster` 将从 `3/4` 补到 `4/4`

也就是覆盖度盘点里的第二优先级缺口会一次性清掉。
