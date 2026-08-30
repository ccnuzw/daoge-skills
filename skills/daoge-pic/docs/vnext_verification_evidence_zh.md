# DAOGE Pic vNext 验证记录

本文件只记录本轮实际执行的验证，不定义产品需求或实现状态。需求唯一来源是 [vNext 升级规格](daoge_pic_vnext_upgrade_spec_zh.md)；当前实现以 `src/vnext/` 与 `web/` 为准。

## 本轮机器证据

- 最终验证时间：2026-08-30T14:26:41Z（本地 macOS，Node.js 26.7.0）；工作树包含待提交的 v5.3.0 发行变更。
- `npm run test:vnext`：退出码 0；先执行 TypeScript 与 Vite 生产构建，再运行 `tests/vnext/*.test.js`，共 60 通过、0 失败，覆盖 P0/P1 回归及 P2 安全搜索投影、显式多轮比较、跨任务拒绝、批次版本冻结、修订不可变性和资产批次反向追溯。
- `npm run test:package`：退出码 0；发布清单包含 64 个必要文件，`*.map` 为 0，旧版路径为 0。
- `npm pack --json`：退出码 0；最终 `daoge-pic-5.3.0.tgz` 的 npm shasum 为 `172766de1a83a035b4b100273079f20b469167f3`。
- 隔离安装冒烟：退出码 0；将最终 tgz 安装到临时目录，确认 `scripts/daoge.js --help`（含 `delivery-batch-ready`）、MIT 许可证、编译后的 CLI、Workbench、创作记录和交付批次领域模块、Skill、README、Provider 模板和 vNext 规格均可用；旧源码、旧静态 Workbench、Docker/旧配置、旧 Provider 桥接器与 source map 均不存在。
- 本机 Skill 部署：退出码 0；已原子替换唯一全局路径 `/Users/apple/.agents/skills/daoge-pic`，并确认包版本为 `5.3.0`，旧 `app/` 和 `references/task_spec.md` 不存在。
- 现场 Workbench 验证：在无活跃运行项的 Studio 中部署 v5.3.0 后，P2 Studio 总览深链接返回 HTTP 200；安全搜索命中 1 个受限显示投影，两个明确轮次完成计划摘要、谱系、运行和结果比较；使用已有已导出 P1 交付创建批次 v1、准备 v1、创建并准备 v2，旧 v1 成员快照与状态保持不变，资产可反向追溯到批次版本；schema v11 记录 1 个批次和 2 个版本；公开搜索、比较、批次和资产来源 DTO 均不含计划提示词、内部路径、内容哈希、外部请求标识或 Provider 字段，未产生新的 `run_item.requesting` 事件或 Provider 调用。
- 最终包 SHA-256：`aeb9d5986a7c2fc6cdcfa00b6efe494dcf29f638babb755787c0f43d407e5932`。

## 覆盖范围

测试覆盖 Studio Schema/migration（含 v10 历史交付回填和 v11 批次版本表）、事件与 SSE 游标及关闭、Provider 脱敏、计划确认和干跑、高级详情的干跑证据安全渲染、项目/任务/轮次/运行/运行项的分层状态展示、Workbench URL 路由、显式运行选择和多轮比较选择、Session 上下文读取/写入、轮次/任务/项目/Studio 资产范围上卷与去重、任务创作概览、轮次谱系、运行项结果资产链、资产来源和评审历史、项目范围评审准入、交付 `draft -> ready -> exported` 状态机与冻结快照、版本化交付批次 `draft -> ready` 状态机、修订历史与冻结交付成员、FTS 安全搜索投影和跨任务比较拒绝、交付/资产/来源/批次公开 DTO 脱敏、队列/租约/终态收敛与恢复、未知外部结果、媒体日志恢复、导入/评审/软删除/恢复、交付日志、FTS、CLI 契约、Workbench 静态服务，以及旧版程序、静态 Workbench、Docker 配置、旧 Provider 桥接器和参考资料不得回流的目录结构门禁。

## 尚未形成机器证据的事项

当前环境未提供 Playwright 或等价浏览器自动化工具，因此未生成桌面/移动视口截图或像素级 UI 验证。已由 Vite 生产构建和 API 的 Workbench 静态服务测试覆盖资源可用性，但交互视觉验收仍应在具备浏览器自动化的环境补充。
