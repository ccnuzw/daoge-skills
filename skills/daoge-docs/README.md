# DAOGE Docs

> 发布级别：`Beta`。为中文软件项目提供文档驱动开发、开发执行工作台与可恢复 Goal 的完整工作流。

DAOGE Docs 是一个面向开发团队和编程智能体的 Codex Skill。它以项目内的 Markdown 文档为权威输入，建立从产品规划、版本 PRD、功能规格、技术设计，到测试、机器证据、发布门禁的一条可追溯链路；再从同一份文档派生出供开发者阅读的开发执行工作台，以及供编程智能体执行的受控 Goal 清单。

它解决的不是“多写几份文档”，而是把每个版本的范围、行为、工程落点、验证方式和证据边界固定下来，使多人协作、跨会话恢复和 MVP/V1/V2/V3 的连续迭代都有可检查的依据。

当前工具版本：`3.18.0`（基于上游 `daoge-docs-v3.13.4`，包含本地门禁、索引新鲜度、跨版本 E2E、ADR 开发授权、跨版本工作台组合层、全项目功能浏览目录、显式目标版本 Goal、并行 Goal 运行态和 stale 基线集成校验）。

## 开发执行工作台

开发执行工作台是 DAOGE Docs 面向**开发者**的主入口。它不要求开发者在几十份 Markdown 之间来回寻找信息，而是把当前版本、功能、门禁、证据、关系和演进从同一套权威文档中派生为一个可浏览的工作界面。

工作台的目标很明确：让开发者在开始实现前，能清楚回答以下问题。

1. 当前应该处理哪个功能，它的稳定功能 ID 是什么？
2. 这个功能现在能否进入开发，依据是什么，最高优先级阻塞是什么？
3. 行为、AC、设计、工程落点和验证命令分别位于哪份权威文档？
4. 该把什么上下文交给编程智能体，怎样避免它在需求和允许路径之外扩展？
5. 这个功能和当前版本、领域、需求、E2E、风险、证据及后续版本如何关联？

工作台把“项目浏览版本”和“当前执行版本”明确分开。全局与单版本浏览均会直接列出该版本的功能 ID、名称与规格/实现/验证状态，并可进入功能正文；Gate、Goal、任务包、下一步和发布资格始终只由项目配置中的当前执行版本派生。历史版本没有独立机器证据时会显示 `unknown`，不会因为规格已冻结而显示为已完成。阅读目录同时支持项目视角、按版本和原始目录，语义分组不会改写文件实际位置。

它是 Markdown 的开发者阅读层，不是第二套产品事实库。开发者从工作台理解全貌和定位来源，修改仍应回到权威 Markdown；编程智能体从 Goal 清单获取受控执行上下文，不能把工作台摘要当成唯一规格。

### 打开工作台

初始化、升级和每次 `index` 都会生成工作台及其派生数据：

```text
docs/90-参考资料/产品文档浏览器.html
docs/90-参考资料/产品文档浏览器-文档数据.js
```

推荐通过内置的 UTF-8 本地服务访问：

```bash
python3 .daoge-docs/daoge_docs.py index --root .
python3 .daoge-docs/daoge_docs.py serve --root . --port 8877
```

然后在浏览器中打开：

