# 排版海报模板

用于双语排版视觉、标题主导型海报、安全标题海报和文字布局主导型画面。

## 适用范围

- bilingual layout visual
- title-safe poster
- 大标题主导海报
- 文字布局视觉

## 不适用范围

- 纯品牌主 KV
- 幻灯页 / 视觉报告页
- 论文图或技术图
- 纯包装板

## 必问字段

- 这是双语排版视觉、标题海报还是安全标题海报
- 主要视觉中心是大标题、字块节奏，还是图文对位
- 更偏品牌海报、文化排版，还是信息性文字视觉
- 是否必须预留标题区、副标题区、角标区或 logo 区
- 文字策略是标题可读、短语可读还是全部后期替换

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `headline_role`
- `language_mode`
- `layout_density`
- `type_dominance`
- `safe_area_policy`

## 模板变体

- `bilingual-layout-visual`: 双语排版视觉。
- `title-safe-poster`: 标题安全区海报。

## 推荐 variant_axes

- `headline_role`: giant title, stacked title, editorial phrase block, restrained corner headline
- `language_mode`: chinese-only, bilingual balanced, bilingual dominant-secondary
- `layout_density`: minimal, balanced, dense
- `type_dominance`: type-led, image-type balance, image-led with type reserve

## 自动补全建议

- `lighting`: poster-safe contrast, editorial surface clarity, type-friendly background control
- `composition`: headline-first layout, safe title reserve, controlled text block rhythm
- `mood`: editorial restraint, typography-led polish, layout confidence

## 强约束

- 必须明确文字在画面中的主次角色
- 标题区、安全区和图像区要有明确关系
- 不让模型自由生成大段正文
- 双语任务要明确主语言和辅助语言关系

## 反模式

- 把排版海报写成普通人物海报
- 只有“高级排版感”，没有版面节奏
- 文本和图像抢主次
- 双语任务里两种语言层级混乱
