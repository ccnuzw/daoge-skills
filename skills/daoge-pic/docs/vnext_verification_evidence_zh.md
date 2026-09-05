# DAOGE Pic vNext 验证记录

本文件只记录实际执行的发布验证，不定义产品需求或实现状态。需求唯一来源是 [vNext 升级规格](daoge_pic_vnext_upgrade_spec_zh.md)；实现以对应版本的源码为准。

验证证据外置在源码仓库与对应 GitHub Release 中，供维护者审计；它不属于 `daoge-pic` 运行时 npm 包，也不得成为安装后启动 Studio 的依赖。

当前稳定正式版本为 [`5.10.3`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.10.3)。下列章节按版本隔离发布事实；5.10.2、5.10.1、5.10.0、5.9.1 及更早章节保持历史证据，不得用其哈希、worker 架构或协议兼容规则解释 5.10.3。

## 1. daoge-pic 5.7.0 已发布历史证据

本节对应 [`daoge-pic-v5.7.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.7.0) 的发布源码与不可变 `.tgz` 制品。以下内容只证明 5.7.0；其中 Schema v18、工作区并发配置和 `1000` 工作区上限均为历史实现，不是当前 Provider.db + 预检冻结 Run 并发契约。

### 最终机器验证

- 验证日期：2026-09-02；本地 macOS、Node.js 22+。
- `npm test`：TypeScript 和 Vite 生产构建成功；Node 内置测试执行 217 项，217 通过、0 失败、0 取消、0 跳过。
- `npm run test:package`：真实构建、打包并临时安装候选包；发布清单 86 个文件，`unexpected=0`、source map 为 0、退役路径为 0，安装、bin 与 help 检查通过。
- 正式制品 `daoge-pic-5.7.0.tgz` 为 249,611 bytes，npm shasum 为 `3da27b4f4c4c63ad1f3b94a02f3a5297cce86a75`，SHA-256 为 `1fb70265f4a0e7e5858be3dec7cf21ad8706c720fede7c1712e74a36678110fe`。
- 历史 5.7.0 证据：Schema v18 在当时实际工作区完成迁移；受控重启保持原 Workbench 端口，daemon 健康且当时生效的工作区并发为 `1000`。当时系统 Skill 注册指向本仓库 `skills/daoge-pic` 源码，包版本为 `5.7.0`。

### Chromium 行为与视觉验证

- 使用隔离临时 Studio 构造 13 个项目、15 个任务和 20 张项目资产；未配置 Provider、未创建 Generation Run、未发起外部调用。
- 项目首页验证“进行中 / 已归档 / 全部”筛选、名称搜索和 12 项分页；13 个项目正确形成 2 页。
- 项目概览任务摘要按每页 8 项形成 2 页；任务功能页按每页 12 项形成 2 页，搜索与状态筛选控件均可操作。
- 项目资产把每页数量切换为 16 后，20 张资产正确形成 2 页；“全选本页”选择 16 张并切换为“取消全选本页”。
- 文件选择器一次上传 2 张图片，界面显示“已导入 2 张图片”，总数从 18 更新为 20；单页仍保持 16 张。
- 交付页显示“打包下载 16 张”和明确的“取消全选”；取消后选中数为 0，再执行“全选全部 16 张”恢复为 16。
- 桌面 1440×1000 与移动 390×844 均无 document 横向溢出；移动端全选、每页和分页按钮高度均为 44px。
- 当前真实项目资产完成图片预览直接选片验证，并在验证后恢复原选择；预览窗口显示明确“选为成果”操作。
- 当前选片卡片实测移除按钮为 `24×24`，标题区右边界与按钮左边界相距 9px、无重叠；桌面截图确认长标题安全省略。
- 项目资产 ZIP 响应同时返回秒级 ASCII 回退名与 UTF-8 语义名，例如 `青春四人组-项目资产-YYYYMMDD-HHMMSS.zip`；交付 API 回归覆盖“项目名-交付名-交付图片-时间”命名。

## 2. daoge-pic 5.4.0 已发布历史证据

本节对应已正式发布的 [`daoge-pic-v5.4.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.4.0)。以下历史验证内容原样保留；其中时间、数量、哈希和环境只证明 5.4.0，不得转用为后续版本证据。

