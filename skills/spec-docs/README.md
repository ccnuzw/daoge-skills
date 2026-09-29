# spec-docs

> 版本：`1.9.0`（已发布）。面向中文软件项目的可移植文档驱动开发 Skill。

`spec-docs` 用 Markdown 文档、稳定 ID、结构检查和交付证据门禁，把软件项目从产品范围推进到功能实现和发布验收。它会从版本路线图检查每个规划版本是否有独立主文档，避免 V3/V6 之类的版本只出现在聚合索引或零散功能文档中。它适合希望直接维护项目文档、让 AI 按明确规格工作、并且能在交接或发布前检查证据链的个人和团队。

它提供的是一套**文档规范 + 模板骨架 + 事实注册表 + Node.js 检查脚本 + 增量变更分析 + 任务上下文包 + 治理参考**，不绑定特定语言、框架、数据库或部署平台，也不生成独立的产品工作台。

## 它解决什么问题

软件项目常见的断链包括：

- 版本范围、功能需求和代码实现各写一套，开发过程中不断猜测真实口径。
- 需求没有稳定编号，功能、接口、测试和发布证据无法互相追踪。
- 接口字段、错误码、状态机或金额单位在不同文档中重复定义，最终发生冲突。
- 文档写了“已实现”，但只有静态检查或本地 mock 结果，没有真实验收证据。
- 项目换人或 AI 会话中断后，新参与者找不到当前版本、功能入口、阻塞项和验证命令。

`spec-docs` 将这些信息组织成一条追踪链：

```text
稳定需求 ID
  → 功能主文档
    → 技术设计分支
      → 验收标准 AC
        → 测试层级 / 目标资产 / 命令
          → 日期 / 环境 / 提交 / 结果 / 证据
            → E2E 与发布门禁
```

写蓝图或版本 PRD 时，先用[产品规格指南](references/product-spec.md)收集角色、场景、成功与失败路径，再填写模板。蓝图应能评审长期场景、能力与指标；版本 PRD 应能评审本版旅程、页面状态和验收。产品文档引用功能 ID、E2E 和权威契约，避免复制接口字段与数据规则。

进入 SDD 开发前，用[开发输入完整度指南](references/sdd-readiness.md)逐条审查本版功能 AC、公共接口操作、关键数据不变量和 E2E 独立用例。`check-docs --strict` 检查结构，`review-docs` 检查规格闭环；两者通过仍不代表业务决策正确，也不代表实现已通过测试。

## 适合与不适合

适合以下场景：

- 从零建立项目的 `docs/` 文档体系。
- 整理已经存在但互相重复或过时的项目文档。
- 编写产品蓝图、版本 PRD、功能规格、技术设计和 ADR。
- 建立需求编号、功能索引、追踪矩阵和 AC 测试映射。
- 核查“文档要求是否被代码和测试满足”，并将结论写回实现状态。
- 在发布前检查报告、manifest、提交、权威文档摘要和审批是否完整绑定。
- 以 `Vx-CS-NNN` 记录既有功能的增量变更，并只读分析影响资产和 policy 适配建议。
- 为个人项目、小团队项目或高风险平台项目按规模选择不同文档档位。
- 用统一的机器状态和事实入口为 AI/开发者生成按切片收敛的任务上下文。
- 通过统一工作流入口生成任务包、运行规格审查和阶段门禁。

它不负责：

- 编写或修改业务代码。
- 自动推断未知业务规则。
- 执行业务测试、压测、部署或恢复演练。
- 代替产品、技术或发布负责人作出业务决策。
- 把本地 mock 结果升级成 staging 或生产结论。

## 与 daoge-docs 的关系

同一仓库里的 `daoge-docs` 和 `spec-docs` 都支持文档驱动开发，但目标不同：

