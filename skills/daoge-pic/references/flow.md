# 确认之后到收图

SKILL.md 的「会话工作法」只保留 1–4 条（澄清 → 计划 → 未经确认不得外部调用）。本文件是第 5 步之后的完整流程。

## 确认之后

5. Workbench 完成确认后，先读取当前会话计划摘要和 Generation History。若当前轮次已有运行，必须显式选择并汇报该运行，不得再次预检或入队；没有运行时才执行预检。
6. 预检证据仍与计划和 daemon 内存配置匹配时，才创建该轮次唯一运行。用户要求再次生成时新建衍生轮次，不复用原轮次创建第二批。
7. 用会话汇报状态、异常与恢复选择；Workbench 用于查看实时结果、Generation History、导入素材、保留/复核/淘汰、回收、恢复和交付。

## 两条省回合的命令

- `round-status --round <round-id> --session <session-id>`：一次返回计划摘要 + Generation History + 运行计数，替代「先读 plan-status 再读 runs」两次调用。
- `plan --round <round-id> --version <n> --plan @- --session <session-id> --challenge true`：写入计划的同时创建 Workbench 确认挑战，替代「plan → confirm-challenge」两次调用。`--challenge true` 必须配 `--session`。

## 事实端点

- 当前会话计划摘要：`GET /api/sessions/<session-id>/plan-status`
- 当前轮次 Generation History：`GET /api/rounds/<round-id>/runs`
- 失败处理、重试与恢复边界见 `references/recovery.md`；交付、导出与冻结批次见 `references/delivery.md`；层级状态与「谁能写什么」见 `references/state-model.md`。

## 不许做

不得把用户需求写成遗留 JSON 任务文件，不得扫描目录推断业务状态，不得直接写 SQLite、manifest、journal、运行文件或 SSE 状态。

## v6：少花回合的默认动作

- **`round-status`（一次读全）**：默认回 `round` 状态、`confirmation` 窗口、`challenge` 窗口、`latestRun`、`tally`（逐状态张数）与 `runs`（历史，不含计划正文）。会话还没绑批次时用 `--round` 显式读到的详情兜底，不会只回 null。
- **`wait`（唯一等待动词）**：`daoge wait --round <id> [--timeout <秒>] [--interval <秒>] [--until terminal|first-success]`。它按 `/api/events` 的窗口 cursor 唤醒、按 round detail 取权威状态；终态是 `completed`/`failed`/`cancelled`/`partial`，超时回**真实状态**并带 `timedOut: true`（不谎报终态）。
- **`run --auto-preflight true --session <id>`**：先预检再入队。预检仍真实发生并留下 dry-run 记录，`confirm_token` 仍由 daemon 签发并绑定 `plan_hash + preflight_id + conversation_id`；只是不必手动传两个 id。加 `--wait true` 连等待一起做掉。
- **读结构**：`task-list --project`、`round-list --task`、`round-detail --round`（含 tally）、`run-items --run [--status a,b] [--page/--page-size]` —— 都用投影，不必再拉全表。
- **失败与恢复**照 `references/recovery.md`；`wait` 超时不是错误，是你自己决定继续等、重试还是结单。
