# DAOGE 第五阶段静态视觉子类扩容计划

本批目标：不新增静态视觉大类，而是补齐现有高价值大类的子类入口密度，让 catalog 不只停留在主链和少量变体。

## 本批范围

- `infographic-board.step-by-step-infographic`
- `technical-diagram.sequence-diagram`
- `brand-packaging-board.mascot-brand-kit`
- `avatar-profile-pack.style-transfer-selfie`

## 接入要求

- 新增 example 文件
- 接入 `examples.catalog.json`
- 接入 `references/examples/README.md`
- 接入主 `README.md`
- 接入 `render_example_catalog_board.js`
- 接入 `smoke.test.js`
- 至少抽 2 条真实入口跑到 `prepare`

## 设计原则

1. 先补高价值子类，而不是继续扩新大类
2. 新子类必须能看出和主链入口的用途差异
3. 入口描述要贴近真实任务，不写抽象模板术语
