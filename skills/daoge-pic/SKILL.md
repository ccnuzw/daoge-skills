---
name: daoge-pic
description: 会话优先的本地图像创作管理 Skill。把用户需求收敛为可确认的创作计划，启动受控的生成运行，并通过本地 DAOGE Pic Studio Workbench 管理资产、选择、复核和交付。
---

# DAOGE Pic vNext

当前稳定正式版本是 [`5.9.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.9.0)。本文件定义 5.9.0 的稳定会话协议：同一稳定工作区共享唯一 daemon 与 Workbench，每个真实 conversation 使用独立 Studio Session，Provider 配置以 `Provider.db` 为唯一运行时事实源。

用户可见沟通使用中文。主入口始终是智能体会话；Workbench 只提供项目、轮次、Generation History（生成历史）、运行、资产和交付的可视管理，不提供第二个聊天界面。不得执行或建议旧 `prepare`、`execute`、`ingest`，不得创建 `task_spec.json`，也不得把旧 `workspace/*.html` 或 `results.html` 当作当前入口。

## 执行型启动协议（MUST）

### 触发分类

- **执行型触发**：用户明确要求使用 daoge-pic / 刀哥生图，或要求生成、编辑、衍生图片，导入、管理或选片，查看 Generation History，恢复、重试或取消运行，或准备交付。首次执行型触发必须先按下述顺序准备 Studio，再进行创作澄清或领域写入。
- **咨询/开发型触发**：用户只讨论架构、配置、源码、文档、测试，或尚未决定使用 daoge-pic。此类请求不得自动启动 Studio 或打开 Workbench，只回答或执行所请求的咨询/开发工作。

### 首次启动顺序

1. 先判断触发类型。
2. 执行型触发先解析当前会话绑定的稳定工作区。已有明确绑定时复用；无法从会话或宿主上下文得到时，只询问这一项前置条件。不得使用临时目录、Skill 安装目录或任意当前目录代替稳定工作区。
3. 每个独立智能体会话在该工作区的首次执行型触发都可以安全运行普通 `open`：

   ```bash
   node scripts/daoge.js open --workspace <path>
   ```

   `open` 原子地确保同工作区唯一健康 daemon，然后向 daemon 申请短期 opener claim。只有首个 claim 持有者调用系统默认浏览器；其他并发会话在活动 Workbench、最近已授权连接或未过期 claim 存在时返回 `opened:false, reused:true`，不重复调用 opener。启动和打开只属于本地准备，不是外部 Provider 调用，不需要生成确认，也不得自动执行 Provider 连接测试。
4. `open` 返回 `opened:true, reused:false` 时汇报已打开；返回 `opened:false, reused:true` 时汇报已复用。随后才创建或恢复**以当前真实 conversation ID 建立的独立 Studio Session**，再创建或恢复项目、任务和轮次上下文，然后开始创作澄清、计划与领域写入。不得颠倒这一顺序，创作澄清不可早于 `open`。

### 跨会话复用

同一稳定工作区的每个独立智能体会话都可在首次执行型触发调用普通 `open`；去重由共享 daemon 的内存 presence/open-claim 协议保证，不依赖会话间互相知道状态。已存在活动 Workbench、最近认证连接或未过期 claim 时，CLI 安全返回复用结果且不调用 OS opener。`open --force true` 只允许在用户明确要求新开标签时使用；Skill 的普通启动不得 force。协议不承诺 OS opener 能识别或聚焦既有标签，daemon 只保证普通 open 最多触发一个实际 opener。

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
5. 确认后执行预检。预检只验证当前配置快照、能力、素材、规格、依赖与运行项计划，不调用 Provider、不计费、不创建正式生成资产。
6. 预检证据仍与计划和 daemon 内存配置匹配时才创建运行；运行由 daemon 内持久 Worker 和 SQLite 队列处理，浏览器或终端关闭不影响已开始的工作。
7. 用会话汇报状态、异常与恢复选择。Workbench 用于查看实时结果、Generation History、导入素材、保留/复核/淘汰、回收、恢复和交付。

不得把用户需求写成遗留 JSON 任务文件，不得扫描目录推断业务状态，不得直接写 SQLite、manifest、journal、运行文件或 SSE 状态。

## 工作区、Schema 与密钥

每次必须使用稳定工作区根目录，传入 `--workspace <path>` 或明确设置 `DAOGE_WORKSPACE_ROOT`。没有稳定根目录时停止并向用户索取，不得回退到任意当前目录。

Studio 在工作区内维护：

```text
<workspace>/
  daoge-studio/
    studio.db
    Provider.db
    studio.json
    provider.env  # 仅既有工作区一次迁移输入；新工作区不创建
    runtime/
    runs/
    cache/
    evidence/
  daoge-assets/
    imports/
    generated/
    exports/
    trash/
  daoge-deliveries/
```

`studio.json` 只记录 Studio 身份、manifest schema 与规范工作区根。已有 manifest 的 `workspaceRoot` 必须与本次请求的规范根严格相同；不匹配时拒绝使用。`studio.db` 是项目、任务、轮次、计划、运行、资产关系、评审和交付的业务事实源；它只保存脱敏 Provider 历史快照，不保存 Profile 或秘密。

完整 Provider 配置只保存在精确路径 `<workspace>/daoge-studio/Provider.db`。这是受本地权限保护的明文敏感 SQLite（Unix `0600`，Windows 私有 ACL），不是加密数据库；拒绝符号链接并使用 `journal_mode=DELETE`、`secure_delete=ON`、`synchronous=FULL`、`foreign_keys=ON`。它支持多个 Profile，第一阶段最多一个 active，也允许零 active。新工作区不创建 `provider.env`；既有工作区首次升级时一次性导入，之后运行时只读 `Provider.db`，不覆盖或删除旧文件。`references/provider.env.example` 仅是显式 import-env 输入格式。

Workbench 提供 Profile 列表、新建、编辑、复制、激活、删除、本地校验、显式连接测试和保存并重启。API Key 与完整 Base URL 是 write-only，更新必须明确 `keep`、`replace` 或 `clear`；GET 只返回安全摘要。页面打开、加载或保存不得自动连接 Provider。

密钥与完整 Base URL 只在已授权本地写入表单、daemon 和 Worker 内存中短暂出现，绝不能进入 `studio.db`、事件、幂等响应、日志、快照、导出、诊断、打包、聊天或浏览器持久存储。Provider API 携带凭据的请求拒绝重定向。远程图片下载只接受无凭据 HTTP/HTTPS 公网地址并执行既有 SSRF 与大小校验。

## 本地访问授权与打开 Workbench

```bash
node scripts/daoge.js studio --workspace <path>
node scripts/daoge.js open --workspace <path>
```

`open` 必须先通过已授权本地 API 获取 daemon 内存 opener claim，再由唯一持有者使用跨平台安全 opener：macOS `open`、Linux `xdg-open`、Windows `rundll32.exe url.dll,FileProtocolHandler`；不得通过 shell 字符串拼接 URL。不支持的平台明确失败，且必须释放自己的 claim。`open --force true` 仅绕过活动/最近 presence，不得抢占另一个未过期 claim。

每个 daemon 生成高熵 local capability。Workbench 只可通过 URL fragment bootstrap 换取 `HttpOnly`、`SameSite=Strict` Cookie，随后立即清除 fragment；CLI 使用 Bearer capability。Open claim token 由 CLI 生成，只以哈希形式短暂保存在 daemon 内存，不进入响应、数据库、事件、日志或 runtime 文件。同一进程受控重启复用最近 Workbench presence；独立 daemon 进程重置。Workbench 的 UI Session 使用每标签页 `sessionStorage` 身份，reload 复用而标签间不共享；它不代表任何智能体会话，也不得让其他会话的 Session context 更新抢占当前 route。除最小健康检查外，API、媒体、ZIP 和 SSE 都要求当前 Studio 授权，写入还校验 Host、Origin 和 Content-Type，任意 localhost 页面不得因重启获得权限。不得输出、记录、复制或分享 capability、bootstrap URL、Cookie、session token、claim token 或 runtime 私密字段；`status` 只能返回脱敏 daemon 信息。

## 受控命令

统一入口：

```bash
node scripts/daoge.js <command> --workspace <stable-workspace>
```

CLI 必须在启动 daemon 或初始化工作区前拒绝未知命令、缺失必需参数和无效数值。公开命令完整列表如下；`delivery-complete` **不是**公开 CLI 命令。

```bash
node scripts/daoge.js studio --workspace <path>
node scripts/daoge.js open --workspace <path> [--force true]
node scripts/daoge.js provider-list --workspace <path>
node scripts/daoge.js provider-import-env --workspace <path>
node scripts/daoge.js provider-create --workspace <path> --name <name> --provider <id> --model <model> --base-url <url> --api-key <key> [--active true]
node scripts/daoge.js provider-update --workspace <path> --profile <id> --version <n> --base-url-action <keep|replace|clear> --api-key-action <keep|replace|clear>
node scripts/daoge.js provider-copy --workspace <path> --profile <id>
node scripts/daoge.js provider-activate --workspace <path> --profile <id>
node scripts/daoge.js provider-delete --workspace <path> --profile <id>
node scripts/daoge.js provider-validate --workspace <path> --profile <id>
node scripts/daoge.js provider-test --workspace <path> --profile <id>
node scripts/daoge.js restart --workspace <path>
node scripts/daoge.js session --workspace <path> --conversation <conversation-id>
node scripts/daoge.js project --workspace <path> --name "项目名称" [--description <text>] [--session <session-id>]
node scripts/daoge.js archive-project --workspace <path> --project <project-id>
node scripts/daoge.js session-context --workspace <path> --session <session-id> [--project <project-id>] [--task <task-id>] [--round <round-id>]
node scripts/daoge.js task --workspace <path> --project <project-id> --name "创作任务" [--task-type <task-type-id>] [--intent <json>] [--session <session-id>]
node scripts/daoge.js task-type --workspace <path> --name "自定义任务类型" [--definition <json>]
node scripts/daoge.js style-kit --workspace <path> --name "风格包" [--definition <json>] [--assets <asset-id,...>]
node scripts/daoge.js brand-kit --workspace <path> --name "品牌包" [--definition <json>] [--assets <asset-id,...>]
node scripts/daoge.js delivery --workspace <path> --project <project-id> --name "交付包" --assets <asset-id,...> [--creative-record true]
node scripts/daoge.js delivery-update --workspace <path> --delivery <delivery-id> --assets <asset-id,...>
node scripts/daoge.js delivery-ready --workspace <path> --delivery <delivery-id>
node scripts/daoge.js delivery-draft --workspace <path> --delivery <delivery-id>
node scripts/daoge.js delivery-export --workspace <path> --delivery <delivery-id>
node scripts/daoge.js delivery-batch --workspace <path> --project <project-id> --name "批次名称" --deliveries <delivery-id,...>
node scripts/daoge.js delivery-batch-revise --workspace <path> --batch <batch-id> --deliveries <delivery-id,...>
node scripts/daoge.js delivery-batch-ready --workspace <path> --version <version-id>
node scripts/daoge.js round --workspace <path> --task <task-id> --purpose <exploration|refinement|variation|edit|fill> [--parent <round-id>] [--session <session-id>]
node scripts/daoge.js plan --workspace <path> --round <round-id> --version <n> --plan <json>
node scripts/daoge.js confirm --workspace <path> --round <round-id> --version <n>
node scripts/daoge.js preflight --workspace <path> --round <round-id> [--concurrency <1..1000>]
node scripts/daoge.js run --workspace <path> --round <round-id> --preflight <dry-run-id>
node scripts/daoge.js pause --workspace <path> --run <run-id>
node scripts/daoge.js resume --workspace <path> --run <run-id> --session <session-id>
node scripts/daoge.js cancel --workspace <path> --run <run-id>
node scripts/daoge.js retry --workspace <path> --run <run-id> [--items <item-id,...>]
node scripts/daoge.js resolve-unknown --workspace <path> --run <run-id> --items <run-item-id,...>
node scripts/daoge.js status --workspace <path>
```

Skill 只能使用这些受控 Studio 命令或同源 Studio API；不得直接写 Studio 文件、SQLite 或运行状态。

## 幂等命令恢复

每个 CLI `POST` / `PUT` mutation 都接受可选全局参数 `--idempotency-key <stable-key>`。同一操作在网络断开、CLI 中断或响应不明后恢复时，复用**完全相同的命令、参数和 key**：

```bash
node scripts/daoge.js resume --workspace <path> --run <run-id> --session <session-id> --idempotency-key <same-key>
```

同一个 key 不得用于不同命令或不同 payload；冲突必须拒绝。未显式提供时 CLI 为本次 mutation 生成新 key，因此需要跨进程恢复的操作必须在首次调用前保存 key。`status`、`studio`、`open`、`restart` 与只读 `provider-list` 不发送该参数。

## 运行恢复与媒体边界

- Provider 限流或临时故障进入有界重试，不创建重复资产；认证、模型、参数或权限错误不自动重试。
- 外部请求结果不明时，运行项进入 `outcome_unknown`，绝不自动重放。用户核实无结果后，才可用 `resolve-unknown` 将指定项结案。
- daemon 重启时，未安全完成的运行进入 `resume_pending`；再次外部调用前必须在会话中得到用户确认，并以 `resume --session <session-id>` 记录。Workbench 只能显示等待状态，不能绕过会话继续。
- `retry` 只允许 `failed`、`blocked` 或 `retry_wait`；可用 `--items` 做单项重试。`outcome_unknown` 不可直接重试。
- `archive-project` 会拒绝仍有未完成生成的项目，再以事务方式归档项目、任务和轮次。
- daemon 启动时固定 active Profile 的 `profileId + configVersion`、Provider、模型和端点身份。活动 Profile、模型、端点、密钥、options 或 configVersion 变化后标记 `restartRequired`；重启前拒绝新运行，已有运行不静默切换。Worker 只领取与启动快照 `profileId + configVersion` 匹配的运行。
- 并发只属于 Generation Run：系统全局硬上限固定 `1000`，不可配置；预检未指定时默认 `4`，串行使用 `1`，显式值只接受 `1..1000`，超出拒绝且不截断。预检冻结非空 `executionConcurrency` 与解释用 `concurrencySource`，并发变化必须重新预检；`run` 只能采用绑定证据，队列时不能另改。Schema v20 保留历史业务数据并补齐性能索引与事件窗口。
- Provider 安全快照只含 profileId、profileName、configVersion、Provider、模型、端点身份与能力，不含 API Key、完整 URL 或调度设置。计划、Profile 版本或并发变化后必须重新预检。
- 导入、生成、回收和恢复使用 staging、原子移动、持久 journal 与启动对账。仅在当前 Studio 受管理根、相对路径、媒体类型、哈希、大小、资产和操作身份全部一致时恢复；路径越界、符号链接、冲突或歧义必须拒绝并留下脱敏事件。
- 下载、复制、交付导出和 ZIP 使用受验证 snapshot 流式读取。文件替换、路径穿越、跨 Studio/跨项目访问、超出条目或聚合上限、客户端断连都不能形成错误交付；失败时关闭文件描述符和临时 snapshot。

## Generation History 与交付

Generation History 必须按当前轮次列出全部持久 Generation Run，并要求用户或 Skill 显式选择运行。不得把活跃运行、最新运行或当前浏览器缓存静默当作已选择历史。选择后只显示该运行的计划版本、时间、短 ID、状态、运行项和结果资产；历史项不因刷新、SSE 重连或切换路由而改写。

项目当前选片是 SQLite 业务关系。交付权威状态为 `draft -> ready -> exported`；准备时冻结资产来源与评审，导出时建立冻结图片实体。源资产后续进入回收站，不得破坏已导出的交付下载、复制或 ZIP。

项目资产页使用服务端分页，默认每页 `24` 张，可选择 `16`、`24`、`32`、`48`、`64`、`96`。筛选与分页总数必须由当前 Studio、项目/任务/轮次范围和资产类型共同计算；“全选本页”只作用于当前页可见资产，并保持成果选择和 `keep` 评审语义一致。资产导入支持一次选择、拖入或粘贴多张图片，并逐张持久化、汇总成功与失败。交付图片提供明确的全选/取消全选。项目和任务列表提供搜索、状态筛选与分页，避免大列表无限延伸。

图片放大预览必须可直接切换成果选择，选择状态仍写入项目业务关系并保持 `keep` 评审语义。当前选片缩略条的移除按钮不得占据或遮挡标题内容。项目资产 ZIP 使用“项目名 + 项目资产 + 时间”，已导出交付 ZIP 使用“项目名 + 交付名 + 交付图片 + 时间”；HTTP 响应同时提供 UTF-8 文件名和稳定 ASCII 回退名。

Workbench 的普通“完成交付”通过内部 `/api/deliveries/complete` API 依次执行 `draft`、`prepare`、`export`，每阶段使用同一 operation identity 幂等恢复；失败保留已提交阶段。该 API 是 Workbench 内部主流程，不得伪装成公开 `delivery-complete` CLI 命令。高级 CLI 使用 `delivery*` 与 `delivery-batch*` 命令操作同一权威状态机。

## Workbench 边界与可访问性

Workbench 可用于：项目/任务/轮次导航、Generation History、SSE 实时状态、素材导入、范围筛选、搜索、放大/双图对比、选择、批注、来源检查、共享、回收、恢复、交付历史、下载/复制和 ZIP。

Workbench 必须在 SSE cursor 失效或本地事件批次溢出时先完成快照恢复，再推进 cursor；失败时从上次成功位置重试，不把页面状态当事实源。

Workbench 的模态图片查看必须具备 `role="dialog"`、`aria-modal`、初始焦点、Tab/Shift+Tab 焦点约束、Escape 关闭和关闭后焦点返回；搜索需要组合框/列表框键盘语义，错误与状态需要 live region，所有主要交互保留可见焦点。

Workbench 不可用于：自然语言对话、绕过会话确认、展示 Provider 密钥、直接指定任意绝对路径、匿名访问、跨 Studio 访问，或把浏览器状态、文件夹和 SSE 当业务事实。

## 回答规范

首次执行型触发按“首次状态汇报”完整说明启动与访问状态。后续更新只需简要说明 Workbench 已复用、Provider readiness、当前项目/任务/轮次、计划是否待确认、预检结果、明确选择的 Generation Run、成功/失败数量、恢复边界及下一步；不重复链接或访问地址。不要暴露 API Key、完整 Base URL、capability、bootstrap URL、Cookie、session token、完整 Provider 请求、内部 SQLite 细节、绝对媒体路径或临时文件。
