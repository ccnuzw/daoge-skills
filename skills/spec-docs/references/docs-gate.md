# docs-gate：交付证据门禁设计与规范

> 实现见 `scripts/docs-gate.mjs`；配置模板 `assets/skeleton/docs-gate.json`；证据清单模板 `assets/skeleton/docs-evidence.json`；自测见 `scripts/selftest-docs-gate.mjs`。

## 1. 定位

两层检查分工明确，互不替代：

| 层 | 工具 | 回答 | 通过意味着 |
| --- | --- | --- | --- |
| 结构层 | `check-docs.mjs` | 文档体系是否自洽（目录、链接、编号、索引、AC 列） | 可以继续工作 |
| 交付层 | `docs-gate.mjs` | 当前构建是否具备完整、未过期、相互绑定的交付证据 | 可以交付 |

关键约束：结构检查通过**不代表**交付就绪；`docs-gate` 缺证据时必须失败，且不允许通过填写虚构报告来消除阻塞。

## 2. 设计原则

1. **重算而非采信**：报告里手填的“通过”不被信任；门禁重新计算退出码、用例统计、性能比较与发布检查项。
2. **绑定而非快照**：证据必须绑定当前 git commit 与权威文档摘要；权威文档变化后原审批自动失效。
3. **只读不执行**：门禁不运行任何业务命令，只读文件与 git 状态；执行证据由项目自己的流程产出。
4. **仓库内、可脱敏**：报告必须在仓库内；门禁对报告与 manifest 做秘密模式扫描，命中即失败但不打印原值。
5. **失败保留**：manifest 与报告只追加不覆盖；门禁实时计算 `asset_sha256`，证明报告对应当时源码。

## 3. 配置：`docs-gate.json`

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `activeVersion` | 从 docs-policy 推断 | 便于人阅读；编号校验以 docs-policy 为准 |
| `policy` | `docs-policy.json` | 结构策略来源；门禁复用其 `featureDoc`/`ids`/`traceability` |
| `evidence` | `docs-evidence.json` | 当前证据清单路径 |
| `authorityFiles` | `[]` | 参与摘要计算与审批绑定的权威文档（版本总览、实现状态、接口契约、openapi、数据模型、冻结决策、E2E 规范等） |
| `approvalMaxAgeDays` | `30` | 审批有效期；`0` 表示不过期（仍要求摘要匹配） |
| `requiredReports` | `["development","e2e","release"]` | 必须存在的报告类型；`performance` 由项目按需加入 |
| `requiredApprovals` | `["product","technical","release_manager"]` | 发布必需审批角色；按项目增删（如 `finance`） |
| `allowedEnvironments` | 见脚本默认值 | 每类报告接受的环境白名单；本地 mock 不能改名成门禁环境 |
| `commandRegistry` | `null` | 允许的命令前缀列表；普通检查未配置时告警，发布模式拒绝跳过登记校验 |
| `requireCommitBinding` | `true` | 证据 commit 必须是完整 SHA 并存在于当前分支历史；该提交之后只允许追加证据文件 |
| `requireManifest` | `true` | 每份报告必须有配对 manifest 和源码摘要 |
| `release.enforce` | `false` | 等价于常开 `--release` |
| `release.allowPendingACs` | `false` | 发布模式是否允许未闭环 AC（默认不允许） |
| `secretScan.enabled / patterns / allowPaths` | `true / [] / []` | 秘密扫描开关、自定义正则、豁免路径 |

配置、策略、证据、报告、manifest、profile 与 AC 资产路径必须留在仓库内；符号链接不能将读写目标带出仓库。`release.enforce=true` 会让不带 `--release` 的常规运行也使用发布级判定。

## 4. 证据清单：`docs-evidence.json`

只保存**当前**证据指针，不保存历史批次（历史批次留在报告目录）。

```json
{
  "activeVersion": "V1",
  "commit": "<git commit 或构建标识>",
  "generatedAt": "<ISO 时间>",
  "approvals": {
    "proposal_id": "<提案编号>",
    "authority_digest": "sha256:<--authority-digest 输出>",
    "approved_by": { "product": "", "technical": "", "release_manager": "" },
    "approved_at": "<带时区时间>"
  },
  "reports": {
    "development": { "path": "docs/.../报告/dev-YYYYMMDD.json", "environment": "local" },
    "e2e": { "path": "docs/.../报告/e2e-YYYYMMDD.json", "environment": "local-mock" },
    "performance": { "path": "docs/.../报告/perf-YYYYMMDD.json", "environment": "staging" },
    "release": { "path": "docs/.../报告/release-YYYYMMDD.json", "environment": "production-gate" }
  }
}
```

## 5. 报告契约

所有报告是 JSON，`kind` 与清单键一致；每份报告必须有配对 `<name>-manifest.json`。

### development

```json
{
  "kind": "development",
  "environment": "local",
  "clean_checkout": true,
  "steps": [{ "command": "pnpm typecheck", "exit_code": 0 }],
  "services": [{ "name": "api", "url": "http://127.0.0.1:3000", "http_status": 200, "ready": true }]
}
```

门禁重算：必须是干净检出、步骤命令退出码全为 0，且至少一个服务返回 2xx/3xx 并明确 `ready=true`；任一项缺失或异常即失败。

### e2e

```json
{
  "kind": "e2e",
  "environment": "local-mock",
  "command": "...",
  "cases": [{ "id": "E2E-01", "status": "passed" }],
  "stats": { "expected": 1, "passed": 1, "failed": 0, "skipped": 0, "unexpected": 0, "flaky": 0 }
}
```

