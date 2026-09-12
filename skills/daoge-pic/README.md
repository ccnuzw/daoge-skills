# DAOGE Pic vNext

> **当前稳定正式版本**：[`5.13.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.13.0)
> **当前源码与运行时**：`5.13.0`（已发布；`5.12.0` 及更早版本为不可变历史版本，不与本版本 daemon 互用）。
> **Skill protocol**：`daoge-pic-skill-protocol 2.0.0`，独立于制品版本；`5.13.0` 不是协议版本。
> **安装来源**：GitHub Release `.tgz` 资产；这不表示包已发布到 npm registry。

DAOGE Pic 是 Agent + 创作者工作台协作的本地图像创作管理平台。Agent 负责澄清、规划、确认、受控执行和风险恢复；Studio Workbench 负责符合创作者操作习惯的结构化项目/任务/轮次创建、Provider 设置、创作谱系、Generation History、素材、选片、复核和交付。

vNext 是一次不兼容替换：不读取或迁移旧 `task_spec.json`、旧 `prepare` / `execute` / `ingest` 命令、旧静态工作区、`results.html`、旧目录状态或旧运行记录。

## 目录

- [5.13.0 重点升级](#5130-重点升级)
- [5.11.0 历史升级](#5110-重点升级)
- [快速安装](#快速安装)
- [启动与会话顺序](#启动与会话顺序)
- [Workbench 能做什么](#workbench-能做什么)
- [核心概念](#核心概念)
- [Provider、密钥与并发](#provider密钥与并发)
- [安全边界](#安全边界)
- [常用 CLI](#常用-cli)
- [开发与验证](#开发与验证)
- [文档与发布证据](#文档与发布证据)

## 5.13.0 重点升级

| 领域 | 变化 | 用户收益 |
| --- | --- | --- |
| 创作谱系与导航 | 编辑模式新增完整节点坐标系小地图，点击/拖动定位视口；小地图不再冒泡成画布框选，项目上下文与统计区保持清晰分栏。 | 大型谱系可以快速定位，导航不会误触发编辑操作。 |
| 资产预览与确认 | 图片预览恢复 `0.75x–2x` 放大范围；归档和回收站统一使用可访问确认弹窗、忙碌态和错误反馈。 | 可检查大图细节，危险操作确认后会真正执行且不会重复弹窗。 |
| 结构化创建 | 任务与轮次恢复探索、变体、精修、编辑和补图的推荐数量/画幅；模板只覆盖自身提供的默认值，其余回退到通用推荐。 | 无模板或部分模板也能得到可用初始值，切换目的与套用推荐值行为一致。 |
| 发布运行时 | 运行时升至 `5.13.0`，计划路径使用 `/plan`，受控 shutdown 使用 `daemon-shutdown`，包门禁验证最终 tarball 的版本和必需入口。 | 当前源码、CLI、API 和交付制品保持同一契约，旧包不会被误当作新版本。 |
| Provider 与安全 | `compatible_public` 拒绝明文 HTTP；本地代理和企业私有端点必须显式选择信任模式；Provider.db v3 与 system backend fail-closed 规则继续有效。 | 凭据不会在错误端点策略下发送，错误请求不会执行副作用。 |

## 5.11.0 重点升级

| 领域 | 变化 | 用户收益 |
| --- | --- | --- |
| 创作谱系 | 新增可视画布，覆盖项目、任务、轮次、计划、运行、运行项、资产、共享素材、交付、任务类型、风格包和品牌包。 | 一眼看清作品从需求到交付的关系，不再靠列表拼上下文。 |
| Generation History | 运行项改为服务端分页，支持 25/50/100 页大小、状态筛选、序号定位、状态计数、输出缩略图和 URL 持久化。 | 大批量生成不再一次性加载全部运行项；定位失败项和重试更快。 |
| 运行恢复 | 结果队列支持本页可重试项选择、批量重试、单项详情和安全恢复建议。 | 失败、阻塞、等待重试和未知结果更容易处理，不误触发重复生成。 |
| 项目资产 | 项目资产 ZIP 按请求 `assetId` 做 scoped 查询和保序校验，不受当前分页窗口限制。 | 已选图片即使不在当前页，也能正确打包。 |
| 协议协商 | Bearer Skill/CLI 请求必须声明 `x-daoge-skill-protocol: daoge-pic-skill-protocol/2.0.0`；CLI 复用 daemon 前校验协议、运行时版本和 Studio ID。 | 避免旧 CLI、旧 daemon 或错误工作区混用。 |
| 导出与诊断 | 创作谱系导出、诊断和运行摘要过滤 Provider、完整 URL、路径、token、content hash、storage path、capability、cookie 和外部请求字段。 | 降低把本地敏感信息带进聊天、日志或交付物的风险。 |
| 可访问性 | 危险操作和 Provider 敏感操作统一使用 Workbench accessible dialog，保留焦点约束、Escape 关闭和焦点返回。 | 键盘和辅助技术可稳定操作。 |

## 快速安装

### 运行条件

- Node.js `22.17.0` 或更高版本。
- 一个稳定、可写的本地工作区根目录。
- Windows 工作区必须是当前用户拥有的本地 NTFS 目录；不要使用 OneDrive/同步盘、UNC/网络共享、移动盘、WSL 挂载路径、系统目录或 junction/symlink 根。
- 真实生成前，需要在 Workbench 或受控 CLI 中配置并激活一个 Provider Profile。

### 推荐：项目级安装

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.13.0/daoge-pic-5.13.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

Windows PowerShell：

```powershell
npm.cmd install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.13.0/daoge-pic-5.13.0.tgz"
npx.cmd daoge register-skill --scope project --workspace "C:\Users\<用户名>\source\<项目名>"
npx.cmd daoge doctor --workspace "C:\Users\<用户名>\source\<项目名>"
```

`register-skill` 在 Windows 创建 junction，在其他平台创建目录符号链接；目标已存在时直接失败，不删除或覆盖。`doctor` 不读取 Provider 密钥、不连接 Provider、不产生计费请求。安装和注册后完整重启 Codex，使 Skill registry 重新加载。

### 全局安装

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.13.0/daoge-pic-5.13.0.tgz"
daoge register-skill --scope user
```

Windows PowerShell：

```powershell
npm.cmd install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.13.0/daoge-pic-5.13.0.tgz"
daoge.cmd register-skill --scope user
```

上述 URL 指向 `5.13.0` GitHub Release 的不可变正式资产；直接安装 `main` 源码不等同于该发布制品。

### 直接试用 main 分支源码

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-pic -a codex
```

这条开发命令不安装 npm 发布包、Git 标签、GitHub Release 或稳定发布包；执行后也需要重启 Codex。

## 启动与会话顺序

源码检出中使用：

```bash
node scripts/daoge.js open --workspace /absolute/workspace
node scripts/daoge.js studio --workspace /absolute/workspace
```

安装包中使用：

```bash
npx daoge open --workspace /absolute/workspace
npx daoge studio --workspace /absolute/workspace
```

`open` 会先确认工作区身份，再确保同工作区唯一健康 daemon，最后通过本地授权 API 申请短期 opener claim。只有首个 claim 持有者调用系统默认浏览器：macOS `open`、Linux `xdg-open`、Windows 先调用 `rundll32.exe url.dll,FileProtocolHandler`，失败时回退到无 shell 的 `explorer.exe`。其余并发调用返回 `{opened:false,reused:true}`，不重复触发 opener。

`studio` 用于后续健康检查或复用，输出脱敏 daemon/Workbench 信息与安全 `open` 命令；不会打印 bootstrap URL、capability、Cookie、session token 或完整 Provider 信息。

### 会话优先的启动顺序

1. 先判断请求类型。**执行型触发**包括使用 daoge-pic / 刀哥生图、生成、编辑、衍生、导入、管理、选片、查看 Generation History、恢复、重试、取消或交付。**咨询/开发型触发**包括只讨论架构、配置、源码、文档、测试或尚未决定使用；这类请求不自动启动 Studio 或打开 Workbench。
2. 执行型触发先解析稳定工作区。已有绑定就复用；无法从上下文获得时，只询问这个路径。不要使用临时目录、Skill 安装目录、任意 cwd 或任意当前目录代替稳定工作区。
3. 每个独立智能体会话在该工作区首次执行时，都可以安全运行普通 `node scripts/daoge.js open --workspace <path>`。这是本地准备，不是外部 Provider 调用，不需要生成确认，也不得自动执行 Provider 连接测试。去重由 daemon 的内存 presence/open-claim 协议负责：首个 claim 持有者调用默认浏览器，活动 Workbench、最近认证连接或未过期 claim 会让其他调用返回 reused。
4. 根据 CLI 结果汇报访问状态：`opened:true,reused:false` 表示已打开；`opened:false,reused:true` 表示已复用。OS opener 不承诺聚焦既有标签，也不得声称一定会聚焦标签；daemon 只保证普通 open 最多触发一个实际 opener。
5. Workbench 已打开或复用后，才用当前真实 conversation ID 创建或恢复独立 Studio Session，再创建或恢复项目/任务/轮次上下文，然后开始创作澄清、计划与领域写入。首次状态汇报必须包含 Studio 已启动或已连接、Workbench 已在默认浏览器打开或已复用现有 Workbench、会话中描述和确认创作、Workbench 用于 Provider、素材、Generation History、选片和交付、Provider readiness、当前项目/任务/轮次、下一步。
6. 如果自动打开失败但 daemon 健康，只提示用户安全地重试 `node scripts/daoge.js open --workspace <path>`；安装包语境可用 `npx daoge open --workspace <path>`。不要复制或要求用户粘贴 bootstrap URL、capability、Cookie、session token；裸 Workbench origin 也不是主要访问方式。
7. 没有 active Provider Profile 不阻止 Studio 启动或 Workbench 打开。先在 Workbench 的生成服务页配置并激活 Profile，再回到会话继续；页面打开、加载和保存不得自动测试连接，只有用户明确发起的连接测试才会访问 Provider。
8. `open --force true` 只用于用户明确要求新开标签；普通启动不得 force。`--allow-nested-studio true` 只表示用户确认要在已有父级 Studio 内创建另一个隔离 Studio；它不合并或共享两个 Studio 的数据。

请求根没有 Studio manifest 时，CLI 会先检查祖先目录。发现有效父级 Studio 后，默认在创建 daemon、manifest 或 Workbench 前拒绝初始化，避免误把仓库子目录变成数据不互通的第二个 Studio。

## Workbench 能做什么

| 区域 | 主要用途 | 关键边界 |
| --- | --- | --- |
| 项目 / 任务 / 轮次导航 | 管理项目、任务、轮次和当前上下文；支持 Studio 直接创建、搜索与分页大列表。新建项目优先选择模板并带出默认名称、说明提示、示例、优先准备的素材和创建后必要上下文；新建任务会读取当前项目模板，按品牌视觉、电商商品图、社媒内容图、角色/IP 或自定义项目重排推荐目标，并自动套用任务名、目标数量、画幅、首轮目的、素材需求、变化维度、精修目标、保持约束和字段提示；新建轮次优先选择轮次目的并套用默认值。创建后直接切换到当前上下文，素材准备清单在表单和资产导入引导中展示。 | 事实以 `studio.db` 为准，不以浏览器状态为准；直接创建只建立结构化上下文，不触发 Provider。 |
| 创作谱系 | 项目工作区首页；查看项目、任务、计划、运行、资产、交付和规则资料节点关系；在项目地图、任务创作流、轮次对比、资产分支、交付路线之间切换；保存布局、视口、筛选、分组和人工软连线；从节点检查器直接选片、继续创作、设置参考、获取图片或记录不采用原因。没有当前草稿轮次时，作为参考会自动使用唯一草稿轮次，或让用户选择/新建草稿轮次后加入。 | 只保存画布布局，不替代项目、运行、资产、交付事实；Studio 动作只创建/选择上下文，不预检、运行或访问 Provider。 |
| Generation History | 按当前轮次列出持久 Generation Run；显式选择运行后查看计划版本、运行状态、运行项、输出缩略图和恢复动作。 | 不把“最新运行”或“活跃运行”静默当成已选择历史。 |
| 资产 | 导入、分页、筛选、选片、复核、共享、回收、恢复、来源检查和 ZIP 下载。资产页会按当前项目/任务/草稿轮次的素材需求显示导入引导，导入时可选择“商品主体图、品牌包/Logo、平台规格、核心卖点”等需求，Studio 会保存脱敏的素材需求与默认参考用途；导入到草稿轮次时会自动加入参考素材上下文。状态图例统一解释未定、成果 / keep、不采用、可继续和交付冻结。 | “全选本页”只作用于当前页；未定资产不能进入交付，成果 / keep 才可创建交付草稿，不采用可转成反例或下一轮修正目标，可继续创作必须创建新轮次；参考素材只来自当前项目或明确共享素材；已进入确认或运行流程的轮次不能由 Studio 直接改参考上下文。 |
| 放大预览 / 双图对比 | 查看图片、切换成果选择、复制或下载。 | 选择状态写入项目业务关系，并保持 `keep` 评审语义；交付冻结来自已准备或已导出的交付实体，不受源资产后续回收影响。 |
| 交付 | 创建草稿、准备、导出、查看历史、下载/复制冻结文件和 ZIP。 | 状态机为 `draft -> ready -> exported`；导出后不受源资产回收影响。 |
| Provider 设置 | Profile 新建、编辑、复制、激活、删除、本地校验、显式连接测试、显式读取模型列表、模型选择；展示 Provider Descriptor、端点信任模式和 Profile 级安全限额。 | API Key 和完整 Base URL 是 write-only，GET 只返回安全摘要；删除 active Profile 需要显式确认；被未完成或可恢复运行引用的 Profile 不能修改或删除；daemon 会在旧配置任务排空后热加载活动配置，已完成预检需重新预检。生成、编辑和模型列表请求固定 DNS 结果、复核远端地址并拒绝重定向。 |
| 运行健康 | 查看 daemon、generation worker、media worker 的待命、启动、正常、恢复、熔断状态；安全重启故障池；复制脱敏诊断。 | 诊断不包含工作区路径、完整 URL、capability、Cookie、session token 或 Provider 密钥。 |

键盘和辅助技术契约：所有主要交互保留可见焦点；搜索使用 combobox/listbox 语义；状态和错误使用 live region；模态图片查看和确认对话框具备 `role="dialog"`、`aria-modal`、初始焦点、Tab/Shift+Tab 焦点约束、Escape 关闭和关闭后焦点返回。

Workbench 不提供自然语言对话，不绕过会话确认，不展示 Provider 密钥，不接受任意绝对文件路径，不允许匿名访问或跨 Studio 访问，也不把浏览器状态、文件夹或 SSE 当业务事实源。

创建入口是双入口、单工作流：可以由 Agent 从自然语言创建，也可以由 Studio 表单/选项创建；两者写入同一 Studio 事实源，后续生成仍必须由 Agent 输出可确认计划、用户确认、预检并创建唯一运行。

创建项目、任务或轮次后，Workbench 直接切换到当前上下文和对应页面，不显示额外的创建完成提示或推荐下一步卡片。素材准备清单在创建表单和资产导入引导中展示；直接创建仍只建立结构化上下文，不执行确认、预检、Generation Run 或 Provider 调用。

项目模板会影响后续新建任务表单：例如“电商商品图”默认优先推荐“商品主图探索”，目标数量为 8 张、画幅 1:1，并提示商品主体图、品牌包 / Logo、平台规格和核心卖点；“角色 / IP 设计”会优先推荐角色形象探索和动作 / 表情变体，并提示固定外观与不可改变特征。

项目模板的唯一事实源是后端 `src/vnext/domain/project-templates.ts` 和 `GET /api/project-templates`；Workbench 只消费 API 返回的模板版本、任务默认、素材需求和示例，不维护第二套品牌/电商/社媒/角色模板，只保留无模板时的通用任务/轮次 fallback。规则资料只包含任务类型、风格包和品牌包；共享图片属于“共享素材”，不会混入规则资料列表。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| Workspace | 一个稳定本地工作区根目录。所有 Studio 数据都在其下创建和恢复。 |
| Studio | 当前工作区的本地单实例 daemon、数据库和媒体目录。 |
| Studio Session | 每个真实智能体 conversation 的独立上下文；Workbench 标签页不是智能体 Session。 |
| Project | 一个创作项目，拥有任务、资产、选片和交付。 |
| Task | 项目内的一组创作目标，可关联任务类型、风格包和品牌包。 |
| Round | 一次探索、优化、变体、编辑或补图轮次。再次生成应新建轮次。 |
| Plan | 版本化创作计划，包含 operation、提示词、数量、输出规格、参考素材和风险。 |
| Generation Run | 一个已确认计划对应的持久运行；每个轮次只允许一个初始运行。 |
| Run Item | 运行中的单个生成项，拥有序号、状态、尝试次数、输出资产和恢复动作。 |
| Asset | 导入、生成或导出的受管理图片实体。 |
| Delivery | 从项目选片冻结出的交付包，导出后按冻结文件下载。 |

工作区目录形态：

```text
<workspace>/
  daoge-studio/
    studio.db       # 项目、任务、轮次、计划、运行、资产关系、评审、交付
    Provider.db     # Provider Profile、端点策略、限额和密钥；敏感 SQLite，受本地权限保护
    studio.json     # Studio 身份、schema 和规范工作区根
    runtime/        # daemon 运行记录与锁
    runs/           # 运行证据和队列辅助文件
    cache/          # thumbnail、staging、snapshot 等缓存
    evidence/       # 验证证据
  daoge-assets/
    imports/
    generated/
    exports/
    trash/
  daoge-deliveries/
```

`studio.json` 不是业务事实源；`studio.db` 才是项目、任务、轮次、计划、运行、资产关系、评审和交付的唯一业务事实源。客户端、脚本和用户都不应直接写 manifest、SQLite、journal、运行文件或 SSE 状态。

## Provider、密钥与并发

支持的 Provider Profile 类型：

- `openai-images`
- `gemini-image`
- `gemini-openai-compatible`
- `xai-grok-image`

Provider 能力、官方端点、参考图 / 遮罩能力、远程参考数量、媒体类型和输出规格来自版本化 Provider Descriptor；Profile store、API、Workbench、预检和 HTTP adapter 都返回或记录 `descriptorVersion` / `adapterVersion`，避免能力判断散落。

Provider Profile、密钥引用与 write-only 摘要只保存在 `<workspace>/daoge-studio/Provider.db`；5.13.0 的 Provider.db schema 为 v3。默认 secret backend 是受权限保护的明文敏感 SQLite：Unix 使用 `0600`；Windows 只允许当前用户 SID、SYSTEM 与 Administrators 完全控制，并通过系统 .NET `FileSystemSecurity` API 批量应用和复核 DACL。任何 ACL、符号链接、权限或 schema 异常都会 fail-closed。设置 `DAOGE_PIC_PROVIDER_SECRET_BACKEND=system` 时，macOS 使用 Keychain、Windows 使用当前用户 DPAPI sidecar、Linux 在可用时使用 libsecret；`Provider.db` 仅保存密钥引用和 write-only 摘要，system backend 不可用时不得静默退回 SQLite 明文。

API Key 与完整 Base URL 仅持久化在 Provider.db（或显式配置的系统密钥后端），并在 Workbench 表单、daemon 和 Worker 内存中短暂出现；不会写入 `studio.db`、事件、幂等响应、日志、快照、导出、诊断、打包、聊天或浏览器持久存储。Provider 请求携带凭据时拒绝重定向；远程图片下载只接受无凭据 HTTP/HTTPS 公网地址，并执行 SSRF、DNS 固定、响应大小和格式校验。每个 Profile 可设置端点信任模式：官方端点、兼容公网端点、本地代理或企业私有端点；`compatible_public` 必须使用 HTTPS，HTTP 只允许显式 `local_proxy` 或 `enterprise_private`。

既有工作区的 `provider.env` 只作为一次性迁移输入；新工作区不会创建。Provider Profile、密钥引用和 write-only 摘要的运行时事实源是 Provider.db。显式连接测试和模型列表读取只在用户点击时访问 Provider；模型列表返回受限的 `id`、显示名和归属投影，并把连接测试的可达性、HTTP 状态、Descriptor/adapter 版本和端点策略警告保存为脱敏证据。

并发只属于 Generation Run：

```bash
node scripts/daoge.js preflight --workspace /absolute/workspace --round <round-id> --session <session-id> --concurrency 12
node scripts/daoge.js run --workspace /absolute/workspace --round <round-id> --preflight <dry-run-id> --confirm-token <daemon-token>
```

- 预检未指定并发时默认 `4`，串行使用 `1`；显式值只接受 `1..1000`。
- 持久队列全局硬上限固定 `1000`，不可配置；Profile 级 `maxRunItems` 可把单次运行数量压到更低上限。
- 预检冻结 `executionConcurrency` 与解释用 `concurrencySource`；改变并发必须重新预检，`run` 阶段不能另改。Profile 级 `maxExecutionConcurrency` 会收紧本 Profile 的预检并发上限。
- Provider 活跃请求安全目标上限为 `100`，由 daemon 根据成功率、429、临时故障和 Worker RSS/外部内存样本动态升降。
- Provider 成功响应优先流式写入临时文件；只有不超过 `1 MiB` 的图片结果保留为内存 Buffer。
- Profile 级 `requestTimeoutMs` 和 `maxRetryAttempts` 会收紧单请求超时与自动重试上限；Provider 429 的 `Retry-After` 会进入脱敏错误分类，仍不记录 Provider 原始消息。
daemon 启动时记录 active Profile 的 `profileId + configVersion`；活动配置修改、active 切换或删除由 daemon 在没有旧配置未完成运行项时自动热加载，旧运行继续使用其快照，新预检和新运行使用新配置。存在旧配置任务时先排空旧 Worker，不静默切换。

## 安全边界

- 人工确认是执行闸门。Workbench 只提交确认，不执行预检、不创建 Generation Run。
- 运行必须携带 daemon 签发的 `confirm_token`；令牌绑定 `plan_hash + preflight_id + conversation_id`，缺失、伪造、过期、跨计划、跨预检或跨 conversation 都会拒绝，且不触发 Provider。
- 预检和创建运行只接受 Bearer Skill/CLI；Cookie Workbench 不能直接入队。
- 每个创作轮次只允许当前已确认计划创建一个 Generation Run。已有运行时必须显式选择并汇报该运行；再次生成需要新建 `variation`、`refinement` 或 `fill` 轮次。
- Provider 限流或临时故障进入有界重试；认证、模型、参数或权限错误不自动重试。
- 外部请求结果不明时，运行项进入 `outcome_unknown`，绝不自动重放；用户核实无结果后才可 `resolve-unknown` 结案。
- daemon 重启后，不安全的在途外部调用进入 `resume_pending`；再次外部调用前必须由会话确认并记录 Studio Session，Workbench 不能绕过。
- 参考图和遮罩只能引用当前项目资产，或当前 Studio 明确 `shared_across_projects` 的共享素材；计划写入、确认、预检、排队和 Worker 读取前都会重复校验。
- 导入、生成、回收和恢复使用 staging、原子移动、持久 journal 与启动对账。缺失媒体会被持久标记为不可用，恢复确认前不能作为参考图、遮罩或交付候选。
- 下载、复制、交付导出和 ZIP 使用受验证 snapshot 流式读取。文件替换、路径穿越、跨 Studio/跨项目访问、超出条目或聚合上限、客户端断连都不能形成错误交付。
- Bearer Skill/CLI 请求必须发送 `x-daoge-skill-protocol: daoge-pic-skill-protocol/2.0.0`。`GET /api/studio` 是协议协商与运行时状态端点；路径或方法不在当前端点表内时，daemon 会以 `未找到请求的 Studio API。` 拒绝。不要猜测 `/api/studio/...`、旧命令或工作区文件。

## 常用 CLI

统一入口：

```bash
node scripts/daoge.js <command> --workspace /absolute/workspace
# 安装包中也可以使用：npx daoge <command> --workspace /absolute/workspace
```

| 场景 | 命令 |
| --- | --- |
| 注册 Skill | `register-skill --scope project --workspace <path>`；`register-skill --scope user` |
| 诊断 | `doctor --workspace <path> [--json true] [--redacted true]` |
| 启动 / 复用 Workbench | `open --workspace <path> [--force true] [--allow-nested-studio true]` |
| 查看 daemon 状态 | `studio --workspace <path>`；`status --workspace <path>` |
| Provider 管理 | `provider-list`、`provider-create`、`provider-update`、`provider-copy`、`provider-activate`、`provider-delete`、`provider-validate`、`provider-test`、`provider-models`、`provider-import-env` |
| 会话上下文 | `session --conversation <id>`；`session-context --session <id> [--project <id>] [--task <id>] [--round <id>]` |
| 创作领域 | `project`、`archive-project`、`task`、`round`、`plan --plan <json\|@->`、`confirm-challenge`、`preflight`、`run` |
| 运行控制 | `pause`、`resume --session <id>`、`cancel`、`retry [--items <id,...>]`、`resolve-unknown --items <id,...>` |
| 交付 | `delivery`、`delivery-update`、`delivery-ready`、`delivery-draft`、`delivery-export`、`delivery-batch`、`delivery-batch-revise`、`delivery-batch-ready` |
| 规则资料 | `task-type`、`style-kit`、`brand-kit` |

所有 `POST` / `PUT` mutation 可使用命名操作恢复：

```bash
--operation-name <verb:scope>
--idempotency-key <stable-key>
```

`operation-name` 由 daemon 与路由、规范化 payload 派生稳定 key；同一对象 JSON 的键顺序不会改变幂等身份。`operation-name` 与 `idempotency-key` 互斥。未显式提供任一参数时，CLI 为本次调用生成随机 key，不适合跨进程恢复。

大计划使用 `--plan @-` 从 stdin 传输：

```bash
some-agent | node scripts/daoge.js plan --workspace /absolute/workspace --round <round-id> --version <n> --plan @- --operation-name plan:round-id:v<n>
```

每次命令最多一个 `@-`；stdin 必须是单个 JSON 对象，最大 8 MiB。

受控 CLI 的完整列表与会话执行规则见 [SKILL.md](SKILL.md)。

## 开发与验证

正式发布包已经包含编译后的运行时和 Workbench，安装后不需要手动构建。下面命令只用于源码仓库检出：

```bash
npm install
npm run build
npm test
npm run test:package
```

5.13.0 已执行验证：

- macOS `npm test`：363 项，361 通过、0 失败、2 项仅 Windows 实机用例跳过。
- `npm run test:package`：发布清单 130 个文件；`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，安装、真实 bin、注册、doctor 与 `sharp` 全部通过。
- P2 专项回归：Provider 错误 HTTP method 不执行副作用；创建项目、任务和轮次后直接进入当前上下文；创作手册包含 Provider、模板、参考编排和安全边界更新。
- 发布制品与 SHA-256 记录在包外 `daoge_pic_5.13.0_release_notes_zh.md` 与 `daoge-pic-5.13.0.tgz.sha256`。

发布前最低验证：

- `npm test`：全量 vNext 回归。
- `npm run test:package`：构建 TypeScript、Vite Workbench，执行 npm pack、临时 consumer 安装、真实 bin、注册、doctor 和 `sharp` 检查。
- UI 改动需要实际 Workbench 浏览器 smoke，确认路由、状态、焦点和错误展示。
- 所有本地验证默认不得调用真实图片 Provider，不产生计费生成请求。

5.11.0 历史验证：

- macOS `npm test`：332 项，330 通过、0 失败、2 项仅 Windows 实机用例跳过。
- `npm run test:package`：发布清单 124 个文件；`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，安装、真实 bin、注册、doctor 与 `sharp` 全部通过。
- 浏览器实测 1440×1000：临时 daemon 与 Workbench 授权成功，Lineage 路由显示测试项目/任务/轮次，渲染 4 个谱系节点且无 fatal/error alert；归档确认弹窗为 `role="dialog"` + `aria-modal="true"`，初始焦点在取消按钮。
- 发布制品 `daoge-pic-5.11.0.tgz`：403,432 bytes，SHA-256 `1deb7a92af0bbc0e3cbcd984d4f184043fc1bd08aa2c816713f917ff7c4a82ac`。

## 文档与发布证据

- 受控会话协议：[SKILL.md](SKILL.md)
- 长期权威产品与架构规格：[docs/daoge_pic_vnext_upgrade_spec_zh.md](docs/daoge_pic_vnext_upgrade_spec_zh.md)
- 发布验证记录：[docs/vnext_verification_evidence_zh.md](docs/vnext_verification_evidence_zh.md)
- v5.13.0 发布说明：[../../docs/daoge_pic_5.13.0_release_notes_zh.md](../../docs/daoge_pic_5.13.0_release_notes_zh.md)
- v5.11.0 历史发布说明：[../../docs/daoge_pic_5.11.0_release_notes_zh.md](../../docs/daoge_pic_5.11.0_release_notes_zh.md)
- GitHub Release：[`daoge-pic-v5.13.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.13.0)
- 历史 GitHub Release：[`daoge-pic-v5.11.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.11.0)

5.11.0、5.10.4、5.10.3、5.10.2、5.10.1、5.10.0、5.9.1 及更早稳定版历史证据分章记录在验证记录中；最终资产哈希由 GitHub Release 与 sidecar 在包外记录。
