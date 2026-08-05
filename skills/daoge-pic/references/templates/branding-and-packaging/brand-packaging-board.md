# 品牌包装板模板

用于品牌识别板、包装设计板、饮料标签、化妆品包装、角色周边和 mascot brand kit。

## 适用范围

- 品牌识别板
- 包装概念板
- 饮料 / 美妆 / 消费品包装视觉
- mascot brand kit
- character merch board

## 不适用范围

- 单张品牌海报
- 纯详情页卖点图
- 纯头像资产
- 技术图或学术图

## 必问字段

- 这是品牌系统板、包装板、标签设计还是 mascot 周边板
- 主要载体是什么：瓶身、盒装、标签、套组、品牌板
- 更强调品牌语义、包装结构，还是周边资产统一性
- 文字策略是标志留位、包装标签留位还是后期替换
- 是否需要多视角、多包装状态或多资产并排

## 推荐字段

- `content_brief`
- `style_requirements`
- `text_policy`
- `packaging_format`
- `brand_asset_scope`
- `material_signal`
- `shelf_presence`
- `merch_role`

## 模板变体

- `beverage-label-design`: 饮料标签或瓶身视觉。
- `brand-identity-board`: 品牌系统板。
- `character-merch-board`: 角色周边板。
- `cosmetic-packaging`: 美妆包装视觉。
- `gift-box-campaign-packaging`: 礼盒活动包装板。
- `full-mascot-brand-doc`: mascot 品牌系统页。
- `mascot-brand-kit`: mascot 资产组合板。
- `seasonal-limited-packaging`: 季节限定包装板。

## 推荐 variant_axes

- `packaging_format`: label-first, box packaging, bottle packaging, kit board, merch board
- `brand_asset_scope`: packaging only, identity board, mascot system, merch lineup
- `material_signal`: matte paper, glossy label, translucent bottle, premium carton
- `shelf_presence`: minimal premium, colorful retail, collectible merch, clean cosmetic

## 自动补全建议

- `lighting`: packaging-readable soft light, shelf-safe highlights, material clarity
- `composition`: brand board spread, packaging lineup display, label-safe product framing
- `mood`: branded coherence, premium packaging polish, collectible system clarity

## 强约束

- 必须明确载体和品牌板目标
- 包装结构和材质信号必须可读
- 文字策略只保留安全区，不交给模型自由生成完整包装文案
- 多资产并排时要说明主次和统一性

## 反模式

- 把包装板写成海报
- 只有品牌气质，没有包装载体
- 包装材质不可读
- 多资产板缺少统一系统感
