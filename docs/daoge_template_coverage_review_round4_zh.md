# DAOGE 模板覆盖度复盘（第四轮）

## 复盘背景

在完成以下三条家族的继续扩展之后：

- `type-layout-poster`
- `asset-prop-sheet`
- `image-edit`

重新对当前模板主链和 catalog 入口做了一轮价值导向复盘。

本轮复盘不再回答“还有没有缺口”，而是回答：

1. 现在的模板谱系已经扩到什么程度
2. 哪些家族应该正式进入封板状态
3. 如果还要继续扩，下一批最值的是谁

## 当前基线

截至 **2026-05-19**：

- 注册表主链模板数：`22`
- catalog example 总数：`95`
- 显式 `variants` 家族覆盖状态：`22 / 22 全覆盖`

也就是：

- 所有定义了正式 `variants` 的模板家族，都已经做到 `registry = catalog = smoke`
- 当前不存在“注册表定义了变体，但 catalog 或 example 没补齐”的结构缺口

## 结构结论

当前模板体系已经进入一个新的阶段：

- 不是“补大类”
- 不是“补主链”
- 也不是“补漏掉的显式变体”

而是进入：

- **价值驱动的家族深化阶段**

后续是否继续扩，不该看“还能不能加”，而该看“加哪条最值”。

## 当前家族状态

### 已达到高成熟度，可视为封板

以下家族当前已经足够成熟，继续机械扩量的收益明显下降：

- `technical-diagram`：`7`
- `ui-mockup-board`：`6`
- `infographic-board`：`6`
- `academic-figure-board`：`5`
- `brand-packaging-board`：`5`
- `avatar-profile-pack`：`5`
- `map-route-board`：`5`
- `image-edit`：`5`
- `cinematic-storyboard`：`4`
- `campaign-poster`：`4`
- `social-grid`：`4`
- `ab-ad-test`：`4`
- `detail-page-set`：`4`
- `visual-doc-slide`：`4`
- `type-layout-poster`：`4`
- `asset-prop-sheet`：`4`
- `illustrated-scene-set`：`4`

这些家族已经具备：

- 主链模板
- 正式变体
- catalog 入口
- smoke 覆盖
- 真实 `prepare` 演练

继续扩它们，应该有明确业务需求，而不是为了数字增长。

### 中成熟度，仍有继续扩展价值

以下家族仍然只有 `3` 个正式变体，属于“已经家族化，但还在可深化区间”的对象：

- `ecommerce-clean`
- `lookbook`
- `oral-storyboard-board`
- `portrait-kv`
- `studio-editorial`

这 5 条现在是下一阶段最值得讨论的对象。

## 按家族价值判断的下一批优先级

### 第一优先级：`ecommerce-clean`

原因：

- 当前 `product-commerce` 这条家族里：
  - `detail-page-set` 已有 `4`
  - `ecommerce-clean` 只有 `3`
- 电商主图本身的真实业务频率高
- 它继续扩一到两个正式变体，收益会明显高于继续补人物摄影类

建议方向：

- 更偏“纯白极简 / 氛围场景 / 材质强调”之外的商业高频主图入口
- 重点还是围绕：
  - 商品结构可读
  - 材质差异
  - 背景控制
  - 电商点击感

### 第二优先级：`portrait-kv` 和 `studio-editorial`

原因：

- 当前 `portrait-fashion` 家族由两条模板组成：
  - `portrait-kv`
  - `studio-editorial`
- 两者都只有 `3`
- 这条线虽然商业价值高，但如果继续扩，必须避免和 `campaign-poster` 重叠

判断：

- 可以继续扩
- 但必须以“人物视觉角色”区分，而不是再造模糊的人像海报词

### 第三优先级：`lookbook`

原因：

- `brand-visual` 家族里：
  - `campaign-poster` 已经 `4`
  - `lookbook` 还是 `3`
- 它还有扩的空间，但真实业务频率通常低于电商主图和人物主视觉

判断：

- 值得扩
- 但优先级低于 `ecommerce-clean` 和 `portrait-fashion`

### 第四优先级：`oral-storyboard-board`

原因：

- 当前分镜链已经相对完整
- `cinematic-storyboard` 已有 `4`
- `oral-storyboard-board` 虽然只有 `3`，但已经具备：
  - 基准横版
  - 主持人导向
  - 行业导向

判断：

- 继续扩不是不行
- 但它已经不再是当前最值的补点

## 按 family 的整体判断

### `product-commerce`

- `ecommerce-clean`: `3`
- `detail-page-set`: `4`

结论：

- 当前最值得继续深化的 family
- 下一批优先从这里开始是合理的

### `portrait-fashion`

- `studio-editorial`: `3`
- `portrait-kv`: `3`

结论：

- 第二值得继续深化
- 但要严防和 `campaign-poster` 的语义重叠

### `brand-visual`

- `campaign-poster`: `4`
- `lookbook`: `3`

结论：

- 仍可扩，但不是当前第一优先级

### `storyboard-sequence`

- `oral-storyboard-board`: `3`
- `cinematic-storyboard`: `4`

结论：

- 当前已够深
- 除非出现新行业 starter 需求，否则可以暂缓

## 推荐下一步

如果继续扩正式 `variants`，我建议新的顺序改成：

1. `ecommerce-clean`
2. `portrait-kv`
3. `studio-editorial`
4. `lookbook`
5. `oral-storyboard-board`

## 本轮结论

第四轮复盘后的核心判断是：

- 结构性缺口已经清空
- 低变体数家族的第一轮补强也已经完成
- 下一阶段应该从“平均扩张”切到“商业价值优先”

一句话总结：

**下一批最值得补的，不是再补说明型或资产型，而是回到 `product-commerce`，先扩 `ecommerce-clean`。**
