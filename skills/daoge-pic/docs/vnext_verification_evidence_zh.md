# DAOGE Pic vNext 验证记录

本文件只记录实际执行的发布验证，不定义产品需求或实现状态。需求唯一来源是 [vNext 升级规格](daoge_pic_vnext_upgrade_spec_zh.md)；实现以对应版本的源码为准。

验证证据外置在源码仓库与对应 GitHub Release 中，供维护者审计；它不属于 `daoge-pic` 运行时 npm 包，也不得成为安装后启动 Studio 的依赖。

## 1. daoge-pic 5.4.0 已发布历史证据

本节对应已正式发布的 [`daoge-pic-v5.4.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.4.0)。以下历史验证内容原样保留；其中时间、数量、哈希和环境只证明 5.4.0，不得转用为后续版本证据。

### 本轮机器证据

- 最终验证时间：2026-08-31T17:21:59Z（本地 macOS，Node.js 26.7.0）；工作树包含待提交的 `v5.4.0` 发行变更。
- `npm test`：退出码 0；先执行 TypeScript 与 Vite 生产构建，再运行 `tests/vnext/*.test.js`，共 83 通过、0 失败。覆盖计划确认与预检、Provider 安全门槛、项目/任务/轮次/运行范围、选择与评审、创作者交付状态机、项目与交付 ZIP 的真实文件内容、ZIP 与共享素材跨 Studio 授权、深链范围隔离、运行恢复和 Workbench 静态服务。
- `npm run test:package`：退出码 0；发布清单包含 70 个必要文件，`*.map` 为 0，旧版路径为 0。
- 真实参考图变体验证：收到明确确认后执行单次运行；计划使用 1 张受管理参考资产，输出 2 项 `1:1` 图片。两个运行项均以一次尝试到达 `succeeded`，没有自动重放或重试；轮次范围归档 2 张生成 PNG，下载端点均返回 `image/png` 附件和有效 PNG 签名。
- `npm pack --json --ignore-scripts`：最终 `daoge-pic-5.4.0.tgz` 含 70 个文件，npm shasum 为 `9e98b052a3fe16a5d73ba13851b44fbbe344e90e`，SHA-256 为 `10915df67d29fa8c25da30417ef0b0d7b39e26cac82f07e0fecc696e04367e61`；清单不含 source map、旧版路径或依赖目录，仅包含预期的无密钥 `provider.env.example` 模板。

### 覆盖范围

测试覆盖 Studio Schema/migration、事件与 SSE 游标、Provider 脱敏、计划确认和干跑、输出规格、项目/任务/轮次/运行/运行项状态、Workbench URL 路由、Session 上下文、任务和项目资产范围、目标范围去重、轮次谱系、资产来源和评审历史、项目范围评审准入、交付 `draft -> ready -> exported` 状态机与冻结副本、创作者选择/交付/领取主流程、项目和交付 ZIP、明确共享素材、学习中心、资料库、CLI 契约、队列/租约/终态收敛与未知外部结果，以及 Workbench 静态服务。

### 尚未形成机器证据的事项

当前环境未提供可用的 Playwright 或等价浏览器自动化后端。Chrome 无头模式在本机因 allocator/renderer 异常退出，未生成桌面/移动视口截图或像素级 UI 验证。Vite 生产构建、Workbench 静态服务 API 测试和组件/路由测试覆盖资源可用性与核心交互契约；视觉验收仍应在具备可用浏览器自动化的环境补充。

## 2. daoge-pic 5.5.0 已发布历史证据

本节对应已正式发布的 [`daoge-pic-v5.5.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.5.0)，标签提交为 `1741c56bd05ed6fa4974ac679abab60e6b7c6a0f`，发布时间为 2026-09-01T03:13:40Z。

- 发布前 vNext 自动化回归 `88/88` 通过，package smoke 通过。
- Release 制品 `daoge-pic-5.5.0.tgz` 为 203,159 bytes，SHA-256 为 `d76844e34aba42feb8a53ed6b4629c5c5a94fd4548dc75f02d4083ffa7bb38d2`。
- 该版本提供动态画幅、尺寸、分辨率和单次运行并发，工作区 Worker 默认上限提升为 `30`，运行时设置迁移到 SQLite Schema v14。

## 3. daoge-pic 5.6.0 发布证据

本节对应 [`daoge-pic-v5.6.0`](https://github.com/ccnuzw/daoge-skills/releases/tag/daoge-pic-v5.6.0) 的发布源码与不可变 `.tgz` 制品。

### 最终机器证据

- 最终验证时间：2026-09-01T13:33:39Z；环境为本地 macOS，Node.js v22.23.0。
- `npm test`：退出码 0；TypeScript 与 Vite 生产构建成功，Node 内置测试运行器共执行 207 项，207 通过、0 失败、0 取消、0 跳过、0 待办。
- `npm run test:package`：退出码 0；实际构建、打包并安装候选包，发布清单包含 86 个文件，`unexpected=0`、source map 为 0、退役路径为 0；已安装包的 `daoge` bin、`--help` 和运行时/Workbench/Provider 模板路径检查全部通过。
- 正式制品 `daoge-pic-5.6.0.tgz` 为 244,112 bytes，npm shasum 为 `6c9406220c62e5407b5ebc904a65d13b6ff2b0ea`，SHA-256 为 `19467b05624e18494e087982b0d261edd28cadc486602089e6a636bc986fe27a`。
- CLI smoke：源码 launcher 与编译后直接入口均正常执行 `--help`，stdout 完全一致；无效命令、缺失参数、显式幂等键、manifest 工作区身份和首次初始化零副作用均有自动化回归。

### 覆盖范围

- 运行引擎：取消竞态、租约丢失、`outcome_unknown`、到期自动重试、稳定 request identity、`1..30` 单次运行并发、跨 Worker 全局上限、显式启动恢复与 `resume_pending` 会话门禁。
- 本地与 Provider 安全：daemon capability、失败可重试的 Cookie bootstrap、Host/Origin/Content-Type 门禁、Studio 跨范围拒绝、凭据重定向拒绝、仅全局单播地址、DNS pin/remote-address 校验、流式响应大小上限和 Windows/POSIX 敏感路径权限合同。
- 媒体与交付：从工作区根逐级拒绝符号链接、跨 Studio 生成 journal 拒绝、verified snapshot、Provider reference/mask 冻结读取、同 inode/pathname 竞态拒绝、递归 orphan 对账、Studio-scoped 交付 journal、冻结文件集合和带 backpressure/abort 的流式 ZIP。
- 数据迁移：Schema v17 保留唯一可归属的旧幂等回执和用户任务类型，歧义数据进入隔离表；用户任务类型按 Studio 隔离。
- Workbench：route stale-response 防护、Studio-scoped SSE cursor、Generation History、三阶段可恢复交付、搜索 combobox、跨项目/轮次状态重置、portal/backdrop/inert 模态框、移动 44px 目标和 reduced-motion。

### 真实浏览器证据

- 在未配置 Provider 的临时稳定工作区完成真实 Chromium smoke；未执行 plan、confirm、preflight 或 run，因此没有外部 Provider 调用。
- 桌面 1440×1000 验证错误 capability 不挂载工作台、fragment 保留、替换为有效 capability 后重试成功；素材预览打开时应用根实际设置 `inert` 与 `aria-hidden`，backdrop 关闭后焦点返回触发按钮。
- 移动 390×844 验证项目资产页面无 document 横向溢出，主要控件、素材卡和导航完整可见；浏览器控制台在授权成功后的业务流程中无错误。

### Provider 验证边界

本轮发布验证刻意没有调用真实图片 Provider。真实计费生成、Provider 侧最终规格接受度和外部请求结果只能在后续得到用户明确确认的独立验证中记录。
