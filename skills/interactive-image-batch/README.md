# DAOGE Interactive Image Batch

DAOGE 是批量生图任务工作台。它把一句需求整理成可检查任务，再执行本地 provider 或接收宿主结果，最后把结果、问题和记录放进同一个工作台。

适合用 DAOGE 的场景：

- 一次要生成多张图，需要批量提示词和筛选页。
- 要先 dry-run 检查任务，不想马上消耗额度。
- 图片由宿主工具生成，但结果要回填到统一工作台。
- 失败后要知道是 key、provider、素材、结果 schema 还是 prompt 问题。

最短可跑命令：

```bash
node scripts/daoge.js prepare --task-spec references/examples/task_spec.minimal.json --output-dir out
open out/workspace/index.html
```

输出入口：

- `out/workspace/index.html`：永远先打开这里。
- `out/debug/task_spec.normalized.json`：准备后的任务。
- `out/debug/prompts.generated.json`：准备后的提示词。
- `out/internal/issue_queue.json`：失败和待处理问题。

普通用户只需要记住一个页面入口：`out/workspace/index.html`。

下一步：

- 想验流程：看下面“新手最小路径”。
- 想真实出图：看“本地执行路径”。
- 想接宿主：看“宿主接入路径”。
- 已经失败：看“失败恢复路径”。

## 入口规则

当前只推荐一个 CLI：

```bash
node scripts/daoge.js prepare
node scripts/daoge.js execute
node scripts/daoge.js ingest
node scripts/daoge.js rerun
node scripts/daoge.js review
```

旧多脚本入口不作为当前用户入口。带 `phase`、`plan`、`trial` 的文档只作历史记录。

## 路径一：新手最小路径

适用场景：第一次使用，只想从自然语言 brief 生成工作台，不调用 provider。

最小输入：一个 `task_spec.json`。可以先复制：

```json
{
  "content_brief": "高端时尚竖版海报，主体清楚，顶部和底部留标题安全区",
  "output_mode": "photoreal campaign poster",
  "style_requirements": ["full-body", "9:16 poster", "quiet luxury"],
  "total_count": 2,
  "batch_size": 1,
  "width": 1440,
  "height": 2560
}
```

可复制命令：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
open out/workspace/index.html
```

期望输出：

- `out/workspace/index.html`
- `out/workspace/prepare.html`
- `out/debug/task_spec.normalized.json`
- `out/debug/prompts.generated.json`
- `out/internal/execution_manifest.json`
- `out/internal/issue_queue.json`

常见失败点：

- `缺少 --task-spec`：命令没传任务文件。
- JSON 语法错误：检查逗号、引号、括号。
- workspace 空：打开 `out/workspace/index.html` 前确认 `prepare` 没报错。

下一步动作：打开 `workspace/prepare.html` 看任务和提示词是否符合预期；没问题再走 dry-run 或真实 provider。

## 路径二：本地执行路径

适用场景：要在本机执行 dry-run 或调用 provider 出图。

最小输入：已跑过 `prepare` 的 `out/`。真实 provider 还需要 `.env`。

dry-run：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --dry-run true --batch-size 1
open out/workspace/index.html
```

真实 provider 小样本：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --env-file .env --batch-size 1 --concurrency 1
open out/workspace/results.html
```

`.env` 最少需要：

```env
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-image-2
```

期望输出：

- dry-run：`workspace/index.html`、`workspace/record.html`、`internal/execution_manifest.json`
- provider：`workspace/results.html`、`workspace/issues.html`、`assets/results/`、`assets/issues/`

常见失败点：

- API key 缺失：检查 `.env` 和错误里的 env 文件路径。
- provider 超时或 HTTP/API 失败：看 `internal/issue_queue.json` 的 `reason`、`userAction`。
- 素材路径失败：看 `debug/prompts.generated.json` 中对应 item 的素材路径。

下一步动作：成功进 `workspace/results.html` 筛选；失败进 `workspace/issues.html` 处理或补跑。

## 路径三：宿主接入路径

适用场景：图片由宿主工具、第三方工作台或自建脚本生成，DAOGE 只负责准备提示词和回填结果。

最小输入：

- `task_spec.json`
- 宿主生成后的 `host_native_results.json`

可复制命令：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
# 宿主读取 out/debug/prompts.generated.json 并生成图片
node scripts/daoge.js ingest --results-file host_native_results.json --output-dir out
open out/workspace/index.html
```

如果宿主侧另有交接包，可以额外传：

```bash
node scripts/daoge.js ingest \
  --results-file host_native_results.json \
  --output-dir out \
  --prompt-pack-file host_native_prompt_pack.json
```

