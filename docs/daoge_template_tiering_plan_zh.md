# DAOGE 模板分级显性化计划

## 目标

把当前 16 个主链模板的隐性层次关系，升级成注册表、文档和报告里都能直接看到的显式结构。

这一步的目标不是新增模板，而是让后续维护者可以直接回答：

1. 哪些是核心商业图模板
2. 哪些是资产型模板
3. 哪些是页面/文档型模板
4. 哪些是叙事或板式模板

## 为什么现在要做

当前模板主链已经从最初 11 个扩展到 16 个。

如果没有显式分级，后续会出现几个问题：

- 新模板该挂到哪一层只能靠维护者记忆
- README 和报告里只看得到 `category`，看不到“职责级别”
- `template_registry_zh.json` 会逐渐变成平铺列表，扩容越多越难读
- 新人会把“资产模板”和“海报模板”当成同一层东西看待

所以这一步本质上是给模板体系补“信息架构”。

## 建议的显式结构

在注册表中为每个模板补两个元信息字段：

- `tier`
- `family`

### tier

表示模板所处的职责层级。

建议值：

1. `core-commercial`
   - 直接服务商业视觉主线
   - 如海报、详情页、棚拍、社媒投放
2. `narrative-and-board`
   - 直接服务分镜、整板、序列叙事
3. `interface-and-information`
   - 直接服务 UI、信息图、技术图、文档页
4. `identity-and-assets`
   - 直接服务头像、贴纸、角色资产、编辑型资产

### family

表示模板的功能家族，用于在同一 tier 内继续聚类。

例如：

- `brand-visual`
- `portrait-fashion`
- `product-commerce`
- `social-performance`
- `storyboard-sequence`
- `ui-interface`
- `information-design`
- `technical-explainer`
- `identity-assets`
- `visual-docs`
- `editing-ops`

## 当前 16 个模板的建议归类

### core-commercial

- `campaign-poster` -> `brand-visual`
- `studio-editorial` -> `portrait-fashion`
- `portrait-kv` -> `portrait-fashion`
- `ecommerce-clean` -> `product-commerce`
- `detail-page-set` -> `product-commerce`
- `social-grid` -> `social-performance`
- `ab-ad-test` -> `social-performance`
- `lookbook` -> `brand-visual`

### narrative-and-board

- `oral-storyboard-board` -> `storyboard-sequence`
- `cinematic-storyboard` -> `storyboard-sequence`

### interface-and-information

- `ui-mockup-board` -> `ui-interface`
- `infographic-board` -> `information-design`
- `technical-diagram` -> `technical-explainer`
- `visual-doc-slide` -> `visual-docs`

### identity-and-assets

- `avatar-profile-pack` -> `identity-assets`
- `image-edit` -> `editing-ops`

说明：

- `image-edit` 从纯“执行型”角度看也可以单列，但当前数量太少，先放到 `identity-and-assets` 这一层作为资产修订类更实用
- 如果后续编辑工作流模板扩容，再考虑单独拆出 `editing-and-ops`

## 需要同步修改的层

本次至少需要同步修改：

1. `references/template_registry_zh.json`
2. `references/template_authoring_zh.md`
3. `scripts/validate_template_registry.js`
4. `scripts/render_template_registry_report.js`
5. `README.md`

## 变更原则

1. `tier` 和 `family` 都应该进入模板主链校验，不允许只写部分模板
2. 报告中必须能看到 tier 分布和 family 分布
3. README 中至少要把模板按 tier 分组展示一次
4. 模板规范文档必须解释：
   - `category` 是目录分类
   - `tier` 是职责层级
   - `family` 是维护家族

## 完成标准

满足以下条件才算完成：

1. 16 个模板全部带 `tier` 与 `family`
2. 主链校验通过
3. 模板报告能展示 tier / family
4. README 中已按模板层级重排模板列表
5. smoke 和统一入口全绿
