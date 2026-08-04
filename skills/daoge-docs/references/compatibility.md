---
doc_id: DAOGE-COMPAT-001
status: active
owner: daoge-docs
updated: 2026-08-04
authority: DAOGE Docs 的平台、运行时、安装升级和兼容性边界
---

# 兼容性与安装契约

## 1. 发布定位

DAOGE Docs 是本地运行的中文文档驱动开发工具和 Codex Skill。它不绑定特定应用框架、云平台或代码托管服务。`strict` Profile 可以为复杂项目建立完整治理链路，但不代表工具自动理解缺失的业务规则，也不代表任何 Goal 可以无人工确认直接发布。

当前发布级别为 `Beta`。每个正式版本必须在下列支持矩阵完成 CI 与隔离回归；未覆盖的平台只能标为“社区尝试”，不能宣称支持。

## 2. 支持矩阵

| 范围 | 支持状态 | 最低要求 | 验收方式 |
| --- | --- | --- | --- |
| macOS | 发布级 | Python 3.10、Git 2.x | GitHub Actions `macos-latest` 全量回归 |
| Linux | 发布级 | Python 3.10、Git 2.x、POSIX shell | GitHub Actions `ubuntu-latest` 全量回归 |
| Windows 10/11 | 发布级 | Python 3.10、Git 2.x、PowerShell 5.1 或 `pwsh` | GitHub Actions `windows-latest` 全量回归 |
| WSL | 兼容 | 满足 Linux 前提 | 按 Linux 路径验收；不单独替代 Windows 验收 |
| Python | 发布级 | 3.10 至当前稳定版 | CI 至少覆盖 3.10 与 3.12 |
| Git | Goal 必需 | 可读取 HEAD、状态、差异与提交历史 | `doctor` 与 Goal 基线检查 |
| Node/npm | 仅安装器前提 | 由 `npx skills add` 所需版本决定 | 以安装器官方要求为准；运行工具本身不依赖 Node |

工具主体只使用 Python 标准库。它不自动安装依赖、执行 `npm install`、运行项目构建或访问网络服务。

## 3. 平台命令

macOS/Linux：

```sh
python3 .daoge-docs/daoge_docs.py doctor --root . --json
python3 .daoge-docs/daoge_docs.py ci-check --root . --json
```

Windows PowerShell：

```powershell
py -3 .daoge-docs/daoge_docs.py doctor --root . --json
py -3 .daoge-docs/daoge_docs.py ci-check --root . --json
```

如果 Windows 没有 `py` 启动器，使用已在 `PATH` 中的 `python`。不要把 Bash 专用的管道、变量展开或 `&&` 写入跨平台 AC 验证命令；需要平台差异时，在功能规格中分别声明命令、环境和证据。

## 4. 安装、初始化与升级

安装 Skill：

```sh
npx skills add ccnuzw/daoge-skills -a codex -s daoge-docs
```

在目标仓库先运行 `doctor`，再初始化。初始化后工具会复制到 `.daoge-docs/`，该副本是项目可复现的工具版本。升级时只更新 `.daoge-docs/` 的工具和模板，不覆盖已有项目事实：

```sh
python3 <skill-dir>/scripts/daoge_docs.py upgrade --root . --profile strict
python3 .daoge-docs/daoge_docs.py doctor --root . --json
python3 .daoge-docs/daoge_docs.py ci-check --root . --json
```

升级导致 `tool_version` 变化时，尚未完成的 Goal 会进入 `stale`，必须重新从当前权威文档准备。已完成 Goal 保留为历史记录，不会被篡改。

## 5. 环境诊断边界

`doctor` 是只读命令，检查 Python、Git、PowerShell/POSIX shell、项目是否初始化、Git 工作树和技术栈候选。它不会执行项目安装、构建、测试、迁移或部署。

诊断结果分三级：

| 级别 | 含义 | 行为 |
| --- | --- | --- |
| `error` | 工具自身无法可靠运行 | 阻止发布级使用，先修复环境 |
| `warning` | 某项可选能力不可用，例如无 Git 的 Goal | 允许不依赖该能力的文档工作 |
| `info` | 环境或平台提醒 | 由开发者确认后继续 |

## 6. 不兼容与升级规则

- 工具只保证读取自身声明兼容的数据契约版本；旧工作台数据仅用于阅读时会明确显示降级。
- 项目文档是权威事实；升级不得重写用户正文、状态、决定或证据。
- 配置、模板、生成器或门禁逻辑变化后必须运行 `index`、`check` 和与任务相称的门禁。
- 跨版本破坏性 API、数据库或部署变更必须由 ADR/冻结决策显式授权，不能由升级命令推断。
- `doctor` 识别到多技术栈或 monorepo 时，只报告候选；每个包/服务的验证命令、工作目录和允许路径必须在当前版本规格中冻结。

## 7. 发布验收

一个 DAOGE Docs 版本只有同时满足下列条件，才能从 Beta 进入 GA 评估：

1. 支持矩阵中的三种操作系统和两种 Python 版本 CI 全部通过。
2. 干净环境完成安装、初始化、`doctor`、`index`、`check`、工作台 Smoke 和升级回归。
3. 技术栈夹具覆盖 Node/TypeScript、Python、Go、Rust、Java/Maven、Gradle、.NET 与 monorepo 的发现契约。
4. 至少一个真实项目通过从既有 docs 迁移到 `strict` 的人工验收，且不覆盖项目事实。
5. 发布说明列出兼容变化、已知限制、安全修复和升级影响。
