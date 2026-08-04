# 变更记录

本仓库的两个 Skill 独立发布。`daoge-docs` 标签格式为 `daoge-docs-vX.Y.Z`；每个标签对应此文件中明确的版本条目。

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
