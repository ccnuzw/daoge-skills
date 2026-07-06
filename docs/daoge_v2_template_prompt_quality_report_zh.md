# DAOGE v2 模板与 Prompt 质量优化完成报告

日期：2026-07-06

## 结论

Goal 7 已完成。自然语言 brief 识别、模板匹配、默认 prompt 生成、标题命名和尺寸语义已从“偏人像兜底”改为“按用户任务画像生成”。

本轮不调用真实 provider。验证以 `prepare`、unit、integration、contracts、artifacts 和 smoke 为准。

## 已完成改动

- `inferTaskId` 改为加权关键词识别，结合 `task_catalog_zh.json` 和 `template_registry_zh.json` 触发词。
- `task_catalog_zh.json` 增补常见用户任务：电商、包装、社媒、头像、技术流程图、信息图、地图、UI mockup、学术图、排版海报、图像编辑等。
- `prompt_builder` 改为任务画像驱动，生成结构包含用途、主体、场景、视觉重点、光线、构图、风格、文字策略和约束。
- 非人物任务不再输出 `wardrobe` 字段，也不再默认注入 `portrait`、人物造型、手部和解剖类负面词。
- `variation_requirements` 按条分发到不同 prompt，避免每条 prompt 都塞同一组差异要求。
- `width` / `height` 与 brief 中的横图、竖图、方图、banner、短视频封面等语义会影响构图描述。
- prompt 标题从用户 brief 摘取短句，保留用户任务语义。

## 验证矩阵

详见审计文件：`docs/daoge_v2_template_prompt_quality_audit_zh.md`。

已覆盖 20 类自然语言 brief：

- 产品主图、电商详情页、包装礼盒、品牌视觉
- campaign 海报、社媒九宫格、头像/profile、人像棚拍
- storyboard、口播分镜、技术流程图、信息图
- 地图路线、UI mockup、学术图、字体排版海报
- 图像局部修改、参考图风格迁移、横图 banner、竖版短视频封面

修复后 20 类均未回落到错误 `portrait` 兜底。

## 已验证命令

```bash
git diff --check
npm --prefix skills/interactive-image-batch run test:unit
npm --prefix skills/interactive-image-batch run test:contracts
npm --prefix skills/interactive-image-batch run test:integration
npm --prefix skills/interactive-image-batch run test:artifacts
npm --prefix skills/interactive-image-batch run test:smoke
```

本轮 review 时以上命令均通过。

## 剩余风险

- 真实 provider 对中文结构化 prompt 的表现仍需后续小样本实测。
- registry 内仍有作者侧字段；当前测试已确保这些内部词不进入普通用户页面和生成 prompt。
- 更细的行业模板排序还可继续优化，但当前用户路径已避免大面积误判到人像任务。
