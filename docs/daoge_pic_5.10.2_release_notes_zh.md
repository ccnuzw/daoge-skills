# DAOGE Pic v5.10.2

本版本修复 Provider 活跃请求被错误限制为 4 的回归，并将高并发生成升级为自适应、可观测和流式持久化运行。与此同时，批量生成支持逐图提示词，Workbench 补齐运行项级重试入口。

## 并发与稳定性

- Provider 安全目标并发上限为 `100`，初始目标为 `16`。
- 健康窗口逐步升速；429、临时故障、未知结果和 Worker 资源压力会自动降速并进入冷却。
- Worker 池由父进程统一分配动态 Provider 配额，保留 Generation Run 逻辑并发 `1..1000` 和 SQLite 全局租约边界。
- `/api/providers` runtime 与 Workbench Provider 设置页显示脱敏的并发目标、活动配额、降速原因和资源样本。

## Provider 媒体路径

- JSON/Base64 Provider 响应增量解析并流式解码到受控临时文件。
- Provider 返回的公开图片 URL 按既有 SSRF、DNS 固定和大小校验逐跳流式落盘。
- 只有不超过 `1 MiB` 的小结果保留为内存 Buffer；大结果通过 staging、哈希、大小和媒体类型校验后归档。
- 取消、租约丢失、重复资产和持久化失败路径均清理 Provider 临时目录。

## 批量创作与 Workbench

- 计划支持 `itemPrompts`，每张图可使用独立提示词；逐图提示词必须是与生成数量一致的非空字符串数组，单条最多 `8 KiB`。
- 逐图提示词在 dry-run 和 Generation Run 的单项 payload 中冻结，并在实际 Provider 请求中生效。
- Generation History 为可重试的 failed、blocked 和 retry_wait 运行项提供单项重试入口；重试仍使用原有幂等和未知结果安全边界。

## 验证与制品

- `npm test`：294 项通过，0 失败。
- `npm run test:package`：116 个发布文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- `npm run bench:perf`：100000 pending 项领取 1000 项耗时 `132.28 ms`，RSS `86.6 MiB`。
- 验证使用本地模拟 Provider，未调用真实图片 Provider，不产生计费生成请求。

- 制品 `daoge-pic-5.10.2.tgz`：330,962 bytes。
- SHA-256：`4b3b7b289371645cb652118c3319dda9ce7b5b0f4aeec01e4c494ecaded6f1ed`。

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.2/daoge-pic-5.10.2.tgz"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.2/daoge-pic-5.10.2.tgz"
```

安装并注册 Skill 后，需要完整重启 Codex，使其重新加载 Skill registry。
