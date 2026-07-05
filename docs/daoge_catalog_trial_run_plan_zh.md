# DAOGE Catalog 试运行回归计划

## 目标

当前 `interactive-image-batch` 已经完成：

- 主链模板体系
- 变体级 example 体系
- catalog 分组与筛选入口
- `catalog -> quickstart -> prepare` 的自动化闭环

下一步不再优先扩功能，而是进入小规模产品试运行，验证真实使用路径的摩擦点。

## 试运行范围

本轮只做 5 个代表入口，覆盖：

1. 主链入口
2. 变体入口
3. 商业视觉类
4. 信息 / 学术类
5. 地图 / 排版类

## 本轮选取入口

### 1. `ui-mockup-board`

目的：

- 验证最成熟主链的体验基线

### 2. `academic-figure-board-multi-condition-comparison`

目的：

- 验证学术图的对比型变体是否足够清晰

### 3. `brand-packaging-board-beverage-label-design`

目的：

- 验证包装类在零售标签路径上的可理解性

### 4. `map-route-board-illustrated-city-map`

目的：

- 验证地图类从 catalog 到预检的阅读体验

### 5. `type-layout-poster-title-safe-poster`

目的：

- 验证排版类入口名和预检输出是否足够直观

## 验证方式

每个入口都走同一条路径：

1. 从 catalog 入口选择 example id
2. 执行 `scripts/daoge.js prepare`
3. 检查是否成功生成：
   - `task_spec.quickstart.json`
   - `prompt_strategy.quickstart.json`
   - `prepare/preflight_board.html`
   - `prepare/prompt_preview.html`
4. 审查：
   - 入口命名是否清楚
   - 预检文案是否像真实任务
   - 是否需要更多示例解释
   - 是否存在主链/变体语义不清问题

## 输出

本轮结束后输出一份试运行报告，内容包括：

1. 跑通情况
2. 入口理解成本
3. 预检体验问题
4. 需要补的文案 / example / 命名调整
5. 下一轮修正建议
