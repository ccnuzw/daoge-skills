# 命令、宿主表与幂等

本文件是 SKILL.md 的**按需**附录：高风险命令签名、`--host` 宿主表、幂等恢复、预算闸门与备份语义。启动、计划、确认、预检、运行这几条主线在 SKILL.md 里。

## 命令目录不在这里抄第二遍

完整命令目录**以 CLI 自身为唯一来源**：

```bash
node scripts/daoge.js --help            # 全部命令与用法
node scripts/daoge.js <命令> --help      # 单条命令的参数
```

用法文本由 CLI 的命令表生成，不会与实现漂移；本文件只补 `--help` 说不清的东西：高风险签名、宿主目录、幂等、预算与备份语义。

## register-skill 的宿主目录

宿主全表以 `daoge register-skill --help` 的 `--host 可用：…` 为准（同一张表同时驱动安装与 Workbench 连接面板的「侦查」）。要点：缺省 `codex`；`agents` = 跨宿主共享目录（多数宿主都读）；项目范围固定写 `<workspace>/.agents/skills` 且必须给 `--workspace`；未知宿主直接拒绝，不新建目录。面板只把**宿主自己的目录**当证据（IDE 数据目录不算装了 CLI）。

## 高风险命令签名

高风险命令必须按完整签名执行，缺失参数时停止并补齐，不得猜测默认值或把 secret 写入 argv：

```bash
node scripts/daoge.js provider-create --workspace <path> --name <name> --provider <id> --model <model> --base-url <url> --api-key-stdin @- [--endpoint-trust-mode <official|compatible_public|local_proxy|enterprise_private>] [--limits <json>] [--active true]
node scripts/daoge.js provider-update --workspace <path> --profile <id> --version <n> [--name <name>] [--provider <id>] [--model <model>] --base-url-action <keep|replace|clear> [--base-url <url>] --api-key-action <keep|replace|clear> [--api-key-stdin @-] [--endpoint-trust-mode <mode>] [--limits <json>]
node scripts/daoge.js provider-models --workspace <path> --profile <id>
node scripts/daoge.js preflight --workspace <path> --round <round-id> --session <session-id> [--concurrency <1..1000>]
node scripts/daoge.js run --workspace <path> --round <round-id> --preflight <dry-run-id> --confirm-token <daemon-token>
node scripts/daoge.js resume --workspace <path> --run <run-id> --session <session-id>
node scripts/daoge.js resolve-unknown --workspace <path> --run <run-id> --items <item-id,...>
node scripts/daoge.js template-save --workspace <path> --type <task_type|style_kit|brand_kit> --name <name> --definition <json|@-> --round <round-id> [--template <template-id>] [--provenance <json|@->] [--plan-version <n>]
```

secret 永远只从 stdin（`--api-key-stdin @-`）进来，不进 argv、不进日志。

## 幂等命令恢复

所有 POST / PUT mutation 可追加 `--operation-name <verb:scope>`，由 daemon 派生稳定幂等键；需要跨进程精确恢复时仍可使用 `--idempotency-key <stable-key>`，两者互斥。未提供任一参数时，CLI 生成的随机 key 不具备跨进程恢复语义。

## 用量与预算闸门

用量账本必须区分已知成本与未知成本；`usage-list`、`usage-summary`、`budget-get` 只读取当前 Studio 的层级范围，`budget-set` 仅接受 Bearer Skill/CLI，零额度仍是有效的非负安全整数。预算闸门只在计划声明了已知成本估算时才会硬拒绝：必须通过 `preflight --usage-estimate <json>` 把 `unit`、`quantity`、`estimatedCostMinor`、`costUnit`、`source` 一并声明，该估算会随运行冻结并逐项摊入账本。未声明估算时平台不推断价格，账本保持显式 unknown，`budget-set` 的额度不会凭空拦截任何运行。

## 备份与升级评估语义

`backup-restore-dry-run` 只产出计划、不写入任何文件；`backup-restore` 是真正的执行器：先写入同目录暂存区并按 manifest 逐文件校验哈希，再用原子 rename 替换，任一步失败即按原样回滚（新建文件会被删除），并拒绝「目标 Studio 的 daemon 正在运行」这一情形；恢复范围仅限 manifest 记录的文件。升级评估的「当前运行时与支持范围」由 daemon 自证，不受调用方声明影响。

## v6：新增与变更的动词（按需查阅）

- **投影与 `--full`**：`plan` / `preflight` / `run` / `pause` / `cancel` / `resume` / `round-status` / `provider-list` / `project-list` / `task-list` / `round-list` / `round-detail` / `run-items` 默认回**投影**（id/状态/版本/计数；不回 `plan`/`prompt`/`itemPrompts`/`planSnapshot`，也不回确认挑战值与 `planHash`）。要原始 API 形状排障时加 `--full`。
- **`provider-list [--descriptors true]`**：默认只回当前启用配置与各组摘要；Provider Descriptor 全表要显式要。
- **`project-list [--name <精确名>] [--status <active|archived>] [--limit <n>]`**：本地筛选，用于把项目名解析成 projectId。
- **`plan`**：`--round` 可选；`--project <名|id>` 时自动找到/建立 draft 任务与批次并读回版本号；`--version` 可选（不给就取当前版本）；`--style-kit` / `--brand-kit` 由服务端把配方正文合并进计划（合并结果进 plan hash），`--challenge true` 仍与写计划合并。
- **`run`**：`--auto-preflight true --session <id>` 先预检再入队；`--wait true [--timeout <秒>] [--interval <秒>]` 入队后继续等终态。显式 `--preflight <dry-run-id> --confirm-token <token>` 的老路径不变。
- **`wait --round <id> [--timeout <秒>] [--interval <秒>] [--until terminal|first-success]`**：一次调用替代 N 次轮询；超时回真实状态 + `timedOut: true`。
- **`task-list` / `round-list` / `round-detail` / `run-items`**：读结构的最小动词，替代"拉全表再自己找"。
- **`delivery-export --project <id> --assets <ids> --name <名>`**：一步走完草稿→准备→导出；需要修订的批次仍走 `delivery` / `delivery-update` / `delivery-ready`。
- **`request-accept` / `request-renew --lease <分钟>`**：把租约一次领到最多 24 小时（1–1440 分钟）。
- **计划写入前机器校验**：`POST /api/rounds/<id>/plan` 会在**人工确认之前**用同一份 `preflight` 规则做纯形状校验（外加 Provider 已知时的能力/限额判定），失败回 `400 {code:"plan_invalid", details:{issues:[{code,field,message}]}}`，批次停在 `draft` 不推进；草稿仍可用 `PUT /api/rounds/<id>/draft-context` 自由写。
- **帮助分两段**：`daoge --help` 先列「Agent 主线」，再列「人类 / 运维」。
