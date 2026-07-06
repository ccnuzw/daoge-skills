# DAOGE v2.0.1 真实任务验收报告

## 1. 测试时间和版本

- 测试时间：2026-07-06 16:20-16:52 CST
- 仓库：`/Users/apple/Progame/daoge/daoge-skills`
- 主 skill：`skills/interactive-image-batch`
- 包版本：`interactive-image-batch@2.0.1`，测试对象为当前工作区源码和本地 pack 产物，不是已发布远端包。
- 基线 commit：`575a36a82982c5e6ca74ffc25f8cbe3cea4b77c2`
- 工作区状态：dirty，包含本轮修复和验收文档；未提交。本报告的“已修复”和“建议发布”结论，只有在下列代码和测试变更与报告进入同一变更集时才可复现；若只提交报告文件，则只能视为本地未提交工作区验证记录。
- 本轮代码变更：
  - `skills/interactive-image-batch/src/shared/workspace.js`
  - `skills/interactive-image-batch/tests/unit/task_catalog.test.js`
- 隔离测试目录：`/Users/apple/Progame/daoge/daoge-goal45-real-validation`
- `.env` 文件：`/Users/apple/Progame/daoge/.env`

## 2. 环境配置

- `.env` 路径：`/Users/apple/Progame/daoge/.env`
- 已验证字段存在：`OPENAI_BASE_URL`、`OPENAI_API_KEY`
- 未打印、未记录任何 key 值。

## 3. 真实 provider 出图总数

- 真实 provider 成功出图：12 张
- provider：`gpt-image-2`
- 执行策略：`--batch-size 1 --concurrency 1 --retry-count 0`
- provider 失败：0

## 4. 测试任务摘要

| 编号 | 路径 | 命令摘要 | 输出目录 | 结果 |
| --- | --- | --- | --- | --- |
| T01 | 纯文本方图 | `prepare` + `execute --env-file /Users/apple/Progame/daoge/.env` | `/Users/apple/Progame/daoge/daoge-goal45-real-validation/out/t01_square` | 成功 2 |
| T02 | 纯文本竖图 | `prepare` + `execute --env-file /Users/apple/Progame/daoge/.env` | `/Users/apple/Progame/daoge/daoge-goal45-real-validation/out/t02_portrait` | 成功 2 |
| T03 | 纯文本横图 | `prepare` + `execute --env-file /Users/apple/Progame/daoge/.env` | `/Users/apple/Progame/daoge/daoge-goal45-real-validation/out/t03_landscape` | 成功 2 |
| T04 | 参考图生图 | `prepare` + `execute --env-file /Users/apple/Progame/daoge/.env` | `/Users/apple/Progame/daoge/daoge-goal45-real-validation/out/t04_reference` | 成功 1 |
| T05 | 遮罩局部修改 | `prepare` + `execute --env-file /Users/apple/Progame/daoge/.env` | `/Users/apple/Progame/daoge/daoge-goal45-real-validation/out/t05_mask_edit` | 成功 1 |
| T06 | storyboard 分镜板 | `prepare --prompts-file ...` + `execute --env-file /Users/apple/Progame/daoge/.env` | `/Users/apple/Progame/daoge/daoge-goal45-real-validation/out/t06_storyboard` | 成功 4 |
| T07 | host-native 成功+复核 | `ingest --prompt-pack-file ... --results-file ...` | `out/t07_host_success_review_after_fix` | 成功 1，复核 1 |
| T08 | host-native 失败 | `ingest --prompt-pack-file ... --results-file ...` | `out/t08_host_failed` | 失败 1，进入 issues |
| T09 | 缺失素材问题队列 | `prepare` + `execute --retry-count 0` | `out/t09_missing_material_after_fix` | 失败 1，进入 issues |
| T10 | rerun / failed-only | `rerun --resume-manifest ... --failed-only true --dry-run true` | `out/t10_rerun_failed_only` | 只选失败项 1 |
| T11 | 发布包 smoke | `npm pack` + 解包后运行 `prepare`、`execute --dry-run`、`ingest` | `package-smoke/*` | 通过 |

