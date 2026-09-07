# DAOGE Pic vNext

DAOGE Pic 是面向智能体会话的本地图像创作管理平台。会话负责澄清、规划、确认和汇报；本地 Studio Workbench 负责查看项目上下文、Generation History（生成历史）、运行、资产、选择、复核和交付。

> **版本状态**：当前稳定正式版本为 [`5.10.3`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.10.3)；当前源码与本地候选制品版本为 `5.10.4`，GitHub Release 创建前不得声称它已正式发布。

vNext 是一次不兼容替换，不读取或迁移旧 `task_spec.json`、`prepare` / `execute` / `ingest` 命令、旧静态工作区、`results.html`、旧目录状态或旧运行记录。


本次架构协议为 `daoge-pic-skill-protocol 2.0.0`，独立于候选制品版本 `5.10.4`。daemon 负责机器闸门：运行必须携带绑定当前 `plan_hash`、`preflight_id`、`conversation_id` 的 `confirm_token`；确认挑战只能通过 Workbench 授权 Cookie 提交，预检和创建运行只接受 Skill/CLI，同一轮次只能创建一个初始 Generation Run。daemon owner 独占工作区初始化、schema migration 与权限强化；子 Worker 只附加既有数据库。Generation/media child-process pool 从零按需启动，持续满载时渐进扩容，Provider 目标并发最高为 `100`，在 429、临时故障或内存压力下自动降速，并公开脱敏健康状态。Provider 成功响应优先流式写入临时文件；control-plane 保持 API/SSE、队列与恢复。大计划支持 `--plan @-`，`--operation-name <verb:scope>` 与高级 `--idempotency-key` 互斥。Workbench 提供只读会话计划摘要、独立人工确认闸门、运行健康横幅与重启恢复反馈。
## 安装版本

当前稳定版仍为 `5.10.3`；其安装方式以对应 GitHub Release 为准。当前源码候选 `5.10.4` 必须先通过全部 Windows 验证。发布后的 GitHub Release `.tgz` 资产不表示包已发布到 npm registry。项目级安装和诊断使用：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.4/daoge-pic-5.10.4.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

Windows PowerShell：

```powershell
npm.cmd install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.4/daoge-pic-5.10.4.tgz"
npx.cmd daoge register-skill --scope project --workspace "C:\Users\<用户名>\source\<项目名>"
npx.cmd daoge doctor --workspace "C:\Users\<用户名>\source\<项目名>"
```

`register-skill` 在 Windows 创建 junction，在其他平台创建目录符号链接；目标已存在时直接失败，不删除或覆盖。`doctor` 不读取 Provider 密钥、不连接 Provider、不产生计费请求。完成后完整重启 Codex，使其重建 Skill registry。

需要全局安装时：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.4/daoge-pic-5.10.4.tgz"
daoge register-skill --scope user
```

Windows PowerShell：

```powershell
npm.cmd install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.4/daoge-pic-5.10.4.tgz"
daoge.cmd register-skill --scope user
```

`5.10.4` GitHub Release 创建前，上述 URL 只定义待发布流程，不表示资产已存在。源码维护者可安装本地 `daoge-pic-5.10.4.tgz` 候选进行验证。

需要直接试用 `main` 分支开发源码时，可继续使用 `npx skills add`：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-pic -a codex
```

这条开发命令不安装 npm 发布包、Git 标签、GitHub Release 或稳定发布包；执行后也需重启 Codex。

## 运行条件

- Node.js `22.17.0` 或更高版本；该下限保证 `node:sqlite` 无需实验开关且内置 SQLite 包含 Studio 搜索所需的 FTS5，并包含 libuv 1.51.0 的 Windows stat 文件身份修复。
- 一个稳定、可写的本地工作区根目录；不得把不稳定的当前目录、网络共享、同步盘、移动盘或 junction/symlink 根当作 Studio 工作区。
- 真实生成时，通过 Workbench 或受控 `provider-*` CLI 在 `<workspace>/daoge-studio/Provider.db` 配置并激活一个 Profile。

### Windows 安装与权限

Windows 应优先使用项目级安装，并以最终运行 DAOGE Pic 的同一个普通用户完成安装、Skill 注册、Studio 初始化和后续运行。项目级 junction 在当前用户可写的本地 NTFS 目录中不需要管理员权限；目标 `.agents/skills/daoge-pic` 已存在时仍会直接拒绝覆盖。PowerShell 执行策略阻止 npm 生成的 `.ps1` shim 时使用 `npm.cmd`、`npx.cmd` 或 `daoge.cmd`，不得为此放宽全局执行策略。示例：

