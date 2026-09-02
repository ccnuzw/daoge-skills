---
name: daoge-pic
description: 会话优先的本地图像创作管理 Skill。把用户需求收敛为可确认的创作计划，启动受控的生成运行，并通过本地 DAOGE Pic Studio Workbench 管理资产、选择、复核和交付。
---

# DAOGE Pic vNext

当前包版本和稳定正式版本是 `5.7.0`。

用户可见沟通使用中文。主入口始终是智能体会话；Workbench 只提供项目、轮次、Generation History（生成历史）、运行、资产和交付的可视管理，不提供第二个聊天界面。不得执行或建议旧 `prepare`、`execute`、`ingest`，不得创建 `task_spec.json`，也不得把旧 `workspace/*.html` 或 `results.html` 当作当前入口。

## 会话工作法

1. 先澄清目标、受众、数量、画幅、风格、限制条件、参考素材与交付用途。
2. 用 Studio Session 将当前会话绑定到稳定工作区，再创建项目、创作任务和创作轮次。
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
    studio.json
    provider.env
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

`studio.json` 只记录 Studio 身份、manifest schema 与规范工作区根。已有 manifest 的 `workspaceRoot` 必须与本次请求的规范根严格相同；不匹配时拒绝使用。`studio.db` 是项目、任务、轮次、计划、运行、资产关系、评审和交付的唯一业务事实源，并由版本化 migration 演进。

首次初始化必须先确认 `references/provider.env.example` 可读取，再产生持久副作用。模板缺失、manifest 无效或根目录不匹配时必须零持久副作用失败，不得留下半成品目录、manifest、数据库、配置或 `.gitignore` 条目。成功时才创建 `daoge-studio/provider.env`，已有文件绝不覆盖；其余资产、缓存和交付目录按需建立。

用户只在 `provider.env` 配置一个活动 Provider、端点、模型、密钥和 Provider 固有能力开关；画幅、尺寸、数量与运行并发不属于此文件。支持的 `IMAGE_PROVIDER`：`openai-images`、`gemini-image`、`gemini-openai-compatible`、`xai-grok-image`。

密钥仅在 daemon/Worker 内存中出现，绝不能写入数据库、事件、快照、导出物、聊天内容或 Workbench。Provider API 携带凭据的请求拒绝重定向。远程图片下载只接受无凭据的 HTTP/HTTPS 公网地址，逐跳校验 DNS/重定向、固定已验证地址并核对实际远端地址，限制响应/base64 大小；私网、loopback、保留地址、DNS rebinding、超限或无效图片都必须拒绝。

## 本地访问授权与打开 Workbench

```bash
node scripts/daoge.js studio --workspace <path>
node scripts/daoge.js open --workspace <path>
```

`open` 必须使用跨平台安全 opener：macOS `open`、Linux `xdg-open`、Windows `rundll32.exe url.dll,FileProtocolHandler`；不得通过 shell 字符串拼接 URL。不支持的平台明确失败。

每个 daemon 生成高熵 local capability。Workbench 只可通过 URL fragment bootstrap 换取 `HttpOnly`、`SameSite=Strict` Cookie，随后立即清除 fragment；CLI 使用 Bearer capability。除最小健康检查外，API、媒体、ZIP 和 SSE 都要求当前 Studio 授权，写入还校验 Host、Origin 和 Content-Type。不得输出、记录、复制或分享 capability、bootstrap URL、Cookie 或 runtime 私密字段；`status` 只能返回脱敏 daemon 信息。

## 受控命令

统一入口：

```bash
node scripts/daoge.js <command> --workspace <stable-workspace>
```

CLI 必须在启动 daemon 或初始化工作区前拒绝未知命令、缺失必需参数和无效数值。公开命令完整列表如下；`delivery-complete` **不是**公开 CLI 命令。

```bash
node scripts/daoge.js studio --workspace <path>
node scripts/daoge.js open --workspace <path>
node scripts/daoge.js config --workspace <path> --worker-concurrency <1..1000>
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
node scripts/daoge.js preflight --workspace <path> --round <round-id>
node scripts/daoge.js run --workspace <path> --round <round-id> --preflight <dry-run-id> [--concurrency <1..1000>]
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

同一个 key 不得用于不同命令或不同 payload；冲突必须拒绝。未显式提供时 CLI 为本次 mutation 生成新 key，因此需要跨进程恢复的操作必须在首次调用前保存 key。`status`、`studio`、`open`、`restart` 不发送该参数；`config` 是 `PUT` mutation，支持该参数。

## 运行恢复与媒体边界

- Provider 限流或临时故障进入有界重试，不创建重复资产；认证、模型、参数或权限错误不自动重试。
- 外部请求结果不明时，运行项进入 `outcome_unknown`，绝不自动重放。用户核实无结果后，才可用 `resolve-unknown` 将指定项结案。
- daemon 重启时，未安全完成的运行进入 `resume_pending`；再次外部调用前必须在会话中得到用户确认，并以 `resume --session <session-id>` 记录。Workbench 只能显示等待状态，不能绕过会话继续。
- `retry` 只允许 `failed`、`blocked` 或 `retry_wait`；可用 `--items` 做单项重试。`outcome_unknown` 不可直接重试。
- `archive-project` 会拒绝仍有未完成生成的项目，再以事务方式归档项目、任务和轮次。
- daemon 启动时固定 Provider、模型、端点身份与工作区并发上限。新 Studio 上限为 `1000`；Schema v18 会将既有 Studio 上限迁移为 `1000`。`config --worker-concurrency <1..1000>` 更新期望设置，`restart` 后生效。`run --concurrency <1..1000>` 的单次请求由会话明确指定、冻结到运行记录且不得超过生效上限。
- 预检快照不含 API Key 或完整 Provider URL。计划或安全 Provider 快照变化后必须重新预检；适配器不能无歧义承载的输出规格必须拒绝，绝不静默回退方图。
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

每次会话更新简要说明：当前项目/任务/轮次、计划是否待确认、预检结果、明确选择的 Generation Run、成功/失败数量、恢复边界及下一步。不要暴露 API Key、capability、Cookie、完整 Provider 请求、内部 SQLite 细节、绝对媒体路径或临时文件。
