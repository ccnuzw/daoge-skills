# DAOGE Pic vNext 升级规格

文档类别：`5.8.0` 稳定正式版的已确认 vNext 升级要求。当前稳定正式版本为 [`5.8.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.8.0)；实现状态与机器验证不由本文件重复声明，分别见 `src/vnext/`、`web/` 和 `docs/vnext_verification_evidence_zh.md`。

## 1. 定位与结论

DAOGE Pic vNext 是一个由 Skill 驱动的、本地优先的图像创作管理平台。

智能体会话是创作的主要入口。用户在会话中表达需求、讨论创作方向、确认任务与轮次，并发起生成。创作管理 Workbench 是自动启动的本地辅助界面，用于项目、任务、轮次、资产、生成过程、选片、批注与交付的可视化管理。

vNext 不是旧工作流的兼容升级。它必须完全替换旧任务格式、旧目录结构、旧 JSON 状态、静态 workspace 页面和文件扫描同步流程。现有代码、模板内容与 Provider 适配经验只能作为能力参考，不能形成新的兼容约束。

## 2. 已确认的产品边界

| 主题 | 已确认规则 |
| --- | --- |
| 核心用户 | 单个创作者与小型创作工作室。 |
| 主要入口 | 智能体会话。用户不必先打开 Workbench、填写 JSON 或执行 CLI。 |
| Workbench 定位 | 本地可视化管理、决策与提示空间，不是第二个聊天产品。 |
| 创作媒介 | 第一版完整支持图片生成、编辑与管理；领域模型为未来视频、音频与设计文件预留扩展。 |
| 数据事实源 | Studio 数据库是唯一业务事实源。目录、缓存、页面和事件都不是事实源。 |
| 项目层级 | 一个 Studio 包含多个项目；一个项目包含多个创作任务；一个任务可以包含无限个创作轮次。 |
| Provider 适配 | 保留插件架构和已验证的 OpenAI Images、Gemini 原生、Gemini OpenAI-compatible、xAI/Grok 四类接入。 |
| Provider Profile | Provider.db 可保存多个 Profile，第一阶段至多一个 active；daemon 启动时固定 active Profile 的配置快照，切换后必须 restart。 |
| 复用 | 第一版提供创作任务类型、用户任务类型、风格套件和品牌套件；从成功任务沉淀为可复用方案属于后续能力。 |
| 评审与交付 | 创作者自行选片、批注、衍生与导出；第一版不提供客户或团队在线协作。 |
| 外部资产 | 保留通用图片导入，作为新资产导入能力，不兼容旧 host-native 结果格式。 |
| 语言 | Workbench 与会话使用中文；提示词语言按任务和当前 Provider 自动适配。 |
| 发布 | 全部升级范围完成、联调和验证后一次性交付；不分模块向最终用户发布旧新混合体验。 |

## 3. 核心原则

1. 会话表达意图，Skill 编排受控动作，Workbench 提供视觉管理。
2. 用户确认的创作事实必须结构化保存。原始对话不得自动成为项目事实。
3. 一项业务事实只能存在一个权威记录。数据库、JSON、页面和目录不得并列为状态源。
4. 文件路径不得表达业务状态。已选、待复核、已交付、已归档和被引用必须由数据库关系表达。
5. 每个真实生成过程必须是可持久化、可观察、可恢复的运行会话。
6. 浏览器关闭、会话切换和终端关闭不得中断已经开始的本地生成会话。
7. 系统重启后不得自动重新发起外部 Provider 请求。未完成会话必须标记为可继续，等待用户在会话中确认。
8. 普通用户界面不得默认展示 JSON、manifest、文件路径、Provider 错误码、调试日志或内部运行对象。
9. Provider 密钥不得写入 studio.db、任务、轮次、运行记录、事件、日志、快照或导出包；只允许保存在受本地权限保护的明文 Provider.db。
10. 所有图像生成、导入、选择、批注、软删除、恢复和导出必须通过统一领域命令写入。
11. 本地回环地址不等于授权边界。除最小健康检查外，Studio API 必须要求当前 daemon 生成的高熵 local capability 或由其换取的本地会话凭据。

## 4. 用户入口与职责分工

### 4.1 主交互链路与执行型启动协议

    执行型触发 -> 解析稳定 workspace -> open Workbench -> 建立/恢复 Studio Session -> 建立/恢复项目上下文 -> 创作澄清与确认 -> 生成会话 -> Workbench 可视化管理 -> 用户会话继续创作

Skill 必须先分类触发：

| 类型 | 判定 | 启动行为 |
| --- | --- | --- |
| 执行型 | 用户明确使用 daoge-pic / 刀哥生图，或要求生成、编辑、衍生、导入、管理、选片、Generation History、恢复、重试、取消或交付。 | 首次必须先执行启动协议，再澄清或写入领域事实。 |
| 咨询/开发型 | 用户讨论架构、配置、源码、文档、测试，或尚未决定使用。 | 不得自动启动 Studio 或打开 Workbench。 |

执行型启动顺序是强制协议：

1. 解析当前会话已绑定的稳定工作区；已有明确绑定时复用。没有可从会话或宿主上下文获得的绑定时，只询问这一不可推导的前置条件，禁止使用临时目录、Skill 安装目录或任意 cwd。
2. 每个独立智能体会话在该工作区首次执行时都可运行普通 `node scripts/daoge.js open --workspace <path>`。`open` 必须确保 `daemon-lock.sqlite` 的长期 SQLite 排他事务所代表的同工作区唯一健康 daemon；`daemon.lock` 仅作为锁持有者发布的身份记录供受控 CLI 验证。随后通过已授权本地 API 原子申请短期 opener claim。活动 Workbench、最近认证连接或未过期 claim 存在时返回 reused 且不得调用 opener；只有首个持有者实际请求默认浏览器。它只是本地准备，不是 Provider 调用，不需要生成确认，也不得自动测试 Provider 连接。
3. CLI 必须安全输出 `{opened:true,reused:false}` 或 `{opened:false,reused:true}` 以及非敏感 reason。随后才以当前真实 conversation ID 创建或恢复独立 Studio Session，再建立或恢复该会话自己的项目、任务与轮次上下文，然后开始创作澄清、计划和领域写入。

跨会话去重必须由 daemon 内存 presence/open-claim 实现，不能依赖会话间共享“已经调用过 open”的事实。Claim token 由 CLI 生成，daemon 仅存哈希且不得写响应、DB、事件、日志或 runtime；失败只释放自己的 claim，TTL 到期可恢复。同进程受控 restart 保留最近 presence，独立 daemon 进程重置。`open --force true` 只用于用户明确要求新标签，可绕过 presence 但不得抢占未过期 claim；普通 Skill 启动不得 force。不得声称 OS opener 能识别或强制聚焦现有标签页。

如果自动打开失败但 daemon 健康，Skill 必须只提供安全重试命令 `node scripts/daoge.js open --workspace <path>`；安装包语境可使用 `npx daoge open --workspace <path>`。不得在回复中回显、记录或要求复制 bootstrap URL、capability、Cookie、session token 或 runtime 私密字段，裸 origin 不得作为主要访问方式。

零 active Provider Profile 不得阻止 Studio 启动和 Workbench 打开。Skill 必须引导用户在 Workbench 生成服务页配置并激活 Profile，然后回到会话继续；打开、加载或保存页面不得自动连接测试。

首次成功的中文状态汇报必须包含：Studio 已启动或连接；按 CLI 结果说明 Workbench 已在默认浏览器打开或已复用现有 Workbench；会话用于描述和确认创作，Workbench 用于 Provider、素材、Generation History、选片与交付；Provider readiness、当前项目/任务/轮次及下一步。不得把 reused 谎报为新打开，也不得重复给出链接或 origin。

### 4.2 智能体会话职责

智能体会话负责：

- 按 4.1 分类触发并执行首次启动或会话内复用。
- 在 Workbench 打开或复用后建立/恢复 Studio Session 与项目、任务、轮次上下文。
- 接收自然语言需求、创作反馈和下一轮意图，再动态追问必要信息。
- 推荐创作任务类型并起草可见、可编辑、待确认的创作计划。
- 根据当前 Provider 能力判断是否可以使用参考图、图生图或遮罩编辑。
- 只有在用户确认后才发起外部 Provider 调用。
- 汇报启动状态、进度、问题、恢复建议和下一步。
- 接受自然语言的暂停、继续、重试、归档和导出指令。

智能体会话禁止直接写文件、扫描目录推断业务状态、直接操作数据库或绕过领域命令调用外部 Provider。

### 4.3 Workbench 职责

Workbench 必须支持：

- 查看当前会话关联的项目、任务和轮次。
- 拖放、文件选择与剪贴板导入图片素材。
- 查看实时进度、新结果、异常和恢复状态。
- 查看图片、放大、对比、筛选、选择、批注与衍生。
- 暂停、继续、取消、重试单项或整轮生成。
- 管理项目、归档、软删除、资产复用和导出。
- 管理 Provider Profiles，并只查看 write-only 密钥与完整 Base URL 的安全摘要。

Workbench 不提供独立聊天入口。项目意图、任务起草和生成确认以智能体会话为主。Workbench 只提供视觉操作、精细管理和受控运行操作。

### 4.4 对话事实保存规则

| 内容 | 保存规则 |
| --- | --- |
| 原始对话 | 可按本地隐私设置保存、摘要或清理；不自动成为项目事实。 |
| 已确认创作计划 | 必须保存为项目、任务、轮次、约束、素材关系和生成设置。 |
| 智能体建议 | 必须保存为待确认草稿；未确认不得改变任务或发起生成。 |
| 运行事件 | 必须保存为审计与恢复证据；不作为当前状态源。 |
| 用户选择与批注 | 必须保存为资产关系和版本化反馈。 |

### 4.5 本地访问授权

Studio 服务必须只监听回环地址，并为每次 daemon 身份生成高熵 local capability。CLI 可以在 `Authorization: Bearer` 中携带 capability；Workbench 只能通过 `open` 生成的 URL fragment 完成一次 bootstrap，以 capability 换取 `HttpOnly`、`SameSite=Strict` 的本地会话 Cookie，并立即从地址栏和浏览器历史中移除 fragment。

除不返回敏感状态的健康检查和静态 Workbench 资源外，所有 API、媒体文件、ZIP、SSE 与写入端点都必须授权。服务必须同时校验请求 Host；Cookie 写入必须校验当前 Studio Origin，JSON mutation 必须要求正确 Content-Type。Capability、会话 token 和 Cookie 值不得写入数据库、领域事件、日志、导出物、Workbench 可见状态或聊天回复，也不得跨 Studio 复用。

Workbench bootstrap 失败必须停留在未授权状态，不得回退为匿名本地访问。CLI 的 `status` 和正常业务输出只能返回脱敏 runtime 信息，不能输出 capability。

Open-claim API 不是匿名端点：必须复用 Bearer/Cookie、Host、Origin 与 JSON Content-Type 门禁，不允许因去重放宽任何授权边界，也不得把 claim 结果纳入持久幂等回执。Workbench 的认证 bootstrap 与 SSE 活动连接是 presence 信号；不得为心跳频繁写磁盘。

## 5. 领域模型

### 5.1 主要实体

| 实体 | 职责 |
| --- | --- |
| Studio | 当前工作区中的创作管理边界，管理全部项目、资产、配置与运行会话。 |
| Studio Session | 当前智能体会话与 Studio 的绑定，记录当前项目、任务与轮次上下文。 |
| Project | 客户、品牌、产品、活动或长期创作主题。 |
| Creative Task | 明确的创作目标，例如夏季新品主视觉。 |
| Creative Round | 同一任务中的首次探索、优化调整、扩展变体、局部编辑或补图。 |
| Generation Run | 一次实际执行的可恢复生成会话。 |
| Run Item | Generation Run 中一张图或一个镜头的独立、可恢复运行单元。 |
| Asset | 导入、生成、编辑或导出的媒体资产。 |
| Asset Relation | 资产与项目、任务、轮次、参考集、品牌套件、交付物之间的关系。 |
| Review Decision | 保留、待复核、不采用、衍生及结构化反馈。 |
| Delivery | 已选资产形成的交付记录、联系表和导出清单。 |
| Task Type | 可复用的创作任务类型，定义适用场景、追问项、质量规则和示例。 |
| Style Kit | 可复用的风格规则、参考资产、禁用项和视觉约束。 |
| Brand Kit | 可复用的品牌资产、产品信息、视觉规则和交付约束。 |

### 5.2 任务与轮次语义

一个 Creative Task 必须始终表示用户可理解的创作目标。Generation Run 只是该目标下的技术执行记录，不能替代任务。

Creative Round 必须支持首次探索、优化调整、扩展变体、局部编辑和补图。

用户在会话中提出“保持第二张的产品与光线，改为横版构图”时，Skill 必须创建或更新一个新的 Creative Round，并将被选中的父资产、已确认反馈、风格约束和参考素材关系写入数据库。

### 5.3 创作计划与提示词证据

Skill 必须将每次确认后的创作计划持久化为可版本化的结构化记录，其中包括任务目标、素材关系、约束、建议产出、生成策略和每个 Run Item 的实际提示词负载。

普通用户不必默认阅读 Prompt；但 Workbench 高级详情必须支持查看当前轮次的计划、提示词策略、实际请求摘要和版本差异。用户必须可以导出不含密钥和内部路径的创作记录，以便复盘、交接和审计。

## 6. 工作区目录与媒体存储

### 6.1 根目录

Skill 必须使用智能体当前绑定的稳定工作区根目录。Skill 禁止把 Studio 数据写入 Skill 安装目录、用户 Home 目录、临时会话缓存目录或未确认的命令子目录。

如果宿主智能体不能提供稳定工作区根目录，Skill 必须先询问用户，禁止在裸 cwd 中擅自初始化。

### 6.2 目录结构

    <当前工作区>/
      daoge-studio/
        studio.db
        Provider.db
        studio.json
        provider.env  # 仅既有工作区一次迁移输入
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
        <project-name>/
          <delivery-name>/

目录仅在首次实际需要写入时创建。初始化不得创建无业务用途的大量空目录。

初始化在产生持久副作用前必须校验已有 `studio.json` 的 schema、Studio 身份与规范化 `workspaceRoot` 严格匹配当前请求根目录。新工作区不创建 `provider.env`；Provider.db、资产与缓存按需创建。

### 6.3 目录职责

| 目录 | 职责 | 是否业务状态源 |
| --- | --- | --- |
| daoge-studio | Studio 数据库、Provider 敏感配置、运行记录、缓存和证据。 | studio.db 是业务事实源；Provider.db 是完整 Provider 配置事实源。 |
| daoge-assets | 导入、生成、导出与软删除的图片二进制。 | 否。 |
| daoge-deliveries | 用户明确导出的可交付内容。 | 否；交付事实仍在数据库。 |
| runtime | 服务 PID、单实例锁、worker 心跳和临时控制信息。 | 否。 |
| cache | 缩略图、预览和 staging 文件。 | 否，必须可重建。 |
| evidence | 必要的审计快照和脱敏诊断日志。 | 否；用于证明与恢复。 |

资产状态禁止由目录表达。daoge-assets 不得创建 selected、review、issues 等以业务状态命名的目录。

### 6.4 媒体写入与软删除

1. 导入或 Provider 返回图片时，媒体服务必须先写入 cache/staging。
2. 媒体服务必须验证文件类型、大小和内容哈希。
3. 媒体服务必须以原子移动方式写入 daoge-assets/imports 或 daoge-assets/generated。
4. 资产记录、稳定 asset_id、内容哈希和来源关系必须在同一业务事务中落库。
5. 缩略图和预览图只能写入缓存，失败不得使正式资产无效。
6. 被引用资产的删除必须显示影响范围。
7. 用户确认删除后，媒体文件必须移入 daoge-assets/trash 并保留可恢复记录。
8. 软删除资产在保留期限内必须可恢复。永久清理策略属于后续可配置维护能力，第一版不得静默永久删除被引用资产。

## 7. Provider 配置与运行并发

### 7.1 Provider.db

每个工作区的完整 Provider 配置只能保存在精确路径：

    <当前工作区>/daoge-studio/Provider.db

Provider.db 是受本地文件权限保护的明文敏感 SQLite，不得宣称加密。它必须拒绝符号链接，Unix 使用 `0600`，Windows 使用仅当前用户、SYSTEM 与 Administrators 的私有 ACL；SQLite 固定 `journal_mode=DELETE`、`secure_delete=ON`、`synchronous=FULL`、`foreign_keys=ON`。Provider.db 及其辅助文件必须进入 `.gitignore`，并排除导出、交付、诊断与打包。

数据库保存多 Profile 的完整 `name`、`providerId`、`model`、完整 `baseUrl`、`apiKey`、`options`、`configVersion`、`active` 与时间戳。第一阶段同一工作区最多一个 active Profile，也允许零 active。`studio.db` 只保存脱敏历史快照，不保存 Profile 或秘密。

### 7.2 Workbench 与受控 API/CLI

Workbench 必须提供 Profile 列表、新建、编辑、复制、激活、删除、本地校验、显式连接测试与保存并重启。API Key 与完整 Base URL 是 write-only：GET 只返回安全摘要，更新必须明确 `keep`、`replace` 或 `clear`。密钥只允许在已授权本地页面写入表单中短暂出现；浏览器不得持久化。页面打开、加载或保存不得自动连接 Provider。

所有写入必须复用本地 capability/Cookie、Host、Origin、Content-Type、安全错误与幂等约束，并通过同源受控 CLI/API；Skill 与用户不得直接写 Provider.db。密钥与完整 URL 不得进入 studio.db、事件、幂等响应、日志、快照、导出、诊断、打包或聊天。

### 7.3 provider.env 一次迁移

`provider.env` 不再是运行时事实源。既有工作区首次升级时一次性导入完整配置到 Provider.db，`IMAGE_PROVIDER` 对应 Profile 设为 active；成功后运行时只读 Provider.db，不覆盖或删除旧文件。新工作区不自动创建 provider.env。`references/provider.env.example` 只保留为显式 import-env 输入格式。

### 7.4 daemon 快照与重启

daemon 启动时固定 active Profile 配置。active Profile、model、endpoint、key、options 或 configVersion 变化后必须标记 `restartRequired`，重启前拒绝新运行；已有运行不得静默切换。安全快照增加 `profileId`、`profileName`、`configVersion`，不含 API Key 或完整 URL；Worker 按 `profileId + configVersion` 领取，不得只靠 providerId、model 或 endpoint。Workbench 发起同一 daemon 进程内的受控重启时，必须只在内存中复用既有 capability 与 HttpOnly 会话 token，使已授权旧页面在端口恢复后继续可用；独立 daemon 进程仍生成新授权，Host、Origin、Cookie 与 capability 边界不得放宽，任意 localhost 页面不得借重启获得授权。

### 7.5 Generation Run 并发

并发只属于 Generation Run，不属于 Provider/Profile、项目、任务、轮次或工作区长期设置。系统全局硬上限固定 `1000`，不可配置；未指定默认 `4`，会话要求串行时解析为 `1`，显式值只接受 `1..1000`，超出必须拒绝且不得静默截断。

每次预检冻结非空 `executionConcurrency`，可附仅用于解释的 `concurrencySource`（`default`、`explicit`、`serial`）。并发在预检前或预检时解析并绑定证据；改变并发必须重新预检。Run 从预检证据复制冻结值，queue 时不得另改；运行中不得修改。实际每 Run 不超过冻结值，全局不超过 `1000`。

必须移除可配置 workspace worker concurrency、`config --worker-concurrency`、相关 runtime-settings API/业务读取及其 restartRequired。Provider 变化仍要求重启。Schema v19 必须保留现有业务数据与已完成 Run 历史，并把既有可用请求值回填到 `executionConcurrency`，其余历史默认 `4`。

### 7.6 动态输出规格

图片画幅、尺寸、分辨率和数量是会话创建的轮次计划字段，不得按 Provider 名称使用静态画幅白名单。`aspectRatio` 使用正整数比值，`size` 使用 `宽x高`，`resolution` 支持 `1K`、`2K` 等长边规格；当同时指定画幅与 resolution 时，系统必须以保持精确画幅的尺寸归一化。

预检只拒绝格式错误、几何不一致或适配器无法无歧义传输的输出请求。例如只接受尺寸字段的适配器在非方形画幅下必须获得明确尺寸或 resolution。真实 Provider 对模型规格的最终拒绝必须如实记录为运行项结果，Skill 不得为了重试而改写比例、尺寸或数量。

### 7.7 Provider 能力处理

Provider adapter 必须声明 generate、edit 和 capabilities。Skill 必须按当前启用 Provider 的能力决定可执行操作。

如果用户请求参考图、图生图或遮罩编辑，而当前 Provider 不支持对应能力，Skill 必须说明当前 active Profile 不支持该操作，并提供继续使用当前能力或先编辑 Profile 的选择。Skill 禁止伪装能力或将不支持的请求发送给 Provider。

### 7.8 Provider HTTP 与下载安全

携带 API Key 的 Provider 请求必须直接发往用户配置的最终端点，并拒绝任何 HTTP 重定向，避免凭据被转发到未确认目标。Provider 响应若返回远程图片 URL，下载器必须执行独立的 SSRF 防护：

- 只接受不含用户名或密码的 `http:` / `https:` URL。
- 对域名解析得到的全部地址执行公网地址校验，拒绝 loopback、私网、链路本地、保留、文档与多播地址；连接必须固定到已验证地址，并确认实际远端地址与固定结果一致，防止 DNS rebinding。
- 每次重定向都重新解析、重新校验并受有限跳数约束；不得把 Provider API 凭据带入图片下载请求。
- 在读取前后都执行有界大小检查；超限、空响应、无效 base64、非图片内容或中断下载不得形成正式资产。

这些边界同时适用于 generate 与 edit 的远程结果。用户配置自定义 Provider 端点不构成放宽本地网络访问或下载大小限制的授权。

## 8. 持久运行引擎

### 8.1 运行生命周期

Generation Run 是脱离浏览器和终端窗口的本地后台会话。运行 worker 必须由 Studio 数据库驱动，不能由 Workbench 页面、stdout 或目录扫描驱动。

| 状态 | 语义 | 允许的下一状态 |
| --- | --- | --- |
| draft | Skill 正在起草，用户尚未确认。 | awaiting_confirmation、cancelled |
| awaiting_confirmation | 计划完整，等待用户在会话中确认。 | queued、cancelled |
| queued | 已确认，等待本地 worker 领取。 | running、cancelled |
| running | worker 正在派发或处理运行项。 | pausing、completed、partial、failed、interrupted |
| pausing | 已停止派发新项，等待在途项达到稳定结果。 | paused、partial、failed |
| paused | 用户主动暂停。 | queued、cancelled |
| interrupted | 服务或系统异常中断，尚未决定恢复策略。 | resume_pending |
| resume_pending | 系统重启后等待用户确认继续。 | queued、cancelled |
| partial | 至少一个运行项成功，且仍有失败、阻塞或取消项。 | queued、completed、cancelled |
| completed | 所有可执行运行项已稳定完成。 | 终态 |
| failed | 无可恢复的自动处理路径，需用户修正后新建或继续。 | queued、cancelled |
| cancelled | 用户取消，保留已完成资产与全部历史。 | 终态 |

系统重启后，运行引擎必须将未完成且无有效 worker 租约的会话标记为 resume_pending。运行引擎禁止在没有用户确认的情况下自动调用外部 Provider。

### 8.2 单项生命周期

Run Item 必须有稳定 ID，并使用以下主路径：

    pending -> leased -> requesting -> receiving -> persisting -> succeeded

失败与人工分支：

    requesting 或 receiving -> retry_wait -> pending
    pending 或 requesting -> blocked 或 cancel_requested -> cancelled
    requesting 或 receiving -> outcome_unknown
    retry_wait、blocked 或 outcome_unknown -> failed

outcome_unknown 表示外部请求已发出但本地未获得稳定结果，例如进程在请求期间被终止。该状态禁止直接自动重发。运行引擎必须先按 Provider 能力查询、对账或交由用户确认，避免重复生成和重复外部副作用。

### 8.3 重试、暂停、取消与恢复

| 情况 | 必须行为 |
| --- | --- |
| 网络错误、超时、429、可重试 5xx | 写入失败分类、退避时间和尝试次数后进入 retry_wait。 |
| 认证失败、无效模型、无效参数 | 禁止自动重试；运行项进入 blocked 或 failed，提示用户修正配置。 |
| 素材、参考图或遮罩缺失 | 仅阻塞依赖该素材的运行项；无关运行项必须继续。 |
| 用户暂停 | 停止领取新项；在途请求按 Provider 能力中止或等待稳定结果。 |
| 用户继续 | 仅恢复未完成、可重试或明确选中的运行项。 |
| 用户取消 | 停止领取新项，保留已完成资产、计划与证据。 |
| 浏览器断开 | worker 必须继续运行；重新连接后补齐状态与事件。 |
| 服务重启 | 已完成项必须保留；未完成会话进入 resume_pending，等待会话确认。 |

运行引擎必须定义有界重试、指数退避和抖动策略。具体默认次数、退避上限与 Provider 特定限制必须写入可版本化运行配置或源码常量，不得写入或读取 `provider.env`，并通过故障注入测试验证。

### 8.4 一致性与事件

领域状态变更必须使用事务。创建资产、更新运行项、记录状态转换和写入事件 outbox 时，数据库必须提交同一业务结果。

媒体二进制无法与 SQLite 形成单一原子事务时，媒体服务必须采用 staging、内容哈希、原子移动、持久 journal 和启动对账。Journal 必须记录受限的相对源/目标、操作阶段及预期媒体类型、哈希、大小和 Studio 身份；恢复只能在这些身份全部匹配且路径仍位于规定受管理根目录时完成：

- 数据库存在资产但文件缺失时，资产必须标记为可修复，不得伪装为可用。
- 文件存在但数据库无资产时，启动对账必须将其标记为孤立候选，禁止自动当作正式资产展示。
- Journal 冲突、身份不匹配、路径越界、符号链接或结果歧义必须记录脱敏拒绝事件并保留人工诊断边界，禁止猜测提交、覆盖或删除。
- 已确认的正式资产文件不得因缩略图、预览、事件发送或客户端断开失败而被删除。

下载、复制、交付导出和 ZIP 必须基于已验证的文件 snapshot，而不是验证后再次按可变路径打开。Snapshot 必须固定受管理文件身份、拒绝符号链接和路径穿越，并在流式读取期间约束预期大小与内容；ZIP 必须在写响应头前完成条目与聚合上限检查，处理背压和取消，并在断连或失败时关闭全部文件描述符与临时 snapshot。Snapshot 只保证读取一致性，不是新的业务事实源，临时副本必须可清理且不得出现在交付清单中。

### 8.5 预检与干跑

Skill 必须支持在不调用外部 Provider 的情况下完成预检与干跑。预检必须验证当前 Provider 配置、能力兼容性、素材可用性、轮次计划、输出约束、依赖关系和运行项数量。

干跑必须创建可审计的计划与运行项预览，但不得产生外部调用、计费副作用或正式生成资产。预检失败必须在会话中用创作语言说明影响与建议动作，并允许用户修正后重新确认。

## 9. 实时更新与会话恢复

本地服务必须通过 SSE 向 Workbench 推送持久事件。事件必须有严格递增 ID，Workbench 断线后必须以最后事件 ID 或状态版本重新连接。

连接恢复顺序必须为：

1. Workbench 读取当前项目、任务、轮次和运行会话状态快照。
2. Workbench 携带最后已处理事件 ID 请求补发。
3. 服务返回缺失事件；若事件窗口不可用，则返回新的状态快照。
4. Workbench 仅更新受影响区域，例如新资产流、运行进度、问题或选择状态。

Workbench 不得依赖全页刷新、扫描目录或客户端推测来显示最新生成结果。

浏览器本地仅保存非权威交互状态，例如当前项目、筛选条件、页面位置和抽屉开关。项目选片集合是 Studio 业务状态：它以资产关系表达、由 Studio API 恢复，并且独立于当前浏览器、筛选范围和页面刷新。

每个智能体对话必须以真实 conversation ID 对应独立 Studio Session；四个会话的 active project/task/round 更新不得互相覆盖。Workbench 自身 UI Session 只用于该标签页交互，identity 保存在 `sessionStorage`：reload 复用，同源不同标签不共享；它不代表任一智能体会话。单一 Workbench 的 route 始终由用户当前标签选择决定，后台其他 Session context 更新不得自动跟随或抢占。SSE 继续是 Studio 级事件流，使唯一 Workbench 可看到所有项目变化。

## 10. 创作任务类型与复用

vNext 必须保留现有有效创作知识的语义，并重构为新的 Task Type Library。旧 Markdown 模板、旧 JSON 模板、旧 ID 和旧输出契约不得作为新格式的兼容输入。

每个 Task Type 至少定义：

- 面向创作者的名称、适用场景和不适用场景。
- 通过会话动态追问的必要信息。
- 默认创作目标、画幅与建议产出结构。
- 可复用的质量规则与常见失败模式。
- 可以显式选择的参考素材角色。
- 可面向用户展示的示例与变体。

第一版必须支持官方 Task Type、用户自建 Task Type、Style Kit 和 Brand Kit。

Task Type、Style Kit 和 Brand Kit 必须是可组合的创作约束。它们不得强制选择具体 Provider 或将 Provider 密钥、内部路径写入任务内容。

创作资料库只提供跨任务类型、风格包和品牌包的检索、类型筛选与结构化详情；项目的生成图片、导入图片和参考图不得与官方任务类型混列。项目图片默认归属于项目资产。跨项目复用必须由独立“共享素材”模块承载，且只有用户从项目资产明确共享的图片才可出现；共享不会自动加入任何项目、任务、轮次或计划。Workbench 不得在资料库导入项目图片、直接创建语义资源、自动绑定到任务/轮次/计划或触发生成；此类意图与资源创建仍由会话或受控 CLI 完成。资料库与共享素材 API 公开投影必须递归过滤密钥、令牌、端点、内部路径和内容哈希；任何带目标关系的导入必须在服务端验证目标存在、同 Studio 归属和父子层级。

## 11. 资产、评审与交付

### 11.1 资产复用

Studio 必须维护全局资产库与项目资产集合两层关系。

- Logo、品牌素材、产品素材、角色参考和风格样张可以被多个项目引用。
- 项目生成结果、持久项目选片集合和交付物必须保留项目归属。
- 复用资产必须保留来源、引用项目、引用任务和引用轮次。
- 参考图和遮罩只有在属于当前项目资产范围，或具有当前 Studio 的明确 `shared_across_projects` 关系时才可被计划引用；同 Studio 其他项目的未共享资产必须在计划写入、确认、预检、排队和 Worker 读取前拒绝。
- 复用不得复制正式二进制文件；数据库必须使用关系表达共享。
- 项目中移除共享资料库资源只删除项目关系，不得移入项目回收站或删除全局资源；资料库资源的生命周期由资料库中的停用或归档动作管理。
- 项目回收站只列出当前项目归属且已软删除的资产；恢复回到原项目，不能成为跨项目浏览或全局资料库入口。

### 11.2 评审

第一版评审必须支持保留、待复核、不采用、衍生新轮次、自由批注，以及一致性、构图、材质、品牌感、文字安全区等通用结构化反馈维度。

评审维度不得强迫用户每次完整评分。任何选择或反馈必须能被下一轮作为明确上下文引用。

### 11.3 交付

第一版必须支持导出精选图片、联系表、交付清单和可选的创作记录报告。创作记录报告用于复盘、交接和审计，包含用户明确选择的任务、轮次、资产来源、选择结论和脱敏运行摘要；它不是旧静态工作台或旧调试报告的兼容产物。

导出包与创作记录报告不得包含 provider.env、密钥、缓存、原始日志、调试文件或未被用户明确选择的内部材料。交付清单必须记录交付 ID、项目、已选资产、导出时间和来源轮次，但不得包含敏感配置。

交付界面必须以创作者语言呈现“挑选图片、完成交付、下载或复制图片”三步。普通交付的单一主操作必须在一次明确用户操作中建立、锁定并导出交付记录，不得要求用户理解草稿、准备、P1 或版本号；需要合并多批交付的版本管理必须默认折叠为可选高级区域。项目资产的主选择动作应将图片标记为可交付成果，并保持“取消成果”不会抹掉已有评审。

每张活跃成果图片必须可直接下载实体 PNG/JPEG/WebP/GIF 文件，并提供尽力而为的复制图片动作及清楚的浏览器权限降级说明。项目资产的当前选片必须可选择性打包为 ZIP；已导出交付必须可按全选或用户勾选的冻结图片子集打包为 ZIP。ZIP 只能读取当前 Studio 内、当前项目归属的活跃受管理资产，或已导出交付的冻结副本；单次最多 100 张且原始总量最多 150 MB，压缩包不得包含清单、日志、路径或任何内部资料。导出后的图片必须可通过交付冻结副本继续下载、复制或打包，不能因源资产后来移入 Studio 回收站而失效；服务端只可按已验证资产 ID 或交付 ID、序号解析受管理文件，且不得向 Workbench 暴露任意绝对路径。更新草稿未显式修改创作记录选项时，必须保留原草稿的选项。

## 12. Workbench 信息架构

Workbench 必须随创作状态动态换挡，而不是作为固定的指标墙或静态生产总览。

| 当前情境 | 首要内容 | 次要内容 |
| --- | --- | --- |
| 没有进行中任务 | 最近项目、继续创作、任务类型、可复用资产。 | 已归档项目与最近交付。 |
| 正在生成 | 当前任务、轮次、实时进度、新结果、暂停或取消。 | 运行详情与问题。 |
| 正在选片 | 图片流、对比、选择、批注、衍生。 | 任务约束与历史轮次。 |
| 准备交付 | 已选资产、缺项、联系表、导出。 | 来源轮次与交付历史。 |

Workbench 必须以专业创作工具、灵感工作室和生产管理台的能力综合为目标，但同一时刻只能突出与当前情境相关的主要任务。首页不得同时堆叠全部指标、日志、任务类型、事件和设置。

Studio 全局导航固定为项目、创作资料库、共享素材、学习中心和设置。资料库、共享素材与学习中心不得显示或保留项目、任务、轮次、运行上下文。项目入口后才显示项目概览、任务、项目资产、交付和项目回收站；项目首页与任务功能必须提供名称搜索、生命周期筛选和分页，项目概览内的任务摘要也必须有同等搜索、筛选和有界分页，禁止项目或任务数量增长后无限向下延伸。项目资产提供“全部成果 / 已选”的视觉选片视图，以服务端范围查询分页，默认每页 24 张并允许 16/24/32/48/64/96，筛选后返回精确总数。“全选本页”只选择当前筛选条件和当前页中的资产，取消全选不得抹掉已有评审。项目资产导入必须允许文件选择器、拖放一次接收多张图片，逐张建立稳定资产并汇总部分失败。交付图片必须提供明确的全选/取消全选。即使手工构造 Workbench 深链，项目资产也不得保留或序列化 `scope=studio`：无任务时归一到项目范围，带任务时归一到该任务范围；跨项目图片只能通过明确共享后的共享素材模块访问。

图片放大预览窗口必须显示当前成果选择状态，并允许直接执行“选为成果 / 取消成果”；双图对比时每张图片独立选择。当前选片缩略条必须把预览、标题/状态和移除动作分为不重叠区域，长标题使用安全省略，移除按钮不得遮挡文本。项目资产 ZIP 的下载名必须包含项目名称、`项目资产` 和秒级时间；已导出交付 ZIP 必须包含项目名称、交付名称、`交付图片` 和秒级时间，并通过 `filename*` 传输 UTF-8 名称、通过 `filename` 提供安全 ASCII 回退。

学习中心必须是可搜索、可按专题筛选的 Studio 全局创作手册，而非仅有流程概述的静态说明。它至少覆盖项目/任务/轮次、计划与提示词证据、预检与能力、运行与异常恢复、资产导入及范围、视觉选片与评审、参考与衍生、资料库、交付、项目回收和安全边界。每项都要区分 Workbench 中可查看或可操作的事实与必须回到会话确认的动作；只能链接项目列表和资料库等全局视图，不得在全局学习页虚构项目级上下文、聊天、计划编辑、确认入队、Provider 调用或密钥配置。

任务页面显示任务概览与创作轮次；只有选中轮次后，才显示计划与提示词、生成运行和结果等轮次操作。界面不得默认同时展示 Studio、项目、任务、轮次四层持久导航，也不得将选片另造为脱离项目资产的独立系统。

## 13. 技术架构

### 13.1 发布形态

用户下载的是开箱即用的 Skill。维护者可以使用现代构建工具，但用户不得被要求安装前端依赖、构建 UI、初始化数据库、启动 Docker、配置 Redis 或运行多服务。

    daoge-pic/
      SKILL.md
      scripts/daoge.js
      dist/
        runtime/
        workbench/
      references/
        provider.env.example

### 13.2 技术选择

| 层级 | 选择 | 约束 |
| --- | --- | --- |
| 运行时 | Node.js 22 LTS 与 TypeScript 编译产物。 | 发布时必须可直接运行。 |
| 本地服务 | Node 原生 HTTP 与 SSE 或等价轻量路由层。 | 禁止因 Workbench 引入完整云端 Web 应用依赖。 |
| 业务数据 | SQLite WAL、FTS5、版本化 SQL migration。 | studio.db 是唯一业务事实源。 |
| 数据访问 | 小型 typed repository 与 schema 校验。 | 禁止由页面或目录直接写入业务事实。 |
| 运行引擎 | SQLite 持久队列、daemon 内持久 Worker、租约和心跳。 | 同 workspace 仅一个 daemon 持有独立 `runtime/daemon-lock.sqlite` 的长期 `BEGIN EXCLUSIVE` 事务；OS/SQLite 在进程崩溃时自动释放。`daemon.lock` 只是 PID/ownerId 身份记录，不承担互斥。并发 CLI 最终复用同一实例。不同 Session/项目的 Runs 共享 Worker、每 Run 冻结并发与全局 1000 公平队列，不另设 Session/Provider/项目并发。 |
| 实时通道 | SSE 与持久事件 outbox。 | 必须支持断线补偿。 |
| Workbench | React 与 Vite 构建出的静态 bundle。 | 不提供第二个聊天入口。 |
| 图片处理 | Node crypto；缩略图与预览可使用可选图像处理依赖。 | 缩略图失败不得破坏正式资产。 |
| Provider | Image Provider plugin。 | Provider 能力必须显式声明。 |
| 测试 | Node 内置测试运行器、真实浏览器 harness、模拟 Provider 与故障注入。 | 浏览器驱动由验证环境提供，不预设或承诺安装 Vitest/Playwright；必须验证状态恢复、可访问交互和外部副作用。 |

第一版明确不引入独立 Workbench 文本助手、Next.js、Electron、Tauri、Redis、Kafka、BullMQ、Docker、微服务、云数据库、账户体系、客户在线协作和 OS 登录自启动服务。

## 14. 高风险约束

vNext 涉及 API Key、并发、异步 worker、第三方图片 Provider、文件写入、软删除、断线恢复和未知外部请求结果，属于高风险升级。

实现前必须为以下能力建立独立技术设计、稳定分支和测试映射：

- Provider 密钥加载与脱敏。
- Local capability bootstrap、Bearer/Cookie 授权、Host/Origin/Content-Type 与 Studio 隔离。
- 跨会话 daemon 首次启动竞态、Workbench presence/open-claim 的 TTL/失败释放/受控 restart/force 语义，以及 claim token 非持久化。
- 真实 conversation Session context、项目/Run 归属、Workbench per-tab identity 与用户 route 不被后台会话抢占。
- Provider 凭据请求的重定向拒绝，以及远程图片下载的 SSRF、DNS 固定和有界响应。
- 运行会话状态机与并发租约。
- 重试、取消、暂停、恢复和未知结果处理。
- 媒体 staging、原子归档、持久 journal、启动对账与歧义拒绝。
- 受验证文件 snapshot、流式 ZIP、背压/取消与临时副本清理。
- SSE 事件补发与状态快照恢复。
- 软删除、恢复与被引用资产影响分析。
- Provider Profile 与 configVersion 变化后的安全快照、restartRequired 和运行隔离。
- 外部资产导入的类型校验、去重、来源和失败处理。

## 15. 验收标准

以下验收项是 vNext 一次性交付的最低条件。

| ID | 验收项 |
| --- | --- |
| PIC-VN-AC-001 | 用户首次在稳定工作区触发 Skill 时，Skill 创建 daoge-studio 但不创建 provider.env；用户可在唯一 Workbench 中新建并激活 Provider Profile。 |
| PIC-VN-AC-002 | 用户可仅通过智能体会话起草并确认项目、任务与创作轮次；未确认草稿不得调用 Provider。 |
| PIC-VN-AC-003 | Workbench 可视化管理项目、任务、轮次、资产、运行、选片、批注、软删除恢复和导出，但不提供第二个聊天入口。 |
| PIC-VN-AC-004 | daoge-studio/studio.db 是唯一 Studio 业务事实源；Provider.db 是唯一完整 Provider 配置事实源；删除、移动或重建缓存不得改变业务事实。 |
| PIC-VN-AC-005 | 图片导入、Provider 生成和外部图片导入均创建稳定 Asset 与来源关系；业务状态不依赖资产目录名。 |
| PIC-VN-AC-006 | 一个运行会话生成至少 100 个运行项时，浏览器刷新、页面关闭、短时网络故障、429、可重试 5xx 和本地服务重启后，已完成资产不丢失，未完成项可恢复。 |
| PIC-VN-AC-007 | 系统重启后的未完成运行会话必须进入 resume_pending，且未获得用户确认前不得自动调用外部 Provider。 |
| PIC-VN-AC-008 | Workbench 通过 SSE 显示新资产、进度和问题；断线重连后不依赖目录扫描或全页刷新即可恢复一致状态。 |
| PIC-VN-AC-009 | Provider 密钥和完整 Base URL 只存在于 Provider.db 与短暂写入/Worker 内存，不进入 studio.db、API GET、事件、日志、幂等响应、快照、导出、诊断、打包、浏览器持久状态或聊天；Provider.db 受本地权限保护并自动进入 .gitignore。 |
| PIC-VN-AC-010 | 当前本地 Provider 不支持参考图或遮罩编辑时，Skill 必须在会话中给出明确可理解的限制与下一步，不得伪装执行成功。 |
| PIC-VN-AC-011 | 现有创作模板的有效语义被重构为新的 Task Type Library；旧 task spec、旧模板格式、旧输出目录和旧页面契约不再作为输入或运行依赖。 |
| PIC-VN-AC-012 | 交付默认包含精选图片、联系表和交付清单，且不包含密钥、缓存、日志或未选择的内部材料。 |
| PIC-VN-AC-013 | 用户可在不调用外部 Provider 的情况下执行预检与干跑；系统必须验证配置、能力、素材、依赖、输出约束和运行项计划，并不得产生计费副作用或正式生成资产。 |
| PIC-VN-AC-014 | 每个确认轮次保留可版本化计划与 Prompt 证据；高级详情和可选创作记录报告可追溯计划、资产来源、选择结论与脱敏运行摘要，且不包含密钥或内部路径。 |
| PIC-VN-AC-015 | Workbench 只能通过 local capability bootstrap 获得当前 Studio 会话；除最小健康检查外的 API、媒体、ZIP 与 SSE 均拒绝匿名或跨 Studio 访问，bootstrap 后 URL 不保留 capability。 |
| PIC-VN-AC-016 | Provider 图片 URL 下载逐跳执行 SSRF 校验、DNS 固定、远端地址确认、重定向和大小限制；携带 Provider 凭据的 API 请求不得跟随重定向。 |
| PIC-VN-AC-017 | 导入、生成、回收、恢复、交付与 ZIP 在崩溃、文件替换、符号链接、断连或 journal 冲突时不得把身份不明媒体提交为正式资产；恢复与读取只接受受管理根目录内身份匹配的 journal/snapshot。 |
| PIC-VN-AC-018 | Provider Profile 支持 CRUD、复制、唯一 active、本地校验、显式连接测试、write-only secret 更新与受控重启；同进程重启保持既有 Workbench 授权但不放宽 localhost/Origin 边界；Worker 只领取 profileId + configVersion 匹配的运行。 |
| PIC-VN-AC-019 | 每次 Run 在预检冻结 1..1000 的 executionConcurrency；默认 4、串行 1、1001 拒绝，queue 与运行中都不能改写，系统全局不超过 1000。 |
| PIC-VN-AC-020 | 执行型触发在稳定 workspace 中先普通 `open`，再建立独立 Session/项目上下文并开始澄清；咨询/开发型不自动启动。每个独立会话都可调用普通 open，daemon 只允许首个实际 opener并让其他会话返回 reused；失败回退不泄露 bootstrap/claim 秘密；force 仅显式用户动作；零 active Provider 仍可启动且不会自动测试连接；首次汇报区分 opened/reused 并包含职责、Provider readiness、当前上下文和下一步。 |
| PIC-VN-AC-021 | 同一稳定 workspace 的 3–4 个并发会话最终复用唯一 daemon/PID 和单一活动 Workbench；真实 conversation Session 的 project/task/round、项目与 Run 归属互相隔离，Workbench per-tab UI Session 与 agent Sessions 分离，用户当前 route 不被后台 context 更新抢占；所有 Runs 仍共享 daemon Worker 与全局公平队列。 |

## 16. 实施与发布约束

开发可以按以下内部顺序进行：

1. 新领域模型、数据库 schema、migration、目录初始化和 Provider 配置。
2. 持久运行引擎、媒体服务、事件 outbox、恢复与故障注入。
3. Skill 会话命令与 Studio Session 绑定。
4. Workbench 的项目、任务、运行、资产、评审和交付界面。
5. Task Type Library、Style Kit、Brand Kit 与外部资产导入。
6. 全量 E2E、100 项恢复场景、真实 Provider 受控探测和安全检查。

`5.8.0` 稳定正式版已按本规格完成旧新体验的干净切换；后续版本也不得重新引入旧新混合入口。任何发布仍必须先满足本规格验收项、相关高风险技术设计和对应版本的真实验证证据。

## 17. 明确非目标

vNext 第一版不包含：

- 旧任务格式、旧资产结构、旧 JSON、旧工作台或旧静态页面兼容。
- 旧项目迁移。
- 多人账户、权限、云同步、客户在线审阅和公开分享链接。
- 视频、音频、文档和设计源文件的完整创作流程。
- 运行成本与配额的用户看板。
- Workbench 内的独立文本聊天助手。
- 每个轮次选择 Provider Profile 的复杂配置模式。
- OS 启动后自动继续外部生成请求。

## 18. 规格解释

本规格定义 `5.8.0` 稳定正式版的目标产品与目标架构；具体实现状态、机器验证与发布证据由对应版本源码和独立验证记录证明，不从需求文字反推。后续代码、目录、命令或测试变化也不得自行改写本规格事实。