`host_native_results.json` 最小形态：

```json
[
  {
    "index": "001",
    "title": "主视觉 A",
    "requestMode": "prompt-only",
    "status": "success",
    "output": "outputs/a.png"
  }
]
```

期望输出：

- `out/internal/execution_manifest.json`
- `out/internal/issue_queue.json`
- `out/workspace/results.html`
- `out/workspace/issues.html`
- `out/workspace/record.html`

常见失败点：

- `status` 不是 `success`、`needs_review`、`failed`。
- `success` 或 `needs_review` 缺 `output`。
- 相对 `output` 写错；它按 `host_native_results.json` 所在目录解析。
- schema 错误导致 `ingest` 直接失败。

下一步动作：打开 `workspace/index.html`；成功看结果页，失败看问题页。

## 路径四：失败恢复路径

适用场景：execute 或 ingest 后有失败、缺图、缺素材、待复核。

最小输入：已有 `out/`。

可复制命令：

```bash
open out/workspace/issues.html
```

维护者可直接看队列：

```bash
cat out/internal/issue_queue.json
cat out/internal/execution_manifest.json
```

如果只是刷新工作台：

```bash
node scripts/daoge.js review --output-dir out
```

如果是 provider 失败且队列标记可补跑：

```bash
node scripts/daoge.js rerun \
  --prompts-file out/debug/prompts.generated.json \
  --resume-manifest out/internal/local_execution_raw.json \
  --failed-only true \
  --env-file .env \
  --output-dir out_rerun
```

期望输出：

- `workspace/issues.html` 显示影响和下一步。
- `internal/issue_queue.json` 给出 `reason`、`userAction`、`rerunnable`。
- `internal/execution_manifest.json` 给出结果状态和缺失输出。

常见失败点：

- 缺素材：先修 `task_spec.json` 或素材路径，再重新 `prepare`。
- reference bindings 缺失：检查 `debug/prompts.generated.json` 是否仍引用不存在素材。
- provider 失败：检查 `.env`、并发、超时，再 `rerun --failed-only`。
- host-native schema 错误：先修 `host_native_results.json`，再重跑 `ingest`。
- prompt 不符合预期：改 `task_spec.json`，重新 `prepare`，看 `debug/prompts.generated.json`。

下一步动作：能补跑就 `rerun`；不能补跑先修输入文件，再重新从 `prepare` 或 `ingest` 进入。

## 示例入口

- 最小可跑任务：[`references/examples/task_spec.minimal.json`](references/examples/task_spec.minimal.json)
- 示例索引：[`references/examples/README.md`](references/examples/README.md)
- 示例浏览页：[`references/examples/examples_catalog.html`](references/examples/examples_catalog.html)

## 故障排查速查

| 问题 | 先看文件 | 处理 |
| --- | --- | --- |
| API key / `.env` 问题 | `.env`、终端错误 | 补 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY` 后重跑 `execute` |
| provider 执行失败 | `internal/issue_queue.json`、`internal/execution_manifest.json` | 降低 `--concurrency`、延长超时或 `rerun --failed-only` |
| 素材路径失败 | `debug/prompts.generated.json`、`debug/task_spec.normalized.json` | 修素材路径后重新 `prepare` |
| reference bindings 缺失 | `debug/prompts.generated.json` | 确认参考图、遮罩、输入图存在 |
| host-native schema 错误 | `host_native_results.json`、`references/host_native_results.schema.json` | 修字段后重跑 `ingest` |
| workspace 输出为空 | `workspace/index.html`、`internal/workspace_state.json` | 先确认 `prepare` 或 `review` 成功 |
| prompt 不符合预期 | `debug/prompts.generated.json`、`debug/task_spec.normalized.json` | 改 `task_spec.json` 后重新 `prepare` |
| execute 后如何恢复 | `workspace/issues.html`、`internal/issue_queue.json` | 按 `userAction` 修输入、补素材或补跑 |

## 文档分层

- 用户手册：[`../../docs/DAOGE_完整使用说明.md`](../../docs/DAOGE_完整使用说明.md)
- 宿主接入：[`references/host_native_adapter_playbook_zh.md`](references/host_native_adapter_playbook_zh.md)、[`references/host_native_integration_sop_zh.md`](references/host_native_integration_sop_zh.md)
- 发布契约：[`docs/release_contract_zh.md`](docs/release_contract_zh.md)
- 开发架构：[`docs/architecture_v2_zh.md`](docs/architecture_v2_zh.md)

## 测试

```bash
npm run test:unit
npm run test:contracts
npm run test:integration
```
