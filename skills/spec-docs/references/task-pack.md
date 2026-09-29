# 任务包与统一工作流入口

## 1. 任务包解决什么问题

`context-pack` 负责收敛事实和文档路径；`task-pack` 在此基础上生成一份可以交给 AI 或开发者执行的只读任务契约，包含目标、阶段、读取顺序、阻断项、验证命令和回写清单。

任务包不是新的权威来源，也不复制业务规则。它只把当前权威文档和事实注册表整理成一次工作的最小边界。

## 2. 用法

```bash
node scripts/spec-docs.mjs task \
  --feature V1-FR-001 \
  --phase planning \
  --objective "补齐用户注册的规格与验证入口"

node scripts/spec-docs.mjs task \
  --slice V1-core \
  --phase development \
  --out .tmp/v1-core-task.json
```

直接调用底层脚本仍然有效：

```bash
node scripts/task-pack.mjs --feature V1-FR-001
```

## 3. 任务包字段

| 字段 | 含义 |
| --- | --- |
| `objective` | 本次工作目标，不改变权威业务规则 |
| `phase` | `planning`、`development` 或 `release` |
| `read_order` | 建议读取顺序，包含 AGENTS、policy、事实和权威文档 |
| `facts` / `slices` | 当前选择范围内的机器事实和交付切片 |
| `blockers` | Draft、future、blocked 或上下文缺失项 |
| `commands` | 适合当前阶段的 review、check 和 gate 命令 |
| `writeback` | 完成后需要同步的文档和证据位置 |

`read_only=true` 表示生成任务包不会修改文档、policy、事实注册表或代码。

## 4. 统一入口

```bash
node scripts/spec-docs.mjs init --profile lite --target /absolute/project
node scripts/spec-docs.mjs task --feature V1-FR-001
node scripts/spec-docs.mjs review --phase planning --feature V1-FR-001
node scripts/spec-docs.mjs gate --phase planning
node scripts/spec-docs.mjs status --dir /absolute/project
node scripts/spec-docs.mjs audit --repo /absolute/project
```

`lite`、`standard`、`regulated` 分别映射到 S、M、L policy。`--tier s|m|l` 继续作为兼容接口。
