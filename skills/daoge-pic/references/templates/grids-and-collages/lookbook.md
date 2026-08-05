# Lookbook 模板

用于系列服装轮换、场景节奏控制和统一视觉系统下的多张组图任务。

## 适用范围

- 系列 Lookbook
- 多款式轮换展示
- 同一模特或同一系列的统一拍摄系统
- 展示与氛围并存的组图任务

## 不适用范围

- 单张主视觉海报
- 电商详情页卖点拆解
- 连续剧情分镜
- 需要强信息板式结构的任务

## 必问字段

- 系列款式数量和差异点
- 是否同一模特保持一致
- 场景统一还是分章节变化
- 每张图偏展示、氛围还是封面

## 推荐字段

- `style_family`
- `scene`
- `wardrobe`
- `composition`
- `variation_requirements`
- `camera_language`

## 模板变体

- `series-unified`: 同一系列统一风格，重点是连续性。
- `chapter-lookbook`: 分章节场景切换，但保持系列逻辑。
- `cover-and-range`: 少量封面图加大量稳定展示图。
- `chapter-scene-progressive`: 章节推进更强，场景和系列节奏成段递进。
- `multi-outfit-commercial`: 多款式商业展示更强，重点在换装可读性和商业一致性。
- `editorial-pairing-lookbook`: 成对 editorial 组图更强，强调双图关系和节奏互文。
- `lookbook-detail-mix`: 整身和细节混排，强调搭配完整性和材质结构可读性。

## 推荐 variant_axes

- `lookbook_role`: cover, showcase, atmosphere bridge, chapter opener
- `camera_language`: front editorial, walking turn, side silhouette, seated still
- `scene_rhythm`: neutral interior, architectural edge, soft lifestyle, minimal backdrop

## 自动补全建议

- `lighting`: consistent editorial soft light, controlled rim, subtle environment tone
- `mood`: premium continuity, quiet confidence, collection rhythm
- `composition`: consistent series framing with controlled variation

## 强约束

- 每张图必须体现款式差异或系列角色差异
- 同系列的镜头语言和色彩系统不能完全漂移
- 姿态变化必须服务服装展示
- 不要让背景或姿态遮住关键服装结构

## 反模式

- 只换场景不换款式
- 同批视觉系统完全漂移
- 服装细节被姿态或道具挡住
- 每张图都像独立海报，失去系列关系
