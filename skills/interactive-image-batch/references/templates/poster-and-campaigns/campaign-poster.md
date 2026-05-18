# 品牌海报模板

用于联名款、主 KV、Campaign 延展、时尚广告和竖版主视觉。

## 适用范围

- 联名主 KV
- 品牌主视觉海报
- 人物或产品导向的 Campaign 海报
- 同一视觉系统下的延展海报

## 不适用范围

- 详情页卖点拆解图
- 纯电商白底主图
- 连续叙事型电影分镜
- 口播分镜板或信息板式任务

## 必问字段

- 品牌或联名关系
- 海报投放比例和尺寸
- 主体是人物、商品还是人物+商品
- 是否预留 logo、标题、slogan、CTA 或安全区
- 必须出现或必须避免的视觉元素

## 推荐字段

- `content_brief`
- `output_mode`
- `style_requirements`
- `text_policy`
- `variation_requirements`
- `camera_language`
- `commercial_role`

## 模板变体

- `co-brand-kv`: 联名主 KV，强调双方品牌调性、强主视觉、后期文字安全区。
- `product-hero`: 产品主视觉，强调商品可读性、材质、卖点、商业转化。
- `people-hero`: 人物主视觉，强调眼神、姿态、品牌气质和主体压迫感。
- `campaign-extension`: Campaign 延展图，强调同一视觉系统下的多场景扩展。

## 推荐 variant_axes

- `camera_language`: 正面主视觉、回身动态、低角度长身线、建筑线条透视。
- `commercial_role`: 主 KV、卖点图、氛围图、延展图、社媒封面。
- `material_emphasis`: 哑光面料、缝线细节、轮廓线、版型支撑。
- `lighting`: 轮廓光、柔和主光、窗边自然光、建筑阴影。

## 自动补全建议

- `lighting`: soft premium studio light, directional rim light, diffused window light
- `mood`: expensive restraint, calm luxury, editorial confidence
- `camera_language`: full-body vertical hero framing, typography-safe poster composition

## 强约束

- 必须写清这是海报或主视觉，而不是普通写真
- 必须给出主体层级和留白逻辑
- 主体裁切规则必须可控，不能高概率裁掉脚、手或商品关键结构
- 文字安全区只描述留白，不让模型直接生成可读文字

## 反模式

- 写成普通写真而不是广告海报
- 没有场景层级或文字安全区
- 生成可读品牌 logo 或伪文字
- 全身海报裁掉脚、手或商品关键结构
