# DAOGE Pic v5.10.0

本版本完成 Studio 机器确认闸门、独立协议版本、可恢复 CLI 幂等身份，以及生成与媒体双 worker pool 架构升级。Workbench 继续作为本地视觉管理与人工确认界面，不替代智能体会话。

## 安全与协议

- 新增 `challenge -> consent -> confirm_token` 机器闸门；令牌绑定当前 `plan_hash`、`preflight_id` 和 `conversation_id`。
- 人工确认只接受已授权 Workbench Cookie，Bearer Skill/CLI 无法伪造用户确认。
- confirmation challenge、consent 和 token 均为 daemon 内存状态；重启后必须重新确认。
- 协议版本独立为 `daoge-pic-skill-protocol 2.0.0`，daemon 按 `>=2.0.0 <3.0.0` 判断兼容性，而非精确字符串匹配。
- 已认证的读写 API 使用同一协议兼容规则。

## Worker 与媒体

- Provider 请求和生成结果持久化进入自适应 generation worker pool。
- 缩略图生成、ZIP 组装、导入归档校验和启动媒体对账进入独立 media worker pool，避免阻塞 control-plane 的 API 与 SSE。
- 两类 worker pool 根据本机并行度分配子进程，并继续受 Generation Run 全局并发与 SQLite WAL 约束。
- ZIP、缩略图和导入继续执行受管理路径、快照、哈希、大小及媒体类型校验。

## CLI 与 Workbench

- 新增 `--operation-name <verb:scope>`；daemon 使用 method、route、operation-name 和规范化 payload 派生稳定幂等键。JSON 对象键顺序不影响恢复身份。
- `--operation-name` 与显式 `--idempotency-key` 互斥；未提供任一参数时生成的随机 key 不承诺跨进程恢复。
- 大 JSON 支持 `--plan @-` stdin 传输；每次命令最多一个 `@-`，最大 8 MiB。
- Workbench 增加当前会话只读计划摘要、无活动轮次空状态和独立人工确认闸门；最近运行状态随 SSE 事件刷新。

## 验证与制品

- `npm test`：271 项通过，0 失败。
- `npm run test:package`：113 个发布文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- `npm audit --omit=dev --offline`：0 vulnerabilities；在线 registry audit endpoint 当次返回 503，不影响锁定依赖的离线审计结果。
- 制品 `daoge-pic-5.10.0.tgz`：305,783 bytes。
- SHA-256：`8096b6bc9ed4b19e76b77398bebbd2f35e2596844dec22d56db9e752cfce025c`。
- 验证未调用真实图片 Provider，未产生计费生成请求。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.0/daoge-pic-5.10.0.tgz"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.0/daoge-pic-5.10.0.tgz"
```

安装并注册 Skill 后，需要完整重启 Codex，使其重新加载 Skill registry。
