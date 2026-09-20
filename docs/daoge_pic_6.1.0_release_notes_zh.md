# DAOGE Pic v6.1.0 发布说明

- 发布日期：2026-09-21
- Git 标签：`daoge-pic-v6.1.0`
- 状态：正式发布
- 影响 Skill：`daoge-pic`。
- package/runtime 版本：`6.1.0`。
- Skill protocol：`daoge-pic-skill-protocol/3.1.0`（独立于制品版本，本次未变）。
- 运行时兼容范围：`>=6.0.0 <7.0.0`（本次未变，6.0.0 daemon 可直接复用）。
- Studio schema：`41`（本次无迁移）。
- 分发渠道：GitHub Release 不可变 `.tgz` 资产；不发布到 npm registry。

## 本次更新

**小版本，主题是「连接更快、上下文更省、事实不再靠猜」；不改协议、不改 schema、不破坏兼容。**

### 一步连接：`daoge enter`

- 新增原子命令 `daoge enter`，在一次进程内完成：确保同工作区唯一健康 daemon → 打开或复用 Workbench → 登记/续报在场 → 按 conversation 建立或恢复 Studio Session → **按项目名解析 projectId 并绑定会话上下文** → 读取 `pending` 请求队列。
- 在此之前，「连接 + 进入项目」要拆成 `agent-register` / `open` / `session` / `session-context` / `request-list` 多次调用；且 `session-context --project` 只接受内部 `projectId`，传项目名会直接 `Project not found`。
- 项目解析是确定性的：精确项目名、精确 `projectId` 或唯一的包含匹配才绑定（active 优先于 archived）；同名多个或找不到时返回 `projectResolution`（`ambiguous` / `not-found`）与 `projectCandidates`，**绝不替用户猜，也绝不新建重名项目**。
- 新增 `project-list` 直接列出项目。

### 构建身份：daemon 自证新旧

- 新增 `src/vnext/shared/build-identity.ts`：以 `dist/vnext` 全量内容哈希作为构建身份，daemon 启动时钉住，CLI 比对得 `build.staleBuild`。
- `status` / `enter` 返回 `build`（`cliBuildId` / `daemonBuildId` / `staleBuild` / `activeRequests`）；陈旧且无在飞请求时 `enter` 默认当场换进程并返回 `staleRestart`（`previousPid` / `previousBuildId`），有在飞请求或显式关闭时返回 `staleReason`。
- 新增 `daoge stop`（受控关闭，不自动重启）；`restart` 语义明确为换进程并自证新构建。
- 明确禁止用 `ps`、构建时间戳或 git 历史推断 daemon 新旧——实测中这些「考古」烧掉过 14 分钟。

### 会话身份有事实来源

- `enter --conversation auto` 读取宿主环境变量 `DAOGE_CONVERSATION_ID` / `OMP_CONVERSATION_ID`；都拿不到则 fail-loud，由用户回答一次或由宿主补齐，不允许翻宿主目录凑 ID。
- 返回 `conversationSource`（`flag` / `env`）与 `contextBound`；汇报「已进入项目」的依据是 `contextBound: true`，而不是可能来自上一次绑定的 `session.projectId`。

### CLI token 效率

- `enter` 输出精简约 80%：命中项目时只给 `projectCount`（不再回传约 1.7 KB 的全量项目目录）、运行时对象只留 `pid` + `buildId`、在场信息只留 CLI 与技能三字段，并默认输出紧凑 JSON。
- `daoge --help` 默认输出「命令名 + 一句话」速览；完整签名移到 `daoge --help --full` 与 `daoge <命令> --help`。
- 新增 `daoge reference <topic> --section <标题>`：只打印附录里的某一节，未知节会列出可用节名。
- 新增 `daoge round-status --round <id> --session <id>`：一次返回计划摘要与 Generation History，替代两次调用。
- `plan` 支持 `--challenge true`（配 `--session`）：写入计划的同时创建 Workbench 确认挑战，替代两步。
- `enter` / `status` / `open` / `restart` 不再回显 daemon origin；需要地址请用 `daoge studio`。

### Skill 渐进披露

- SKILL.md 从约 10.6k 压到约 3.2k tokens：保留触发分类、一步启动协议、强制红线、会话工作法、请求队列 MUST 与命令入口，长尾策略拆到 `references/` 按需附录。
- 附录为封闭白名单：`boundaries` / `startup` / `build-identity` / `flow` / `queue` / `commands` / `recovery` / `delivery` / `state-model` / `provider-keys` / `workbench`，SKILL.md 的主线自足，命中触发条件才读。
- 新增体积上限与「附录是封闭集合」守卫，防止主文件再次回涨；`package-smoke` 的 references 白名单同步为单一来源。

### 验证

- 正式制品 `daoge-pic-6.1.0.tgz` 为 710,823 bytes，npm shasum 为 `074a93d3df6682a84a5cfa02ef48525690c6d163`，SHA-256 为 `fa11259f76350eb4e8304e68c3f443bdc4210c4129a234685e4f6c95c17a7890`（以 GitHub Release 与 `.tgz.sha256` sidecar 为准）。
- 全量回归、构建与打包验证记录见 `skills/daoge-pic/docs/vnext_verification_evidence_zh.md` 的 6.1.0 章节。
- 所有本地验证均未调用真实图片 Provider，也未产生计费生成请求。

## 兼容性说明

- 运行时兼容范围仍为 `>=6.0.0 <7.0.0`：本版本可与 6.0.0 daemon / Workbench 平滑共存，无需数据迁移。
- Skill protocol 仍为 `daoge-pic-skill-protocol/3.1.0`；`6.1.0` 是制品与运行时版本，不是协议版本。
- Studio schema 仍为 `41`，本次无迁移。

## 安装

以下命令固定使用本版本 GitHub Release 的不可变 `.tgz`，不会跟随 `main`。npm 安装提供 `daoge` CLI 和运行时，内置 `register-skill` 创建 link/junction 供 Codex 发现 Skill；两步缺一不可。

项目级安装：

```bash
npm install "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.1.0/daoge-pic-6.1.0.tgz"
npx daoge register-skill --scope project --workspace /absolute/workspace
npx daoge doctor --workspace /absolute/workspace
```

全局安装：

```bash
npm install -g "https://github.com/ccnuzw/daoge-skills/releases/download/daoge-pic-v6.1.0/daoge-pic-6.1.0.tgz"
daoge register-skill --scope user
```

Windows PowerShell 使用 `npm.cmd`、`npx.cmd` 与 `daoge.cmd`。注册命令在目标已存在时失败，不删除或覆盖已有 Skill 目录。安装和注册完成后重启 Codex。

## 升级建议

- 从 6.0.0 升级无需数据迁移；升级后建议新开一个 agent 会话，让 SKILL.md 重新加载。
- 旧 `.agents/skills/daoge-pic` / `~/.codex/skills/daoge-pic` 若是本仓库的目录符号链接，更新源码与 `.tgz` 后重跑 `register-skill` 即可；目标已存在时它不会覆盖。
- 若目标 Skill 目录已存在且来源不明，请先确认来源并自行处理，不要直接覆盖。
