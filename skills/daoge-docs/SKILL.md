---
name: daoge-docs
description: 为软件项目建立和治理中文文档驱动开发体系。用于初始化或升级项目 docs、编写与评审产品蓝图、版本 PRD、功能规格、技术设计、ADR、需求追踪、E2E、性能、发布与证据文档，执行 docs-check 和多阶段 docs-gate。用户提到 daoge-docs、文档驱动开发、文档规范、PRD、需求追踪、ADR、开发门禁、发布证据或希望复用完整 docs 体系时必须使用。
---

# DAOGE Docs

建立项目专属的中文文档驱动开发系统。复用的是结构、方法、权威模型和门禁，不复制其他项目的业务结论。

## 不可违反的规则

1. 默认使用中文思考、沟通和编写文档；仅保留 API、ADR、E2E、OpenAPI、SLO、CI 等通用术语及代码标识。
2. 先检查仓库、现有文档、代码、迁移、接口、测试和发布配置，再生成或改写文档。不得把模板占位当成项目事实。
3. 每类事实只能有一个权威来源。其他文件使用链接或派生索引，不维护第二份定义。
4. 产品要求、当前实现和验证证据必须分开。文档完整不代表代码完成，测试通过不代表允许发布。
5. 不推断缺失的业务规则。写入“待确认”，说明负责人、截止时间和阻塞阶段。
6. 权限、资金、秘密、并发、删除、外部副作用、动态制品、跨系统状态或恢复语义冲突时，停止实现，先记录决策。
7. 重要需求、功能、验收项、设计分支、E2E 用例和 ADR 使用稳定 ID；重命名、移动或废弃后不得复用 ID。
8. 任何“已验证”结论必须绑定实际命令、退出码、环境、提交、构建、时间和证据路径。

工作台的 `documents[].status` 是阅读目录的输入状态，不是门禁结果：有 front matter 的权威 Markdown 使用其声明状态；索引生成的 Markdown 使用 `generated`（界面显示“已生成”）；JSON/YAML/OpenAPI 使用 `not_applicable`（界面显示“结构化数据”）；普通 Markdown 缺少 front matter 时使用 `unknown`（界面显示“未知”）。这些状态不能推导 `ready`、`passed` 或已发布，门禁仍只读取各自的权威文档、finding 和机器证据。

开始前按任务读取参考文件：

- 新项目适配：读取 [references/adaptation.md](references/adaptation.md)。
- 方法与权威冲突：读取 [references/methodology.md](references/methodology.md)。
- 功能风险：读取 [references/risk-classification.md](references/risk-classification.md)。
- 验证或发布：读取 [references/evidence-and-gates.md](references/evidence-and-gates.md)。
- 编写或评审正文：读取 [references/chinese-writing.md](references/chinese-writing.md)。
- 用户要求与参考 `docs` 完全等价：读取 [references/reference-parity.md](references/reference-parity.md)。
- 开发执行工作台产品：读取 [references/developer-workbench-prd.md](references/developer-workbench-prd.md)。
- 工作台数据契约：读取 [references/developer-workbench-data-contract.md](references/developer-workbench-data-contract.md)。
- 准备、执行或恢复大型 Goal：读取 [references/agent-goal-execution-contract.md](references/agent-goal-execution-contract.md)。
- 安装、升级、跨平台或兼容性问题：读取 [references/compatibility.md](references/compatibility.md)。
- 识别技术栈、monorepo 或冻结构建测试命令：读取 [references/stack-adapters.md](references/stack-adapters.md)。

## Profile 选择

| Profile | 适用范围 | 核心能力 |
| --- | --- | --- |
| `lean` | 小型、低风险、单团队项目 | 项目、版本、功能、架构、测试、发布和 ADR 主链路 |
| `standard` | 多模块产品或多人团队 | 加入产品蓝图、PRD、边界、数据、OpenAPI、安全和开发流程 |
| `strict` | 平台、资金、安全、外部服务、合规或高稳定性项目 | 生成与参考 `docs` 同等级的产品、版本、功能、架构、E2E、性能、恢复、决策和证据体系 |

用户要求复现完整 `docs` 规范时必须选择 `strict`。所谓“相同”是治理深度、结构职责和追踪能力相同，不是复制参考项目内容。

## 初始化项目

