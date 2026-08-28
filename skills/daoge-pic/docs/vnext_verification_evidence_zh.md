# DAOGE Pic vNext 验证记录

本文件只记录本轮实际执行的验证，不定义产品需求或实现状态。需求唯一来源是 [vNext 升级规格](daoge_pic_vnext_upgrade_spec_zh.md)；当前实现以 `src/vnext/` 与 `web/` 为准。

## 本轮机器证据

- 最终验证时间：2026-08-28T03:24:17Z（本地 macOS，Node.js 26.7.0）；工作树包含待提交的 v5.1.0 发行变更。
- `npm run test:vnext`：退出码 0；先执行 TypeScript 与 Vite 生产构建，再运行 `tests/vnext/*.test.js`，共 55 通过、0 失败，覆盖旧版树残留拒绝、历史终态运行收敛、同批租约并发处理、SSE 长连接关闭、高级详情干跑证据渲染、分层状态语义、Workbench URL 上下文、Session 读取和层级资产范围。
- `npm run test:package`：退出码 0；发布清单包含 60 个必要文件，`*.map` 为 0，旧版路径为 0。
- `npm pack --json`：退出码 0；最终 `daoge-pic-5.1.0.tgz` 的 npm shasum 为 `c9ee34ca3de4a61a111d01cf9ab84edc7188374f`。
- 隔离安装冒烟：退出码 0；将最终 tgz 安装到临时目录，确认 `scripts/daoge.js --help`、MIT 许可证、编译后的 CLI、Workbench、Skill、README、Provider 模板和 vNext 规格均可用；旧源码、旧静态 Workbench、Docker/旧配置、旧 Provider 桥接器与 source map 均不存在。
- 本机 Skill 部署：退出码 0；已原子替换唯一全局路径 `/Users/apple/.agents/skills/daoge-pic`，并确认包版本为 `5.1.0`，旧 `app/` 和 `references/task_spec.md` 不存在。
- 现场 Workbench 验证：在无活跃运行项的 Studio 中重启 v5.1.0 daemon；完整深链接返回 HTTP 200，最新 bundle 包含“运行历史”“资产范围”和“请选择生成运行”，显式运行历史与运行项可读，范围资产数从轮次到 Studio 为 1/10/10/12，Session 上下文已写入并读回；未产生新的 `run_item.requesting` 事件或 Provider 调用。
- 最终包 SHA-256：`06fc286535a34ffd79b57d119ec247038a3da1f7f9bed164649a20e829d64461`。

## 覆盖范围

测试覆盖 Studio Schema/migration、事件与 SSE 游标及关闭、Provider 脱敏、计划确认和干跑、高级详情的干跑证据安全渲染、项目/任务/轮次/运行/运行项的分层状态展示、Workbench URL 路由、显式运行选择、Session 上下文读取/写入、轮次/任务/项目/Studio 资产范围上卷与去重、队列/租约/终态收敛与恢复、未知外部结果、媒体日志恢复、导入/评审/软删除/恢复、交付日志、FTS、CLI 契约、Workbench 静态服务，以及旧版程序、静态 Workbench、Docker 配置、旧 Provider 桥接器和参考资料不得回流的目录结构门禁。

## 尚未形成机器证据的事项

当前环境未提供 Playwright 或等价浏览器自动化工具，因此未生成桌面/移动视口截图或像素级 UI 验证。已由 Vite 生产构建和 API 的 Workbench 静态服务测试覆盖资源可用性，但交互视觉验收仍应在具备浏览器自动化的环境补充。