```powershell
npm.cmd install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.4/daoge-pic-5.10.4.tgz"
npx.cmd daoge register-skill --scope project --workspace "C:\Users\<用户名>\source\<项目名>"
npx.cmd daoge doctor --workspace "C:\Users\<用户名>\source\<项目名>"
npx.cmd daoge open --workspace "C:\Users\<用户名>\source\<项目名>"
```

Studio 的敏感目录和 `Provider.db` 只允许当前用户 SID、SYSTEM 与 Administrators 完全控制。daemon owner 在一个 PowerShell 进程中为敏感目录、manifest、SQLite 与现有 sidecar 批量构造、应用并复核完整 DACL；不执行 `icacls /reset`。ACL 操作最长等待 10 秒，并区分超时、系统 PowerShell 缺失和权限拒绝。Generation/media Worker 不修改 ACL。应选择当前用户拥有的本地 NTFS 目录，避免系统目录、OneDrive/同步盘、UNC/网络共享、FAT/exFAT、移动盘和受企业策略限制的位置。`Provider.db` 仍是明文 SQLite；ACL 不能防止当前用户权限下的进程或管理员读取。

Windows daemon 身份通过系统 Windows PowerShell 中有界的 .NET WMI `Win32_Process` 查询，内外层都具有超时，不依赖 `wmic.exe` 或 PowerShell 模块。自动打开 Workbench 先使用 `rundll32.exe url.dll,FileProtocolHandler`，进程无法启动或立即非零退出时再调用无 shell 的 `explorer.exe`；都失败时保持失败关闭并提示运行 `daoge doctor`，不输出 capability 或 bootstrap URL。

正式发布包包含编译后的运行时和 Workbench，安装后无需手动构建。以下命令只用于包含 `src/`、`web/`、`tests/` 和构建配置的源码仓库检出：

```bash
npm install
npm run build
```

## 启动 Studio 与本地授权

在源码检出中使用：

```bash
node scripts/daoge.js open --workspace /absolute/workspace
node scripts/daoge.js studio --workspace /absolute/workspace  # 后续健康检查或复用
```

`studio` 确保当前工作区 daemon 可用并返回脱敏 daemon/Workbench 信息与安全 `open` 命令。普通 `open` 原子地确保 daemon，再通过已授权本地 API 申请短期 opener claim；只有首个 claim 持有者调用系统默认浏览器（macOS `open`、Linux `xdg-open`、Windows 先调用 `rundll32.exe url.dll,FileProtocolHandler`，无法启动时回退到无 shell 的 `explorer.exe`），其余并发调用返回 `{opened:false,reused:true}`。不支持的平台明确失败并释放自己的 claim，不拼接 shell 命令。系统 opener 不能保证识别或聚焦既有标签；daemon 保证普通 open 最多完成一次 opener 流程。`open --force true` 只用于用户明确要求新标签。

请求根尚无 Studio manifest 时，CLI 会先检查祖先目录。发现有效的父级 Studio 后，默认在任何 daemon、manifest 或 Workbench 副作用前拒绝初始化，并提示复用父级工作区；这可避免误把仓库子目录打开成数据不互通的第二个 Studio。只有用户明确需要独立的嵌套 Studio 时，才执行 `node scripts/daoge.js open --workspace /absolute/nested-workspace --allow-nested-studio true`。该参数不会合并或共享两个 Studio 的数据。

每个 daemon 都生成高熵 local capability。`open` 通过 URL fragment 完成一次 Cookie bootstrap 后立即清除 fragment。CLI 使用 Bearer capability。Claim token 只短暂保存哈希。“保存并重启”在同一 daemon 进程内复用授权与最近 Workbench presence；Workbench 依次显示安全关闭、重连和已恢复，并在重连后刷新权威快照。需要停止当前 daemon 时，Skill/CLI 先核对 runtime、owner PID、Studio、进程入口与工作区，再调用仅接受 Bearer 的本地受控关闭端点；Windows 不依赖外部 `SIGTERM` 执行异步清理。运行横幅展示 generation/media Worker 的待命、启动、正常、恢复、熔断状态；连续恢复失败时可执行授权的安全重启。诊断复制只含版本、协议、Worker 状态和脱敏错误码，不包含工作区路径、完整 URL、capability 或 Provider 密钥。

首次初始化在创建任何 Studio 文件前验证 manifest、父级 Studio 与工作区位置。Windows 额外拒绝同步盘/系统目录、UNC、非固定磁盘、非 NTFS 和已有 junction/symlink 组件；`doctor` 还验证原子 rename、SQLite 排他锁、私有 ACL、`sharp` 与默认浏览器关联，且不访问 Provider。新工作区不会创建 `provider.env`；Provider.db、资产、交付、缓存和 Worker 按需创建。

