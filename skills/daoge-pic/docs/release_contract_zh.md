# DAOGE 发布契约

本文定义发布后必须保持稳定的用户契约。未列入本文件的 `internal/` 和 `debug/` 内容视为内部实现细节，可在同步测试后调整。

## 稳定 CLI 入口

唯一对外入口：

```bash
node scripts/daoge.js prepare
node scripts/daoge.js execute
node scripts/daoge.js ingest
node scripts/daoge.js rerun
node scripts/daoge.js review
```

不保留旧脚本入口或双入口。新增、删除、改名命令前，必须同步 `tests/contracts/release_contracts.test.js`。

## 稳定输入文件

- `task_spec.json`：任务说明、数量、尺寸、素材说明。
- `prompt_strategy.json`：可选策略输入。
- `prompts.generated.json` 或同结构提示词文件：可执行提示词列表。
- `host_native_results.json`：宿主原生图像工具回填结果，字段为 `index`、`title`、`requestMode`、`status`，可选 `slotId`、`shotLabel`、`scene`、`composition`、`textPolicy`、`styleFamily`、`slotRole`；`success` 和 `needs_review` 必须有 `output`，相对 `output` 路径按结果文件所在目录解析。
- `.env`：本地执行所需 OpenAI 配置。

## 稳定输出文件

普通用户稳定页面：

- `workspace/index.html`
- `workspace/prepare.html`
- `workspace/results.html`
- `workspace/issues.html`
- `workspace/record.html`

稳定 debug 文件：

- `debug/prompts.generated.json`

核心机器契约：

- `internal/run_plan.json`
- `internal/execution_manifest.json`
- `internal/issue_queue.json`
- `internal/asset_library.json`
- `internal/workspace_state.json`
- `internal/view_models/*.json`

## 稳定状态枚举

结果状态：

- `success`
- `failed`
- `needs_review`
- `skipped`

问题类型：

- `hard_failure`
- `needs_review`
- `rerun_candidate`
- `ignored`
- `resolved`

问题处理状态：

- `open`
- `ignored`
- `resolved`

用户资产关键状态包括：

- `ready_for_run`
- `ready_for_review`
- `ready_for_selection`
- `needs_review`
- `needs_attention`
- `recommended_first_pass`
- `user_selected`
- `deliverable_candidate`
- `waiting_for_user_selection`
- `report_ready`

## 状态落点

- 成功结果进入 `assets/results/`，并可进入 `assets/selected/` 和 `assets/exports/selected_images/`。
- 待复核结果进入 `assets/review/`。
- 失败结果进入 `assets/issues/`。
- 成功或待复核但文件缺失的结果进入 `assets/issues/`，并进入问题队列。
- 普通用户从 `workspace/index.html` 开始，页面再导向准备、结果、问题或记录页。

## 不稳定内部区域

以下内容可随实现调整，不作为用户契约：

- `internal/` 内除核心契约字段外的派生字段。
- `internal/view_models/*.json` 的页面展示细节。
- `debug/` 内除 `debug/prompts.generated.json` 外的诊断文件。
- `assets/` 内文件名中的中文标题和序号格式。
- provider 内部请求参数、批次目录、临时文件。

## 修改契约必须同步

维护者修改以下内容时，必须同步测试：

- CLI 命令集合：`tests/contracts/release_contracts.test.js`。
- 用户路径或旧路径清理：`tests/contracts/release_contracts.test.js`、`tests/artifacts/generated_pages.test.js`。
- 核心契约字段：对应 `tests/contracts/*.schema.test.js`。
- 状态枚举：`tests/contracts/release_contracts.test.js` 和对应 schema 测试。
- host-native 导入：`tests/contracts/release_contracts.test.js`、`tests/integration/host_native_flow.test.js`。
- 状态落点：`tests/contracts/release_contracts.test.js` 和相关集成测试。
