# 详情页组图模板

用于电商详情页、卖点拆解、材质细节、主图和场景图组合。

## 适用范围

- 电商详情页组图
- 卖点拆解图
- 材质与版型说明图
- 主图 + 细节 + 场景证明的组合任务

## 不适用范围

- 单张主 KV 海报
- 连续叙事分镜
- 口播板式任务
- 只做纯白底 SKU 图但没有组图结构的任务

## 必问字段

- 详情页总张数
- 每张图对应的卖点
- 是否需要局部特写、穿着场景、包装或平铺
- 平台尺寸和安全区
- 是否统一背景、模特或商品角度

## 推荐字段

- `detail_page_role`
- `benefit_angle`
- `text_policy`
- `composition`
- `variation_requirements`
- `scene`

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

## 强约束

- 每张图必须承担明确卖点角色，不能全部做成主图
- 商品结构、材质和版型必须可读
- 留白和标注区要服务后续排版，不生成可读文案
- 场景图不能牺牲商品本体可见性

## 反模式

- 所有图都是同一种主图
- 详情页没有卖点分工
- 背景和道具抢商品
- 材质和版型不可读
