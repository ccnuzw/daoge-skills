# DAOGE Pic vNext 验证记录

本文件只记录本轮实际执行的验证，不定义产品需求或实现状态。需求唯一来源是 [vNext 升级规格](daoge_pic_vnext_upgrade_spec_zh.md)；当前实现以 `src/vnext/` 与 `web/` 为准。

## 本轮机器证据

- 最终验证时间：2026-08-26T18:36:04Z（本地 macOS，Node.js 22.23.0）；工作树包含待提交的 v5.0.0 发行变更。
- `npm run test:vnext`：退出码 0；先执行 TypeScript 与 Vite 生产构建，再运行 `tests/vnext/*.test.js`，共 42 通过、0 失败，其中包含旧版树残留拒绝测试。
- `npm run test:package`：退出码 0；发布清单包含 60 个必要文件，`*.map` 为 0，旧版路径为 0。
- `npm pack --json`：退出码 0；最终 `daoge-pic-5.0.0.tgz` 的 npm shasum 为 `e4e56be6da4e9c1f343615069fd2e0dd36e7ea47`。
- 隔离安装冒烟：退出码 0；将最终 tgz 安装到临时目录，确认 `scripts/daoge.js --help`、MIT 许可证、编译后的 CLI、Workbench、Skill、README、Provider 模板和 vNext 规格均可用；旧源码、旧静态 Workbench、Docker/旧配置、旧 Provider 桥接器与 source map 均不存在。
- 本机 Skill 部署：退出码 0；已原子替换 `/Users/apple/.codex/skills/daoge-pic`，并确认本机加载目录的包版本为 `5.0.0`，旧 `app/` 和 `references/task_spec.md` 不存在。
- 最终包 SHA-256：`62c010d592c476a58fa856c22433bad425403b885ff3d9a3c74060ef19732404`。

## 覆盖范围

测试覆盖 Studio Schema/migration、事件与 SSE 游标、Provider 脱敏、计划确认和干跑、队列/租约/恢复、未知外部结果、媒体日志恢复、导入/评审/软删除/恢复、交付日志、FTS、CLI 契约、Workbench 静态服务，以及旧版程序、静态 Workbench、Docker 配置、旧 Provider 桥接器和参考资料不得回流的目录结构门禁。

## 尚未形成机器证据的事项

当前环境未提供 Playwright 或等价浏览器自动化工具，因此未生成桌面/移动视口截图或像素级 UI 验证。已由 Vite 生产构建和 API 的 Workbench 静态服务测试覆盖资源可用性，但交互视觉验收仍应在具备浏览器自动化的环境补充。
