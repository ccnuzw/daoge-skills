# UI Mockup 板模板

用于界面概念图、落地页视觉稿、社媒界面合成图、直播带货 UI 叠层和产品卡片界面呈现。

## 适用范围

- App 或 Web 界面视觉稿
- 落地页或活动页 mockup
- 社媒界面包装图
- 直播带货 UI 叠层图
- 带设备壳或屏幕构图的产品展示界面

## 不适用范围

- 普通品牌海报
- 纯信息图或流程图
- 电影分镜
- 纯电商白底商品图

## 必问字段

- 这是 App、Web、直播叠层，还是社媒封面式 UI
- 核心页面目标是什么：转化、展示、讲解还是包装
- 是否需要设备外框、手持场景或界面叠层
- 需要保留哪些模块层级：导航、卡片、图表、按钮、评论区、购买区
- 文字策略是装饰占位、局部可读，还是全部后期替换

## 推荐字段

- `content_brief`
- `output_mode`
- `style_requirements`
- `text_policy`
- `scene`
- `composition`
- `ui_surface`
- `overlay_density`
- `device_context`

## 模板变体

- `landing-page-case-study`: 落地页或专题页视觉稿，强调首屏层级、模块节奏和转化结构。
- `social-interface-mockup`: 社媒帖文、动态流或账号首页 mockup，强调 feed 结构和内容卡片感。
- `live-commerce-ui`: 直播带货或导购界面，强调商品区、评论区、互动组件和购买动作。
- `product-card-overlay`: 商品卖点叠层卡片，强调产品主体 + 信息面板共存。
- `short-video-cover-ui`: 短视频封面式 UI，强调标题安全区、封面主图和平台组件感。
- `chat-interface-scene`: 聊天或对话界面包装图，强调气泡结构、头像、输入区和连续滚动逻辑。

## 推荐 variant_axes

- `ui_surface`: mobile app screen, desktop dashboard, floating overlay, device-framed screen
- `module_focus`: hero banner, product card, comment layer, conversion section, chat thread
- `overlay_density`: minimal, balanced, information-rich
- `device_context`: screen only, hand-held phone, laptop-on-desk, multi-device composition

## 自动补全建议

- `lighting`: crisp screen glow, soft ambient reflection, clean studio presentation light
- `composition`: centered interface hero, angled device showcase, split-screen layout-safe composition
- `mood`: polished product thinking, conversion clarity, high-trust modern interface

## 强约束

- 必须写清界面任务，不要退化成普通海报
- 需要明确屏幕层级、模块关系和主次信息区域
- 文字策略只决定可读性与留位，不默认要求模型生成长段可读文案
- UI 元素必须服务功能目标，不能只有“科技感装饰”

## 反模式

- 把 UI mockup 写成普通科技海报
- 只有发光玻璃效果，没有信息层级
- 所有卡片和模块挤在一起，缺少主次关系
- 设备外框、按钮、卡片和内容区比例失衡