### 本轮机器证据

- 最终验证时间：2026-08-31T17:21:59Z（本地 macOS，Node.js 26.7.0）；工作树包含待提交的 `v5.4.0` 发行变更。
- `npm test`：退出码 0；先执行 TypeScript 与 Vite 生产构建，再运行 `tests/vnext/*.test.js`，共 83 通过、0 失败。覆盖计划确认与预检、Provider 安全门槛、项目/任务/轮次/运行范围、选择与评审、创作者交付状态机、项目与交付 ZIP 的真实文件内容、ZIP 与共享素材跨 Studio 授权、深链范围隔离、运行恢复和 Workbench 静态服务。
- `npm run test:package`：退出码 0；发布清单包含 70 个必要文件，`*.map` 为 0，旧版路径为 0。
- 真实参考图变体验证：收到明确确认后执行单次运行；计划使用 1 张受管理参考资产，输出 2 项 `1:1` 图片。两个运行项均以一次尝试到达 `succeeded`，没有自动重放或重试；轮次范围归档 2 张生成 PNG，下载端点均返回 `image/png` 附件和有效 PNG 签名。
- `npm pack --json --ignore-scripts`：最终 `daoge-pic-5.4.0.tgz` 含 70 个文件，npm shasum 为 `9e98b052a3fe16a5d73ba13851b44fbbe344e90e`，SHA-256 为 `10915df67d29fa8c25da30417ef0b0d7b39e26cac82f07e0fecc696e04367e61`；清单不含 source map、旧版路径或依赖目录，仅包含预期的无密钥 `provider.env.example` 模板。

### 覆盖范围

测试覆盖 Studio Schema/migration、事件与 SSE 游标、Provider 脱敏、计划确认和干跑、输出规格、项目/任务/轮次/运行/运行项状态、Workbench URL 路由、Session 上下文、任务和项目资产范围、目标范围去重、轮次谱系、资产来源和评审历史、项目范围评审准入、交付 `draft -> ready -> exported` 状态机与冻结副本、创作者选择/交付/领取主流程、项目和交付 ZIP、明确共享素材、学习中心、资料库、CLI 契约、队列/租约/终态收敛与未知外部结果，以及 Workbench 静态服务。

### 尚未形成机器证据的事项

当前环境未提供可用的 Playwright 或等价浏览器自动化后端。Chrome 无头模式在本机因 allocator/renderer 异常退出，未生成桌面/移动视口截图或像素级 UI 验证。Vite 生产构建、Workbench 静态服务 API 测试和组件/路由测试覆盖资源可用性与核心交互契约；视觉验收仍应在具备可用浏览器自动化的环境补充。

## 3. daoge-pic 5.5.0 已发布历史证据

本节对应已正式发布的 [`daoge-pic-v5.5.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.5.0)，标签提交为 `1741c56bd05ed6fa4974ac679abab60e6b7c6a0f`，发布时间为 2026-09-01T03:13:40Z。

- 发布前 vNext 自动化回归 `88/88` 通过，package smoke 通过。
- Release 制品 `daoge-pic-5.5.0.tgz` 为 203,159 bytes，SHA-256 为 `d76844e34aba42feb8a53ed6b4629c5c5a94fd4548dc75f02d4083ffa7bb38d2`。
- 历史 5.5.0 契约：该版本提供动态画幅、尺寸、分辨率和单次运行并发，当时的工作区 Worker 默认上限提升为 `30`，运行时设置迁移到 SQLite Schema v14；这不是当前契约。

## 4. daoge-pic 5.6.0 已发布历史证据

本节对应 [`daoge-pic-v5.6.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.6.0) 的发布源码与不可变 `.tgz` 制品。以下并发、配置与 Schema 描述仅是 5.6.0 历史证据，不定义当前实现。

### 最终机器证据

