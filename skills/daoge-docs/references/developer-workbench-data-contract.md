---
doc_id: DAOGE-WB-DATA-001
status: active
owner: daoge-docs
updated: 2026-08-03
authority: 开发执行工作台派生数据契约
---

# 开发执行工作台数据契约

## 1. 契约目的

本文定义产品文档浏览器、开发执行工作台和 Goal 执行器共享的派生数据。`daoge-docs 3.13.4` 当前输出 `schema_version: 7`；`schema_version: 5` 与 `6` 只作为兼容输入。

数据由权威 Markdown、JSON、YAML、OpenAPI、迁移、代码事实和机器证据生成。派生数据不是新的业务事实来源。

## 2. 生成原则

1. 相同权威输入、工具版本和配置产生相同语义结果。
2. 每个结论、节点、关系、里程碑和状态至少携带一个来源。
3. 找不到结构化来源时返回 `unknown` 或能力降级，不从标题或 prose 猜测。
4. 浏览器只读；CLI 检查器、浏览器和 Goal 准备器读取同一评估结果。
5. 规划、实现、验证和批准使用不同字段，不能互相推导。
6. 工作台默认输出面向人的摘要，完整机器字段仅供展开或 Goal 清单使用。

## 3. 顶层对象

```json
{
  "schema_version": 7,
  "generated_at": "2026-08-03T00:00:00Z",
  "tool_version": "3.13.4",
  "source_commit": "",
  "authority_digest": "sha256:...",
  "project": {},
  "documents": [],
  "directories": [],
  "entities": [],
  "relations": [],
  "features": [],
  "requirements": [],
  "findings": [],
  "task_packets": [],
  "governance": {},
  "views": {},
  "change_summary": {},
  "goal_readiness": {}
}
```

`authority_digest` 变化后，旧任务包、旧证据批准、旧变化摘要和旧 Goal 清单不能继续显示为当前有效。

## 4. 来源引用

所有可操作派生对象使用统一来源：

```json
{
  "source_path": "04-技术架构/总体架构.md",
  "source_section": "核心组件",
  "source_id": "ARCH-COMP-001",
  "authority": "总体架构"
}
```

一项事实有多个权威参与时使用 `sources[]`，但必须说明每个来源负责的事实类型。不能用多个文件同时定义同一种事实。

## 5. 文档与目录

`documents[]` 继续提供路径、标题、状态、权威职责、owner、updated、稳定 ID、kind、离线正文、章节、摘要、行数和 generated 标记。

每篇文档还必须提供 `content_digest` 与 `sections[]`。它们只用于阅读定位和本地恢复，不能代替正文，也不能成为第二份文档内容：

```text
content_digest: sha256:<当前完整正文>
sections[]: id / title / level / parent_id / line_start / line_end / order
```

`section.id` 由文档路径、父章节、标题与同级出现顺序确定；同一完整正文必须得到相同索引。内容摘要变化后，浏览器必须放弃旧滚动位置，避免恢复到错误段落。来源引用优先使用 `source_path + source_section_id`；生成器可以从精确匹配的 `source_section` 自动补齐该 ID，旧的标题定位只作为兼容回退。

`directories[]` 递归描述所有目录，至少包含：

```text
id / path / parent_id / name / readme_path
kind / authority / document_count / child_count
status / finding_count
```

每个语义目录优先打开 README 或索引。缺少入口时生成 `DIRECTORY-README` finding。

## 6. 实体和关系

`entities[]` 支持：

```text
project / user / system / component / external_system
domain / data_domain / entity / version / milestone / risk
requirement / feature / acceptance / branch / test / evidence
decision / adr / task / document / directory
```

`relations[]` 至少支持：

```text
contains / derived_from / satisfies / has_acceptance
traced_by / verified_by / depends_on / decided_by
implemented_by / planned_for / supersedes
calls / reads / writes / owns / emits / consumes
precedes / unlocks / mitigates
```

每条边包含 `from`、`to`、`relation`、`label` 和来源。关系不存在时显示“未映射”，不得猜测。

## 7. 标准化文档输入

样例级可视化必须来自以下权威表格。表格名称允许带章节编号，但列名和稳定 ID 不得缺失。

### 7.1 产品蓝图

`产品信息架构`：

| 稳定 ID | 用户/入口 | 核心能力 | 所属领域 | 目标结果 |
| --- | --- | --- | --- | --- |

`核心业务流程`：

| 步骤 ID | 顺序 | 参与者 | 动作 | 系统/领域 | 业务结果 | 失败结果 |
| --- | --- | --- | --- | --- | --- | --- |

