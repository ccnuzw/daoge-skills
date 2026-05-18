# 电影分镜模板

用于广告片分镜、短片视觉、剧情化海报组和连续镜头。

## 适用范围

- 广告片镜头序列
- 短片或微电影视觉分镜
- 剧情化组图
- 有明确节奏推进的连续镜头任务

## 不适用范围

- 单张品牌主 KV
- 详情页拆解图
- 口播分镜板式提案
- 只追求风格、不追求叙事节点的散图任务

## 必问字段

- 故事主题和镜头数量
- 主角是否固定
- 每张对应开场、推进、高潮还是收束
- 横版电影感还是竖版短视频感
- 是否需要字幕或标题安全区

## 推荐字段

- `storyboard_plan`
- `continuity_notes`
- `story_beat`
- `camera_move`
- `voiceover`
- `text_policy`

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

## 强约束

- 每个镜头必须承担叙事位置，不能只剩“电影感”
- 同一序列的角色、服装、光线和场景逻辑要连续
- 镜头景别和动作状态必须具体
- 若有标题安全区，只能写布局意图，不应生成可读字幕

## 反模式

- 每张互相无关
- 只有电影感没有动作和叙事节点
- 镜头景别不明确
- 同一序列里角色、服装、光线漂移