- 最终验证时间：2026-09-01T13:33:39Z；环境为本地 macOS，Node.js v22.23.0。
- `npm test`：退出码 0；TypeScript 与 Vite 生产构建成功，Node 内置测试运行器共执行 207 项，207 通过、0 失败、0 取消、0 跳过、0 待办。
- `npm run test:package`：退出码 0；实际构建、打包并安装候选包，发布清单包含 86 个文件，`unexpected=0`、source map 为 0、退役路径为 0；已安装包的 `daoge` bin、`--help` 和运行时/Workbench/Provider 模板路径检查全部通过。
- 正式制品 `daoge-pic-5.6.0.tgz` 为 244,112 bytes，npm shasum 为 `6c9406220c62e5407b5ebc904a65d13b6ff2b0ea`，SHA-256 为 `19467b05624e18494e087982b0d261edd28cadc486602089e6a636bc986fe27a`。
- CLI smoke：源码 launcher 与编译后直接入口均正常执行 `--help`，stdout 完全一致；无效命令、缺失参数、显式幂等键、manifest 工作区身份和首次初始化零副作用均有自动化回归。

### 覆盖范围

- 历史 5.6.0 运行引擎：取消竞态、租约丢失、`outcome_unknown`、到期自动重试、稳定 request identity、当时的 `1..30` 单次运行并发、跨 Worker 全局上限、显式启动恢复与 `resume_pending` 会话门禁。
- 本地与 Provider 安全：daemon capability、失败可重试的 Cookie bootstrap、Host/Origin/Content-Type 门禁、Studio 跨范围拒绝、凭据重定向拒绝、仅全局单播地址、DNS pin/remote-address 校验、流式响应大小上限和 Windows/POSIX 敏感路径权限合同。
- 媒体与交付：从工作区根逐级拒绝符号链接、跨 Studio 生成 journal 拒绝、verified snapshot、Provider reference/mask 冻结读取、同 inode/pathname 竞态拒绝、递归 orphan 对账、Studio-scoped 交付 journal、冻结文件集合和带 backpressure/abort 的流式 ZIP。
- 数据迁移：Schema v17 保留唯一可归属的旧幂等回执和用户任务类型，歧义数据进入隔离表；用户任务类型按 Studio 隔离。
- Workbench：route stale-response 防护、Studio-scoped SSE cursor、Generation History、三阶段可恢复交付、搜索 combobox、跨项目/轮次状态重置、portal/backdrop/inert 模态框、移动 44px 目标和 reduced-motion。

### 真实浏览器证据

- 在未配置 Provider 的临时稳定工作区完成真实 Chromium smoke；未执行 plan、confirm、preflight 或 run，因此没有外部 Provider 调用。
- 桌面 1440×1000 验证错误 capability 不挂载工作台、fragment 保留、替换为有效 capability 后重试成功；素材预览打开时应用根实际设置 `inert` 与 `aria-hidden`，backdrop 关闭后焦点返回触发按钮。
- 移动 390×844 验证项目资产页面无 document 横向溢出，主要控件、素材卡和导航完整可见；浏览器控制台在授权成功后的业务流程中无错误。

### Provider 验证边界

本轮发布验证刻意没有调用真实图片 Provider。真实计费生成、Provider 侧最终规格接受度和外部请求结果只能在后续得到用户明确确认的独立验证中记录。

## 5. daoge-pic 5.8.0 发布验证证据

