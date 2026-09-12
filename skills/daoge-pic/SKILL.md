---
name: daoge-pic
description: Agent + 创作者工作台协作的本地图像创作管理 Skill。Agent 收敛需求、计划、确认与受控生成；Studio Workbench 支持项目/任务/轮次、素材、选片、复核和交付的可视操作。
---

# DAOGE Pic vNext

当前稳定正式版本是 [`5.13.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.13.0)。`5.12.0` 及更早版本保持为不可变历史发布；不兼容的旧 daemon 不得与本版本混用。Skill protocol 为 `daoge-pic-skill-protocol/2.0.0`，运行时兼容范围为 `>=5.13.0 <6.0.0`，二者都独立于制品版本；`5.13.0` 和历史制品版本绝不能当作协议版本。

本文件是 Agent 执行协议，不是完整产品规格。产品、架构、Schema、Worker、ZIP、安全实现和验证证据分别以 `docs/daoge_pic_vnext_upgrade_spec_zh.md`、`docs/vnext_verification_evidence_zh.md`、源码与测试为准。用户可见沟通使用中文。

## 机器强制执行边界

以下边界同时由 daemon/API/测试与本 Skill 约束；Agent 不得尝试绕过：

- 不得执行或建议旧 `prepare`、`execute`、`ingest`，不得创建 `task_spec.json`，不得把旧 `workspace/*.html` 或 `results.html` 当作当前入口。
- 运行必须携带 daemon 签发的 `confirm_token`。令牌绑定 `plan_hash + preflight_id + conversation_id`；缺失、伪造、过期、跨计划、跨预检或跨 conversation 一律拒绝，不触发 Provider。
- 确认挑战只可由当前 Workbench 的授权 Cookie 提交；Workbench 的确认闸门只激活计划，不执行预检、不创建 Generation Run。
- `preflight` 与 `run` 只接受 Bearer Skill/CLI；`preflight` 不调用 Provider、不计费、不创建正式资产，`run` 才会触发 Provider。
- 每个创作轮次只允许当前已确认计划创建一个 Generation Run。已有运行时必须显式选择并处理该运行；再次生成必须新建 `variation`、`refinement` 或 `fill` 轮次。
- Studio 直接创建项目、任务、轮次或草稿参考素材，只写 Studio API/SQLite 事实源和草稿上下文；不得生成计划确认、预检、Generation Run 或 Provider 调用。
- Workbench 可基于当前项目或明确共享素材创建 `variation`、`refinement`、`edit`、`fill` 草稿轮次；该动作仍不得绕过 Agent 计划确认。
- 参考图和遮罩只能来自当前项目资产，或当前 Studio 明确 `shared_across_projects` 的共享素材；计划写入、确认、预检、排队和 Worker 读取前都必须重复校验。
- Provider Profile、密钥引用和 write-only 摘要以 `Provider.db` v3 为唯一运行时事实源；secret 默认可存于受权限保护的 SQLite plaintext，显式 system backend 时使用 macOS Keychain、Windows DPAPI sidecar 或 Linux libsecret；system backend 不可用必须 fail-closed，不得静默退回明文。API Key 与完整 Base URL 不得进入 Studio DB、事件、日志、导出、诊断或回复。
- 不得输出、记录、复制或要求用户粘贴 capability、bootstrap URL、Cookie、session token、claim token、完整 Provider 请求、内部路径或 API Key。
- 不得直接写 Studio 文件、SQLite、manifest、journal、runs、SSE 状态或媒体目录；只使用受控 CLI 或当前源码明确列出的同源 Studio API。
- 大 JSON 用 CLI 的 `--plan @-` 等 stdin 标记传输；每次命令最多一个 `@-`，stdin 必须是 JSON 对象。

## 最小状态与角色矩阵

| 层级 | 权威状态 / 事实 | 可写入角色 | 是否触发 Provider | 不变量 |
| --- | --- | --- | --- | --- |
| Studio Session | `activeProjectId` / `activeTaskId` / `activeRoundId` | Agent Bearer 或已授权 Workbench Cookie | 否 | 浏览器标签身份不等于 Agent conversation；每个真实 conversation 使用独立 Studio Session。 |
| Project / Task | project `active` / `archived`；task `draft` / `active` / `completed` / `archived` | Agent Bearer 或 Workbench Cookie | 否 | 创建只写 Studio API/SQLite；项目模板默认值来自 `/api/project-templates` 后端注册表。 |
| Round | `draft` / `awaiting_confirmation` / `active` / `completed` / `archived` | `draft` 可由 Agent 或 Workbench 补上下文；确认后由 Agent 流程推进 | 否 | 新方向新建轮次；已确认或运行中的轮次不能由 Workbench 直接改参考上下文。 |
| Plan version | `draft` / `awaiting_confirmation` / `confirmed` | Agent Bearer 写入；Workbench Cookie 只提交确认挑战 | 否 | `plan` 是计划写入，不是旧 `prepare`；确认只激活当前计划，不预检、不入队。 |
| Preflight / Run | dry-run preview；run `queued` / `running` / `paused` / `resume_pending` / `partial` / `completed` / `failed` / `cancelled` 等 | Agent Bearer | `preflight` 否；`run` 是 | 绑定 session、conversation、plan hash、Provider 快照和并发；每轮只允许一个 Generation Run。 |
| Run Item | `pending` / `leased` / `requesting` / `receiving` / `persisting` / `succeeded` / `retry_wait` / `blocked` / `cancel_requested` / `cancelled` / `outcome_unknown` / `failed` | Worker 与 Agent 控制命令 | 请求中是 | `outcome_unknown` 必须先由用户核实并 `resolve-unknown` 结案；不能直接重试。 |
| Delivery | `draft` / `ready` / `exported` | Workbench Cookie 或受控 CLI | 否 | 准备冻结选片来源与评审，导出创建冻结图片实体；不存在公开 `delivery-complete` CLI。 |

角色分离必须保持：Workbench Cookie 可做可视管理和人工确认；Agent Bearer 才能执行预检、入队、恢复、重试、取消和 unknown 结案；Worker 只处理已入队运行项。任何 UI、缓存、SSE 或文件夹状态都不是业务事实源。

## 执行型启动协议（MUST）

### 触发分类

- **执行型触发**：用户明确要求使用 daoge-pic / 刀哥生图，或要求生成、编辑、衍生图片，导入、管理或选片，查看 Generation History，恢复、重试或取消运行，或准备交付。首次执行型触发必须先准备 Studio，再进行创作澄清或领域写入。
- **咨询/开发型触发**：用户只讨论架构、配置、源码、文档、测试，或尚未决定使用 daoge-pic。此类请求不得自动启动 Studio 或打开 Workbench，只回答或执行所请求的咨询/开发工作。

### 首次启动顺序

1. 先判断触发类型。
2. 执行型触发先解析当前会话绑定的稳定工作区。已有明确绑定时复用；无法从会话或宿主上下文得到时，只询问这一项前置条件。不得使用临时目录、Skill 安装目录或任意当前目录代替稳定工作区。
3. 每个独立智能体会话在该工作区的首次执行型触发都可以安全运行普通 `node scripts/daoge.js open --workspace <path>`：

   ```bash
   node scripts/daoge.js open --workspace <path>
   ```

   `open` 原子地确保同工作区唯一健康 daemon，然后向 daemon 申请短期 opener claim。只有首个 claim 持有者调用系统默认浏览器；其他并发会话在活动 Workbench、最近已授权连接或未过期 claim 存在时返回 `opened:false, reused:true`，不重复调用 opener。启动和打开只属于本地准备，不是外部 Provider 调用，不需要生成确认，也不得自动执行 Provider 连接测试。

   请求根没有 `studio.json` 时，CLI 只向上检查祖先目录；若发现有效父级 Studio，必须拒绝隐式初始化，避免产生数据不互通的嵌套 Studio。只有用户明确要求独立嵌套 Studio 时，才可执行 `open --allow-nested-studio true`。
4. `open` 返回 `opened:true, reused:false` 时汇报已打开；返回 `opened:false, reused:true` 时汇报已复用。随后才创建或恢复以当前真实 conversation ID 建立的独立 Studio Session，再创建或恢复项目、任务和轮次上下文，然后开始创作澄清、计划与领域写入。

### 跨会话复用

同一稳定工作区的每个独立智能体会话都可在首次执行型触发调用普通 `open`；去重由共享 daemon 的内存 presence/open-claim 协议保证，不依赖会话间互相知道状态。已存在活动 Workbench、最近认证连接或未过期 claim 时，CLI 安全返回复用结果且不调用 OS opener。`open --force true` 只允许在用户明确要求新开标签时使用；Skill 的普通启动不得 force。协议不承诺 OS opener 能识别或聚焦既有标签，daemon 只保证普通 open 最多触发一个实际 opener。

`--force true` 只控制是否新开浏览器标签，不改变 Studio 身份；`--allow-nested-studio true` 只确认用户确实要在已有父级 Studio 内创建另一个隔离 Studio。两者不得混用为工作区恢复手段。

### 打开失败与安全访问

如果系统自动打开失败但 daemon 健康，向用户提供且只提供安全命令 `node scripts/daoge.js open --workspace <path>`；安装包语境可提供 `npx daoge open --workspace <path>`。不得回显或要求用户复制 bootstrap URL、capability、Cookie、session token 或 runtime 私密字段，裸 Workbench origin 也不得作为主要访问方式。

### Provider 未配置

没有 active Provider Profile 不阻止 Studio 启动或 Workbench 打开。应引导用户在 Workbench 的生成服务页配置并激活 Profile，然后回到会话继续；页面打开、加载或保存不得自动测试连接，只有用户明确发起的连接测试才可访问 Provider。

### 首次状态汇报

首次成功后必须用中文明确说明：Studio 已启动或已连接；根据 CLI 结果说明 Workbench **已在默认浏览器打开**（`opened:true`）或**已复用现有 Workbench**（`reused:true`）；用户继续在会话中描述和确认创作，Workbench 用于 Provider、素材、Generation History、选片和交付；同时汇报 Provider readiness、当前项目/任务/轮次与下一步。不得把 reused 谎报为新打开，也不重复给出链接、origin 或 bootstrap 信息。

## 会话工作法

1. 先完成“执行型启动协议”：Workbench 已打开或已安全复用，Studio Session 与稳定工作区已绑定，项目、任务和轮次上下文已创建或恢复。
2. 再澄清目标、受众、数量、画幅、风格、限制条件、参考素材与交付用途，并把确认事实写入当前领域上下文。
3. 给出用户可审阅的版本化计划：operation、提示词、数量、输出规格、引用素材、父轮次/父资产与风险。
4. 未得到用户明确确认前，不得发起任何外部 Provider 调用。
5. Workbench 完成确认后，先读取当前会话计划摘要和 Generation History。若当前轮次已有运行，必须显式选择并汇报该运行，不得再次预检或入队；没有运行时才执行预检。
6. 预检证据仍与计划和 daemon 内存配置匹配时，才创建该轮次唯一运行。用户要求再次生成时新建衍生轮次，不复用原轮次创建第二批。
7. 用会话汇报状态、异常与恢复选择。Workbench 用于查看实时结果、Generation History、导入素材、保留/复核/淘汰、回收、恢复和交付。

不得把用户需求写成遗留 JSON 任务文件，不得扫描目录推断业务状态，不得直接写 SQLite、manifest、journal、运行文件或 SSE 状态。

## 工作区、Provider 与密钥

- 运行时必须是 Node.js `22.17.0` 或更高版本；Windows、ACL、Schema、Worker 与媒体恢复细节见产品规格和源码测试。
- 每次必须使用稳定工作区根目录，传入 `--workspace <path>` 或明确设置 `DAOGE_WORKSPACE_ROOT`。没有稳定根目录时停止并向用户索取，不得回退到任意当前目录。
- 请求根已有 manifest 时严格复用其身份；请求根没有 manifest 但祖先目录存在有效 Studio 时，默认拒绝初始化并改用父级稳定工作区。
- 运行时目录形态固定为 `<workspace>/daoge-studio`、`<workspace>/daoge-assets`、`<workspace>/daoge-deliveries`。`studio.db` 是业务事实源；`Provider.db` 是 Provider Profile、密钥引用与 write-only 摘要的唯一运行时事实源。
- Provider 能力、端点信任、参考图/遮罩能力、媒体类型和输出规格来自版本化 Provider Descriptor；Profile store、API、Workbench、预检和 HTTP adapter 必须消费同一份 Descriptor。
- Workbench 可管理 Profile、模型、端点信任模式和限额；API Key 与完整 Base URL 只写不回显。页面打开、加载或保存不得自动连接 Provider；显式连接测试和模型列表读取只在用户点击时访问 Provider。`compatible_public` 必须使用 HTTPS；需要 HTTP 时只能显式选择 `local_proxy` 或 `enterprise_private`，并接受对应私网地址策略。

## 本地访问授权与打开 Workbench

```bash
node scripts/daoge.js studio --workspace <path>
node scripts/daoge.js open --workspace <path> [--allow-nested-studio true]
```

`open` 必须先完成工作区身份检查，再通过已授权本地 API 获取 daemon 内存 opener claim，并由唯一持有者使用跨平台安全 opener。健康 daemon 的 `restart`、关闭和恢复必须走受控本地 API；不得用外部 PID kill 或 shell 拼接 URL 代替。

Workbench 通过 URL fragment bootstrap 换取 `HttpOnly`、`SameSite=Strict` Cookie 后清除 fragment；CLI 使用 Bearer capability。除最小健康检查外，API、媒体、ZIP 和 SSE 都要求当前 Studio 授权，写入还校验 Host、Origin 和 Content-Type。`status` 只能返回脱敏 daemon 信息。

## 受控命令

统一入口：

```bash
node scripts/daoge.js <command> [--workspace <stable-workspace>]
```

公开命令按职责分组：

- 启动/诊断：`register-skill`、`doctor`、`studio`、`open`、`restart`、`status`。
- Provider：`provider-list`、`provider-create`、`provider-update`、`provider-copy`、`provider-activate`、`provider-delete`、`provider-validate`、`provider-test`、`provider-models --workspace <path> --profile <id>`、`provider-import-env`。
- 会话与上下文：`session --conversation <id>`、`session-context`、`project`、`archive-project`、`task`、`round`。
- 规则资料：`task-type`、`style-kit`、`brand-kit`。
- 计划与运行：`plan --plan <json|@->`、`confirm-challenge`、`preflight`、`run`、`pause`、`resume`、`cancel`、`retry`、`resolve-unknown`。
- 交付：`delivery`、`delivery-update`、`delivery-ready`、`delivery-draft`、`delivery-export`、`delivery-batch`、`delivery-batch-revise`、`delivery-batch-ready`。`delivery-complete` 不是公开 CLI 命令。

高风险命令必须按完整签名执行，缺失参数时停止并补齐，不得猜测默认值或把 secret 写入 argv：

```bash
node scripts/daoge.js provider-create --workspace <path> --name <name> --provider <id> --model <model> --base-url <url> --api-key-stdin @- [--endpoint-trust-mode <official|compatible_public|local_proxy|enterprise_private>] [--limits <json>] [--active true]
node scripts/daoge.js provider-update --workspace <path> --profile <id> --version <n> [--name <name>] [--provider <id>] [--model <model>] --base-url-action <keep|replace|clear> [--base-url <url>] --api-key-action <keep|replace|clear> [--api-key-stdin @-] [--endpoint-trust-mode <mode>] [--limits <json>]
node scripts/daoge.js provider-models --workspace <path> --profile <id>
node scripts/daoge.js preflight --workspace <path> --round <round-id> --session <session-id> [--concurrency <1..1000>]
node scripts/daoge.js run --workspace <path> --round <round-id> --preflight <dry-run-id> --confirm-token <daemon-token>
node scripts/daoge.js resume --workspace <path> --run <run-id> --session <session-id>
node scripts/daoge.js resolve-unknown --workspace <path> --run <run-id> --items <item-id,...>
```

同源 Studio API 仅用于当前文档或当前源码已明确列出的端点。Bearer Skill/CLI 请求必须发送 `x-daoge-skill-protocol: daoge-pic-skill-protocol/2.0.0`；`5.13.0` 是当前稳定发布制品/运行时版本，`5.12.0` 及更早版本是历史发布，它们都绝不能当作协议版本。

固定查询端点：`GET /api/studio` 是协议协商与运行时状态端点；`GET /api/sessions/<session-id>/plan-status` 是当前会话计划摘要；`GET /api/rounds/<round-id>/runs` 是当前轮次 Generation History。路径或方法不在当前端点表内时，daemon 会以 `未找到请求的 Studio API。` 拒绝；Skill 必须改用正确端点或受控 CLI，不得猜测 `/api/studio/...`、旧命令或工作区文件。

## 幂等命令恢复

所有 POST / PUT mutation 可追加 `--operation-name <verb:scope>`，由 daemon 派生稳定幂等键；需要跨进程精确恢复时仍可使用 `--idempotency-key <stable-key>`，两者互斥。未提供任一参数时，CLI 生成的随机 key 不具备跨进程恢复语义。

## 运行恢复与媒体边界

- Provider 限流或临时故障进入有界重试；认证、模型、参数或权限错误不自动重试。
- 外部请求结果不明时，运行项进入 `outcome_unknown`，绝不自动重放。用户核实无结果后，才可用 `resolve-unknown` 将指定项结案。
- daemon 重启时，未安全完成的运行进入 `resume_pending`；再次外部调用前必须在会话中得到用户确认，并以 `resume --session <session-id>` 记录。Workbench 只能显示等待状态，不能绕过会话继续。
- `retry` 只允许 `failed`、`blocked` 或 `retry_wait`；`outcome_unknown` 不可直接重试。
- 并发只属于 Generation Run：预检未指定时默认 `4`，串行使用 `1`，显式值只接受 `1..1000`；并发变化必须重新预检。
- 缺失媒体持久标记为不可用，不得作为参考图、遮罩或交付候选；对账确认恢复后才重新可用。
- 下载、复制、交付导出和 ZIP 必须使用受验证 snapshot 流式读取；路径穿越、跨 Studio/跨项目访问、超出上限或客户端断连都不能形成错误交付。

## Generation History 与交付

- Generation History 必须按当前轮次列出全部持久 Generation Run，并要求用户或 Skill 显式选择运行。不得把活跃运行、最新运行或当前浏览器缓存静默当作已选择历史。
- 历史详情里的提示词可显示截断安全摘要；复制提示词必须回读对应计划版本的完整提示词。计划含逐图提示词时，必须复制每张图实际发送给 Provider 的完整提示词。
- 当前计划页支持确认前审阅：展示通用提示词、逐图提示词、参考素材、输出规格和每张图最终提示词；确认前必须能复制提示词和结构化计划 JSON。
- 项目当前选片是 SQLite 业务关系。交付状态机为 `draft -> ready -> exported`；准备冻结选片来源与评审，导出创建冻结图片实体，源资产后续回收不得破坏已导出交付。
- 项目资产页使用服务端分页；“全选本页”只作用于当前页可见资产。参考素材选择只可在草稿轮次写入结构化上下文，素材来源限定为当前项目资产或明确共享素材。
- Workbench 的普通“完成交付”可调用内部 `/api/deliveries/complete`；该 API 不得伪装成公开 CLI。高级 CLI 使用 `delivery*` 与 `delivery-batch*` 命令操作同一状态机。

## Workbench 边界与可访问性

Workbench 可用于：项目/任务/轮次导航与直接创建、创作谱系、Generation History、SSE 状态、素材导入、范围筛选、搜索、放大/双图对比、选择、批注、来源检查、共享、回收、恢复、交付历史、下载/复制和 ZIP。Workbench 不提供第二个聊天入口，不直接调用 Provider，不展示 Provider 密钥。

Workbench 顶部持续显示 daemon 与 Worker 池脱敏健康状态；SSE cursor 失效或本地事件批次溢出时，必须先完成权威快照恢复，再推进 cursor。图片查看、确认、搜索和错误状态必须保持可访问性：`role="dialog"`、`aria-modal`、焦点约束、Escape 关闭、live region 和可见焦点。

Workbench 不可用于：自然语言对话、绕过会话确认、一键触发 Provider 生成、展示 Provider 密钥、直接指定任意绝对路径、匿名访问、跨 Studio 访问，或把浏览器状态、文件夹和 SSE 当业务事实。

## 回答规范

首次执行型触发按“首次状态汇报”完整说明启动与访问状态。后续更新只需简要说明 Workbench 已复用、Provider readiness、当前项目/任务/轮次、计划是否待确认、预检结果、明确选择的 Generation Run、成功/失败数量、恢复边界及下一步；不重复链接或访问地址。不要暴露 API Key、完整 Base URL、capability、bootstrap URL、Cookie、session token、完整 Provider 请求、内部 SQLite 细节、绝对媒体路径或临时文件。
