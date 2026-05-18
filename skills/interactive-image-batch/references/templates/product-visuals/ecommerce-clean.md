# 电商纯净图模板

用于商品或服装可读性优先、背景干净、转化导向明确的电商主图任务。

## 适用范围

- 电商主图
- 商品纯净展示图
- 轻场景但仍以商品可读性为核心的图
- 平台安全区要求明确的主图任务

## 不适用范围

- 详情页多角色组图
- 电影感叙事海报
- 口播信息板
- 重氛围压过商品结构的艺术图

## 必问字段

- 商品或服装核心卖点
- 背景是纯白、浅灰还是轻场景
- 是否需要多角度、细节或平铺
- 是否需要电商平台安全区

## 推荐字段

- `scene`
- `composition`
- `text_policy`
- `lighting`
- `benefit_angle`

## 模板变体

- `white-clean-hero`: 白底或浅底主图，最稳的商品展示路径。
- `soft-scene-commerce`: 轻场景电商图，增加少量环境但不抢主体。
- `material-focus-commerce`: 材质和做工细节优先的商品图。

## 推荐 variant_axes

- `shot_scale`: full product hero, three-quarter display, close material detail
- `background_cleanliness`: pure white, soft gray, restrained lifestyle hint
- `benefit_angle`: structure clarity, fabric detail, silhouette readability

## 自动补全建议

- `lighting`: clean commercial soft light, material-readable highlights
- `composition`: stable product-first composition
- `text_policy`: leave copy-safe space, no readable generated text

## 强约束

- 商品结构必须清楚，不能为氛围牺牲可读性
- 背景和道具只能辅助，不能抢主角
- 颜色和材质要接近真实商业展示
- 有安全区要求时，构图必须预留

## 反模式

- 背景比商品更醒目
- 色彩过饱和影响真实质感
- 商品轮廓、面料或关键结构不可读
- 误做成海报感大片而非电商主图
