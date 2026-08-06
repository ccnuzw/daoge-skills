---
doc_id: DAOGE-GOAL-001
status: active
owner: daoge-docs
updated: 2026-08-06
authority: 编程智能体大型任务准备、执行、恢复与完成契约
---

# 编程智能体 Goal 执行契约

## 1. 目的

本文定义如何把已冻结的 DAOGE Docs 权威文档转换为可恢复、可停止、可验证的大型开发任务。目标不是让智能体自由解释一组文档，而是生成一份确定的派生执行清单，使每一步都能回到版本、功能、需求、验收项、稳定分支、验证命令和证据。

Goal 清单是执行输入，不是新的业务权威。需求、设计或决策发生变化时，必须先修改对应权威文档并重新生成清单，不能直接修改 Goal 清单来绕过文档治理。

## 2. 职责边界

| 参与者 | 职责 |
| --- | --- |
| 权威文档 | 定义目标、范围、业务语义、设计约束、AC、稳定分支和发布要求 |
| DAOGE Docs 工具 | 解析权威、检查门禁、生成清单、计算摘要、验证恢复条件 |
| 开发者 | 选择 Goal 范围，确认高风险决策、例外和外部副作用 |
| 编程智能体 | 只在清单授权内实现、验证、保存检查点，命中停止条件时停止 |
| 机器证据 | 证明命令、退出码、环境、提交、构建和检查结果 |
| 开发执行工作台 | 向开发者显示就绪结论、阻塞和来源，不直接运行 Goal |

浏览器中的“可开始开发”不等于 Goal 已经运行；智能体输出“完成”也不等于 Goal 已通过验证。

## 3. 清单位置与不可变身份

每个 Goal 使用独立目录：

```text
.daoge-docs/goals/<GOAL-ID>/
├── goal-manifest.json
├── checkpoints/
└── evidence/
```

`goal-manifest.json` 由工具生成。`GOAL-ID` 创建后不得复用。清单至少绑定：

- 生成清单时的 `source_commit`。
- 权威文档集合的 `authority_digest`。
- DAOGE Docs `tool_version` 和 `schema_version`。
- 目标版本、功能、需求、AC、稳定分支和决策 ID。
- 有序任务图及其允许修改路径。

开发者或智能体不得手工把 `blocked`、`stale` 或 `verification_failed` 改成 `ready` 或 `completed`。

## 4. Goal 清单结构

顶层最小结构：

```json
{
  "schema_version": 1,
  "goal_id": "GOAL-V1-001",
  "status": "prepared",
  "objective": "完成 CODE-FR-001 并取得开发级证据",
  "version": "V1",
  "feature_ids": ["CODE-FR-001"],
  "requirement_ids": ["CODE-FR-001", "CODE-NFR-001"],
  "decision_ids": ["DEC-001"],
  "scope": [],
  "non_goals": [],
  "allowed_paths": [],
  "forbidden_actions": [],
  "authority_digest": "sha256:...",
  "source_commit": "...",
  "tool_version": "...",
  "ordered_tasks": [],
  "verification_commands": [],
  "evidence_requirements": [],
  "stop_conditions": [],
  "checkpoints": []
}
```

摘要、提交或路径为空时不得进入 `ready`。稳定 ID 必须能在当前派生实体和追踪关系中唯一解析。

## 5. 单项任务契约

`ordered_tasks[]` 中每项任务至少包含：

```text
task_id / title / objective / status / sequence
dependencies / inputs / requirement_ids / acceptance_ids / branch_ids
allowed_paths / forbidden_paths / implementation_constraints
verification_commands / evidence_requirements / completion_conditions
stop_conditions / checkpoint_policy
```

规则如下：

1. `objective` 只描述一个可验证结果，不能使用“完善相关逻辑”等开放措辞。
2. `inputs` 必须引用权威路径、章节和稳定 ID；不得只附一份长上下文摘要。
3. `allowed_paths` 使用已解析的仓库相对路径，不能使用 `/`、`~`、未展开变量或不受控广域 glob。
4. `forbidden_paths` 由功能 front matter 派生，表示该路径及其子路径禁止当前任务修改；它必须使用同样的仓库相对路径格式，不能与 `allowed_paths` 或其父子路径重叠。
5. 每项任务至少映射一个 AC 或明确的技术完成条件。
6. 关键业务路径必须映射稳定分支 ID；没有分支设计时保持阻塞。
7. 验证命令必须声明工作目录、超时、预期退出码和证据输出路径。
8. 完成条件必须能由文件差异、命令结果或机器证据判定，不能只依赖智能体自述。

