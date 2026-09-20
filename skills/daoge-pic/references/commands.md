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
