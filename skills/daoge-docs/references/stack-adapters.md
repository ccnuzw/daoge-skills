---
doc_id: DAOGE-STACK-001
status: active
owner: daoge-docs
updated: 2026-08-04
authority: 技术栈候选发现和项目验证命令冻结契约
---

# 技术栈适配契约

## 1. 原则

DAOGE Docs 的核心是技术栈无关的文档、ID、门禁和证据模型。技术栈适配器不是框架生成器，也不拥有项目构建命令。适配器只能从仓库文件识别候选栈、给出建议验证命令和限制；真实命令必须由项目的 `工程与本地环境`、功能 AC、CI 或既有权威配置确认。

禁止根据文件名自动执行包安装、迁移、测试或部署。禁止把建议命令写成“已通过”的证据。

## 2. 适配器输出

`doctor --json` 的 `技术栈候选[]` 使用下列稳定字段：

```text
id / name / evidence / suggested_commands / limitations / contract_version
```

相同项目文件集合必须产生同样的候选排序和内容。新增候选 ID 时不得改变既有 ID 的语义。

## 3. 候选映射

| ID | 识别文件 | 建议命令 | 必须人工确认 |
| --- | --- | --- | --- |
| `node` | `package.json` | `npm|pnpm|yarn run lint/test/build` | scripts、锁文件、Node 版本、workspace 范围 |
| `python` | `pyproject.toml`、`requirements.txt`、`setup.py` | `python -m pytest`、`unittest`、`ruff` | 虚拟环境、测试框架、依赖锁定 |
| `go` | `go.mod` | `go test/vet/build ./...` | Go workspace、私有模块、生成代码 |
| `rust` | `Cargo.toml` | `cargo fmt/clippy/test` | workspace、feature flags、MSRV |
| `java-maven` | `pom.xml` | `mvn test/verify` | JDK、Maven profile、集成测试 |
| `java-gradle` | `build.gradle`、`build.gradle.kts` | `gradlew test/check` | wrapper、JDK、Windows 执行形式 |
| `dotnet` | `*.sln`、`*.csproj` | `dotnet test/build` | SDK、solution、Target Framework |
| `ruby` | `Gemfile` | `bundle exec rake/rubocop` | Bundler、Rake、测试框架 |
| `php` | `composer.json` | `composer test/lint` | Composer scripts、PHP 版本 |
| `monorepo` | pnpm/Turbo/Nx/Lerna 配置 | 按受影响包执行 | 包边界、跨包依赖、受影响图 |

多个候选可以同时出现。比如 Node + `monorepo` 不是冲突，表示验证必须进一步定位到包。

## 4. 落入权威文档

每次对技术栈候选做出项目决定时，更新下列权威位置：

| 事实 | 权威位置 |
| --- | --- |
| 本地解释器、包管理器、安装与启动方式 | `01-项目概览/工程与本地环境.md` |
| 服务/包职责与禁止依赖 | `04-技术架构/服务与领域边界.md` |
| 单功能实际修改路径 | 功能主文档“实现与验证” |
| 单功能测试命令和证据 | 功能主文档 AC 表 |
| 发布构建、迁移和环境 | 发布手册与机器证据报告 |

Goal 只读取已冻结的 `allowed_paths`、AC 和验证命令。即使 `doctor` 发现了技术栈，也不能让 Goal 自动扩大修改范围。

## 5. Monorepo 规则

1. 每个业务包、服务和共享库必须有明确所有权与目录入口。
2. 一个 Goal 任务的 `allowed_paths` 必须收敛到实际包、服务或共享契约文件；禁止因根目录是 monorepo 而授权整个仓库。
3. 跨包 API、共享 schema、迁移或发布编排必须有明确依赖顺序和集成任务。
4. 验证命令必须写明 `cwd`、受影响包、超时和预期退出码；全仓命令只能作为额外集成证据。
5. 任何 workspace、lockfile 或公共生成制品变更都必须说明影响范围、兼容策略和回滚方式。

## 6. 新适配器的验收

新增技术栈适配器时必须同时提交：

1. 稳定 ID、识别文件、建议命令和限制说明。
2. 最小工程夹具与不执行项目命令的回归测试。
3. 至少一个 Windows/macOS/Linux 可解释的命令差异说明，或明确限制为某个平台。
4. 对 monorepo、锁文件和版本管理的影响说明。
5. 文档、`doctor` 输出和 CI 验收同步更新。