### 7.2 总体架构

`核心组件`：

| 组件 ID | 名称 | 类型 | 职责 | 所属领域 | 部署单元 |
| --- | --- | --- | --- | --- | --- |

`数据和控制流`：

| 关系 ID | 来源组件 | 关系 | 目标组件 | 契约 | 失败语义 |
| --- | --- | --- | --- | --- | --- |

### 7.3 版本路线图

`版本序列`：

| 版本 ID | 目标 | 状态 | 前置版本/能力 | 退出条件 | 权威文档 |
| --- | --- | --- | --- | --- | --- |

### 7.4 数据模型

`跨域关系与所有权`：

| 数据域 ID | 数据/实体 | 唯一写入者 | 只读使用者 | 关系 | 不变量 |
| --- | --- | --- | --- | --- | --- |

### 7.5 风险

`风险与应对` 或风险注册表：

| 风险 ID | 领域/对象 | 等级 | 原因 | 影响 | 控制 | 验证入口 |
| --- | --- | --- | --- | --- | --- | --- |

### 7.6 功能演进矩阵

能力主线必须具有稳定 `TRACK-*` ID。每个阶段使用：

| 里程碑 ID | 能力主线 | 版本/阶段 | 用户可感知变化 | 依赖与边界 | 完成判定 | 状态与来源 |
| --- | --- | --- | --- | --- | --- | --- |

`兼容影响` 必须明确登记兼容、迁移、废弃和替代关系；当前没有关系时使用 `ER-NONE / none` 显式确认，不能以空表推断不存在关系：

| 关系 ID | 关系类型 | 来源版本/里程碑 | 目标版本/里程碑 | 影响与处理 | 状态与来源 |
| --- | --- | --- | --- | --- | --- |

关系类型只允许 `compatible`、`migration`、`deprecation`、`replacement` 或用于显式空声明的 `none`。除 `deprecation` 可以没有替代对象外，其他关系必须同时引用已经登记的版本或里程碑 ID。

### 7.7 实现状态

当前实现状态由代码、测试和证据派生：

| 功能 ID | 后端 | 前端 | 数据/迁移 | 自动化验证 | 当前差距 | 证据 | 更新时间 |
| --- | --- | --- | --- | --- | --- | --- | --- |

缺少上述表格时，对应视图显示“结构化来源未建立”，而不是绘制看似完整的通用图。

## 8. 六个视图数据

### 8.1 `views.workbench`

```json
{
  "context": {"version": "V1", "feature_id": "CODE-FR-001", "stage": "feature-ready"},
  "decision": {"status": "blocked", "reason": "..."},
  "next_action": {"label": "补齐 AC01 证据", "source_path": "...", "source_section": "..."},
  "top_blockers": ["WB-F-0001"],
  "blocker_total": 4,
  "progress": {
    "specification": "ready",
    "design": "blocked",
    "implementation": "unknown",
    "verification": "not_run"
  },
  "task_packet_id": "WB-TASK-CODE-FR-001",
  "verification_summary": {}
}
```

`top_blockers` 最多三项。完整 findings 在次级面板读取。

当前功能选择器从顶层 `features[]` 显示稳定 `id + title`；工作台可以复制该 ID，也可以仅从当前 `feature.id` 与 `feature.title` 派生 Goal 准备提示。提示词不是 Goal 清单，必须要求智能体运行 `prepare-goal` 后读取结果；`blocked` 时停止，`ready` 后只允许读取 `goal-resume-context`，不得由浏览器直接运行或伪造 Goal 状态。

### 8.2 `views.overview`

包含 `stats`、`product_architecture`、`core_flow`、`version_chain`、`development_progress`、`accepted_decisions` 和 `authority_entries`。前三个关系模型直接复用 `views.maps` 的同一份节点、边和来源，不创建第二份业务事实。

`development_progress` 不是文档状态计数，而是带来源的交付状态派生：

```json
{
  "counts": {
    "not_started": 1,
    "implementing": 0,
    "local_verified": 0,
    "staging_verified": 0,
    "released": 0,
    "unknown": 0
  },
  "items": [{
    "feature_id": "CODE-FR-001",
    "title": "创建订单",
    "status": "not_started",
    "basis": "已声明 4 个工程落点，当前未检测到实现落点",
    "sources": []
  }]
}
```

`counts` 之和必须等于当前版本功能数。每个 `items[]` 必须同时指向功能规格的“实现与验证”和当前版本“实现状态”；`draft`、`ready` 等规格状态不得直接显示成开发完成度。

### 8.3 `views.reader`

