# DAOGE 模板覆盖度复盘（第三轮）

## 复盘背景

在完成以下几条单入口高价值模板的正式家族化之后：

- `portrait-kv`
- `studio-editorial`
- `lookbook`
- `ecommerce-clean`
- `image-edit`

重新对以下两份主链文件做了一轮按 `template_id + template_variant` 的覆盖度复盘：

- `skills/interactive-image-batch/references/template_registry_zh.json`
- `skills/interactive-image-batch/references/examples/examples.catalog.json`

本轮复盘的目标不是继续机械扫尾，而是判断：

1. 当前模板谱系是否已经进入“显式变体全覆盖”状态
2. 哪些家族已经可以封板
3. 哪些家族虽然已覆盖，但仍值得继续新增正式 `variants`

## 当前基线

截至本轮复盘：

- 注册表主链模板数：`22`
- catalog example 总数：`89`
- 显式 `variants` 家族覆盖状态：`22 / 22 全覆盖`

也就是：

- `registry 变体数 = catalog 变体覆盖数`
- 所有已定义显式 `variants` 的模板家族都已经补齐
- 当前不存在“注册表里定义了变体，但 catalog 里没补 example”的缺口

## 复盘结论

### 1. 结构层结论

当前模板谱系已经从：

- “主链模板基本可用”

进入到：

- “显式变体家族全部闭环”

这意味着下一步不该再做“缺哪个补哪个”的扫尾动作，因为这一类缺口已经清空。

### 2. 覆盖层结论

本轮复盘后，22 个主链模板的显式变体覆盖全部一致：

- `campaign-poster`: `4 / 4`
- `studio-editorial`: `3 / 3`
- `ecommerce-clean`: `3 / 3`
- `lookbook`: `3 / 3`
- `portrait-kv`: `3 / 3`
- `image-edit`: `3 / 3`
- `oral-storyboard-board`: `3 / 3`
- `cinematic-storyboard`: `4 / 4`
- `social-grid`: `4 / 4`
- `ab-ad-test`: `4 / 4`
- `detail-page-set`: `4 / 4`
- `ui-mockup-board`: `6 / 6`
- `infographic-board`: `6 / 6`
- `technical-diagram`: `7 / 7`
- `avatar-profile-pack`: `5 / 5`
- `visual-doc-slide`: `4 / 4`
- `academic-figure-board`: `5 / 5`
- `brand-packaging-board`: `5 / 5`
- `illustrated-scene-set`: `4 / 4`
- `map-route-board`: `5 / 5`
- `type-layout-poster`: `2 / 2`
- `asset-prop-sheet`: `2 / 2`

### 3. 难点层结论

本轮真正解决的不是“多写两个 example”，而是把几类常见模式问题压住了：

- 模板误判问题：
  - `lookbook-cover-and-range` 曾被 `ui-mockup-board` 误吸附
  - `image-edit-style-alignment-edit` 曾被 `studio-editorial` 误吸附
- 说明型模板 prompt 展开过薄的问题：
  - 技术图 / 信息图类曾出现短 prompt 或 duplicate
- onboarding 入口红灯问题：
  - 一批 starter / intent 示例曾因模板必填轴未回填而在 `prepare` 里进入红灯

这些根因都已经通过脚本和 smoke 覆盖住，不再只是“人工记得别犯”。

## 当前已可视为封板的家族

以下家族当前已经具备“主链 + 正式变体 + catalog 入口 + smoke + 真实 prepare 演练”完整闭环，后续可以视为封板，除非有真实业务需求再继续加：

- `ui-mockup-board`
- `infographic-board`
- `technical-diagram`
- `academic-figure-board`
- `brand-packaging-board`
- `map-route-board`
- `avatar-profile-pack`
- `campaign-poster`
- `ab-ad-test`
- `social-grid`
- `detail-page-set`
- `cinematic-storyboard`

这些家族当前已经足够像“成熟产品目录”，继续机械加量的收益会明显下降。

## 当前仍值得继续新增正式变体的家族

虽然本轮没有覆盖缺口，但以下家族的 `variantCount` 仍然偏低，属于“已闭环，但仍有扩展空间”的对象：

### 第一优先级

- `type-layout-poster`：`2`
- `asset-prop-sheet`：`2`

原因：

- 两条家族目前都偏“骨架已成、场景还薄”
- 都处在高频静态视觉主线里
- 扩一两个变体就能明显提升目录广度

### 第二优先级

- `ecommerce-clean`：`3`
- `image-edit`：`3`
- `lookbook`：`3`
- `portrait-kv`：`3`
- `studio-editorial`：`3`
- `oral-storyboard-board`：`3`

原因：

- 这些家族已经不是单入口，但仍然偏“刚完成家族化”
- 后续如果新增，应优先从真实业务使用里沉淀，而不是空想式扩展

## 当前各 tier 状态

### `core-commercial`

包含：

- `campaign-poster`
- `studio-editorial`
- `ecommerce-clean`
- `lookbook`
- `portrait-kv`
- `social-grid`
- `ab-ad-test`
- `detail-page-set`
- `brand-packaging-board`
- `type-layout-poster`

判断：

- 商业静态主线已经非常完整
- 下一步如果继续扩，优先做 `type-layout-poster`

### `identity-and-assets`

包含：

- `image-edit`
- `avatar-profile-pack`
- `asset-prop-sheet`

判断：

- `avatar-profile-pack` 已经很完整
- 下一步更值得扩的是 `asset-prop-sheet`

### `narrative-and-board`

包含：

- `oral-storyboard-board`
- `cinematic-storyboard`
- `illustrated-scene-set`

判断：

- 分镜和叙事链当前已经够深
- 除非要进入行业 starter 新一轮扩展，否则可以暂时封板

### `interface-and-information`

包含：

- `ui-mockup-board`
- `infographic-board`
- `technical-diagram`
- `visual-doc-slide`
- `academic-figure-board`
- `map-route-board`

判断：

- 说明型和信息型主线已经很完整
- 除非有真实业务反馈，否则不建议继续在这条线平均铺量

## 推荐下一阶段

本轮复盘后的建议不是继续“扫缺口”，而是转成二选一：

### 方向 A：继续新增正式 `variants`

如果要继续扩模板谱系，建议优先顺序：

1. `type-layout-poster`
2. `asset-prop-sheet`
3. `image-edit`

原因：

- 它们是当前变体数最低、且仍有明显业务空间的家族

### 方向 B：转入真实业务试运行

如果目标是提高产品真实可用度，而不是继续扩目录，建议：

1. 从 `89` 个 catalog 入口中挑选代表任务
2. 按真实业务 brief 跑 `catalog -> quickstart -> prepare`
3. 记录哪些目录项值得升格成新的正式 `variants`

## 本轮结论

第三轮覆盖度复盘后，可以明确给出结论：

当前 `interactive-image-batch` 的模板谱系已经进入：

- **显式变体全覆盖**
- **主链目录稳定期**
- **下一步应由“缺口驱动”转向“价值驱动”**

也就是说，后续是否继续扩，不再看“还有没有没补”，而要看：

- 哪个家族继续扩最值
- 哪个家族已经够了
- 哪个新变体是真实业务会用到的
