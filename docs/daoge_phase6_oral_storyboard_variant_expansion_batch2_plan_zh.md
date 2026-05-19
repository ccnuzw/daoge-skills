# DAOGE Phase 6 口播分镜板正式变体扩展 Batch 2

日期：2026-05-19

## 目标

在 `oral-storyboard-board` 已完成 5 个正式变体覆盖的基础上，继续补两条更强业务指向的口播板入口：

1. `expert-led`
2. `testimonial-led`

## 为什么是这两个

`oral-storyboard-board` 当前已经覆盖：

- `horizontal-board`
- `host-led`
- `industry-led`
- `product-led`
- `educational-explainer`

但还缺少两类真实业务里很常见、又和现有五条边界清楚的口播板：

1. 专家型 / 顾问型口播板
2. 见证型 / 案例型口播板

## 本批交付

1. 扩展 `oral-storyboard-board` 正式变体定义
2. 新增 2 份 example
3. 为 2 份 example 新增配套：
   - `content_manifest.json`
   - `layout_manifest.json`
   - `render_config.json`
4. 接入：
   - `template_registry_zh.json`
   - `examples.catalog.json`
   - `references/examples/README.md`
   - `README.md`
   - `smoke.test.js`
5. 跑两条真实 `catalog -> quickstart -> prepare` 验证

## 新增变体定义

### `expert-led`

定位：

- 适合专家、顾问、分析师、医生、讲师、行业观察者等可信讲述者
- 强调“专业身份 + 观点拆解 + 证据式讲述”

### `testimonial-led`

定位：

- 适合用户见证、案例复盘、客户反馈、成果证明、前后对照
- 强调“人物讲述 + 转变过程 + 结果证明”

## 验证要求

每条新入口都必须通过：

1. 真实 `prepare`
2. `prompt_validation_report.json`
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
   - `warnings: []`
3. `storyboard_bundle.validation.quickstart.json`
   - `ok: true`
   - `warnings: []`
4. 全量 smoke
5. 统一 smoke
