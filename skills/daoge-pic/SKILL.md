---
name: daoge-pic
description: Agent + 创作者工作台协作的本地图像创作管理 Skill。Agent 收敛需求、计划、确认与受控生成；Studio Workbench 支持项目/任务/轮次、素材、选片、复核和交付的可视操作。
---

# DAOGE Pic vNext

当前源码与运行时版本为 `6.1.1`（最新正式发布；`6.1.0`、`6.0.0`、`5.14.2` 及更早为历史发布，不兼容的旧 daemon 不得混用）。Skill protocol 为 `daoge-pic-skill-protocol/3.1.0`，运行时兼容范围 `>=6.0.0 <7.0.0`；二者独立于制品版本，制品版本绝不能当作协议版本。

本文件是 Agent 执行协议，不是完整产品规格；产品、架构、Schema、Worker、ZIP、安全实现和验证证据分别以 `docs/daoge_pic_vnext_upgrade_spec_zh.md`、`docs/vnext_verification_evidence_zh.md`、源码与测试为准。**执行型会话只读本文件、`daoge <命令> --help` 与下面的按需附录**；README 与 `docs/` 只在被明确要求做产品、架构或发布工作时才读。用户可见沟通使用中文。

## 按需深入（references/）

主线（连接 → 澄清 → 计划 → 确认 → 预检 → 出图 → 收图）全在本文件。下面这些**只在触发条件成立时**读，读法：`node scripts/daoge.js reference <文件名去后缀>`（任何宿主都可，CLI 自己知道安装根）；omp 也可用 `skill://daoge-pic/references/<文件>`。

| 触发条件 | 文件 |
| --- | --- |
| 红线 | `references/boundaries.md` |
| 启动 / 访问授权 / `enter` 字段 / 汇报 / 回答规范 | `references/startup.md` |
| 确认后到收图 | `references/flow.md` |
| daemon 是否最新、重启 / 关闭 | `references/build-identity.md` |
| 队列完整规则 | `references/queue.md` |
| 命令、高风险签名、幂等、预算、宿主表 | `references/commands.md` |
| 失败 / 超时 / `outcome_unknown` / 媒体缺失 | `references/recovery.md` |
| Generation History、交付、导出 | `references/delivery.md` |
| 层级状态与「谁能写什么」 | `references/state-model.md` |
| 生成服务、密钥、端点信任、工作区目录 | `references/provider-keys.md` |
| 界面能 / 不能做什么 | `references/workbench.md` |

## 机器强制执行边界

以下红线同时由 daemon/API/测试与本 Skill 约束；Agent 不得尝试绕过。全量与逐条解释见 `references/boundaries.md`。

- 不得执行或建议旧 `prepare` / `execute` / `ingest`，不得创建 `task_spec.json`，不得把旧 `workspace/*.html` 或 `results.html` 当入口。
- 运行必须携带 daemon 签发的 `confirm_token`（绑定 `plan_hash + preflight_id + conversation_id`）；缺失、伪造、过期或跨计划 / 跨预检 / 跨 conversation 一律拒绝。
- 确认挑战只可由当前 Workbench 的授权 Cookie 提交；`preflight` 不调用 Provider、不计费，`run` 才触发 Provider；每个已确认轮次只允许一个 Generation Run。
- 参考图 / 遮罩只能来自当前项目资产或明确 `shared_across_projects` 的共享素材；带 `referenceAssetIds` / `maskAssetId` 必须用 `operation: "edit"`。
- Provider Profile、密钥引用和 write-only 摘要以 `Provider.db` v3 为唯一运行时事实源；显式 system backend 不可用必须 fail-closed，不得静默退回明文。API Key 与完整 Base URL 不得进入 Studio DB、事件、日志、导出、诊断或回复。
- 不得直接写 Studio 文件、SQLite、manifest、journal、runs、SSE 状态或媒体目录；只使用受控 CLI 或当前源码明确列出的同源 Studio API。
- 不得输出、记录、复制或要求用户粘贴 capability、bootstrap URL、Cookie、session token、claim token、完整 Provider 请求、内部路径或 API Key。
- 大 JSON 用 `--plan @-` 等 stdin 标记；每次最多一个 `@-`，stdin 必须是 JSON 对象。

「谁能写什么」「创作物由谁创建」见 `references/state-model.md`。

## 执行型启动协议（MUST）

### 触发分类

- **执行型触发**：用户明确要求使用 daoge-pic / 刀哥生图，或要求生成、编辑、衍生图片，导入、管理或选片，查看 Generation History，恢复、重试或取消运行，或准备交付。首次执行型触发必须先准备 Studio，再进行创作澄清或领域写入。
- **咨询/开发型触发**：用户只讨论架构、配置、源码、文档、测试，或尚未决定使用 daoge-pic。此类请求不得自动启动 Studio 或打开 Workbench，只回答或执行所请求的咨询/开发工作。

### 首次启动顺序

