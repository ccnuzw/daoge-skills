# 地图路线板模板

用于城市地图、路线图、分布图、导览图和一日行程地图。

## 适用范围

- illustrated city map
- travel route map
- store distribution map
- itinerary day trip map
- food map
- 空间导览图

## 不适用范围

- 普通信息图
- 纯技术架构图
- 幻灯页正文排版
- 商业主视觉海报

## 必问字段

- 这是城市导览图、路线图、分布图还是一日行程图
- 主要阅读目标是什么：找路、看分布还是理解行程顺序
- 更偏拟真地图、插画地图，还是图示化导览板
- 是否需要编号、图例、地标标签或路线箭头
- 文字策略是标题可读、局部标签可读还是后期替换

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `map_type`
- `route_logic`
- `label_density`
- `landmark_scope`
- `navigation_style`

## 模板变体

- `illustrated-city-map`: 插画化城市导览图。
- `travel-route-map`: 路线主导型旅行地图。
- `store-distribution-map`: 门店分布图。
- `itinerary-day-trip-map`: 一日行程地图。
- `food-map`: 美食地图。

## 推荐 variant_axes

- `map_type`: city guide, route map, distribution map, itinerary board, themed food map
- `route_logic`: loop, linear path, clustered hotspots, district distribution
- `label_density`: minimal, balanced, dense
- `navigation_style`: diagram-led, illustrated map, semi-real map, infographic-map hybrid

## 自动补全建议

- `lighting`: flat readability, map-safe contrast, legend-friendly separation
- `composition`: board-style map framing, route-first layout, landmark-cluster balance
- `mood`: navigational clarity, spatial storytelling, guide-board polish

## 强约束

- 必须先确定地图类型和阅读目标
- 空间关系、路线层级或分布逻辑必须一眼可读
- 文本策略只允许标题或标签留位，不直接生成长段说明
- 地标、编号、图例和路线要有统一规则

## 反模式

- 把地图板写成普通信息图
- 只有漂亮插画，没有路线或空间逻辑
- 图例、标签和路线风格不统一
- 地标密度失控导致阅读混乱
