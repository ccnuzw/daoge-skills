# 启动细节、访问授权与首次汇报

SKILL.md 只保留启动主线（判断触发 → 解析工作区 → 一条 `enter` → 汇报）。本文件是主线之外、按需查阅的启动细节。

## 跨会话复用

同一稳定工作区的每个独立智能体会话都可在首次执行型触发调用普通 `open`；去重由共享 daemon 的内存 presence/open-claim 协议保证，不依赖会话间互相知道状态。已存在活动 Workbench、最近认证连接或未过期 claim 时，CLI 安全返回复用结果且不调用 OS opener。`open --force true` 只允许在用户明确要求新开标签时使用；Skill 的普通启动不得 force。协议不承诺 OS opener 能识别或聚焦既有标签，daemon 只保证普通 open 最多触发一个实际 opener。

`--force true` 只控制是否新开浏览器标签，不改变 Studio 身份；`--allow-nested-studio true` 只确认用户确实要在已有父级 Studio 内创建另一个隔离 Studio。两者不得混用为工作区恢复手段。

## 打开失败与安全访问

如果系统自动打开失败但 daemon 健康，向用户提供且只提供安全命令 `node scripts/daoge.js open --workspace <path>`；安装包语境可提供 `npx daoge open --workspace <path>`。不得回显或要求用户复制 bootstrap URL、capability、Cookie、session token 或 runtime 私密字段，裸 Workbench origin 也不得作为主要访问方式。

## Provider 未配置

没有 active Provider Profile 不阻止 Studio 启动或 Workbench 打开。应引导用户在 Workbench 的生成服务页配置并激活 Profile，然后回到会话继续；页面打开、加载或保存不得自动测试连接，只有用户明确发起的连接测试才可访问 Provider。

## 首次状态汇报

首次成功后必须用中文明确说明：Studio 已启动或已连接；根据 CLI 结果说明 Workbench **已在默认浏览器打开**（`opened:true`）或**已复用现有 Workbench**（`reused:true`）；用户继续在会话中描述和确认创作，Workbench 用于 Provider、素材、Generation History、选片和交付；同时汇报 Provider readiness、当前项目/任务/轮次、**运行构建是否最新（`build.staleBuild`）**与下一步。不得把 reused 谎报为新打开，也不重复给出链接、origin 或 bootstrap 信息。

## 本地访问授权与打开 Workbench

```bash
node scripts/daoge.js studio --workspace <path>
node scripts/daoge.js open --workspace <path> [--allow-nested-studio true]
node scripts/daoge.js enter --workspace <path> --conversation <id|auto> [--project <名称或 id>] [--cli <宿主 CLI 名>] [--skill daoge-pic] [--skill-version <v>] [--restart-stale <true|false>]
node scripts/daoge.js stop --workspace <path>
```

`open` 必须先完成工作区身份检查，再通过已授权本地 API 获取 daemon 内存 opener claim，并由唯一持有者使用跨平台安全 opener。健康 daemon 的重启、关闭和恢复必须走受控本地 API；不得用外部 PID kill 或 shell 拼接 URL 代替。`daoge stop` 是受控关闭（关完不自动重启，要再起来用 `enter`/`open`）；重启语义见 `references/build-identity.md`。

Workbench 通过 URL fragment bootstrap 换取 `HttpOnly`、`SameSite=Strict` Cookie 后清除 fragment；CLI 使用 Bearer capability。除最小健康检查外，API、媒体、ZIP 和 SSE 都要求当前 Studio 授权，写入还校验 Host、Origin 和 Content-Type。`status` 只能返回脱敏 daemon 信息。

daemon 的 capability、session token、确认门签名密钥与 Workbench presence 按工作区持久化在 `daoge-studio/runtime/` 下（0600），因此**重启 daemon 不会让已打开的 Workbench 标签失效，也不会丢弃已提交的确认挑战与已签发的 `confirm_token`**；`open` 在重启后同样会报告复用现有 Workbench。需要主动轮换凭据时删除 `daoge-studio/runtime/daemon-identity.json` 并重启，此后旧 Cookie 与旧 token 立即失效。这些文件绝不能被输出、复制或读取回显。

## enter 返回字段

读 `enter` 的返回值就能汇报，不必再补命令：

| 字段 | 含义 |
| --- | --- |
| `workbench.opened` / `reused` | 已打开 / 已复用（`reason` 给原因） |
| `contextBound: true` | **已进入项目**；`false` 时看 `projectResolution` |
| `projectResolution` | `matched` / `ambiguous` / `not-found` / `not-requested` |
| `project` / `projectCandidates` / `projects` | 命中的项目 / 歧义候选 / 全部项目 |
| `session.id` + `projectId` / `taskId` / `roundId` | 后续 `preflight` / `run` 用 `--session` |
| `build.staleBuild` | daemon 是否跑当前构建（见 `references/build-identity.md`） |
| `conversationSource` | 会话 ID 来自显式参数还是环境变量 |
| `pendingRequests` | 待处理请求，入场先处理 |

`--conversation` 只认显式 ID 或 `auto`（读 `DAOGE_CONVERSATION_ID` / `OMP_CONVERSATION_ID`）；都拿不到就 fail-loud，要么问用户一次，要么请宿主补环境变量。`build.staleBuild` 陈旧时按 `references/build-identity.md` 处理，**禁止**用 `ps`、时间戳或 git 反推。

## 回答规范

首次执行型触发按本文件「首次状态汇报」完整说明启动与访问状态。后续更新只需简要说明 Workbench 已复用、Provider readiness、当前项目/任务/轮次、计划是否待确认、预检结果、明确选择的 Generation Run、成功/失败数量、恢复边界及下一步；不重复链接或访问地址。不要暴露 API Key、完整 Base URL、capability、bootstrap URL、Cookie、session token、完整 Provider 请求、内部 SQLite 细节、绝对媒体路径或临时文件。
