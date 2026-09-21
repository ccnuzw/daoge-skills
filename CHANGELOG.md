# 变更记录

本仓库的两个 Skill 独立发布。`daoge-docs` 标签格式为 `daoge-docs-vX.Y.Z`，`daoge-pic` 标签格式为 `daoge-pic-vX.Y.Z`；每个标签对应此文件中明确的版本条目。

## daoge-pic 6.2.0 - 2026-09-21

**小版本（回归 agent 效率：投影、等待、前移）**：协议仍 `3.1.0`、Studio schema 仍 `41`、运行时兼容范围仍 `>=6.0.0 <7.0.0`，无数据迁移；新增能力全部是加法。

- 版本元数据：package/runtime `6.2.0`；Skill protocol `daoge-pic-skill-protocol/3.1.0`；运行时兼容范围 `>=6.0.0 <7.0.0`；Studio schema `41`。正式制品 `daoge-pic-6.2.0.tgz` 为 758,904 bytes，npm shasum 为 `49b70f4955b82bacd8641a2d5a8cccf96410d22a`，SHA-256 为 `dd5706c17527f4bf100ffdc1c9c3f6999eb414c179f62e84ab620254f0cf6ece`。
- **响应投影（写与读都不再回显计划正文）**：`plan` / `preflight` / `run` / `pause` / `cancel` / `resume` / `round-status` / `provider-list` / `project-list` 默认只回 id / 状态 / 版本 / 计数与问题清单；`--full` 回原始 API 形状。实测一份 4 张的中位计划：写计划回显 21.3 KB → 约 0.2 KB，预检 13.6 KB → 约 0.1 KB，一次 `round-status` 32.1 KB → 约 0.3 KB（较大样本 109 KB）。投影同时**不再回传确认挑战值与 `planHash`**。
- **`daoge wait`：等待终于有动词**。以 `/api/events` 的 cursor 作唤醒、以 round detail 的 `latestRun.status` + `tally` 作权威状态，一次调用等到终态（`completed`/`failed`/`cancelled`/`partial`）、首张成功或超时；超时回真实状态并带 `timedOut: true`。
- **校验前移**：`plan`（=准备确认）写入前先跑同一份 preflight 规则做纯形状校验，Provider 已配置时连能力/限额一起判；失败回 `400 {code:"plan_invalid", details:{issues:[…]}}` 且批次停在 `draft`。机器可判的错误不再拖到人工确认之后。
- **写侧合并**：`plan --project <名|id>` 自动找到/建立 draft 任务与批次并读回版本号；`plan --version` 可省；`run --auto-preflight true --session <id> [--wait true]` 先预检再入队（预检记录与 `confirm_token` 绑定不变）；`delivery-export --project/--assets/--name` 一步走完草稿→准备→导出。
- **配方注入**：`plan --style-kit <id> --brand-kit <id>` 由服务端把配方正文合并进计划（合并结果进 plan hash，`appliedKits` 记录出处）——同一套风格做多批时只写增量。
- **读侧补齐**：新增 `task-list` / `round-list` / `round-detail`（含 tally）/ `run-items`（可按状态与分页过滤）；`provider-list` 默认瘦身、`--descriptors` 才给能力全表；`project-list` 支持 `--name/--status/--limit`。
- **租约与时间窗**：`request-accept` / `request-renew` 新增 `--lease <分钟>`（1–1440），跨人工确认的长活不必每 10 分钟发一次心跳；`round-status` 投影里带挑战与 consent 的 `expiresAt`，慢点击导致的重来变得可预判。
- **帮助分组**：`daoge --help` 先列「Agent 主线」，再列「人类 / 运维（生成服务、备份、安装、用量）」。
- **Workbench**：事件消费收敛到纯逻辑模块（`web/src/studio-events-model.mjs`）——游标只前进、`snapshot-required` 前不推进游标、乱序/重复 id 不回退。

## daoge-pic 6.1.1 - 2026-09-21

**补丁版本（首屏分包 + Windows 修复）**：协议仍 `3.1.0`、Studio schema 仍 `41`、运行时兼容范围仍 `>=6.0.0 <7.0.0`，无行为变化、无需数据迁移。

- 版本元数据：package/runtime `6.1.1`；正式制品 `daoge-pic-6.1.1.tgz` 为 728,343 bytes，npm shasum 为 `4a392515fdfa11caae68fa98ba3b0670ff453b9a`，SHA-256 为 `07015c4336fb1c75d8f6a519787759686a2393f92a66457e8d6b0da21d94a833`。
- **Workbench 首屏分包**：八屏（含创作平台的 canvas 链）、创作对话框与 Provider 设置页改为 `React.lazy` + `Suspense` 按需加载；首屏入口 JS 708,483 → 427,652 B（-40%），按需块 26 个 / 288,382 B 只在打开对应界面时下载。
- **Windows 修复**：`daoge reference --section` 兼容 CRLF 检出的附录文件；此前 Windows 上按节读取会报「未找到章节」（6.1.0 的四个 Windows CI 组合即栽在这里）。新增 CRLF 回归断言，任何平台都能守住。
- **验证证据**：`workbenchChunkLabels()` 如实报告「入口 + 按需块 N 个 / 总大小」，不再只报入口。
## daoge-pic 6.1.0 - 2026-09-21

**小版本（连接与 token 效率）**：协议仍 `3.1.0`、Studio schema 仍 `41`、运行时兼容范围仍 `>=6.0.0 <7.0.0`，可与 6.0.0 daemon / Workbench 平滑共存，无需数据迁移。

- 版本元数据：package/runtime `6.1.0`；Skill protocol `daoge-pic-skill-protocol/3.1.0`；运行时兼容范围 `>=6.0.0 <7.0.0`；Studio schema `41`。正式制品 `daoge-pic-6.1.0.tgz` 为 710,823 bytes，npm shasum 为 `074a93d3df6682a84a5cfa02ef48525690c6d163`，SHA-256 为 `fa11259f76350eb4e8304e68c3f443bdc4210c4129a234685e4f6c95c17a7890`。
- **一步连接**：新增 `daoge enter`，一次调用内完成 daemon 就绪、打开/复用 Workbench、登记在场、建立/恢复会话、按项目名进入项目、读取请求队列；补上 `session-context --project` 只吃 internal projectId 的断点。
- **项目解析**：`--project` 接受项目名或 projectId；精确名 / 精确 id / 唯一包含才绑定（active 优先于 archived）；歧义或找不到返回 `projectResolution` 与候选，绝不猜、不新建重名项目；新增 `project-list`。
- **构建身份**：daemon 启动时钉住 `dist/vnext` 内容哈希；`status` / `enter` 返回 `build.staleBuild`，陈旧且无在飞请求时 `enter` 自动换进程并报 `staleRestart`；新增 `daoge stop`。禁止用 ps / 时间戳 / git 反推 daemon 新旧。
- **会话身份**：`enter --conversation auto` 读 `DAOGE_CONVERSATION_ID` / `OMP_CONVERSATION_ID`，拿不到 fail-loud；返回 `conversationSource` 与 `contextBound`。
- **CLI token 效率**：`enter` 输出精简约 80% 且默认紧凑；`--help` 默认速览、全签名移入 `--help --full`；新增 `reference <topic> --section <标题>`、`round-status`（合并 plan-status + runs）与 `plan --challenge true`（写计划同时建挑战）；`enter` / `status` / `open` / `restart` 不再回显 origin。
- **Skill 渐进披露**：SKILL.md 从约 10.6k 压到约 3.2k tokens，长尾拆入 `references/`（boundaries / startup / build-identity / flow / queue / commands / recovery / delivery / state-model / provider-keys / workbench），新增 `daoge reference <topic>` 供任何宿主按需取用；新增体积上限与「附录是封闭集合」守卫。
## daoge-pic 6.0.0 - 2026-09-20

**大版本（以人为本重构）**：跨出运行时兼容上界，Studio schema 追加 7 条迁移，Skill 协议升到 3.x，Workbench 全站界面按新的界面标准重做。主题是把创作动线（建立项目 → 提出需求 → 生成运行 → 选片评审 → 资产交付）放回首屏，把工程细节收进二级。

- 版本元数据：package/runtime `6.0.0`；Skill protocol `daoge-pic-skill-protocol/3.1.0`；运行时兼容范围 `>=6.0.0 <7.0.0`；Studio schema `41`（自 34 起追加迁移 35–41）。正式制品 `daoge-pic-6.0.0.tgz` 为 694,985 bytes，npm shasum 为 `5e72b9c3f599eda419ddc66a7f7e242a9f1504a8`，SHA-256 为 `699780cc567e3a77d7f7540068774f115d486ceb3062bcb5693bb381eabbbd22`。
- **请求队列**：Studio 与 Agent 共用 `studio_requests` 一条队列（领单租约、续租心跳、回执、就地追问）；「重试 / 恢复」走队列，暂停 / 取消仍由 Workbench 直达。
- **协议**：3.0.0 引入请求队列（breaking）；3.1.0 为加法字段 `PreflightPlan.understanding`（旧 agent 兼容）；新增 daemon ↔ Studio 版本协商握手。
- **画布**：折叠到批次级、去冗余、增量布局、系统生成分组与连线、圈选发起、就地建任务/批次；视图收敛为三种（全局 / 按图片 / 按交付）。
- **挑图与出图过程**：2–4 张对比、4× 缩放、预览态键盘、占位符逐张填充、「出完了叫我」、取消运行 5 秒撤销。
- **失败与恢复**：四类人话归因、「原因 → 建议」映射表、provider 全挂 / 磁盘满首屏提示、`outcome_unknown` 先对账再请人核实、重试走队列。
- **agent 连接**：`GET /api/agents/detect` 侦查与连接面板、在场登记与状态卡。
- **Provider / 用量 / 预算**：系统凭据存储 fail-closed、端点信任模式、`usage-list` / `usage-summary` / `budget-get` / `budget-set`、`preflight --usage-estimate`。
- **我的配方**：`confirmed_templates` / `style_kits` / `brand_kits` 用户侧入口，带出可改、不自动执行。
- **界面重设计（批 A–E）**：token / PageFrame / 状态槽 / 三档断点、rail 三区 + 一张状态卡、面包屑替换上下文条、创作平台一条 48px 工具条、队列贴底让位、Aside 统一、三面归位、App / 画布 / CSS 拆分与 G1–G25 守卫。
- **鉴权**：`runs.pause` / `runs.cancel` 移出鉴权表（两者皆可）；`sessions.context` 收为 bearer-only；`rounds.confirm` 仍 cookie-only。
- **数据**：旧结构数据与图片资产全部不迁移；旧库与素材原地存档，回滚 = 停新 daemon、起旧 daemon。
- 本版本明确不做：§9.9 出图过程「预计还要多久」、就地建项目、画布级菜单项移入工具栏。
- 全量回归：918 项，916 通过 / 0 失败 / 2 跳过（本地 macOS，Node 22+；发布前复跑为准）。

## daoge-pic 5.14.2 - 2026-09-16

- 版本元数据收口到 package/runtime `5.14.2`，Skill protocol 保持 `2.0.0`，运行时兼容范围更新为 `>=5.14.2 <6.0.0`；正式制品 `daoge-pic-5.14.2.tgz` 为 623,346 bytes，npm shasum 为 `f880aa826cab5a7efb85d542da3b484a99e545a1`，SHA-256 为 `6e38ff8a208048c163575051d494cb5856df2e6325b8e9ca31ccbc166ad3bdf3`。

### Studio 疑难处理页

- **新增「疑难处理」视图**（Studio 级，入口在左侧栏辅助区）：三块讲清出事时该看什么——后台现在什么状态、数据还在不在、怎么把数据找回来。
- **数据体检**：只读数一遍 Studio 里的素材与已交付文件，导出一份不含图片内容、不含密钥的清单，并给出一句人话汇总。清单用于核对数据是否完整，或在迁移与请人排查时交给对方。
- **恢复只在命令行做，且界面里写明了原因**：恢复会重写整个 Studio 的数据，服务端那条路由只接受本机命令行身份（浏览器 cookie 调用返回 403），所以界面不放置恢复按钮，只给路径、命令与每步说明。界面上的 CLI 指引不写死参数，命令名由测试对着 CLI 命令表锁住，防指引腐烂。

### 术语治理收口

