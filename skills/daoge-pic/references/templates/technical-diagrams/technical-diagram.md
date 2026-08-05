# 技术图解模板

用于系统架构图、流程决策图、时序图、拓扑图、状态机和技术脑图类任务。

## 适用范围

- 系统架构图
- 技术流程图
- 决策分支图
- 时序图
- 网络拓扑图
- ER 图或状态机
- 技术脑图

## 不适用范围

- 纯品牌化信息图
- 界面视觉稿
- 普通拼贴或海报
- 电影叙事分镜

## 必问字段

- 这是架构、流程、时序、拓扑、ER、状态机还是脑图
- 主要节点有几层
- 是否存在明确方向关系：上下游、前后时序、条件分支
- 文本策略是标题级可读、关键标签可读，还是仅保留结构占位
- 更强调工程准确感、教学拆解感，还是汇报展示感

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `composition`
- `diagram_type`
- `node_hierarchy`
- `edge_semantics`
- `legend_policy`

## 模板变体

- `system-architecture`: 系统架构图，强调层级、服务关系和上下游边界。
- `flowchart-decision`: 决策或流程图，强调分支判断、流程方向和节点状态。
- `sequence-diagram`: 时序图，强调参与者、时间推进和事件顺序。
- `network-topology`: 网络拓扑图，强调节点连接、区域划分和链路清晰度。
- `er-diagram`: 实体关系图，强调实体块、属性组和关系连线。
- `state-machine`: 状态机图，强调状态节点、迁移触发和起止态。
- `mind-map-tech`: 技术脑图，强调中心主题、分支扩散和层级折叠感。

## 推荐 variant_axes

- `diagram_type`: architecture, flowchart, sequence, topology, er, state-machine, mind-map
- `node_hierarchy`: two-layer, three-layer, service-cluster, central-hub
- `edge_semantics`: directional arrows, dependency lines, grouped containers, annotated transitions
- `presentation_mode`: engineering blueprint, teaching board, executive summary

## 自动补全建议

- `composition`: clean node-link diagram, layered technical board, readable topology spacing
- `lighting`: flat diagram clarity, subtle depth separation, presentation-safe contrast
- `mood`: engineering precision, analytical explanation, system-level clarity

## 强约束

- 必须先确定图类型，不能用一个泛“技术图”糊过去
- 节点层级和关系方向必须可描述
- 文字策略应限制为标签、图例或标题级，不默认生成长段准确文本
- 图解目标是结构清晰，不是科技感装饰海报

## 反模式

- 只有发光线条，没有节点语义
- 把技术图解写成赛博风海报
- 分支关系和时序关系混成一团
- 节点、箭头和容器没有清晰层级