## 6. 准备与就绪判定

按固定顺序准备 Goal：

1. 运行 `index` 和 `check`，取得当前实体、关系、finding 和 authority digest。
2. 解析目标版本、功能和需求，拒绝不存在、重复、废弃或权威冲突的 ID。
3. 检查对应 `version-ready` 和全部 `feature-ready` 门禁。
4. 收集范围、非目标、设计分支、AC、实现落点、依赖、验证和证据要求。
5. 检查路径授权、任务依赖图、迁移顺序和外部副作用。
6. 生成确定的拓扑顺序，并计算清单摘要。
7. 无阻塞时进入 `ready`；否则进入 `blocked` 并记录 finding ID 和恢复动作。

同一 `source_commit`、`authority_digest`、工具版本和 Goal 选择必须产生语义相同的任务图。生成时间、绝对路径等环境字段不得参与语义排序。

## 7. 版本与迭代边界

一个 Goal 只实现一个已通过门禁的目标版本切片。MVP、V1、V2、V3 使用连续但独立的 Goal，不把多个版本的规划一次性交给智能体实现。

- 当前 Goal 只包含目标版本明确承诺的功能和退出条件。
- 后续版本里程碑只作为依赖背景和 `non_goals`，不能自动转为当前任务。
- 当前 Goal 完成后的代码、测试和证据成为下一版本调研与门禁输入，不自动批准下一版本。
- 跨版本兼容或迁移必须由 ADR/冻结决策明确授权，并拆成有序任务和独立检查点。
- 版本范围变化后旧 Goal 进入 `stale`，从更新后的版本权威重新准备。

快速迭代来自小而完整的闭环：冻结一个切片、执行一个 Goal、取得证据、更新实现状态，再准备下一切片；不能通过减少 AC、跳过门禁或提前实现未来范围换取速度。

## 8. 状态机

| 状态 | 含义 | 允许的下一状态 |
| --- | --- | --- |
| `prepared` | 已生成清单，尚未完成全部前置检查 | `blocked`、`ready`、`aborted` |
| `blocked` | 门禁、权威、依赖、路径或业务输入不完整 | `prepared`、`aborted` |
| `ready` | 前置条件通过，尚未开始修改代码 | `running`、`stale`、`aborted` |
| `running` | 正按任务图执行 | `verification_failed`、`stale`、`completed`、`aborted` |
| `stale` | 权威或执行基线已变化，禁止继续恢复 | `aborted` |
| `verification_failed` | 实现已产生，但指定验证未通过 | `running`、`stale`、`aborted` |
| `completed` | 全部任务、验证和证据检查通过 | 终态 |
| `aborted` | 人工终止或清单不再使用 | 终态 |

`stale` Goal 不原地刷新。必须保留旧清单用于审计，并从当前权威重新创建新 Goal ID。

`completed` 是不可逆历史事实。后续版本、权威文档或工具发生变化时，完成记录显示为 `historical`，但不能把已经通过且防篡改的完成记录改写成 `stale`；检查器仍须验证最终提交位于当前 Git 历史、检查点链和证据摘要完整。

## 9. 串行、并行和集成顺序

默认串行执行。只有同时满足以下条件的任务才允许并行：

- 互相没有依赖关系。
- `allowed_paths` 不重叠，也不修改同一生成制品的来源。
- 不修改同一迁移序列、数据库对象、API 契约或共享状态机。
- 不操作同一外部服务、队列、秘密、账号或部署环境。
- 合并顺序不会改变行为，且各自验证可以独立完成。

任务图必须显式标出集成任务。迁移与约束、领域规则、应用事务、接口、前端、可观测性、测试和证据存在依赖时，使用确定的拓扑顺序，不能让智能体自行选择方便的先后关系。

## 10. 停止条件

命中任一条件时立即停止受影响任务，不猜测、不扩展范围：

- 发现权威冲突、缺失业务语义或新的产品决策。
- 当前 authority digest 与清单不一致。
- 首次运行时 HEAD 不等于 `source_commit`；恢复时 HEAD 不等于已登记检查点。
- 出现未登记提交、无法解释的工作区变更或路径超出授权范围。
- 需要破坏性迁移、不可逆删除或未批准的数据修复。
- 权限、资金、秘密、并发、外部副作用或未知结果语义未冻结。
- 指定验证失败且修复需要改变 AC、设计或非目标。
- 依赖接口、环境、构建或证据与清单绑定不一致。
- 任务图出现循环依赖、并行路径冲突或恢复点损坏。

