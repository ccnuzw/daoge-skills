# DAOGE 第四阶段分镜家族纵深扩充计划

本批目标：在已经接入 `cinematic-storyboard` 和 `oral-storyboard-board` 主链入口的基础上，继续补一层高价值分镜变体与行业 starter。

## 本批范围

- 新增一个行业 starter：
  - `finance-oral-storyboard-board`
- 新增一个分镜变体入口：
  - `cinematic-storyboard-micro-film`
- 两者都要接入：
  - `examples.catalog.json`
  - `references/examples/README.md`
  - `README.md`
  - `render_example_catalog_board.js`
  - `smoke.test.js`

## 设计边界

1. `finance-oral-storyboard-board`
   - 不是新的基础模板
   - 仍然挂在 `oral-storyboard-board` 主模板下
   - 用行业 starter 方式进入 onboarding

2. `cinematic-storyboard-micro-film`
   - 不是新的大类
   - 是 `cinematic-storyboard` 的变体级入口
   - 先进入 catalog 和 example-to-prepare 链，不强制加入 starter 列表

## 预期结果

- 新增 intent：
  - `--intent financeboard`
- catalog 中出现：
  - `finance-oral-storyboard-board`
  - `cinematic-storyboard-micro-film`
- 两条入口都可以从：
  - `catalog -> quickstart -> prepare`
  跑通