1. 读取仓库规则和现有材料，建立“已证实事实、合理推断、未知项”三栏调研结果。
2. 先运行 `doctor --root <project-root> --json`；它只读检查运行环境、Git、项目状态和技术栈候选，不执行项目命令。
3. 从证据确定项目名称、稳定项目代码、当前版本、用户、目标、领域、外部依赖和风险；技术栈候选只能作为调研输入，不能代替项目验证命令；只有影响方向且无法发现的信息才询问用户。
4. 运行：

```sh
python3 <skill-dir>/scripts/daoge_docs.py init \
  --root <project-root> \
  --project-name <中文项目名> \
  --project-code <CODE> \
  --version <V1> \
  --profile strict
```

5. 已有 `docs/` 时先审计冲突，再加 `--merge`；工具只能补文件，不能覆盖项目事实。
6. 初始化后使用项目内固定版本命令：macOS/Linux 使用 `python3 .daoge-docs/daoge_docs.py ...`；Windows 优先使用 `py -3 .daoge-docs/daoge_docs.py ...`。
7. 先完成 `项目调研与事实清单`，再按产品、版本、功能、架构、测试、决策的权威顺序消除占位。
8. 依次运行 `index`、`check`、`gate --stage discovery`、`gate --stage version-ready`。门禁失败是待办事实，不得通过伪造内容绕过。

## 创建版本与领域

创建新版本空间并切换活动版本：

```sh
python3 .daoge-docs/daoge_docs.py new-version --root . --version V2
```

只建立未来规划空间时使用 `--no-activate`。在创建功能前建立领域边界：

```sh
python3 .daoge-docs/daoge_docs.py new-domain --root . --name 身份与权限
```

领域说明必须写明职责、数据所有权、上下游契约、禁止依赖和不变量。

尚未进入开发的后续版本使用 `new-future-version`，不要提前激活。生命周期、协议格式、接入指南等项目专属架构文档使用 `new-architecture-spec`；需要最小 YAML 和 JSON fixture 时加 `--with-example`。

## 创建功能和需求

1. 先确定问题、用户、成功指标、版本、范围、非目标、依赖和需求 ID。
2. 根据风险参考文件选择 `standard` 或 `high`。命中资金、权限、秘密、并发、外部副作用或跨系统状态时一般为 `high`。
3. 创建功能：

```sh
python3 .daoge-docs/daoge_docs.py new-feature \
  --root . --number 1 --name 用户注册 --domain 身份与权限 \
  --risk high --risk-reason "密码与账户所有权" \
  --keywords "注册,邮箱,密码" --requirements CODE-NFR-001
```

4. 独立的非功能需求和全局规则使用 `new-requirement --type NFR|RG` 注册；`--source` 必须指向项目 `docs` 内真实存在的权威文件；FR 始终由功能文档产生。
5. 复杂行为使用状态机或决策表，重要执行分支使用稳定 `Bxx-NN` ID。
6. 每条 AC 必须映射测试层、目标资产、执行命令和证据。
7. 标准风险功能在主文档中完成单元契约、可执行伪代码和分支追踪；高风险功能还必须完成独立技术设计中的函数签名、前后置条件、不变量、事务、并发、幂等、外部调用、未知结果、补偿、迁移和回滚。
8. 伪代码必须写出输入、守卫、稳定分支、事务边界、外部副作用和返回结果。自然语言概述、空代码块或“已确认”不能代替可执行语义。
9. 每个功能 AC 至少进入一个 `Bxx-NN` 分支追踪行；高风险设计至少定义两个稳定分支，并把日志、指标、Integration/E2E 和发布证据引用到同一 ID。
10. 实现前依次运行 `index`、`check` 和 `gate --stage feature-ready --feature <ID>`。任何结构错误、占位、未就绪状态或追踪缺口都必须保持阻塞。

## 专项门禁与测试纪律

`version-ready` 前不能只补齐标题和状态。必须逐份评审以下可执行契约：

1. `版本进入开发门禁.md`：门禁输入、权威摘要失效条件、产品范围、稳定需求、架构风险、测试发布准备、批准和例外。
2. `测试策略.md`：静态、单元、Integration/Contract、前端、E2E、性能、安全和发布各层职责；风险到失败注入、副作用和最低证据的映射；失败分类与退出标准。
3. E2E 规范、环境、夹具和执行手册：真实入口、真实核心组件、最终业务副作用、`Arrange/Act/Assert/Replay/Cleanup`、环境失败与业务失败分离、报告保存和清理。
4. 性能规范、环境、负载、场景和执行手册：逐请求测量、明确比较符、批准 Profile 与 SHA-256、稳态/峰值/过载/恢复、资源有界、业务不变量和停止条件。不得用两个聚合分位数相减推导阶段耗时。
5. 部署、回滚和恢复手册：不可变制品及摘要、迁移兼容、冒烟、观察、角色、未知外部副作用、RPO/RTO、一致性校验和演练证据。

