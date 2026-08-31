# DAOGE Pic vNext 验证记录

本文件只记录本轮实际执行的验证，不定义产品需求或实现状态。需求唯一来源是 [vNext 升级规格](daoge_pic_vnext_upgrade_spec_zh.md)；当前实现以 `src/vnext/` 与 `web/` 为准。

## 本轮机器证据

- 最终验证时间：2026-08-31T17:21:59Z（本地 macOS，Node.js 26.7.0）；工作树包含待提交的 `v5.4.0` 发行变更。
- `npm test`：退出码 0；先执行 TypeScript 与 Vite 生产构建，再运行 `tests/vnext/*.test.js`，共 83 通过、0 失败。覆盖计划确认与预检、Provider 安全门槛、项目/任务/轮次/运行范围、选择与评审、创作者交付状态机、项目与交付 ZIP 的真实文件内容、ZIP 与共享素材跨 Studio 授权、深链范围隔离、运行恢复和 Workbench 静态服务。
- `npm run test:package`：退出码 0；发布清单包含 70 个必要文件，`*.map` 为 0，旧版路径为 0。
- 真实参考图变体验证：收到明确确认后执行单次运行；计划使用 1 张受管理参考资产，输出 2 项 `1:1` 图片。两个运行项均以一次尝试到达 `succeeded`，没有自动重放或重试；轮次范围归档 2 张生成 PNG，下载端点均返回 `image/png` 附件和有效 PNG 签名。
- `npm pack --json --ignore-scripts`：最终 `daoge-pic-5.4.0.tgz` 含 70 个文件，npm shasum 为 `9e98b052a3fe16a5d73ba13851b44fbbe344e90e`，SHA-256 为 `10915df67d29fa8c25da30417ef0b0d7b39e26cac82f07e0fecc696e04367e61`；清单不含 source map、旧版路径或依赖目录，仅包含预期的无密钥 `provider.env.example` 模板。

## 覆盖范围

测试覆盖 Studio Schema/migration、事件与 SSE 游标、Provider 脱敏、计划确认和干跑、输出规格、项目/任务/轮次/运行/运行项状态、Workbench URL 路由、Session 上下文、任务和项目资产范围、目标范围去重、轮次谱系、资产来源和评审历史、项目范围评审准入、交付 `draft -> ready -> exported` 状态机与冻结副本、创作者选择/交付/领取主流程、项目和交付 ZIP、明确共享素材、学习中心、资料库、CLI 契约、队列/租约/终态收敛与未知外部结果，以及 Workbench 静态服务。

## 尚未形成机器证据的事项

当前环境未提供可用的 Playwright 或等价浏览器自动化后端。Chrome 无头模式在本机因 allocator/renderer 异常退出，未生成桌面/移动视口截图或像素级 UI 验证。Vite 生产构建、Workbench 静态服务 API 测试和组件/路由测试覆盖资源可用性与核心交互契约；视觉验收仍应在具备可用浏览器自动化的环境补充。
