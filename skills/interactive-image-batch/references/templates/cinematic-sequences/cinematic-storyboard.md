# 电影分镜模板

用于广告片分镜、短片视觉、剧情化海报组和连续镜头。

## 必问字段

- 故事主题和镜头数量
- 主角是否固定
- 每张对应开场、推进、高潮还是收束
- 横版电影感还是竖版短视频感
- 是否需要字幕或标题安全区

## 模板变体

- `four-beat-ad`: 开场、产品揭示、情绪高潮、收束主视觉。
- `micro-film`: 连续微电影镜头。
- `vertical-short`: 竖版短视频分镜封面。
- `mood-sequence`: 情绪递进组图。

## 推荐 variant_axes

- `story_beat`: opening hook, product reveal, emotional turn, closing hero frame
- `camera_language`: wide establishing shot, medium action frame, close emotional frame, hero end frame
- `continuity_anchor`: same wardrobe, same palette, same location logic
- `motion_state`: stillness, walking, turning, reaching, closing pose

## 自动补全建议

- `lighting`: cinematic motivated light, consistent sequence palette
- `mood`: narrative tension, premium restraint, emotional progression
- `composition`: frame from a larger sequence, clear shot scale

## 反模式

- 每张互相无关
- 只有电影感没有动作和叙事节点
- 镜头景别不明确
- 同一序列里角色、服装、光线漂移
