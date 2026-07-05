# DAOGE 生图任务助手 v2 架构

v2 把工作流从“程序产物导航”改为“用户任务助手”。用户入口只回答当前任务、当前阶段、现在要做什么、为什么这么做，以及下一句可以怎么说。

## 分层

- `workspace/`: 普通用户主入口，只放五个页面：`index.html`、`prepare.html`、`results.html`、`issues.html`、`record.html`。
- `assets/`: 用户能理解和管理的素材库，包含输入、参考、遮罩、结果、已选、复核、问题、交付和归档。
- `internal/`: 程序状态层，包含运行计划、执行记录、问题队列、资产库、唯一工作台状态和页面视图模型。
- `debug/`: 维护排查层，放提示词、检测报告、旧适配记录和维护者诊断材料。

## 状态源

`internal/workspace_state.json` 是唯一产品状态源。五个页面的 `primaryAction`、`secondaryActions`、`replySuggestions` 和 `nextBestStep` 都从这里派生。用户旅程判断集中在 `scripts/build_user_journey_decision.js`，只读取 `run_plan`、`execution_manifest`、`issue_queue` 和 `asset_library`。渲染器只读取 `internal/view_models/*.json`，不读取旧运行记录做业务判断。

## 原生主流程

准备阶段直接生成：

- `internal/run_plan.json`
- `internal/asset_library.json`
- `internal/workspace_state.json`
- `internal/view_models/index.json`
- `internal/view_models/prepare.json`
- `workspace/index.html`
- `workspace/prepare.html`
- `assets/inputs/`
- `assets/references/`
- `assets/masks/`

执行阶段和宿主回填阶段直接生成：

- `internal/execution_manifest.json`
- `internal/issue_queue.json`
- `internal/asset_library.json`
- `internal/workspace_state.json`
- `internal/view_models/results.json`
- `internal/view_models/issues.json`
- `internal/view_models/record.json`
- `workspace/results.html`
- `workspace/issues.html`
- `workspace/record.html`
- `assets/results/`
- `assets/review/`
- `assets/issues/`
- `assets/selected/`
- `assets/exports/`
- `assets/archive/`

`scripts/refresh_workspace_v2.js` 是 v2 总装配器。它可以读取执行器留下的兼容记录，但页面事实源必须是 `internal/` 下的 v2 契约和 `internal/view_models/*.json`。

## 产物契约

- `internal/run_plan.json`: 准备阶段的任务计划、提示词计划、素材需求和开跑判断。
- `internal/execution_manifest.json`: 执行阶段的真实结果、批次、成功失败、执行来源和耗时信息。
- `internal/issue_queue.json`: 统一问题队列，覆盖硬失败、待复核、补跑候选、已忽略和已解决。
- `internal/asset_library.json`: 用户资产库，所有用户可见资产都必须有 `userTitle`、`userStatus`、`userPurpose`、`userAction`、`lifecycleStatus` 和 `sourceReason`。
- `internal/view_models/*.json`: 页面唯一输入。

## 资产生命周期

`internal/asset_library.json` 纳管所有用户资产。每个资产至少包含：

- `id`
- `kind`
- `userTitle`
- `userStatus`
- `userPurpose`
- `userAction`
- `lifecycleStatus`
- `sourceReason`
- `path`
- `group`
- `usage.canSelect`
- `usage.needsReview`
- `usage.hasIssue`
- `usage.canExport`
- `relationships`
- `source.stage`

动作契约：

- `id`
- `label`
- `intent`
- `href` 或 `targetPage`
- `reply`
- `reason`
- `enabled`
- `disabledReason`
- `riskLevel`

每页只展示一个主动作，可展示 2-3 个次动作。动作原因必须说明为什么现在做这一步。

目录含义：

- `assets/inputs/`: 用户原始输入、任务说明和提示词文档。
- `assets/references/`: 按人物参考、风格参考、场景参考、产品参考整理。
- `assets/masks/`: 局部修改范围。
- `assets/results/`: 所有生成结果，人类可读命名。
- `assets/review/`: 建议复核结果。
- `assets/issues/`: 失败说明、补跑建议和错误摘要。
- `assets/selected/`: 用户选中、系统建议优先看的候选，或等待用户选择的占位；不会无脑复制所有成功图。
- `assets/exports/`: 可交付候选、交付图和交付清单报告。
- `assets/archive/`: 历史过程和非主路径资产。

## 问题决策

`internal/issue_queue.json` 支持五类问题：

- `hard_failure`: 必须处理。
- `needs_review`: 建议人工确认。
- `rerun_candidate`: 值得补跑。
- `ignored`: 可忽略。
- `resolved`: 已处理。

失败不默认等于补跑。只有存在用户原因时才生成补跑候选，例如关键镜头失败、用户要求数量不足、可交付不足。待复核不阻塞，主动作回结果页。存在阻塞硬失败时，主动作进入问题页。

每个问题项都包含 `userImpact`、`recommendedAction`、`availableActions` 和 `resolutionState`。问题页按必须处理、建议确认、值得补跑、已忽略、已处理展示处理闭环。

## 页面原则

每页只有一个主动作。工程维护词汇只能留在 `internal/` 或 `debug/`，普通用户页面不展示模板、运行清单、注册表、执行时、产物或槽位等程序概念。

## 旧兼容

旧执行器仍会短暂生成少量运行记录以支持 provider 能力、续跑和诊断。v2 总装配器会把这些文件复制到 `debug/compat/` 后，从用户主路径删除。

仍保留在维护层的兼容文件包括：

- `manifest.json`
- `batch_plan.json`
- `stage_plan.json`
- `job_state.json`
- `checkpoint.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `rerun_candidates.json`

保留原因：`run_batch_executor`、`run_batch_transport`、失败续跑和历史诊断仍依赖这些结构。它们不能作为 `workspace/` 页面事实源。
