> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第六阶段肖像与棚拍模板家族化计划

## 目标

把当前仍然是“单入口主链”的两条高价值人物模板：

1. `portrait-kv`
2. `studio-editorial`

正式升级为带显式 `variants` 的模板家族，而不是只在模板文档里口头定义变体。

## 变体范围

### `portrait-kv`

- `editorial-closeup`
- `brand-portrait-kv`
- `soft-character-focus`

其中 `brand-portrait-kv` 沿用现有基准 example，新增其余两个变体入口。

### `studio-editorial`

- `clean-fashion-editorial`
- `high-contrast-studio`
- `soft-beauty-studio`

其中 `clean-fashion-editorial` 沿用现有基准 example，新增其余两个变体入口。

## 范围

本批只做：

- 注册表补 `variants`
- 新增 4 个 example
- catalog 接入
- README / examples README 更新
- smoke 覆盖
- 真实 `prepare` 演练

## 交付物

- `references/template_registry_zh.json`
- `references/examples/portraits-and-characters/portrait_kv.editorial_closeup.example.json`
- `references/examples/portraits-and-characters/portrait_kv.soft_character_focus.example.json`
- `references/examples/portraits-and-characters/studio_editorial.high_contrast_studio.example.json`
- `references/examples/portraits-and-characters/studio_editorial.soft_beauty_studio.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. `portrait-kv` 与 `studio-editorial` 在注册表中具备正式 `variants`
2. 4 个新入口出现在 catalog 和 HTML catalog
3. 4 条入口实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
5. 覆盖度复查中两条家族不再属于“单入口模板”
6. 全量 smoke 通过

## 收益

本批完成后，人物商业静态主线会更完整：

- `portrait-kv` 从单入口升级为 3 变体家族
- `studio-editorial` 从单入口升级为 3 变体家族

这两条会成为后续继续扩 `lookbook / ecommerce-clean / image-edit` 之前的标准模板。