1. 先判断触发类型。
2. 执行型触发先解析稳定工作区：`--workspace` > `DAOGE_WORKSPACE_ROOT` > **cwd 或其祖先是已落盘 Studio**（含 `daoge-studio/studio.json`）。已有明确绑定时复用；无法从会话或宿主上下文得到时，只询问这一项前置条件。不得使用临时目录、Skill 安装目录或任意当前目录代替稳定工作区。首次触发必须登记在场：`enter` 自带（`--cli` / `--skill` / `--skill-version`），只有退回普通 `open` 时才单独 `agent-register`。
3. 每个独立智能体会话在该工作区的首次执行型触发**首选一步连接的原子命令 `enter`**：它把「打开或复用 Workbench + 登记在场 + 建立会话 + 进入项目 + 读请求队列」合并成一次调用，只消耗一次往返。

   ```bash
   node scripts/daoge.js enter --workspace <path> --conversation <当前真实 conversation ID|auto> --project <项目名或 projectId> --cli <宿主 CLI 名> --skill daoge-pic --skill-version <v>
   ```

   `enter` 的返回字段怎么读、`--conversation auto` 的失败口径、以及两个不许猜（会话身份、`build.staleBuild`）见 `references/startup.md`；构建陈旧的处理见 `references/build-identity.md`。

   旧安装包没有 `enter` 时回退到普通 `open`：

   ```bash
   node scripts/daoge.js open --workspace <path>
   ```

   `open` 原子地确保同工作区唯一健康 daemon，然后申请短期 opener claim：只有首个 claim 持有者调用系统默认浏览器，其他会话在活动 Workbench / 最近认证连接 / 未过期 claim 存在时返回 `opened:false, reused:true`。它是本地准备，不是外部 Provider 调用，不需要生成确认，也不得自动执行 Provider 连接测试。请求根没有 `studio.json` 时只向上找祖先；发现有效父级 Studio 必须拒绝隐式初始化（避免数据不互通的嵌套 Studio），只有用户明确要求时才可 `--allow-nested-studio true`（`enter` 同样接受）。
4. `open` 返回 `opened:true, reused:false` 时汇报已打开；返回 `opened:false, reused:true` 时汇报已复用（用 `enter` 时看它的 `workbench` 字段，结论相同，且会话与项目上下文已在同一步绑定）。退回普通 `open` 时，随后才创建或恢复以当前真实 conversation ID 建立的独立 Studio Session，再创建或恢复项目、任务和轮次上下文，然后开始创作澄清、计划与领域写入。启动细节与首次汇报口径见 `references/startup.md`。

## 会话工作法

1. 先完成“执行型启动协议”：优先用 `enter` 一步完成连接、会话绑定与项目进入（返回值已含 `pendingRequests`）；退回普通 `open` 时再依次建会话、绑定项目/任务/轮次。**每次入场先读请求队列**，处理等待中的用户请求，再继续本轮澄清。
2. 再澄清目标、受众、数量、画幅、风格、限制、参考素材与交付用途，并把确认事实写入当前领域上下文。
3. 给出用户可审阅的版本化计划：operation、提示词、数量、输出规格、引用素材、父轮次/父资产与风险；可带一个**可选**的 `understanding`（3–5 句结论性说明）——它回答「你为什么这么理解」，是说明不是执行参数，**推理链不进库**。创建确认挑战可与写计划合并：`plan ... --session <id> --challenge true`。
4. 未得到用户明确确认前，不得发起任何外部 Provider 调用。

计划摘要、Generation History、唯一运行与恢复选择（确认之后到收图）见 `references/flow.md`。

## 请求队列（受限请求入口）

Workbench 的受限请求入口与 Agent 对话共用**同一条队列**（`studio_requests`，一行一请求，状态用列表达）。三条 MUST：

- **每次入场先看队列**：`request-list` 列出 `pending` 条目；条目自带 `context_json`（项目 / 任务 / 选中的图 + 机器可读的流程要求），Agent 按声明执行。
- **领单用租约**：`request-accept --request <id>` 原子领取并写租约；同一单不能被两个 Agent 重复消费。
- **长活要续租**：写计划 → 等确认 → 预检 → 出图 → 收图之间要 `request-renew --request <id>`，否则租约到期判「被领过但没完成」。

完整规则（花动作请求按 `intent` / `runId` / `itemIds` 精确执行、追问、拒单、`previousRequestId` 连续性、撤回）见 `references/queue.md`。

## 受控命令与端点

```bash
node scripts/daoge.js <command> [--workspace <stable-workspace>]
```

完整命令目录、高风险命令完整签名、`--host` 宿主表与幂等恢复语义见 `references/commands.md`；单条命令的参数以 `daoge <命令> --help` 为准。高风险命令必须按完整签名执行，缺失参数时停止并补齐，**不得猜测默认值或把 secret 写入 argv**。

同源 Studio API 仅用于当前文档或当前源码已明确列出的端点。Bearer Skill/CLI 请求必须发送 `x-daoge-skill-protocol: daoge-pic-skill-protocol/3.1.0`；`6.1.1` 是当前源码/运行时版本，`6.1.0`、`6.0.0`、`5.14.2` 及更早版本是历史发布制品，它们都绝不能当作协议版本。

固定查询端点：`GET /api/studio`（协议协商与运行时状态）、`GET /api/sessions/<session-id>/plan-status`（会话计划摘要）、`GET /api/rounds/<round-id>/runs`（当前轮次 Generation History）；确认模板读写走 Bearer-only 的 `/api/confirmed-templates` 列表/详情与 POST save/archive/rollback。路径或方法不在端点表内时 daemon 以 `未找到请求的 Studio API。` 拒绝；Skill 必须改用正确端点或受控 CLI，不得猜测 `/api/studio/...`、旧命令或工作区文件。

## 工作区、Provider 与密钥

每次必须使用稳定工作区根目录（`--workspace` 或 `DAOGE_WORKSPACE_ROOT`），`Provider.db` 是 Provider 的唯一运行时事实源，API Key 与完整 Base URL 只写不回显。完整规则（运行时目录、Provider Descriptor、端点信任模式与地址段）见 `references/provider-keys.md`。
