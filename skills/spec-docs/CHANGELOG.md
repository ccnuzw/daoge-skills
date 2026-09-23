# Changelog

## 1.1.1 — 2026-09-24

- 完整补充使用说明：定位、适用边界、与 `daoge-docs` 的选择关系、三种工作模式、S/M/L 档位、核心规则、目录职责和推荐 CI 接入。
- 补充初始化、存量接入、结构检查和交付证据门禁的常用命令、输入输出与证据边界。
- 增加参考资料索引、自测说明和版本发布说明。

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
