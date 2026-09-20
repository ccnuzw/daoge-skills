# DAOGE Pic v6.0.0 发布说明

- 发布日期：待定（本文件为发布材料草案；制品与验证数字在正式发布前回填）
- Git 标签：`daoge-pic-v6.0.0`
- 状态：待发布
- 影响 Skill：`daoge-pic`。
- package/runtime 版本：`6.0.0`。
- Skill protocol：`daoge-pic-skill-protocol/3.1.0`（独立于制品版本）。
- 运行时兼容范围：`>=6.0.0 <7.0.0`。
- Studio schema：`41`（自 34 起追加迁移 35–41；旧库与旧素材不迁移，原地存档）。
- 分发渠道：GitHub Release 不可变 `.tgz` 资产；不发布到 npm registry。

## 本次更新

**这是一次 breaking 大版本：跨出旧运行时兼容上界，Studio schema 追加 7 条迁移，Skill 协议升到 3.x，Workbench 全站界面按新的界面标准重做。** 主题是「以人为本」——把创作动线（建立项目 → 提出需求 → 生成运行 → 选片评审 → 资产交付）放回首屏，把工程细节收进二级。

### Skill 协议 3.0.0 → 3.1.0 与运行时 6.0.0

- **协议 3.0.0**：请求队列是协议级新能力（Agent 要按新协议读队列、回执、领单续租），属 breaking。
- **协议 3.1.0**：在 3.0.0 上做加法——计划契约新增**可选**的 `understanding`（3–5 句结论性说明，供人审闸门前多看一分依据，不是推理链、不进库）。3.0.0 的 Agent 保持兼容。
- 运行时版本、协议版本、制品版本三者独立；运行时兼容范围升到 `>=6.0.0 <7.0.0`，`5.14.x` 及更早 daemon 不得与本版本混用。
- 新增 daemon ↔ Studio **版本协商**握手；不兼容时给人话，不给神秘报错。

### 请求队列（Studio 与 Agent 共用同一条队列）

- Workbench 新增**受限请求入口**：用户说的话进入同一条 `studio_requests` 队列，由在场 Agent 接单——Workbench 不提供开放式对话，也没有对话历史。
- **领单用租约**：`request-accept` 原子领取并写租约，同一单不会被两个 Agent 重复消费；租约有 `request-renew` 心跳，卡在人工确认时只松租约、保留 `accepted`。
- **花动作走队列**：Workbench 的「重试 / 恢复」按钮不直调 Bearer（会重新花钱），而是写成带 `intent` / `runId` / `itemIds` 的请求，由 Agent 精确执行。暂停 / 取消是止损动作，仍由 Workbench 直达。
- 请求自带机器可读的流程要求与上下文；追问就地能答，原文住在请求表里，计划只写 `requestId` 外键。

### 问法与回执

- 建批次**默认不再弹「目的问卷」**；卡片先给人话**回执**（「我准备这么出：…」）与两个动作——**就这么出 / 改一下**，两个动作都有真实去处。
- 计划在检查器里可审阅、可**手工改**（只改提示词与数量，带 `expectedVersion`，改完提示重新确认）。

### 创作画布

- **折叠到批次级**：批次节点默认收起、双击展开；出图槽位等冗余节点退场，信息收回批次节点。
- **增量布局**：新节点插进已有布局，不重排已有的；手动挪过的节点保留，重排只在用户主动点「整理」时发生。
- **系统生成分组与连线**，不再由人画。
- **圈选 + 说一句**进入队列；空白双击就地建任务 / 批次，建完留在画布。
- 画布电脑视图收敛为三种（全局 / 按图片 / 按交付）。

### 挑图与出图过程

- 对比从 2 张放宽到 **2–4 张**，缩放上限 2× → **4×**，并加铺满查看。
- 预览态键盘：`←→` 切图、`空格` 保留、`X` 不采用、`Enter` 缩放、`Esc` 收起。
- **占位符逐张长出来**：未出完的项先立占位格，与图同尺寸同列，出一张顶掉一个。
- **「出完了叫我」**：离开画布后出图完成有标题未读提示（默认不主动索要通知权限）。
- 取消运行有 **5 秒撤销窗口**。

### 失败体验与恢复

- 批次失败按四类说人话（谁的错、下一步），**不弹窗**；「没成」与「被挡」分开说。
- 新增「**原因 → 建议**」映射表（额度 → 充值、审核 → 换词、网络 → 等待），Agent 接重试单查表。
- **provider 全挂 / 磁盘满**上首屏级提示条。
- `outcome_unknown` **先由系统对账、对不出来才请人核实**；未结案不可重试，结案后可在原运行内重试（不重复计费）。
- 重试走队列，界面先显示「已排队」；`retry --timeout-ms` 只改写该项 payload，不改写已确认的计划快照。

