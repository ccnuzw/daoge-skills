# 状态模型与角色分离

本文件是 SKILL.md 的**按需**附录：层级状态矩阵、谁能写什么、以及「创作物由谁创建」的边界。
动手写计划、预检、入队、交付之前读一遍即可，不必每次启动都读。

## 最小状态与角色矩阵

| 层级 | 权威状态 / 事实 | 可写入角色 | 是否触发 Provider | 不变量 |
| --- | --- | --- | --- | --- |
| Studio Session | `agentProjectId` / `agentTaskId` / `agentRoundId`（**Agent 的工作指针**） | Agent Bearer（Workbench 的选中态由路由承载，不再写这里） | 否 | 浏览器标签身份不等于 Agent conversation；每个真实 conversation 使用独立 Studio Session。 |
| Project / Task | project `active` / `archived`；task `draft` / `active` / `completed` / `archived` | Agent Bearer 或 Workbench Cookie | 否 | 创建只写 Studio API/SQLite；项目模板默认值来自 `/api/project-templates` 后端注册表。 |
| Round | `draft` / `awaiting_confirmation` / `active` / `completed` / `archived` | `draft` 可由 Agent 或 Workbench 补上下文；确认后由 Agent 流程推进 | 否 | 新方向新建轮次；已确认或运行中的轮次不能由 Workbench 直接改参考上下文。 |
| Plan version | `draft` / `awaiting_confirmation` / `confirmed` | Agent Bearer 写入；Workbench Cookie 只提交确认挑战 | 否 | `plan` 是计划写入，不是旧 `prepare`；确认只激活当前计划，不预检、不入队。 |
| Preflight / Run | dry-run preview；run `queued` / `running` / `paused` / `resume_pending` / `partial` / `completed` / `failed` / `cancelled` 等 | Agent Bearer | `preflight` 否；`run` 是 | 绑定 session、conversation、plan hash、Provider 快照和并发；每轮只允许一个 Generation Run。 |
| Run Item | `pending` / `leased` / `requesting` / `receiving` / `persisting` / `succeeded` / `retry_wait` / `blocked` / `cancel_requested` / `cancelled` / `outcome_unknown` / `failed` | Worker 与 Agent 控制命令 | 请求中是 | `outcome_unknown` 必须先由用户核实并 `resolve-unknown` 结案；未结案不可重试，结案后可在原运行内重试。 |
| Delivery | `draft` / `ready` / `exported` | Workbench Cookie 或受控 CLI | 否 | 准备冻结选片来源与评审，导出创建冻结图片实体；不存在公开 `delivery-complete` CLI。 |

角色分离必须保持：Workbench Cookie 可做可视管理和人工确认，并可对运行执行**止损**动作（暂停 / 取消，不花钱、减少支出）；Agent Bearer 才能执行预检、入队、恢复、重试和 unknown 结案；Worker 只处理已入队运行项。任何 UI、缓存、SSE 或文件夹状态都不是业务事实源。

## 创作物由谁创建

- Studio 直接创建项目、任务、轮次或草稿参考素材，只写 Studio API/SQLite 事实源和草稿上下文；不得生成计划确认、预检、Generation Run 或 Provider 调用。
- Workbench 可基于当前项目或明确共享素材创建 `variation`、`refinement`、`edit`、`fill` 草稿轮次；该动作仍不得绕过 Agent 计划确认。