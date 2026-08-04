# 变更记录

本仓库的两个 Skill 独立发布。`daoge-docs` 标签格式为 `daoge-docs-vX.Y.Z`；每个标签对应此文件中明确的版本条目。

## daoge-docs 3.13.4 - 2026-08-04

### 修复

- Goal 生命周期统一将 Git、清单和派生文档路径规范化为 POSIX `/` 形式；Windows 不再把工具生成的工作台数据文件误判为清单外改动，从而阻塞 `prepare-goal`、恢复或检查点。
- 回归测试按被测脚本绝对路径加载模块，消除不同 `unittest` 启动方式对 `sys.path` 的依赖。

## daoge-docs 3.13.3 - 2026-08-04

### 修复

- 将 UTF-8 原文服务回归统一收敛到 `browser-check` 的真实 HTTP Smoke，避免 macOS CI 中独立测试子进程偶发无法连接，同时保留 Markdown MIME、UTF-8 charset 与中文正文可读性校验。

## daoge-docs 3.13.2 - 2026-08-04

### 修复

- Goal 回归夹具在 Windows 使用 PowerShell 可执行的 Python 调用，避免将绝对路径中的反斜杠作为正则替换转义处理。
- 集成安装结果统一使用 `/` 路径分隔符，确保不同操作系统得到稳定、可比较的 JSON 输出。
- UTF-8 文档服务 Smoke 使用有限重试和确定的子进程回收，降低慢启动 macOS Runner 的偶发超时。

## daoge-docs 3.13.1 - 2026-08-04

### 修复

- Windows 默认代码页为非 UTF-8 时，强制 CLI 标准输出与错误输出使用 UTF-8，避免 `doctor --json` 和中文诊断输出失败。

## daoge-docs 3.13.0 - 2026-08-04

### 新增

- `doctor`：只读诊断 Python、Git、shell、Git worktree、项目初始化状态和技术栈候选。
- `ci-check`：统一重建派生文档、文档检查、工作台 Smoke 与 Goal 基线检查。
- Node/TypeScript、Python、Go、Rust、Java/Maven、Gradle、.NET、Ruby、PHP 和 monorepo 的技术栈发现契约。
- macOS、Linux、Windows 与 Python 3.10/3.12 的 GitHub Actions 发布矩阵。
- MIT 许可证、贡献指南、安全政策、Issue 模板、兼容性与技术栈适配文档。

### 变更

- Goal 验证在 Windows 使用 `pwsh` 或 PowerShell，在 POSIX 系统使用可用 shell，不再固定依赖 `/bin/sh`。
- 生成的 VS Code Tasks 使用已选 Python 解释器；工作台和恢复上下文根据平台生成 Python 命令。
- 项目 CI 改为通过 `ci-check` 执行，不再依赖 Bash 专用的 Goal 遍历脚本。

### 兼容性

- 工具主体最低 Python 版本为 3.10，且仅依赖标准库。
- `doctor` 的技术栈结果是只读候选和建议，不会执行项目构建、测试、迁移或部署。
- 未完成的旧 Goal 遇到工具版本变化会按既有规则进入 `stale`；已完成 Goal 保留为历史记录。

## daoge-docs 3.12.2

- 完成离线 Markdown 阅读增强、开发工作台六视图、稳定章节定位、Goal 提示复制与可恢复 Goal 生命周期。
