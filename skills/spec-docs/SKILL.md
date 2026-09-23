---
name: spec-docs
description: 为任意项目建立、填充和维护“文档驱动开发”文档体系（文档骨架、功能规格、需求编号与追踪矩阵、接口/数据契约、验收证据链、版本门禁、冻结决策与 ADR）。当用户要为新项目搭 docs/ 文档骨架、整理现有项目文档、写功能规格/需求/接口/数据/测试/验收文档、建需求追踪或 ADR、要求 AI 按文档开发或核查实现、准备交接评审，或提到文档驱动开发、文档体系、规格文档、需求追踪、docs bootstrap、spec-first 时，都应使用本 skill——即使没有点名 spec-docs。Use whenever the user mentions document-driven development, spec docs, requirement traceability, ADRs, acceptance criteria mapping, or asks for docs scaffolding or templates in any project.
metadata:
  version: "1.1.1"
  updated: "2026-09-24"
---

# spec-docs：文档驱动开发

这套体系让开发者和 AI 在**有限、明确、无冲突**的上下文里工作：范围由版本文档决定，行为由功能文档决定，跨功能一致性由公共架构决定，实际做到什么由代码和证据决定。目标产物是**可解释（每个结论有来源）、可维护（一处修改知道要同步哪里）、可交接（新人或新 AI 会话能按索引找到入口）**的文档集，而不是一堆写给人看的说明文。

文档默认用中文；`README.md`、`openapi.yaml`、API 路径、数据库字段、代码标识保留行业英文命名。

## 先判断要做哪件事

| 用户意图 | 模式 | 读取 |
| --- | --- | --- |
| 新项目 / 现有项目还没有 docs 体系 | A 建体系 | [references/methodology.md](references/methodology.md) + [references/doc-map.md](references/doc-map.md)，然后跑 `scripts/init-docs.mjs` |
| 存量项目已有乱/旧文档，要收敛 | A' 接入 | [references/adoption.md](references/adoption.md)（先止损、后搬家、再追踪） |
| 新增或修改一个功能文档、技术设计 | B 写规格 | [references/feature-spec.md](references/feature-spec.md) + [references/governance.md](references/governance.md) |
| 实现核查、状态回写、冲突冻结、归档迁移、证据评审 | C 治理 | [references/governance.md](references/governance.md) + [references/evidence.md](references/evidence.md) |
| 只要一份现成模板 | — | 直接复制 `assets/skeleton/docs/` 下对应文件 |
| 要检查文档结构是否破 | — | 跑 `scripts/check-docs.mjs`（或项目内已安装的副本） |
| 要判断能否交付（缺证据、审批失效、提交不匹配） | C 治理 | [references/docs-gate.md](references/docs-gate.md)，跑 `scripts/docs-gate.mjs`（L 档默认生成） |

## 硬规则

以下十条是操作规则：规模裁剪可以简化文档形态与检查范围，但不能破坏单一来源、稳定追踪与证据真实性。完整原则及优先级见 methodology。

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

## 模式 A：新项目建体系

1. 问清或推断：项目一句话目标、活跃版本号（默认 `V1`）、规模档次（S/M/L，见 methodology 第 7 节）、代码仓库根目录。
2. 运行骨架生成：
   ```sh
   node <skill目录>/scripts/init-docs.mjs --target <项目根> --name "<项目名>" --version V1 --tier m
   ```
    `--tier s|m|l` 写入 `docs-policy.json`，决定结构检查必需范围；完整模板树会保留以维持链接完整，S 档只需维护 policy 标记为必需的核心文档，不要手动删除可选模块。
3. 按顺序填充，不要并行铺开：产品蓝图 → 版本路线图 → 当前版本总览/产品需求 → 功能编号表 → 功能查找表 → 公共基线（架构/接口/数据/错误码）→ 测试策略 → 发布空间。
4. 功能文档最后写：每个可独立验收目标一份主文档，高风险功能加一份技术设计。先登记索引和编号，再创建文件。
5. 跑 `node <项目根>/scripts/check-docs.mjs`，让结构问题在内容还少的时候暴露。
6. 告诉用户哪些章节是占位（`<!-- 填写说明 -->` 或 `<>`），以及下一步该填哪一份。

## 模式 B：写一个功能文档