| 选择 | 适合情况 | 主要产物 |
| --- | --- | --- |
| `spec-docs` | 需要可复制的 Markdown 规范、模板、结构检查、SDD 就绪审查和证据门禁 | `docs/`、规格模板、`check-docs`、`review-docs`、`docs-gate` |
| `daoge-docs` | 需要完整的项目文档治理、开发执行工作台、Goal 输入和跨版本执行流程 | 项目文档、开发者工作台、Goal、项目级门禁与执行数据 |

两者不共享项目状态，也不会自动互相安装。一个项目可以只使用其中一个；如果团队已经采用 `daoge-docs` 的工作台和 Goal 流程，不需要为了使用它再安装 `spec-docs`。

## 安装

### 安装固定版本

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/spec-docs-v1.9.0/skills/spec-docs -a codex
```

该命令安装 GitHub 已发布的 `spec-docs-v1.9.0` 标签。安装完成后重启 Codex，使宿主重新加载 Skill registry。

### 安装仓库当前版本

如果希望跟随 `main` 分支更新，可以安装仓库当前源码：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s spec-docs
```

也可以明确指定分支路径：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/spec-docs -a codex
```

这两种方式都跟随 `main` 分支更新，不等同于固定版本。

### 运行时要求

- 需要 Node.js 来运行初始化器、结构检查器、门禁和自测脚本。
- Skill 本身不要求安装项目框架、数据库或额外 npm 依赖。
- 生成到项目内的脚本是项目自己的副本，可以纳入 Git 和 CI。

### 增量变更工具

```bash
node scripts/change-impact.mjs --dir . --slice V1-CS-001
node scripts/change-impact.mjs --dir . --feature V1-FR-001
node scripts/policy-calibrate.mjs --dir .
node scripts/context-pack.mjs --dir . --slice V1-core
node scripts/traceability-report.mjs --dir .
node scripts/evidence-freshness.mjs --dir .
node scripts/spec-diff.mjs --dir . --version V1
```

以上命令只读项目文件并输出 JSON；校准报告不会自动修改 policy。

`context-pack` 只读取 `docs-facts.json` 并输出任务入口，不复制权威规则，也不会修改文档、policy 或注册表。新项目默认生成注册表模板但保持 `facts.enabled=false`；完成初始登记后再启用严格检查。

在 `docs-facts.json` 中维护 `relations` 后，`change-impact` 会沿显式关系图输出 `graph.paths`，并继续保留旧项目的文本兼容分析。`traceability-report` 用于发现坏端点、孤立事实、缺少切片或权威来源的条目；`--strict` 才会将覆盖率和关系错误作为非零退出。

`evidence-freshness` 检查事实/切片引用的验证证据是否存在、通过、绑定源码提交并处于 freshness 窗口内；失效结果会沿事实关系图输出 `affected` 节点。关系图和追踪报告已在 `v1.8.0` 收口，证据新鲜度能力作为 `v1.9.0` 的增量增强保留。

`spec-diff` 对比 `.spec-docs/baselines/<version>.json` 与当前事实注册表，分类事实、切片、状态和关系变化，并输出受影响切片与治理回写清单。首次使用显式运行 `node scripts/spec-diff.mjs --write-baseline` 冻结基线。

### 统一工作流与任务包

推荐从 `spec-docs.mjs` 进入日常任务：

```bash
node scripts/spec-docs.mjs init --profile lite --target /absolute/project
node scripts/spec-docs.mjs status --dir /absolute/project
node scripts/spec-docs.mjs task --feature V1-FR-001 --phase planning
node scripts/spec-docs.mjs contracts --dir /absolute/project --json
node scripts/spec-docs.mjs golden-sample --sample /absolute/docs-corpus --json
node scripts/spec-docs.mjs review --phase planning --feature V1-FR-001
node scripts/spec-docs.mjs gate --phase planning
```

`lite`、`standard`、`regulated` 分别对应 S、M、L policy；已有 `--tier s|m|l` 命令继续兼容。任务包字段和 AI 使用顺序见[任务包与统一工作流入口](references/task-pack.md)。

## 三种工作模式

### A. 新项目建立体系

适合项目还没有可用的文档体系。初始化器会生成文档骨架、`docs-policy.json`、结构检查脚本；L 档或显式 `--gate` 还会生成交付门禁配置、证据清单和门禁脚本。

```bash
node <skill目录>/scripts/init-docs.mjs \
  --target /absolute/project \
  --name "项目名" \
  --version V1 \
  --tier m
