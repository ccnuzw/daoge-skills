---
name: spec-docs
description: 为任意项目建立、填充和维护“文档驱动开发”文档体系（文档骨架、功能规格、需求编号与追踪矩阵、接口/数据契约、验收证据链、版本门禁、冻结决策与 ADR）。当用户要为新项目搭 docs/ 文档骨架、整理现有项目文档、写功能规格/需求/接口/数据/测试/验收文档、建需求追踪或 ADR、要求 AI 按文档开发或核查实现、准备交接评审，或提到文档驱动开发、文档体系、规格文档、需求追踪、docs bootstrap、spec-first 时，都应使用本 skill——即使没有点名 spec-docs。Use whenever the user mentions document-driven development, spec docs, requirement traceability, ADRs, acceptance criteria mapping, or asks for docs scaffolding or templates in any project.
metadata:
  version: "1.9.0"
  updated: "2026-09-30"
---

# spec-docs：文档驱动开发

这套体系让开发者和 AI 在**有限、明确、无冲突**的上下文里工作：范围由版本文档决定，行为由功能文档决定，跨功能一致性由公共架构决定，实际做到什么由代码和证据决定。目标产物是**可解释（每个结论有来源）、可维护（一处修改知道要同步哪里）、可交接（新人或新 AI 会话能按索引找到入口）**的文档集，而不是一堆写给人看的说明文。

文档默认用中文；`README.md`、`openapi.yaml`、API 路径、数据库字段、代码标识保留行业英文命名。

## 先判断要做哪件事

| 用户意图 | 模式 | 读取 |
| --- | --- | --- |
| 新项目 / 现有项目还没有 docs 体系 | A 建体系 | [references/methodology.md](references/methodology.md) + [references/doc-map.md](references/doc-map.md)，然后跑 `scripts/init-docs.mjs` |
| 写或评审产品蓝图、版本 PRD，或对标高质量样板 | P 产品规格 | [references/product-spec.md](references/product-spec.md)；再读相关蓝图、路线图、版本总览与功能索引 |
| 评审 SDD 开发输入、公共接口/数据契约与 E2E 闭环 | B 写规格 | [references/sdd-readiness.md](references/sdd-readiness.md)；按需读取功能、OpenAPI、数据与验收文档 |
| 存量项目已有乱/旧文档，要收敛 | A' 接入 | [references/adoption.md](references/adoption.md)（先止损、后搬家、再追踪） |
| 新增或修改一个功能文档、技术设计 | B 写规格 | [references/feature-spec.md](references/feature-spec.md) + [references/governance.md](references/governance.md)；跨功能或高风险时读 [references/sdd-readiness.md](references/sdd-readiness.md) |
| 实现核查、状态回写、冲突冻结、归档迁移、证据评审 | C 治理 | [references/governance.md](references/governance.md) + [references/evidence.md](references/evidence.md) |
| 只要一份现成模板 | — | 直接复制 `assets/skeleton/docs/` 下对应文件 |
| 要检查文档结构是否破 | — | 跑 `scripts/check-docs.mjs`（或项目内已安装的副本） |
| 要判断规格是否达到可开发、可验证状态 | B 写规格 / C 治理 | [references/sdd-readiness.md](references/sdd-readiness.md)，跑 `scripts/review-docs.mjs` 或 `docs-gate --phase planning` |
| 要在其他文档仍未完成时推进一个功能/交付切片 | B 写规格 / C 治理 | [references/incremental-sdd.md](references/incremental-sdd.md)，跑 `scripts/review-docs.mjs --feature <feature-id>` |
| 要修改既有功能并分析增量影响 | B 写规格 / C 治理 | 使用 `Vx-CS-NNN` 变更切片，运行 `scripts/change-impact.mjs` 和 `scripts/policy-calibrate.mjs` |
| 要为 AI/开发者生成最小任务上下文 | B 写规格 / C 治理 | 启用 `docs-facts.json`，运行 `scripts/context-pack.mjs --feature <feature-id>` 或 `--slice <slice-id>` |
| 要分析事实关系和增量影响传播 | B 写规格 / C 治理 | 在注册表维护 `relations`，运行 `scripts/change-impact.mjs` 和 `scripts/traceability-report.mjs` |
| 要检查证据是否过期并传播失效影响 | C 治理 / D 交付 | 在事实或切片维护 `evidence`，运行 `scripts/evidence-freshness.mjs` |
| 要比较规格基线并治理变更 | B 写规格 / C 治理 | 使用 `scripts/spec-diff.mjs` 创建基线、查看差异和受影响切片 |
| 要查看按事实类型的追踪覆盖率或阻断孤立事实 | C 治理 | 跑 `scripts/traceability-report.mjs --profile sdd --strict` |
| 要把规格差异纳入交付门禁 | C 治理 / D 交付 | 启用 `docs-policy.json` 的 `changeGovernance`，或运行 `docs-gate --spec-diff` |
| 要判断能否交付（缺证据、审批失效、提交不匹配） | C 治理 | [references/docs-gate.md](references/docs-gate.md)，跑 `scripts/docs-gate.mjs`（L 档默认生成） |
| 要检查 Skill 自身版本和未发布能力线是否漂移 | — | [references/release-line.md](references/release-line.md)，跑 `scripts/release-status.mjs` |
| 存量项目存在旧功能状态写法，需要只读迁移诊断 | A' 接入 / C 治理 | [references/compatibility.md](references/compatibility.md)，跑 `scripts/compatibility-audit.mjs` |
| 要给 AI/开发者生成一次工作的最小读取和回写边界 | B 写规格 / C 治理 | [references/task-pack.md](references/task-pack.md)，跑 `scripts/spec-docs.mjs task` |
| 要从统一入口初始化、审查、门禁或变更分析 | — | 跑 `scripts/spec-docs.mjs <init|review|gate|change>` |
| 要快速判断项目是否已接入、当前 profile/tier 和下一步 | — | 跑 `scripts/spec-docs.mjs status --dir <project>` |
| 要检查或同步 Markdown 与事实注册表的派生字段 | B 写规格 / C 治理 | 跑 `scripts/spec-docs.mjs facts-sync --check|--write` |
| 要建立 HTTP、事件、SDK、Driver、migration 和页面契约索引 | B 写规格 / C 治理 | 跑 `scripts/spec-docs.mjs contracts --dir <project> --json`，读取 [references/contracts.md](references/contracts.md) |
| 要对真实项目文档库运行黄金样例一致性评测 | C 治理 | 跑 `scripts/spec-docs.mjs golden-sample --sample <docs-corpus> --json` |

