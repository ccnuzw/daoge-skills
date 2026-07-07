# 模板选择指南

DAOGE 模板多时，先用目录筛选，再看示例和预览规则。

## 快速查找

看推荐和常用模板：

```bash
node scripts/daoge.js catalog --recommended true
```

按类别筛选：

```bash
node scripts/daoge.js catalog --category product-visuals
node scripts/daoge.js catalog --category cinematic-sequences
node scripts/daoge.js catalog --category editing-workflows
```

按关键词搜索：

```bash
node scripts/daoge.js catalog --keyword 电商
node scripts/daoge.js catalog --keyword 口播
node scripts/daoge.js catalog --keyword 技术流程图
```

返回字段：

- `category`：模板类别。
- `tags`：触发词、风格族、层级、关键适用点。
- `scenarios`：适合追问或补充的需求字段。
- `description`：简短说明。
- `variants`：可组合的变体方向。
- `preview`：构图倾向、质量规则、反模式。
- `exampleParams`：示例参数和可跑示例文件。

## 选择顺序

1. 先按成品类型选类别：海报、电商图、详情页、分镜、口播、UI、信息图、技术图、地图、包装、头像、改图。
2. 再按输入材料选模板：无参考图用文生图模板，有产品、人像或局部修改就优先看支持参考图或编辑流程的模板。
3. 再按变体选风格：同一个模板内用 `variants` 控制镜头、版式、卖点或场景变化。
4. 最后看 `preview.antiPatterns`，避免把任务写成模板明确反对的形态。

## 组合复用

常见组合：

- `campaign-poster` + `type-layout-poster`：先做主视觉，再做排版安全版本。
- `ecommerce-clean` + `detail-page-set`：先做平台主图，再扩展卖点详情页。
- `studio-editorial` + `portrait-kv`：先做棚拍素材，再扩展人物主 KV。
- `cinematic-storyboard` + `oral-storyboard-board`：先定镜头叙事，再做口播画面板。
- `image-edit` + 任意商业模板：先修参考图，再进入批量扩展。

复用方式：

- 保留同一份 `content_brief` 的核心主体描述。
- 替换 `output_mode` 让模板导向不同成品。
- 用 `style_requirements` 固定风格，用 `variation_requirements` 扩展差异。
- 小样先跑 `total_count=2` 到 `6`，确认后再扩大数量。

## 推荐起点

- 品牌主视觉：`campaign-poster`
- 商品主图：`ecommerce-clean`
- 详情页：`detail-page-set`
- 棚拍人像：`studio-editorial`
- 参考图修改：`image-edit`
- 短片分镜：`cinematic-storyboard`
- 口播分镜：`oral-storyboard-board`
- UI 画面：`ui-mockup-board`
- 技术图解：`technical-diagram`

## 示例流程

先找模板：

```bash
node scripts/daoge.js catalog --keyword 商品主图
```

选中后写 `task_spec.json`：

```json
{
  "content_brief": "无糖气泡水电商商品主图，白底平台安全区，突出清爽、低糖、细长罐体",
  "output_mode": "ecommerce product visual",
  "style_requirements": ["clean packshot", "platform safe area", "premium refreshment"],
  "variation_requirements": ["正面主图", "斜侧角度", "冰块水珠版本"],
  "total_count": 3,
  "batch_size": 1,
  "width": 1440,
  "height": 1440
}
```

准备并预览：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
open out/workspace/index.html
```