Studio daemon 是当前工作区的单实例后台进程；`runtime/daemon-lock.sqlite` 的长期 SQLite `BEGIN EXCLUSIVE` 是进程互斥权威。浏览器或终端关闭不会中断工作。空 Studio 不启动媒体 Worker；存在恢复或媒体任务时才按需创建。Generation pool 首次 tick 启动一个 Worker，持续满载时逐个扩容。两类 Worker 只附加已初始化的 manifest/SQLite，不修改 `.gitignore`、schema 或 ACL。

### 会话优先的启动顺序

Skill 先分类请求。用户明确使用 daoge-pic / 刀哥生图，或要求生成、编辑、衍生、导入、管理、选片、Generation History、恢复、重试、取消或交付，属于执行型触发；仅讨论架构、配置、源码、文档、测试或尚未决定使用，属于咨询/开发型，不自动启动 Studio。

执行型触发必须按以下顺序进行：

1. 解析已绑定的稳定工作区；没有可从上下文获得的绑定时，只询问该路径，不使用临时目录、安装目录或任意当前目录。
2. 每个独立智能体会话在该工作区首次执行时，都可安全运行普通 `node scripts/daoge.js open --workspace <path>`。这只是本地准备，不是 Provider 调用，不需要生成确认，也不会自动测试连接。daemon 在跨会话并发调用间只允许首个实际 opener，其他调用明确返回复用。请求根位于已有父级 Studio 内时必须复用父级；只有用户明确要求独立嵌套 Studio 才允许添加 `--allow-nested-studio true`。
3. 根据输出区分“已打开”（`opened:true,reused:false`）与“已复用”（`opened:false,reused:true`）；随后用当前真实 conversation ID 创建独立 Studio Session，再创建或恢复该会话自己的项目/任务/轮次上下文，然后开始创作澄清与计划。

去重由 daemon 的内存 Workbench presence/open-claim 保证，不再依赖“同一会话不重复调用”。活动 SSE、最近认证连接或未过期 claim 均使普通 open 返回 reused；opener 失败释放持有者自己的 claim，TTL 到期后可恢复。用户明确要求新标签时可执行 `open --force true`，但普通 Skill 启动不得 force，且 force 不抢占另一个未过期 claim。

如果自动打开失败但 daemon 健康，用户只需安全地重新运行 `node scripts/daoge.js open --workspace <path>`（安装包可用 `npx daoge open --workspace <path>`）。不要复制或回显 bootstrap URL、capability、Cookie、session token；裸 origin 也不是主要访问方式。没有 active Provider Profile 不阻止 Studio 和 Workbench 启动：先在 Workbench 的生成服务页配置并激活 Profile，再回到会话继续；除非用户明确点击连接测试，否则不会访问 Provider。

首次成功后，Skill 会用中文说明 Studio 已启动/连接，并按 CLI 结果说明 Workbench 已打开或已复用，同时说明会话与 Workbench 的职责、Provider readiness、当前项目/任务/轮次和下一步；不重复给出链接。Workbench 自己的 UI Session 使用每标签 `sessionStorage`，reload 保持而标签间隔离；它不代表任何智能体 Session。共享 SSE 仍显示整个 Studio 的项目更新，但后台会话上下文变化不得抢占用户当前 route。


## Provider 配置与下载安全

完整 Provider 配置只保存在 `<workspace>/daoge-studio/Provider.db`。它是受本地文件权限保护的**明文敏感 SQLite**（并非加密）：拒绝符号链接，Unix 权限 `0600`；Windows 以当前用户 SID、SYSTEM 与 Administrators 构造完整私有 DACL，并通过系统 .NET `FileSystemSecurity` API 批量应用和复核，不依赖 PowerShell 安全模块，失败时拒绝继续。数据库固定 `journal_mode=DELETE`、`secure_delete=ON`、`synchronous=FULL`、`foreign_keys=ON`。支持多个 Profile，第一阶段最多一个 active，也允许零 active：

- `openai-images`
- `gemini-image`
- `gemini-openai-compatible`
- `xai-grok-image`

Workbench 提供列表、新建、编辑、复制、激活、删除、本地校验、显式连接测试与“保存并重启”。API Key 和完整 Base URL 是 write-only；更新明确选择 `keep`、`replace` 或 `clear`，GET 只返回端点摘要和是否已设置密钥。页面打开、加载和保存不会自动连接 Provider；密钥不进入 studio.db、事件、幂等响应、日志、快照、导出、诊断、打包、聊天或浏览器持久存储。