[http://127.0.0.1:8877/docs/90-%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99/%E4%BA%A7%E5%93%81%E6%96%87%E6%A1%A3%E6%B5%8F%E8%A7%88%E5%99%A8.html](http://127.0.0.1:8877/docs/90-%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99/%E4%BA%A7%E5%93%81%E6%96%87%E6%A1%A3%E6%B5%8F%E8%A7%88%E5%99%A8.html)

端口已被占用时，改用未占用端口。服务只允许绑定 `127.0.0.1` 或 `localhost`，不会对局域网暴露；同时会为 `.md` 返回 `text/markdown; charset=utf-8`，确保中文原文不会因缺少编码声明而乱码。

### 开发者日常路径

当开发者接到“实现某个功能”或“继续上次工作”时，推荐按下面的顺序使用工作台：

| 步骤 | 在工作台中的操作 | 得到的结果 |
| --- | --- | --- |
| 1. 选择功能 | 在“工作台”的“当前功能”下拉框按 ID 或名称选择；按领域或风险查找时使用全局搜索或时间线筛选 | 当前功能名称、稳定 ID、所属领域和开发进展 |
| 2. 先看判断 | 阅读“开发许可”“最高优先级阻塞”“规格/设计/实现/验证”四段进展 | 知道能否开始，而不是只看文档状态猜测 |
| 3. 追到来源 | 打开功能规格、finding 来源、关系与来源，或进入“阅读” | 获取完整需求、AC、设计分支、工程路径与验证命令 |
| 4. 交给 AI | 点击“复制 ID”或“复制 Goal 提示” | 得到功能定位 ID，或一段准备 Goal 的受控提示词 |
| 5. 获取任务边界 | 对已通过 Ready 门禁的功能执行 `prepare-goal`，先用 `goal-plan` 查看泳道，再运行 `goal-resume-context` | 依赖已满足的任务、`allowed_paths`、AC、分支、验证命令和停止条件 |
| 6. 实现后回看 | 完成检查点后重建索引并刷新工作台 | 用同一来源查看实现、证据、门禁和版本演进是否同步 |

	“复制 Goal 提示”生成的是**准备** Goal 的提示词。每个已登记版本功能都可复制，提示会显式带上 `--version <目标版本>`。它要求编程智能体先检查 `prepare-goal` 的结果，在 `blocked` 时停止并报告来源，在 `ready` 时先用 `goal-plan` 查看泳道，再读取一个依赖已满足的任务，并在实现前等待你的确认。它不会绕过门禁，也不会授权 AI 直接改代码，更不会切换项目当前执行版本。

### 六个视图，各自只回答一类问题

工作台避免把所有信息堆在一个页面。固定的六个视图互相链接，但各自使用最合适的阅读方式：

| 视图 | 开发者首先看什么 | 应在何时使用 |
| --- | --- | --- |
| 工作台 | 当前功能、开发判断、下一步、阻塞与四段进展 | 开始工作、恢复工作、分派给 AI 前 |
| 总览 | 用户与入口、业务领域、系统与依赖、业务旅程、版本主链 | 需要快速理解项目或当前版本全貌时 |
| 阅读 | 完整 Markdown 正文、章节索引、搜索和内部链接 | 需要确认精确规则、AC、伪代码或运行手册时 |
| 图谱 | 产品架构、核心流程、版本路线、数据域、交付追踪、风险热区 | 需要判断依赖、边界、失败路径和风险传导时 |
| 功能演进 | 版本主链、能力 × 版本矩阵、里程碑、兼容/迁移/废弃/替代关系 | 规划 MVP/V1/V2/V3 或评估变更影响时 |
| 时间线 | 一个功能的来源、当前实现、差距、门禁、证据和下一里程碑 | 跟进某个功能从规格到交付的完整状态时 |

图谱只会展示来自结构化权威表格的关系。来源不完整时，页面会显示能力降级或 `blocked`，不会根据标题或相似文字臆测依赖。URL 会保留当前视图、功能、文档、章节或图谱选择，可用于保存或分享定位链接。

### 功能 ID、开发任务包与 Goal 提示

选中功能后，工作台会在“当前功能”旁展示：

- **复制 ID**：复制如 `OMS-FR-001` 的稳定功能 ID。适合在 issue、提交、评审或对话中精确指定范围。
- **复制 Goal 提示**：复制给编程智能体的任务准备提示。提示会要求其先生成并检查 Goal，再以清单中的约束行动。
- **复制开发任务包**：仅在当前功能已有派生任务包时出现。用于向开发者或评审者展示来源、AC、分支、阻塞和禁止行为；它不是 Goal 的替代品。

推荐的协作指令类似下面这样：

```text
请为功能 OMS-FR-001 准备 DAOGE Docs 开发 Goal。
先执行 prepare-goal；若为 blocked，报告阻塞与权威来源；
若为 ready，执行 goal-plan 查看可执行泳道；再执行 goal-resume-context，可用 `--task TASK-*` 选择一个依赖已满足的任务。它只返回该任务的 inputs、allowed_paths、AC、稳定分支、验证命令和停止条件，开始实现前等待确认。
```

这比“实现用户注册功能”更可控，因为功能 ID 能定位权威文档，Goal 又会验证版本、门禁、Git 基线和范围授权。

### 阅读、原文与下载的区别

工作台提供三种不同的内容操作，不能混用：

| 操作 | 内容 | 适合做什么 |
| --- | --- | --- |
| 工作台“阅读” | 完整 Markdown 的网页渲染 | 阅读、搜索、章节定位、内部跳转和回到功能上下文 |
| “打开 Markdown 原文” | 原始 `.md` 源码 | 复制/审查源文本，确认渲染前的真实内容 |
| “下载 Markdown” | 原始文件下载 | 离线留存、编辑或交给外部工具 |

渲染阅读不会裁剪正文，章节索引只用于定位。工作台在内容摘要未变化时保存当前文档、章节和阅读位置；源文档改变后不会恢复到旧位置，以免把读者带到已经失效的上下文。

### 维护与交付检查

| 发生的变化 | 应做的操作 |
| --- | --- |
| 修改产品、版本、功能、需求、E2E、ADR、冻结决策或证据 | 编辑权威 Markdown，然后运行 `index` |
| 想修改工作台界面或派生关系能力 | 修改 Skill 的模板与生成器，不能手改项目内 HTML/数据 JS/SVG |
| 准备交付工作台或检查中文原文 | 运行 `browser-check --json` |

```bash
python3 .daoge-docs/daoge_docs.py index --root .
python3 .daoge-docs/daoge_docs.py browser-check --root . --json
```

`browser-check` 会验证工作台资源、六个视图、六类图谱、来源闭合以及 UTF-8 Markdown 原文响应。检查失败时，不能把工作台称为已完成交付。

## 目录

- [开发执行工作台](#开发执行工作台)
- [适用场景与边界](#适用场景与边界)
- [核心设计](#核心设计)
- [安装与系统要求](#安装与系统要求)
- [五分钟开始](#五分钟开始)
- [选择治理深度](#选择治理深度)
- [文档体系与权威分工](#文档体系与权威分工)
- [完整开发流程](#完整开发流程)
- [用 Goal 驱动编程智能体](#用-goal-驱动编程智能体)
- [门禁、验证与发布证据](#门禁验证与发布证据)
- [跨技术栈、Monorepo 与 CI](#跨技术栈monorepo-与-ci)
- [既有项目迁移与升级](#既有项目迁移与升级)
- [命令索引](#命令索引)
- [常见问题](#常见问题)
- [参考资料与反馈](#参考资料与反馈)

## 适用场景与边界

适合下列项目：

- 希望使用中文完成产品规划、PRD、功能规格、技术设计和测试设计的团队。
- 需要让功能需求、验收标准、代码修改范围、测试命令、运行证据和发布批准可以相互追踪的项目。
- 正在交付 MVP，且计划持续演进到 V1、V2、V3 或更高版本的产品。
- 需要把大型开发任务拆成可恢复、可审计、限定修改范围的 Goal，并交给编程智能体执行的项目。
- 包含权限、资金、数据删除、并发、外部副作用、跨系统状态、迁移、恢复或合规等高风险行为的系统。
- 单仓库、多服务或 Monorepo，需要持续明确包边界与验证范围的工程。

它并非适合所有情况：

- 单文件脚本、一次性原型或不需要持续维护的演示，通常选择 `lean`，甚至不必启用完整体系。
- 工具不能替代产品负责人、架构负责人或发布负责人的业务判断；未知规则必须显式记录为待确认，不能由模板或 AI 补写成事实。
- 文档结构完整不等于代码已完成；测试通过不等于获准发布；Goal 完成也不等于生产发布。
- 它不执行依赖安装、数据库迁移、部署或第三方服务调用，也不会根据仓库文件擅自猜测真实构建命令。

## 核心设计

DAOGE Docs 的约束来自四个分离的层次。它们必须同时存在，但绝不能互相冒充。

| 层次 | 解决的问题 | 权威载体 | 不能代表什么 |
| --- | --- | --- | --- |
| 产品与规格 | 为什么做、做什么、什么算完成 | `docs/` 中的权威 Markdown | 当前代码一定已经具备该能力 |
| 工程与实现 | 具体改哪里、如何实现和验证 | 功能规格、技术设计、源码和测试 | 已有发布批准 |
| 机器证据 | 哪个命令在什么环境、基线和构建上真实执行过 | 机器可读证据报告 | 产品范围或人工批准 |
| 人工批准 | 是否承担风险并允许进入下一阶段 | 门禁记录、冻结决策、发布报告 | 对未来变化持续有效 |

### 单一事实来源

每类事实只能有一个权威来源。比如：

- 长期用户价值和产品边界属于“产品蓝图”。
- 当前版本范围和验收边界属于当前版本 PRD/版本总览。
- 单功能的行为、AC、工程落点和验证命令属于该功能主文档。
- 高风险实现细节属于该功能的技术设计。
- 实际执行结果属于证据报告，不写回规格文档冒充实现事实。

索引、矩阵、状态页、SVG 图表和工作台数据都是从权威文档派生的视图，方便阅读但不拥有第二份业务事实。修改权威 Markdown 后必须重新运行 `index`。

### 稳定 ID 与可解释性

需求、功能、验收项、重要分支、E2E、ADR 和 Goal 都使用稳定 ID。ID 可以在文档改名、移动、版本迭代后持续被代码提交、测试、证据和工作台引用，且废弃后不能复用。

常见编号示例：

| 对象 | 示例 | 用途 |
| --- | --- | --- |
| 功能 | `CODE-FR-001` | 指向唯一功能主文档和开发任务 |
| 非功能需求 | `CODE-NFR-001` | 性能、安全、可用性等跨功能约束 |
| 业务规则 | `CODE-RG-001` | 不随单一功能改变的全局规则 |
| 验收项 | `AC-01` | 说明可观察的通过条件 |
| 设计分支 | `B01-02` | 关联伪代码、日志、测试与异常处理 |
| E2E | `CODE-E2E-001` | 连接用户旅程和需求集合 |
| Goal | `GOAL-V1-001` | 一个可恢复的开发任务切片 |

稳定 ID 降低“按名称猜范围”的风险，但不是批准的替代品。ID 指向的正文、状态、依赖、门禁和证据同样需要阅读。

## 安装与系统要求

### 系统要求

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| Python | `3.10+` | 工具主体只使用标准库 |
| Git | `2.x` | 文档初始化可不依赖 Git；Goal、检查点和提交基线必须使用 Git |
| 支持平台 | macOS、Linux、Windows 10/11 | 发布支持矩阵以三平台 CI 为准 |
| Node/npm | 仅安装 Skill 时需要 | `npx skills add` 的版本要求以安装器为准；项目内工具不依赖 Node |

Windows PowerShell 优先使用 `py -3`；如果未安装 Python Launcher，则使用已加入 `PATH` 的 `python`。下文中 macOS/Linux 的 `python3` 可对应替换。

### 安装单个 Skill

项目级安装到当前项目：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs
```

全局安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs -g
```

也可以直接指定这个 Skill 的 GitHub 路径：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-docs -a codex
```

安装完成后重启 Codex，使 Skill 被重新发现。仓库中的其他 Skill 不会因上述 `-s daoge-docs` 命令被一并安装。

### 先做只读环境诊断

在目标项目根目录执行。`doctor` 只读取环境、Git 状态和技术栈候选，不安装依赖、不构建、不跑测试、不修改项目。

```bash
# macOS / Linux
python3 <skill-dir>/scripts/daoge_docs.py doctor --root . --json

# Windows PowerShell
py -3 <skill-dir>/scripts/daoge_docs.py doctor --root . --json
```

`<skill-dir>` 指已安装的 `daoge-docs` 目录。初始化后不再依赖它，而应使用项目内锁定版本的 `.daoge-docs/daoge_docs.py`。

诊断输出分为三类：

- `error`：工具无法可靠运行，先修复环境。
- `warning`：某项可选能力不可用，例如没有 Git 时不能使用 Goal。
- `info`：平台或仓库提醒，需要开发者确认。

## 五分钟开始

以下示例在一个新项目中建立严格治理体系。请把名称和项目代码替换为真实值，项目代码一旦开始使用就不要随意改变。

```bash
python3 <skill-dir>/scripts/daoge_docs.py init \
  --root . \
  --project-name "订单管理系统" \
  --project-code OMS \
  --version V1 \
  --profile strict
```

初始化会创建 `docs/`、复制固定版本的工具到 `.daoge-docs/`，并生成基础目录、模板、索引和开发执行工作台。模板中的“待填写”不是事实，也不是通过门禁的捷径。请按下列顺序补齐内容：

1. 先完成“项目调研与事实清单”，把已证实事实、合理推断和未知项分开。
2. 填写项目说明、产品蓝图、当前版本总览和版本 PRD，明确范围、非目标、角色、成功标准和版本退出条件。
3. 创建领域、功能、需求、E2E 与必要的 ADR/冻结决策。
4. 为每个功能补齐 AC、工程落点、测试命令、分支追踪和风险设计。
5. 重建派生资料并执行检查；根据失败信息补齐真实缺口。

```bash
python3 .daoge-docs/daoge_docs.py index --root .
python3 .daoge-docs/daoge_docs.py check --root . --json
python3 .daoge-docs/daoge_docs.py gate --root . --stage discovery --json
python3 .daoge-docs/daoge_docs.py gate --root . --stage version-ready --json
```

启动本地 UTF-8 文档服务后，通过浏览器打开工作台：

```bash
python3 .daoge-docs/daoge_docs.py serve --root . --port 8877
```

访问 [http://127.0.0.1:8877/docs/90-%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99/%E4%BA%A7%E5%93%81%E6%96%87%E6%A1%A3%E6%B5%8F%E8%A7%88%E5%99%A8.html](http://127.0.0.1:8877/docs/90-%E5%8F%82%E8%80%83%E8%B5%84%E6%96%99/%E4%BA%A7%E5%93%81%E6%96%87%E6%A1%A3%E6%B5%8F%E8%A7%88%E5%99%A8.html)。端口被占用时改用未占用端口。服务仅允许绑定 `127.0.0.1` 或 `localhost`，不会暴露给局域网。

## 选择治理深度

初始化时通过 `--profile` 选择文档体系深度。三种 Profile 共享“单一事实来源、稳定 ID、检查和索引”的原则，区别在所需治理链路的完整程度。

| Profile | 适用项目 | 包含重点 | 选择建议 |
| --- | --- | --- | --- |
| `lean` | 小型、低风险、单团队项目 | 项目、版本、功能、架构、测试、发布、ADR 主链路 | 先快速建立规范，后续可以升级 |
| `standard` | 多模块产品或多人团队 | 增加产品蓝图、版本 PRD、领域边界、数据、OpenAPI、安全和开发流程 | 一般业务系统的默认选择 |
| `strict` | 平台、资金、安全、外部服务、合规或高稳定性系统 | 完整产品/版本/功能/架构/E2E/性能/恢复/决策/证据链路 | 需要完整对标规范或准备用 Goal 执行大型任务时选择 |

`strict` 指治理深度和追踪能力完整，不代表复制其他项目的业务结论。它会产生更多待补齐的权威文档，因此适合在项目早期或重大版本启动阶段采用。

## 文档体系与权威分工

`strict` Profile 的完整目录会随版本、领域和功能增长。下列是核心结构及其职责；每个目录都有 README 或索引入口，用于说明权威分工、阅读路径和维护触发条件。

```text
docs/
├── README.md                           # 文档中心：权威层级与全局阅读顺序
├── 01-项目概览/                        # 项目目标、调研事实、工程与协作环境
├── 02-产品与版本/                      # 产品蓝图、路线图、版本 PRD 与门禁
├── 03-功能规格/                        # 领域、功能主文档、技术设计、需求注册
├── 04-技术架构/                        # 服务边界、数据、接口、专项架构
├── 05-测试与质量/                      # 测试策略、E2E、性能、安全与执行手册
├── 06-决策记录/                        # ADR、冻结决策和替代关系
├── 07-发布与运维/                      # 部署、回滚、恢复和发布检查
├── 08-证据与归档/                      # 机器证据报告与历史归档
└── 90-参考资料/                        # 调研资料与派生的开发执行工作台
```

### 哪份文档回答哪个问题

| 问题 | 应阅读的权威文档 | 不应从哪里推断 |
| --- | --- | --- |
| 为什么做、服务谁、成功是什么 | 项目说明、产品蓝图 | 代码目录或旧测试名称 |
| 当前版本做什么、不做什么、何时退出 | 当前版本总览、当前版本产品需求、版本路线图 | 后续版本规划或 issue 标题 |
| 某功能的行为与异常是什么 | 功能主文档、关联需求和业务规则 | 工作台摘要或聊天记录 |
| 可以改哪些路径、如何验证 | 功能主文档的工程落点与 AC | 技术栈候选建议 |
| 高风险操作的事务、幂等与恢复语义 | 高风险技术设计、ADR、恢复手册 | 简化伪代码或实现猜测 |
| 真实运行过什么、结果如何 | 当前机器证据报告 | “已测试”文字说明 |
| 是否能开始开发或发布 | 对应门禁和人工批准 | 文档数量、状态标签或单项测试 |

### 文档维护规则

- 只在权威文档中修改事实；不要直接编辑 `实现状态`、索引、矩阵、浏览器 HTML、数据 JS 或派生 SVG。
- 每次修改产品、版本、功能、需求、E2E、ADR、冻结决策或证据后，运行 `index`；派生物由工具重新生成。
- 新建功能前先新建领域。领域必须写清职责、数据所有权、上下游契约、禁止依赖和不变量。
- 不确定的事项写成“待确认”，同时标明负责人、截止时间和阻塞的门禁阶段。
- 归档不等于删除历史。使用 `archive` 标明旧权威来源、替代文档和归档原因。

## 完整开发流程

下面的流程适用于一个从调研进入长期迭代的项目。不同规模可裁剪步骤，但不要跳过与风险相称的门禁和证据。

### 1. 调研与产品规划

先检查现有仓库、代码、迁移、接口、测试、部署和已有文档，建立“已证实事实、合理推断、未知项”三栏事实清单。然后完成：

- 项目说明：问题、目标用户、范围、非目标、成功指标和术语。
- 产品蓝图：长期价值、核心概念、角色、全局规则和长期边界。
- 跨版本能力与旅程基线：稳定能力概念、核心旅程和不可破坏的跨版本不变量。
- 版本路线图与当前版本 PRD：当前目标、范围、依赖、里程碑、退出条件和未来版本隔离。
- 领域边界：每个领域的职责、数据所有权、上游/下游契约与禁止依赖。

在这个阶段，所有不能从材料中证实的规则都应保留为待确认项。不要为了使 `check` 变绿而填写虚构的业务结论。

### 2. 创建版本、领域与功能

建立后续版本规划空间，但不应提前激活未来版本：

```bash
# 新建并切换到 V2
python3 .daoge-docs/daoge_docs.py new-version --root . --version V2

# 只建立未来规划空间，不切换活动版本
python3 .daoge-docs/daoge_docs.py new-version --root . --version V3 --no-activate
python3 .daoge-docs/daoge_docs.py new-future-version --root . --version V4 --name "生态开放"

# 先创建领域，再创建功能
python3 .daoge-docs/daoge_docs.py new-domain --root . --name "身份与权限"
python3 .daoge-docs/daoge_docs.py new-feature \
  --root . --number 1 --name "用户注册" --domain "身份与权限" \
  --risk high --risk-reason "密码与账户所有权" \
  --keywords "注册,邮箱,密码" --requirements "OMS-NFR-001"
```

功能主文档应当明确回答：用户问题、范围与非目标、前置条件、主路径、失败路径、AC、相关需求、工程落点、允许/禁止修改路径、测试命令和完成证据。

`new-future-version` 会建立 `后续版本/V4-生态开放/V4-版本总览.md` 作为该版本唯一正式规划入口，并建立目录导航。它仅保存候选范围，不能代替路线图登记、稳定需求或开发授权；准备实现时仍须以 `new-version` 创建独立版本空间。

需要独立登记的非功能需求或全局规则，可使用：

```bash
python3 .daoge-docs/daoge_docs.py new-requirement \
  --root . --type NFR --name "注册接口响应时间" \
  --source "02-产品与版本/当前版本/V1-产品需求.md" \
  --verification "staging 性能证据报告"
```

FR 由功能文档产生；`new-requirement` 只用于 NFR/RG。`--source` 必须是项目 `docs/` 中实际存在的权威文件。

### 3. 把规格写成可实现契约

标准风险功能至少应具备：

- 可观察、可验证的 AC；每个 AC 映射测试层、目标资产、执行命令和证据入口。
- 有输入、守卫、稳定分支、事务边界、外部副作用和返回结果的伪代码。
- 从 AC 到 `Bxx-NN` 分支的追踪，以及相应的日志、指标、测试或 E2E 关联。

出现下列任一情况通常应使用 `--risk high`，并补充独立技术设计：资金、权限、秘密、并发、删除、外部副作用、动态制品、跨系统状态、未知外部结果、迁移或恢复。

高风险技术设计需要明确函数签名、前后置条件、不变量、事务、并发、幂等、外部调用、重试、补偿、迁移与回滚。遇到语义冲突，应先记录 ADR 或冻结决策，而不是让实现自行选择。

### 4. E2E、决策、任务书与证据

将需求连接到真实用户旅程：

```bash
python3 .daoge-docs/daoge_docs.py new-e2e \
  --root . --number 1 --name "新用户完成注册" \
  --requirements "OMS-FR-001,OMS-NFR-001" --environment-level staging
```

长期架构、数据、安全、兼容和运维决策使用 ADR；跨功能但不改变架构边界的业务决定使用冻结决策。任何 `accepted` 状态都必须有真实确认人，工具不会代为批准。

功能通过 Ready 门禁后，可以创建人类开发任务书：

```bash
python3 .daoge-docs/daoge_docs.py new-task \
  --root . --feature OMS-FR-001 --name "实现注册提交接口"
```

真实执行后才可创建和填写机器证据。报告初始状态是 `not_run`，不能把计划命令当作已运行证据：

```bash
python3 .daoge-docs/daoge_docs.py new-evidence \
  --root . --type development --environment ci \
  --commit <git-sha> --build-id <immutable-build-id>
```

### 4.1 项目输入、约束与证据资产

跨会话仍以 `docs/01-项目概览/项目输入与约束注册表.json` 为机器权威，以生成的 `项目输入与约束总账.md` 为阅读入口。注册表当前为 `schema_version: 2`，除输入、约束和证据资产外，还保存规格覆盖与权威边界。先登记来源，再决定是否确认：

```bash
python3 .daoge-docs/daoge_docs.py record-input \
  --root . --title "利益相关方输入" --summary "可复用的原始陈述" \
  --source-kind stakeholder_statement --source-ref "会议记录/2026-01-01"

python3 .daoge-docs/daoge_docs.py record-constraint \
  --root . --title "必须满足的约束" --kind hard_requirement \
  --value "可执行且可验证的约束" --source-input INPUT-001 \
  --status confirmed --confirmed-by "确认人"

python3 .daoge-docs/daoge_docs.py add-evidence-asset \
  --root . --title "原始访谈材料" --kind document \
  --source-ref "会议记录/2026-01-01" --missing-reason "原始文件尚未取得"
```

`record-input` 的 `observed` 只是观察，`record-constraint` 的 `reference_observation` 不能自动成为验收条件。可归档资产会复制到 `docs/90-参考资料/证据资产/` 并保存 SHA-256；不可得材料必须登记缺失原因。新会话可运行 `handoff --root .` 获取摘要，但不得把摘要当作新的权威事实。

确认到来时保留原始 ID，避免一项事实出现多个互相竞争的记录：

```bash
python3 .daoge-docs/daoge_docs.py update-input \
  --root . --id INPUT-001 --status confirmed --confirmed-by "确认人"

python3 .daoge-docs/daoge_docs.py update-constraint \
  --root . --id CONSTRAINT-001 --status confirmed --confirmed-by "确认人"

python3 .daoge-docs/daoge_docs.py resolve-evidence-asset \
  --root . --id ASSET-001 --file <local-file> --source-ref "实际材料来源"
```

确认事实必须有可检查的规格归宿。映射当前范围时必须指向当前版本的稳定需求；映射未来范围时只能指向由 `new-future-version` 创建的正式规划入口。拒绝、替代或不适用必须留下确认人与处理依据：

```bash
python3 .daoge-docs/daoge_docs.py map-spec-coverage \
  --root . --source INPUT-001 --disposition current_scope --version V1 \
  --requirements OMS-NFR-001 --confirmed-by "产品负责人"

python3 .daoge-docs/daoge_docs.py map-spec-coverage \
  --root . --source CONSTRAINT-001 --disposition future_candidate --version V2 \
  --confirmed-by "产品负责人"
```

要把单一事实来源纳入机器检查时，登记范围与事实类型。一个范围键加事实类型只能有一条 `active` 记录；替代时必须显式保留旧记录：

```bash
python3 .daoge-docs/daoge_docs.py register-authority \
  --root . --scope version-scope.v1 --fact-type version_scope \
  --source docs/02-产品与版本/当前版本/V1-版本总览.md --owner "产品负责人"
```

### 5. 变更回流与版本演进

功能需求变化时先更新权威规格，再重新生成索引、检查门禁并重新准备受影响的 Goal。不要通过修改已生成的 Goal 清单或工作台数据“追上”规格变化。

对于版本演进：

- MVP、V1、V2、V3 使用连续但独立的版本空间和 Goal。
- 功能改名或迁移时保留稳定 ID，并在演进文档中记录替代、兼容或废弃关系。
- 未来规划放入“后续版本”，不能污染当前版本的范围或 Ready 门禁。
- 权威事实改变后，旧 Goal 应保留审计记录，并按新基线创建新的 Goal，而不是原地改写。

## 用 Goal 驱动编程智能体

Goal 是从已经冻结的权威文档中生成的、带 Git 基线与权威摘要的任务清单。它的目的不是替编程智能体猜需求，而是把一个大型任务切成可解释、可恢复、限制修改范围的原子任务。

### 生成前提

只有同时满足以下条件时，`prepare-goal` 才应产生 `ready` Goal：

- 当前版本已经通过 `version-ready`。
- 每个所选功能已经通过 `feature-ready`。
- Git HEAD 可解析，工作树和工具版本满足基线要求。
- 权威摘要稳定，功能的工程落点、AC、稳定分支和验证命令完整。

```bash
python3 .daoge-docs/daoge_docs.py prepare-goal \
  --root . --feature OMS-FR-001 --feature OMS-FR-002 \
  --objective "完成订单创建与支付前校验，并取得开发级机器证据"
```

生成物位于：

```text
.daoge-docs/goals/<GOAL-ID>/goal-manifest.json
```

同一版本切片、提交、权威摘要和功能选择会产生同样的任务 ID、依赖顺序和授权路径。Goal 可由工作台的功能卡片复制提示，也可直接把功能 ID 交给编程智能体，让它先读取此清单。

### 编程智能体执行协议

每次开始或恢复时先请求唯一的下一任务：

```bash
python3 .daoge-docs/daoge_docs.py goal-resume-context \
  --root . --goal GOAL-V1-001
```

编程智能体只能依据输出任务中的 `inputs`、`allowed_paths`、AC、稳定分支、验证命令和停止条件实施，不应从对话历史或仓库猜测扩大范围。

完成一个原子任务后，先提交代码，再创建检查点：

```bash
python3 .daoge-docs/daoge_docs.py goal-checkpoint \
  --root . --goal GOAL-V1-001 --task TASK-OMS-FR-001
```

检查点会拒绝 merge commit、未提交变更和授权范围外路径，并执行该任务声明的验证命令。验证失败只能成为 `verification_failed`，不能伪造检查点。

全部任务都有通过检查点后结束 Goal：

```bash
python3 .daoge-docs/daoge_docs.py goal-complete \
  --root . --goal GOAL-V1-001
```

结束时工具会重新生成派生文档、复验 `check`、版本和功能 Ready 门禁及清单内命令，然后创建不可覆盖的 `completion.json`。这是开发级完成，不等于生产发布批准。

### Goal 状态与恢复

| 状态 | 含义 | 下一步 |
| --- | --- | --- |
| `ready` | 前置门禁、基线和任务清单满足执行条件 | 用 `goal-plan` 查看可执行泳道，再用 `goal-resume-context --task TASK-*` 获取任务 |
| `blocked` | 规格、追踪、门禁或环境前置不完整 | 回到权威文档或环境处理阻塞项 |
| `verification_failed` | 已执行任务验证失败 | 修复实现或规格，再按协议验证；不可建立通过检查点 |
| `stale` | 权威摘要、Git 基线、活动版本、工具版本或工作区状态已变化 | 保留旧清单审计，从当前权威重新准备新 Goal |
| `completed` | 全部任务和复验完成 | 继续准备下一 Goal，或进入发布证据与 Release 门禁 |

只读检查状态：

```bash
python3 .daoge-docs/daoge_docs.py goal-status \
  --root . --goal GOAL-V1-001
```

`goal-status` 默认只读，不会改写清单；只有明确需要保存本次派生运行状态时才加 `--persist`。在 CI 中希望检测到 `stale` 就失败时，加 `--fail-on-stale`。不要原地刷新或手改旧 Goal 清单，因为那会破坏审计链。

## 门禁、验证与发布证据

门禁不是“文档有没有写完”的装饰状态，而是进入下一阶段前的结构化阻断判断。DAOGE Docs 将结构、实现、机器证据和人工批准分开显示。

| 门禁 | 何时执行 | 核心问题 |
| --- | --- | --- |
| `discovery` | 调研完成后 | 已证实事实、未知项、风险和外部约束是否可追溯 |
| `version-ready` | 开始版本实现前 | 范围、需求、架构、测试、发布准备和决策是否闭环 |
| `feature-ready` | 开始单功能实现前 | 该功能的规格、AC、设计、分支追踪、工程落点和验证是否足够 |
| `release` | 发布前 | 四类真实证据、构建绑定、恢复/回滚和人工批准是否完整 |

```bash
python3 .daoge-docs/daoge_docs.py gate --root . --stage discovery --json
python3 .daoge-docs/daoge_docs.py gate --root . --stage version-ready --json
python3 .daoge-docs/daoge_docs.py gate --root . --stage feature-ready --feature OMS-FR-001 --json
python3 .daoge-docs/daoge_docs.py gate --root . --stage release --json
```

### 测试与证据纪律

测试策略要明确静态检查、单元、Integration/Contract、前端、E2E、性能、安全和发布测试各自验证什么。每个重要风险应能追到失败注入、副作用断言和最低证据。

发布级证据分为四类：

- `development`：开发、静态或单元/集成层的真实执行证据。
- `e2e`：真实用户旅程、环境与最终业务副作用的证据。
- `performance`：批准的负载 Profile、阈值、资源边界和恢复场景证据。
- `release`：不可变构建、部署/回滚/恢复、批准摘要和发布环境证据。

证据必须绑定实际命令、退出码、环境、提交、构建、时间和文件路径。`not_run`、`skipped`、`environment_failed`、缺失副作用断言或失败后覆盖报告，都不能作为对应门禁的通过依据。

证据齐备后计算权威摘要，并将其与提案、确认人和晚于全部证据的确认时间写入发布记录：

```bash
python3 .daoge-docs/daoge_docs.py authority-digest --root .
python3 .daoge-docs/daoge_docs.py gate --root . --stage release --json
```

任何权威文档变化都将使原批准失效，需要重新提案和确认。

## 跨技术栈、Monorepo 与 CI

### 技术栈发现的边界

`doctor --json` 可以从仓库文件中识别 Node/TypeScript、Python、Go、Rust、Java/Maven、Gradle、.NET、Ruby、PHP 与常见 Monorepo 标志，并提供候选验证命令。

候选仅是建议，不是已经确认、也不会被自动执行。真实命令必须由项目权威文档、功能 AC、既有 CI 或人工确认冻结下来，包括工作目录、受影响包、超时、预期退出码和环境前提。

例如，看到 `package.json` 只能说明可能存在 Node 项目，不能说明应执行哪个包管理器、哪个 workspace、哪一个 `test` 脚本，更不能说明命令已经通过。

### Monorepo 规则

- 每个业务包、服务和共享库都应有明确所有权与目录入口。
- 单个 Goal 的 `allowed_paths` 必须收敛到实际包、服务或共享契约文件，不能因仓库是 Monorepo 就授权整个仓库。
- 跨包 API、共享 schema、迁移或发布编排必须显式写出依赖顺序和集成任务。
- workspace、lockfile 或公共生成制品的变更必须说明影响、兼容策略和回滚方式。

### 安装协作集成

为目标项目补充 GitHub Actions、PR 模板、VS Code Tasks 和智能体入口：

```bash
python3 .daoge-docs/daoge_docs.py install-integrations --root .
```

可以使用 `--target github`、`--target vscode` 或 `--target agents` 只安装其中一类。已有目标文件会被保留，不会自动合并或覆盖；需要人工合并时，请从 `.daoge-docs/assets/templates/integrations/` 读取对应模板。

执行适合 CI 的综合检查：

```bash
python3 .daoge-docs/daoge_docs.py ci-check --root . --json
```

DAOGE Docs 的发布 CI 覆盖 Ubuntu、macOS、Windows 和 Python 3.10/3.12。目标项目的业务测试仍应由该项目自己的权威命令和 CI 配置负责。

## 既有项目迁移与升级

### 迁移已有 `docs/`

不要直接用新模板覆盖已有文档。建议先执行 `doctor`，阅读现有 docs、代码、测试和发布配置，然后用 `--merge` 只补齐缺失骨架：

```bash
python3 <skill-dir>/scripts/daoge_docs.py init \
  --root . \
  --project-name "已有项目名称" \
  --project-code LEGACY \
  --version V1 \
  --profile strict \
  --merge
```

迁移过程应分阶段进行：

1. 建立事实清单，标记每项现有文档是权威、参考、过期还是未知。
2. 确定每类事实唯一的权威来源，必要时使用 `archive` 记录旧文档与替代关系。
3. 从项目/版本主链开始，再迁移领域、功能、需求、测试、决策和证据；不要一次性把所有旧材料改成“已通过”。
4. 每个阶段运行 `index`、`check` 和相关门禁，按 finding 修复真实缺口。
5. 迁移完成后再生成 Goal，不要为未冻结的历史需求创建执行清单。

### 升级项目内工具

每个初始化项目在 `.daoge-docs/` 保存工具与模板副本，确保项目在未来仍能以相同规则生成资料。升级只更新工具和模板，不应重写项目事实：

```bash
python3 <skill-dir>/scripts/daoge_docs.py upgrade --root . --profile strict
python3 .daoge-docs/daoge_docs.py index --root .
python3 .daoge-docs/daoge_docs.py check --root . --json
python3 .daoge-docs/daoge_docs.py ci-check --root . --json
```

升级引起 `tool_version` 改变时，未完成 Goal 会进入 `stale`，必须从当前权威文档重新准备。已完成 Goal 保留为历史审计材料，不会被改写。

## 命令索引

下表使用项目内固定工具路径。所有命令均可通过 `--help` 查看完整参数。

```bash
python3 .daoge-docs/daoge_docs.py <command> --help
```

| 类别 | 命令 | 用途 |
| --- | --- | --- |
| 初始化 | `init` | 初始化项目 docs、工具副本和派生工作台 |
| 初始化 | `upgrade` | 升级项目内工具与模板，保留项目事实 |
| 初始化 | `install-integrations` | 补充 CI、PR、VS Code 和智能体入口，不覆盖现有文件 |
| 结构 | `new-version` | 创建新版本并可切换活动版本 |
| 结构 | `new-future-version` | 创建未激活的后续版本正式规划入口和目录导航 |
| 结构 | `new-domain` | 创建领域说明和功能目录 |
| 结构 | `new-architecture-spec` | 创建生命周期、协议、接入或扩展类架构专项 |
| 规格 | `new-feature` | 创建功能主文档和必要的高风险技术设计 |
| 规格 | `new-requirement` | 注册稳定 NFR 或 RG |
| 规格 | `new-e2e` | 创建 E2E 验收用例并关联需求 |
| 决策 | `new-adr` | 创建下一份 ADR |
| 决策 | `new-decision` | 登记冻结决策；不会自动批准 |
| 协作 | `new-task` | 从已冻结功能创建开发任务书 |
| 证据 | `new-evidence` | 新建 development/E2E/performance/release 机器证据报告 |
| 资料 | `new-reference` | 记录非权威调研或外部资料 |
| 事实 | `record-input` | 登记可追溯的项目输入 |
| 事实 | `record-constraint` | 分类约束并校验确认链 |
| 事实 | `update-input` / `update-constraint` | 保留稳定 ID 更新确认状态 |
| 证据资产 | `add-evidence-asset` | 归档材料或登记缺失来源 |
| 证据资产 | `resolve-evidence-asset` | 补齐原证据资产并校验摘要 |
| 规格治理 | `map-spec-coverage` | 映射确认输入或硬约束到当前规格、后续规划或关闭结论 |
| 规格治理 | `register-authority` | 登记唯一 active 权威来源并显式保留替代链 |
| 协作 | `handoff` | 输出跨会话恢复摘要，包括覆盖与权威边界 |
| 资料 | `archive` | 归档旧资料并记录替代权威 |
| 派生 | `index` | 重建索引、矩阵、状态页、图表和工作台 |
| 诊断 | `doctor` | 只读检查环境、Git 状态和技术栈候选 |
| 诊断 | `check` | 检查结构、链接、ID、中文规范和追踪关系 |
| 诊断 | `audit` | 审计是否达到完整 docs 能力深度；不替代门禁 |
| 诊断 | `ci-check` | 重建派生物并检查 docs、工作台与 Goal 基线 |
| 工作台 | `serve` | 启动只绑定本机、显式 UTF-8 的只读文档服务 |
| 工作台 | `browser-check` | 验证工作台、来源闭合、视图和 UTF-8 原文响应 |
| 权威性 | `snapshot` | 创建不可变版本快照，供变更检测和审计使用 |
| 权威性 | `authority-digest` | 计算当前权威集合的稳定 SHA-256 摘要 |
| Goal | `prepare-goal` | 从通过门禁的功能生成确定性 Goal 清单 |
| Goal | `goal-status` | 默认只读评估 Goal 基线、权威摘要和过期状态；`--persist` 才回写 |
| Goal | `goal-plan` / `goal-resume-context` | 查看泳道运行态，并在依赖满足时获取指定任务上下文 |
| Goal | `goal-checkpoint` | 执行任务验证并建立受控 Git 检查点 |
| Goal | `goal-complete` | 复验任务、命令和门禁，结束开发级 Goal |
| 门禁 | `gate` | 执行 discovery、version-ready、feature-ready 或 release 门禁 |

## 常见问题

### 为什么 `check` 或门禁失败，明明文档已经生成？

生成的是结构和模板，不是项目事实。失败通常意味着仍有占位、缺失的稳定 ID、链接失效、需求追踪缺口、尚未完成的 AC/分支/验证声明，或需要人工确认的高风险决策。按 finding 回到对应权威文档修复，不要直接修改派生索引。

### 为什么不让 AI 直接从产品需求开始写代码？

产品需求通常无法完整表达工程落点、允许路径、错误语义、事务/幂等、测试命令和停止条件。Goal 将这些已冻结内容封装为受控任务，能够显著降低范围漂移并支持中断后恢复；但仍不能凭空解决未知业务规则、不可用的第三方环境或未批准的风险。

### 可以只告诉编程智能体一个功能 ID 吗？

可以作为入口，但推荐流程是：先在工作台定位功能名称和 ID，确认其 `feature-ready`，再执行 `prepare-goal`，让智能体以 Goal 清单输出的唯一任务上下文为准。功能 ID 解决定位问题，Goal 解决基线、范围和恢复问题。

### 原始 Markdown 为什么直接打开是乱码？

某些静态服务不会为 `.md` 明确声明 UTF-8。使用 `daoge_docs.py serve` 后，Markdown 会以 `text/markdown; charset=utf-8` 返回。工作台的渲染阅读、原文查看和下载是三个不同操作，不应相互替代。

### 工作台能否直接编辑文档？

不能。工作台是从 Markdown 生成的只读开发者视图，避免人类界面与源文档形成两个事实源。请编辑权威 Markdown，再运行 `index`。

### `doctor` 给出的建议命令是否可以直接放到 CI？

不可以。它只根据文件存在性提供候选。必须由项目负责人确认包管理器、工作目录、版本、环境和预期结果，再将真实命令写入工程环境文档、功能 AC 和项目 CI。

### 能否在没有 Git 的目录里使用？

可以完成多数文档工作、索引和工作台；但 Goal 的 Git 基线、检查点和提交绑定依赖 Git，因此不能在无 Git 的前提下获得可恢复 Goal 的完整保障。

### `stale` Goal 可以直接改成 `ready` 吗？

不可以。`stale` 说明权威摘要、版本、工具、Git 基线或工作区状态已变化。应保留旧清单供审计，并在当前权威文档基础上创建一个新的 Goal。

## 参考资料与反馈

深入使用时，以下文档分别给出实现契约和方法细节：

- [Skill 执行规范](./SKILL.md)：适用于 Codex 的完整治理规则和命令语义。
- [项目适配方法](./references/adaptation.md)：新项目与既有项目的调研和落地方式。
- [方法论与权威模型](./references/methodology.md)：单一事实来源、状态与冲突处理。
- [风险分级](./references/risk-classification.md)：何时需要高风险技术设计。
- [证据与门禁](./references/evidence-and-gates.md)：测试、证据、发布和批准的严格边界。
- [开发执行工作台 PRD](./references/developer-workbench-prd.md)：面向开发者的六视图产品设计。
- [工作台数据契约](./references/developer-workbench-data-contract.md)：派生数据、来源与兼容规则。
- [Goal 执行契约](./references/agent-goal-execution-contract.md)：大型任务准备、恢复、检查点和完成语义。
- [兼容性与安装契约](./references/compatibility.md)：平台支持、升级边界和发布标准。
- [技术栈适配契约](./references/stack-adapters.md)：候选发现和命令冻结规则。

项目贡献规范见 [CONTRIBUTING.md](../../CONTRIBUTING.md)，安全问题请按 [SECURITY.md](../../SECURITY.md) 的私密报告方式提交，版本变更见 [CHANGELOG.md](../../CHANGELOG.md)。