- **`scope` 字段从「只检查取值合法」变成真规则**：新增 `configFaceTerms()` 与守卫断言，配置面专属术语不再能飘进创作者面（左侧栏「请先创建并激活 Profile」等 5 处被拦下）。
- **「处理池」进术语单**（收回级），运行状态相关文案清除同批工程词：`HTTP 服务` → 页面服务、`权威快照` → 最新数据、`子进程` → 后台任务。
- **设置页限额项改为纯人话**：由「运行并发上限 / 请求超时 ms / 自动重试上限」改为「同时最多出几张 / 等多久算超时（毫秒）/ 失败后最多重试几次」。这几个旋钮别处没有文档要照抄，说人话比留术语省认知；照抄型字段（`Base URL` / `API Key` / `Provider` / `模型`）继续保留原文。
- 顺带接回一处断掉的单一来源：`LIMIT_FIELDS` 早已写好人话名字，表单 label 却一直硬编码旧文案。

### Windows 门禁

- 修掉 4 类只在 Windows 上成立的问题，Windows CI 的 4 个组合（`windows-2022` / `windows-2025` × Node `22.17.0` / `24`）首次全部转绿：
  - 备份清单的路径判定顺序：Windows 绝对路径（`D:\a\b`）同时含反斜杠，原先被误报成「格式非法」而不是「必须是相对路径」。
  - 待恢复记录的路径比较改走 `sameWorkspaceRoot()`：手写 realpath 比较少了 win32 大小写归一，会把完好的待恢复记录判成损坏。
  - daemon identity 的 `0600` 权限断言改为仅 POSIX 成立（Windows 没有 POSIX 权限位，`chmod` 只动只读位）。
  - 前端源码守卫把 `path.relative` 的结果归一到 POSIX 分隔符。
- 恢复 `test:package` 里被误删的 `npm pack`：`--require-release-artifact` 原先在要求一个它自己已不再生成的制品。

## daoge-pic 5.14.1 - 2026-09-15

- 版本元数据收口到 package/runtime `5.14.1`，Skill protocol 保持 `2.0.0`，运行时兼容范围更新为 `>=5.14.1 <6.0.0`；正式制品 `daoge-pic-5.14.1.tgz` 为 605,624 bytes，npm shasum 为 `30ae270012683d90528f18019f50f38a142acdbb`，SHA-256 为 `41eb6d6a39caa976d4cf0e059cf1b66239de77ea0d2909cefb9743cace3cf258`。

### Provider 设置面板真正可用

- **连接测试不再自相矛盾**：面板原先拿只接受 `POST` 的生成端点当探针，`GET` 必然返回 404，却把结果渲染成「端点可达（HTTP 404）」。现在按 Provider 是否声明模型列表选择探针（有列表走模型列表端点，无列表回退生成端点），连通性回执如实反映探测结果。
- **「获取模型」返回真实清单**：不再显示「Provider 细节已脱敏」这类占位文案，改为从模型列表端点读取并展示真实模型；失败按凭据或后端问题归类。
- **错误分类补齐**：新增 `secret_backend` 分类，`400/422` 归入校验类，密钥后端冲突 `409` 单独提示，使面板报错指向真正原因而不是笼统失败。
- **面板按钮在浏览器里可用**：同源 Workbench 调用者恢复访问凭据端点（此前只接受 bearer，导致「本地校验 / 连接测试 / 获取模型」三个按钮在页面上不可用）；同时删除面板里提示这三个动作需要回命令行的说明块。

### 上下文与路由

- **修复「请先打开生成运行视图，再继续查看运行。」误报**：根因是路由不变量只在部分入口生效——`normalizeRoute` 在计划、结果、轮次对比、资产与概览视图上仍保留 `runId`，而上下文加载器判定 `view ∉ {runs, lineage}` 且 `runId` 存在即为错误，于是上下文栏一半以上的标签会亮出无法消除的错误横幅。现在 `runId` 的保留/丢弃由唯一的 `normalizeRoute` 决定，手改 URL 或旧书签同样被收口。
- **缺失层级上下文自动降级**：请求的上下文层级（轮次 / 任务）背后没有实际对象时不再保留，避免 `assetRefreshPath` 返回空值导致资产列表静默停留在错误范围。

## daoge-pic 5.14.0 - 2026-09-15

- 版本元数据收口到 package/runtime `5.14.0`，Skill protocol 保持 `2.0.0`，运行时兼容范围更新为 `>=5.14.0 <6.0.0`；正式制品 `daoge-pic-5.14.0.tgz` 为 599,181 bytes，npm shasum 为 262a83a071f744e62024d90cc8cc9aba49fa8fa2，SHA-256 为 4113d15995c92c78d95b4777436c4071dcd06bdec315b6a59e57580838c9d43b。

- 修复带任务或轮次上下文的资产评审：评审资产必须属于该上下文项目或已明确共享到当前 Studio，避免跨项目写入误导性评审记录。
- Provider 成功返回外部请求标识后，在运行项进入后续结果阶段前持久化 `run_items.external_request_id`；显式重试会清理旧标识并生成新的本地请求身份。
- 限制创作谱系剩余分页请求的并发为 4，并保持分页结果顺序，避免大型项目一次性建立无界 HTTP 请求峰值。
- 接入 Bearer-only 的确认模板快照 API 与 `template-list`、`template-get`、`template-save`、`template-archive`、`template-rollback` CLI；保存、归档和回滚复用结构化幂等收据，模板版本保持可读且不可变。
- 新增 usage ledger 与 hard budget 的 vNext API/CLI：`/api/usage`、`/api/usage/summary`、`/api/budget` 及 `usage-list`、`usage-summary`、`budget-get`、`budget-set`；读取按当前 Studio 分层范围校验，未知成本保持显式，预算写入 Bearer-only 且复用幂等收据。

### 冻结前收口

本批功能在冻结前补齐了三处「机制已就位但生产链路不生效」的缺口，并加固了构建闸门：

- **预算闸门真正生效**：计划预检声明的成本估算现在被冻结到 `generation_runs.usage_estimate_json`（Studio Schema v32），运行项记账按序号把该总额摊到每一项，整数余数分给前若干项，因此累计值恰好等于已声明总额。此前 runner 记录的用量成本恒为 `null`，预算的「已花费」累计永远是 0，任何额度都拦不住运行。未声明估算的计划仍在账本里保持显式 unknown，平台不推断价格。
- **预算闸门覆盖重试路径**：闸门原先只在预检执行一次，重试与恢复可以绕过。现在 `retry` 批量重试前会按预算策略与成本单位聚合候选运行项的已知估算并再次过闸，超额项不进入重试；聚合时仅对「运行状态已占用预算」或「该项已有已知用量记录」的项计入新增预留，避免同一额度被重复预留。
- **参考图不再静默丢失**：预检新增 `reference_requires_edit`，拒绝「计划声明了参考素材或遮罩，却把 `operation` 设为 `generate`」的计划。此前这类计划会通过关于参考图的全部校验、被写入来源记录并被确认，但 provider 的 generate 请求体只包含提示词，参考图从未上线；结果是用户付费拿到一批未使用参考图的结果。
- **线协议一致性断言**：新增回归直接断言「同一个请求对象下，`generate` 的 JSON 请求体不携带参考素材，而 `edit` 的 multipart 请求体确实上传了该素材」，把上述不变量固定下来。
- **构建闸门前置**：`tsconfig.vnext.json` 启用 `noEmitOnError`，`build:vnext` 拆出独立的 `typecheck:vnext` 并在清理 `dist` 之前执行，避免类型错误时留下「看起来构建成功、实际不可用」的半成品 `dist`。
- **验证证据机器产出**：新增 `npm run verify:evidence`，从真实构建与真实回归生成 `docs/vnext_verification_evidence_zh.md` 的工作树证据区块；`npm run verify:evidence:check` 在区块与代码不一致时失败，取代此前靠人工维护的测试计数。

### 按复核建议的后续修正

- **`backup-upgrade-assess` 不再自我认证**：`supportedSchemaVersion`、`supportedProtocolRange`、`currentSchemaVersion`、`currentRuntimeVersion` 原先全部由请求体提供，调用方传一个更大的支持范围即可把任何目标判为兼容。现在这些「本运行时能力」由 daemon 自证（读取自身的 `STUDIO_SCHEMA_VERSION`、数据库实际 schema、`RUNTIME_VERSION` 与协议范围），请求体只接受目标声明；CLI 相应移除 `--current-*` 与 `--supported-*` 参数，响应新增 `runtimeFacts` 便于核对。
- **备份 manifest 在真实 Studio 上可用**：原先素材数硬限 500，而本机 Studio 有 1114 个素材（合计约 5.2 GiB），`/api/backup/manifest` 直接 400 不可用。根因是清单哈希在 `BEGIN IMMEDIATE` 写锁内进行，5 GiB 内容会让所有写入阻塞约 20 秒。现在清单只把「checkpoint + 证明无待写 WAL + 哈希 studio.db」放在写锁内，素材与交付冻结文件改为在锁外哈希并复用同一份观测（`createBackupManifest` 新增可选 `snapshot` 入参），上限提升为 `MAX_BACKUP_MANIFEST_ASSETS` 并给出可操作提示。
- **备份 manifest 不再静默截断**：`listStudioAssets` 内部把每页钳到 500 行，而备份清单只调用一次，于是超过 500 个素材的 Studio 会得到一个「看起来完整、实际缺一半」的清单。现在按 offset 分页枚举到上限为止，实测本机 Studio 的 1114 个素材全部进入清单。
- **备份 manifest 兼容旧版交付冻结清单**：早期运行时把已导出交付的冻结文件记在 `files`（键为 `file`，且没有 `byteSize`），当前代码只认 `exportFiles`，因此只要 Studio 里有一个旧交付，整个备份清单请求就会失败。现在两种形状都接受——`name`/`file` 互为别名，缺失的字节数由磁盘实测补齐，而冻结记录里的 `contentHash` 仍是强校验锚点。
- **备份能力表述诚实化**：`backup/restore.ts` 仍然只有 dry-run 规划，不存在 apply/恢复执行器。已在模块头注释、SKILL.md 命令分组与 CLI 帮助中明确写出，并禁止向用户承诺这些命令可以回滚 Studio（真实回滚只能靠文件级快照替换）。

### 安全默认与口径统一

