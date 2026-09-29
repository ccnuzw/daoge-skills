# Changelog

> `1.9.0` 汇总并发布 `1.7.0`、`1.8.0` 和 `1.9.0` 能力线；机器可读状态见 `release-manifest.json`。

## [1.9.0] - 2026-09-30

### Release
- 发布可移植的 SDD 文档驱动开发体系，覆盖文档骨架、功能规格、稳定 ID、追踪矩阵、SDD 就绪审查、分阶段门禁和证据治理。
- 发布事实注册表、关系图传播、事实同步、authority 文件差异、证据新鲜度和规格基线差异能力。
- 发布统一工作流入口、`task-pack`、`lite/standard/regulated` profiles、多类型契约索引和真实项目黄金样例评测。
- `tuzi-docs` 黄金样例评测通过：190 个 OpenAPI operation，189 个已映射功能；兼容审计发现 39 个功能文档中的 77 条历史状态迁移项，未修改样例文档。

## [1.7.0] - Included in 1.9.0

### Added
- 新增 `docs-facts.json` 事实注册表模板，以稳定 ID 登记事实类型、生命周期、规格状态、实现状态、交付范围、切片、权威来源和证据引用。
- 新增统一机器状态枚举，并保留现有中文实现状态文档作为人类可读视图；注册表默认兼容关闭，显式启用后由 `check-docs` 校验。
- 新增 `context-pack.mjs`，按功能或交付切片生成只读 JSON 任务上下文，自动收集直接依赖、权威路径和证据引用。
- `init-docs`/`--refresh` 支持事实注册表和上下文包脚本。

### Governance
- 新增 `facts-registry.md` 和 `context-pack.md`，明确状态维度边界、切片生命周期和渐进迁移顺序。
- 新增 `release-manifest.json`、`release-status.mjs` 和 `compatibility-audit.mjs`，收口 Skill 能力线并为存量功能文档提供只读状态迁移诊断。
- 新增 `spec-docs.mjs` 统一工作流入口、`task-pack.mjs` 任务包和 `lite/standard/regulated` 初始化 profile；保留 `--tier` 兼容接口。
- 统一入口增加 `status`，可只读显示项目接入状态、当前 profile/tier、事实注册表和门禁配置。

## [1.8.0] - Included in 1.9.0 (2026-09-30)

### Added
- 事实注册表支持显式 `relations`，覆盖切片、依赖、操作、实体、验收、决策和实现资产关系。
- `change-impact.mjs` 新增关系图传播输出，保留旧项目的文本共现兼容分析。
- 新增 `traceability-report.mjs`，输出事实/切片覆盖率、孤立节点、坏关系端点和权威来源缺口。
- 新增共享 `facts-utils.mjs`，供检查器、上下文包、影响分析和追踪报告使用。
- 新增 `facts-sync.mjs`，只读检查或显式更新 Markdown 派生事实；`traceability-report` 增加按事实类型和 SDD profile 的覆盖率视图。
- `spec-diff` 基线增加 authority 文件摘要，权威 Markdown 变化即使未修改 facts 也会被识别。
- 新增 `contract-index.mjs`，统一索引 HTTP、事件/SDK、Driver、migration 和页面契约来源，不复制各类契约字段。
- 新增 `golden-sample.mjs`，以真实项目文档库验证导航、权威来源、追踪、E2E 证据边界和契约索引。

### Verification
- 关系图传播、追踪覆盖率、坏端点、上下文邻接和初始化接线均有回归自测覆盖。

## [1.9.0] - Included in release entry above