直接使用 `documents[]` 和 `directories[]`，不创建第二份正文摘要。正文必须完整渲染；章节索引、检索命中、工作台 finding 和图谱来源应优先进入 `sections[]` 的精确章节。浏览器本地恢复仅保存 `doc_path + content_digest + section_id + scroll_ratio`，不保存正文副本或用户业务结论。

### 8.4 `views.maps`

包含六个图模型：

```text
product_architecture
core_flow
version_roadmap
data_domains
delivery_trace
risk_hotspots
```

每个图模型统一为：

```json
{
  "id": "product_architecture",
  "title": "产品架构",
  "status": "ready",
  "nodes": [{"id": "COMP-001", "label": "网关", "type": "component", "sources": []}],
  "edges": [{"from": "COMP-001", "to": "EXT-001", "relation": "calls", "label": "...", "sources": []}],
  "findings": []
}
```

图谱状态只允许使用：

- `ready`：全部必需结构化表格有效、节点无待决占位、关系端点完整。
- `blocked`：已经存在可展示数据，但必需来源缺失、引用未登记对象或节点仍含待决内容；界面只能显示“部分信息”。
- `unknown`：没有足够结构化数据形成图谱。

节点可按图谱类型增加面向人的派生字段：核心流程使用 `actor/outcome/failure/order`，版本路线使用 `planning_status/goal/prerequisites/exit_condition/order`，数据域使用 `role/invariant`，风险热区使用 `severity/risk_target/impact/control/verification`。这些字段只能来自同一结构化权威行，不能由界面猜测。

稳定 ID 必须保留在数据和完整关系表中，但默认图形以人类名称为主标签。图谱节点的来源操作必须同时使用 `source_path` 和 `source_section`；URL 使用 `#view=map&map=<图谱类型>` 恢复或分享当前图谱，交付追踪还可携带 `feature=<功能 ID>`。

### 8.5 `views.evolution`

包含版本主链、能力主线和里程碑：

```json
{
  "status": "ready",
  "versions": [],
  "stages": [{"id": "V1", "label": "V1", "kind": "version", "order": 0}],
  "tracks": [{"id": "TRACK-IDENTITY", "title": "身份与权限", "order": 0, "milestone_ids": []}],
  "milestones": [{
    "id": "MS-V2-001",
    "track_id": "TRACK-IDENTITY",
    "version": "V2",
    "version_ids": ["V2"],
    "stage_keys": ["V2"],
    "user_change": "...",
    "dependencies": [],
    "completion": "...",
    "planning_status": "planning",
    "sources": []
  }],
  "relationships": [{
    "id": "ER-001",
    "type": "migration",
    "from": "MS-V1-001",
    "to": "MS-V2-001",
    "impact": "迁移期间保持旧入口只读",
    "planning_status": "planning",
    "sources": []
  }],
  "findings": []
}
```

`ready` 要求版本序列、功能与版本矩阵和兼容影响三份结构化表格全部有效。已有部分数据但任一必要来源缺失时必须返回 `blocked`；三类来源都不足以形成演进视图时返回 `unknown`。页面以版本主链、能力 × 版本矩阵和单个里程碑详情渐进展示，稳定 ID 默认放入次级详情。

### 8.6 `views.timelines`

每个功能提供：

```text
feature_id / title / goal / domain / risk
current_implementation / current_gap / current_gate
dependencies / milestones / evidence_summary / sources
```

未来里程碑必须由功能演进矩阵明确关联。空白版本保持 `unassigned`。

## 9. Findings 与治理

`findings[]` 继续作为开发行动统一入口，字段至少包括：规则、阶段、严重级别、状态、对象、原因、来源、恢复动作、验证命令、证据类型和 authority digest。

`governance` 必须区分：

- 结构：`ready`、`blocked`、`unknown`。
- 实现：`not_started`、`implementing`、`implemented`、`unknown`。
- 证据：`not_run`、`passed`、`failed`、`environment_failed`、`stale`。
- 批准：`not_requested`、`approved`、`rejected`、`expired`。

工作台只显示摘要，完整门禁、测试、证据和提交/构建绑定在次级面板展示。

## 10. 轻量变化摘要

不可变快照保存在 `docs/90-参考资料/版本快照/`，但完整快照列表不再作为浏览器一级数据面板。

`change_summary` 只包含最近两个有效快照的变化对象：