本节对应 [`daoge-pic-v5.8.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.8.0) 的发布源码与 GitHub Release `.tgz` 资产。5.8.0 以“会话为入口、Studio 为共享工作台”为稳定协议：同一稳定 workspace 的多个会话共享唯一 daemon 与 Workbench，每个真实 conversation 建立独立 Studio Session，并保持项目、任务、轮次和 Run 归属隔离。

Provider 配置以 `Provider.db` 为唯一运行时事实源，支持多个 Profile、唯一 active、write-only API Key/完整 Base URL 与 Workbench 设置界面。既有 `provider.env` 只作为首次升级的一次迁移或显式 import 输入，成功后不再参与运行时读取；切换 Profile 或其配置版本后必须受控 restart。执行型触发按“稳定 workspace → 普通 open/open-reuse → conversation Session → 项目上下文 → 创作澄清”的顺序执行，咨询/开发型触发不启动 Studio。Workbench 使用 per-tab `sessionStorage` UI Session，与智能体 Sessions 分离。

并发只属于 Generation Run：系统硬上限 `1000`、默认 `4`、串行 `1`；preflight 冻结 `executionConcurrency`，queue 与 run 阶段都不能改写。旧 workspace worker concurrency 与 `config --worker-concurrency` 已移除。Provider 响应使用精确 secret 净化并约束 request-id；打包清单拒绝敏感数据库、配置、runtime 与日志。binary import、fair scheduler、reference flag 和 repeat import 回归均纳入 5.8.0 验证边界。

### 最终机器验证

- 验证日期：2026-09-02；本地 macOS、Node.js 22+。
- build：PASS；TypeScript 与 Vite 生产构建成功。
- 完整自动化回归：`238/238` 通过，0 失败、0 取消、0 跳过、0 待办。
- targeted 集合：`60/60` 通过，包括 `daemon-lock.test.js` 5 项、`daemon-resilience.test.js` 5 项、`worker.test.js` 15 项、`skill-startup-contract.test.js` 4 项、`multi-session-contract.test.js` 3 项、`api.test.js` 12 项、`cli-contract.test.js` 15 项、`workbench-session.test.js` 1 项。
- package 验证：96 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`；临时 consumer 安装、`node_modules/.bin/daoge` 与 `--help` 通过。清单显式拒绝 Provider.db、studio.db、`daemon-lock.sqlite` 及其 journal/WAL/SHM、工作区 runtime、真实 `provider.env`、日志、源码和退役路径。
- 安装包跨会话场景：同一稳定 workspace 的 4 个并发首次 CLI 收敛为唯一 daemon/PID 与单一 opener 结果，其中 1 个 `opened:true`、3 个 `reused:true`，并以 4 个真实 conversation ID 建立 4 个彼此隔离的 Studio Session；项目与 Run 归属未串话。

### SQLite process lock 与关闭安全证据

- 唯一进程互斥由独立 `runtime/daemon-lock.sqlite` 连接持有不提交业务数据的长期 `BEGIN EXCLUSIVE` 事务实现；连接使用 100ms `busy_timeout`、`journal_mode=DELETE`、`synchronous=FULL`。第二持有者只在 SQLite 主结果码为 `SQLITE_BUSY (5)` 时报告 already running。正常关闭按 pid+ownerId 精确删除 owner record 后 `ROLLBACK`/close；崩溃时由 OS/SQLite 自动释放文件锁，遗留 record 不参与互斥。
- 永久回归实际覆盖同进程双连接互斥、持锁子进程 `SIGKILL` 后立即重获、无关存活 PID 遗留 record 的原子覆盖，以及四个并发首次 CLI 只收敛到一个 daemon PID；loser 子进程全部退出。唯一 owner 收到一次安全 `SIGTERM` 后，测试等待 PID 与 runtime owner 文件消失，再观察 250ms，确认 loser 不接管、不重建 daemon。
- daemon 关闭先停止 Worker；即使 Provider 忽略 abort 且请求不返回，`worker.shutdown()` 也会使已领取项进入 `outcome_unknown`，不会等待该 Provider 或自动重放。Worker tick、HTTP service 与 HTTP connection 关闭均有边界，数据库关闭和 mutex 释放完成后才卸载 `SIGTERM` 处理器。
- 协调 DB 权限固定为 0600、runtime 目录为 0700，启动拒绝协调路径上的 symlink 或非普通文件。DELETE 模式不使用 WAL/SHM；可能出现的 rollback journal 由 SQLite 管理，不做可能误删新持有者文件的用户态清理。

### 制品、迁移与验证边界

- 先前 SHA-256 为 `a454326e3b5c47ce0f9c54629f245eaf5c6d8f438c524876a52221eddca030fd`、安装于 `daoge-pic-5.8.0-a454326e` 的早期候选制品属于 SQLite process lock 与关闭安全修复前基线，现已被后续修复取代（superseded）。该哈希只保留为过程证据，不得作为最终 5.8.0 Release 资产哈希或安装证据。
- 最终 `.tgz` 的 SHA-256 不写入包内文档，避免制品对自身哈希形成自引用；重新 pack 后的最终哈希、字节数与资产身份由 `.tgz.sha256` sidecar 和 GitHub Release 在包外记录。
- 验证没有调用任何真实外部图片 Provider，也没有产生计费生成请求；测试 Provider 与 standalone service 只验证本地边界。opener 行为使用可注入 fake opener 与 API/CLI 契约验证，没有调用真实系统默认浏览器，也没有进行桌面/移动真实浏览器视觉验收。
- `provider.env` 迁移后不再作为运行时配置源；切换 Profile 必须 restart，queue 中不能修改 Run 并发。安装或升级后还需完整重启 Codex，以重建 process-wide Skill registry 并加载 5.8.0。
- 5.8.0 的发布渠道是 GitHub Release 不可变 `.tgz`；`npm install <GitHub URL>` 只是安装该资产的本地方式，不表示 npm registry 已发布对应包。

## 6. daoge-pic 5.9.0 发布验证证据

本节对应 [`daoge-pic-v5.9.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.9.0) 的发布源码与 GitHub Release `.tgz` 制品。5.9.0 合并此前工作树中尚未发布的确认对话框、学习中心、Provider 连接测试、视觉修复和本轮 Workbench 性能修复。

### 性能验证

- 500 次运行对比：6 次 SQL，2.71 ms，返回最近 24 次并明确 `runsTruncated`；此前基线为 3006 次 SQL、563 ms。
- 1000 张选片列表：4 次 SQL，5.73 ms；此前基线为 2003 次 SQL、29.84 ms。
- 10000 个待执行项领取 1000 项：46.03 ms，写入 20 条事件；此前基线写入 1010 条事件。
- 64 MiB 异步媒体快照：总耗时 88.33 ms，最大事件循环延迟 0.92 ms；此前同步路径约 77 ms 阻塞。
- 真实 Chromium smoke：桌面 1440×1000 与移动 390×844 无横向溢出；24 张资产全部使用 thumbnail 响应；全选本页只发 1 个批量选片请求、0 个逐项请求；控制台错误为 0。

### 兼容与安全验证

- 真实 v5.8 工作区副本从 Schema 19 迁移到 Schema 20 用时 10.54 ms；370 个资产、57 个运行和 2000 条保留事件数据结构保持有效。
- 缩略图、ETag、弱 ETag、单 Range、多段 Range 回退、异步导入、异步交付导出、批量选片和事件通知边界均有回归测试。
- `npm audit --omit=dev`：0 vulnerabilities；Vite 开发依赖也已升级到无已知漏洞版本。
- 未调用真实图片 Provider，未产生计费生成请求。

### 最终制品

- `npm run build` 与 `npm test` 已通过；`npm test` 执行 262 项，262 通过。`npm run test:package` 已通过，发布清单包含 98 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- 最终制品 `daoge-pic-5.9.0.tgz` 为 `288686` bytes，SHA-256 为 `d055be3f8ca3e6ebf9561e1e27181c837b949a8ad542cb8734b962417fc61313`；同值记录在 `daoge-pic-5.9.0.tgz.sha256` sidecar 与 GitHub Release。
- 发布渠道为 GitHub Release 不可变 `daoge-pic-5.9.0.tgz`；安装使用该制品，不跟随 `main` 变化。

## 7. daoge-pic 5.9.1 发布验证证据

本节对应 `daoge-pic-v5.9.1` GitHub Release `.tgz` 制品，记录参考素材项目边界修复对应的源码与验证。5.9.1 保留 5.9.0 的稳定会话、Provider、Workbench 和运行契约，并补充项目/共享素材访问控制。

### 项目参考素材边界验证

- 参考图和遮罩只能来自当前项目资产或当前 Studio 明确共享的 `shared_across_projects` 素材。
- 计划创建、计划准备、计划确认、预检、dry-run、排队和 Worker 读取前均重复校验范围。
- 同一 Studio 其他项目的未共享素材被拒绝；撤销共享后预检和 Worker 均拒绝，且 Worker 不调用 Provider。
- 历史越界计划保留原计划事实，不自动替换用户素材；必须重新提交合法计划或显式共享素材。

### 最终制品

- `npm run build`、`npm test` 与 `npm run test:package` 均通过；完整 Node 测试执行 264 项，264 通过。
- `npm audit --omit=dev`：0 vulnerabilities。
- 最终制品 `daoge-pic-5.9.1.tgz` 为 `290741` bytes，SHA-256 为 `7046e652ff7f143f29df182b526b1a2948b24e8f6a5f19578d4917f6a0c442ec`；同值记录在 `daoge-pic-5.9.1.tgz.sha256` sidecar 与 GitHub Release。
- 发布清单包含 100 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- 未调用真实图片 Provider，未产生计费生成请求。

## 8. daoge-pic 5.10.0 发布验证证据

本节对应 `daoge-pic-v5.10.0` GitHub Release `.tgz` 制品，记录机器确认闸门、独立协议、稳定操作身份以及 generation/media worker pool 的发布验证。

### 确认闸门与协议

- `confirm_token` 由 daemon 在 Workbench Cookie 完成人工确认后签发，绑定 `plan_hash + preflight_id + conversation_id`；同一 token 只能预留一个幂等运行操作，换用不同幂等键重放会被拒绝；Bearer Skill/CLI 的确认请求返回 403。
- challenge、consent 和已签发 token 只存在 daemon 内存；daemon 重启后必须重新确认，恢复运行还必须绑定所属轮次的当前 Studio Session。confirm session 必须与 pending challenge 的 session 明确一致。
- 协议声明为 `daoge-pic-skill-protocol 2.0.0`，支持范围 `>=2.0.0 <3.0.0`；2.0.5 客户端被接受，1.9.0 读写请求均被拒绝。

### Worker、幂等与 Workbench

- generation worker pool 处理 Provider 请求与生成结果持久化；独立 media worker pool 处理 sharp 缩略图、ZIP、归档校验和启动媒体对账，control-plane 保持 API/SSE 响应。
- operation-name 使用规范化 JSON payload 派生 key；相同对象的不同键顺序重放同一幂等收据。每次 CLI 命令最多一个 `@-` stdin 标记，Provider 密钥只能通过 stdin 写入，不能作为 argv 值。
- Workbench 实际启动 smoke 通过；只读会话摘要与人工确认闸门具有独立文案，空会话显示无活动轮次状态，最近运行随事件刷新。

### 最终制品

- `npm test`：281 项通过，0 失败、0 取消、0 跳过。
- `npm run test:package`：发布清单 114 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- `npm audit --omit=dev --offline`：0 vulnerabilities；在线 registry audit endpoint 当次返回 503。
- 最终制品 `daoge-pic-5.10.0.tgz` 的 SHA-256 记录在包外的 `daoge-pic-5.10.0.tgz.sha256` sidecar 与 GitHub Release，包大小与 npm shasum 见发布元数据；本文件随制品发布，不重复嵌入会改变自身内容的哈希。
- 未调用真实图片 Provider，未产生计费生成请求。

## 9. daoge-pic 5.10.1 发布验证证据

本节对应 `daoge-pic-v5.10.1` GitHub Release `.tgz` 制品，记录 Schema v22、控制面查询优化、媒体校验并发边界、Provider 响应内存边界和可重复性能基准。

### 性能与运行边界

- Schema v22 新增运行、预检、运行项、事件和媒体恢复索引；启动恢复不重复执行资产媒体操作恢复，terminal reconciliation 合并为聚合查询和单事务。
- claim 先计算全局可用槽位，再读取 pending 候选；Provider 活跃请求由单机资源预算限制为 4，持久队列仍保留 `1..1000` 的逻辑并发契约。
- `npm run bench:perf` 覆盖 1k、10k、100k pending 项；100k 场景领取 1000 项，实测 claim 约 142 ms，RSS 约 86 MiB。

### 最终制品

- `npm test`：288 项通过，0 失败、0 取消、0 跳过。
- `npm run test:package`：发布清单 114 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- 最终制品 `daoge-pic-5.10.1.tgz` 的 SHA-256 记录在包外的 `daoge-pic-5.10.1.tgz.sha256` sidecar 与 GitHub Release；本文件随制品发布，不重复嵌入会改变自身内容的哈希。
- 未调用真实图片 Provider，未产生计费生成请求。
## 10. daoge-pic 5.10.2 并发升级验证证据

本节对应当前 `daoge-pic-v5.10.2` 源码变更，记录 Provider 并发 Governor、响应流式落盘、健康指标和临时文件清理边界。5.10.1 的四路历史行为仅保留在上一节，不再作为当前运行契约。

### 并发与资源边界

- Provider 安全目标并发上限为 `100`，初始目标为 `16`；健康窗口按 25% 增长，429 进入 30 秒冷却并减半，临时/未知结果按 25% 降速。
- Worker 池父进程统一分发 Provider 配额，子进程只接受父级容量；Generation Run 的逻辑并发和 SQLite 全局 `1000` 租约边界保持不变。
- Worker 子进程回传 Provider 成功、429、临时/未知结果以及 RSS/外部 Buffer 样本；`/api/providers` runtime 只返回脱敏的目标、活动配额、原因和资源峰值。

### Provider 媒体路径

- JSON/Base64 Provider 响应按流解析并增量解码到受控临时文件；公开图片 URL 按既有 SSRF、DNS 固定和大小校验逐跳流式落盘。
- 不超过 `1 MiB` 的小结果保持兼容 Buffer；较大结果以临时文件身份进入 staging，生成资产持久化完成、取消或租约丢失后清理临时目录。

### 批量功能

- 逐图提示词 `itemPrompts` 在预检校验数量、非空值和单条 `8 KiB` 上限，并在 dry-run 与 queued Run Item payload 中按序冻结。
- Generation History 的 failed、blocked、retry_wait 运行项重试入口通过 Workbench 回归，沿用稳定 request identity 和未知结果不自动重放边界。

### 最终机器验证

- `npm test`：294 项通过，0 失败、0 取消、0 跳过；覆盖自适应 Governor、Provider 大 Base64 响应流式落盘、临时文件清理、Worker 池对本地模拟 Provider 的超过四路并发、租约恢复和现有全量回归。
- `npm run test:package`：构建 TypeScript 与 Vite Workbench 成功；发布清单 116 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- 最终制品通过 package smoke 校验；制品大小和 SHA-256 只记录在包外 `daoge-pic-5.10.2.tgz.sha256` sidecar 与变更记录中，不嵌入会改变自身内容的本文件。
- 高并发回归使用本地模拟 Provider，单 Worker 池首轮实际超过四路并发；未调用真实图片 Provider，不产生计费生成请求。
- `npm run bench:perf`：Schema v22 下 1000/10000/100000 pending 队列分别领取 1000 项；100000 项 claim 为 `132.28 ms`，进程 RSS 为 `86.6 MiB`。

## 11. daoge-pic 5.10.3 重复运行防护验证证据

本节对应当前 `daoge-pic-v5.10.3` 源码变更，记录确认入口收敛与轮次级重复运行防护。5.10.2 的并发与媒体路径证据保留在上一节，不替代本版本验证。

- Workbench 人工确认闸门只提交 `/confirm`，不再从浏览器执行预检或创建运行；确认成功后明确引导用户返回当前智能体会话。
- `/preflight` 与 `/api/runs` 的写入只接受 Bearer Skill/CLI，旧 Workbench 页面或其他 Cookie 客户端不能创建第二批。
- 同一轮次可在首个运行入队前保留并行预检证据，但首个运行创建后，其他预检证据、幂等键或入口均在事务内收到 `409` 冲突；再次预检也不会写入预检或幂等回执。失败项继续在原运行内重试，再次生成使用新的变体、优化或补图轮次。
- 定向确认、API、运行、多会话和学习中心回归共 45 项通过；`npm test` 共 295 项通过，0 失败、0 取消、0 跳过。
- `npm run test:package` 构建 TypeScript 与 Vite Workbench 成功；发布清单 116 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- 本次验证未调用真实图片 Provider，未产生计费生成请求。
