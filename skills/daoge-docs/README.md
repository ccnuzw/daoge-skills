# DAOGE Docs

> 发布级别：`Beta`。面向需要中文文档驱动开发、可追溯 Goal 与开发执行工作台的技术团队。

DAOGE Docs 是面向中文软件项目的文档驱动开发 Skill。它以 Markdown 为权威输入，建立产品蓝图、版本 PRD、功能规格、技术设计、测试、证据与发布门禁，并派生供开发者阅读的开发执行工作台。

适合需要把 MVP、V1、V2、V3 按稳定功能 ID 持续迭代，并希望让编程智能体在受限范围内执行可恢复 Goal 的项目。

## 安装

项目级安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs
```

全局安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs -g
```

安装后重启 Codex。

## 系统要求

- Python `3.10+`：工具主体仅使用标准库。
- Git `2.x`：初始化和文档检查可不依赖 Git；Goal、检查点和提交绑定必须使用 Git。
- macOS、Linux、Windows 10/11 是发布支持矩阵；每次正式发布必须通过三平台 CI。Windows 使用 PowerShell 与 `py -3`，macOS/Linux 使用 `python3`。
- `npx skills add` 的 Node/npm 要求以安装器要求为准；初始化后的项目工具不依赖 Node。

安装后先运行只读诊断，它不会安装依赖或执行项目测试：

```bash
# macOS / Linux
python3 <skill-dir>/scripts/daoge_docs.py doctor --root . --json

# Windows PowerShell
py -3 <skill-dir>/scripts/daoge_docs.py doctor --root . --json
```

## 最短路径

在目标项目根目录运行初始化。`strict` 用于完整的文档、门禁、工作台与 Goal 体系：

```bash
python3 <skill-dir>/scripts/daoge_docs.py init \
  --root . \
  --project-name "项目中文名称" \
  --project-code CODE \
  --version V1 \
  --profile strict
```

初始化后使用项目内固定工具：

```bash
python3 .daoge-docs/daoge_docs.py index --root .
python3 .daoge-docs/daoge_docs.py check --root . --json
python3 .daoge-docs/daoge_docs.py serve --root . --port 8877
```

打开 `docs/90-参考资料/产品文档浏览器.html`，或通过本地服务访问它。工作台的“当前功能”支持复制功能 ID 与 Goal 准备提示。

Windows 请将示例中的 `python3` 替换为 `py -3` 或实际可用的 `python`。

## 常用链路

```text
初始化项目
  -> 完成调研、产品蓝图与版本 PRD
  -> 创建领域、功能、E2E 和决策
  -> index + check + Ready gate
  -> prepare-goal
  -> goal-resume-context
  -> 实现、提交、goal-checkpoint
  -> goal-complete
```

示例：

```bash
python3 .daoge-docs/daoge_docs.py new-domain --root . --name 身份与权限
python3 .daoge-docs/daoge_docs.py new-feature --root . --number 1 --name 用户注册 --domain 身份与权限
python3 .daoge-docs/daoge_docs.py gate --root . --stage feature-ready --feature CODE-FR-001
python3 .daoge-docs/daoge_docs.py prepare-goal --root . --feature CODE-FR-001
```

Goal 只有在版本和功能门禁通过、Git 基线与权威摘要稳定、工程落点和验证命令完整时才会进入 `ready`。`blocked`、`stale` 或验证失败时必须停止并回到权威文档处理问题。

## 跨技术栈与 CI

`doctor` 能只读识别 Node/TypeScript、Python、Go、Rust、Java/Maven、Gradle、.NET、Ruby、PHP 和常见 monorepo 标志，并给出候选验证命令。候选不是已确认命令，更不会自动执行项目构建、迁移或测试；实际命令必须冻结在项目环境文档与功能 AC 中。

为目标项目安装 CI、PR、VS Code 与智能体入口：

```bash
python3 .daoge-docs/daoge_docs.py install-integrations --root .
python3 .daoge-docs/daoge_docs.py ci-check --root . --json
```

生成的 GitHub Actions 在 Ubuntu、macOS、Windows 与 Python 3.10/3.12 上运行文档、工作台和 Goal 基线检查。详情见 [兼容性与安装契约](./references/compatibility.md) 与 [技术栈适配契约](./references/stack-adapters.md)。

## 能力边界

- 文档是权威输入；工作台只为开发者呈现派生视图，不维护第二份业务结论。
- 工具不会把未知业务规则编造成结论，必须写明待确认项、负责人和阻塞阶段。
- 开发级 Goal 完成不等于发布；发布仍需真实证据与 Release 门禁。
- Goal 通过门禁、受控范围和机器证据降低偏离风险；它不是对未知业务、第三方环境或一次性交付结果的保证。

完整方法、文档契约、门禁与命令说明见 [SKILL.md](./SKILL.md) 以及 `references/`。