- **Provider 密钥不再默认明文入库**：`createProviderSecretStore` 的默认档由「显式要求系统后端才启用」翻转为「平台支持就用系统后端，不支持时显式告警降级」。此前未设 `DAOGE_PIC_PROVIDER_SECRET_BACKEND=system` 时，API Key 一律以明文写进 SQLite。同时修复 macOS Keychain 写入：原实现把 `-w` 放在参数末尾，而 `security add-generic-password` 的 `-w` 末位语义是**交互式提示**，写入会永久挂起等待 tty——因为这个路径从未被默认启用所以一直没暴露；现在值作为 `-w` 的实参传入，并为所有子进程调用加了超时，避免系统钥匙串等待授权时把 daemon 卡死。列表路径（`apiKeyConfigured`）不再解密密钥，只读引用判断存在性，并对解密结果按 `configVersion` 缓存，避免 daemon 每 350ms 一次 tick 都同步 spawn 子进程。
- **JSON 规范化与哈希收敛为单一实现**：仓内原有 5 份 `canonicalValue` / `canonicalJson` / `stableJson` / `digestJson` 实现，口径互不相同——最严重的是 provenance 的 `digestJson` 直接用 `JSON.stringify` 不排序，导致语义完全相同、仅键顺序不同的评审反馈或计划会得到不同的 `feedbackHash` / `planHash`。现统一到 `shared/canonical-json.ts`（键排序、去 `undefined`、其余位置 `undefined`→`null`、非有限数→`null`，`strict` 模式改为抛错）。统一口径刻意与原先的 `canonicalValue` 保持一致，因此幂等键与 provenance `contentHash` 的既有锚定值不变；备份 manifest 保留其严格语义，通过 `strict` 选项表达而不是再写一份。
- **支持 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY`**：Provider 传输层自行解析 DNS 并连接固定地址（不走 `fetch`），因此既有的代理环境变量对它完全无效——在只有企业 HTTP 代理出口的网络里，所有 Provider 调用都会在连接阶段失败。现在按标准规则读取代理：`https_proxy` 只对 https 目标生效、`all_proxy` 作为兜底；HTTP 目标以绝对 URI 转发，HTTPS 目标用 CONNECT 隧道（TLS 仍然端到端终止在 Provider，不在代理）；`NO_PROXY` 支持域名、`.` 前缀、通配符、`host:port` 与 `*`，且按每一跳重定向重新判定。两个安全边界是刻意的：代理地址按端点信任模式校验（并额外接受回环/CGNAT/overlay，因为企业代理与本机透明代理本就位于内网地址，要求公网代理会让常规用法直接失败），而链路本地、云元数据、多播与保留段在任何模式下都禁止；目标若为字面 IP，即使走代理也仍然过本地策略，因此「元数据地址一律拒绝」不会因配置了代理而失效。
- **Studio 迁移拆出独立模块 + 迁移契约测试**：`database.ts` 里 34 个版本的建表/改表 SQL 与逐版本特例逻辑整体移到 `studio/migrations.ts`（`database.ts` 577 → 230 行），连接、完整性校验与事件管道留在原处。新增 `tests/vnext/studio-schema-contract.test.js`：迁移版本必须连续且唯一、最高版本必须等于 `STUDIO_SCHEMA_VERSION`（漏改版本号会让新迁移永远不被应用，此前只有在打开数据库时才会暴露）、重复迁移必须是幂等的（二次迁移后 `sqlite_master` 完全不变）、新开 Studio 的迁移账本必须是 1..N。
- **枚举与 SQLite CHECK 的漂移有了防呆**：多份枚举同时写在 SQL CHECK 与 TypeScript 两处，改一边漏一边要到「应用层写入被数据库拒绝」时才暴露。现在 `ROUND_PURPOSES`、`ASSET_KINDS` 成为单一运行时常量，契约测试直接解析 `sqlite_master` 里的 CHECK 列表与之比对。**没有**把这些 CHECK 移除：SQLite 无法直接删除列约束，任何现有 Studio 都要重建整表才能去掉，风险远大于收益；因此选择让两者保持同步并有测试守着。
- **backup restore 有了真正的执行器**：此前 `backup/restore.ts` 只有 dry-run 规划，文档与帮助里明确写着「不得承诺可回滚」。现在新增 `applyBackupRestore`（Bearer-only 端点 `/api/backup/restore` 与 CLI `backup-restore`）：把改动文件先写入目标工作区内的暂存目录并逐文件校验 SHA-256（校验的就是实际写入的字节），全部就绪后用原子 rename 替换；任一步失败即按日志逆序把已替换的文件还原回去，新建的文件则删除，暂存目录无论成败都会清理。两个硬前置条件是执行器自己保证的：目标 Studio 的 daemon 必须已经关闭（在运行中的 daemon 底下替换 `studio.db` 只会得到损坏的 Studio，恢复前检查 `daoge-studio/runtime/daemon.json`），以及源文件的哈希必须与 manifest 一致。恢复只覆盖 manifest 记录的文件，不会删除目标里未记录的文件。回归覆盖：正常恢复、源被篡改、替换中途失败回滚（含「目标原本没有、被新建」的文件要被删掉）、暂存后失败、daemon 在跑、计划未就绪。
- **「一轮次最多一个进行中的运行」成为数据库约束**（Studio Schema v34）：此前这只是应用层约定——`assertRoundHasNoGenerationRun` 先读后插，两个入队请求同时到达可以同时通过检查，而内存里的 `BEGIN IMMEDIATE` 之外没有第二道防线。现在加部分唯一索引 `idx_generation_runs_round_open`。之所以是**部分**索引而非全量 `UNIQUE(round_id)`：本机真实 Studio 里就有 4 个轮次各有 2 条运行（completed+completed、partial+partial、partial+completed），全量唯一会让迁移直接失败、daemon 起不来。索引覆盖的状态是「Studio 会自行推进」的那些（draft / awaiting_confirmation / queued / running / pausing / paused / interrupted / resume_pending）；`partial` 与 `failed` 被排除——它们只有用户显式恢复/重试才会继续，且恰恰是历史重复数据所在。迁移若发现已有的进行中重复，会发出 `DAOGE_PIC_OPEN_RUN_CONFLICT` 警告并跳过建索引，而不是让 Studio 打不开（数据问题不该变成停机）。入队插入捕获唯一约束冲突并转回与原先一致的中文冲突错误。
- **回归不再受宿主机代理影响**：`--env-file` 无法覆盖已存在的环境变量，而 agent 运行时/CI 镜像普遍注入 `HTTP_PROXY`，会把整套 Provider 测试静默改道、让 DNS 固定断言全部失真。新增 `scripts/run-tests.js` 作为测试入口，在启动 runner 前删除代理变量（跨平台，不依赖 shell）。

- **Provider 返回的图片以字节魔数定类型，不再只信 content-type**：`imageMediaType` 原先只对 content-type 做字符串嗅探、默认回落到 `image/png` 且完全漏掉 GIF（GIF 会被标成 PNG）。现在 provider 响应路径复用媒体层已有的魔数检测，只读前 16 字节即可判定。这修掉了一类「已付费但提交失败」的问题：Provider 声明 `image/jpeg` 却返回 PNG 字节时，归档层的 `validateImageBytes` 会因「声明类型与内容不符」抛错，运行项在写入前失败；现在以真实字节为准，能正常落库。返回非图片内容（如网关错误页）的 200 响应现在会被明确拒绝，而不是存成一个打不开的 `.png` 资产。
- **已确认模板读取不再重跑敏感内容扫描**：读取路径原先复用写入期的校验（含敏感键/值正则，键名单包含 `prompt`、`provider`、`url`、`path`、`file` 等），规则一旦收紧，历史快照会让 `listConfirmedTemplates` 整体抛错、模板列表与 rollback 全部不可用。现在写入路径保持完整校验，读取路径只做结构校验（形状、深度、大小、控制字符），因此真实损坏仍被拒绝而历史快照不再连带失效。
- **重试预算闸门的错误码透传**：原先恒抛 `budget_exceeded`，`budget_cost_unit_mismatch` 等真实原因被吞。现在透传闸门真实 code 并带未通过项数。同时把「`failed` 运行不保留预留、由重试路径把候选项份额加回并重新过闸」这一有意设计写进注释并补了回归，避免被误当作缺陷改坏。

### Provider 密钥默认改用系统凭据存储（第 6 轮）

- **默认不再把 Provider 凭据明文写进 SQLite**：`createProviderSecretStore` 的 `auto` 档现在优先使用系统凭据存储（macOS 钥匙串 / Windows DPAPI / Linux libsecret），只有在平台确实没有可用后端、或调用方未提供 Studio 路径时才回落明文，且回落时会发出 `DAOGE_PIC_SECRET_BACKEND_DEGRADED` 警告而不是静默降级。要保留明文需显式设置 `DAOGE_PIC_PROVIDER_SECRET_BACKEND=plaintext`；设为 `system` 则要求必须使用系统存储，不可用时直接报错而不是降级。**已有配置不受影响**：每条 Profile 记录自己的 backend，先前以明文写入的凭据仍按明文读取。
- **修复 macOS 钥匙串写入实际上从未可用的缺陷**：`security add-generic-password` 的 `-w` 被放在参数末尾，而该工具在 `-w` 为最后一个选项时会转为**交互式提示**——非交互调用因此永久挂起（不是报错）。由于默认一直是明文，这条路径从未被执行过，缺陷被掩盖至今。现改为 `-w <value>`。需要说明的是，macOS 没有以 stdin 非交互喂密码的方式，因此密码会短暂出现在 argv 中：这仍显著优于写入 SQLite（后者持久留存、任何能打开数据库的人都能读到，而 argv 暴露仅持续毫秒级且需同用户在同一瞬间采样进程表）。
- **所有系统凭据存储调用现在都有 15 秒超时**：任何转为交互式提示的后端都会快速失败，而不是把 daemon 挂死。
- **凭据读取不再拖慢 daemon**：daemon 每 350 ms 轮询一次并解析活跃 Provider 配置，而每次密钥读取都要同步拉起一个子进程（实测 macOS 约 27 ms），即约 15% 的事件循环被同步等待占用。现加入按 `config_version` 键控的有界读缓存（TTL 5 秒 / 上限 64 条）；`config_version` 在凭据变更时递增，因此轮换密钥即时生效，不会等到 TTL 过期。
- **列表接口不再解密凭据**：`listProviderProfiles` 原本对每行都解密 API key，只为回答「是否已配置」这个布尔问题（能力推导只用到 providerId 与 referenceEnabled）。现改为只判断存在性，列表路径的子进程调用减半，且密钥不再进入一个会被批量展示的代码路径。
- **回归不再污染真实钥匙串**：测试通过 `tests/vnext/test.env` 固定为明文后端（`npm run test:vnext` 与 `verification-evidence.js` 均已注入），系统后端由 `provider-secrets.test.js` 显式覆盖。

### provenance 记录改为不可变（第 5 轮）

- **provenance 锚点不再会被静默改写**：`persistStudioProvenance` 原先是 `ON CONFLICT(id) DO UPDATE SET canonical_json = excluded.canonical_json`，而 canonical body 里嵌着「该资产最新一条评审」（`reviewForProject` 取 `ORDER BY created_at DESC LIMIT 1`）。于是**再评审一次**就会在同一个 recordId 下改写内容——已经对外锚定的 `\`recordId → canonicalHash\`` 关系会在无人察觉的情况下失效，而表面上记录 id 并没变。现在内容一旦漂移，先把当前 body 冻结进新表 `provenance_record_versions`（Studio schema **v33**，按 `(studio_id, record_id, content_hash)` 唯一），再写入新值：`GET /api/provenance/<id>/versions` 列出全部历史，`GET /api/provenance/<id>/versions/<sha256>` 按内容哈希取回**当时那一份**数据。对外应锚定 `(recordId, contentHash)`；`PersistedStudioProvenanceRecord` 新增 `contentHash` / `versionCount` / `superseded`，`versionCount > 1` 即表示该记录漂移过。
- **重复写入同一内容仍然幂等**：不产生新版本、不递增 `version_count`，但 `updated_at` 照常刷新以保持「最后一次被 touch」的语义。
- **迁移前的历史行同样受保护**：`content_hash` 列为空时由 `canonical_json` 现算，因此 v33 之前写入的记录也能正确锚定与冻结。
- 组件 sqlite 的事实源仍为单一 SQLite 文件，本次仅为追加表与两列，未改动既有列。

### Worker 生命周期同源化与池熔断自愈（第 4 轮）

- **看门狗、租约与请求超时改为单一事实源**：此前 `runtime/worker-pool.ts` 的 tick 看门狗写死 12 分钟、`runner/worker.ts` 的条目租约写死 30 秒、`providers/http-adapters.ts` 的默认请求超时却是 120 秒——三者互不相干且相差 24 倍。后果是一条会在生产里真实发生的路径：子进程仍在处理 HTTP 调用时租约先过期，`recoverExpiredLeases` 把条目判成 `outcome_unknown` 并计 `possibly_billed`，而 Provider 侧的请求仍在跑并照常计费，形成**重复计费窗口**；父进程却因为看门狗才走到 12 分钟的一半而完全不知情。现在这三者都由 `studio/runtime-settings.ts` 的常量组派生：租约 = `max(60s, 请求超时 + 1s)`、上限取 `"max lease"`（10 分钟，与 `MAX_RETRY_TIMEOUT_MS` 一致），池看门狗 = `max lease + 2 分钟宽限`（落在原来的 12 分钟，但现在是算出来的）。媒体池原先各自写死 15 分钟，也改为同一份派生值，两个池从此不会再各自漂移。
- **租约按 Provider 配置放大**：`GenerationWorker` 现在从 `providerConfig.limits.requestTimeoutMs` 推导租约（显式传入的 `leaseMs` 仍原样保留，测试与集成不受影响）。把 Provider 超时调到 5 分钟时，租约会跟着变成 5 分 1 秒，而不是继续用不足覆盖一次请求的 30 秒。
- **Worker 池熔断改为半开自愈**：原先任一子进程连续失败 8 次即把整个池标记为 `exhausted`，此后所有 `ensureCapacity` 直接返回，只能重启 daemon 才能恢复——一次 Provider 配置抖动就可能让运行永久卡住。现在熔断后退避 60 秒尝试半开：起一个探测子进程，存活即解除熔断，失败则重新计一次退避。生成池与媒体池行为一致。
- **熔断时不再留下悬挂定时器**：半开探测定时器在 `close()` 时被清理，避免已关闭的池在进程退出阶段继续持有句柄。

### 重启连续性（第 3 轮）