既有工作区的 `provider.env` 只会在首次升级时一次性导入，`IMAGE_PROVIDER` 对应 Profile 设为 active；成功后运行时只读 Provider.db，不覆盖或删除旧文件。新工作区不创建 `provider.env`；`references/provider.env.example` 仅保留为显式 import-env 输入格式。Provider.db 与旧迁移文件都加入 `.gitignore` 并排除交付。

Provider API 凭据请求拒绝重定向。远程图片下载继续逐跳执行 SSRF、DNS 固定、实际远端地址、响应大小与格式校验。

并发只属于 Generation Run。持久队列的全局硬上限固定 `1000` 且不可配置；预检未指定时默认 `4`，串行使用 `1`，显式值只接受 `1..1000`，越界直接拒绝。Provider 活跃请求的安全目标上限为 `100`，由 daemon 自适应 Governor 按 Provider 成功率、429/临时错误和 Worker 资源压力动态调整；实际值会在运行状态中显示。Provider 响应使用流式落盘，只有小于 `1 MiB` 的结果保留在内存中：

```bash
node scripts/daoge.js preflight --workspace /absolute/workspace --round <round-id> --session <session-id> --concurrency 12
node scripts/daoge.js run --workspace /absolute/workspace --round <round-id> --preflight <dry-run-id> --confirm-token <daemon-token>
```

预检冻结 `executionConcurrency`（以及解释用 `concurrencySource`）；改变并发必须重新预检，`run` 阶段不能另改。daemon 启动时固定 active Profile 的 `profileId + configVersion`；配置变化后拒绝新运行，直到受控 `restart`，已有运行不会静默切换。

## 会话、Schema 与运行语义

1. 执行型请求先按“会话优先的启动顺序”打开或复用 Workbench，再绑定 Studio Session 并建立或恢复项目、任务和轮次上下文；咨询/开发型请求不自动启动。
2. 上下文就绪后再澄清创作要求。每个轮次保存版本化计划与提示词证据；参考图和遮罩只能来自当前项目资产或明确共享到跨项目素材的资产；未得到用户明确确认前，不得调用外部 Provider。
3. Workbench 的人工确认闸门只确认计划，不执行预检或创建运行。确认后会话先检查该轮次是否已有运行；已有运行时直接选择并汇报，没有运行时才执行不产生外部调用的预检。
4. 只有预检仍与当前计划和 daemon 配置匹配时才能创建该轮次唯一的持久 Generation Run。预检与入队只接受 Skill/CLI；不同预检、不同幂等键或旧 Workbench 页面都不能为同一轮次创建第二批。再次生成应新建变体、优化或补图轮次；失败项在原运行中受控重试。画幅、尺寸、分辨率和数量由会话动态指定；不使用 Provider 名称硬编码比例白名单，也不回退为方图。
5. Workbench 通过 SSE 展示状态与受管理资产；事件窗口不连续或本地批次溢出时，先恢复完整快照，再从新 cursor 继续。

`studio.json` 只保存 Studio 身份、manifest schema 和严格匹配的规范工作区根，不是业务事实源。`studio.db` 是项目、任务、轮次、计划、运行、资产关系、评审和交付的唯一业务事实源，并通过版本化 migration 演进。客户端不得直接写 manifest、SQLite、journal 或运行状态文件。

Generation Run 与 Run Item 是不同层级。每个轮次只创建一个初始运行；运行可以排队、执行、暂停、等待恢复确认或收敛为完成/部分/失败/取消，单项可在原运行内受控重试。单项从待领取进入外部请求、接收、持久化和成功，也可能进入有界重试、阻塞或 `outcome_unknown`。`outcome_unknown` 表示外部副作用不明，绝不自动重放。

Workbench 的 **Generation History（生成历史）** 按当前轮次列出全部持久运行，并要求显式选择具体运行；它不会把“活跃运行”或“最新运行”静默冒充用户正在查看的历史项。选择后显示计划版本、创建时间、短 ID、运行状态、运行项及其结果资产。

## 幂等恢复

所有通过 CLI 发出的 `POST` / `PUT` mutation 都支持命名操作，恢复场景仍接受高级参数：

```bash
--operation-name <verb:scope>
--idempotency-key <stable-key>
```

`operation-name` 由 daemon 与路由、规范化后的 payload 派生稳定 key；同一对象 JSON 的键顺序不会改变幂等身份。`operation-name` 与 `idempotency-key` 互斥。高级 key 仍不能用于不同命令或不同 payload。未显式提供任一参数时，CLI 会为本次调用生成随机 key，不能用于跨进程恢复；需要跨进程恢复时首选 `--operation-name`，或在首次调用前保存显式 `--idempotency-key`。`status`、`studio`、`open`、`restart` 与只读 `provider-list` 不发送该参数。

