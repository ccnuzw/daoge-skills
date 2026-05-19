# 棚拍大片模板

用于极简背景、摄影棚灯光、时尚编辑感和材质细节主导的人像任务。

## 适用范围

- 摄影棚人像
- 时尚编辑大片
- 灯光结构明确的品牌人物图
- 背景简洁、材质与姿态并重的任务

## 不适用范围

- 复杂场景叙事分镜
- 电商详情页拆解图
- 信息板式任务
- 主要依赖外景叙事氛围的任务

## 必问字段

- 背景颜色、材质或无缝纸设定
- 主光、轮廓光、补光方向
- 人物景别和姿态变化范围
- 服装材质与重点细节

## 推荐字段

- `lighting`
- `composition`
- `wardrobe`
- `mood`
- `camera_language`

## 模板变体

- `clean-fashion-editorial`: 干净时尚编辑感，强调背景纯净与服装质感。
- `high-contrast-studio`: 高对比棚拍，强调轮廓线和结构光。
- `soft-beauty-studio`: 柔光美感棚拍，强调皮肤和面料细腻度。
- `mono-backdrop-editorial`: 单色背景控制更强，强调主体轮廓和棚拍秩序。
- `motion-pose-studio`: 姿态与身体动态感更强，但仍维持棚拍控制和服装可读性。
- `couture-minimal-studio`: 极简高定棚拍，更强调面料秩序、轮廓和高端克制感。
- `gesture-sequence-studio`: 更强调手势和动作连续性的棚拍序列感。

## 推荐 variant_axes

- `lighting`: key light dominant, rim-lit contour, soft diffused studio glow
- `camera_language`: centered editorial, slight low-angle elongation, half-body clean crop
- `material_emphasis`: fabric texture, silhouette line, skin finish

## 自动补全建议

- `lighting`: soft premium studio light, directional rim light, controlled fill
- `mood`: editorial restraint, confident calm, polished minimalism
- `composition`: controlled studio framing with clean edges

## 强约束

- 灯光结构必须具体，不能只说“高级感”
- 面料、轮廓和姿态必须服务主体展示
- 背景要干净，但不能显得廉价或像临时棚布
- 如果有留白需求，必须提前在构图里说明

## 反模式

- 只写时尚感，不写灯光方向
- 姿态变化失控，导致服装或人物结构不可读
- 背景杂乱影响主体
- 多张图几乎同构图同姿态
