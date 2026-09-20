# 构建身份、重启与关闭

回答一个问题：**这个 daemon 跑的是不是当前这份安装？** 协议版本与运行时版本都是**区间**（`>=3.0.0 <4.0.0` / `>=6.0.0 <7.0.0`），所以一个还在跑旧代码的 daemon 在版本检查里永远显示「兼容」。构建身份给的是版本区间答不了的事实。

## 身份怎么算

- 身份 = `dist/vnext` 全部文件（按相对路径排序）的内容 SHA-256，取前 16 位；
- daemon 在**启动时钉住**自己的身份，之后 dist 被重建也不改口——进程只可能跑它启动那一刻加载的代码；
- CLI 拿自己这份 `dist` 的身份与 daemon 上报的比对：不同即 `build.staleBuild: true`；
- daemon 根本不报 `buildId`（旧构建）= 比本 CLI 老，判 `staleBuild: true`，绝不假设它是新的。

## `enter` 的自愈

`enter` 返回 `build` 字段。默认 `--restart-stale true`：

- 可证明陈旧、且**没有在飞请求**（`activeRequests === 0`）→ 当场换进程，返回 `staleRestart.previousPid` / `previousBuildId`；
- 有在飞请求或显式 `--restart-stale false` → 不换，返回 `staleReason`（`active-requests` / `restart-stale-disabled`）。

拿到 `staleReason` 时：先 `daoge restart`，再重跑 `enter`，然后继续。`restart` 是**换进程**语义——旧进程永远加载不到新代码，所以重启必须给出新 PID，并自证新进程已在当前构建上；给不出新 PID 或仍陈旧就是失败，不许谎报重启成功。

## 禁止的取证方式

**禁止**用 `ps`、dist 文件时间戳、git 历史、backup manifest 或任何目录扫描去推断 daemon 新旧。实测里正是这些「考古」烧掉了 14 分钟。新旧只有一个事实来源：`build.staleBuild`。

## 关闭

`daoge stop` 是受控关闭，关完不自动重启；要再起来用 `enter` 或 `open`。关闭同样走受控本地 API，不得用外部 PID kill。