### Added
- 新增 `evidence-freshness.mjs`，检查事实/切片证据的路径、通过状态、生成时间和源码提交绑定。
- 新增 `affected` 传播结果，沿事实关系图识别依赖过期或失效证据的节点。
- `init-docs`/`--refresh` 支持复制证据新鲜度脚本；事实模板增加可选 `evidence_policy`。
- 新增 `spec-diff.mjs`，支持规格基线快照、事实/切片/关系差异分类和受影响切片分析。
- 变更报告输出治理回写清单，并在严格模式下阻断缺少交付切片绑定的活动事实变化。
- `docs-policy.json` 新增可选 `changeGovernance` 配置，可指定基线目录、严格模式和切片绑定规则。
- `docs-gate` 支持自动或显式运行 `spec-diff`，并在 JSON 输出中返回 `spec_diff` 报告；发布阶段可阻断未处理规格变化。

### Verification
- 覆盖有效证据、过期证据、失败严格模式、关系传播和初始化接线的回归自测已加入。
- 覆盖基线冻结、差异分类、基线摘要篡改、门禁联动和发布阶段阻断的回归自测已加入。

## [1.6.0] - Unreleased

### Added
- 新增 `Vx-CS-NNN` 变更切片模板和增量变更工作流。
- 新增只读 `change-impact.mjs` 和 `policy-calibrate.mjs`。
- `init-docs` 与 `--refresh` 支持复制两个新 CLI。
- `check-docs` 增加变更切片 ID、主功能、影响清单和验收证据结构检查。
- `change-impact` 增加相对链接/断链诊断；`policy-calibrate` 增加章节覆盖率、required 缺失项和 tier 建议。

## 1.5.0 — 未发布

- 统一 `check-docs` 与 `review-docs` 的 tier policy 合并及“不适用”理由判定，并随项目副本生成共享 `scripts/policy-utils.mjs`。
- `review-docs --feature` 进入真正的局部审查范围，只检查目标功能及其直接引用的 E2E；`docs-gate.review.failOn` 明确为严重级别阈值。
- `init-docs --adopt` 拒绝已有 policy 根目录与 `--dir` 冲突，`--refresh` 明确为覆盖项目脚本副本的升级操作。
- 增加渐进式 SDD：按交付切片独立解锁功能，`review-docs --feature` 支持局部规格就绪审查，并保留全局版本门禁。
- 存量接入补充兼容运行、逐域迁移和迁移报告分类；明确旧 policy 告警不等于迁移完成。
- 功能卡识别重复实现状态并要求迁移到版本实现状态表；S/M/L policy 现在分别控制产品、公共契约、E2E 和性能审查范围。
- `review-docs` 缺失必需章节时不再静默放过；蓝图、PRD、公共接口、数据模型、E2E 和性能矩阵的结构化契约缺口会明确报告并阻断规格就绪。
- 蓝图新增核心概念所有权与权威定义、核心流程有序步骤检查；PRD 新增逐交付单元闭环检查；接口新增逐操作表存在性检查；数据模型新增不变量与迁移验证结构检查。
- E2E 独立规范强制每个用例具备 Given/When/Then；性能矩阵强制可解析的目标、环境、断言、证据和状态列。
- AC 映射支持 Markdown 测试资产链接，并按来源文档目录解析相对路径；越出仓库或不存在的资产继续按规划/已通过状态区分告警与阻断。
- 统一支持 `不适用：具体业务理由` 的章节裁剪；模板占位、空理由和“详见”式逃逸仍不能绕过必需表检查。
- 增加上述规则的回归自测，覆盖缺表、缺 GWT、缺性能矩阵和相对链接路径解析。

## 1.4.0 — 未发布

- 对比样板与 DGOS 的公共接口、数据模型和 E2E 规范后，加入 SDD 开发输入完整度指南；强化本版/未来 AC 隔离、失败无副作用、逐操作契约和数据不变量。
- 扩充接口、数据、E2E 模板；严格结构检查新增公共契约表、E2E 规范/执行矩阵双向 ID 与 Given/When/Then、未来 AC 混入本版的检测及反例自测。
- 增加产品蓝图与版本 PRD 写作/评审指南，要求角色场景、成功与失败路径、指标口径、页面状态和验收追踪，同时保持接口/数据契约单一来源。
- 扩充两份产品文档模板，并在严格结构检查中识别缺少产品场景视图、有序链路、验收映射列及未来版本能力混入当前交付。
- 增加产品文档检查器回归和蓝图/版本 PRD 的行为评测场景。
- planning 阶段将规格缺口列为阻断项，同时允许测试资产仍处于规划状态；reviewer 对缺失文档根和越界路径配置返回配置错误。

