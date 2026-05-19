# DAOGE 模板覆盖度复盘（第二轮）

## 复盘背景

在补完 `avatar-profile-pack`、`academic-figure-board`、`map-route-board` 之后，重新对：

- `references/template_registry_zh.json`
- `references/examples/examples.catalog.json`

做了一轮按 `template_id + template_variant` 的覆盖度盘点。

## 盘点结论

第二轮盘点前，真正剩余的缺口只剩 3 个：

1. `cinematic-storyboard.mood-sequence`
2. `illustrated-scene-set.minimalist-mood-scene`
3. `oral-storyboard-board.horizontal-board`

其中第 3 条不是“没做 example”，而是结构漂移：

- 注册表里已经使用 `horizontal-board`
- 但基准 example 和 catalog 里还保留旧命名 `product-host-board`

## 本轮处理

本轮完成后：

- 新增 `cinematic-storyboard-mood-sequence`
- 新增 `illustrated-scene-set-minimalist-mood-scene`
- 将 `oral-storyboard-board` 基准入口统一纠偏到 `horizontal-board`

## 当前状态

截至本轮结束：

- 注册表主链模板数：`22`
- catalog example 数：`79`
- 所有带显式 `variants` 的模板家族都已经做到：
  - `registry 变体数 = catalog 变体覆盖数`

当前仍然只有单一主入口、没有定义显式变体的家族是：

- `ecommerce-clean`
- `image-edit`
- `lookbook`
- `portrait-kv`
- `studio-editorial`

这 5 条不是缺口，而是当前注册表本身就没有定义额外 `variants`。

## 结论

第二轮覆盖度盘点后，当前模板谱系已经从“主链大体覆盖”进入“显式变体全覆盖”状态。

下一步不应再机械补 catalog 尾项，而应根据真实业务需求再决定：

1. 是否给单入口模板继续定义新的正式 `variants`
2. 是否继续扩更多行业化 starter / 子场景入口
3. 是否转回真实试运行和体验优化