```

初始化完成后的推荐顺序：

1. 打开 `docs/README.md`，确认项目范围、文档目录和按任务查找入口。
2. 按[产品规格指南](references/product-spec.md)收集事实，填写产品蓝图、版本路线图、当前版本总览和产品需求；检查场景、失败恢复与验收是否可评审。
3. 在需求编号表登记稳定 ID，再维护功能查找表和追踪矩阵。
4. 建立架构、服务边界、接口、OpenAPI、数据模型和统一错误码等公共基线。
5. 建立测试策略、端到端验收、性能容量和发布空间。
6. 逐个编写功能主文档；资金、权限、秘密、PII、外部回调、异步任务等高风险功能增加技术设计。
7. 运行结构检查，把检查命令放进项目 CI。

`check-docs --strict` 会提示产品蓝图和版本 PRD 缺少场景、流程、页面状态、验收映射或混入未来版本。`review-docs` 还会阻断蓝图、PRD、接口、数据、E2E 和性能文档缺失必需章节/表格的情况；自动检查只覆盖可判定的结构与追踪关系，产品判断仍需人工评审。

需要边写规格边开发时，先按交付切片完成范围、依赖、AC 和验证入口，再运行：

```bash
node scripts/review-docs.mjs --phase planning --feature V1-FR-001
```

局部审查只判断该功能及其关联 E2E 是否具备开发输入；它不会因为无关功能或全局性能文档未完成而阻断。版本发布仍运行全局 `check-docs` 与 `docs-gate`。S/M/L 档位通过 `docs-policy.json` 控制产品、公共契约、E2E 和性能检查的必需范围，不需要删除完整模板树。

### A'. 存量项目接入

适合项目已经有 `docs/`、脚本或历史规格，不能覆盖现有内容。使用 `--adopt` 只补不存在的模板和脚本：

```bash
node <skill目录>/scripts/init-docs.mjs \
  --target /absolute/project \
  --name "项目名" \
  --version V1 \
  --tier m \
  --adopt
```

如果新旧体系需要并行收敛，可以使用独立目录：

```bash
node <skill目录>/scripts/init-docs.mjs \
  --target /absolute/project \
  --name "项目名" \
  --version V1 \
  --tier m \
  --dir docs-next