计划命令只能写入计划或手册，不能写进机器证据。`skipped`、`not_run`、`environment_failed`、缺失副作用断言、缺失构建绑定或失败后覆盖报告都不能通过相应门禁。

## E2E、任务和决策

用 `new-e2e` 建立需求到真实用户旅程的映射；`strict` Profile 的版本门禁要求每条需求至少进入一个 E2E 用例。

```sh
python3 .daoge-docs/daoge_docs.py new-e2e \
  --root . --number 1 --name "新用户完成注册" \
  --requirements "CODE-FR-001,CODE-NFR-001" --environment-level staging
```

功能通过 Ready 门禁后，用 `new-task` 创建有明确授权边界的开发任务书。长期架构、数据、安全、兼容或运维决策用 `new-adr`；跨功能但不改变架构边界的业务决定用 `new-decision` 登记。`accepted` 状态必须提供真实确认人，工具不会自行批准。

## 证据和发布

使用 `new-evidence` 分别创建 `development`、`e2e`、`performance`、`release` 四类 JSON 报告。报告初始为 `not_run`，只能根据真实执行填写 `commands`、`checks` 和 `result`。

```sh
python3 .daoge-docs/daoge_docs.py new-evidence \
  --root . --type e2e --environment staging \
  --commit <git-sha> --build-id <immutable-build-id>
```

四类报告完成后运行 `authority-digest`，把输出写入 release 报告的 `approval.authority_digest`，并同时填写提案 ID、确认人和晚于全部证据的确认时间。权威文档变化后必须重新提案和批准。

发布前运行：

```sh
python3 .daoge-docs/daoge_docs.py gate --root . --stage release
```

交付工作台前必须运行一次浏览器 Smoke：

```sh
python3 .daoge-docs/daoge_docs.py browser-check --root . --json
```

它会在本机临时启动 UTF-8 文档服务，验证工作台 HTML、数据 JS、Markdown 原文响应、六个视图、六类图谱和所有来源闭合；失败时不得声称工作台或 Goal 已交付。

四类报告必须全部通过并绑定同一提交和构建；发布报告必须处于发布级环境并有晚于证据的人工确认。缺少真实依赖、容量、恢复、回滚、安全或批准证据时保持阻塞。

## 产品文档浏览器

`init`、`upgrade` 和 `index` 必须生成 `docs/90-参考资料/产品文档浏览器.html` 与同目录的 `产品文档浏览器-文档数据.js`。浏览器是面向开发者的只读交付物，不是可省略的装饰页，也不能退化为文件名列表。

浏览器必须从当前 `docs` 派生完整中文正文和治理数据。主导航固定为 `工作台｜总览｜阅读｜图谱｜功能演进｜时间线` 六项，不再增加独立门禁、Diff 或个人工作一级视图。旧 `#view=governance` 跳转到工作台验证面板；旧 `#view=diff` 跳转到功能演进的最近变化。页面不得内置第二份业务结论，也不得依赖外部 CDN 或在线 API。

工作台首屏同时提供项目全景与当前执行：版本链可显示全部已注册版本和单版本浏览范围，每个可见版本必须直接列出其已登记功能 ID、名称、规格/实现/验证状态，并能进入对应功能正文；不能只显示版本摘要而把功能留在派生数据或阅读目录中。除当前执行选择器外，工作台还必须提供“项目功能浏览”，使开发者可以从所有版本选择功能并进入其时间线或正文。当前执行版本必须始终等于 `config.current_version`。浏览 V1 或历史版本不得改变当前版本的 Gate、Goal、任务包、下一步或发布判断；历史版本没有独立机器证据时显示 `unknown` 或 `not_run`，不能把规格状态或版本顺序写成已完成。执行区只展示当前上下文、带一句依据的开发判断、一个下一步主行动、最多三个最高优先级阻塞，以及规格/设计/实现/验证四段进展。开发判断和首屏阻塞只读取 Discovery、Version Ready、Feature Ready 与当前功能的 finding；Release 阻塞只能说明“当前不可发布”，必须留在验证面板，不能改写为“当前不允许开始开发”。完整 finding、门禁、测试层、证据绑定、关系明细和开发任务包放入次级面板。门禁结构信号只能显示为 `ready`、`blocked` 或 `unknown`；`passed` 只能来自实际机器证据。

