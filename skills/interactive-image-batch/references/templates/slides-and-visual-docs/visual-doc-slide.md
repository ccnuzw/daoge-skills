# 视觉文档页模板

用于幻灯页、汇报页、解释型单页和视觉报告页。

## 适用范围

- 幻灯页或 pitch deck 单页
- 解释型报告页
- 政策风格信息页
- 教学或研究类幻灯页
- 视觉报告封面页或正文页

## 不适用范围

- 单张品牌海报
- 纯 UI 界面稿
- 纯技术架构图
- 单纯的单页信息图

## 必问字段

- 这是封面页、正文解释页、政策页还是视觉报告页
- 页面重点是标题、图解、数据摘要还是结论块
- 需要哪些固定版区：标题区、正文区、图表区、侧注区、页脚区
- 文字策略是标题可读、关键标签可读，还是全部后期替换
- 风格更偏正式汇报、教育说明还是品牌化视觉文档

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `page_role`
- `layout_zones`
- `headline_weight`
- `supporting_visual`
- `annotation_density`

## 模板变体

- `dense-explainer-slides`: 高信息密度解释页，强调模块秩序和阅读压力控制。
- `educational-diagram-slide`: 教学型图解页，强调标题、图示和注释共存。
- `policy-style-slide`: 政策/制度风格页，强调正式版式、边距和规则感。
- `visual-report-page`: 视觉报告页，强调版心、图文平衡和汇报完成度。
- `data-summary-slide`: 数据摘要页，强调核心结论、数字区和图表区分工。
- `before-after-explainer-slide`: 前后对照解释页，强调对比结构和改造逻辑。

## 推荐 variant_axes

- `page_role`: title slide, explainer page, report body page, policy summary page
- `layout_zones`: headline-top, left-text-right-visual, split columns, stacked modules
- `headline_weight`: hero-title, balanced-title, caption-led
- `annotation_density`: minimal, balanced, dense

## 自动补全建议

- `lighting`: flat presentation clarity, subtle paper depth, report-safe contrast
- `composition`: slide-page grid, presentation-safe margins, title-led report layout
- `mood`: formal clarity, educational order, polished briefing tone

## 强约束

- 这是页面级文档，不是普通信息图或海报
- 必须明确版区分工和页内阅读顺序
- 文本策略要限制模型直接生成长段准确文案
- 标题区、正文区、图像区和侧注区的相对关系要可描述

## 反模式

- 把幻灯页写成海报或拼贴
- 页面只有标题，没有版区结构
- 注释区、图像区和正文区挤在一起
- 过度追求视觉装饰，丢掉汇报页的秩序感