- **daemon 重启不再让已打开的 Workbench 标签失效**：capability、session token 与确认门签名密钥原先每个进程重新生成，而 Workbench 的 Cookie 名由 capability 派生、值即 session token，因此一次重启就让所有标签 401、并丢弃全部已提交的确认挑战与已签发的 `confirm_token`。现在这三项连同 Workbench presence 按工作区持久化在 `daoge-studio/runtime/`（0600，与 `daemon.json` 同级同权限），由运行时统一加载与复用；`open` 在重启后同样报告复用现有 Workbench 而不是再开一个标签。主动轮换仍可做到：删除 `runtime/daemon-identity.json` 并重启，旧 Cookie 与旧 token 立即失效。
- **授权状态不进入业务数据库**：确认门状态、presence 与身份文件都放在 0700 的 `runtime/` 目录而不是 `studio.db`，因此对 Studio 数据的备份或复制不会顺带带走有效的授权凭据。
- **确认门与 presence 的持久化是可选的**：`ConfirmationGate` / `WorkbenchPresence` 不传 persistence 时行为与之前完全一致（内存态），仅 daemon 运行时注入文件持久化；过期清理在恢复时同样生效，单次使用的 token 预留（`operationKey`）也跨重启保持。

### 本地代理信任模式与重试超时（第 2 轮）

- **`local_proxy` 真正支持 TUN／虚拟网卡代理**：该模式原先只放行 127/8，因此本机 Loon 一类 TUN 代理把域名解析成 fake-IP（198.18.0.0/15）时，请求会在发出前被拒。现在 `local_proxy` 放行 loopback、CGNAT/overlay（100.64.0.0/10）、RFC 2544 benchmark 段（198.18.0.0/15）与 IPv6 ULA；link-local、云元数据、文档、多播与保留段**在任何模式下都不放行**。`compatible_public` 下拒绝 fake-IP 解析是安全正确行为，因此这一放行必须由操作者显式选择信任模式，不做静默放宽。
- **图片下载补齐端点信任模式**：`downloadHttpResource`／`downloadHttpResourceToFile` 既不把策略传给 DNS 校验、也用 `assertPublicAddress` 硬校验远端地址，于是私有地址模式下的 API 调用能通、图片下载却必失败。现在下载路径与 API 路径消费同一份策略。
- **`retry` 支持覆盖请求超时**：新增 `retry --timeout-ms <1000..600000>`（API `POST /api/runs/<id>/retry` 的 `timeoutMs`）。它只改写该项的请求 payload，不改写已确认的计划快照，并把覆盖值记入 `run.queued`／`run.items_retried` 事件。此前超时（最常见的 Provider 失败）无法通过重试修复，只能新建轮次并重新确认计划。
- **质量指标口径修正**：终局成功率原先把「主动取消」计入分母，取消一批会表现为质量下降。现在成功率基于 `settled`（终局减去已取消），并把 `settled` 与已取消数量一并返回，Workbench 相应显示「N 成功 / M 个已判定（另有 K 个已取消）」。

## daoge-pic 5.13.0 - 2026-09-12

当前稳定发布包/runtime 版本为 `5.13.0`；`5.12.0` 及更早版本保持为不可变历史发布，旧 daemon 不得与本版本混用。

- 收敛 `SKILL.md` 为薄 Agent 执行协议，同时保留 Provider secret backend、端点信任、运行时兼容范围和高风险 CLI 签名等执行关键规则。
- 对齐 README 中 Provider.db 与 system secret backend 的表述，明确 `Provider.db` 保存 Profile、密钥引用和 write-only 摘要，system backend 不可用时 fail-closed。
- 修正验证记录中 5.11.0 与 5.12.0 章节顺序；保留历史发布证据和 checksum sidecar。
- 收紧 API 运行控制边界：`pause`、`resume`、`cancel`、`retry` 和 `resolve-unknown` 统一要求 Bearer Skill/CLI；Workbench 只提示回到会话处理。
- 将当前计划写入 API 从旧 `/api/rounds/<id>/prepare` 迁移到 `/api/rounds/<id>/plan`，旧 `/prepare` 路径不再执行。
- 移除 daemon shutdown 的旧协议降级路径；受控关闭必须携带当前 Skill protocol 与有效 capability，并将模块从 `legacy-daemon` 重命名为 `daemon-shutdown`。
- 收紧 package smoke allowlist，防止任意 `dist/` 路径、旧 `legacy-daemon` 构建残留或 source/test 文件进入发布包。
- 从当前分支移除已由 GitHub Release 承载的旧 `5.10.1`、`5.10.2`、`5.10.3` `.tgz` 二进制本体；历史 release notes 与 `.sha256` sidecar 继续保留。
- 修复创作谱系编辑模式小地图：小地图改用完整节点坐标系，点击/拖动不再冒泡成画布框选，视口矩形与实际画布变换保持一致，避免定位后节点回显为空。
- 修复图片预览放大按钮被错误限制在 1x 的回归，恢复 0.75x-2x 范围。
- 修复项目归档与资产回收站确认后的动作分派：统一复用确认 handler，显示忙碌/错误状态，确认后直接执行，不重复弹窗。
- 恢复任务和轮次创建的通用推荐默认值；模板未覆盖的目标回退到探索、变体、精修、编辑和补图的默认数量与画幅。
- 发布门禁现在验证当前版本正式 tarball 的包版本、required runtime 入口和退役文件；历史版本制品不再被当作当前源码制品校验。
- 当前验证、发布说明和安装 URL 统一指向 v5.13.0；5.12.0 发布记录与制品保持历史不可变。
- 验证结果：全量 npm test 为 363 项，361 通过、0 失败、2 项跳过；npm run test:package 为 130 个文件且所有包门禁计数为 0。
- v5.13.0 制品为 480,424 bytes，npm shasum 为 ad67294b26fa50704aa0459e7d9f0eecad8ed242，SHA-256 为 d2774a8d905a510b743b61f89292bc366a7b764af258dfae6fba0bd576ec552e。
## daoge-pic 5.12.0 - 2026-09-11

该次稳定发布包/runtime 版本为 `5.12.0`；`5.12.0` 及更早版本保持为不可变历史发布，旧 daemon 不得与后续版本混用。

### Workbench

- Studio 从“Agent 驱动工具”升级为“Agent + 创作者工作台协作系统”：新增项目、任务和轮次的直接创建入口，使用模板、选项和提示减少创作者输入，同时继续走同一 Studio API/SQLite 事实源。
- 新建任务支持目标类型、任务类型、目标数量、画幅、风格包、品牌包和首个轮次联动创建；新建轮次支持探索、精修、变体、局部修改和补图/扩图，并绑定当前 Workbench 标签页会话上下文。
- 强化双入口、单工作流边界：Studio 直接创建只建立结构化上下文或草稿，不触发 Provider、预检、确认挑战或 Generation Run；生成仍由 Agent 输出计划并确认。
- 当前计划页新增参考素材面板和选择器：创作者可从当前项目或共享素材中选择主体、风格、构图、色彩、品牌、遮罩或反例参考，保存为草稿轮次上下文；已进入确认/运行的轮次仍必须回到 Agent 修改计划。
- 项目资产和大图预览新增“继续创作”动作：创作者可基于单图或已选多图创建变体、精修、局部修改、补图/扩图草稿轮次，并在多图用途编排板中套用“主图 + 风格 + 构图”“多主体融合”“主体 + 反例对照”“局部编辑三件套”“补图构图板”等模板，逐张标注主体、风格、构图、色彩、品牌、遮罩或反例，自动写入主参考图、父资产、参考用途、变化维度、保持约束、目标数量和画幅，并设为当前会话上下文。
- 局部修改新增轻量遮罩准备区：创作者可把现有图片设为遮罩，或导入、拖入、粘贴黑白 / 透明遮罩图；Studio 把遮罩作为项目资产和 `maskAssetId` 写入草稿，主体父资产不包含遮罩。此版本刻意不提供浏览器画笔或像素编辑器；生成前仍由预检验证遮罩素材和 Provider mask 能力。
- 新增统一创作动作入口：当前选片、资产卡片、大图预览和谱系检查器提供“生成更多类似图”“让这张图更精致”“换背景 / 局部修改”“扩图 / 改画幅”等创作者选项，并共享同一动作模型；结构化“不采用”反馈可只保存、加入当前草稿轮次作为反例，或一键创建带 `feedbackToNextRound`、反例参考、修正目标和保持约束的下一轮草稿。
- 创作谱系升级为项目工作区首页：项目/任务选择默认进入谱系，Workbench 顶部只保留当前会话上下文、导航和健康状态；取消“推荐下一步”区域，不再用额外动作卡片占首屏空间。谱系页保留五种工作模式但折叠为轻量选择器，成果/未定/不采用/运行改成精简指标条。
- 谱系节点检查器改为人本意图入口：空选只说明选择语义，资产节点第一层只保留“选为成果 / 用这张继续 / 作为参考 / 获取图片”，来源、共享、批注和不采用原因进入更多信息；不再暴露“保留 / 待复核 / 可衍生”三类并列标记按钮；检查器菜单改为内联展开，“作为参考”直接显示主体/风格/构图/反例用途，“获取图片”直接显示放大/复制/下载，“用这张继续”使用检查器内全宽动作卡片，避免浮层错位或被裁切。
- 新建项目/任务/轮次表单继续收敛为创作者选项化流程：项目模板返回默认名称、说明提示、示例说明、优先准备的素材和创建后必要上下文；任务目标和轮次目的带出推荐数量、画幅、必补信息、变化维度、精修目标、保持约束和可点击示例；创建后直接进入当前项目、任务或轮次上下文，不再弹出创建完成提示或“推荐下一步”，Provider 调用仍需 Agent 计划、用户确认和预检。
- 项目模板与新建任务表单建立深度联动：品牌视觉、电商商品图、社媒内容图、角色/IP 和自定义项目分别返回排序后的任务目标、默认任务名、目标数量、画幅、首轮目的、素材需求、必补信息、可点击示例、变化维度、精修目标和保持约束；任务创建 intent 与首轮草稿 plan 会记录项目模板、目标和素材需求，供 Agent 后续整理可确认计划。
- 资产页新增素材需求导入引导：根据当前项目、任务或草稿轮次的素材需求显示准备清单，可在导入前选择“商品主体图”“品牌包 / Logo”“平台规格”等需求，导入资产会保存脱敏 `materialNeed` / `materialUsage` 来源摘要；导入到草稿轮次时会按默认用途自动加入 `referenceMaterials`，不触发确认、预检、Generation Run 或 Provider 调用。
- Generation History 的“本次提示词”仍按安全摘要显示截断文本，但“复制完整提示词”会按运行的计划版本回读完整计划；若计划含逐图提示词，会复制每张图实际发送给 Provider 的“通用提示词 + 逐图差异提示词”。实际生图继续使用 `run_items.prompt_payload_json` 中的完整逐项提示词，不使用 Workbench 摘要。
- 生成详情的技术详情改成结构化证据面板：预检不再把 JSON 连成一行展示，改为计划版本、运行项、Provider、模型、参考素材、逐图提示词、输出规格和能力快照分区；原始摘要保留在折叠项里供排障查看。
- 当前计划页新增确认前结构化审阅：在现有计划摘要下展示关键指标、20 张逐图提示词清单、每张图最终会发送给 Provider 的完整提示词、结构化原始计划字段和折叠原始 JSON；确认前即可检查差异提示词、参考素材和输出规格。
- 当前计划的“原始计划结构”继续收敛：保留短字段网格、参考素材表和折叠原始 JSON，移除重复的“提示词独占展示”；逐图提示词只在确认前审阅区展示，避免同一信息渲染两遍。
- 当前计划页头部按钮布局调整为桌面端单行操作组：刷新、复制通用提示词、复制全部最终提示词、复制结构化 JSON 固定同一行，复制成功提示单独占下一行；窄屏再切成两列，避免横向溢出。

### Provider / 输出规格

