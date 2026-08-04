# DAOGE Docs

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

## 能力边界

- 文档是权威输入；工作台只为开发者呈现派生视图，不维护第二份业务结论。
- 工具不会把未知业务规则编造成结论，必须写明待确认项、负责人和阻塞阶段。
- 开发级 Goal 完成不等于发布；发布仍需真实证据与 Release 门禁。

完整方法、文档契约、门禁与命令说明见 [SKILL.md](./SKILL.md) 以及 `references/`。