## 硬规则

以下十一条是操作规则：规模裁剪可以简化文档形态与检查范围，但不能破坏单一来源、稳定追踪与证据真实性。完整原则及优先级见 methodology。

1. **单一权威来源**：同一事实只在一个地方维护，其他文档用链接引用。两处都写必然分叉，分叉后没有人知道该信哪个。
2. **稳定 ID**：需求（`V1-FR-001`）、验收（`AC01`）、分支（`B19-01`）、决策（`D001`）、ADR（`0001`）一旦分配永不改变、永不复用。文件可以移动、改名，ID 是追踪链的锚点。
3. **三类事实分离**：冻结需求记录在功能主文档；实现状态只记录在版本实现状态表；待修差距与验证证据记录在实现与验证章节。代码已存在不等于需求达成；文档写了“已实现”不等于验收通过。
4. **冲突先决策后编码**：字段、枚举、错误码、状态机、删除、幂等、并发、资金口径不一致时，先写入冻结决策，再同步功能文档、公共契约、代码和测试。不允许代码长期兼容两套语义。
5. **一个功能 = 一个可独立验收目标**：能回答“谁用、输入、成功输出、稳定失败、读写哪些数据、如何独立证明”。按钮、纯视觉组件、内部步骤不单独建功能。
6. **AC 必须可执行且可追踪**：每条验收标准写成 Given/When/Then，并映射到测试层级、目标资产、目标命令与当前证据状态。没有映射的 AC 等于没有验收。
7. **证据分级，不许升格**：静态核验 ≠ 测试通过；本地 mock ≠ 生产门禁；规划命令 ≠ 已执行。每条验证记录必须含日期、环境、代码版本、命令、结果和证据位置。
8. **状态只在实现状态维护**：功能状态（规划中/开发中/基础实现/本地验证/待验收/已完成/阻塞）只写进版本的实现状态文档，其他文档只能链接，不能各自宣布完成度。
9. **模板不是业务事实**：模板只定义最低检查范围。不适用的条款写“不适用 + 理由”，不能留空，也不能用通用句子（如“详见相关文档”）冒充真实规则。
10. **归档不删除**：废弃材料移入 `99-历史归档` 并保留“旧路径 → 新路径”的迁移映射；被取代的决策标注“已被 Dxxx 取代”，不改写历史。
11. **路线图版本必须有主文档**：路线图中处于规划状态的每个非当前版本都必须有独立的 `后续版本/Vx-规划.md` 或 `后续版本/Vx-主题.md`，并在后续版本索引中链接；聚合 README 或其他版本的功能文档不能替代它。
12. **状态维度必须分离**：规格状态、实现状态、生命周期和交付范围不能互相替代；启用事实注册表后，机器状态只使用统一枚举，业务规则仍回到权威文档。

