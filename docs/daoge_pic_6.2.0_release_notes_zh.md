# DAOGE Pic v6.2.0 发布说明

- 发布日期：2026-09-21
- Git 标签：`daoge-pic-v6.2.0`
- 状态：正式发布
- 影响 Skill：`daoge-pic`。
- package/runtime 版本：`6.2.0`。
- Skill protocol：`daoge-pic-skill-protocol/3.1.0`（本次未变）。
- 运行时兼容范围：`>=6.0.0 <7.0.0`（本次未变，6.1.1 / 6.1.0 / 6.0.0 daemon 可直接复用）。
- Studio schema：`41`（本次无迁移）。
- 分发渠道：GitHub Release 不可变 `.tgz` 资产；不发布到 npm registry。

## 本次更新

**小版本：把 agent 侧的往返次数与回显体积压下来。全部是加法 —— 协议、schema、兼容范围、既有命令的老签名都没有变化。**

### 响应投影：写与读都不再回显计划正文

`plan` / `preflight` / `run` / `pause` / `cancel` / `resume` / `round-status` / `provider-list` / `project-list` / `task-list` / `round-list` / `round-detail` / `run-items` 现在默认返回**投影**：只保留 id、状态、版本、计数、问题清单与少量摘要。

- 实测（4 张计划的历史样本）：`plan --challenge` 回显 21.3 KB → 约 0.2 KB；`preflight` 13.6 KB → 约 0.1 KB；一次 `round-status` 32.1 KB → 约 0.3 KB（较大样本 109 KB）。一轮「写计划 → 预检 → 读状态」的计划正文回显从约 67 KB 降到 1 KB 以内。
- 投影同时**不再回传确认挑战值与 `planHash`**：这两项只属于 Workbench 的确认按钮，不该进 agent 上下文。
- 需要原始 API 形状（排障、与 Workbench 对拍）时加 `--full`，老行为完整保留。

### `daoge wait`：等待终于有动词

以 `/api/events` 的 cursor 作唤醒信号、以 round detail 的 `latestRun.status` + `tally` 作权威状态，一次调用等到终态（`completed` / `failed` / `cancelled` / `partial`）、首张成功或超时。超时返回**真实状态**并带 `timedOut: true`，不谎报终态；事件只是唤醒信号，不是事实源。

### 校验前移：机器可判的错误不再拖到人工确认之后

`plan`（=准备确认）写入前先跑**同一份** preflight 规则做纯形状校验（条数、长度、operation 与参考素材/遮罩一致性等），Provider 已配置时连能力与限额一起判。失败回 `400 {code:"plan_invalid", details:{issues:[…]}}`，批次停在 `draft` 不推进；草稿仍可用 `PUT /api/rounds/<id>/draft-context` 自由写。**未配置 Provider 时只要求形状正确** —— 「先写计划、后配生成服务」这条工作流不受影响。

### 写侧与读侧的离合

- `plan --project <名|id>`：没有草稿任务/批次时自动建，并读回批次版本号；`--version` 可省。
- `run --auto-preflight true --session <id> [--wait true]`：先预检再入队（预检仍留下 dry-run 记录，`confirm_token` 仍绑定 `plan_hash + preflight_id + conversation_id`），可选继续等终态。
- `delivery-export --project <id> --assets <ids> --name <名>`：一步走完草稿 → 准备 → 导出；需要修订的批次仍走三步。
- `plan --style-kit <id> --brand-kit <id>`：服务端把配方正文合并进计划（合并结果进 plan hash，`appliedKits` 记录出处），agent 只写本次增量。
- 新增 `task-list` / `round-list` / `round-detail`（含 `tally`）/ `run-items`；`provider-list` 默认瘦身、`--descriptors` 才给能力全表；`project-list` 支持 `--name` / `--status` / `--limit`。
- `request-accept` / `request-renew --lease <分钟>`（1–1440）：跨人工确认的长活一次领够，不必每 10 分钟心跳。
- `daoge --help` 分「Agent 主线」与「人类 / 运维」两段。

### Workbench

事件消费收敛到纯逻辑模块 `web/src/studio-events-model.mjs`：游标只前进、`snapshot-required` 在权威快照恢复前不推进、乱序/重复 id 不回退、刷新域列表稳定去重。行为与 6.1.1 一致，差别只在断流与游标过期这两条路径上不再跳号或回退。

### 验证

- 全量回归、构建与打包验证记录见 `skills/daoge-pic/docs/vnext_verification_evidence_zh.md` 的 6.2.0 章节。
- 正式制品 `daoge-pic-6.2.0.tgz` 为 758,945 bytes，npm shasum 为 `3a04b720038a1dd51c1e8694e3a1f7e7937c3f09`，SHA-256 为 `045385895b72790d302a281c3df185d718ff486c111de6d0663b8892ad90c3a8`（以 GitHub Release 与 `.tgz.sha256` sidecar 为准）。
- Windows CI（`windows-2022` / `windows-2025` × Node `22.17.0` / `24`）在本版本 push 后由 `.github/workflows/daoge-pic-windows.yml` 运行；本地新增/修改的测试统一使用 `os.tmpdir()` + `path.join`，不含 POSIX 分隔符或 CRLF 假设。
- 所有本地验证均未调用真实图片 Provider，也未产生计费生成请求。

## 兼容性说明

- 协议仍为 `daoge-pic-skill-protocol/3.1.0`；`6.2.0` 是制品与运行时版本，不是协议版本。
- Studio schema 仍为 `41`，本次无迁移。
- 老签名全部保留：`plan --round --version`、`run --preflight --confirm-token`、`delivery-*` 三步、`provider-list`（加 `--full` 即原样）都还能用。
- 默认输出形状变了（投影）：依赖原始响应字段的脚本请加 `--full`。

## 安装

以下命令固定使用本版本 GitHub Release 的不可变 `.tgz`，不会跟随 `main`。

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.2.0/daoge-pic-6.2.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.2.0/daoge-pic-6.2.0.tgz"
daoge register-skill --scope user --host omp
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 与 `daoge.cmd`。注册命令在目标已存在时失败，不删除或覆盖已有 Skill 目录。

## 升级建议

- 从 6.1.1 / 6.1.0 / 6.0.0 升级无需数据迁移；升级后建议新开一个 agent 会话，让 `SKILL.md` 重新加载。
- 升级后 daemon 会自动按构建身份换进程（`enter` / `open` 时自愈），无需手工重启。