停止后必须记录事实、受影响 ID、最后成功检查点和建议恢复动作，不得把失败改写为跳过。

## 11. 检查点与恢复

检查点只在一个原子任务完成且其局部验证通过后建立，至少记录：

```text
checkpoint_id / task_id / commit / parent_commit
authority_digest / changed_paths / commands / exit_codes
evidence_paths / created_at / tool_version
```

恢复前重新计算 authority digest，并验证当前 HEAD、父子提交、已改路径和证据摘要。只有完全匹配最近检查点时才能从下一个待办任务继续；不能依赖聊天历史、浏览器本地状态或智能体记忆恢复。

执行期间 HEAD 可以从初始 `source_commit` 前进到已登记的检查点提交，但初始基线不可被替换。出现清单外提交时进入 `stale`。

## 12. 验证与完成

Goal 进入 `completed` 前必须同时满足：

1. 全部必需任务均为 `completed`，且不存在未解决阻塞。
2. 所有 AC、稳定分支和需求追踪仍闭合。
3. 清单指定的静态、单元、Integration/Contract、前端、E2E、性能或安全验证按风险执行。
4. 命令、退出码、环境、提交和证据路径均已记录。
5. 最终 authority digest 与清单一致，最终提交可追溯到 `source_commit`。
6. `check` 和对应开发门禁重新执行且通过。

开发级 Goal 完成不代表允许发布。Release 仍必须绑定不可变构建、发布级环境、四类有效证据和人工批准。

## 13. 工具接口与实现状态

`daoge-docs 3.14.2` 已实现完整的开发级 Goal 生命周期。功能 front matter 引用的 ADR 必须已处于 `accepted`，否则检查、Ready 门禁和 Goal 都保持 `blocked`；同一缺口必须派生为工作台 finding。验收表中的 Markdown 行内代码会在派生 Goal 前规范化为原始 shell 命令。工作台可为一个稳定功能 ID 复制 Goal 准备提示，但该提示不是执行授权：它只能要求智能体调用 `prepare-goal`，在 `blocked` 时停止，并在 `ready` 后读取 `goal-resume-context`；实现必须由开发者明确确认后才开始。项目功能浏览和时间线可以读取 `project_features[]` 中的历史版本，但 Goal 仍只从 `config.current_version` 的执行 `features[]` 生成，历史功能不得进入任务图、授权路径或 Gate 输入。

```text
prepare-goal         已实现：从选定版本和功能生成 Goal 清单
goal-status          已实现：检查清单防篡改、阻塞、权威摘要、Git 基线和过期状态
goal-resume-context  已实现：只在恢复条件通过时输出唯一下一任务上下文
goal-checkpoint      已实现：检查提交、路径和命令后写入原子检查点与独立证据
goal-complete        已实现：复验任务、命令、证据、docs-check 和 Ready 门禁后结束 Goal
install-integrations 已实现：安装不覆盖现有配置的 CI、PR、IDE 与智能体入口
```

这些命令复用 `index`、`gate`、`authority-digest`、任务包和证据模型，不建立第二套门禁或追踪算法。每次验证尝试写入独立证据文件，失败批次不会被重试覆盖；检查点、完成记录和命令证据都带内容摘要，任何不一致都会拒绝恢复。

标准执行顺序固定为：

```text
prepare-goal
  -> goal-resume-context
  -> 实现并提交当前任务
  -> goal-checkpoint
  -> 重复恢复、实现、提交、检查点
  -> goal-complete
```

`goal-checkpoint` 必须紧跟当前任务提交执行。若中断发生在检查点之前，恢复命令会拒绝未登记 HEAD；开发者应先明确处置未登记提交，不能把它自动登记为成功。Goal 托管文件和派生文档可以随 PR 提交，但不计入业务路径授权；其他工程路径仍必须落在当前任务 `allowed_paths` 内。

## 14. 验收标准

- 相同输入重复生成时，任务 ID、顺序、依赖和授权路径一致。
- 任一权威文档变化后，旧 Goal 能确定地进入 `stale`。
- 没有通过 Feature Ready 的功能不能生成 `ready` Goal。
- 任一任务都能从 AC 或分支追踪到实现路径、命令和证据。
- 并行任务没有路径、迁移、契约、共享状态或外部副作用冲突。
- 中断后仅凭清单和检查点即可恢复，不依赖对话上下文。
- 没有真实命令和证据时，任何主体都不能把 Goal 标记为 `completed`。