- xAI/Grok 输出规格改为独立映射：支持官方 `aspect_ratio` 枚举、`1K`/`2K` resolution、`low`/`medium`/`auto` quality，并在 OpenAI 兼容传输中不再伪造 `size`。
- OpenAI GPT Image 模型提示词预检对齐官方 32000 字符上限：按每张图最终请求提示词计算，超出时在预检阶段拒绝，避免已确认后才被 Provider 退回。
- xAI/Grok 图片编辑改为 JSON 多图参考输入，最多 5 张 PNG/JPEG/WebP 受管理参考图；遮罩仍拒绝，预检和 Worker 按 Provider 能力与媒体类型重复校验。
- Provider Descriptor 从后续目标落地为单一事实源：Profile store、API、Workbench、预检、输出规格和 HTTP adapter 共享能力、端点策略、参考素材和版本字段，运行快照记录 descriptor/adapter 版本。
- Provider.db 升级到 schema v3：新增密钥后端引用、端点信任模式、Profile 级数量/并发/超时/重试限额、绑定 configVersion 的连接测试证据、外部 secret 清理队列和 active Profile 生命周期保护；active 配置修改或切换由 daemon 在旧配置任务排空后热加载，已完成预检需重新预检。
- Provider 设置页补齐 Descriptor 可见性、端点信任模式、Profile 级安全限额、显式模型列表读取与模型选择、连接测试说明、运行影响提示和 active 删除确认；API Key / Base URL 继续保持 write-only。
- Provider adapter 新增显式模型发现 API：OpenAI-compatible 与 Gemini 使用各自模型端点，返回受限安全模型摘要；不会自动联网或触发生成。
- Provider 设置页重排为左侧 Profile 轨道、右侧安全摘要 / 连接摘要 / 能力 / 限额 / 集中操作分区；按钮分组、移动端横向 Profile 列表和表单分段间距统一到 44px 可点击目标。
- `compatible_public` 端点拒绝明文 HTTP；macOS Keychain secret 通过 stdin 写入，system secret backend 不可用时 fail closed；Provider mutation/test 路由显式限制 HTTP method。

### 验证

- `npm test` 通过，包含 vNext TypeScript、Vite Workbench 构建和全量 vNext 测试：358 项测试，356 通过、0 失败、2 项按条件跳过。
- `npm run build` 通过，包含 vNext TypeScript 与 Vite Workbench 构建。
- `node --test tests/vnext/output-spec.test.js tests/vnext/plan-presentation.test.js tests/vnext/provider-adapters.test.js tests/vnext/runner.test.js tests/vnext/worker.test.js tests/vnext/studio-foundation.test.js tests/vnext/workbench-context-api.test.js tests/vnext/workbench-bulk-ui.test.js tests/vnext/creative-library-api.test.js` 通过：125 项测试，124 通过、0 失败、1 项 Windows 实机用例按平台跳过。
- `node --test tests/vnext/project-reference-boundary.test.js` 通过：1 项通过、0 失败。
- `node --test tests/vnext/workbench-route.test.js tests/vnext/lineage-data-loader.test.js tests/vnext/workbench-bulk-ui.test.js` 通过：21 项通过、0 失败。
- `node --test tests/vnext/workbench-bulk-ui.test.js tests/vnext/workbench-context-api.test.js` 通过：18 项通过、0 失败。
- `npm run build:workbench` 通过；随后 `node --test --test-concurrency=1 tests/vnext/workbench-bulk-ui.test.js tests/vnext/phase4-navigation-registry.test.js tests/vnext/workbench-route.test.js tests/vnext/local-auth-workbench.test.js` 通过：28 项通过、0 失败。
- Chromium smoke：在临时 Studio 中验证项目资产页连续两次导入图片，导入按钮始终保留且资产卡片增至 2 张；在谱系顶部直接切换任务与轮次后，当前会话摘要同步到所选轮次。
- Chromium smoke：在谱系“任务创作流”中点选待确认计划节点，检查器显示“审阅并确认计划”；确认挑战创建后，Workbench 打开 `role="dialog"` / `aria-modal="true"` 的确认弹窗，点击“确认计划”后提示当前用户已确认，未触发 Provider。
- Chromium smoke：构造 20 张含逐图差异提示词的运行，Generation History 详情只显示通用提示词摘要且不含第 20 张尾标记；点击“复制完整提示词”后剪贴板包含 20 段逐图完整提示词，包含通用提示词、Provider 实际前缀、首张和第 20 张差异尾标记。运行项 `prompt_payload_json` 中首尾项目也保留各自完整差异提示词，证明 Provider 请求使用全量逐图提示词。
- Chromium smoke：打开含 20 张逐图提示词运行的生成详情，展开技术详情后验证预检证据以卡片和字段网格展示，包含运行项、Provider、模型、输出规格和能力快照；旧的一行 JSON 预检文本不再出现。
- Chromium smoke：打开含 20 张逐图差异提示词的当前计划页，验证指标显示 `20 / 20` 条逐图提示词、最长单图提示词 `402 / 32000` 字符、20 个可展开提示词卡片；展开第 20 张可见通用提示词 + `Specific scene direction for this image:` + 第 20 张差异尾标记；“复制全部最终提示词”复制 20 段完整最终提示词，“原始计划结构”按基础、提示词和输出规格分组展示。
- Chromium smoke：当前计划页头部 `.prompt-stage-actions` 在 1440px 视口下渲染为 4 列网格，刷新、复制通用提示词、复制全部最终提示词、复制结构化 JSON 四个按钮 top 坐标一致，确认桌面端在同一行。
- Chromium smoke：展开当前计划“原始计划结构”，验证短字段区只包含“基础 / 输出规格”等概览卡片，不再混入“提示词”组，也不再显示“提示词独占展示”；20 条逐图提示词仍保留在确认前审阅区。
- Chromium smoke：在临时 Studio 中打开项目列表，选择“电商商品图”模板，验证默认项目名、说明提示、项目说明示例和素材准备上下文；创建项目后直接进入当前项目工作区，不显示创建完成提示或推荐下一步卡片。随后创建“基于已有图做变化”任务，验证默认 4 张、构图/背景变化、主体/Logo 保持、风格包/品牌包选择和首个变体轮次；再创建“补图 / 扩图”轮次，验证默认 2 张、16:9 和补图提示。最终新轮次 Generation Run 数量为 0，未触发 Provider。
- Chromium smoke：在临时 Studio 中验证项目模板与任务表单深度联动：创建“电商商品图”项目后，新建任务默认优先为“商品主图探索”，自动填入 8 张、1:1、商品主体图 / 品牌包 / Logo / 平台规格 / 核心卖点素材需求，并把目标、数量、画幅和素材需求持久化到任务 intent 与首轮草稿 plan，Generation Run 数量为 0；再创建“角色 / IP 设计”项目，新建任务默认切换为“角色形象探索”，显示角色设定描述、主体参考图、不可改变特征和动作/表情变体，未沿用电商任务目标。
- Chromium smoke：在临时 Studio 中打开创作谱系项目工作区，验证五种工作模式、当前会话上下文、Provider 不触发边界提示、项目/任务/轮次/计划/资产节点加载；切换到“任务创作流”后点选资产，检查器第一层只显示成果、继续、参考和获取图片四类入口，并验证任务级路由里点击“主体参考”不会再出现草稿轮次死胡同错误。
- Chromium smoke：在临时 Studio 中打开 Workbench，使用“新建项目”选择“电商商品图”模板创建项目；再用“新建任务”选择“基于已有图做变化”，绑定官方任务类型、风格包、品牌包、变化维度和保持约束，并联动创建首个变体轮次。Workbench 跳到当前计划页，当前会话摘要显示项目/任务/轮次，轮次状态为草稿，持久化任务 intent 与轮次 plan，新轮次 Generation Run 数量为 0，Provider 未配置且未触发生成调用。
- Chromium smoke：在临时 Studio 的当前轮次资产页选择 3 张图片，打开“基于已选继续”，验证多图用途编排板显示“主图 + 风格 + 构图”“多主体 / 多元素融合”“主体 + 反例对照”等模板；创建变体草稿后，Workbench 跳到当前计划页，显示“当前轮次还是草稿”“3 张已绑定”“3 张已挂载”。计划版本持久化 `referenceArrangement.mode=lead-style-composition`、主参考图、`subject/style/composition` 用途统计和 3 个父资产，新轮次 Generation Run 数量为 0，Provider 未配置且未触发生成调用。
- Chromium smoke：在临时 Studio 中从单图选择“局部修改”，打开轻量遮罩准备区并用浏览器文件上传导入一张不同内容的遮罩图。弹窗显示 2 张来源图和 1 张遮罩图；创建草稿后，当前计划显示 2 张已绑定 / 挂载，持久化 `subject` 与 `mask` 用途、独立 `maskAssetId`、仅含主体的 `parentAssetIds` 与 `referenceAssetIds`。新轮次没有 Generation Run，Provider 未配置且未触发生成调用。
- Chromium smoke：在临时 Studio 的当前轮次资产页打开资产卡片“创作动作”，验证“生成更多类似图”“让这张图更精致”“换背景 / 局部修改”“扩图 / 改画幅”“作为主体/风格/构图/反例参考”和“从不采用原因创建下一轮”选项；提交“不采用”反馈后 Workbench 跳转到新优化轮次的谱系页，通知显示下一轮草稿已创建，新轮次 Generation Run 数量为 0，Provider 未配置且未触发生成调用。

- 发布制品：`daoge-pic-5.12.0.tgz`，482,468 bytes；npm shasum 为 `b2a75a2c7632418feadac8b9217887374dbbade7`，SHA-256 为 `1daf37155d643379accad5318b8e836cf928fcf49b75c54e22b33b110d5fc494`。
- 发布说明：[docs/daoge_pic_5.12.0_release_notes_zh.md](docs/daoge_pic_5.12.0_release_notes_zh.md)；校验 sidecar：`skills/daoge-pic/daoge-pic-5.12.0.tgz.sha256`。
- GitHub Release 标签：`daoge-pic-v5.12.0`；本包通过 GitHub Release 资产分发，不发布到 npm registry。

## daoge-pic 5.11.0 - 2026-09-09

5.11.0 集中增强 Workbench 创作谱系、Generation History 大批量分页、项目资产打包、协议协商和本地敏感文件防护。


- 重构 Generation History 为全宽双栏工作区：运行记录保持显式选择，详情区集中呈现提示词、计划规格、运行状态、恢复操作和生成项；中小屏改为横向历史条与单栏详情，减少无效留白与拥挤的三栏分割。
- 运行项改为服务端分页：每页 25/50/100、状态筛选、序号定位、精确状态计数、输出缩略图和 URL 持久化；大型批次只读取当前页，避免重复从创作记录加载全部运行项。
- 结果队列新增可重试项本页选择、批量重试、单项详情对话框和安全恢复建议；对话框保留 `role="dialog"`、焦点约束、Escape 关闭和关闭后焦点返回。
- 新增创作谱系画布，覆盖项目、任务、轮次、计划、运行、运行项、资产、交付、任务类型、风格包和品牌包节点；布局只保存位置、视口、筛选、分组和人工软连线，不替代 SQLite 业务事实源。

### Runtime 与安全

- Bearer Skill/CLI 请求必须声明 `x-daoge-skill-protocol: daoge-pic-skill-protocol/2.0.0`；`/api/studio` 返回协议与运行时版本，CLI 只复用兼容 daemon。
- 项目资产 ZIP 改为按请求 `assetId` 做 scoped 查询和保序校验，不再受当前分页窗口限制。
- 创作谱系与导出摘要统一过滤 Provider、完整 URL、路径、token、content hash、storage path 和 capability 等敏感字段；仓库忽略嵌套 `daoge-studio` runtime、Provider.db 与 provider.env。

### 验证

- macOS `npm test`：332 项，330 通过、0 失败、2 项 Windows 实机用例跳过。
- 本地 `npm run test:package`：发布清单 124 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，真实 bin、注册、doctor 与 `sharp` 全部通过。
- 最终制品 `daoge-pic-5.11.0.tgz` 为 `403432` bytes，SHA-256 为 `1deb7a92af0bbc0e3cbcd984d4f184043fc1bd08aa2c816713f917ff7c4a82ac`；Skill 协议保持 `2.0.0`，运行时兼容下限为 `>=5.11.0 <6.0.0`。
- 所有验证未调用真实图片 Provider，未产生计费生成请求。

## daoge-pic 5.10.4 - 2026-09-07

5.10.4 集中完成 Windows 安装、工作区、进程、权限、冷启动和 Workbench 恢复优化，并以 Windows Server 2022/2025 × Node.js 22.17.0/24 四组实机矩阵验证。

### Windows 初始化与安全