## 模式 A：新项目建体系

1. 问清或推断：项目一句话目标、活跃版本号（默认 `V1`）、规模档次（S/M/L，见 methodology 第 7 节）、代码仓库根目录。
2. 运行骨架生成：
   ```sh
   node <skill目录>/scripts/init-docs.mjs --target <项目根> --name "<项目名>" --version V1 --tier m
   ```
    `--tier s|m|l` 写入 `docs-policy.json`，决定结构检查必需范围；完整模板树会保留以维持链接完整，S 档只需维护 policy 标记为必需的核心文档，不要手动删除可选模块。项目脚本还会包含 `scripts/policy-utils.mjs`，供结构检查与规格审查共享 policy 合并和“不适用”判定。
3. 先完成版本范围和关键约束，再按 [产品规格指南](references/product-spec.md) 收集角色、场景和事实。完整项目按产品蓝图 → 版本路线图 → 当前版本总览/产品需求 → 功能编号表 → 功能查找表 → 公共基线 → 测试策略 → 发布空间推进；迭代项目可按 [渐进式 SDD](references/incremental-sdd.md) 解锁独立交付切片，不要求等待无关功能全部完成。
   新项目同时生成 `docs-facts.json`；先登记切片和功能入口，再逐步补充 operation、entity、decision 与 evidence，不要在注册表复制业务规则。
4. 功能文档最后写：每个可独立验收目标一份主文档，高风险功能加一份技术设计。先登记索引和编号，再创建文件。
5. 跑 `node <项目根>/scripts/check-docs.mjs` 检查结构，再跑 `node <项目根>/scripts/review-docs.mjs --phase planning` 检查规格闭环；需要将可开发状态纳入统一门禁时运行 `docs-gate --phase planning`。核心章节、结构化表、契约、E2E 和性能矩阵缺失都会阻断规格审查；结构通过不等于规格已就绪。
6. 告诉用户哪些章节是占位（`<!-- 填写说明 -->` 或 `<>`），以及下一步该填哪一份。

## 模式 P：产品蓝图与版本 PRD

1. 读取 [产品规格指南](references/product-spec.md)，从用户提供的资料和现有文档收集角色、场景、问题、成功终态、失败路径、版本边界和证据来源。未决业务选择标明待确认及验证方式；不自行捏造。
2. 蓝图写长期产品判断：角色场景、概念与所有权、核心业务流程、能力地图、信息架构、指标口径、非功能目标、风险。版本 PRD 写本版可交付体验：按角色的关键链路、页面状态、跨功能规则、场景验收、交付依赖及明确排除项。
3. 产品文档解释业务效果并链接稳定功能 ID、AC/E2E、决策和权威契约；不复制 HTTP schema、数据库字段或单功能规则。跨文件冲突先冻结决策。
4. 对照指南的评审清单核对角色、场景、版本、页面与验收的覆盖关系。运行 `check-docs --strict` 捕获结构和引用问题；其通过不代替产品/技术/测试评审。

## 模式 B：写一个功能文档