```

接入原则：先保留旧文件并建立迁移映射，再逐份整理、回填编号和状态，最后将废弃内容放入 `99-历史归档`。不要把已经混入新体系的整个 `docs/` 根目录直接移动到历史目录。

### B. 编写或修改功能规格

适合增加一个可独立验收的功能，或为现有功能补齐技术设计。执行顺序是：

1. 判断功能是否能独立回答“谁用、输入、成功输出、稳定失败、读写哪些数据、如何证明”。
2. 查需求编号表和功能索引，分配稳定功能 ID；不要先写孤立文档。
3. 编写功能主文档的七段内容：功能卡、目标与边界、需求、接口、数据、验收、实现与验证。
4. 将 HTTP 字段、类型、约束和示例维护在 OpenAPI，功能文档引用 `operationId` 和业务语义。
5. 对高风险功能增加独立技术设计，写清前置条件、后置条件、副作用、并发、失败恢复和分支 ID。
6. 每条 AC 写成 Given/When/Then，并映射测试层级、目标资产、目标命令和证据状态。
7. 回写编号表、索引、查找表、追踪矩阵、风险分级和实现状态。

### C. 核查与治理

适合实现评审、文档冲突、状态回写、证据评审和归档迁移。实现核查输出四类结论：

- 已满足
- 部分满足
- 未实现
- 文档与代码冲突

结论必须带文件路径、行号或实际命令输出。发现字段、枚举、错误码、状态机、删除、幂等、并发或资金口径冲突时，先记录冻结决策，再同步文档、代码和测试，不能长期保留两套语义。

## 规模档位

初始化器默认使用 M 档。档位只裁剪必需结构，不削弱单一权威来源、稳定 ID、冲突决策、AC 追踪和证据真实性等硬规则。

| 档位 | 推荐场景 | 主要特点 |
| --- | --- | --- |
| S | 1 人、约 2 周、功能不超过 5 个 | 只将核心章节设为必需；完整模板树仍保留，其他模块按需使用 |
| M | 1–3 人、1–3 个月、多模块项目 | 默认档位，使用完整的范围、功能、架构、测试、发布和决策结构 |
| L | 5 人以上、多子系统或高风险平台 | 在 M 档基础上强化高风险技术设计、机器可读证据和交付门禁 |

以下情况应升级档位或至少启用对应的严格模块：出现第二个子系统、需要跨功能 E2E、涉及资金/权限/秘密/PII/外部回调、同一功能由多个团队维护，或功能数量明显超过小项目范围。

## 核心规则

1. **单一权威来源**：同一事实只维护一处，其他文档链接引用。
2. **稳定 ID**：需求、AC、设计分支、决策和 ADR 一旦分配，永不改变、永不复用。
3. **三类事实分离**：冻结需求、当前实现状态、差距和验证证据分别维护。
4. **冲突先决策后编码**：先形成冻结决策，再同步公共契约、代码和测试。
5. **一个功能一个验收目标**：不要把按钮或内部步骤单独伪装成功能，也不要把无法独立验收的大目标塞进一份文档。
6. **AC 可执行可追踪**：每条 AC 必须能落到测试层级、目标资产、命令和证据。
7. **证据不得升格**：静态核验、本地自动化、本地 mock、门禁环境和生产证据是不同等级。
8. **状态只在实现状态表维护**：功能主文档和索引不复制实现状态。
9. **模板不是业务事实**：不适用的章节写“不适用 + 理由”，不要留空或写“详见相关文档”。
10. **归档不删除**：旧文档进入历史归档，并保留旧路径到新路径的迁移映射。
11. **路线图版本必须有主文档**：路线图中处于规划状态的每个非当前版本都必须有独立的 `后续版本/Vx-规划.md`，并在索引中登记。
12. **状态维度分离**：规格、实现、生命周期和交付范围分别表达不同事实；不能用“已实现”代替验收，也不能用未来范围覆盖当前状态。

## 生成的项目文件

典型的 M/L 档项目结构如下：

```text
<项目根>/
├── docs/
│   ├── 01-项目概览/
│   ├── 02-产品与版本/
│   ├── 03-功能规格/
│   ├── 04-技术架构/
│   ├── 05-测试与发布/
│   ├── 06-决策记录/
│   ├── 90-参考资料/
│   ├── 99-历史归档/
│   └── README.md
├── docs-policy.json
├── docs-facts.json                 # 可选启用的事实注册表
├── docs-gate.json                 # --gate 或 --tier l 时生成
├── docs-evidence.json             # --gate 或 --tier l 时生成
└── scripts/
    ├── check-docs.mjs
    ├── review-docs.mjs
    ├── policy-utils.mjs
    ├── context-pack.mjs
    ├── task-pack.mjs
    ├── spec-docs.mjs
    ├── facts-sync.mjs
    ├── contract-index.mjs
    ├── golden-sample.mjs
    └── docs-gate.mjs              # --gate 或 --tier l 时生成