总览必须呈现项目与当前版本全貌：产品全景按用户与入口、业务领域、系统与依赖三层语义组织，业务旅程和版本主链的步骤可一键回到权威来源，交付进度只能由工程落点、功能实现状态和机器证据派生。总览不得把机器哈希 ID、文档 `draft` 状态或完整关系表当作主要信息。图谱必须从结构化权威表格派生产品架构、核心流程、版本路线、数据域、交付追踪和风险热区六类关系；功能演进使用“版本主链、能力 × 版本矩阵、单里程碑详情”渐进呈现目标、前置能力、退出条件、用户变化、依赖、完成判定和兼容/迁移/废弃/替代关系；时间线、搜索和阅读功能上下文必须从全项目功能浏览目录选择具体功能，呈现其来源、当前实现、差距、门禁和后续里程碑。历史功能不得复用活动版本的 finding、Gate、任务包或证据状态；缺少独立证据时明确显示 `unknown` 或 `not_run`。缺少结构化来源时显示能力降级，不得由页面代码、标题相似度或未来规划 prose 猜测项目关系。

六类图谱必须使用各自最简单的语义呈现，不得用一张会压缩字号的通用拓扑图代替：架构看三层，流程看步骤和失败，版本看状态、前置与退出，数据看写入/只读边界，交付默认聚焦单个功能，风险看等级、影响、控制和验证。业务名称优先显示，稳定 ID 与完整关系按需展开；部分来源存在但不完整时显示 `blocked`，不得显示 `ready`。图谱按钮必须进入来源章节，当前图谱类型必须可由 URL 恢复。

不可变快照继续作为机器能力，用于 authority 变化检测、Goal 恢复和审计。人类界面只在功能演进中按需显示最近两个有效快照的新增、语义变化、废弃和删除摘要，不显示未变化对象，也不默认暴露完整 digest、hash 或逐字段 Diff。

浏览器保留全文/结构化搜索、命令面板、Markdown 渲染、章节联动、内部文档链接、阅读进度、冻结决策入口、状态恢复和响应式抽屉。阅读正文必须完整保留，章节索引只用于定位；搜索命中、图谱来源和工作台 finding 优先跳到稳定章节与行范围。阅读恢复只在当前 `content_digest` 一致时保存和恢复文档、章节与滚动位置，文档内容变化后不得恢复到旧位置。浏览器本地只保存当前视图、功能、文档、章节、受摘要保护的滚动位置、图谱模式和已展开面板；收藏、最近阅读列表和个人工作面板不属于核心能力。

工作台内的“阅读”视图负责渲染 Markdown；“打开 Markdown 原文”负责在新标签页直接显示原始 Markdown 源码；“下载 Markdown”负责保存文件，三者语义必须分开。权威来源按钮应明确选择渲染阅读或原文查看，不能用渲染页面冒充原文。直接用浏览器打开原始 Markdown 时，使用工具内置 UTF-8 服务：

```sh
python3 .daoge-docs/daoge_docs.py serve --root . --port 8877
```

该服务只允许绑定 `127.0.0.1` 或 `localhost`，并为 Markdown、HTML、JSON、JS、YAML、XML 和 SVG 显式返回 `charset=utf-8`；Markdown 原文以 `text/markdown; charset=utf-8` 返回，浏览器显示源码而不是工作台渲染结果。不要使用未声明 charset 的通用静态服务验收中文 Markdown。

阅读目录必须同时提供项目视角、按版本与原始目录三种可切换的导航；语义视图可不同于物理目录，但每个项目都必须回到一份真实文档，不能复制业务结论。版本归属只能来自 front matter `version` 或 `Vn` 路径/文件名结构；未知归属进入“项目全局”，不能从正文提及猜测。原始目录模式必须递归展示 `directories[]`；每个目录优先提供 README 或索引入口。缺少入口时必须生成可定位的 `DIRECTORY-README` finding，不能让开发者靠目录名称猜测职责。

工作台验证面板必须分别展示：Discovery、Version Ready、Feature Ready、Release 四级门禁的结构阻塞信号；静态、单元、Integration/Contract、前端、E2E、性能、安全/发布测试层；函数契约、伪代码、稳定分支与 AC 追踪；四类当前证据及提交/构建绑定。面板默认折叠，不能挤占首屏开发判断。