- Node.js 下限固定为 `22.17.0`；Node `22.13.x` 内置 SQLite 未启用 FTS5，Node `22.16.0` 携带的 libuv 1.49.2 又会在 Windows Server 2025 返回不一致的路径/句柄文件身份；`22.17.0` 的 libuv 1.51.0 修复 Windows stat 结构字段顺序与卷序列号一致性。daemon 身份查询从 WMIC 改为系统 Windows PowerShell 中有界的 .NET WMI 查询，不依赖 PowerShell 模块，并同时设置 WMI 与 Node 外层超时。
- 新工作区在任何 Studio 文件创建前拒绝 UNC、同步盘/系统目录、非本地固定磁盘、非 NTFS 与已有 junction/symlink；`open --allow-nested-studio true` 不能越过这些存储约束。
- 敏感目录、manifest、SQLite 与现有 sidecar 由 daemon owner 在一个 PowerShell 进程中批量设置并复核 DACL；只允许当前用户 SID、SYSTEM 与 Administrators。ACL 超时、PowerShell 缺失和权限拒绝均失败关闭。
- Windows 外部 `SIGTERM` 会直接终止 Node 进程，不能承诺执行异步清理；当前 runtime 的安全关闭改走仅 Bearer Skill/CLI 可调用的本地 HTTP 控制端点，并在关闭前继续核对 owner PID、Studio、进程入口与工作区。测试套件限制跨文件并发为 1，避免冷启动 PowerShell 与 daemon 恢复在 runner 高负载下互相挤占。
- 交付路径保留安全 Unicode、限制组件长度、规避 Windows 设备保留名，并给项目与交付目录追加短 ID。
- `rundll32.exe` 无法启动或立即非零退出时回退到无 shell 的 `explorer.exe`；最终失败提示运行 doctor，不泄露 bootstrap URL 或 capability。

### 冷启动与 Worker 恢复

- 新增只附加模式。Generation/media Worker 不再创建目录、写 `.gitignore`、执行 schema migration 或修改 ACL；daemon control-plane 复用一组 Studio/Provider 数据库连接。
- 空 Studio 不启动 media Worker；真实媒体恢复/作业才按需创建。Generation pool 首次 tick 只启动一个 Worker，持续满载时逐个扩容。
- 两类池公开脱敏 `idle/starting/ready/degraded/failed/stopping` 健康状态、有界重启次数和安全错误摘要；达到上限后熔断，队列不会永久等待。

### 安装、诊断与 Workbench

- 新增 `register-skill --scope project|user`，跨平台创建 fail-if-exists link/junction，并拒绝父级 symlink/junction 路径穿越；README 与发布模板不再要求长 Node 注册脚本。
- 新增不调用 Provider 的 `doctor --workspace <path> [--json true] [--redacted true]`，检查目录、原子 rename、SQLite 排他锁、权限、`sharp`，并在 Windows 通过 .NET DriveInfo/Registry 检查磁盘、文件系统和浏览器关联。
- package smoke 改在独立临时 pack 目录运行，不删除仓库同名正式制品；临时 consumer 路径包含中文和空格，并执行真实 bin、注册、doctor 与 `sharp`。
- Workbench 新增运行健康横幅、安全重启、状态刷新和脱敏诊断复制；受控重启依次显示安全关闭、重连、权威快照恢复和已恢复。