1. 先判断拆分是否合格（硬规则 5），再判断它属于哪个交付切片；不合格先和用户讨论拆分，不要直接写。
2. 查现有编号表和功能索引，分配稳定功能 ID；新功能先登记再创建文件。
3. 按 [references/feature-spec.md](references/feature-spec.md) 的七段结构写主文档：YAML frontmatter + 功能卡（规格状态 Draft/Ready）+ 目标与边界 + 需求/接口/数据/验收/实现；实现状态只维护在版本实现状态文档。
4. 判定风险等级：资金、权限、秘密、PII、路由、外部回调、异步任务、动态制品、跨系统状态必须独立技术设计；标准风险把技术设计内联在主文档末尾。
5. 写 AC（Given/When/Then），并填写两张映射表：自动化测试映射（按 AC 范围聚合）与 AC 逐项测试设计（测试层级/目标资产/目标命令/初始资产状态）。
6. 对照 [references/governance.md](references/governance.md) 和 [渐进式 SDD](references/incremental-sdd.md) 的 Ready 检查；未 Ready 的切片不写生产代码，其他无关 Draft 不阻塞本切片。
7. 回写：功能索引、查找表、追踪矩阵、实现状态、公共契约（接口/数据/错误码变化时）。

## 模式 C：核查与治理

- **实现核查**（只读）：对照需求、接口、数据、错误、页面、测试和代码，输出“已满足 / 部分满足 / 未实现 / 文档与代码冲突”四类结论及证据（文件 + 行号或命令输出）。不要修改代码。
- **状态回写**：只在有证据时更新实现状态，附日期、环境、构建标识、命令、结果、遗留风险；性能结论必须来自已批准的负载配置，静态预检不得写成压测通过。
- **执行空间维护**：端到端验收与性能容量各自维护 规范 → 环境/夹具/顺序 → 用例矩阵 → 验证证据 四层；专项/轮次测试设计单独成文并带日期，不进主矩阵；批次证据只追加不覆盖，并配 `<run_id>-manifest.json`（含 code_version、asset_sha256、limitations）。
- **交付范围隔离**：功能 frontmatter 必须写 `delivery_scope`、`planning_only`、`delivery_slice`；未来规划不得混入当前版本实现状态或交付统计。
- **范围与登记分离**：规划中的设计扩展可以登记编号并维护设计稿（先放 `04-技术架构/当前版本/`），但必须标注状态，不视为进入交付范围或已实现。
- **冲突处理**：先形成冻结决策，再同步主文档、公共基线、代码、测试，最后更新追踪矩阵。
- **归档迁移**：新家先就位，旧路径写进迁移映射，再删除旧文件；归档目录内容默认不是当前开发输入。

## 完成前自检

- 文档结构变化后跑过 `check-docs.mjs`，链接、索引、编号零错误。
- 蓝图与当前版本 PRD 的核心角色和场景有真实成功/失败路径、适用版本、功能与验收引用；指标有口径和验证计划。不要以篇幅或模板章节数量推定质量。
- 每个功能的接口章节包含接口清单、OpenAPI operation 映射和错误矩阵；数据章节包含最小数据治理小节，或明确“不适用 + 理由”。
- 每个 AC 有映射；每条映射的证据状态属实（不是把“计划执行”写成“通过”）。
- 当前版 AC 与 E2E 不包含未来版本交付；关键失败分支写明无副作用断言。
- 公共接口逐操作追到功能与权威 schema；关键数据实体有所有权、不变量及迁移验证；E2E 用例矩阵与独立正文双向对应。
- 蓝图、PRD、接口、数据、E2E 和性能文档的必需章节与表格不能省略；写“不适用”时必须给出业务理由和替代验证方式。
- 确实不适用的结构化章节使用 `不适用：具体业务理由和替代验证`；空理由、模板占位和“详见”不能绕过门禁。
- AC 映射中的反引号路径和 Markdown 相对链接必须指向仓库内真实测试资产；链接按来源文档目录解析，越出仓库的路径无效。
- 新增/修改了接口、字段、错误码时，公共契约和机器可读文件（openapi）同步。
- 高风险功能有独立技术设计，且分支 ID 映射到 AC/E2E。
- 需求追踪矩阵逐行链接功能主文档，并覆盖需求范围、接口、数据和跨功能验收；短格式 E2E ID 也必须能解析到用例矩阵。
- 独立技术设计具备单元契约、伪代码、分支到测试追踪和约束备注；可用 frontmatter `feature_id` 或主文档来源链接建立绑定。
- E2E/性能矩阵具备最低审计列，ADR 具备背景、备选、决策、后果、验证和显式状态。
- 冲突项都有决策编号；被取代的旧结论已标注取代关系。
- 证据报告与 manifest 成对存在，状态带环境与日期；规划中能力没有被写成已实现。
- 没有在多个文件里维护同一事实。
- 启用事实注册表的项目通过 `check-docs` 的 ID、状态、权威路径和切片引用检查；未启用的存量项目仍可兼容运行。
- Skill 本体的声明版本、README、CHANGELOG 和能力线通过 `release-status` 对齐检查；未发布工作树能力不得写成已发布标签。
- 存量项目先通过兼容性审计识别旧状态写法，再逐步提高结构和证据门禁，不静默改写历史文档。

