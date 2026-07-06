# DAOGE v2 用户上手闭环完成报告

日期：2026-07-06

## 结论

Goal 8 已完成。README、完整手册、SKILL 说明、examples 索引和宿主接入文档已统一到“一个 CLI、一个工作台入口、四条用户路径”。

当前推荐入口只有：

```bash
node scripts/daoge.js <prepare|execute|ingest|rerun|review>
open out/workspace/index.html
```

旧多脚本入口不再作为当前用户入口。

## 本轮改动路径

### 新手最小路径

用户从 `references/examples/task_spec.minimal.json` 开始：

```bash
node scripts/daoge.js prepare --task-spec references/examples/task_spec.minimal.json --output-dir out
open out/workspace/index.html
```

文档说明已指向：

- `workspace/index.html`
- `workspace/prepare.html`
- `debug/task_spec.normalized.json`
- `debug/prompts.generated.json`

### 本地执行路径

文档区分 dry-run 和真实 provider：

```bash
node scripts/daoge.js execute --output-dir out --dry-run true --batch-size 1
node scripts/daoge.js execute --output-dir out --env-file .env --batch-size 1 --concurrency 1
```

失败时指向 `workspace/issues.html` 和 `internal/issue_queue.json`。

### 宿主接入路径

宿主侧统一读取 `out/debug/prompts.generated.json`，回填统一走：

```bash
node scripts/daoge.js ingest --results-file host_native_results.json --output-dir out
```

`--prompt-pack-file` 只作为兼容交接包，不是默认必填。

### 失败恢复路径

用户先打开：

```bash
open out/workspace/issues.html
```

维护者再看：

- `internal/issue_queue.json`
- `internal/execution_manifest.json`
- `debug/prompts.generated.json`
- `debug/task_spec.normalized.json`

文档已覆盖 API key、provider 失败、素材缺失、reference bindings、host-native schema、workspace 空输出和 prompt 不符合预期。

## 旧入口处理

已从当前用户文档和 examples 入口中移除或降级旧表达：

- `validate_host_native_results.js`
- `ingest_host_native_results.js`
- `build_host_native_prompt_pack.js`
- `binding_intent_draft`
- `binding_plan`
- `reference_bindings.imported`
- `--import-reference-assets`
- `--use-llm-binding-planner`
- 当前不可复制的 `--example-id` 用户入口

仍保留在 `docs/daoge_phase3_*` 的 `--example-id` 属于历史规划文档；文件首行已明确“历史规划文档，不作为当前发布入口”。

## 示例库改动

- 新增 `references/examples/task_spec.minimal.json` 作为最小可跑示例。
- `references/examples/README.md` 改为用户路径索引，不再堆全量 catalog 历史批次。
- `references/examples/examples_catalog.html` 复制命令统一改成 `scripts/daoge.js prepare --task-spec ... --output-dir ...`。
- 示例按新手、进阶、宿主接入、回归测试四类说明用途。

## 已验证命令

```bash
git diff --check
npm --prefix skills/interactive-image-batch run test:unit
npm --prefix skills/interactive-image-batch run test:contracts
npm --prefix skills/interactive-image-batch run test:integration
npm --prefix skills/interactive-image-batch run test:artifacts
npm --prefix skills/interactive-image-batch run test:smoke
```

本轮 review 时以上命令均通过。

## 剩余风险

- 真实 provider 上手体验仍依赖本机 `.env`、网络和 provider 配额。
- examples catalog 仍是静态 HTML；后续如继续扩展，可考虑让 CLI 提供稳定的 example 选择能力，再恢复更强的交互入口。
- 当前文档已经以用户路径为主，作者侧模板治理文档仍可后续拆分得更干净。