```json
{
  "available": true,
  "baseline": {"version": "V1", "authority_digest": "sha256:..."},
  "current": {"version": "V2", "authority_digest": "sha256:..."},
  "counts": {"added": 2, "changed": 3, "deprecated": 0, "removed": 1},
  "items": [{
    "id": "CODE-FR-001",
    "type": "feature",
    "change": "changed",
    "summary": "目标和 AC 发生变化",
    "impact": ["CODE-AC-001", "E2E-001"],
    "source_path": "03-功能规格/V2/..."
  }],
  "details": {"source_commit": "", "generated_at": ""}
}
```

禁止输出 `unchanged` 项。没有两个快照时 `available: false`，功能演进视图不显示该模块。

## 11. 开发任务包与 Goal 就绪度

`task_packets[]` 保留功能范围、非目标、需求、决策、依赖、AC、稳定分支、实现落点、阻塞、验证命令、`forbidden_paths` 和禁止行为。`forbidden_paths` 来自功能 front matter，表示当前 Goal 不得修改的仓库相对路径及其子路径；生成器会拒绝它与实现落点授权范围重叠。

`goal_readiness` 只提供人类摘要：

```json
{
  "status": "blocked",
  "reason": "2 个功能未通过 Feature Ready",
  "feature_ids": ["CODE-FR-001"],
  "blocking_finding_ids": ["WB-F-0001"],
  "authority_digest": "sha256:..."
}
```

完整 Goal 清单由独立准备命令生成，遵守 `agent-goal-execution-contract.md`。

### 11.1 Goal 运行时产物

Goal 执行目录只包含三类可变运行时产物：

| 产物 | 权威含义 | 必要绑定 |
| --- | --- | --- |
| `checkpoints/CP-NNN.json` | 一个原子任务及局部验证已经通过 | task、commit、parent commit、authority digest、changed paths、证据路径与摘要 |
| `evidence/*-attempt-NNN.json` | 一次真实命令尝试的结果 | command、cwd、timeout、exit code、commit、authority digest、输出摘要与时间 |
| `completion.json` | 全部任务、最终命令、docs-check 和 Ready 门禁已经复验 | source/final commit、全部 checkpoint、最终证据、authority digest 与完成摘要 |

每次尝试使用新文件，失败记录不得覆盖。Goal 清单只保存这些记录的相对路径和摘要；正文业务语义仍由 docs 权威文档定义。浏览器可以显示执行摘要，但不能修改这些文件，也不能据此宣称 Release 已通过。

## 12. 本地 UI 状态

浏览器仅允许本地保存：

```text
当前视图 / 当前功能 / 当前文档 / 当前章节 / 滚动位置
图谱模式 / 功能演进能力、阶段与里程碑 / 已展开的次级面板
```

不再要求收藏、最近阅读列表或个人工作面板。所有本地状态都不得进入权威文档、快照、证据或项目提交。

工作台内的渲染阅读链接使用 `#view=reader&doc=<path>&section=<fragment>`。需要查看源码时，必须直接打开 docs 相对路径对应的 `.md`，并由内置服务以 `text/markdown; charset=utf-8` 返回；需要保存文件时使用同一 docs 相对路径的下载入口。原文、渲染阅读和下载是三个不同语义，不能互相替代。

## 13. 兼容与迁移

- `schema_version: 5` 或 `6` 可进入阅读和基本视图，但显示“旧数据契约”；精确章节定位与内容摘要恢复需要迁移到 `schema_version: 7`。
- `#view=governance` 重定向到工作台验证面板。
- `#view=diff` 重定向到功能演进的变化摘要。
- 缺少 `views.maps` 时不得用通用计数图冒充项目图谱。
- 迁移到 v5 前，现有页面不应宣称达到新 PRD 的完成条件。

## 14. 契约验收

### 静态验收

- 所有稳定 ID 唯一。
- 所有图节点和关系有来源。
- 所有关系边两端实体存在。
- 所有进展状态有代码、测试或证据依据。
- 所有 task packet 和 Goal readiness 绑定 authority digest。
- 变化摘要不包含未变化对象。

### 浏览器验收

- 六个主视图完整可用，主导航没有额外一级入口。
- 工作台首屏能在一个视口内显示判断、下一步和进展。
- 图谱能切换六类项目关系图，缺失数据时明确降级。
- 阅读保留完整 Markdown 正文；搜索命中、来源按钮和深链可进入精确章节，内容变化后不恢复旧阅读位置。
- 功能演进显示依赖与完成判定，时间线显示当前差距和来源。
- 功能演进可横向比较能力与版本，显示前置能力、退出条件以及明确登记的兼容、迁移、废弃和替代关系。
- 旧 governance/diff 深链仍能到达新位置。
- 页面不执行外部命令，不依赖 CDN 或在线 API。
