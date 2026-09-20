# 运行恢复、重试与媒体边界

本文件是 SKILL.md 的**按需**附录：只有出现失败、超时、`outcome_unknown`、`resume_pending`
或媒体缺失时才会用到。接重试单之前先读这张表，照表给建议，不要每次重新判断。

## 失败原因 → 建议

| 摘要里的信号 | 归谁 | 建议 |
|---|---|---|
| `quota` / `billing` / `insufficient` / `额度` / `余额` | 用户 | 先去生成服务充值或换一组配置，再重试 |
| `enospc` / `no space left` / `disk full` | 系统 | 先清理空间再继续；这一批不用重试 |
| `moderation` / `content policy` / `审核` / `敏感` | 用户 | 换一换描述或参数再试 |
| `rate limit` / `429` / `timeout` / `5xx` / `network` / `fetch failed` | 系统 | 等一会儿再重试，别反复点 |
| 都没有写明 | 未知 | 可以重试一次看看 |

关键词与前端 `failure-copy-model.mjs` 保持一致（有守卫对拍）；**先看具体原因（额度 / 磁盘），再看大类**。

## 恢复规则

- Provider 限流或临时故障进入有界重试；认证、模型、参数或权限错误不自动重试。
- 超时可以只在重试时覆盖：`retry --timeout-ms <1000..600000>`。它只改写该项的请求 payload，**不改写已确认的计划快照**，并把覆盖值记进 `run.queued` / `run.items_retried` 事件；因此超时属于重试参数，不需要重新确认计划。请求超时默认 120000 ms，上限 10 分钟。
- 外部请求结果不明时，运行项进入 `outcome_unknown`，绝不自动重放。用户核实无结果后，才可用 `resolve-unknown` 将指定项结案。
- daemon 重启时，未安全完成的运行进入 `resume_pending`；再次外部调用前必须在会话中得到用户确认，并以 `resume --session <session-id>` 记录。Workbench 只能显示等待状态，不能绕过会话继续。
- `retry` 只允许 `failed`、`blocked` 或 `retry_wait`；未结案的 `outcome_unknown` 不可直接重试。用户核实「没出图、没扣费」并 `resolve-unknown` 结案后，该运行项转为 `failed`，**可在原运行内重试**（重试会派生新的 `request_id`，不会重复计费；不必为补一张图新建轮次）。
- 并发只属于 Generation Run：预检未指定时默认 `4`，串行使用 `1`，显式值只接受 `1..1000`；并发变化必须重新预检。

## 媒体边界

- 缺失媒体持久标记为不可用，不得作为参考图、遮罩或交付候选；对账确认恢复后才重新可用。
- 下载、复制、交付导出和 ZIP 必须使用受验证 snapshot 流式读取；路径穿越、跨 Studio/跨项目访问、超出上限或客户端断连都不能形成错误交付。