大计划使用 `--plan @-` 从 stdin 传输：

```bash
some-agent | node scripts/daoge.js plan --workspace /absolute/workspace --round <round-id> --version <n> --plan @- --operation-name plan:round-id:v<n>
```

每次命令最多一个 `@-`；stdin 必须是单个 JSON 对象，最大 8 MiB。不要把 `--intent @- --plan @-` 当作两个输入，它们不会分别读取 stdin。

## 恢复、媒体与交付

- Provider 限流与临时错误进入有界重试；认证、模型和参数错误不会自动重试。
- daemon 重启后，不安全的在途外部调用进入 `resume_pending`，必须在会话中再次确认并记录 Studio Session；Workbench 不能绕过确认。
- `failed`、`blocked` 和 `retry_wait` 可受控重试；`outcome_unknown` 只能在用户核实无结果后显式结案。
- 导入、生成、回收与恢复使用 staging、原子移动、带 owner/heartbeat 的持久 journal 和启动对账。活动操作不会被恢复扫描抢占，过期遗留操作才可恢复；路径、媒体类型、哈希、大小、资产和操作身份必须全部一致，冲突或歧义会拒绝，不会猜测提交。
- Worker 与媒体 worker 使用 watchdog、有界队列、稳定运行窗口和有界重启；已确认 Provider 结果之外的中断不会自动重放。对账将缺失文件持久标记为不可用，恢复确认前不能作为参考图、遮罩或交付候选。
- 参考图和遮罩在计划写入、确认、预检、排队和 Worker 读取前均校验项目边界：只能引用当前项目资产或明确 `shared_across_projects` 共享素材；同一 Studio 的其他项目未共享资产一律拒绝。
- 同一交付的并发导出会收敛到同一个冻结目录和文件集；不同交付仍可独立并行。

项目当前选片是数据库中的业务关系，不是浏览器筛选或文件夹。交付权威状态机是 `draft -> ready -> exported`；准备阶段冻结资产来源和评审事实，导出阶段建立冻结实体图片。源资产后来进入回收站，不会破坏已导出的交付文件。

Workbench 的“完成交付”使用内部同源 API `/api/deliveries/complete`，按 `draft`、`prepare`、`export` 三个幂等阶段从已提交位置恢复；**它不是公开的 `delivery-complete` CLI 命令**。公开 CLI 提供 `delivery`、`delivery-update`、`delivery-ready`、`delivery-draft`、`delivery-export` 以及交付批次命令，适合受控高级操作。

## Workbench 能力边界

Workbench 用于人工确认计划，以及项目/任务/轮次导航、Generation History、SSE 实时状态、素材批量导入、范围筛选、搜索、放大/双图对比、选择、批注、来源检查、共享、回收、恢复、交付历史、下载/复制和 ZIP。人工确认只激活计划，预检与运行创建由会话负责。图片放大预览可直接选为成果或取消成果，当前选片缩略卡片会为长标题和独立移除按钮保留空间。项目资产采用服务端分页，默认每页 24 张，可切换 16/24/32/48/64/96，并提供只作用于当前页的全选/取消全选；交付图片提供明确的全选/取消全选。项目首页和项目任务列表提供搜索、生命周期筛选与分页，避免项目或任务无限向下堆叠。项目资产和已导出交付 ZIP 使用项目名、交付名及下载时间生成可区分文件名。交付失败会保留当前阶段，可安全重试；已导出交付按冻结文件领取。参考素材选择只显示当前项目资产和明确共享素材。

键盘和辅助技术契约包括可见焦点、搜索组合框语义、状态/错误 live region，以及模态图片查看器的初始焦点、Tab 焦点约束、Escape 关闭和关闭后焦点返回。

Workbench 不提供自然语言对话，不绕过会话确认，不显示 Provider 密钥，不接受任意绝对文件路径，也不把浏览器状态、目录或 SSE 当业务事实源。

受控 CLI 的完整列表与会话执行规则见 [SKILL.md](SKILL.md)。详细权威需求见 [vNext 升级规格](docs/daoge_pic_vnext_upgrade_spec_zh.md)。5.10.4 候选验证与 5.10.3、5.10.2、5.10.1、5.10.0、5.9.1 及更早稳定版历史证据分章记录在 [验证记录](docs/vnext_verification_evidence_zh.md)；最终资产哈希由 GitHub Release 与 sidecar 在包外记录。