## 文件索引

| 文件 | 何时读 |
| --- | --- |
| [references/methodology.md](references/methodology.md) | 想理解体系全貌、做取舍、决定规模档次时 |
| [references/product-spec.md](references/product-spec.md) | 写或评审产品蓝图、版本 PRD，或与样板对标时 |
| [references/sdd-readiness.md](references/sdd-readiness.md) | 评审当前版本交付切片、公共接口/数据契约与 E2E 开发输入时 |
| [references/incremental-sdd.md](references/incremental-sdd.md) | 需要边写规格边开发、按交付切片渐进解锁时 |
| [references/facts-registry.md](references/facts-registry.md) | 设计统一状态、事实注册表和迁移顺序时 |
| [references/context-pack.md](references/context-pack.md) | 为 AI/开发者按功能或切片生成最小读取上下文时 |
| [references/traceability-report.md](references/traceability-report.md) | 检查事实覆盖率、孤立节点和关系端点时 |
| [references/doc-map.md](references/doc-map.md) | 要确定“这件事应该写进哪份文档”时 |
| [references/adoption.md](references/adoption.md) | 存量项目接入：归档迁移、编号回填、状态回填、渐进接门禁时 |
| [references/feature-spec.md](references/feature-spec.md) | 写功能主文档、技术设计、AC 时 |
| [references/governance.md](references/governance.md) | 门禁、状态机、变更联动、维护与评审时 |
| [references/evidence.md](references/evidence.md) | 写验证记录、证据报告、设计自动检查时 |
| [references/docs-gate.md](references/docs-gate.md) | 设计/使用分阶段门禁、排查结构/规格/交付证据失败时 |
| [references/spec-diff.md](references/spec-diff.md) | 创建规格基线、分析差异和准备变更回写时 |
| `assets/skeleton/docs/` | 需要可复制的空文档骨架时 |
| `scripts/init-docs.mjs` | 生成项目骨架时（`--gate` 或 `--tier l` 附带门禁）；存量项目先用 `--adopt` 只新增缺失文件 |
| `scripts/check-docs.mjs` | 校验结构、链接、编号、索引一致性时 |
| `scripts/review-docs.mjs` | 审查功能、AC、公共契约、产品追踪和 E2E 是否形成可验证 SDD 输入时 |
| `scripts/docs-gate.mjs` | 按 planning/development/release 阶段组合结构、规格与交付证据检查时 |
| `scripts/selftest-check-docs.mjs` | 验证检查器、档位策略、dry-run、adopt 与自定义目录行为时 |
| `scripts/selftest-review-docs.mjs` | 验证 SDD 就绪审查、路径识别与稳定输出时 |
| `scripts/selftest-docs-gate.mjs` | 需要在临时项目上验证门禁自身行为时 |
| `scripts/context-pack.mjs` | 按功能或交付切片生成只读任务上下文时 |
| `scripts/traceability-report.mjs` | 输出事实关系、覆盖率和孤立节点报告时 |
| `scripts/evidence-freshness.mjs` | 检查证据新鲜度、失败状态和关系传播时 |
| `scripts/spec-diff.mjs` | 对比规格基线、分类变更并生成治理回写清单时 |
| `scripts/release-status.mjs` | 检查 Skill 版本声明、能力线和 CHANGELOG 是否一致时 |
| `scripts/compatibility-audit.mjs` | 审计存量功能文档中的旧状态写法时 |
| `scripts/task-pack.mjs` | 按功能或切片生成 AI/开发者可执行任务包时 |
| `scripts/spec-docs.mjs` | 通过统一入口路由初始化、任务、审查、门禁和增量分析时 |
