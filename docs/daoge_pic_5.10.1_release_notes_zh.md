# DAOGE Pic v5.10.1

本版本完成 vNext 控制面、SQLite、媒体恢复、Provider 内存边界和 Workbench 刷新链路的性能优化，并统一发布 Schema v22。5.10.0 的机器确认闸门、独立协议和双 worker pool 架构保持不变。

## 性能与资源边界

- 启动恢复不再重复执行资产媒体操作恢复；terminal run reconciliation 合并为聚合查询和单事务。
- session plan、dry-run、latest run 使用单行查找；过期 dry-run 采用批量清理；SQLite 增加运行、预检、运行项、事件和媒体恢复索引。
- claim 先计算全局可用槽位，再读取 pending 候选；异步媒体校验使用最多 4 路有界并发并保持结果顺序。
- Provider 错误响应限制为 64 KiB，已知长度响应使用预分配缓冲；单机 Provider 活跃请求上限为 4。
- daemon worker 子进程跳过重复完整性校验；维护任务约每秒运行一次，不再随每次短轮询执行。

## Workbench 与基准

- Workbench session plan 请求在依赖变化或组件卸载时取消；资产来源展示查询只处理请求资产关联的输出记录。
- 新增 `npm run bench:perf`，覆盖 1k、10k、100k pending 队列、事件保留、claim 耗时和 RSS。
- 100k pending 场景领取 1000 项约 142 ms，RSS 约 86 MiB；具体机器结果以发布时的验证记录为准。

## 验证与制品

- `npm test`：288 项通过，0 失败、0 取消、0 跳过。
- `npm run test:package`：发布清单 114 个文件，`unexpected=0`、`maps=0`、`retired=0`、`sensitive=0`，临时 consumer 安装、bin 与 help 检查通过。
- 未调用真实图片 Provider，未产生计费生成请求。
- 制品 `daoge-pic-5.10.1.tgz` 为 `324057` bytes，SHA-256 为 `3c7c64aadcaf010744b1fa3556631d890c8a7b34fae31c0a4622c2881fb8933a`；同值记录在 GitHub Release 和包外 `daoge-pic-5.10.1.tgz.sha256` sidecar。

## 安装

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.1/daoge-pic-5.10.1.tgz"
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v5.10.1/daoge-pic-5.10.1.tgz"
```

安装并注册 Skill 后，需要完整重启 Codex，使其重新加载 Skill registry。