```

各目录的职责：

| 目录 | 权威内容 |
| --- | --- |
| `01-项目概览` | 项目目标、环境、协作和提交约定 |
| `02-产品与版本` | 产品蓝图、版本范围、PRD、法律和全版本约束 |
| `03-功能规格` | 需求编号、功能主文档、技术设计、风险和追踪矩阵 |
| `04-技术架构` | 总体架构、服务边界、接口、OpenAPI、数据模型、错误码和页面约束 |
| `05-测试与发布` | 测试策略、E2E、性能容量、安全、发布、恢复、回滚和验证证据 |
| `06-决策记录` | 冻结决策、ADR、文档变更记录 |
| `90-参考资料` | 不作为当前权威输入的参考材料 |
| `99-历史归档` | 被替代或废弃的文档及迁移映射 |

## 常用命令

以下命令可以在 Skill 目录执行；初始化后，项目内会拥有自己的脚本副本，之后推荐使用项目内路径。

### 初始化与更新

```bash
# 生成默认 M 档骨架
node <skill目录>/scripts/init-docs.mjs --target . --name "项目名" --version V1 --tier m

# S 档，不生成交付门禁
node <skill目录>/scripts/init-docs.mjs --target . --name "项目名" --version V1 --tier s --no-gate

# L 档，自动生成交付门禁
node <skill目录>/scripts/init-docs.mjs --target . --name "项目名" --version V1 --tier l

# 只预览生成计划，不写文件
node <skill目录>/scripts/init-docs.mjs --target . --name "项目名" --version V1 --tier m --dry-run

# 只更新项目内的检查脚本，不改 docs/ 和配置
node <skill目录>/scripts/init-docs.mjs --target . --refresh
```

`--force` 会覆盖同名生成文件，只适合明确确认过的空项目或模板目录；存量项目优先使用 `--adopt`，不能与 `--force` 同时使用。

### 结构检查

```bash
# 日常检查
node scripts/check-docs.mjs

# 临时按更高档位检查
node scripts/check-docs.mjs --tier m

# 将普通警告也作为失败处理
node scripts/check-docs.mjs --strict
```

结构检查关注目录和必需文件、跨文档链接、稳定 ID、索引登记、路线图版本主文档、需求追踪矩阵双向覆盖、功能文档章节、技术设计分支、公共接口/数据契约结构、E2E 规范与执行矩阵双向覆盖、未来 AC 混入当前版本、ADR、AC 表列和占位符。普通模式将部分质量项作为告警；`--strict` 把质量告警也作为失败。通过只表示文档体系自洽，不表示规格已经可开发或功能已经实现。

### SDD 规格就绪审查

```bash
# 单独审查规格，不执行项目命令
node scripts/review-docs.mjs --phase planning

# 可开发性门禁：结构 + SDD 语义 + AC 映射；不要求测试已经执行
node scripts/docs-gate.mjs --phase planning
```

`review-docs` 检查功能 ID 与章节、AC 的 Given/When/Then 和最终事实、AC 到测试资产映射、Ready 状态、版本边界、产品追踪、公共接口/数据契约及 E2E 对应关系。它还要求产品蓝图的概念所有权、核心流程和成功标准，版本 PRD 的页面/交付闭环，接口逐操作表，数据不变量与迁移验证，E2E 矩阵/正文和性能场景矩阵。确实不适用的结构化章节可写 `不适用：具体业务理由和替代验证`，理由必须说明业务原因或替代验证，空理由、模板占位和“详见”不能绕过检查。它报告缺失、空泛、范围混用、冲突和证据缺口，不代替产品判断，也不运行测试。planning 可以保留“未执行”测试状态，但规格结构、契约和追踪缺口会阻断 `SPEC_READY`；稳定 ID 缺失、当前/未来混用、Ready 无闭环和已声明通过却没有资产也会阻断。使用 `--feature <id>` 时进入局部范围，只检查目标功能及其直接引用的 E2E。

成熟度状态依次为 `SDD_NOT_READY`、`SPEC_READY`、`IMPLEMENTATION_PENDING`、`EVIDENCE_PENDING`、`RELEASE_READY`。这些状态表达阶段检查结果，不代表审批或实现事实。`docs-gate.json` 的 `review.enabled` 可关闭审查；`review.failOn` 是严重级别阈值，支持 `blocking`（默认）、`error`、`warning`。存量项目可运行 `init-docs --refresh` 更新项目内脚本副本，该命令会覆盖脚本但不改动 docs/ 与配置；`--adopt` 只新增缺失文件，已有 policy 根目录与 `--dir` 冲突时会失败。

### 交付证据门禁

L 档或 `--gate` 生成以下文件：`docs-gate.json`、`docs-evidence.json` 和 `scripts/docs-gate.mjs`。

```bash
# 为已有项目生成门禁配置和证据模板
node scripts/docs-gate.mjs --init

