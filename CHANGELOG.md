# 变更记录

本仓库的两个 Skill 独立发布。`daoge-docs` 标签格式为 `daoge-docs-vX.Y.Z`，`daoge-pic` 标签格式为 `daoge-pic-vX.Y.Z`；每个标签对应此文件中明确的版本条目。

## daoge-pic 5.3.1 - 2026-08-31

### 修复

- Workbench 刷新改为单飞尾随队列：移除 `projects` 状态触发的刷新依赖循环；SSE 事件在短窗口内合并，路由切换会中止旧上下文请求，搜索、轮次记录和总览比较均支持取消与过期结果保护。
- SSE 快照恢复现携带一致 cursor，并在发送一次 `snapshot-required` 控制帧后关闭旧流；服务端处理背压、断连和关闭期清理，避免失效 cursor 每 400ms 触发全量刷新。
- daemon 默认复用工作区保存的端口，优雅重启后 Workbench URL 保持不变；端口绑定失败不再遗留半初始化服务或掩盖原始错误，关闭时等待在途 worker tick。
- schema v12 增加素材关联、最新评审和交付批次反向引用索引；安全搜索改为单个 FTS 候选 CTE 联表投影，交付与批次完整快照仅在交付视图读取。

### 验证

- 新增事件突发单飞刷新、卸载清理、快照 cursor/流关闭、固定端口失败清理与无 Provider 稳定端口重启回归；全部 vNext 回归通过。

## daoge-pic 5.3.0 - 2026-08-28

### 新增

- Workbench 增加可深链接的 Studio 总览：可显式选择同一任务的多个轮次，并列比较计划摘要、上游谱系、运行项、结果资产与当前项目评审。
- Studio 搜索增加项目、任务和轮次的安全显示投影；命中只跳转到规范化深链接，不回传 FTS 原文、任务意图或轮次计划。
- 新增版本化交付批次：批次仅接纳已准备或已导出的 P1 交付，创建与每次修订都冻结成员快照；CLI 增加 `delivery-batch`、`delivery-batch-revise` 和 `delivery-batch-ready`。

### 改进

- schema v11 新增交付批次、版本和冻结交付成员表；版本从 `draft` 准备为 `ready` 后只读，任何成员调整都会建立新的修订版本。
- 资产来源检查器新增交付批次版本反向引用；比较 API 的计划与上游谱系只返回安全摘要，不返回原始提示词、素材引用、内部路径、哈希、Provider 字段或外部请求标识。
- 搜索限制查询长度和结果数，跨任务轮次比较被明确拒绝；P2 不新增 Provider 调用、排队、恢复或重试入口。

## daoge-pic 5.2.0 - 2026-08-28

### 新增

- 任务概览聚合轮次、运行和结果数量；轮次工作区展示计划版本、上游谱系与显式运行项到结果资产的关系。
- 资产检查器展示安全的生成来源链、追加式评审历史和交付引用，可从结果资产定位回明确的项目、任务、轮次和运行。
- 交付改为持久化的 `draft -> ready -> exported` 流程；新增 `delivery_assets` 快照表，准备交付时冻结资产来源和评审事实。
- CLI 新增 `delivery-update`、`delivery-ready` 与 `delivery-draft`，与 Workbench 共用同一状态机。

### 改进

- 交付草稿只接受属于当前项目、活跃且当前评审为 `keep` 的资产；界面和 API 都标明未满足准入的选片。
- 导出仅允许已准备交付，并把冻结的来源与评审快照写入交付清单；后续评审不会改写已准备的交付事实。
- 资产范围返回的当前评审按当前项目解释，避免其他项目的评审状态误导交付准入。
- 创作记录、资产来源和交付快照均脱敏 Provider 机密、端点、外部请求标识与文件路径。

## daoge-pic 5.1.0 - 2026-08-28

### 新增

- Workbench 将 `view`、项目、任务、轮次、运行和资产范围写入 URL，支持刷新、浏览器前进/后退和可恢复的明确工作上下文。
- Workbench 为浏览器工作上下文创建并同步 Studio Session；项目、任务和轮次选择在本地 SQLite 中持久化，运行保持为 URL 中显式选择的历史项。
- 生成区新增本轮完整运行历史选择器；不再静默展示活跃或最新运行。
- 资产视图新增“当前轮次 / 当前任务 / 当前项目 / 全部 Studio”范围选择；后端按资产关系、运行项、运行和创作层级安全推导范围并去重。

### 改进

- 左侧项目树、固定面包屑、范围空态和上下文错误提示明确当前查看对象；不存在或跨层错误的深链接不会跳转到其他实体。
- 统一使用“生成运行”和“取消运行”术语，清晰区分 Studio Session、创作轮次、运行与运行项。
- 导入资产依据当前范围绑定项目、任务或轮次，避免范围语义与资产归属脱节。

## daoge-pic 5.0.3 - 2026-08-28

### 修复

- Workbench 按项目、任务、轮次、生成运行和运行项分别解释状态，不再将所有 `active` 显示为含义模糊的“进行中”。
- 已确认的轮次显示“已确认 · 可继续”；任务显示已确认轮次数；项目开放状态与实际 Provider 执行状态明确分离。
- 只有运行项处于请求、接收或保存阶段才显示“正在生成”；排队、准备、暂停、等待会话确认和终态均显示各自明确状态。

