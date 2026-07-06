> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE Example Quickstart 计划

## 目标

把 `references/examples/*/*.example.json` 从“参考文件”推进成“最小可执行入口”。

具体来说：

- 输入一个模板 example JSON
- 自动生成最小 `task_spec.json`
- 自动生成最小 `prompt_strategy.json`
- 产物可以直接喂给现有的：
  - `validate_task_spec.js`
  - `validate_prompt_strategy.js`
  - 后续也可以接 `daoge.js prepare`

## 为什么现在做

当前 examples 已经补到 5 个新增大类，但仍然主要承担“阅读参考”职责。

如果不再往前推进，会出现两个问题：

1. 维护者还是要手工从 example 抄到 `task_spec` / `prompt_strategy`
2. examples 是否真的可用，只能靠肉眼判断

所以这一步的核心价值是让 examples 进入真实工作流。

## 范围

第一版不做全自动 prompt 生成，只做“最小前置产物生成”：

1. `task_spec.quickstart.json`
2. `prompt_strategy.quickstart.json`

不直接做：

- `prompt_slots.json`
- `prompt_draft_bundle.json`
- `prompts.generated.json`

因为前两步先打通后，后面的生成链已经由现有脚本负责。

## 输入约定

当前 example JSON 已经包含这些字段：

- `template_id`
- `template_variant`
- `content_brief`
- `output_mode`
- `style_requirements`
- `variation_requirements`
- `text_policy`
- `sample_variant_axes`

第一版脚本将把它们映射为：

### task_spec

- `content_brief`
- `output_mode`
- `style_requirements`
- `source_files`
- `total_count`
- `batch_size`
- `concurrency`
- `retry_count`
- `timeout_seconds`
- `width`
- `height`
- `variation_requirements`
- `text_policy`
- `preview_count`
- `require_confirmation`
- `run_label`

### prompt_strategy

- `content_brief`
- `output_mode`
- `total_count`
- `batch_size`
- `variation_requirements`
- `style_families`
- `scene_pool`
- `wardrobe_pool`
- `composition_pool`
- `text_policy`
- `negative_policy`
- `variation_rules`
- `template_variant`
- `variant_axes`

## 第一版默认策略

为了保证脚本足够稳，第一版采用统一默认：

- `total_count = 4`
- `batch_size = 2`
- `concurrency = 2`
- `retry_count = 1`
- `timeout_seconds = 450`
- `width = 1440`
- `height = 2560`
- `preview_count = 4`
- `require_confirmation = true`

并基于 example 内容生成一组最小策略池：

- `style_families`
  - 默认 2 个 family，按 example 的 `template_variant` 和 `template_id` 生成
- `scene_pool`
  - 从 `style_requirements` 和 `sample_variant_axes` 中提炼
- `wardrobe_pool`
  - 若无明确人物/服装语义，则给安全占位值
- `composition_pool`
  - 根据 `template_id` 给模板型默认值

## 脚本建议

新增脚本：

- `scripts/build_example_quickstart.js`

建议参数：

- `--example-file`
- `--output-dir`

输出文件：

- `<output-dir>/task_spec.quickstart.json`
- `<output-dir>/prompt_strategy.quickstart.json`

## 验证要求

完成后至少验证：

1. 用 1 个 example 跑脚本成功
2. 生成的 `task_spec.quickstart.json` 可通过 `validate_task_spec.js`
3. 生成的 `prompt_strategy.quickstart.json` 可通过 `validate_prompt_strategy.js`
4. smoke 覆盖至少 1 条 example quickstart 测试

## 完成标准

满足以下条件才算完成：

1. `build_example_quickstart.js` 可运行
2. 输入新增 example JSON 可生成最小产物
3. 生成产物能通过现有校验脚本
4. README 或 examples README 中有 quickstart 入口说明
