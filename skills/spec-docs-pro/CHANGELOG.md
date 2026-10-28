# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.0.0] - 2026-10-28

结构与标准全面重整。1.x 的文件可以从 git 标签 `spec-docs-pro-v1.1.0` 获取；升级步骤见 [README](README.md#从-1x-升级)。

### 破坏性变更

- 文档浏览器改为由脚本生成的数据驱动查看器。数据变量从 `window.TUZAI_DOC_BROWSER_DATA` / `window.{项目名}_FEATURE_BROWSER_DATA` 统一为 `window.SPEC_DOCS_DATA`；需要重新生成一次浏览器。
- 功能主文档不再记录实现状态：frontmatter `status` 改为 `spec_status`（Draft / Ready / Deprecated），功能卡去掉“状态”行。实现状态只在 `V{n}-实现状态.md` 维护。
- 目录调整为 Agent Skills 规范：`templates/` 拆分为 `assets/templates/`（文档模板）和 `references/`（说明）；`instructions.md` 按模式拆分到 `references/modes/`。

### 新增

- `scripts/check-docs.mjs`：只读检查编号重复与悬空引用、链接与锚点、AC 与测试设计表、分支 ID 追踪、状态词、演进矩阵格式、规划版本文档、模板残留，共 30 余条规则（`references/check-rules.md`）。
- `references/status-and-ids.md`：四套状态（实现 / 规格 / 证据 / 决策）和全部编号格式的唯一定义，含旧写法迁移对照。
- `references/design-review.md`：一轮集中提问的方法、高风险信号与必问问题。
- `references/doc-structure.md`：标准目录与 S / M / L 规模裁剪。
- 浏览器新增“功能”视图（筛选、风险、规格状态、实现状态、AC 数）；图谱改为从数据生成的版本路线、能力 × 版本热力图、领域状态分布、风险分布；侧栏显示数据质量提示；支持 URL 深链接。
- 模板：版本门禁（G01～G12，对应 check-docs 规则）、配置文件 `spec-docs.config.json`。
- `tests/`：脚本自测、正常与问题夹具、可选的 Playwright 渲染测试。
- `evals/evals.json` 增加可验证的 expectations。

### 修复

- 浏览器模板写死“功能数必须为 36”，其他项目必然加载失败。
- 时间线写死 V1～V8 列号和 V3 历史文案，非 TUZAI 项目显示“未分配阶段”。
- 旧生成脚本把项目名直接拼进 JS 变量名（如 `window.DG-OS_...`），且数据文件与 HTML 变量名不一致，生成结果无法加载。
- 文档内容嵌入 `<script>` 时未转义，`</script>` 可截断脚本；Markdown 链接允许 `javascript:` 协议。
- `SKILL.md` 和 `instructions.md` 中的合并残留（被截断的技术设计模板、引用不存在的 `generate-browser-v4.mjs`、写死的 `~/.omp` 路径、未闭合代码块）。
- 版本号不一致（SKILL.md 1.1.0、package.json 1.0.0、README 4.0.0）。

### 移除

- 12 份互相重复的浏览器生成指南（DATA_FORMAT_SPEC、DOCS_ARRAY_FORMAT、TIMELINE_* 等），由脚本和 `references/modes/browser.md` 取代。
- 两份相同的 105KB 浏览器模板、v2 / v3 / v4.broken 生成脚本和 `.backup` 文件。
- 开发过程记录（P0 / P1 升级计划与完成报告、ENHANCEMENT、CRITICAL_UPGRADE_TODO），这些不是 Skill 运行所需的内容。
- 模板和示例中的 TUZAI、DG-OS 项目数据与 Rust 专属命令。

## [1.1.0] - 2026-10-27

- 新增文档浏览器生成与诊断指南（13 份）。

## [1.0.0] - 2026-10-26

- 初始版本：12 个工作模式、功能主文档 / 技术设计 / ADR / E2E 模板、文档浏览器。

[2.0.0]: https://github.com/ccnuzw/daoge-skills/compare/spec-docs-pro-v1.0.0...spec-docs-pro-v2.0.0
[1.0.0]: https://github.com/ccnuzw/daoge-skills/releases/tag/spec-docs-pro-v1.0.0
