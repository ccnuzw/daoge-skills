# 图像编辑模板

用于已有图片基础上的改背景、改服装、局部修正、参考增强和安全边界明确的编辑任务。

## 适用范围

- 保留主体、替换背景
- 局部重绘或局部修正
- 在原图基础上做风格校正
- 使用上一轮输出继续修图

## 不适用范围

- 从零生成的纯文生图任务
- 不提供保留规则的“大改重画”
- 需要整批策略分发的系列任务
- 口播板或分镜整板装配任务

## 必问字段

- 原图路径或参考图来源
- 需要保留的主体和区域
- 需要修改的局部边界
- 修改后的目标风格
- 是否允许整体重绘

## 推荐字段

- `reference_images`
- `mask_image`
- `negative_prompt`
- `text_policy`
- `continuity_notes`

## 模板变体

- `background-replacement`: 保主体、换背景。
- `localized-fix`: 局部修正，强调边界安全。
- `style-alignment-edit`: 在原图基础上统一新风格。

## 推荐 variant_axes

- `edit_scope`: global-safe edit, local masked edit, background-only edit
- `preserve_priority`: identity, silhouette, material texture, light direction
- `change_target`: background, wardrobe detail, object cleanup, tone correction

## 自动补全建议

- `consistency_rules`: preserve original geometry, light direction, and texture continuity
- `quality_constraints`: seamless edit boundary, no identity drift, no texture warping
- `text_policy`: preserve layout-safe blank areas when the original composition already has them

## 强约束

- 必须明确“保留什么”和“改什么”
- 局部编辑任务必须有边界意识，最好配遮罩或明确区域描述
- 新区域要与原图光线、透视、材质匹配
- 没有用户授权时，不要把局部编辑扩大成整体重绘

## 反模式

- 没有保留规则就做大幅重绘
- 编辑边界模糊或穿帮
- 修改区域光线与原图不一致
- 复用上一轮输出时绑定错了底图
