# 肖像主视觉模板

用于近景、半身、头肩构图等由人物气质和眼神主导的品牌主视觉任务。

## 适用范围

- 近景品牌主视觉
- 半身或头肩人物海报
- 气质导向的人物视觉
- 以眼神、表情和光线层次取胜的任务

## 不适用范围

- 全身服装 Lookbook
- 电商详情页
- 连续叙事分镜
- 强信息布局板式任务

## 必问字段

- 人物气质和表情方向
- 近景、半身还是头肩构图
- 背景氛围与品牌调性
- 是否需要标题留白

## 推荐字段

- `lighting`
- `mood`
- `composition`
- `eye_language`
- `text_policy`

## 模板变体

- `editorial-closeup`: 近景编辑感主视觉。
- `brand-portrait-kv`: 品牌海报式肖像主视觉。
- `soft-character-focus`: 柔和人物气质导向，弱化背景存在感。

## 推荐 variant_axes

- `eye_language`: direct confidence, soft distance, restrained introspection
- `crop_scale`: head-and-shoulders, half-body, tight portrait crop
- `background_depth`: clean blur, soft texture, minimal tonal field

## 自动补全建议

- `lighting`: face-led directional key light, soft fill, restrained background falloff
- `mood`: concentrated presence, premium calm, controlled emotional tension
- `composition`: face-led key visual with controlled headroom

## 强约束

- 表情和眼神必须具体，不接受空泛“好看”
- 背景只能服务人物，不能抢戏
- 光线必须保护脸部层次和眼神可读性
- 留白需求要在构图阶段显式说明

## 反模式

- 只写美感，不写表情方向
- 背景过重削弱肖像集中度
- 多张图眼神和表情几乎完全一样
- 过度磨皮或假人感皮肤
