# 插画场景组模板

用于概念场景、治愈场景、极简情绪场景和绘本场景。

## 适用范围

- concept scene
- healing scene
- minimalist mood scene
- picture-book scene
- 纯插画型氛围场景

## 不适用范围

- 商业海报主视觉
- 分镜序列
- 信息图
- 纯 UI 或包装板

## 必问字段

- 这是概念场景、治愈场景、极简情绪图还是绘本场景
- 更重氛围、叙事片段，还是场景设定展示
- 主体是人物、环境、物件，还是混合
- 是否需要连续系列感
- 文字策略是不留字、标题留位，还是局部标签留位

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `scene_mood`
- `narrative_anchor`
- `illustration_surface`
- `color_temperature`
- `series_continuity`

## 模板变体

- `concept-scene`: 概念设定场景。
- `healing-scene`: 治愈型氛围场景。
- `minimalist-mood-scene`: 极简情绪场景。
- `picture-book-scene`: 绘本式场景。

## 推荐 variant_axes

- `scene_mood`: contemplative, healing, whimsical, quiet wonder
- `narrative_anchor`: environment-led, character-led, object-led, mixed
- `illustration_surface`: painterly, flat graphic, textured storybook, soft digital wash
- `color_temperature`: warm dusk, cool morning, muted neutral, pastel glow

## 自动补全建议

- `lighting`: soft atmospheric light, storybook-friendly depth, mood-safe contrast
- `composition`: scene-led illustration spread, narrative vignette, balanced environment frame
- `mood`: immersive atmosphere, gentle narrative calm, illustrative wonder

## 强约束

- 必须明确这是插画场景，不是商业海报
- 氛围和叙事锚点要比卖点结构更重要
- 系列任务要说明 continuity 目标
- 文本策略只保留必要留位

## 反模式

- 把插画场景写成品牌视觉
- 只有风格词，没有场景锚点
- 系列图之间毫无连续感
- 氛围词堆砌但没有构图目标