# 生成报告与 manifest 的空模板
node scripts/docs-gate.mjs --scaffold-report e2e
node scripts/docs-gate.mjs --scaffold-report perf

# 计算权威文档摘要，供审批绑定
node scripts/docs-gate.mjs --authority-digest

# 日常检查
node scripts/docs-gate.mjs

# 发布级检查
node scripts/docs-gate.mjs --release
```

`docs-gate` 只读取项目文件和 Git 状态，不执行项目测试或部署命令。默认在 planning、development、release 三个阶段组合结构检查与 SDD 内容审查；planning 允许测试尚未执行，不要求审批或发布证据。`docs-gate.json` 的 `structureCheck` 可关闭结构检查，`review.enabled` 可单独关闭规格审查，`strictStructure` 可将 `check-docs --strict` 纳入阻断条件。development/release 继续核对证据，release 额外要求审批和提交绑定。项目自己的测试、压测、部署和恢复流程负责产出报告；门禁负责重新计算和核对：

- 报告和 manifest 是否配对、在仓库内且没有越界符号链接。
- 报告统计、退出码、环境、提交和源码摘要是否一致。
- E2E 是否存在真实通过用例；发布模式拒绝全跳过、失败、flaky 或未登记通过的 AC。
- 权威文档摘要是否仍与审批绑定；文档改动后旧审批自动失效。
- 已通过 AC 是否有存在的测试资产和已登记命令。
- 性能报告是否绑定已批准的负载配置并按阈值重新计算。
- 发布检查项、审批角色、提交和制品标识是否完整。
- 报告与 manifest 是否命中秘密扫描。

普通模式允许部分待补项并给出警告；发布模式将未闭环项按错误处理。门禁退出码为 `0` 表示通过，`1` 表示证据或断言不满足，`2` 表示配置或用法错误。

## 推荐的 CI 接入

每次提交运行结构检查，防止链接、索引和编号逐渐失效：

```yaml
- name: Check docs structure
  run: node scripts/check-docs.mjs --strict
```

候选发布分支或发布流水线运行交付门禁：

```yaml
- name: Check delivery evidence
  run: node scripts/docs-gate.mjs --release