## 1.3.0 — 2026-09-28

- 路线图规划版本支持 `Vx-规划.md` 或 `Vx-主题.md`，并强制每个规划版本唯一主文档及索引链接。
- 追踪矩阵增加功能文档双向覆盖、功能链接、接口/数据/E2E 映射和 E2E 编号解析检查。
- 技术设计增加单元契约、伪代码、分支到 AC、约束备注、主文档绑定和高风险功能独立设计检查；支持从来源链接推断 `feature_id`。
- 增加 E2E/性能矩阵最低审计列和 ADR 结构检查；功能元数据与来源追踪在严格模式下纳入门禁。
- `docs-gate` 在 planning/development/release 阶段统一运行结构检查，新增 `structureCheck` 与 `strictStructure` 配置。

## 1.2.1 — 2026-09-28

- 修正使用手册中的版本号、固定版本安装标签和当前版本链接，使文档与 `spec-docs-v1.2.0` 的功能代码及后续修正文档版本保持一致。
- 将发布说明从“未发布”状态改为可追踪的已发布版本记录。

## 1.2.0 — 2026-09-27

### 交付范围与质量门禁

- 功能 frontmatter 新增 `delivery_scope`、`planning_only`、`delivery_slice`，阻止未来版本功能混入当前版本实现状态或交付统计。
- `check-docs --strict` 增加接口清单、OpenAPI `operationId` 映射、错误矩阵和数据治理最小章节检查；不适用项必须写明理由。
- 统一 E2E 编号允许字母后缀（如 `V1-E2E-09B`）。
- `docs-gate` 增加 `planning`、`development`、`release` 阶段；规划阶段不要求伪造发布证据，发布阶段保留完整审批和提交绑定。

### 兼容性与回归

- 旧版 `docs-policy.json` 未配置 `requireDeliveryMetadata` 时兼容运行并给出迁移告警；新骨架显式启用严格交付范围规则。
- 未配置 `openapi` 时自动推断活动版本的 OpenAPI 文件；未配置 `quality` 时仍启用接口和数据最低审计章节检查。
- 结构自测覆盖旧版 policy、默认 OpenAPI 路径、默认质量规则和显式交付元数据门禁。

## 1.1.0 — 2026-09-23

根据全量代码审查修复 CLI 与发布门禁缺陷，收敛模板权威来源，并扩展可执行回归。

**脚本与安全**

- `init-docs --dry-run` 改为只生成计划；S/M/L policy 真实区分必需结构；新增非覆盖 `--adopt`；自定义目录提示正确并拒绝 `--dir .`、`..`；写入路径拒绝符号链接越界。
- `docs-gate --init` 可从已初始化的 `docs-policy.json` 启动；权威文档缺失/为空、错误配置、审批时间、完整 commit、报告/manifest 绑定均 fail closed。
- `release.enforce` 生效为常开发布判定；权威摘要错误非零退出；证据清单与相关路径拒绝符号链接越界。
- E2E 状态统计重算并校验总数；发布模式拒绝全跳过、失败、flaky、未登记通过 AC；报告必须配 manifest；被测源码提交之后的源码变更不能靠重算摘要伪装。
- 性能报告绑定仓库内负载配置与摘要；报告、manifest、profile、AC 资产和配置路径均限制在仓库内。

**规则与模板**

