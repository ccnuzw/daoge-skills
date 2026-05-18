# 口播分镜板模板

用于“口播分镜板 / 主理人口播提案板 / 横版整板分镜 / 导演式解说分镜板”的场景。

这不是普通电影分镜，也不是单张海报。它强调：

- 同一位主持人或主理人连续出镜
- 左信息区 + 右侧多格分镜 + 底部收尾KV
- 内容逻辑、镜头逻辑、版式逻辑同时成立
- 更像真实内容提案板或导演分镜板，而不是广告海报

## 适用范围

- 主理人口播提案板
- 横版整板分镜
- 主持人连续出镜的解释型内容板
- 信息区 + 分镜区 + 收尾 KV 的复合任务

## 不适用范围

- 单张海报
- 纯电影镜头序列
- 纯电商详情页
- 无版式结构要求的散图任务

## 适配领域

这个模板本身不绑定某一个行业，适合：

- 财经
- 美妆
- 母婴
- 3C
- 教育
- 医疗科普
- 出海营销
- 短剧拆解
- IP内容
- 虚拟主理人口播

模板负责“结构”，行业由用户在内容 brief 中补充。

## 必问字段

- 主题和口播时长
- 是单张整板，还是拆成多张单图
- 主持人 / 主理人是否必须固定为同一人
- 人物锚点来自哪里：上传图 / Word提取图 / 指定母版
- 中文字段要求到什么程度：装饰可读 / 关键信息清晰 / 全字段尽量清晰
- 结构是否固定为：左信息区 + 右侧分镜网格 + 底部KV
- 哪些镜头必须强绑定参考图，哪些镜头允许 prompt-only
- 底部KV更偏人物、产品、产业还是混合收尾

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

## 适配场景

- 财经内容口播分镜板
- 产品解说分镜板
- 科普主理人口播提案板
- 同一位 CG / 二次元 / 虚拟主理人连续镜头
- 信息图层、数据图层、产品图层、产业链图层叠加类大板

## 推荐版式

- 左侧信息区
- 右侧 2 行 4-6 列分镜格
- 底部横向收尾 KV

如果用户明确要求整板提案感，优先考虑：

- `brand_panel`
- `shot_1 ... shot_n`
- `kv_final`

## 模板变体

- `finance-explainer-board`: 财经、产业链、半导体、算力等解释型口播分镜板。
- `product-host-board`: 产品讲解、卖点拆解、主理人介绍型整板。
- `virtual-presenter-board`: CG、二次元、虚拟主理人连续出镜的提案板。

## 推荐 variant_axes

- `story_beat`
  - opening hook
  - logic breakdown
  - key answer reveal
  - scenario expansion
  - closing wrap-up

- `camera_language`
  - medium presenter shot
  - close explanation shot
  - information-led composite shot
  - full-body wrap-up shot

- `continuity_anchor`
  - same face
  - same outfit logic
  - same scene palette
  - same presenter identity

## 自动补全建议

- `lighting`
  - deep studio lighting
  - key-presenter glow
  - restrained highlight accents

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
- 把参考图机械平均分到所有格子
- 明明是口播分镜板，却做成品牌主KV海报
- 只有科技感或产品感，没有分镜板信息结构
- 中文字段全糊成装饰噪点