1. 先判断拆分是否合格（硬规则 5）；不合格先和用户讨论拆分，不要直接写。
2. 查现有编号表和功能索引，分配稳定功能 ID；新功能先登记再创建文件。
3. 按 [references/feature-spec.md](references/feature-spec.md) 的七段结构写主文档：YAML frontmatter + 功能卡（规格状态 Draft/Ready）+ 目标与边界 + 需求/接口/数据/验收/实现；实现状态只维护在版本实现状态文档。
4. 判定风险等级：资金、权限、秘密、PII、路由、外部回调、异步任务、动态制品、跨系统状态必须独立技术设计；标准风险把技术设计内联在主文档末尾。
5. 写 AC（Given/When/Then），并填写两张映射表：自动化测试映射（按 AC 范围聚合）与 AC 逐项测试设计（测试层级/目标资产/目标命令/初始资产状态）。
6. 对照 [references/governance.md](references/governance.md) 的 Definition of Ready / Definition of Done 检查，未 Ready 不写生产代码。
7. 回写：功能索引、查找表、追踪矩阵、实现状态、公共契约（接口/数据/错误码变化时）。

## 模式 C：核查与治理

- **实现核查**（只读）：对照需求、接口、数据、错误、页面、测试和代码，输出“已满足 / 部分满足 / 未实现 / 文档与代码冲突”四类结论及证据（文件 + 行号或命令输出）。不要修改代码。
- **状态回写**：只在有证据时更新实现状态，附日期、环境、构建标识、命令、结果、遗留风险；性能结论必须来自已批准的负载配置，静态预检不得写成压测通过。
- **执行空间维护**：端到端验收与性能容量各自维护 规范 → 环境/夹具/顺序 → 用例矩阵 → 验证证据 四层；专项/轮次测试设计单独成文并带日期，不进主矩阵；批次证据只追加不覆盖，并配 `<run_id>-manifest.json`（含 code_version、asset_sha256、limitations）。
- **范围与登记分离**：规划中的设计扩展可以登记编号并维护设计稿（先放 `04-技术架构/当前版本/`），但必须标注状态，不视为进入交付范围或已实现。
- **冲突处理**：先形成冻结决策，再同步主文档、公共基线、代码、测试，最后更新追踪矩阵。
- **归档迁移**：新家先就位，旧路径写进迁移映射，再删除旧文件；归档目录内容默认不是当前开发输入。

## 完成前自检

- 文档结构变化后跑过 `check-docs.mjs`，链接、索引、编号零错误。
- 每个 AC 有映射；每条映射的证据状态属实（不是把“计划执行”写成“通过”）。
- 新增/修改了接口、字段、错误码时，公共契约和机器可读文件（openapi）同步。
- 高风险功能有独立技术设计，且分支 ID 映射到 AC/E2E。
- 冲突项都有决策编号；被取代的旧结论已标注取代关系。
- 证据报告与 manifest 成对存在，状态带环境与日期；规划中能力没有被写成已实现。
- 没有在多个文件里维护同一事实。

## 文件索引

| 文件 | 何时读 |
| --- | --- |
| [references/methodology.md](references/methodology.md) | 想理解体系全貌、做取舍、决定规模档次时 |
| [references/doc-map.md](references/doc-map.md) | 要确定“这件事应该写进哪份文档”时 |
| [references/adoption.md](references/adoption.md) | 存量项目接入：归档迁移、编号回填、状态回填、渐进接门禁时 |
| [references/feature-spec.md](references/feature-spec.md) | 写功能主文档、技术设计、AC 时 |
| [references/governance.md](references/governance.md) | 门禁、状态机、变更联动、维护与评审时 |
| [references/evidence.md](references/evidence.md) | 写验证记录、证据报告、设计自动检查时 |
| [references/docs-gate.md](references/docs-gate.md) | 设计/使用交付证据门禁、排查门禁失败时 |
| `assets/skeleton/docs/` | 需要可复制的空文档骨架时 |
| `scripts/init-docs.mjs` | 生成项目骨架时（`--gate` 或 `--tier l` 附带门禁）；存量项目先用 `--adopt` 只新增缺失文件 |
| `scripts/check-docs.mjs` | 校验结构、链接、编号、索引一致性时 |
| `scripts/docs-gate.mjs` | 校验交付证据链（报告重算、审批摘要、提交绑定、秘密扫描）时 |
| `scripts/selftest-check-docs.mjs` | 验证检查器、档位策略、dry-run、adopt 与自定义目录行为时 |
| `scripts/selftest-docs-gate.mjs` | 需要在临时项目上验证门禁自身行为时 |
