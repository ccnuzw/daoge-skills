# DAOGE Pic vNext

> **最近正式发布版本**：[`6.1.1`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v6.1.1)
> **当前源码与运行时**：`6.1.1`（首屏分包补丁版本；`6.1.0`、`6.0.0`、`5.14.2` 及更早版本为不可变历史发布，不与本版本 daemon 互用）。
> **运行时兼容范围**：`>=6.0.0 <7.0.0`。
> **Skill protocol**：`daoge-pic-skill-protocol 3.1.0`，独立于制品版本；`6.1.1` 不是协议版本。
> **Studio schema**：`41`（自 34 起追加迁移 35–41；旧库与旧素材不迁移，原地存档）。
> **安装来源**：GitHub Release `.tgz` 资产；这不表示包已发布到 npm registry。

DAOGE Pic 让 **Agent 和创作者工作台一起干活**：Agent 负责收敛需求、写计划、受控执行和风险恢复；Studio Workbench 负责项目 / 任务 / 批次的结构化创建、Provider 配置、创作画布、Generation History（生成历史）、选片评审和资产交付。

它的设计只围绕一条动线：**把图做出来，并且知道每张图从哪来、能不能用、交付到哪去**。工程细节（daemon、SQLite、SSE、并发）不外露给创作者，只在需要的时候以人话出现。

## 目录