任何权威文档、功能、需求、E2E、版本、ADR、冻结决策或证据变化后，都要重新运行 `index`。浏览器数据中的 `source_commit` 和生成时间只记录索引运行上下文，不是权威输入的新鲜度判据；权威摘要、工程落点和证据绑定才是派生内容的校验依据。仅当索引记录的提交到当前 HEAD 之间只包含派生文件和项目内工具副本时，检查器才会忽略这两个运行元数据，避免自引用式“索引过期”；任何业务代码或权威输入路径变化仍必须重新索引。不得直接编辑浏览器 HTML、数据 JS 或派生 SVG；需要改变浏览器能力时修改 Skill 模板和生成器，再重新生成。

交付前至少验证：六个主视图可切换且没有额外一级入口；工作台首屏在一个视口内完成开发判断；总览、六类图谱、能力演进和逐功能时间线来自权威来源；验证面板不混淆结构、实现、证据和批准；旧 governance/diff 深链可达新位置；搜索可进入正文或功能时间线；Markdown 表格、代码、图片和内部链接可用；所有来源链接在当前页和新标签页均显示正确中文；原始 `.md` 响应包含 UTF-8 charset；URL hash 与本地状态可恢复；桌面布局没有遮挡；移动端六个入口完整可达，目录与章节抽屉可显式关闭，宽表可横向阅读，筛选输入不会因重绘中断。浏览器可直接离线打开；测试工具拒绝 `file://` 时，使用内置 `serve` 命令验收。

浏览器只是人类认知入口。面向编程智能体的大型任务必须从同一权威文档生成绑定 `source_commit` 和 `authority_digest` 的 Goal 清单，并遵守 Goal 执行契约；浏览器不得直接运行 Goal。工作台或 Goal 的新增能力只有在生成器、检查器和回归测试同时落地后才能标为已实现。

## 准备大型 Goal

只有目标版本和所选功能通过现有 `version-ready`、`feature-ready` 门禁，Git HEAD 可解析，权威摘要稳定，工程落点、AC、稳定分支和验证命令完整时，才能生成 `ready` Goal：

```sh
python3 .daoge-docs/daoge_docs.py prepare-goal \
  --root . --feature CODE-FR-001 --feature CODE-FR-002 \
  --objective "完成订单闭环并取得开发级机器证据"
```

默认目标版本等于 `config.current_version`。为已登记但非活动版本功能准备独立 Goal 时，必须显式绑定版本：

```sh
python3 .daoge-docs/daoge_docs.py prepare-goal \
  --root . --version V1 --feature CODE-FR-001
```

`--version` 只切换本次 Goal 的解析、门禁和任务图上下文；不会改写项目当前执行版本，不会重建工作台为历史版本，也不会把历史版本状态混入当前 Gate、任务包或发布判断。

清单保存到 `.daoge-docs/goals/<GOAL-ID>/goal-manifest.json`。同一版本切片、提交、权威摘要和功能选择必须产生相同任务 ID、顺序、依赖和授权路径；MVP、V1、V2、V3 必须使用连续但独立的 Goal。

执行或恢复前运行：

```sh
python3 .daoge-docs/daoge_docs.py goal-resume-context --root . --goal GOAL-V1-001
```

命令只在 authority digest、活动版本、工具版本、当前 HEAD、最近检查点和工作区完全一致时输出唯一下一任务。只使用返回任务的 `inputs`、`allowed_paths`、AC、稳定分支、验证命令和停止条件，不从对话历史补充范围。

完成原子任务并提交代码后立即建立检查点：

```sh
python3 .daoge-docs/daoge_docs.py goal-checkpoint \
  --root . --goal GOAL-V1-001 --task TASK-CODE-FR-001
```

检查点命令会拒绝 merge commit、未提交变化和授权范围外路径，实际执行任务验证命令，并为每次尝试保留独立机器证据。验证失败只能进入 `verification_failed`，不能产生检查点。

全部任务都有通过的检查点后运行：

```sh
python3 .daoge-docs/daoge_docs.py goal-complete --root . --goal GOAL-V1-001
```

完成命令重新生成派生文档，复验 `docs-check`、Version Ready、全部 Feature Ready 和所有指定命令，生成不可覆盖的 `completion.json` 后才进入 `completed`。开发级完成不代表允许发布。

