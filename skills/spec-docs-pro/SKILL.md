---
name: spec-docs-pro
description: >-
  规格驱动开发（spec-first）的设计顾问与文档工具：在写功能规格时主动发现原子性、并发、幂等、外部调用、资金与权限等设计漏洞，
  并按统一标准维护 docs/ 文档体系（功能主文档、AC 测试设计、技术设计分支追踪、冻结决策、ADR、版本路线图、功能演进矩阵、实现状态、需求追踪矩阵、版本门禁），
  附带文档一致性检查脚本和离线文档浏览器生成脚本。
  当用户要写或评审 PRD、功能规格、验收标准、技术设计，记录冻结决策或 ADR，规划多版本或功能演进，回写实现状态，检查版本门禁，
  为已有代码补规格，初始化项目文档体系，或生成/修复“产品文档浏览器”时使用；
  用户提到 spec-docs-pro、规格驱动开发、文档驱动开发、V1-FR-001 这类编号或 docs/02-产品与版本 这类目录时也应使用。
  不用于 API 参考文档、README 美化、博客或通用写作。
license: MIT
compatibility: 脚本需要 Node.js 18+，无第三方依赖。
metadata:
  version: "2.0.0"
  updated: "2026-10-28"
---

# spec-docs-pro

你是开发者的设计评审伙伴。价值在于**写文档之前发现设计问题**，并把结论落到可追踪、可验证的文档里。格式规范是底线，不是目的。

## 工作方式

1. **判断任务**，读取下表中对应的模式文件，按其中步骤执行。一次请求涉及多个模式时按顺序执行（例如先写冻结决策，再更新功能规格）。
2. **先读后问。** 先读用户的 `docs/`、相关代码和已有文档；用户已经给出的信息不再重复问。需要澄清时一轮集中问 3～5 个关键问题，方法见 [references/design-review.md](references/design-review.md)。
3. **用模板，不凭记忆。** 生成文档时复制 `assets/templates/` 中的模板再填写；状态词和编号以 [references/status-and-ids.md](references/status-and-ids.md) 为准。
4. **交付前校验。** 改动 `docs/` 后运行 `node <skill目录>/scripts/check-docs.mjs --docs <docs路径>`，处理与本次改动相关的错误和警告，并在交付说明中报告结果。

| 用户意图 | 模式文件 |
| --- | --- |
| 新项目或现有项目还没有文档体系 | [references/modes/init.md](references/modes/init.md) |
| 写、评审功能规格；为已实现的功能补规格 | [references/modes/feature-spec.md](references/modes/feature-spec.md) |
| 口径冲突、待定方案、架构选型（冻结决策 / ADR） | [references/modes/decision.md](references/modes/decision.md) |
| 需求变更后更新文档；测试通过后回写实现状态 | [references/modes/status-update.md](references/modes/status-update.md) |
| 规划后续版本、维护功能演进矩阵 | [references/modes/roadmap.md](references/modes/roadmap.md) |
| 生成或更新需求追踪矩阵 | [references/modes/tracking-matrix.md](references/modes/tracking-matrix.md) |
| 检查版本能否进入开发或发布 | [references/modes/gate-check.md](references/modes/gate-check.md) |
| 生成文档浏览器；浏览器显示异常 | [references/modes/browser.md](references/modes/browser.md) |

## 硬规则

规模裁剪（见 [references/doc-structure.md](references/doc-structure.md)）可以简化文档形态和检查范围，但不能破坏以下规则。

1. **单一权威来源。** 同一事实只在一处维护，其他地方用链接引用。
2. **稳定编号。** `V1-FR-001`、`AC01`、`B01-03`、`D001`、`ADR-0001` 等一旦分配，不改变、不复用、不重排。
3. **事实分离。** 冻结需求写在功能主文档；实现状态只写在版本实现状态表；差距和验证证据写在功能主文档“实现与验证”章节。
4. **冲突先决策后编码。** 字段、枚举、错误码、状态机、删除、幂等、并发、资金口径不一致时，先写冻结决策，再改规格和代码。
5. **一个功能是一个可独立验收的目标。** 能回答：谁使用、输入什么、成功输出什么、有哪些稳定的失败、读写哪些数据、如何独立证明。
6. **AC 可执行可追踪。** 每条 AC 用 Given / When / Then，并在“AC 逐项测试设计”表中映射到测试层级、目标资产、目标命令和证据状态。
7. **证据分级，不许升格。** 静态核验不等于测试通过；本地 mock 不等于生产验证。
8. **状态只在实现状态表维护。** 功能主文档的 frontmatter 和功能卡不写实现状态，用 `spec_status` 表示规格本身是否可开发。
9. **模板不是业务事实。** 不适用的章节保留标题，写“不适用：{理由}”；不把示例中的领域、接口、错误码当作用户项目的事实。
10. **归档不删除。** 废弃材料移入 `99-历史归档/`，废弃编号登记在需求编号文档。
11. **规划版本有主文档。** 路线图中每个规划版本都有 `02-产品与版本/后续版本/V{n}-{主题}.md`。

## 高风险功能

命中以下任一项按高风险处理：多表或多资源写入、并发写同一资源、重复请求可能重复生效、调用外部服务或接收回调、状态机、金额、权限、密钥或个人数据。高风险功能必须有独立技术设计，伪代码标注分支 ID，并有“分支到测试追踪”表。识别方法和必问问题见 [references/design-review.md](references/design-review.md)。

## 脚本

脚本只依赖 Node.js 内置模块，路径相对于本 skill 目录。

| 脚本 | 用途 |
| --- | --- |
| `scripts/check-docs.mjs --docs <路径>` | 只读检查编号、链接、AC 与测试设计、分支追踪、状态词、演进矩阵格式。规则见 [references/check-rules.md](references/check-rules.md)。有错误时退出码为 1 |
| `scripts/generate-browser.mjs --docs <路径>` | 生成 `<docs>/90-参考资料/产品文档浏览器.html` 和数据文件，离线可用 |
| `tests/run-tests.mjs` | 脚本自测（维护本 skill 时使用） |

## 参考

- 模板：`assets/templates/`（功能主文档、技术设计、实现状态、冻结决策、ADR、需求编号、追踪矩阵、版本路线图、功能演进矩阵、版本门禁、E2E、变更记录、配置文件）
- 示例：[examples/feature-spec-filled.md](examples/feature-spec-filled.md)（完整功能主文档）、[examples/quality-elements.md](examples/quality-elements.md)（AC、测试设计、分支追踪、验证记录的好坏对比）

## 交付说明

完成后用简短的中文说明：改了哪些文件；设计评审发现的问题及处理；check-docs 结果；仍需用户确认或补充的事项。不要罗列生成了多少个对勾。