- HTTP 字段 schema、类型、约束与示例唯一维护在 OpenAPI；功能文档引用 operationId 和业务语义。
- 实现状态唯一维护在版本实现状态表；功能 frontmatter 与索引不再复制状态值，结构检查核对功能 ID 与状态表。
- 风险分级显式覆盖 PII；存量接入改用安全合并与并行目录流程，禁止整体移动包含新体系的 docs 根目录。

**回归与评测**

- 结构自测覆盖 tier、dry-run、adopt、GWT、状态单一来源、占位符和目录穿越。
- 门禁自测覆盖空配置初始化、全跳过 E2E、manifest 缺失/不一致、短 commit、审批日期、源码提交后变更、AC 资产/命令缺失、强制发布模式与路径逃逸。
- 扩充评测场景以覆盖证据门禁攻击面和存量项目接入。模型 subagent 对照仍需在可用的 provider 环境中执行。

## 1.0.0 — 2026-09-22

首个完整体：方法论 + 骨架 + 结构检查 + 交付门禁 + 自测。

**方法论（references/）**

- `methodology.md`：总纲——12 条不变式、四问题层、追踪链、S/M/L 裁剪、上手路径、反模式
- `doc-map.md`：什么内容写哪份、命名规则、权威来源、示例/报告/图表目录约定
- `feature-spec.md`：功能拆分、七段结构、双状态（规格/实现）、风险分级、技术设计（含异步型可选小节）、AC 双表
- `governance.md`：编号族与插入式后缀、状态机、三道门禁、DoR/DoD、变更联动、冲突处理、维护与归档、禁止做法
- `evidence.md`：证据分级、验证记录、批次 manifest、轮次证据规则、两层检查
- `docs-gate.md`：交付门禁设计——配置/证据模型、四类报告契约、检查矩阵、审批摘要、退出码
- `adoption.md`：存量项目接入 playbook（先止损、后搬家、再追踪；状态回填规则）

**骨架（assets/skeleton/）**

- `docs/` 8 个编号目录、72 个模板（含 E2E 执行空间 7 件、性能与容量、发布空间、ADR、专项测试设计与高风险修复清单模板、报告目录规范）
- `docs-policy.json` 结构策略、`docs-gate.json` 门禁策略、`docs-evidence.json` 证据清单（均支持自定义文档目录）

**脚本（scripts/）**

- `init-docs.mjs`：生成骨架（`--tier s|m|l`、`--dir`、`--gate/--no-gate`、`--force`、`--dry-run`）
- `check-docs.mjs`：结构检查（必需文件、链接、编号一致性、AC 列、索引登记、占位符；`--strict`、读 policy.root）
- `docs-gate.mjs`：交付门禁（报告重算、manifest 摘要、审批与权威文档摘要绑定、提交绑定、AC 链路、秘密扫描、`--release`、`--init`、`--scaffold-report`）
- `selftest-docs-gate.mjs`：门禁自测 9 场景
- `selftest-check-docs.mjs`：结构检查自测 9 场景（含自定义文档目录）

**健壮性修复**

- `check-docs` 与 `docs-gate` 的仓库根改为按脚本位置推断（脚本位于 `<仓库根>/scripts/`），从任意目录调用均可用，可用 `--repo` 覆盖。
- 新增 `init-docs --refresh`：只更新项目内的脚本副本，不动 docs/ 与配置。
- 骨架内所有跨目录链接在自定义文档目录（`--dir`）下保持有效。

**评测（进行中）**

- `evals/evals.json`：3 个场景（S 档建体系 / 功能文档与回写 / 口径冲突治理）与可判定断言。
- 带 skill 组已在本地实跑并记录于 `spec-docs-workspace/iteration-1/`；基线对照待 subagent 服务恢复后补齐。

**已知取舍**

- 未包含 `AGENTS.md` 模板与 CI 工作流模板（按用户决定暂缓）。
- 未包含 JSON Schema（形状由脚本内校验保证）。
- S 档目前仍生成全量目录，剪裁需手工执行并同步 policy（已登记为改进项）。