- [创作怎么走：五步动线](#创作怎么走五步动线)
- [6.1.1：首屏分包](#611首屏分包)
- [6.1.0：一步连接与 token 效率](#610一步连接与-token-效率)
- [6.0.0：以人为本重构](#600以人为本重构)
- [安装](#安装)
- [启动与会话顺序](#启动与会话顺序)
- [Workbench](#workbench)
- [请求队列：在界面上说一句](#请求队列在界面上说一句)
- [核心概念](#核心概念)
- [工作区与事实源](#工作区与事实源)
- [Provider、密钥与并发](#provider密钥与并发)
- [安全边界](#安全边界)
- [常用 CLI](#常用-cli)
- [开发与验证](#开发与验证)
- [文档与发布](#文档与发布)

## 创作怎么走：五步动线

| 步骤 | 在界面上怎么做 | 背后发生什么 | 事实落在哪 |
| --- | --- | --- | --- |
| **1. 建立项目** | 项目首页新建项目（可选模板带出默认名称、画幅与素材需求） | 只写 Studio API / SQLite；不触发 Provider | `projects` / `creative_tasks` |
| **2. 提出需求** | 在底栏输入框说一句；可先在画布上圈选要引用的图 | 请求进入 `studio_requests` 队列，在场 Agent 接单、澄清并写出版本化计划 | `studio_requests` / plan |
| **3. 生成运行** | 卡片上点「就这么出」，进入确认闸门；也可「改一下」再提交 | 人确认 → 预检 → 该批次唯一的 Generation Run | `confirm_token` / `generation_runs` |
| **4. 选片评审** | 画布满幅看图；`空格` 保留、`X` 不采用、`←→` 切图、`Enter` 缩放；2–4 张并排对比 | 评审写入项目业务关系；重试 / 恢复走队列再花钱 | review / 项目选片 |
| **5. 资产交付** | 交付页「准备 → 导出」，下载或打包 | 冻结选片来源与评审，导出创建冻结图片实体 | `deliveries` / 导出物 |

一句话：**主区一眼可见，辅助贴边，系统默认闭嘴。**

## 6.1.1：首屏分包

**补丁版本，无行为变化、无协议 / schema / 兼容性变化；首屏更快，并修复 Windows 上的按节读取。**

| 领域 | 变化 | 你得到什么 |
| --- | --- | --- |
| Workbench 首屏 | 八屏、对话框与 Provider 设置页改为按需加载（`React.lazy` + `Suspense`），创作平台的 canvas 链独立成块 | 首屏入口 JS 从 708 KB 降到 428 KB（-40%）；Canvas / 对话框打开时才下载 |
| 加载反馈 | 视图切换与对话框有兜底提示 | 不白屏 |
| Windows 修复 | `reference --section` 兼容 CRLF 检出的附录文件 | Windows 上按节读取不再报「未找到章节」 |
| 验证证据 | 验证记录如实报告「入口 + 按需块」 | 首屏成本可见、可复查 |

## 6.1.0：一步连接与 token 效率

**小版本，重点让 Agent 连得更顺、更省；协议仍 `3.1.0`、Studio schema 仍 `41`、兼容范围仍 `>=6.0.0 <7.0.0`，可与 6.0.0 daemon/Workbench 平滑共存。**

| 领域 | 变化 | 你得到什么 |
| --- | --- | --- |
| 一步连接 | 新增 `daoge enter`：一次调用内完成 daemon 就绪、打开/复用 Workbench、登记在场、建立会话、**按项目名进入项目**、读请求队列 | 「连接到 Studio 并进入项目 X」从多轮变成一条命令 |
| 项目解析 | `--project` 接受项目名或 `projectId`；精确名 / 精确 id / 唯一包含才绑定，歧义或找不到返回候选，绝不新建重名项目 | 不再出现「进入项目」无命令可用 |
| 构建身份 | daemon 自证是否当前构建（`build.staleBuild`），陈旧且无在飞请求时自动换进程；新增 `daoge stop` | 不用再靠 `ps`/时间戳/git 猜 daemon 新旧 |
| 上下文来源 | `enter --conversation auto` 读宿主环境变量，拿不到就 fail-loud；返回 `conversationSource` / `contextBound` | 会话身份有事实来源 |
| Token 效率 | `enter` 输出精简约 80% 且默认紧凑；`--help` 默认速览、全签名走 `--help --full`；`reference --section` 只读一节；`round-status`、`plan --challenge` 各合并一次往返 | 单次会话少约 4–5k tokens、少 2 个模型回合 |
| Skill 瘦身 | SKILL.md 从约 10.6k 压到约 3.2k tokens，长尾拆成 `references/` 按需附录，`daoge reference <topic>` 跨宿主取用 | 常驻上下文降到约三分之一 |

## 6.0.0：以人为本重构

**这是一次大规模重做**：跨出运行时兼容上界，Studio schema 追加 7 条迁移，Skill 协议升到 3.x，Workbench 全站界面按新的界面标准重写。

| 领域 | 变化 | 你得到什么 |
| --- | --- | --- |
| 请求队列 | Workbench 的受限请求入口与 Agent 对话**共用同一条队列**（`studio_requests`）：领单租约、续租心跳、回执、就地追问。 | 在界面上说的那句话有 Agent 接单；重试 / 恢复走队列，不绕过人工确认。 |
| 问法与回执 | 建批次**默认不再弹「目的问卷」**；卡片先给人话**回执**与「就这么出 / 改一下」；计划带可选的**理解说明**。 | 少一步问答，计划先看后人审。 |
| 创作画布 | 折叠到批次级、去冗余、增量布局、系统生成分组与连线、圈选发起、空白双击就地建任务 / 批次；视图收敛为三种。 | 画布只留结构与图；平时布局稳定，重排只在主动点「整理」时发生。 |
| 挑图与出图 | 2–4 张对比、4× 缩放、预览态键盘、**占位符逐张长出来**、「出完了叫我」、取消运行 5 秒撤销。 | 等待有形状；离开画布也不错过完成。 |
| 失败与恢复 | 四类人话归因、「原因 → 建议」映射表、provider 全挂 / 磁盘满首屏提示、`outcome_unknown` 先对账再请人核实。 | 出事时先看原因与建议，不瞎等也不误重试。 |
| Provider / 用量 | 系统凭据存储 fail-closed、端点信任模式、`usage-*` / `budget-*` 与 `preflight --usage-estimate`。 | 密钥不落库不上屏；账本区分已知与未知成本。 |
| 我的配方 | `confirmed_templates` / `style_kits` / `brand_kits` 有用户侧入口。 | 存一句配方，下次带出、可改、不自动执行。 |
| 界面重设计 | 批 A–E：token / PageFrame / 状态槽 / 三档断点、rail 三区 + 一张状态卡、面包屑、一条 48px 工具条、队列贴底让位、Aside 统一、三面归位、App / 画布 / CSS 拆分。 | 每屏同一套骨架；拆完仍用守卫锁住行为。 |
| 数据与鉴权 | 旧结构数据与图片资产**全部不迁移**；`runs.pause` / `runs.cancel` 两者皆可，`sessions.context` 收为 bearer-only，`rounds.confirm` 仍 cookie-only。 | 回滚 = 停新 daemon、起旧 daemon；确认闸门只有人能过。 |

协议要点：**3.0.0** 引入请求队列（breaking）；**3.1.0** 是加法（`PreflightPlan.understanding` 可选字段，旧 Agent 兼容），并新增 daemon ↔ Studio 版本协商握手。

更早版本（5.14.2 / 5.14.1 / 5.11.0…）的升级内容见 [CHANGELOG](../../CHANGELOG.md) 与历史 [Release](https://github.com/ccnuzw/daoge-skills/releases)。

## 安装

### 运行条件

- Node.js `22.17.0` 或更高版本。
- 一个稳定、可写的本地工作区根目录。
- Windows 工作区必须是当前用户拥有的本地 NTFS 目录；不要使用 OneDrive/同步盘、UNC/网络共享、移动盘、WSL 挂载路径、系统目录或 junction/symlink 根。
- 真实生成前，需要在 Workbench 或受控 CLI 中配置并激活一个 Provider Profile。

### 推荐：项目级安装

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.1.1/daoge-pic-6.1.1.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

Windows PowerShell：

```powershell
npm.cmd install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.1.1/daoge-pic-6.1.1.tgz"
npx.cmd daoge register-skill --scope project --workspace "C:\Users\<用户名>\source\<项目名>"
npx.cmd daoge doctor --workspace "C:\Users\<用户名>\source\<项目名>"
```

`register-skill` 在 Windows 创建 junction，在其他平台创建目录符号链接；目标已存在时直接失败，不删除或覆盖。`doctor` 不读取 Provider 密钥、不连接 Provider、不产生计费请求。安装和注册后完整重启对应宿主（Codex 等），使 Skill registry 重新加载。

### 全局安装

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.1.1/daoge-pic-6.1.1.tgz"
daoge register-skill --scope user                    # 缺省：~/.codex/skills
daoge register-skill --scope user --host agents      # ~/.agents/skills：多数宿主都能读到
daoge register-skill --scope user --host omp         # 也可以点名装给某个宿主
```

Windows PowerShell：

```powershell
npm.cmd install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.1.1/daoge-pic-6.1.1.tgz"
daoge.cmd register-skill --scope user
daoge.cmd register-skill --scope user --host agents
```

`--host` 的取值：`agents`（跨宿主共享目录）、`workbuddy`、`codex`、`claude`、`opencode`、`gemini`、`agy`（Antigravity CLI）、`grok`、`omp`、`pi`、`cursor-agent`、`qwen`、`kimi`、`amp`、`droid`、`copilot`。写错会直接报错并列出可用值，不会新建目录；`agents` 是省事的那个——大多数主流宿主都会读 `~/.agents/skills`。装好后重启对应宿主，让它的 Skill registry 重新加载。Workbench 连接面板的「侦查」用的是同一张宿主表：它只报告这台机器上装了哪些、哪个装了 daoge-pic，不代管任何宿主的 skills。

上述 URL 指向 `6.1.1` GitHub Release 的不可变正式资产；直接安装 `main` 源码不等同于该发布制品。

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
2. 执行型触发先解析稳定工作区：显式 `--workspace` > `DAOGE_WORKSPACE_ROOT` > cwd 或它的某个祖先是已落盘的 Studio（含 `daoge-studio/studio.json`）—— 最后一种由 CLI 自己向上找。已有绑定就复用；无法从上下文获得时，只询问这个路径。不要使用临时目录、Skill 安装目录、任意 cwd 或任意当前目录代替稳定工作区。
3. 每个独立智能体会话在该工作区首次执行时，都可以安全运行普通 `node scripts/daoge.js open --workspace <path>`。这是本地准备，不是外部 Provider 调用，不需要生成确认，也不得自动执行 Provider 连接测试。去重由 daemon 的内存 presence/open-claim 协议负责：首个 claim 持有者调用默认浏览器，活动 Workbench、最近认证连接或未过期 claim 会让其他调用返回 reused。
4. 根据 CLI 结果汇报访问状态：`opened:true,reused:false` 表示已打开；`opened:false,reused:true` 表示已复用。OS opener 不承诺聚焦既有标签，也不得声称一定会聚焦标签；daemon 只保证普通 open 最多触发一个实际 opener。
5. Workbench 已打开或复用后，才用当前真实 conversation ID 创建或恢复独立 Studio Session，再创建或恢复项目/任务/批次上下文，然后开始创作澄清、计划与领域写入。**每次入场先读请求队列**（`request-list`），处理等待中的用户请求。
6. 如果自动打开失败但 daemon 健康，只提示用户安全地重试 `node scripts/daoge.js open --workspace <path>`；安装包语境可用 `npx daoge open --workspace <path>`。不要复制或要求用户粘贴 bootstrap URL、capability、Cookie、session token；裸 Workbench origin 也不是主要访问方式。
7. 没有 active Provider Profile 不阻止 Studio 启动或 Workbench 打开。先在 Workbench 的生成服务页配置并激活 Profile，再回到会话继续；页面打开、加载和保存不得自动测试连接，只有用户明确发起的连接测试才会访问 Provider。
8. `open --force true` 只用于用户明确要求新开标签；普通启动不得 force。`--allow-nested-studio true` 只表示用户确认要在已有父级 Studio 内创建另一个隔离 Studio；它不合并或共享两个 Studio 的数据。

> **更快：一条命令完成第 3–5 步。** `node scripts/daoge.js enter --workspace <path> --conversation <id> --project <项目名或 id> [--cli <宿主 CLI 名>] [--skill daoge-pic] [--skill-version <v>]` 在一次进程内确保 daemon、打开或复用 Workbench、登记在场、建立会话、按项目名进入项目并读取请求队列。项目名解析是确定的：精确名、精确 id 或唯一包含（active 优先于 archived）才绑定；同名多个会返回 `projectCandidates` 让你选，绝不猜、也不会新建重名项目。`project-list` 可单独列出项目。

> **会话身份**：`--conversation` 只认显式 ID 或 `auto`（读宿主环境变量 `DAOGE_CONVERSATION_ID` / `OMP_CONVERSATION_ID`）；两者都没有时 CLI 直接报错，不会替会话编一个 ID，也不需要去翻宿主的会话目录。

> **运行时新鲜度**：协议版本与运行时版本都是区间，判断不了「daemon 是不是当前这份安装」，所以 `/api/studio` 与 `daemon.json` 都带 `buildId`（`dist/vnext` 的内容哈希，进程启动时钉住）。`status` 返回 `build.staleBuild`；`enter` 默认在**可证明陈旧且没有在飞请求**时当场换进程（`--restart-stale false` 可关）；`restart` 一定换进程并自证新 PID + 新构建，`stop` 只做受控关闭、不自动重启。旧 daemon 不报 `buildId` 就等于陈旧 —— 那正是「文件是新的、跑的是旧的」最容易骗过人的地方。

请求根没有 Studio manifest 时，CLI 会先检查祖先目录。发现有效父级 Studio 后，默认在创建 daemon、manifest 或 Workbench 前拒绝初始化，避免误把仓库子目录变成数据不互通的第二个 Studio。

## Workbench

### 界面骨架

一屏只有三段纵向结构：**顶栏**（项目 › 任务 › 批次的面包屑 + 当前动作）、**状态槽**（同一时刻至多一条，其余折叠并点名）、**主区**。底部常驻一条**底栏**（请求队列 + 输入框），左栏是 **rail 三区**（工作区 / 资料 / 状态），右栏是唯一的 **Aside**（计划 / 生成历史 / 这一批的指标，三者互斥）。

- **顶栏**：面包屑回答「我在哪」，点开可切换；宽度与主区共用同一条列并居中，不随文案抖动。
- **创作平台**：四条 chrome 收成**一条 48px 工具条**（模式、动作、筛选 / 统计 / 搜索 / 更多 / 保存点）；统计进浮层；画布是绝对主区。
- **底栏**：空闲约 48px；展开不遮画布（画布结构性让位）；选片时展开层自动收起，输入框仍在。
- **rail 状态区**：只有**一张状态卡**，常显一行结论（≤14 字），点开看明细。
- **浮层**：一律「选中即收 / 点外收 / Esc 收 / 同屏只开一个」；说明型折叠区保持原生行为。
- **断点**：只有 **1280 / 900 / 640** 三档；窄屏触控目标 ≥44×44。

### 能做什么

| 区域 | 主要用途 | 关键边界 |
| --- | --- | --- |
| 项目 / 任务 / 批次导航 | 管理项目、任务、批次与当前上下文；支持 Studio 直接创建、搜索与分页大列表。新建项目优先选模板并带出默认名称、示例与素材需求；新建任务读取当前项目模板重排推荐目标；新建批次优先选目的并套默认值。 | 事实以 `studio.db` 为准；直接创建只建立结构化上下文，不触发 Provider。 |
| 创作平台（画布） | 项目工作区首页：批次默认收起、双击展开；按批次 / 按图片 / 按交付三种视图；圈选 + 说一句；空白双击就地建任务 / 批次；选中浮出工具条或右键菜单。 | 只保存布局与结构关系，不替代项目、运行、资产、交付事实；不预检、不运行、不访问 Provider。 |
| Generation History | 按当前批次列出全部持久 Generation Run；显式选择运行后查看计划版本、运行状态、运行项、输出缩略图和恢复动作。 | 不把「最新运行」或「活跃运行」静默当成已选择历史。 |
| 资产 | 导入、分页、筛选、选片、评审、共享、回收、恢复、来源检查和 ZIP 下载；状态图例统一解释未定、成果 / keep、不采用、可继续和交付冻结。 | 「全选本页」只作用于当前页；未定资产不能进入交付；参考素材只来自当前项目或明确共享素材；已确认或运行中的批次不能由 Studio 直接改参考上下文。 |
| 放大预览 / 对比 | 查看图片、切换成果选择、复制或下载；预览态键盘（`空格` 保留 / `X` 不采用 / `Enter` 缩放 / `Esc` 收起）。 | 选择写入项目业务关系并保持 `keep` 语义；交付冻结来自已准备 / 已导出的交付实体，不受源资产回收影响。 |
| 交付 | 创建草稿、准备、导出、查看历史、下载 / 复制冻结文件和 ZIP。 | 状态机 `draft -> ready -> exported`；导出后不受源资产回收影响。 |
| Provider 设置 | Profile 新建、编辑、复制、激活、删除、本地校验、显式连接测试、显式读取模型列表、模型选择；展示 Descriptor、端点信任模式与 Profile 级限额。 | API Key 与完整 Base URL 是 write-only；被未完成或可恢复运行引用的 Profile 不能改删；daemon 会热加载活动配置，已完成预检需重新预检。 |
| 运行健康 / 疑难 | 查看 daemon、generation worker、media worker 状态；复制脱敏诊断；安全重启故障池；导出不含密钥的数据体检清单。 | 诊断不含工作区路径、完整 URL、capability、Cookie、session token 或 Provider 密钥。 |

键盘与辅助技术契约：所有主要交互保留可见焦点；搜索使用 combobox/listbox 语义；状态与错误使用 live region；模态查看与确认对话框具备 `role="dialog"`、`aria-modal`、初始焦点、Tab/Shift+Tab 约束、Escape 关闭与关闭后焦点返回；凡定义 `:hover` 的样式块必须同时定义 `:focus-visible`。

Workbench **不提供开放式对话**（受限请求入口不是聊天）、不绕过会话确认、不展示 Provider 密钥、不接受任意绝对路径、不允许匿名或跨 Studio 访问，也不把浏览器状态、文件夹或 SSE 当业务事实源。

创建是**双入口、单工作流**：Agent 从自然语言创建，或 Studio 表单创建；两者写同一事实源，后续生成仍必须由 Agent 输出可确认计划、用户确认、预检并创建唯一运行。

## 请求队列：在界面上说一句

Workbench 的请求入口和 Agent 对话**共用同一条队列**（`studio_requests`，一行一请求）。它接的是「用户说的话」，不是「出图指令」——两类话都接：

- **出图类**：按正常流程产出计划 → 用户在 Workbench 确认 → 预检 → 入队运行；请求通过 `result_round_id` 关联到产生的批次。
- **花动作（重试 / 恢复）**：Workbench 的按钮**不直调 Bearer**（会重新花钱），而是把意图写成请求（`context_json` 带 `intent` / `runId` / `itemIds`），由 Agent 精确执行。**暂停 / 取消**是止损动作，仍由 Workbench 直达。
- **非出图类**：Agent 以普通对话回应，并用 `request-done --reply` 把回复带回发起处。
- **需要追问**：用 `request-done --needs-input` 把问题带回卡片，用户就地回答，续上同一请求。
- **做不了**：用 `request-reject --reason` 如实说明。

纪律：**领单用租约**（`request-accept` 原子领取，同一单不会被两个 Agent 重复消费）；**长活要续租**（`request-renew`），否则租约到期把这一单判成「被领过但没完成」；卡在人工确认时只松租约、保留已接受，不计失败。

## 核心概念

| 概念 | 含义 |
| --- | --- |
| Workspace | 一个稳定本地工作区根目录。所有 Studio 数据都在其下创建和恢复。 |
| Studio | 当前工作区的本地单实例 daemon、数据库和媒体目录。 |
| Studio Session | 每个真实智能体 conversation 的独立上下文；Workbench 标签页不是智能体 Session。 |
| Project | 一个创作项目，拥有任务、资产、选片和交付。 |
| Task | 项目内的一组创作目标，可关联任务类型、风格包和品牌包。 |
| Round（批次） | 一次探索、优化、变体、编辑或补图。再次生成应新建批次。 |
| Plan | 版本化创作计划，包含 operation、提示词、数量、输出规格、参考素材、风险与可选的「理解说明」。 |
| Generation Run | 一个已确认计划对应的持久运行；每个批次只允许一个初始运行。 |
| Run Item | 运行中的单个生成项，拥有序号、状态、尝试次数、输出资产和恢复动作。 |
| Asset | 导入、生成或导出的受管理图片实体。 |
| Delivery | 从项目选片冻结出的交付包，导出后按冻结文件下载。 |

## 工作区与事实源

```text
<workspace>/
  daoge-studio/
    studio.db       # 项目、任务、批次、计划、运行、资产关系、评审、交付
    Provider.db     # Provider Profile、端点策略、限额和密钥；敏感 SQLite，受本地权限保护
    studio.json     # Studio 身份、schema 和规范工作区根（不是业务事实源）
    runtime/        # daemon 运行记录、锁与持久凭据（0600）
    runs/           # 运行证据与队列辅助文件
    cache/          # thumbnail、staging、snapshot 等缓存
  daoge-assets/
    imports/  generated/  exports/  trash/
  daoge-deliveries/
```

`studio.db` 是项目、任务、批次、计划、运行、资产关系、评审和交付的**唯一业务事实源**；客户端、脚本和用户都不应直接写 manifest、SQLite、journal、运行文件或 SSE 状态。

## Provider、密钥与并发

支持的 Provider Profile 类型：

- `openai-images`
- `gemini-image`
- `gemini-openai-compatible`
- `xai-grok-image`

Provider 能力、官方端点、参考图 / 遮罩能力、远程参考数量、媒体类型和输出规格来自版本化 Provider Descriptor；Profile store、API、Workbench、预检和 HTTP adapter 都消费同一份 Descriptor（`descriptorVersion` / `adapterVersion`），避免能力判断散落。

Provider Profile、密钥引用与 write-only 摘要只保存在 `<workspace>/daoge-studio/Provider.db`（当前 schema v3）。默认 secret backend 是受权限保护的明文敏感 SQLite：Unix 使用 `0600`；Windows 只允许当前用户 SID、SYSTEM 与 Administrators 完全控制，并通过系统 .NET `FileSystemSecurity` API 批量应用和复核 DACL。任何 ACL、符号链接、权限或 schema 异常都会 fail-closed。设置 `DAOGE_PIC_PROVIDER_SECRET_BACKEND=system` 时，macOS 使用 Keychain、Windows 使用当前用户 DPAPI sidecar、Linux 在可用时使用 libsecret；`Provider.db` 仅保存密钥引用和 write-only 摘要，system backend 不可用时不得静默退回 SQLite 明文。

API Key 与完整 Base URL 仅持久化在 Provider.db（或显式配置的系统密钥后端），并在 Workbench 表单、daemon 和 Worker 内存中短暂出现；不会写入 `studio.db`、事件、幂等响应、日志、快照、导出、诊断、打包、聊天或浏览器持久存储。Provider 请求携带凭据时拒绝重定向；远程图片下载只接受无凭据 HTTP/HTTPS 公网地址，并执行 SSRF、DNS 固定、响应大小和格式校验。

每个 Profile 可设置端点信任模式：

- `official`：官方端点。
- `compatible_public`：兼容公网端点，**必须 HTTPS**。
- `local_proxy`：放行 loopback、CGNAT/overlay（含 Tailscale）、RFC 2544 benchmark 段（TUN 代理常用 fake-IP）与 IPv6 ULA / 回环。
- `enterprise_private`：放行 RFC1918、IPv6 ULA 与回环。

**任何模式都不放行** link-local、云元数据（`169.254.169.254`）、文档、多播与保留段。既有工作区的 `provider.env` 只作为一次性迁移输入；新工作区不会创建。

并发只属于 Generation Run：预检未指定时默认 `4`，串行用 `1`，显式值只接受 `1..1000`；并发变化必须重新预检。Provider 活跃请求由安全目标 `100` 的自适应 Governor 控制，429、临时故障与资源压力会降速。

## 安全边界

以下边界同时由 daemon / API / 测试与 Skill 约束，使用者与 Agent 都不应尝试绕过：

- **计划确认永远 cookie-only**；Agent 的 Bearer token 在任何情况下都不能被当作确认者。确认挑战绑定 `planHash + expectedVersion + sessionId + conversationId` 且有过期时间，计划一改旧确认自动失效。
- **预检与入队只接受 Bearer Skill/CLI**；`preflight` 不调用 Provider、不计费、不创建正式资产；`run` 才会触发 Provider，且必须携带 daemon 签发的 `confirm_token`。
- **每个已确认批次只允许一个 Generation Run**。已有运行时必须显式选择并处理；再次生成必须新建 `variation` / `refinement` / `edit` / `fill` 批次。
- **参考图 / 遮罩**只能来自当前项目资产或明确 `shared_across_projects` 的共享素材；声明参考图或遮罩时必须 `operation: "edit"`。
- **止损与花钱分开**：暂停 / 取消不花钱，人和 Agent 都可以做；重试 / 恢复 / unknown 结案会重新花钱，只接受 Bearer，界面按钮走队列。
- **`outcome_unknown`**：外部请求结果不明时绝不自动重放；先由系统对账，对不出来才请用户核实，`resolve-unknown` 结案后可在原运行内重试（派生新 `request_id`，不重复计费）。
- **daemon 重启**：未安全完成的运行进入 `resume_pending`；再次外部调用前必须在会话中得到用户确认，并以 `resume --session` 记录。
- **媒体身份**：缺失持久标记的媒体不得作为参考图、遮罩或交付候选；下载、复制、交付导出和 ZIP 必须使用受验证 snapshot 流式读取，路径穿越、跨 Studio 访问、超限或断连都不能形成错误交付。
- **不得泄露**：capability、bootstrap URL、Cookie、session token、完整 Provider 请求、内部路径或 API Key 不得出现在输出、日志、导出、诊断或聊天里。

## 常用 CLI

统一入口：

```bash
node scripts/daoge.js <command> --workspace /absolute/workspace
# 安装包中也可以使用：npx daoge <command> --workspace /absolute/workspace
```

| 场景 | 命令 |
| --- | --- |
| 启动 / 诊断 | `enter`（一步连接：daemon + Workbench + 会话 + 项目 + 请求队列）、`stop`（受控关闭，不自动重启）、`register-skill`、`agent-register`、`agent-list`、`doctor`、`studio`、`open`、`restart`、`project-list`、`status` |
| 注册 Skill | `register-skill --scope project --workspace <path>`；`register-skill --scope user [--host <agents\|codex\|claude\|opencode\|gemini\|agy\|grok\|omp\|pi\|cursor-agent\|qwen\|kimi\|amp\|droid\|copilot>]` |
| Provider | `provider-list`、`provider-create`、`provider-update`、`provider-copy`、`provider-activate`、`provider-delete`、`provider-validate`、`provider-test`、`provider-models`、`provider-import-env` |
| 用量与预算 | `usage-list`、`usage-summary`、`budget-get`、`budget-set --limit <n> --cost-unit <unit>` |
| 会话与上下文 | `session --conversation <id>`、`session-context`、`project`、`archive-project`、`task`、`round` |
| 规则资料 | `task-type`、`style-kit`、`brand-kit` |
| 已确认模板快照 | `template-list`、`template-get`、`template-save`、`template-archive`、`template-rollback` |
| 计划与运行 | `plan --plan <json\|@->`、`confirm-challenge`、`preflight`、`run`、`pause`、`resume`、`cancel`、`retry`、`resolve-unknown` |
| 请求队列 | `request-list`、`request-detail`、`request-accept`、`request-renew`、`request-done`、`request-reject` |
| 交付 | `delivery`、`delivery-update`、`delivery-ready`、`delivery-draft`、`delivery-export`、`delivery-batch`、`delivery-batch-revise`、`delivery-batch-ready` |
| 备份与升级评估 | `backup-manifest`、`backup-restore-dry-run`、`backup-restore`、`backup-upgrade-assess`、`backup-rollback-point` |

所有 `POST` / `PUT` mutation 可使用命名操作恢复（两者互斥）：

```bash
--operation-name <verb:scope>
--idempotency-key <stable-key>
```

大计划用 `--plan @-` 从 stdin 传输；每次命令最多一个 `@-`，stdin 必须是单个 JSON 对象。受控 CLI 的完整列表与会话执行规则见 [SKILL.md](SKILL.md)；命令总表、高风险签名、运行恢复、交付、状态模型、Provider/密钥与 Workbench 边界放在 `references/` 目录，由 SKILL.md 按触发条件指向（智能体在执行时按需读取，不必常驻上下文）。

## 开发与验证

正式发布包已包含编译后的运行时与 Workbench，安装后不需要手动构建。下面命令只用于源码仓库检出：

```bash
npm install
npm run build
npm test
npm run test:package
```

6.1.1 已执行验证（发布前，macOS）：

- `npm run build`：通过；Vite 转换 1704 个模块，Workbench 入口 JS 427.65 kB、CSS 233.03 kB、按需块 26 个 / 288.38 kB，只有非阻断大小提示。
- `npm test`：全量回归 930 项，928 通过、0 失败、2 项条件跳过。
- `npm run test:package`：发布清单 227 个文件；`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，安装、真实 bin、注册、doctor 与 `sharp` 全部通过。
- Windows CI（`windows-2022` / `windows-2025`）在本版本 push 后由 `.github/workflows/daoge-pic-windows.yml` 运行；6.0.0 的四组合历史结果见验证记录。
- 最终制品的大小和 SHA-256 记录在 GitHub Release、仓库根发布说明和 `.tgz.sha256` sidecar 中；本 README 随包发布，不嵌入会改变自身内容的归档哈希。

发布前最低验证：

- `npm test`：全量 vNext 回归。
- `npm run test:package`：构建 TypeScript、Vite Workbench，执行 npm pack、临时 consumer 安装、真实 bin、注册、doctor 和 `sharp` 检查。
- UI 改动需要实际 Workbench 浏览器 smoke，确认路由、状态、焦点和错误展示。
- 所有本地验证默认不得调用真实图片 Provider，不产生计费生成请求。

更早版本（5.14.2 / 5.11.0）的历史验证数字见 [vNext 验证记录](docs/vnext_verification_evidence_zh.md)。

## 文档与发布

- 受控会话协议：[SKILL.md](SKILL.md)
- 长期权威产品与架构规格：[docs/daoge_pic_vnext_upgrade_spec_zh.md](docs/daoge_pic_vnext_upgrade_spec_zh.md)
- 发布验证记录：[docs/vnext_verification_evidence_zh.md](docs/vnext_verification_evidence_zh.md)
- GitHub Release：[`daoge-pic-v6.1.1`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v6.1.1)
- v6.1.0 历史 GitHub Release：[`daoge-pic-v6.1.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v6.1.0)
- v6.0.0 历史 GitHub Release：[`daoge-pic-v6.0.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v6.0.0)
- v5.14.2 历史 GitHub Release：[`daoge-pic-v5.14.2`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.14.2)
- v5.14.1 / v5.14.0 / v5.13.0 / v5.11.0 及更早历史证据分章记录在验证记录中；完整升级流水见 [CHANGELOG](../../CHANGELOG.md)。