## 5. 成功项

- 方图、竖图、横图均真实出图成功。
- 参考图路径真实 provider 成功，参考素材进入 `assets/references`。
- 遮罩局部修改真实 provider 成功，参考图和 mask 分别进入对应资产目录。
- storyboard 4 张真实出图成功，结果保留 `shotLabel`、`slotId`、`frame` 命名信息，工作台五页生成。
- host-native ingest 成功导入相对路径输出；`success` 进 `assets/results`，`needs_review` 进 `assets/review`。
- host-native failed 进入 `assets/issues`，不假成功。
- 缺失素材任务 `prepare` 明确报缺失，真实 `execute` 不调用 provider，进入 `assets/issues` 和 `workspace/issues.html`。
- rerun failed-only 只补选失败项，`batchCount=1`，路径稳定。
- 每个任务均生成 `workspace/index.html`、`prepare.html`、`results.html`、`issues.html`、`record.html`。
- 每个任务均生成 `internal/execution_manifest.json`、`asset_library.json`、`workspace_state.json`。
- 发布包 smoke 从 tarball 解包运行通过，用户安装视角没有漏 CLI 或页面文件。

## 6. 发现的问题

### P1：无显式 title 的任务标题错误回落到目录类目

- 现象：host-native 和缺失素材任务的工作台标题、资产文件名显示为默认目录名 `人物主视觉`，不是用户任务 brief。
- 影响：用户会在 `assets/results`、`assets/review`、`assets/issues` 中看到错误业务标题，容易误解产物归属。
- 复现路径：`out/t07_host_success_review`、`out/t09_missing_material`。

## 7. 已修复的问题

### P1 修复：任务标题优先使用用户 brief

- 修改：`skills/interactive-image-batch/src/shared/workspace.js`
- 行为：`resolveTask()` 在没有显式 `title` 时，使用 `contentBrief` 或 `summary` 作为工作台任务标题；仅在没有用户输入时回落到 catalog 类目名。
- 测试：`skills/interactive-image-batch/tests/unit/task_catalog.test.js` 新增 `resolveTask uses user brief as task title when no explicit title is provided`。
- 修后验证：
  - `out/t07_host_success_review_after_fix` 文件名变为 `宿主侧成功和复核导入验证`。
  - `out/t09_missing_material_after_fix` issue 文件名变为 `缺失参考图路径验证，不应假成功`。

## 8. 暂缓问题

- 暂无 P0/P1 暂缓项。
- P2：发布包 smoke 只验证当前开发包 pack 产物，没有拉取远端已发布包对比。原因：当前目标是本地开发版修复后安装/解包 smoke；报告已记录包来源和版本。

## 9. 剩余风险

- 真实 provider 只覆盖小样本 12 张，不能代表高并发、大批量、长时间重试稳定性。
- provider 结果质量未做主观审美评分，本轮重点是执行链路和产物契约。
- 发布包版本号仍为 `2.0.1`，本地 pack 含未发布修复；若发布修复应升版。

## 10. 是否建议发布 v2.0.2

建议在提交本轮 P1 修复、单测和验收文档后，发布 `v2.0.2`。

理由：本轮发现并修复了 P1 用户可见标题/文件名错误；真实 provider 12 张核心路径成功，host-native、缺失素材、rerun、发布包 smoke 和全量测试均通过。当前包版本仍显示 `2.0.1`，且测试对象包含未提交修复；发布前必须提交这些变更并升版到 `2.0.2`。如果最终变更集只包含文档，不建议据此发布。

## 11. 验证命令

```bash
npm --prefix skills/interactive-image-batch run test:contracts
npm --prefix skills/interactive-image-batch run test:integration
npm --prefix skills/interactive-image-batch test
```

本地执行结果：通过。原始终端日志未纳入版本库文档，复核时应在包含上述代码和测试变更的工作区重新执行这些命令。
