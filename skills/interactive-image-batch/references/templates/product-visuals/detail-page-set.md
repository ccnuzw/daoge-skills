# 详情页组图模板

用于电商详情页、卖点拆解、材质细节、主图和场景图组合。

## 必问字段

- 详情页总张数
- 每张图对应的卖点
- 是否需要局部特写、穿着场景、包装或平铺
- 平台尺寸和安全区
- 是否统一背景、模特或商品角度

## 模板变体

- `hero-plus-details`: 主图 + 多张细节图。
- `benefit-breakdown`: 每张图讲一个卖点。
- `fit-and-material`: 版型和材质展示。
- `lifestyle-proof`: 使用场景证明图。

## 推荐 variant_axes

- `detail_page_role`: hero product image, material close detail, fit demonstration, lifestyle use case
- `benefit_angle`: comfort, support, invisible fit, premium fabric
- `shot_scale`: full-body, three-quarter, close detail, flat lay
- `layout_zone`: top-copy-safe, side-label-safe, clean center product

## 自动补全建议

- `text_policy`: leave label and copy-safe space, do not generate readable text
- `lighting`: clean commercial softbox light, material-readable highlights
- `composition`: product-first ecommerce composition

## 反模式

- 所有图都是同一种主图
- 详情页没有卖点分工
- 背景和道具抢商品
- 材质和版型不可读
