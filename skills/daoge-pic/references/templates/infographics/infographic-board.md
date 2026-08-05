# 信息图板模板

用于对比图、步骤图、数据拆解图、看板式信息摘要和模块化图文板。

## 适用范围

- 对比型信息图
- 分步骤说明图
- Bento Grid 信息板
- KPI 或指标摘要图
- 图例较重、需要明显信息分组的讲解板

## 不适用范围

- 纯技术架构图
- 纯 UI 界面稿
- 电影分镜或口播分镜板
- 单张主视觉海报

## 必问字段

- 这张图主要是在讲对比、流程、指标，还是概览摘要
- 信息模块预计有几组
- 是否有固定阅读顺序
- 文字策略是大标题留位、局部标签可读，还是全部后期替换
- 重点是数据可信感、教学感，还是品牌包装感

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `composition`
- `information_hierarchy`
- `reading_path`
- `icon_language`
- `data_emphasis`

## 模板变体

- `comparison-infographic`: 左右或多列对比，强调差异项和结论区。
- `step-by-step-infographic`: 流程或操作步骤图，强调阅读顺序和步骤编号区。
- `bento-grid-infographic`: 模块分块型信息板，强调卡片层级和信息密度平衡。
- `kpi-dashboard-infographic`: 指标摘要板，强调数据块、关键数字和趋势提示。
- `legend-heavy-infographic`: 图例较多、解释层重的信息图，强调标签区和图例结构。
- `hand-drawn-infographic`: 更轻松的手绘信息图，强调教学感与可理解性。

## 推荐 variant_axes

- `information_hierarchy`: hero-stat-first, balanced-grid, explanation-first, comparison-first
- `reading_path`: top-down, left-right, zigzag modules, circular overview
- `icon_language`: flat icons, soft 3d icons, schematic symbols, hand-drawn markers
- `data_emphasis`: metric-led, process-led, evidence-led, summary-led

## 自动补全建议

- `composition`: modular infographic board, balanced data-card grid, clear reading path layout
- `lighting`: flat print-style clarity, subtle panel separation, soft shadow grouping
- `mood`: clear explanation, structured confidence, editorial teaching tone

## 强约束

- 信息图必须有明显阅读顺序或模块层级
- 重点是信息结构，而不是单纯视觉装饰
- 文本策略应限制可读文字密度，避免把整张图交给模型自由拼字
- 需要给出标题区、标签区或图例区的相对关系

## 反模式

- 模块很多但没有阅读路径
- 把信息图写成海报拼贴
- 图标、数字和标题互相抢层级
- 用“高级感”替代信息结构描述