```

门禁不会替代项目命令。CI 需要先执行项目自己的测试、构建、压测和部署前检查，将真实结果写入报告和 manifest，再运行 `docs-gate`。

## 参考资料索引

| 文件 | 用途 |
| --- | --- |
| [`SKILL.md`](./SKILL.md) | AI 触发条件、三种工作模式、硬规则和完成前自检 |
| [`references/methodology.md`](./references/methodology.md) | 方法论、不变式、追踪链、档位和上手顺序 |
| [`references/doc-map.md`](./references/doc-map.md) | 判断一条信息应该写入哪份文档 |
| [`references/feature-spec.md`](./references/feature-spec.md) | 功能拆分、七段结构、技术设计和 AC 映射 |
| [`references/governance.md`](./references/governance.md) | 状态、门禁、变更联动、冲突和归档治理 |
| [`references/evidence.md`](./references/evidence.md) | 证据分级、验证记录、批次 manifest 和检查规则 |
| [`references/docs-gate.md`](./references/docs-gate.md) | 交付门禁配置、报告契约、审批摘要和退出码 |
| [`references/facts-registry.md`](./references/facts-registry.md) | 统一状态枚举、事实注册表字段和迁移规则 |
| [`references/context-pack.md`](./references/context-pack.md) | 按功能/切片生成 AI 与开发者最小上下文 |
| [`references/traceability-report.md`](./references/traceability-report.md) | 事实覆盖率、孤立节点和关系一致性报告 |
| [`references/spec-diff.md`](./references/spec-diff.md) | 规格基线、差异分类与变更治理 |
| [`references/evidence-freshness.md`](./references/evidence-freshness.md) | 证据新鲜度、失效传播和严格检查 |
| [`references/adoption.md`](./references/adoption.md) | 存量项目安全接入、迁移和渐进启用门禁 |
| [`references/release-line.md`](./references/release-line.md) | Skill 本体能力版本、工作树状态与发布边界 |
| [`references/compatibility.md`](./references/compatibility.md) | 存量文档状态语义审计与迁移路径 |
| [`references/task-pack.md`](./references/task-pack.md) | 统一入口、任务包字段和 AI 执行边界 |
| [`references/contracts.md`](./references/contracts.md) | HTTP、事件、Driver、migration 和页面契约索引 |
| `assets/skeleton/docs/` | 可复制的空文档模板 |
| `evals/evals.json` | 可判定的 Skill 使用评测场景 |

## 自测

在仓库中验证 Skill 自身：

```bash
node skills/spec-docs/scripts/selftest-check-docs.mjs
node skills/spec-docs/scripts/selftest-review-docs.mjs
node skills/spec-docs/scripts/selftest-docs-gate.mjs
node skills/spec-docs/scripts/selftest-facts-context.mjs
node skills/spec-docs/scripts/selftest-change-tools.mjs
node skills/spec-docs/scripts/selftest-release-contract.mjs
node skills/spec-docs/scripts/selftest-workflow.mjs
node skills/spec-docs/scripts/selftest-facts-sync.mjs
node skills/spec-docs/scripts/selftest-contract-index.mjs
node skills/spec-docs/scripts/golden-sample.mjs --sample /absolute/docs-corpus --json
```

自测覆盖干净骨架、断链、编号和追踪错误、产品与 SDD 规格缺口、reviewer 稳定输出、S/M/L 档位、dry-run、存量接入、planning/development/release 门禁、报告与 manifest 不一致、提交绑定、审批过期、秘密扫描、性能阈值、全跳过 E2E、AC 资产缺失和路径越界等场景。

## 已知边界

- `check-docs` 证明结构自洽；`review-docs` 判断规格闭环；`docs-gate` 组合阶段门禁与交付证据。自动检查不能代替业务评审或证明尚未执行的实现。
- `docs-gate` 不执行业务命令、不生成业务报告、不验证审批人身份真实性。
- 真实依赖、资金、密钥、备份恢复、生产规模和故障注入仍需要项目自己的验证环境和证据。
- 秘密扫描是启发式检查；命中时门禁失败，但未命中不等于绝对安全。
- 骨架中的功能示例只是模板，不包含任何真实业务规则；填充时必须替换为项目事实。

## 版本与发布

`spec-docs` 独立使用 `spec-docs-vX.Y.Z` 标签发布。GitHub 当前稳定版本为 [v1.9.0](https://github.com/ccnuzw/daoge-skills/releases/tag/spec-docs-v1.9.0)。

版本策略：破坏性契约或迁移要求提升主版本；新增兼容能力提升次版本；文档、检查器和兼容性修复提升补丁版本。
