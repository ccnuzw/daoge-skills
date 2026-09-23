# spec-docs（给人和团队的使用说明）

> 版本：`1.1.0`。从 DAOGE Skills 仓库独立安装的文档规格与治理 Skill。

一套“文档驱动开发”文档体系的 skill：为任意项目生成同构的 `docs/` 骨架，并约束功能规格、需求追踪、验收证据、版本门禁和决策记录的写法。

`spec-docs` 注重可移植的 Markdown 模板、稳定 ID、结构检查和机器可验证的交付证据门禁；不依赖 DAOGE Docs 的项目工作台或 Goal 系统。需要完整项目执行工作台和受控 Goal 流程时，请使用同仓库的 `daoge-docs`。

## 安装

```bash
npx skills add ccnuzw/daoge-skills -a codex -s spec-docs
```

安装后重启 Codex，使其重新加载 Skill。也可以直接安装开发分支中的 Skill 目录：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/spec-docs -a codex
```

- AI agent：读取 `SKILL.md` 触发使用；方法论在 `references/`。
- 开发者：照本文三步用；模板可以脱离 skill 单独复制。

## 快速使用

```sh
# 1. 生成骨架（在项目根执行；默认 --tier m；--gate 或 --tier l 附带交付门禁）
node <本目录>/scripts/init-docs.mjs --target . --name "项目名" --version V1 --tier m

# 2. 结构自检（生成后立即跑一次）
node scripts/check-docs.mjs

# 3. 按 docs/README.md（或 docs-policy.json 的 root）“按任务查找”逐份填充
```

生成物：

```text
<项目根>/
  docs/                       # 8 个编号目录 + 占位模板
  docs-policy.json            # 结构检查配置（活动版本、必需文件、ID 规则、档位）
  scripts/check-docs.mjs      # 结构检查脚本（可进 CI）
  docs-gate.json              # 交付门禁配置（--gate / --tier l 时生成）
  docs-evidence.json          # 当前证据指针（--gate / --tier l 时生成）
  scripts/docs-gate.mjs       # 交付证据门禁（--gate / --tier l 时生成）
```

## 给 AI 的最短指令

```text
按 skills/spec-docs 的规范为当前项目建立/维护文档：
先读 SKILL.md 与 references/，新项目先跑 init-docs.mjs；
功能文档按七段结构写，AC 必须映射测试层级/目标资产/命令/证据状态；
冲突先写冻结决策；完成后跑 scripts/check-docs.mjs 并报告结果。
```

## 分档使用

| 档位 | 适用 | 做法 |
| --- | --- | --- |
| S | 1 人、≤ 2 周 | 只把核心章节设为必需；完整模板树保留以维持链接，其他模块按需维护 |
| M | 1–3 人、1–3 月 | 默认，全量使用 |
| L | 5+ 人、多子系统 | 在 M 基础上为高风险功能全部建独立技术设计，并把证据报告写成机器可读 |

`--adopt` 只补不存在的模板和脚本，不覆盖现有内容；需要新旧文档并行迁移时用 `--dir docs-next`。

关键规则不因档位降级：单一权威来源、稳定 ID、三类事实分离、冲突先决策、AC 可追踪、证据分级。可运行 `node scripts/check-docs.mjs --tier m` 临时升级检查范围。

## 目录

```text
SKILL.md               触发条件与三种工作模式
references/            方法论总纲、文档地图、功能规格写法、治理、证据、交付门禁规范
assets/skeleton/       可复制骨架（docs/ + docs-policy.json + docs-gate.json + docs-evidence.json）
scripts/init-docs.mjs  骨架生成（--gate / --tier l 附带门禁）
scripts/check-docs.mjs 结构检查
scripts/docs-gate.mjs  交付证据门禁
scripts/selftest-docs-gate.mjs 门禁自测（临时项目上覆盖放行与失败路径）
scripts/selftest-check-docs.mjs 结构自测（含 tier、dry-run、adopt 与自定义目录）
```

## 交付门禁怎么用

```sh
node scripts/docs-gate.mjs --init              # 生成配置与证据模板（或 init-docs --tier l）
node scripts/docs-gate.mjs --scaffold-report e2e   # 生成符合契约的空报告+manifest（dev|e2e|perf|release）
node scripts/docs-gate.mjs --authority-digest  # 取权威文档摘要，写入审批
node scripts/docs-gate.mjs                     # 日常校验
node scripts/docs-gate.mjs --release           # 发布模式：未闭环 AC 与待补项按错误处理
```

## 已知边界

- `check-docs` 只证明结构自洽；能否交付由 `docs-gate` 判断（报告重算、审批摘要、提交绑定、秘密扫描）。
- `docs-gate` 不执行业务命令、不产出报告、不校验审批人身份真实性；资金/真实依赖/密钥/备份恢复不得豁免。
- 骨架中的示例功能文档是模板，不包含任何真实业务规则；填充时必须写真实字段、错误与状态。
