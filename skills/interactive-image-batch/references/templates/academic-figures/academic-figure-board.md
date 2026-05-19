# 学术图板模板

用于论文图、研究图、机制图、实验对比图和研究概览海报。

## 适用范围

- graphical abstract
- mechanism diagram
- method pipeline
- 实验对比图
- 研究概览海报
- qualitative comparison grid

## 不适用范围

- 普通品牌信息图
- 纯工程架构图
- 商业海报
- UI 界面稿

## 必问字段

- 这是机制图、方法流程、实验对比还是研究概览图
- 主要阅读顺序是什么
- 重点是图示说明、实验对比，还是结论概览
- 文字策略是标题级可读、局部标签可读还是后期替换
- 更偏论文图、教学图，还是学术海报

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `figure_type`
- `comparison_mode`
- `annotation_density`
- `evidence_focus`
- `publication_context`

## 模板变体

- `graphical-abstract`: 图文概览型研究摘要图。
- `mechanism-diagram`: 机制/作用路径图。
- `method-pipeline-overview`: 方法流程总览图。
- `multi-condition-comparison`: 多条件实验对比图。
- `neural-network-architecture`: 神经网络结构示意图。
- `publication-chart`: 更正式的论文图版式。
- `qualitative-comparison-grid`: 定性对比栅格图。
- `research-overview-poster`: 研究海报式概览图。
- `scientific-schematic`: 科学示意图。

## 推荐 variant_axes

- `figure_type`: graphical abstract, mechanism, method pipeline, comparison grid, research poster
- `comparison_mode`: single-path, before-after, multi-condition, control-vs-treatment
- `annotation_density`: minimal, balanced, dense
- `publication_context`: journal figure, conference poster, teaching slide

## 自动补全建议

- `lighting`: flat publication clarity, subtle figure separation, academic-safe contrast
- `composition`: figure-panel layout, comparison-safe grid, publication-oriented board
- `mood`: scientific clarity, evidence-led explanation, research presentation tone

## 强约束

- 必须先确定图类型和阅读顺序
- 图中结构必须服务研究表达，不是商业装饰
- 文本策略要限制长文本直接生成
- 对比类任务必须明确比较维度

## 反模式

- 把论文图写成普通信息图
- 只有“科技感”，没有实验结构
- 对比图没有比较维度
- 机制图没有方向关系
