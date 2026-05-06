# 社媒九宫格模板

用于小红书、Instagram、品牌 Feed、九宫格和系列内容矩阵。

## 必问字段

- 需要 3、6、9 还是更多张
- 每张图的社媒角色
- 是否统一色彩、背景、模特或商品
- 平台比例和裁切规则
- 是否预留标题、贴纸或信息区

## 模板变体

- `nine-grid-launch`: 九宫格上新发布。
- `cover-detail-mood`: 封面、细节、氛围三段式。
- `ugc-polished`: 高级 UGC 风格，但保留商业可控性。
- `brand-feed-system`: 品牌 Feed 统一视觉系统。

## 推荐 variant_axes

- `grid_role`: cover tile, material detail tile, lifestyle mood tile, product benefit tile
- `crop_safety`: square-safe, vertical-safe, center-safe
- `palette_role`: hero contrast, muted neutral, warm lifestyle
- `content_density`: clean cover, medium detail, rich context

## 自动补全建议

- `text_policy`: leave clean social caption or sticker-safe space, no readable generated text
- `composition`: square-crop-safe vertical composition
- `mood`: premium social editorial, approachable but polished

## 反模式

- 九张图只是随机拼图
- 没有封面、细节、氛围角色差异
- 色彩系统漂移
- 主体裁切后不可读
