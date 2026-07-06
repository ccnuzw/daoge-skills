> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第六阶段图像编辑家族化计划

## 目标

把当前仍是单入口主链的 `image-edit` 升级成带正式 `variants` 的模板家族。

## 变体范围

- `background-replacement`
- `localized-fix`
- `style-alignment-edit`

其中 `background-replacement` 沿用现有基准 example，新增其余两个变体入口。

## 范围

本批只做：

- 注册表补 `variants`
- 新增 2 个 example
- catalog 接入
- README / examples README 更新
- smoke 覆盖
- 真实 `prepare` 演练

## 交付物

- `references/template_registry_zh.json`
- `references/examples/editing-workflows/image_edit.localized_fix.example.json`
- `references/examples/editing-workflows/image_edit.style_alignment_edit.example.json`
- `references/examples/examples.catalog.json`
- `references/examples/README.md`
- `README.md`
- `tests/smoke.test.js`

## 验证要求

1. `image-edit` 在注册表中具备正式 `variants`
2. 两个新入口出现在 catalog 和 HTML catalog
3. 两条入口实际跑通 `catalog -> quickstart -> prepare`
4. 对应 `prompt_validation_report.json` 满足：
   - `duplicatePromptCount: 0`
   - `qualityGates.ok: true`
5. 覆盖度复查中 `image-edit` 不再属于单入口模板
6. 全量 smoke 通过

## 收益

本批完成后，当前这轮重点单入口高价值模板将基本收口，后续可以从“继续造家族”切回“真实业务试运行和新增模板谱系”。 
