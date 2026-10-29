# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [2.1.0] - 2026-10-29

包含 2.0.1 的表格样式修复（2.0.1 没有单独发布）。

### 修复

- 锚点检查与 GitHub 不一致，会放过断链。标题里的下划线被当成强调符号删掉（`mcp_connection_logs` 算成 `mcpconnectionlogs`），现在按 GitHub 的算法保留，重复标题依次加 `-1`、`-2`。`#d007` 这类前缀写法原先被当作通过，现在报新规则 LNK004（离线浏览器仍能跳转，GitHub 不能）。升级后既有项目可能多出 LNK002 / LNK004 警告，这些都是 GitHub 上真实跳不过去的链接。
- `cleanInline` 把文件路径和标识符里的下划线删掉（`tests/auth_login_test.ts` 显示成 `tests/authlogintest.ts`），浏览器标题与表格单元格同样受影响，已修正。
- 标题末尾的 `#`（`## C#`）被当成关闭符号删掉，现在只在前面有空格时才算。
- 生成物每次都不同：数据里的 `generatedAt` 和文件头注释里的 `--docs` 参数（可能是本机绝对路径）不再默认写入。
- `--config` 指向不存在的文件时，check-docs 与 generate-browser 原先静默当作空配置，现在以退出码 2 报错。
- ST004 对 “后端完成，前端待做” 这类长句建议改为 “已完成”（模糊匹配误判）。现在只对整格等于别名的词给出改写，其余只说明该功能的 AC 证据最多支持哪个状态。

### 新增

- 规则：LNK004（锚点只是前缀）、AC009（证据状态列缺失或不在词表）、AC010（证据先于测试资产或命令）、ST007（实现状态是本地验证及以上，但仍有 AC 证据低于本地通过）、FC001（功能卡缺字段）、REF003（保留编号表里的编号却有在用的功能文档）、CFG001～CFG003（配置写错）。规则表见 `references/check-rules.md`，测试会核对规则表与代码一致。
- 保留编号：需求编号文档里标题含 “保留 / 已废弃” 的表登记的编号（支持 `V1-FR-011～016`）不再触发 REF001 / REF002，写错的编号照常报告，不必再整类忽略 REF001。
- ID003 给出应改成的文件名和引用它的文件清单，`--json` 的 `suggestion.renames` 含完整引用位置。
- `scripts/migrate-docs.mjs`：把旧格式文档升级到当前标准（补 frontmatter、AC 表转标题块、状态词标准化、文件序号对齐并改写链接）。默认只预演并打印 diff，`--write` 才写；AC 原文逐字保留，写入前校验编号和原文，失败不写。模式说明见 `references/modes/migrate.md`。
- `generate-browser.mjs --check`：不写文件，产物过期时退出码为 1。`--stamp` 按需写入生成时间。数据文件超过 `browser.dataWarnKB`（默认 2048）时在摘要里提示体积。
- 配置 `"profile": "small"`：规格状态为 Draft 的功能暂不检查 AC001、AC004、AC005、AC006、TD001、FC001；其余规则不变，被豁免的条数在输出里列出。
- `references/modes/status-update.md` 增加实现状态判定表。模板补充：AC 测试设计表可加 “备注” 列、`track` 要与演进矩阵章节标题一致、保留编号的写法。
- 测试：窄屏（390 / 820 / 1440）下六个视图无页面级横向溢出；没有 Playwright 时输出醒目的 “浏览器测试没有运行”，`npm run test:browser`（`--require-browser`）此时失败。

### 变更

- 查看器与 check-docs 共用 `scripts/lib/markdown.mjs` 里的 slug 实现，生成时内联进查看器；`data-slug` 现在是带重复标题编号的 GitHub 锚点。
- 查看器仍保留前缀跳转作为便利功能，check-docs 不再放行。
- 浏览器数据不再含 `generatedAt`（除非 `--stamp`），页面右上角的生成时间提示随之为空。

## 2.0.1 - 2026-10-29（未单独打标签，已包含在 2.1.0 中）

### 修复

- 文档浏览器“功能”和“演进”视图的表格没有样式（无边框、无单元格内边距、表头无底色）。表格样式原先只写给 `.article` 内的表格，这两个视图的表格在 `.feature-table` 与 `.evolution-grid` 里，现已并入同一组规则。功能清单的编号、领域、风险、规格、实现状态、AC 列不再换行，功能名列最小宽度 220px，主责能力列可换行但最小宽度 120px。
- `tests/run-tests.mjs` 新增两条表格样式检查，此前的浏览器测试只查页面错误和 `undefined`，漏掉了这个问题：静态检查（不依赖浏览器）要求查看器脚本里每个 `<table>` 都命中 `viewer.css` 中同时给 `th` 和 `td` 设置 padding 的规则；浏览器检查在总览、阅读、功能、演进四个视图断言表头 padding 不是浏览器默认值、`border-collapse` 为 `collapse`。

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

[2.1.0]: https://github.com/ccnuzw/daoge-skills/compare/spec-docs-pro-v2.0.0...spec-docs-pro-v2.1.0
[2.0.0]: https://github.com/ccnuzw/daoge-skills/compare/spec-docs-pro-v1.0.0...spec-docs-pro-v2.0.0
[1.0.0]: https://github.com/ccnuzw/daoge-skills/releases/tag/spec-docs-pro-v1.0.0
