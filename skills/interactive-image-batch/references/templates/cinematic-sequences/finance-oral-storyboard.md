# 财经口播分镜板模板

用于“财经科普口播分镜板 / 财经导演式分镜板 / 主理人口播提案板 / 横版整板分镜”的场景。

这个模板不是普通电影分镜，也不是单张海报。它强调：

- 同一位主持人连续出镜
- 左信息区 + 右侧多格分镜 + 底部收尾KV
- 内容逻辑、镜头逻辑、版式逻辑同时成立
- 更像真实内容提案板或导演分镜板，而不是广告海报

## 必问字段

- 主题和口播时长
- 是否为单张整板，还是拆成多张单图
- 主持人是否必须固定为同一人
- 人物锚点来自哪里：上传图 / Word 提取图 / 指定母版
- 中文字段要求到什么程度：装饰可读 / 关键信息清晰 / 全字段尽量清晰
- 结构是否固定为：左信息区 + 右侧分镜网格 + 底部KV
- 哪些镜头必须强绑定参考图，哪些镜头允许 prompt-only

## 适配场景

- 财经内容口播分镜板
- 券商 / 财经 / 科技赛道的内容策划板
- 同一位 CG / 二次元 / 虚拟主理人连续镜头
- 产业链、数据图层、芯片、算力、制造基地等信息叠加类大板

## 推荐字段

- `content_brief`
- `style_requirements`
- `storyboard_plan`
- `text_policy`
- `reference_bindings`
- `continuity_notes`
- `prompt_hints`
- `camera_move`
- `voiceover`
- `sound_effects`

## 推荐版式

- 左侧信息区
- 右侧 2 行 4-6 列分镜格
- 底部横向收尾 KV

如果用户明确要求整板提案感，优先考虑：

- `brand_panel`
- `shot_1 ... shot_n`
- `kv_final`

## 推荐 variant_axes

- `story_beat`
  - opening hook
  - logic breakdown
  - key answer reveal
  - industry expansion
  - long-term wrap-up

- `camera_language`
  - medium presenter shot
  - close explanation shot
  - information-led composite shot
  - full-body wrap-up shot

- `continuity_anchor`
  - same face
  - same outfit logic
  - same studio palette
  - same presenter identity

## 自动补全建议

- `lighting`
  - deep navy financial studio lighting
  - blue-gold anchor desk glow
  - restrained market-heat red accents

- `mood`
  - professional trust
  - restrained intensity
  - analytical confidence

- `composition`
  - storyboard proposal board
  - left info panel, right shot grid, bottom closing KV

## 强约束

- 主持人统一性优先级高于单格炫技
- 分镜连续性优先级高于素材平均分配
- 文字清晰度优先级高于装饰感
- 不要误判成营销海报、直播卖货封面或普通 PPT

## 反模式

- 每格人物换脸
- 把 14 张参考图机械平均分到 10 格
- 明明是口播分镜板，却做成品牌主KV海报
- 只有科技感，没有导演分镜信息结构
- 中文字段全糊成装饰噪点
