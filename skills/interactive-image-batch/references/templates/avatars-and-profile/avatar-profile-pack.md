# 头像资产包模板

用于头像、profile 资产、角色贴纸、系列化头像图和自拍风格迁移类任务。

## 适用范围

- 头像或 profile 图
- 系列化角色头像
- 贴纸包或表情资产
- 自拍风格迁移
- 主题化 3D icon / 头像资产

## 不适用范围

- 品牌肖像主视觉
- 棚拍大片
- 全身时尚 Lookbook
- 信息图、技术图或幻灯页

## 必问字段

- 这是头像、贴纸包、系列角色图还是风格迁移自拍
- 头像最终用在社媒、IM、频道封面还是产品资产
- 需要几张或几种角色状态
- 是否必须保持同一人物或同一角色 identity
- 裁切重点是头肩、半身还是头像圆形安全区

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `identity_policy`
- `crop_scale`
- `expression_set`
- `asset_usage`
- `background_depth`

## 模板变体

- `character-grid-portrait`: 系列角色头像栅格，强调同一角色多状态和一致性。
- `cultural-portrait-series`: 带文化主题的角色/人物头像系列，强调主题差异和身份统一。
- `sticker-set`: 贴纸或表情资产包，强调轮廓清晰、姿态夸张和小尺寸识别。
- `style-transfer-selfie`: 自拍风格迁移，强调保留身份锚点和风格转换。
- `themed-3d-icon`: 主题化 3D 头像 icon，强调小尺寸可读性和资产感。

## 推荐 variant_axes

- `asset_usage`: social profile, chat avatar, sticker pack, creator identity, themed icon
- `crop_scale`: circular-safe headshot, head-and-shoulders, half-body profile
- `expression_set`: neutral, smile, surprise, confident, playful
- `background_depth`: flat color, soft blur, minimal textured backdrop, transparent-style cutout

## 自动补全建议

- `lighting`: face-friendly soft key light, clean edge separation, avatar-safe contrast
- `composition`: centered avatar crop, circular-safe framing, sticker-pack silhouette clarity
- `mood`: approachable identity, crisp character clarity, collectible asset polish

## 强约束

- 核心是身份资产，不是海报
- 必须明确 identity 是否固定，以及裁切安全区
- 小尺寸可读性优先于复杂背景
- 贴纸或头像类任务不能被普通棚拍光影抢走主体

## 反模式

- 把头像资产写成品牌海报
- 多张系列图人物 identity 漂移
- 头像裁切不安全，容易切掉头顶或下巴
- 背景细节过多，缩小后主体不可读