查看状态但不改文件时使用 `goal-status --read-only`；CI 需要 stale 返回非零时再加 `--fail-on-stale`。authority digest、执行基线、活动版本、工具版本或清单外工作区变化不一致时，Goal 必须进入 `stale`。`stale` 清单禁止原地刷新；保留旧清单用于审计，从当前权威创建新 Goal ID。

安装轻量开发集成时运行：

```sh
python3 .daoge-docs/daoge_docs.py install-integrations --root .
```

该命令补充 GitHub Actions、PR 模板、VS Code Tasks 和 `AGENTS.md`。已有目标文件一律保留，不自动合并或覆盖；需要人工合并时从 `.daoge-docs/assets/templates/integrations/` 读取对应模板。

## 审计与升级

先运行确定性检查：

```sh
python3 .daoge-docs/daoge_docs.py index --root .
python3 .daoge-docs/daoge_docs.py check --root . --json
```

再人工检查脚本无法判断的业务范围、权威冲突、状态转换、失败语义和证据证明力。报告问题时先列影响正确性和发布的问题。

用户要求达到参考 `docs` 的完整能力深度时，再运行：

```sh
python3 .daoge-docs/daoge_docs.py audit --root . --json
```

`audit` 检查动态能力是否实际建立，但不代替 Ready 或 Release 门禁。对 V1-only 项目，严格 Profile 只要求“后续版本”规划空间和生成能力存在；不得为了让审计通过而编造 V2 业务承诺。

`audit` 会复用 `browser-check` 的本地 HTTP Smoke；因此审计通过同时意味着工作台资源可读取、Markdown 原文声明 UTF-8，且派生来源能够闭合。

CI 或干净环境验收使用 `ci-check`：它固定运行 `index`、`check`、工作台 Smoke 和现有 Goal 基线检查。它不会执行项目业务构建、迁移、部署或功能 AC 命令。

项目内工具落后时运行：

```sh
python3 <skill-dir>/scripts/daoge_docs.py upgrade --root <project-root> --profile strict
```

升级可以覆盖 `.daoge-docs` 中的工具和模板，但不得覆盖已有项目文档事实。

## 命令职责

```text
init              初始化 lean/standard/strict 文档体系，默认 strict
upgrade           更新项目内工具并补齐 Profile 文件
install-integrations 安装不覆盖现有配置的 CI、PR、IDE 与智能体入口
doctor            只读检查 Python、Git、shell、项目状态与技术栈候选
ci-check          重建派生文档并检查 docs、工作台与 Goal 基线
new-version       创建并可选激活版本空间
new-future-version 创建不激活的后续版本规划
new-domain        创建领域边界和功能目录
new-architecture-spec 创建生命周期、协议、接入或架构专项及示例
new-feature       创建功能主文档和必要的高风险技术设计
new-requirement   注册稳定 NFR 或 RG
new-e2e           创建 E2E 验收用例
new-adr           分配下一个 ADR ID
new-decision      登记 proposed/accepted/deprecated 冻结决策
new-task          从功能创建开发任务书
new-evidence      创建并选择机器可读证据报告
new-reference     创建带时效和可信度的非权威调研
archive           创建历史归档并指向当前替代权威
index             重建索引、风险表、追踪矩阵、实现状态、派生图表和产品文档浏览器
serve             启动仅绑定本机且显式声明 UTF-8 的只读文档服务
browser-check     对工作台、派生来源和 UTF-8 Markdown 服务执行 Smoke 验收
snapshot          创建不可变版本快照，供变更检测、Goal 恢复和审计使用
authority-digest  计算当前权威文档集合的稳定 SHA-256 摘要
prepare-goal      从通过门禁的目标版本功能生成确定性 Goal 清单；默认当前版本，显式 --version 不切换活动版本
goal-status       检查 Goal 清单防篡改、权威摘要、Git 基线和过期状态
goal-resume-context 验证恢复条件并输出唯一下一任务上下文
goal-checkpoint   验证授权路径和命令后建立原子 Git 检查点
goal-complete     复验全部任务、命令、证据和 Ready 门禁后结束 Goal
check             检查结构、链接、ID、中文规范、契约和追踪
audit             检查是否达到参考 docs 的完整能力深度
gate              执行 discovery、version-ready、feature-ready、release 门禁
```

## 完成条件

完成任何文档任务前必须：运行相关生成器和检查器；检查生成文件没有覆盖已有事实；区分错误、警告和未决业务问题；说明达到哪个门禁、证据属于哪个环境等级、哪些事项仍阻塞。不得仅因文档骨架完整就声称项目已经可开发或可发布。