- macOS `npm test`：315 项，313 通过、0 失败、2 项 Windows 实机用例跳过。`npm run test:package`：122 个发布文件，全部清单、安装、bin、注册、doctor 与 `sharp` 检查通过。
- 浏览器实测 1440×1000 与 375×812，无横向溢出，移动端健康操作为 44px；实际 daemon 故障注入完整观察到故障、安全关闭和恢复状态。
- `npm run bench:perf`：空 Studio control-plane `41.90 ms`、需求前 media process `0`；100000 pending 队列领取 1000 项 `132.48 ms`，RSS `107.7 MiB`。
- [Windows Actions 运行 34082076215](https://github.com/ccnuzw/daoge-skills/actions/runs/34082076215) 在 `windows-2022`、`windows-2025` × Node.js `22.17.0`、`24` 四组全部通过；每组 315 项回归为 311 通过、0 失败、4 项 Windows symlink 用例按平台条件跳过，122 文件安装包、真实 `.cmd`、junction、`sharp` 与 12 项脱敏 doctor 检查全部通过。
- 最终制品 `daoge-pic-5.10.4.tgz` 为 `351910` bytes，SHA-256 为 `6217bdeec6821156639ad4670445120b349d2b025441bbbb8be4f72b1bcfa443`；Skill 协议保持 `2.0.0`，运行时兼容下限为 `>=5.10.4 <6.0.0`。
- 所有验证未调用真实图片 Provider，未产生计费生成请求。

## daoge-pic 5.10.3 - 2026-09-05

5.10.3 修复 Workbench 与智能体会话可对同一计划分别预检和入队而产生重复批次的问题，并把确认、预检与运行创建收敛为单一职责。

### 确认与防重

- Workbench 只提交人工确认；预检与运行创建只接受 Bearer Skill/CLI，旧页面的 Cookie 请求在调用 Provider 前返回 `403`。
- Skill 在确认后先检查当前轮次的 Generation History；已有运行时直接选择并汇报，不再次预检。
- 每个 Creative Round 只允许一个初始 Generation Run；不同预检、幂等键、客户端或并发入口的重复请求返回指向已有运行的 `409` 冲突。
- 失败项继续在原运行中受控重试；再次生成使用新的变体、优化或补图轮次。既有历史重复运行保持可读，不做破坏性清理。

### 协议与验证

- Skill 协议保持 `2.0.0`，运行时兼容下限提升为 `>=5.10.3 <6.0.0`；Studio Schema 与 Provider 配置不变。
- `npm test` 执行 295 项且全部通过；`npm run test:package` 构建与安装 smoke 通过，发布清单 116 个文件；离线生产依赖审计为 0 个漏洞。
- 最终制品 `daoge-pic-5.10.3.tgz` 为 `332272` bytes，SHA-256 为 `29b6887a5cb91f479537c51d60750c25ea0581b6661fda6e9c82d42ce7914413`。

## daoge-pic 5.10.2 - 2026-09-05

5.10.2 修复 v5.10.1 将 Provider 实际并发错误限制为 4 的回归，并将高并发运行改为自适应、可观测和流式持久化。

### 并发与稳定性

- Provider 安全目标并发上限提升为 `100`，初始目标 `16`；健康窗口逐步升速，429、临时/未知结果和 Worker 资源压力触发降速与冷却。
- Worker 池由父进程统一分发动态 Provider 配额，保留 Generation Run 的逻辑并发 `1..1000` 和 SQLite 全局租约边界。
- Worker 子进程回传 Provider 健康结果、RSS 和外部 Buffer 指标；Provider API 与 CLI runtime 快照提供脱敏并发状态。

### Provider 内存路径

- Provider JSON/Base64 响应和公开图片 URL 改为受控临时文件流式处理；不超过 `1 MiB` 的小结果才保留为 Buffer。
- 生成资产持久化复用流式 staging、哈希、大小和媒体类型校验，并在取消、租约丢失和重复资产路径清理 Provider 临时文件。
- 批量生成支持与 `itemCount` 对齐的逐图提示词 `itemPrompts`，单条最多 `8 KiB`，并在 dry-run/Run Item payload 中冻结。
- Workbench Generation History 增加 failed、blocked、retry_wait 运行项的单项重试入口，沿用未知结果不自动重放和幂等边界。

### 验证
- 最终制品 `daoge-pic-5.10.2.tgz` 为 `330962` bytes，SHA-256 为 `4b3b7b289371645cb652118c3319dda9ce7b5b0f4aeec01e4c494ecaded6f1ed`。
- `npm test` 执行 294 项且全部通过；`npm run test:package` 构建与安装 smoke 通过，发布清单 116 个文件。

## daoge-pic 5.10.1 - 2026-09-05

5.10.1 完成 vNext 控制面、SQLite、媒体恢复、Provider 内存边界和 Workbench 刷新链路的性能优化，并统一发布 Schema v22。

### 性能与资源边界

- 启动恢复避免重复执行资产媒体操作恢复；terminal run reconciliation 合并为聚合查询和单事务。
- session plan、dry-run、latest run 改为单行查找；过期 dry-run 批量清理；SQLite 增加运行、预检、运行项、事件和媒体恢复索引。
- claim 先计算全局可用槽位，再读取 pending 候选；异步媒体校验使用有界并发并保持事件顺序。
- Provider 错误响应限制为 64 KiB，已知长度响应使用预分配缓冲；单机 Provider 活跃请求上限为 4，避免大响应 Buffer/Base64 副本耗尽内存。
- daemon worker 子进程跳过已由 control-plane 完成的重复完整性校验；维护任务不再随每次短轮询执行。

### Workbench 与验证

- Workbench session plan 请求在依赖变化或卸载时取消，资产来源展示查询避免对全库轮次和运行做无界窗口扫描。
- 新增 `npm run bench:perf`，覆盖 1k、10k、100k pending 队列、事件保留和 RSS 基线。
- `npm test` 执行 288 项且全部通过；`npm run test:package` 发布清单校验通过。
- 最终制品 `daoge-pic-5.10.1.tgz` 为 `324057` bytes，SHA-256 为 `3c7c64aadcaf010744b1fa3556631d890c8a7b34fae31c0a4622c2881fb8933a`。

## daoge-pic 5.10.0 - 2026-09-04

5.10.0 完成机器确认闸门、独立协议版本、可恢复 CLI 幂等身份，以及生成与媒体双 worker pool 架构升级。

### 安全与协议

- 新增 `challenge -> consent -> confirm_token` 机器闸门，令牌绑定 `plan_hash + preflight_id + conversation_id`；人工确认只接受已授权 Workbench Cookie。
- 协议版本独立为 `daoge-pic-skill-protocol 2.0.0`，daemon 按 `>=2.0.0 <3.0.0` 判断读写 API 兼容性。
- confirmation consent 仅驻留 daemon 内存；重启后必须重新确认，confirm 请求的 session 必须与待处理 challenge 显式一致。

### Worker 与媒体

- Provider 请求与生成持久化进入自适应 generation worker pool；缩略图、ZIP、导入归档校验和启动媒体对账进入独立 media worker pool。
- 两类 worker pool 按本机并行度分配子进程；control-plane 保持 API、SSE、队列与恢复职责，Studio SQLite 使用 WAL。
- ZIP、缩略图和导入继续使用受验证 snapshot、哈希、大小、媒体类型与受管理路径边界。

### CLI 与 Workbench

- 新增 `--operation-name`，daemon 对 method、route、operation-name 与规范化 payload 派生稳定幂等键；JSON 键顺序不影响恢复身份。
- 大 JSON 支持单个 `@-` stdin 标记，最大 8 MiB；明确跨进程恢复必须使用 operation-name 或保存显式 idempotency-key。
- Workbench 增加只读会话计划摘要、无活动轮次空状态、独立人工确认闸门和最近运行 SSE 刷新。

### 验证

- `npm test` 执行 271 项且全部通过；`npm run test:package` 与 `npm audit --omit=dev --offline` 通过。
- 发布清单包含 113 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- 最终制品 `daoge-pic-5.10.0.tgz` 为 `305783` bytes，SHA-256 为 `8096b6bc9ed4b19e76b77398bebbd2f35e2596844dec22d56db9e752cfce025c`。

## daoge-pic 5.9.1 - 2026-09-03

5.9.1 修复参考素材跨项目越界问题，收紧参考图和遮罩的项目访问边界。

### 安全修复

- 新增统一项目素材访问判定：参考图和遮罩只能来自当前项目资产，或当前 Studio 明确共享的 `shared_across_projects` 素材。
- 计划创建、准备、确认、预检、dry-run、排队和 Worker 读取前均重复校验；同一 Studio 下其他项目的未共享素材不再可执行。
- 共享关系撤销后，预检和 Worker 均会阻止继续处理，且不会调用外部图片 Provider。
- 保留历史错误计划版本，不自动猜测替换素材；用户需重新提交计划或显式共享素材。

### 文档与验证

- 同步更新 Skill 规范、README、vNext 规格和学习中心中的项目/共享素材边界说明。
- 新增跨项目未共享素材、共享撤销、历史越界计划和 Worker 无 Provider 调用回归测试。
- `npm test` 执行 264 项且全部通过；`npm run test:package` 与 `npm audit --omit=dev` 通过。
- 最终制品 `daoge-pic-5.9.1.tgz` 为 `290741` bytes，SHA-256 为 `7046e652ff7f143f29df182b526b1a2948b24e8f6a5f19578d4917f6a0c442ec`。

## daoge-pic 5.9.0 - 2026-09-03

5.9.0 是 Workbench 性能与体验综合版本，包含本轮性能修复以及工作树中此前已完成、尚未发布的确认对话框、学习中心、Provider 连接测试和视觉可读性改进。

### 性能改进

- 增加基于内容哈希的 WebP 缩略图缓存；资产网格、共享素材、交付历史、运行结果和轮次对比不再默认加载原图。
- 原图与交付图片支持 ETag、条件请求、单 Range 和断点传输；大媒体校验、上传、生成落盘、交付导出和 ZIP 改为异步分块处理。
- Schema v20 增加资产、关系、运行领取、租约恢复和交付查询索引；资产评审、选片、交付项目和轮次对比消除主要 N+1 查询，并限制历史对比返回最近 24 次运行。
- SSE 使用进程内唤醒、100 条有界批次和 2000 条事件窗口；运行项状态合并为运行级通知，减少高并发事件风暴。
- 参考素材限制为最多 8 张、合计最多 64 MiB；同一 Worker 的并发运行项共享引用素材缓存，缓存总量固定为 256 MiB。
- Workbench 资产刷新、选片刷新和上下文刷新解耦；全选本页与清空选片使用事务化批量 API，多图导入使用 4 路有界并发。

### 体验改进

- 删除、归档、Provider 删除和清除连接信息统一使用可访问确认对话框。
- 项目与任务搜索使用索引和延迟查询，交付历史使用 Map 查找，计划对比显式提示历史截断。
- 升级 `sharp` 与 `vite` 到无已知审计漏洞的版本；生产依赖 `npm audit --omit=dev` 为 0 vulnerabilities。

### 兼容性

- 现有工作区通过 Schema v20 自动迁移，保留项目、任务、轮次、运行和资产数据。
- 仍要求 Node.js 22 LTS 或更高版本；安装固定使用 GitHub Release `.tgz`，安装并注册 Skill 后需要完整重启 Codex。

### 验证

- 发布版全量构建与 Node 测试：`npm test` 执行 262 项，262 通过；生产构建通过。
- 性能场景：500 次运行对比为 6 次 SQL / 2.71 ms；1000 张选片为 4 次 SQL / 5.73 ms；10000 个待执行项领取写入 20 条事件；64 MiB 媒体最大事件循环延迟 0.92 ms。
- Chromium 桌面与移动 smoke：24 张资产使用缩略图、全选本页单次批量请求、无横向溢出、无控制台错误。
- 最终制品 `daoge-pic-5.9.0.tgz` 为 288686 bytes，SHA-256 为 `d055be3f8ca3e6ebf9561e1e27181c837b949a8ad542cb8734b962417fc61313`，并通过包外 `.tgz.sha256` sidecar 记录。
## daoge-pic 5.8.0 - 2026-09-02

5.8.0 固化“会话为入口、Studio 为共享工作台”的稳定协议：同一 workspace 的多个会话共享唯一 daemon 与 Workbench，同时用独立 Studio Session 隔离各自上下文、项目与 Run。

### 新增

- Provider 配置迁移到独立 `Provider.db`，支持多个 Profile、唯一 active、write-only API Key/完整 Base URL，以及 Workbench 中的列表、新建、编辑、复制、激活、删除、本地校验、显式连接测试、显式读取模型列表和模型选择。既有 `provider.env` 仅在首次升级时一次迁移或显式 import，之后不再作为运行时配置源；活动配置修改或切换由 daemon 在旧配置任务排空后热加载。
- 执行型触发采用稳定 workspace → 普通 open/open-reuse → conversation Studio Session → 项目/任务/轮次上下文 → 创作澄清的强制顺序；咨询/开发型请求不启动 Studio。presence/open-claim 只允许首个会话触发 opener，其余会话安全复用。
- 同一 workspace 支持 3–4 个并发会话共享单 daemon/Workbench；真实 conversation Session、项目与 Run 归属互相隔离，Workbench 改用 per-tab `sessionStorage` 身份。
- Generation Run 并发改为 preflight 冻结：范围 `1..1000`、默认 `4`、串行 `1`，queue 和 run 阶段不可改写；移除 `config --worker-concurrency` 与 workspace worker concurrency 双重配置源。

### 改进

- daemon 单实例互斥改为 SQLite `BEGIN EXCLUSIVE` 长事务；崩溃由 OS/SQLite 释放，遗留 owner record 不参与互斥，并发启动的 loser child 会被完整清理。
- Worker tick、Provider 请求、HTTP service 与连接采用有界关闭；无法确定外部副作用时收敛为 `outcome_unknown`，不自动重放。
- Provider 响应使用精确 secret 净化并限制 request-id；package sensitive 检查拒绝 Provider/studio 数据库、真实环境配置、runtime、日志、源码与其他敏感内容。
- 完善 binary import、fair scheduler、公平 Run 领取和 reference flag 传递，保持共享 daemon 下的项目与 Run 隔离。

### 修复

- 修复重复 import 创建重复记录或资产的问题。
- 修复多会话并发首次启动可能产生重复 daemon/opener，以及 opener claim 失败路径未完整释放的问题。
- 修复 loser child、忽略 abort 的 Provider 请求和 HTTP 连接在关闭阶段可能残留的问题。
- 修复 Provider 响应 secret 净化与 request-id 边界不精确的问题。

### 验证

- build PASS；完整自动化回归 `238/238`、targeted 集合 `60/60` 通过。
- package 验证包含 96 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- 安装包的 4 会话场景收敛为 1 次 open、3 次 reuse 和 4 个隔离 Studio Session；验证未调用真实图片 Provider，未产生计费请求。
- 发布渠道为 `daoge-pic-v5.8.0` GitHub Release 不可变 `.tgz`；最终资产哈希由重新 pack 后的 sidecar 与 GitHub Release 在包外记录，不写入包内文档。

## daoge-pic 5.7.0 - 2026-09-02

### 新增

- 项目资产页增加“全选本页 / 取消全选本页”，批量选择保持成果选择与 `keep` 评审语义一致。
- 项目资产改为服务端分页，默认每页 24 张，可切换 16/24/32/48/64/96；范围、类型筛选和总数使用同一查询边界。
- 项目资产支持文件选择器、拖放一次导入多张图片，显示批量进度并汇总部分失败。
- 交付图片增加明确可见的全选/取消全选操作。
- 项目首页、项目概览任务摘要和任务功能页增加搜索、生命周期筛选与有界分页，避免大列表无限延伸。
- 图片放大预览增加直接选为成果/取消成果操作；当前选片缩略卡片重排内容和移除按钮，避免遮挡长标题。
- 项目资产与已导出交付 ZIP 使用“项目名/交付名 + 类型 + 时间”区分文件名，并保留 ASCII 回退名。

### 改进

- Studio 工作区与单次运行并发上限提升为 `1000`；Schema v18 将既有工作区设置迁移到新上限，实际项目运行仍由会话显式指定并发。

## daoge-pic 5.6.0 - 2026-09-01

本版本在 5.5.0 动态输出控制基础上完成 Studio 安全、持久恢复、媒体一致性和 Workbench 交互体系升级。

### 新增

- Studio 本地访问加入高熵 capability 授权：Workbench 通过一次性 URL fragment 引导换取 `HttpOnly`、`SameSite=Strict` 本地会话 Cookie，随后立即清除 fragment；CLI 使用 Bearer capability，除健康检查外的 API 均要求授权。
- Provider 返回 URL 的图片下载加入 SSRF 防护：仅接受无内嵌凭据的 HTTP/HTTPS 公网目标，逐跳重新校验 DNS 与重定向、固定已验证地址并限制响应体；携带 Provider 凭据的 API 请求拒绝重定向。
- 媒体导入、生成、回收与恢复加入可恢复 journal 和受验证 snapshot；项目与交付 ZIP 以受管理文件快照流式输出，并约束 Studio/项目归属、路径、符号链接、文件身份、条目数与总大小。
- Workbench 增加明确的 Generation History（生成历史）选择、SSE cursor/快照恢复、可恢复的三阶段交付完成流程、交付历史与冻结文件领取，并完善键盘搜索、焦点圈、模态对话框焦点约束/返回和实时状态可访问性。

### 改进

- Studio 隔离扩展到 manifest 工作区身份、本地 daemon、数据库实体、深链、媒体文件、ZIP 与交付冻结副本；跨 Studio 或跨项目的对象与文件访问会被拒绝。
- 运行由 daemon 内的持久 Worker 和 SQLite 队列驱动；启动恢复保留已确定结果，将不安全的在途外部调用转为待会话确认状态，并保持 `outcome_unknown` 不自动重放。
- 所有 Studio mutation 使用幂等收据；CLI 支持显式 `--idempotency-key`，恢复同一操作时可复用相同键和相同请求，避免重复创建或重复外部副作用。
- 交付继续以 `draft -> ready -> exported` 作为权威状态机；Workbench 的“完成交付”在失败后从已提交阶段继续，已导出的冻结图片不受源资产后来回收影响。
- CLI 在启动 daemon 或初始化工作区前完成未知命令与必需参数校验；首次初始化会先验证 Provider 模板与工作区身份，失败不留下部分 Studio。
- 包契约改为解析 npm JSON 后执行真实 pack、临时安装、`daoge` bin/help 与已安装运行时资产路径检查，并清理临时 tarball 与安装目录；最终机器数字留待候选验证阶段记录。

### 修复

- 媒体根目录从工作区起逐级拒绝符号链接，启动对账不会遍历或移动工作区外文件；生成恢复同时验证 run、run item 与 Studio 归属。
- 单次运行并发正确支持 `1..30`；交付导出 journal 使用 Studio 复合幂等键，不同交付复用同一 key 会被拒绝而不是覆盖恢复记录。
- 旧幂等回执和用户任务类型只在归属唯一时迁移，歧义数据进入隔离表；用户任务类型按 Studio 隔离。
- Workbench 授权失败保留 capability 并提供重试页；交付批次和计划对比不再跨项目或轮次残留；图片查看器使用 portal、backdrop 与 `inert` 实现真实模态交互。

### 验证

- Node/Vite 全量回归、真实 package smoke 与 Chromium 桌面/移动验证全部通过；精确制品证据见 `skills/daoge-pic/docs/vnext_verification_evidence_zh.md`。

## daoge-pic 5.5.0 - 2026-09-01

### 新增

- 画幅、尺寸、分辨率和本次生成并发可在会话中动态确认；`1K`、`2K` 等分辨率按画幅归一化为明确尺寸。
- 新 Studio 工作区 Worker 并发默认上限为 `30`，单次运行可请求 `1..30` 路并发并冻结到运行记录。

### 改进

- 输出规格不再依赖 Provider 名称比例白名单，不支持的传输规格明确拒绝且不回退方图。
- Provider 生成请求禁止自动跟随重定向；运行时设置迁移到 SQLite Schema v14。

### 验证

- 发布前 vNext 自动化回归 `88/88` 通过，package smoke 通过；正式制品随 `daoge-pic-v5.5.0` GitHub Release 发布。

## daoge-pic 5.4.0 - 2026-08-31

### 新增

- 创作者交付改为“挑选图片、完成交付、下载或复制图片”主线；项目当前选片、待交付图片和已导出冻结副本均支持 ZIP 打包，已导出交付可逐张选择后下载子集。
- 新增独立“共享素材”Studio 模块。项目图片默认只属于项目资产，只有明确执行跨项目共享后才可出现在该模块，且不会自动加入项目、任务、轮次或计划。
- 创作资料库新增任务类型、风格包、品牌包的统一检索与结构化详情；全功能学习中心、分层 Workbench 导航、提示词工作台及安全的资产来源检查器同时纳入 vNext 工作流。

### 改进

- 交付文件端点、ZIP 端点和共享写入统一约束当前 Studio；项目、任务和轮次资产保持范围隔离，项目资产深链不能退化为全 Studio 浏览。
- 选片动作会先保留评审结论；当前选片卡片收紧移除控件并明确预览指针。轮次父子关系、目标范围资产去重、冻结交付后源图回收和无效 ZIP 选择参数均得到加固。
- Provider 执行仍要求会话明确确认；真实参考图变体验证完成 2 项 `1:1` 运行并归档两张受管理 PNG。

### 验证

- vNext 自动化回归 `83/83` 通过，包含项目/交付 ZIP 内容、ZIP 与共享素材跨 Studio 拒绝、路由范围隔离、实际受管理图片下载与 Provider 安全门槛。

## daoge-pic 5.3.1 - 2026-08-31

### 修复

- Workbench 刷新改为单飞尾随队列：移除 `projects` 状态触发的刷新依赖循环；SSE 事件在短窗口内合并，路由切换会中止旧上下文请求，搜索、轮次记录和总览比较均支持取消与过期结果保护。
- SSE 快照恢复现携带一致 cursor，并在发送一次 `snapshot-required` 控制帧后关闭旧流；服务端处理背压、断连和关闭期清理，避免失效 cursor 每 400ms 触发全量刷新。
- daemon 默认复用工作区保存的端口，优雅重启后 Workbench URL 保持不变；端口绑定失败不再遗留半初始化服务或掩盖原始错误，关闭时等待在途 worker tick。
- schema v12 增加素材关联、最新评审和交付批次反向引用索引；安全搜索改为单个 FTS 候选 CTE 联表投影，交付与批次完整快照仅在交付视图读取。

### 验证

- 新增事件突发单飞刷新、卸载清理、快照 cursor/流关闭、固定端口失败清理与无 Provider 稳定端口重启回归；全部 vNext 回归通过。

## daoge-pic 5.3.0 - 2026-08-28

### 新增

- Workbench 增加可深链接的 Studio 总览：可显式选择同一任务的多个轮次，并列比较计划摘要、上游谱系、运行项、结果资产与当前项目评审。
- Studio 搜索增加项目、任务和轮次的安全显示投影；命中只跳转到规范化深链接，不回传 FTS 原文、任务意图或轮次计划。
- 新增版本化交付批次：批次仅接纳已准备或已导出的 P1 交付，创建与每次修订都冻结成员快照；CLI 增加 `delivery-batch`、`delivery-batch-revise` 和 `delivery-batch-ready`。

### 改进

- schema v11 新增交付批次、版本和冻结交付成员表；版本从 `draft` 准备为 `ready` 后只读，任何成员调整都会建立新的修订版本。
- 资产来源检查器新增交付批次版本反向引用；比较 API 的计划与上游谱系只返回安全摘要，不返回原始提示词、素材引用、内部路径、哈希、Provider 字段或外部请求标识。
- 搜索限制查询长度和结果数，跨任务轮次比较被明确拒绝；P2 不新增 Provider 调用、排队、恢复或重试入口。

## daoge-pic 5.2.0 - 2026-08-28

### 新增

- 任务概览聚合轮次、运行和结果数量；轮次工作区展示计划版本、上游谱系与显式运行项到结果资产的关系。
- 资产检查器展示安全的生成来源链、追加式评审历史和交付引用，可从结果资产定位回明确的项目、任务、轮次和运行。
- 交付改为持久化的 `draft -> ready -> exported` 流程；新增 `delivery_assets` 快照表，准备交付时冻结资产来源和评审事实。
- CLI 新增 `delivery-update`、`delivery-ready` 与 `delivery-draft`，与 Workbench 共用同一状态机。

### 改进

- 交付草稿只接受属于当前项目、活跃且当前评审为 `keep` 的资产；界面和 API 都标明未满足准入的选片。
- 导出仅允许已准备交付，并把冻结的来源与评审快照写入交付清单；后续评审不会改写已准备的交付事实。
- 资产范围返回的当前评审按当前项目解释，避免其他项目的评审状态误导交付准入。
- 创作记录、资产来源和交付快照均脱敏 Provider 机密、端点、外部请求标识与文件路径。

## daoge-pic 5.1.0 - 2026-08-28

### 新增

- Workbench 将 `view`、项目、任务、轮次、运行和资产范围写入 URL，支持刷新、浏览器前进/后退和可恢复的明确工作上下文。
- Workbench 为浏览器工作上下文创建并同步 Studio Session；项目、任务和轮次选择在本地 SQLite 中持久化，运行保持为 URL 中显式选择的历史项。
- 生成区新增本轮完整运行历史选择器；不再静默展示活跃或最新运行。
- 资产视图新增“当前轮次 / 当前任务 / 当前项目 / 全部 Studio”范围选择；后端按资产关系、运行项、运行和创作层级安全推导范围并去重。

### 改进

- 左侧项目树、固定面包屑、范围空态和上下文错误提示明确当前查看对象；不存在或跨层错误的深链接不会跳转到其他实体。
- 统一使用“生成运行”和“取消运行”术语，清晰区分 Studio Session、创作轮次、运行与运行项。
- 导入资产依据当前范围绑定项目、任务或轮次，避免范围语义与资产归属脱节。

## daoge-pic 5.0.3 - 2026-08-28

### 修复

- Workbench 按项目、任务、轮次、生成运行和运行项分别解释状态，不再将所有 `active` 显示为含义模糊的“进行中”。
- 已确认的轮次显示“已确认 · 可继续”；任务显示已确认轮次数；项目开放状态与实际 Provider 执行状态明确分离。
- 只有运行项处于请求、接收或保存阶段才显示“正在生成”；排队、准备、暂停、等待会话确认和终态均显示各自明确状态。

## daoge-pic 5.0.2 - 2026-08-27

### 修复

- 高级详情按实际持久化的干跑记录读取 `planVersion`、`planSnapshot` 与脱敏 Provider 元数据，不再访问不存在的 `preflight` 字段而导致 Workbench 黑屏。
- 高级详情对缺失或历史不完整的记录使用安全降级，并添加应用级错误边界，避免单个详情异常使整页不可用。
- 高级详情不展示 Provider endpoint。

## daoge-pic 5.0.1 - 2026-08-27

### 修复

- Worker 将同批领取的运行项并发处理，并在同批单项异常后仍收敛已确定终态的运行，避免慢 Provider 响应令后续租约过期并遗留 `running`。
- daemon 启动和轮询会基于 SQLite 中所有已终态的运行项幂等补记 `completed`、`partial` 或 `failed`，不重放任何 Provider 请求。
- Studio 服务关闭时主动终止 SSE 长连接，避免 Workbench 保持连接导致 daemon 无法响应终止信号。
- Workbench 对已完成运行显示正确终态，并隐藏无效的“取消会话”操作。

## daoge-docs 3.25.0 - 2026-08-12

### 新增

- strict Profile 要求当前版本获得绑定权威摘要的开发者确认；确认过期、被拒绝或被替代时不能进入受控开发。
- 新增 ChangeSet、隔离规格草案和开发级交付回写：AI 可以起草，只有开发者批准且规格物化后才成为权威事实；功能、模块和版本完成状态必须绑定可复验的 Goal 完成记录。
- 工作台增加开发确认、规格修订、隔离草案和交付状态的只读投影，并保持其不是第二事实源。
- 所有变更命令使用项目级写锁串行执行；Markdown、JSON、Goal、草案和证据资产使用原子保存，避免并发写入或中断留下半截内容。

### 兼容性

- 项目输入与约束注册表升级为 `schema_version: 6`。旧登记内容会保留，并由升级流程补齐新增集合。
- 未完成 Goal 遇到工具版本变化会进入 `stale`，必须从当前权威文档重新准备；已完成 Goal 保留为历史审计材料。

## daoge-docs 3.18.0 - 2026-08-08

### 新增

- Goal 运行态明确区分 `not_started`、`dependency_blocked`、`executing`、`verification_failed`、`completed`、`stale` 和 `blocked`，工作台、`goal-plan`、恢复上下文与 CI 使用同一阶段/原因语义。
- 验证失败后允许在任务 `allowed_paths` 内恢复，并为每次验证尝试保留独立的 `verification_attempts[]` 机器证据；失败不会伪造检查点。
- GitHub Actions、PR 模板、VS Code Tasks 和 `AGENTS.md` 集成覆盖代码、文档和 stale Goal 基线检查，并保持不覆盖已有目标配置。

### 修复

- 修复工作台 Goal 顶层状态与嵌套执行快照不一致的问题。
- 统一工作台、Goal 契约和开发工作流文档中的当前工具版本为 `3.18.0`。

## daoge-docs 3.16.0 - 2026-08-08

### 新增

- Goal 清单同时绑定项目全貌摘要和所选功能依赖闭包的范围摘要；功能、共享契约、版本架构/测试、相关决策或 E2E 变化会使 Goal 进入 `stale`，不相关版本规划变化不再误伤当前 Goal。
- `prepare-goal --execution-mode parallel`：在独立非主分支和 linked worktree 中规划无依赖、无工程路径重叠的并行 lane；恢复上下文返回当前所有 runnable tasks，每个 lane 以独立 TASK ID 建立检查点。
- 文档同步闭环：区分实现/证据同步与需求语义变更；后者必须停止受影响 Goal、更新权威并重新过门禁。

### 兼容性

- Goal schema 保持版本 1；旧清单仍按原全局 `authority_digest` 读取，新清单的 `authority_digest` 是 `scope_digest` 的兼容别名。
- 默认执行模式仍为 `serial`。未显式使用并行模式的既有流程不改变。

## daoge-docs 3.15.3 - 2026-08-07

### 修复

- 区分权威 Markdown、索引生成 Markdown 与 JSON/YAML 结构化数据的浏览状态；不再把所有无 front matter 文件显示为“未声明”。
- 工作台将派生状态显示为“已生成”、结构化文件显示为“结构化数据”，并明确它们不代表 Gate 已就绪或机器证据已通过。

## daoge-pic 4.0.0 - 2026-08-05

### 变更

- 将批量生图 Skill 统一命名为 `daoge-pic`：仓库目录、Skill 元数据、安装参数、GitHub 子目录、npm 包、Docker 镜像、用户手册、参考资料与历史文档均使用新名称。
- 保持 `node scripts/daoge.js` 作为既有 CLI 入口，任务规格、输出目录与本地工作台数据格式不变。

## daoge-docs 3.13.4 - 2026-08-04

### 修复

- Goal 生命周期统一将 Git、清单和派生文档路径规范化为 POSIX `/` 形式；Windows 不再把工具生成的工作台数据文件误判为清单外改动，从而阻塞 `prepare-goal`、恢复或检查点。
- 回归测试按被测脚本绝对路径加载模块，消除不同 `unittest` 启动方式对 `sys.path` 的依赖。

## daoge-docs 3.13.3 - 2026-08-04

### 修复

- 将 UTF-8 原文服务回归统一收敛到 `browser-check` 的真实 HTTP Smoke，避免 macOS CI 中独立测试子进程偶发无法连接，同时保留 Markdown MIME、UTF-8 charset 与中文正文可读性校验。

## daoge-docs 3.13.2 - 2026-08-04

### 修复

- Goal 回归夹具在 Windows 使用 PowerShell 可执行的 Python 调用，避免将绝对路径中的反斜杠作为正则替换转义处理。
- 集成安装结果统一使用 `/` 路径分隔符，确保不同操作系统得到稳定、可比较的 JSON 输出。
- UTF-8 文档服务 Smoke 使用有限重试和确定的子进程回收，降低慢启动 macOS Runner 的偶发超时。

## daoge-docs 3.13.1 - 2026-08-04

### 修复

- Windows 默认代码页为非 UTF-8 时，强制 CLI 标准输出与错误输出使用 UTF-8，避免 `doctor --json` 和中文诊断输出失败。

## daoge-docs 3.13.0 - 2026-08-04

### 新增

- `doctor`：只读诊断 Python、Git、shell、Git worktree、项目初始化状态和技术栈候选。
- `ci-check`：统一重建派生文档、文档检查、工作台 Smoke 与 Goal 基线检查。
- Node/TypeScript、Python、Go、Rust、Java/Maven、Gradle、.NET、Ruby、PHP 和 monorepo 的技术栈发现契约。
- macOS、Linux、Windows 与 Python 3.10/3.12 的 GitHub Actions 发布矩阵。
- MIT 许可证、贡献指南、安全政策、Issue 模板、兼容性与技术栈适配文档。

### 变更

- Goal 验证在 Windows 使用 `pwsh` 或 PowerShell，在 POSIX 系统使用可用 shell，不再固定依赖 `/bin/sh`。
- 生成的 VS Code Tasks 使用已选 Python 解释器；工作台和恢复上下文根据平台生成 Python 命令。
- 项目 CI 改为通过 `ci-check` 执行，不再依赖 Bash 专用的 Goal 遍历脚本。

### 兼容性

- 工具主体最低 Python 版本为 3.10，且仅依赖标准库。
- `doctor` 的技术栈结果是只读候选和建议，不会执行项目构建、测试、迁移或部署。
- 未完成的旧 Goal 遇到工具版本变化会按既有规则进入 `stale`；已完成 Goal 保留为历史记录。

## daoge-docs 3.12.2

- 完成离线 Markdown 阅读增强、开发工作台六视图、稳定章节定位、Goal 提示复制与可恢复 Goal 生命周期。
## daoge-docs 3.15.2 - 2026-08-07

### 修复

- 工作台各版本功能清单按稳定功能编号排序，避免跨目录路径顺序导致 V4/V5/V6 功能展示错序。
- 增加跨版本功能排序回归测试。
