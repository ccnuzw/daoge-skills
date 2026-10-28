# 文档目录结构与规模裁剪

## 目录

1. 标准目录
2. 规模裁剪
3. 各目录职责
4. 初始化时生成哪些文件

## 1. 标准目录

```
docs/
  README.md                      文档中心入口（项目名取自标题“{项目名} 文档中心”）
  spec-docs.config.json          可选：浏览器与检查配置（模板：assets/templates/spec-docs.config.json）
  01-项目概览/
    README.md
    工程与本地环境.md
  02-产品与版本/
    README.md
    产品蓝图.md
    版本路线图.md                ← assets/templates/version-roadmap.md
    功能演进矩阵.md              ← assets/templates/feature-evolution-matrix.md
    版本进入开发门禁.md          ← assets/templates/version-gate.md
    当前版本/
      V1-版本总览.md
      V1-产品需求.md
      V1-实现状态.md             ← assets/templates/version-implementation-status.md
    后续版本/
      V2-{主题}.md
  03-功能规格/
    README.md
    V1/
      README.md                  功能索引
      00-V1需求编号.md           ← assets/templates/requirement-numbering.md
      00-V1需求追踪矩阵.md       ← assets/templates/tracking-matrix.md
      01-{领域}/
        01-{功能名}.md           ← assets/templates/feature-main.md
        01-{功能名}-技术设计.md  ← assets/templates/technical-design.md（仅高风险）
  04-技术架构/
    README.md
    总体架构.md
    统一错误码.md
    当前版本/
      V1-接口契约.md
      V1-数据模型.md
      V1-服务边界.md
  05-测试与发布/
    README.md
    测试策略.md
    端到端验收/
      V1-端到端验收规范.md      ← assets/templates/e2e-spec.md
  06-决策记录/
    README.md
    V1-冻结决策.md               ← assets/templates/frozen-decisions.md
    V1-文档变更记录.md           ← assets/templates/version-change-log.md
    ADR/
      README.md
      0001-{标题}.md             ← assets/templates/adr.md
  90-参考资料/
    README.md
    产品文档浏览器.html          生成物，不手改
  99-历史归档/
    README.md
```

文件名和路径以本节为准。模板中的相对链接按此结构编写；目录不同时同步修改链接，并用 `check-docs.mjs` 检查。

## 2. 规模裁剪

规模裁剪可以简化文档形态，但不能破坏单一来源、稳定编号和证据真实性。

| 规模 | 判断 | 生成范围 |
| --- | --- | --- |
| S | ≤ 10 个功能，单人或小团队，单版本 | `02-产品与版本/`（版本路线图、V1-版本总览、V1-实现状态）、`03-功能规格/V1/`（需求编号 + 功能主文档）、`06-决策记录/V1-冻结决策.md`。其他目录在需要时再建 |
| M | 10～40 个功能，或有多个版本规划 | 标准目录全部一级目录；`04`、`05` 只建 README 和当前版本必需文档 |
| L | 40+ 个功能，多团队，有发布门禁 | 标准目录全部；增加功能查找表、技术设计索引、性能与容量、发布手册 |

不确定规模时按 S 起步，告诉用户后续怎样扩展。不要为了“完整”生成空壳文件：每个生成的文件都要有可用内容，或者明确写“待补：{需要什么信息}”。

## 3. 各目录职责

| 目录 | 只放什么 | 不放什么 |
| --- | --- | --- |
| 02-产品与版本 | 产品范围、版本边界、实现状态 | 接口和表结构细节 |
| 03-功能规格 | 每个功能的需求、接口、数据、AC、设计、验证记录 | 实现状态结论 |
| 04-技术架构 | 跨功能的架构、接口公共约定、数据模型、错误码 | 单个功能的业务规则 |
| 05-测试与发布 | 测试策略、跨功能 E2E、发布与回滚 | 单个功能的 AC |
| 06-决策记录 | 冻结决策、ADR、文档变更记录 | 讨论过程草稿 |
| 90-参考资料 | 外部资料、生成的浏览器 | 权威规格 |
| 99-历史归档 | 废弃文档（移入而不是删除） | 当前有效内容 |

## 4. 初始化时生成哪些文件

1. 按规模选目录；每个创建的目录都有 README，写明本目录放什么、入口文件是哪个。
2. 填入用户已给出的信息（项目名、领域、版本规划）。领域写成 `03-功能规格/V1/01-{领域}/` 等目录，并在 V1 README 中列出。
3. 已知功能先在需求编号文档中分配 `V1-FR-NNN`，并在实现状态表登记为“规划中”；功能主文档在“写规格”模式中逐个创建。
4. 完成后运行 `check-docs.mjs`，把结果和下一步建议交给用户。