### Agent 连接与在场

- 新增 `GET /api/agents/detect` 与连接面板：**侦查**这台机器装了哪些宿主、哪个装了 daoge-pic；给出唤起命令与催促超时。
- `agent-register` 登记在场，状态卡显示「有没有人在听、接单的会不会按规范出图」；身份收敛为「一个 CLI 一行」，阈值 15 分钟并不再撤回申报。

### Provider、用量与预算

- 生成服务页可管理 Profile、模型、端点信任模式与限额；**API Key 与完整 Base URL 只写不回显**；保存 / 切换即测一次，打开页面不自动连 Provider。
- 端点信任模式 `official / compatible_public / local_proxy / enterprise_private` 决定可解析的非公有地址范围；任何模式都不放行 link-local、云元数据、文档、多播与保留段。
- 新增 `usage-list` / `usage-summary` / `budget-get` / `budget-set`：账本区分已知成本与未知成本；预算闸门只在计划声明了已知成本估算（`preflight --usage-estimate`）时硬拒绝。

### 我的配方

- `confirmed_templates` / `style_kits` / `brand_kits` 有用户侧入口：**存为我的配方**，建批次时可带出、可改、**不自动执行**。

### 全站界面重设计（界面批 A–E）

- **底座**：设计 token 收敛、页面三档宽度（wide / standard / narrow）由视图注册表声明、状态槽同一时刻只显一条、断点从 13 个并到 **640 / 900 / 1280** 三档、`?audit=layout` 布局体检。
- **外壳**：rail 三区 + 一张状态卡；顶栏**面包屑**替换上下文条；导航去重；计划与生成历史进检查器；内容列居中且与顶栏共用一条列。
- **创作平台**：四条 chrome 收成一条 48px 工具条；统计进浮层；队列贴底让位、选片时收起；右栏只有一个 Aside。
- **三面归位**：资产页明确「这里是后台，挑图在创作平台」；交付步骤条按需展开、历史同屏；资料三页统一版式并吃满主区。
- **拆分与守卫**：App / 画布 / CSS 按层拆分（`app/` ≤250、`views/*.jsx` ≤400、画布三件各自成文件、CSS 一块一文件），G1–G25 守卫全绿。
- **可访问性**：`:hover` 必配 `:focus-visible`；对话框 `role="dialog"` + `aria-modal` + 焦点约束 + Escape + 焦点归还；浮层「选中即收 / 点外收 / Esc 收 / 同屏只开一个」。

### 交付

- 交付状态机 `draft → ready → exported`：准备冻结选片来源与评审，导出创建冻结图片实体；源资产后续回收不破坏已导出交付。
- 导出三件套：`manifest.json` + contact-sheet + creative-record。

### 安全边界

- 计划确认**永远 cookie-only**；预检与入队只接受 Bearer Skill/CLI；每个已确认轮次只允许一个 Generation Run。
- 参考图 / 遮罩只能来自当前项目资产或明确共享素材；声明参考图或遮罩时必须 `operation: "edit"`。
- secret 默认存于受权限保护的 SQLite plaintext，显式 system backend 时用系统凭据存储；system backend 不可用必须 fail-closed。
- 备份恢复先写同目录暂存区、逐文件校验哈希再原子替换，失败按原样回滚；目标 daemon 在运行即拒绝。

## 发布制品

> 待正式发布前用真实 `npm pack` 结果回填，不伪造大小与哈希。

- 文件：`daoge-pic-6.0.0.tgz`
- 大小：待回填
- npm shasum：待回填
- SHA-256：待回填
- GitHub Release 资产：待回填
- checksum sidecar：`skills/daoge-pic/daoge-pic-6.0.0.tgz.sha256`

## 验证结果

> 待正式发布前用真实 `npm test` / `npm run test:package` / `verify:evidence --with-package` 结果回填。

- `npm run typecheck:vnext` / `typecheck:web`：待回填
- `npm run build`：待回填
- `npm test`：待回填（全量 vNext 回归计数）
- `npm run test:package`：待回填（发布清单文件数、unexpected/maps/retired/sensitive）
- `npm run verify:evidence --with-package`：待回填
- 所有本地验证均不调用真实图片 Provider，不产生计费生成请求。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.0.0/daoge-pic-6.0.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.0.0/daoge-pic-6.0.0.tgz"
daoge register-skill --scope user
daoge doctor --workspace /absolute/workspace
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 和 `daoge.cmd`。`register-skill` 在目标已存在时失败，不删除或覆盖已有 Skill 目录。`doctor` 不读取 Provider 密钥、不连接 Provider、不产生计费请求。安装、注册或升级完成后必须完整重启 Codex，使 Skill registry 重新加载。