门禁重算：各状态计数必须是非负整数且总和等于 expected；必须至少有一个 passed；failed/unexpected/flaky 均失败。跳过量在普通模式告警、发布模式失败。`cases` 与 `stats` 至少存在其一。

### performance

```json
{
  "kind": "performance",
  "environment": "staging",
  "profile": { "id": "perf-v1", "path": "docs/performance/profile.json", "sha256": "<文件摘要>", "approved_by": "<角色>", "approved_at": "<时间>" },
  "scenarios": [
    { "id": "PERF03", "metric": "p95_ms", "unit": "ms", "comparator": "lte", "threshold": 100, "measured": 87.2 }
  ]
}
```

门禁重算每个场景的比较符（支持 `lte/gte/lt/gt/eq`），不信任手填结论；缺少已批准 profile 即失败。

### release

```json
{
  "kind": "release",
  "environment": "production-gate",
  "commit": "<与证据清单一致>",
  "artifact": { "id": "build-123", "digest": "sha256:..." },
  "checks": { "migration": true, "backup": true, "recovery": true, "security": true, "smoke": true, "observation": true, "rollback": true },
  "approvals": { "product": "", "technical": "", "release_manager": "" },
  "e2e_report": "docs/.../报告/e2e-YYYYMMDD.json",
  "performance_report": "docs/.../报告/perf-YYYYMMDD.json",
  "known_risks": []
}
```

门禁校验：检查项全为 true、制品标识存在、必需审批角色齐全、`known_risks` 为数组（可为空）、绑定的 e2e/性能报告与证据清单一致。

## 6. manifest 契约

每份报告必须配对 `<报告名>-manifest.json`：

```json
{
  "run_id": "...", "environment": "...", "code_version": "<构建标识>", "commit": "<完整源码 SHA>",
  "command": "...", "working_directory": "...", "exit_code": 0,
  "stats": { "expected": 1, "passed": 1, "failed": 0, "skipped": 0, "unexpected": 0, "flaky": 0 },
  "started_at": "<带时区时间>", "test_report": "<报告文件名>",
  "asset_sha256": { "<被测源码或脚本>": "<sha256>" },
  "cleanup": "...", "sanitization": "...", "scope": "...", "limitations": "...", "prior_attempts": []
}
```

门禁要求：必需字段齐全、`exit_code=0`、完整源码 commit 与证据一致、`asset_sha256` 非空且逐项重算一致、报告与 manifest 环境及文件名一致。`limitations` 用于防止本地证据被升格为生产结论。

## 7. 审批与摘要绑定

```sh
node scripts/docs-gate.mjs --authority-digest   # 只读输出当前摘要与逐文件摘要
```

权威文档缺失或越界时摘要命令以退出码 `1` 失败；`--json` 同时返回 `ok`、错误与告警数组，不会输出可被误用的成功摘要结果。

- 摘要 = `sha256` 按“路径排序 + `路径:文件摘要`”拼接后的哈希。
- 审批必须发生在完整提案展示之后；权威文档任何改动都会使摘要失配，原审批自动失效。
- 普通检查中审批过期会告警；发布模式中审批过期、缺失或时间无效都会失败。

## 8. AC → 测试资产 → 命令 → 证据

门禁扫描结构策略指定的功能文档，识别含 `AC` 与 `状态` 列的表格（自动化测试映射、AC 逐项测试设计两套表都支持）：

- 状态声称已通过（含“通过/Passed”且不含“未/待/失败/Pending”）时，逐条校验反引号中的目标资产路径存在；不存在即失败。
- 状态为未执行/未创建/待补/规划中/待本次验证时：普通模式告警，`--release` 按错误处理（除非配置允许）。
- 命令若配置了 `commandRegistry`，不在登记表中的命令告警；发布模式要求已通过 AC 的命令必须登记，且不能跳过命令登记校验。

## 9. 退出码与输出

| 退出码 | 含义 |
| --- | --- |
| 0 | 通过（可能带告警） |
| 1 | 未通过：缺证据、审批失效、提交不匹配、断言不达标、秘密命中、AC 未闭环（发布模式） |
| 2 | 配置/用法错误 |

输出为 `文件:行 [CODE] 说明`；`--json` 输出结构化结果；`--quiet` 只保留退出码。

## 10. 使用流程

```sh
# 1. 生成配置与证据模板（或由 init-docs --tier l 生成）
node scripts/docs-gate.mjs --init

# 2. 产出报告：开发环境 / E2E / 性能 / 发布（项目自己的流程与脚本）
#    报告与 manifest 放入执行空间的 报告/ 目录
#    可用 --scaffold-report 生成符合契约的空模板（dev|e2e|perf|release）
node scripts/docs-gate.mjs --scaffold-report e2e --environment local-mock

# 3. 计算摘要并完成审批
node scripts/docs-gate.mjs --authority-digest
#    → 把摘要写入 docs-evidence.json 的 approvals.authority_digest

# 4. 门禁：日常用普通模式，发布用发布模式
node scripts/docs-gate.mjs
node scripts/docs-gate.mjs --release
```

CI 建议：结构检查每次提交运行；`docs-gate` 只在候选发布分支或发布流水线运行，并在缺少真实环境证据时按预期失败。

## 11. 明确不做

- 不执行业务命令、不产出报告、不做部署。
- 不校验审批人身份真实性（只能校验角色齐全、摘要匹配与时间有效）；身份由流程与平台负责。
- 不替代人工签字；资金、真实外部依赖、密钥与备份恢复不得豁免。
- 秘密扫描是启发式，命中需要人工确认，未命中不代表报告一定安全。