## daoge-pic 5.0.2 - 2026-08-27

### 修复

- 高级详情按实际持久化的干跑记录读取 `planVersion`、`planSnapshot` 与脱敏 Provider 元数据，不再访问不存在的 `preflight` 字段而导致 Workbench 黑屏。
- 高级详情对缺失或历史不完整的记录使用安全降级，并添加应用级错误边界，避免单个详情异常使整页不可用。
- 高级详情不展示 Provider endpoint。

## daoge-pic 5.0.1 - 2026-08-27

### 修复

- Worker 将同批领取的运行项并发处理，并在同批单项异常后仍收敛已确定终态的运行，避免慢 Provider 响应令后续租约过期并遗留 `running`。
- daemon 启动和轮询会基于 SQLite 中所有已终态的运行项幂等补记 `completed`、`partial` 或 `failed`，不重放任何 Provider 请求。
- Studio 服务关闭时主动终止 SSE 长连接，避免 Workbench 保持连接导致 daemon 无法响应终止信号。
- Workbench 对已完成运行显示正确终态，并隐藏无效的“取消会话”操作。

## daoge-docs 3.25.0 - 2026-08-12

### 新增

- strict Profile 要求当前版本获得绑定权威摘要的开发者确认；确认过期、被拒绝或被替代时不能进入受控开发。
- 新增 ChangeSet、隔离规格草案和开发级交付回写：AI 可以起草，只有开发者批准且规格物化后才成为权威事实；功能、模块和版本完成状态必须绑定可复验的 Goal 完成记录。
- 工作台增加开发确认、规格修订、隔离草案和交付状态的只读投影，并保持其不是第二事实源。
- 所有变更命令使用项目级写锁串行执行；Markdown、JSON、Goal、草案和证据资产使用原子保存，避免并发写入或中断留下半截内容。

### 兼容性

- 项目输入与约束注册表升级为 `schema_version: 6`。旧登记内容会保留，并由升级流程补齐新增集合。
- 未完成 Goal 遇到工具版本变化会进入 `stale`，必须从当前权威文档重新准备；已完成 Goal 保留为历史审计材料。

## daoge-docs 3.18.0 - 2026-08-08

### 新增

- Goal 运行态明确区分 `not_started`、`dependency_blocked`、`executing`、`verification_failed`、`completed`、`stale` 和 `blocked`，工作台、`goal-plan`、恢复上下文与 CI 使用同一阶段/原因语义。
- 验证失败后允许在任务 `allowed_paths` 内恢复，并为每次验证尝试保留独立的 `verification_attempts[]` 机器证据；失败不会伪造检查点。
- GitHub Actions、PR 模板、VS Code Tasks 和 `AGENTS.md` 集成覆盖代码、文档和 stale Goal 基线检查，并保持不覆盖已有目标配置。

### 修复

- 修复工作台 Goal 顶层状态与嵌套执行快照不一致的问题。
- 统一工作台、Goal 契约和开发工作流文档中的当前工具版本为 `3.18.0`。

## daoge-docs 3.16.0 - 2026-08-08

### 新增

- Goal 清单同时绑定项目全貌摘要和所选功能依赖闭包的范围摘要；功能、共享契约、版本架构/测试、相关决策或 E2E 变化会使 Goal 进入 `stale`，不相关版本规划变化不再误伤当前 Goal。
- `prepare-goal --execution-mode parallel`：在独立非主分支和 linked worktree 中规划无依赖、无工程路径重叠的并行 lane；恢复上下文返回当前所有 runnable tasks，每个 lane 以独立 TASK ID 建立检查点。
- 文档同步闭环：区分实现/证据同步与需求语义变更；后者必须停止受影响 Goal、更新权威并重新过门禁。

### 兼容性

- Goal schema 保持版本 1；旧清单仍按原全局 `authority_digest` 读取，新清单的 `authority_digest` 是 `scope_digest` 的兼容别名。
- 默认执行模式仍为 `serial`。未显式使用并行模式的既有流程不改变。

## daoge-docs 3.15.3 - 2026-08-07

### 修复

- 区分权威 Markdown、索引生成 Markdown 与 JSON/YAML 结构化数据的浏览状态；不再把所有无 front matter 文件显示为“未声明”。
- 工作台将派生状态显示为“已生成”、结构化文件显示为“结构化数据”，并明确它们不代表 Gate 已就绪或机器证据已通过。

## daoge-pic 4.0.0 - 2026-08-05

### 变更

- 将批量生图 Skill 统一命名为 `daoge-pic`：仓库目录、Skill 元数据、安装参数、GitHub 子目录、npm 包、Docker 镜像、用户手册、参考资料与历史文档均使用新名称。
- 保持 `node scripts/daoge.js` 作为既有 CLI 入口，任务规格、输出目录与本地工作台数据格式不变。

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
## daoge-docs 3.15.2 - 2026-08-07

### 修复

- 工作台各版本功能清单按稳定功能编号排序，避免跨目录路径顺序导致 V4/V5/V6 功能展示错序。
- 增加跨版本功能排序回归测试。