## 升级建议

1. **6.0.0 与 5.14.x 及更早版本的 daemon 不兼容**；不要让旧 daemon、旧 CLI 与本版本运行时混用。升级前确认旧进程已按受控流程停止，并为现有 Studio 保留可验证备份。
2. **本版本不做数据迁移**：新库从零开始，旧库与素材原地存档、不主动删除。回滚方式 = 停新 daemon、起旧 daemon。
3. **切换新库前必须先停 daemon**：`backup-restore` 明确拒绝「目标 daemon 正在运行」——在运行中的 daemon 底下替换 `studio.db` 只会得到损坏的 Studio。
4. 安装包、注册 Skill 并重启 Codex 后，再用当前会话和当前 Workbench 建立 Studio Session；不要把浏览器缓存、旧目录文件或旧 SSE 状态当作业务事实。
5. 本版本是 vNext 工作流，不读取或迁移旧 `task_spec.json`、旧 `prepare` / `execute` / `ingest` 命令、旧静态工作区、`results.html` 或旧运行记录。生成仍必须经过计划、人工确认、preflight 和 daemon `confirm_token`。
6. 再次生成必须创建新的 `variation` / `refinement` / `fill` 轮次；不能在已有轮次静默创建第二个初始 Generation Run。

## .env 与 Provider 密钥

- 新工作区不会创建 Provider `.env` 文件。既有工作区的 `provider.env` 只作为一次性迁移输入；迁移完成后，Provider Profile、密钥引用和 write-only 摘要以 `daoge-studio/Provider.db` 或显式系统凭据后端为事实源。
- 不要把真实 API key、完整 Base URL、Cookie、token、runtime 文件或 `Provider.db` 加入提交、制品、日志、诊断、导出或 release notes；不要把密钥作为命令参数传递。
- 默认 secret backend 优先使用平台系统凭据存储；显式选择 `system` 时后端不可用必须 fail-closed。测试使用的 `tests/vnext/test.env` 只是回归夹具，不是生产配置。

## 不兼容变化摘要

- 运行时兼容范围从 `>=5.14.2 <6.0.0` 提升到 `>=6.0.0 <7.0.0`；5.14.x 及更早 daemon 不得与本版本混用。
- Skill protocol 从 `daoge-pic-skill-protocol/2.0.0` 升到 `3.1.0`（3.0.0 引入请求队列；3.1.0 为加法字段）；协议版本不是 `6.0.0`。
- Studio schema 从 `34` 追加迁移到 `41`：`studio_requests`、`studio_agents`、`assets.project_id`、`run_items.asset_id`、`canvas_layouts` 一项目一份、`canvas_node_layouts` 只存用户动过的节点、`studio_sessions.active_*` 改名 `agent_*`。**旧结构数据与图片资产全部不迁移。**
- `runs.pause` / `runs.cancel` 移出鉴权表（两者皆可：人可止损、Agent 仍可止损）；`sessions.context` 收为 bearer-only；`rounds.confirm` 仍 cookie-only。
- 旧 `prepare` / `execute` / `ingest`、`task_spec.json`、旧静态工作区和 `results.html` 不是当前入口；公开运行流程使用会话计划、`confirm-challenge`、`preflight`、`run` 和 Generation History。

## 本版本明确不做

- **§9.9 出图过程中的「预计还要多久」**：已拍板允许，但 2026-09-20 明确**不做**（不在本版本实现）。
- **「就地建项目」**：画布是「当前项目内」的视图，项目新建入口由项目首页空态与工具条承载，画布不重复提供。
- **画布级菜单项（复制参考信息 / 导出 / 快捷键）移入工具条**：为不动用户习惯，**保持现状**，作为已接受的例外。

## 发布完成后的包外记录

发布完成后，维护者应在 GitHub Release 附件和仓库包外记录中核对：

- `daoge-pic-6.0.0.tgz` 与同名 `.sha256` sidecar 均存在；
- package、protocol manifest、编译 runtime、Workbench 入口、bin 和 `sharp` consumer smoke 均通过；
- Release tag 为 `daoge-pic-v6.0.0`，安装 URL 与 tag/文件名一致；
- SHA-256 只记录在 sidecar、Release 元数据或外部发布说明中，不写回会改变自身哈希的包内验证文档。
