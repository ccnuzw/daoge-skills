# 事实注册表与统一状态模型

## 1. 目的

`docs-facts.json` 是文档体系的机器可读导航层。它登记事实的稳定 ID、事实类型、生命周期、规格状态、实现状态、交付切片、权威来源和证据引用；它不复制功能规则、HTTP schema、数据库 DDL 或测试结果。

Markdown 仍然承载人类可读的业务语义，代码、OpenAPI、migration 和报告仍然是各自事实的权威来源。注册表只回答“事实是什么、当前处于哪个阶段、到哪里读取权威内容”。

## 2. 文件位置与启用

默认位置是项目根目录的 `docs-facts.json`，由 `init-docs` 生成。存量项目可以先保留模板而不启用检查；在 `docs-policy.json` 中设置：

```json
{
  "facts": {
    "enabled": true,
    "file": "docs-facts.json",
    "strict": true
  }
}
```

`enabled=false` 或未配置时，现有项目保持兼容运行；`enabled=true` 后，`check-docs` 校验注册表自身及其与功能文档、实现状态和变更切片的最小关系。

## 3. 事实模型

每条 `facts[]` 至少包含：

| 字段 | 含义 |
| --- | --- |
| `id` | 稳定事实 ID，不能复用或改写 |
| `type` | `requirement`、`nfr`、`release_gate`、`feature`、`operation`、`entity`、`decision`、`acceptance`、`evidence`、`scenario`、`constraint`、`risk`、`test_asset`、`artifact` 或 `migration` |
| `title` | 人类可读名称，不作为引用锚点 |
| `lifecycle` | `active`、`planned`、`deprecated`、`archived` |
| `spec_status` | `draft`、`ready`、`frozen` |
| `implementation_status` | `planned`、`in_progress`、`partial`、`implemented`、`locally_verified`、`awaiting_acceptance`、`completed`、`blocked` |
| `delivery_scope` | `active` 或 `future` |
| `delivery_slice` | 所属交付切片 ID |
| `authority` | 项目内权威文件路径；事实规则写在该处 |
| `references` | 辅助阅读路径，不代表第二权威来源 |
| `evidence` | 证据 ID 或仓库内证据路径，未执行时为空数组 |

`implementation_status` 的英文枚举是机器值；现有实现状态 Markdown 可以继续使用中文展示。二者映射为：

| 注册表 | 现有文档 |
| --- | --- |
| `planned` | 规划中 |
| `in_progress` | 开发中 |
| `partial` | 部分实现 |
| `implemented` | 基础实现 |
| `locally_verified` | 本地验证 |
| `awaiting_acceptance` | 待验收 |
| `completed` | 已完成 |
| `blocked` | 阻塞 |

## 4. 状态边界

四个维度必须分开：

1. `spec_status` 说明输入是否足以开发，不说明代码是否存在。
2. `implementation_status` 说明代码与验证做到哪一步，只能由实现状态和事实注册表维护。
3. `lifecycle` 说明事实是否仍然是当前输入；`deprecated` 不等于已删除，必须保留替代关系或归档映射。
4. `delivery_scope` 说明是否计入当前版本交付；`future` 不能进入当前实现状态或发布统计。

证据等级继续使用 `evidence.md` 的四级模型。注册表中的 `evidence` 只能引用真实记录，不能把 `planned`、`mock` 或静态核验自动升级成完成状态。

## 5. 交付切片

`slices[]` 是交付工作的最小上下文边界。切片必须有唯一 ID、版本、状态、权威范围文档、功能集合和直接依赖。推荐状态：`planned`、`ready`、`frozen`、`in_progress`、`verified`、`completed`、`blocked`。

切片状态不是功能实现状态：切片可以处于 `in_progress`，其中某个功能仍为 `partial`；切片只有在关联功能和验收证据闭环后才可为 `completed`。

## 6. 迁移顺序

1. 先把当前版本功能和交付切片登记到 `facts[]`/`slices[]`，不改变 Markdown 规则。
2. 再为公共 operation、实体和决策补充事实条目，并把 `authority` 指向已有权威契约。
3. 最后将证据 ID 和报告路径回填到 `evidence`，由 `docs-gate` 继续判断真实性。

注册表与文档冲突时，不能自行选择一方；先写冻结决策，再同步注册表和权威文档。

## 6.1 Markdown 派生字段同步

功能文档 frontmatter、功能卡规格状态和版本实现状态表属于人类可读权威输入；`docs-facts.json` 中对应的 `lifecycle`、`spec_status`、`implementation_status`、`delivery_scope`、`delivery_slice` 和 `authority` 可以由它们派生检查。

```bash
node scripts/facts-sync.mjs --dir . --check --json
node scripts/facts-sync.mjs --dir . --write --json
```

默认模式只读并报告 `FEATURE_MISSING`、`FACT_DRIFT`、`FEATURE_ORPHAN` 和 `IMPLEMENTATION_STATUS_MISSING`。只有显式 `--write` 才更新这些派生字段；relations、evidence、evidence_policy 和其他人工维护字段会被保留。写入后仍应运行 `check-docs`、`traceability-report` 和 `spec-diff`。

## 7. 显式关系图

第二阶段可在注册表顶层增加 `relations`。每条关系只表达事实之间的可追踪关系，不复制事实内容：

```json
{
  "from": "V1-FR-001",
  "to": "V1-OP-install",
  "type": "defines_operation",
  "authority": "docs/04-技术架构/当前版本/V1-接口契约.md"
}
```

支持的关系类型：

| 类型 | 含义 |
| --- | --- |
| `contains` | 版本/切片包含功能或验收目标 |
| `depends_on` | 实现或验收依赖另一个事实 |
| `defines_operation` | 功能或需求定义公共操作 |
| `reads_entity` / `writes_entity` | 功能或操作读写实体 |
| `verified_by` | 事实由验收或证据验证 |
| `decided_by` | 事实由冻结决策或 ADR 决定 |
| `supersedes` | 当前事实替代历史事实 |
| `implemented_by` | 事实落到代码、migration 或测试资产 |

关系的 `from`/`to` 必须指向已登记事实或切片 ID；`authority` 必须是仓库内真实文件。`change-impact` 会沿显式关系图做有方向的影响传播，并把传播路径输出为 `graph.paths`。没有关系图的旧项目继续使用稳定 ID、operationId、实体和路径的文本兼容分析。
