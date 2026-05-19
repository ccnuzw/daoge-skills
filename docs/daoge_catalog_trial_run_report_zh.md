# DAOGE Catalog 试运行回归报告

## 本轮范围

本轮按计划对以下 5 个入口做了真实回归：

1. `ui-mockup-board`
2. `academic-figure-board-multi-condition-comparison`
3. `brand-packaging-board-beverage-label-design`
4. `map-route-board-illustrated-city-map`
5. `type-layout-poster-title-safe-poster`

统一路径：

- `catalog -> quickstart -> prepare`

## 跑通结果

5 / 5 全部跑通，均成功生成：

- `task_spec.quickstart.json`
- `prompt_strategy.quickstart.json`
- `prepare/preflight_board.html`
- `prepare/prompt_preview.html`

说明：

- 当前 catalog 到 prepare 的机械链路已经稳定
- 不存在入口级别的直接阻塞故障

## 已确认并已修复的问题

### 1. 非人物类模板的 quickstart 默认红灯

在首轮试运行中，以下类型虽然能跑通，但默认预检是红灯：

- 学术图
- 地图
- 排版海报

根因不是运行器问题，而是 example quickstart 没有自动补齐模板必填轴，导致：

- 学术图缺 `annotation_density`
- 地图缺 `route_logic`、`label_density`
- 排版海报缺 `language_mode`

当前状态：

- 已修复
- 修复位置：`scripts/build_example_quickstart.js`
- 现在会按模板类型自动补齐模板必填轴的默认值

修复后结果：

- `academic-figure-board-multi-condition-comparison`：红灯 -> 绿灯
- `map-route-board-illustrated-city-map`：红灯 -> 绿灯
- `type-layout-poster-title-safe-poster`：红灯 -> 绿灯

## 仍然存在的问题

### 1. 摘要字段对非人物类不够贴脸

`DAOGE 运行摘要` 和 `Prompt 预览` 里仍然复用了比较通用的摘要字段：

- 主场景
- 主服装
- 主构图

这对以下类型不够自然：

- 学术图
- 地图
- 排版海报
- 资产道具板

例如：

- 学术图里出现“主服装”
- 地图里出现“主服装”
- 排版海报里出现“主服装”

这不是链路错误，但会降低产品感。

### 2. 一些 strategy 默认池仍然偏通用

虽然红灯问题已修掉，但 `build_example_quickstart.js` 里仍有一些通用默认值会泄露到非人物任务里，例如：

- `signature visual styling`
- `secondary supporting styling`

这些词在学术图、地图、排版任务里语义偏弱。

## 当前判断

现在系统已经从“能跑通”进入“要不要更像产品”的阶段。

优先级上：

1. 真实链路稳定性：已经达标
2. catalog 导航体验：已经达标
3. 文案贴脸度：下一轮最值得修

## 建议的下一步

下一轮不建议再扩模板数量，优先做一轮“摘要与默认池语义贴脸化”：

1. 让 `render_prompt_preview.js` / `render_preflight_dashboard.js` / `run_summary` 按模板家族显示不同摘要字段
2. 让 `build_example_quickstart.js` 的默认池按模板类型更贴脸
3. 再抽 3 到 5 个入口做第二轮试运行复核
