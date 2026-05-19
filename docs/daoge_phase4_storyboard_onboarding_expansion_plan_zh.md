# DAOGE 第四阶段分镜模板接入计划

本批目标：把 `cinematic-storyboard` 和 `oral-storyboard-board` 按统一标准接入 `interactive-image-batch` 的 onboarding 主链，而不是只补模板文档。

## 本批范围

- 新增两个可运行 example：
  - `cinematic-storyboard`
  - `oral-storyboard-board`
- 让 example 可进入：
  - `examples.catalog.json`
  - `run_example_catalog_prepare.js`
  - `render_example_catalog_board.js`
  - `references/examples/README.md`
  - `README.md`
- 为 storyboard 类 example 补齐 quickstart 支持：
  - `build_example_quickstart.js`
  - `run_example_quickstart_prepare.js`
- 增补 smoke 覆盖，验证：
  - starter intent 可解析
  - example 可从 catalog 跑到 `prepare`
  - storyboard quickstart 能保留 `storyboard_plan`

## 设计原则

1. 这批不是普通静态模板接入，必须保留 `storyboard_plan`
2. `cinematic-storyboard` 代表连续镜头叙事入口
3. `oral-storyboard-board` 代表整板口播分镜入口
4. onboarding 先提供最小稳定入口，不追求一次把所有行业分支都做完

## 预期结果

- 新增 intent：
  - `--intent cinematic`
  - `--intent oralboard`
- 新增 catalog 主链入口：
  - `cinematic-storyboard`
  - `oral-storyboard-board`
- 两条入口都能从：
  - `catalog -> quickstart -> prepare`
  真实跑通
