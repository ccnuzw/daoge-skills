# DAOGE Phase 6：Cinematic Storyboard 第二轮正式变体扩展计划

日期：2026-05-19

## 目标

在 `cinematic-storyboard` 已有 4 个正式变体的基础上，继续补两条高价值叙事型分镜变体：

1. `demo-explainer-sequence`
2. `product-reveal-sequence`

## 为什么现在补这一条

- `cinematic-storyboard` 当前只有 4 个正式变体，明显低于核心商业家族的 6~7 区间
- 它属于 DAOGE 的叙事能力主轴，继续扩的价值高于继续做静态视觉扫尾
- 当前已具备 storyboard onboarding、manifest、prepare 和 validation 闭环，扩展成本低

## 本批交付

1. 更新 `cinematic-storyboard` 模板文档和注册表
2. 新增两个正式变体 example
3. 为两个 example 补齐 storyboard content/render 配套
4. 接入 `examples.catalog.json`
5. 更新 `references/examples/README.md` 与主 `README.md`
6. 更新 `smoke.test.js`
7. 跑两条真实 `prepare`
8. 跑全量 smoke 和目录检查

## 目标变体定义

### `demo-explainer-sequence`

适用：

- 产品演示分镜
- 功能说明型短片分镜
- 面向解释而非纯情绪推进的镜头序列

重点：

- 镜头要有“展示 -> 解释 -> 反馈 -> 收束”的因果
- 产品/界面/动作必须清楚，不只是电影氛围

### `product-reveal-sequence`

适用：

- 新品揭示
- 关键物料登场
- 先铺情绪再完成 reveal 的商业分镜

重点：

- 前半段建立悬念或环境
- 中后段完成产品登场与英雄镜头收束

## 验证标准

两条新入口都必须满足：

- `run_example_catalog_prepare.js --example-id ...` 跑通到 `prepare`
- `prompt_validation_report.json`
  - `duplicatePromptCount: 0`
  - `qualityGates.ok: true`
  - `warnings: []`
- 若存在 `storyboardValidation`
  - `ok: true`
  - `warnings: []`

全量验证：

- `node --test skills/interactive-image-batch/tests/smoke.test.js`
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`
- 目录检查命令
