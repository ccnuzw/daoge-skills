# spec-docs

> 版本：`1.1.1`。面向中文软件项目的可移植文档驱动开发 Skill。

`spec-docs` 用 Markdown 文档、稳定 ID、结构检查和交付证据门禁，把软件项目从产品范围推进到功能实现和发布验收。它适合希望直接维护项目文档、让 AI 按明确规格工作、并且能在交接或发布前检查证据链的个人和团队。

它提供的是一套**文档规范 + 模板骨架 + Node.js 检查脚本 + 治理参考**，不绑定特定语言、框架、数据库或部署平台，也不生成独立的产品工作台。

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

## 适合与不适合

适合以下场景：

- 从零建立项目的 `docs/` 文档体系。
- 整理已经存在但互相重复或过时的项目文档。
- 编写产品蓝图、版本 PRD、功能规格、技术设计和 ADR。
- 建立需求编号、功能索引、追踪矩阵和 AC 测试映射。
- 核查“文档要求是否被代码和测试满足”，并将结论写回实现状态。
- 在发布前检查报告、manifest、提交、权威文档摘要和审批是否完整绑定。
- 为个人项目、小团队项目或高风险平台项目按规模选择不同文档档位。

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
| `spec-docs` | 需要可复制的 Markdown 规范、模板、结构检查和证据门禁；项目不需要额外工作台 | `docs/`、规格模板、`check-docs`、`docs-gate` |
| `daoge-docs` | 需要完整的项目文档治理、开发执行工作台、Goal 输入和跨版本执行流程 | 项目文档、开发者工作台、Goal、项目级门禁与执行数据 |

两者不共享项目状态，也不会自动互相安装。一个项目可以只使用其中一个；如果团队已经采用 `daoge-docs` 的工作台和 Goal 流程，不需要为了使用它再安装 `spec-docs`。

## 安装

### 安装固定版本

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/spec-docs-v1.1.1/skills/spec-docs -a codex
```

该命令安装 `spec-docs-v1.1.1` 标签中的 Skill，适合需要固定版本和可复现环境的项目。安装完成后重启 Codex，使宿主重新加载 Skill registry。

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
2. 填写产品蓝图、版本路线图、当前版本总览和产品需求。
3. 在需求编号表登记稳定 ID，再维护功能查找表和追踪矩阵。
4. 建立架构、服务边界、接口、OpenAPI、数据模型和统一错误码等公共基线。
5. 建立测试策略、端到端验收、性能容量和发布空间。
6. 逐个编写功能主文档；资金、权限、秘密、PII、外部回调、异步任务等高风险功能增加技术设计。
7. 运行结构检查，把检查命令放进项目 CI。

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
├── docs-gate.json                 # --gate 或 --tier l 时生成
├── docs-evidence.json             # --gate 或 --tier l 时生成
└── scripts/
    ├── check-docs.mjs
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

结构检查关注目录和必需文件、跨文档链接、稳定 ID、索引登记、追踪矩阵、功能文档章节、AC 表列和占位符。通过只表示文档体系结构自洽，不表示功能已经实现或可以发布。

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

`docs-gate` 只读取项目文件和 Git 状态，不执行项目测试或部署命令。项目自己的测试、压测、部署和恢复流程负责产出报告；门禁负责重新计算和核对：

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
| [`references/adoption.md`](./references/adoption.md) | 存量项目安全接入、迁移和渐进启用门禁 |
| `assets/skeleton/docs/` | 可复制的空文档模板 |
| `evals/evals.json` | 可判定的 Skill 使用评测场景 |

## 自测

在仓库中验证 Skill 自身：

```bash
node skills/spec-docs/scripts/selftest-check-docs.mjs
node skills/spec-docs/scripts/selftest-docs-gate.mjs
```

自测覆盖干净骨架、断链、编号和追踪错误、AC 结构、S/M/L 档位、dry-run、存量接入、报告与 manifest 不一致、提交绑定、审批过期、秘密扫描、性能阈值、全跳过 E2E、AC 资产缺失和路径越界等场景。

## 已知边界

- `check-docs` 只证明结构自洽；交付资格由 `docs-gate` 判断。
- `docs-gate` 不执行业务命令、不生成业务报告、不验证审批人身份真实性。
- 真实依赖、资金、密钥、备份恢复、生产规模和故障注入仍需要项目自己的验证环境和证据。
- 秘密扫描是启发式检查；命中时门禁失败，但未命中不等于绝对安全。
- 骨架中的功能示例只是模板，不包含任何真实业务规则；填充时必须替换为项目事实。

## 版本与发布

`spec-docs` 独立使用 `spec-docs-vX.Y.Z` 标签发布。当前版本为 [v1.1.1](https://github.com/ccnuzw/daoge-skills/releases/tag/spec-docs-v1.1.1)。

版本策略：破坏性契约或迁移要求提升主版本；新增兼容能力提升次版本；文档、检查器和兼容性修复提升补丁版本。
