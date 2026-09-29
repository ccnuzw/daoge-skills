# 交付上下文包

`context-pack.mjs` 根据功能或交付切片生成一份只读 JSON 上下文包，供 AI 会话、开发者交接和评审使用。它输出路径、事实状态和最小关联文档清单，不复制文档全文，也不替项目作业务判断。需要目标、阶段、阻断项、验证命令和回写清单时，使用上层的 `task-pack.mjs`。

## 用法

```sh
node scripts/context-pack.mjs --slice V1-core
node scripts/context-pack.mjs --feature V1-FR-001
node scripts/context-pack.mjs --slice V1-core --out .tmp/v1-core-context.json
```

默认读取项目根的 `docs-policy.json` 和 `docs-facts.json`。使用 `--docs-root` 可以临时指定文档目录。输出包含：

- `selector`：本次选择的功能或切片；
- `facts`：直接事实及其权威来源、状态、切片和证据引用；
- `slices`：目标切片及直接依赖；
- `documents`：按读取顺序去重后的仓库内文档；
- `warnings`：缺失事实、缺少权威文件或引用越界；
- `read_only: true`：明确工具不会改写文档、policy 或注册表。

上下文包不是新的权威来源。开发前仍需阅读项目 `AGENTS.md`、功能文档、公共契约、冻结决策、实现状态和相关测试；上下文包只是把这些入口按当前任务收敛出来。
