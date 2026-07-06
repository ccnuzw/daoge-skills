# DAOGE 完整使用说明

本文是 DAOGE v2 用户手册。当前用户只需要记住：一个 CLI、一个工作台入口、四条常用路径。

本文所有命令默认从 skill 目录执行：

```bash
cd skills/interactive-image-batch
```

```bash
node scripts/daoge.js <prepare|execute|ingest|rerun|review>
open out/workspace/index.html
```

`workspace/index.html` 是总入口。它会告诉你当前阶段、下一步、该看结果还是先处理问题。

## 1. DAOGE 是什么

DAOGE 是批量生图任务工作台。它负责：

1. 把自然语言需求整理成 `task_spec.json`。
2. 用 `prepare` 生成提示词和工作台。
3. 用 `execute` 做 dry-run 或真实 provider 出图。
4. 用 `ingest` 接收宿主生成结果。
5. 用 `workspace/` 显示结果、问题和记录。

普通用户不需要从 `internal/` 或 `debug/` 开始。排查问题时再看这些文件。

## 2. 唯一 CLI

当前只推荐：

```bash
node scripts/daoge.js prepare
node scripts/daoge.js execute
node scripts/daoge.js ingest
node scripts/daoge.js rerun
node scripts/daoge.js review
```

旧多脚本入口、旧工作台页面名、旧 HTML 看板不作为当前入口。历史文档如保留，只作阶段记录。

## 3. 最小 task_spec

把自然语言 brief 写成 `task_spec.json`：

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

仓库内也有可直接跑的最小示例：

```bash
references/examples/task_spec.minimal.json
```

常用字段：

- `content_brief`：这次要生成什么。
- `output_mode`：输出类型。
- `style_requirements`：风格和约束。
- `reference_images`：参考图，可选。
- `total_count`：生成数量。
- `batch_size`：每批数量。
- `width` / `height`：尺寸。

## 4. 路径一：新手最小路径

适用场景：第一次使用，只想确认 DAOGE 能准备任务和生成工作台。

最小输入：`task_spec.json`。

命令：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
open out/workspace/index.html
```

期望输出：

- `workspace/index.html`：总入口。
- `workspace/prepare.html`：开跑前确认。
- `debug/task_spec.normalized.json`：规范化任务。
- `debug/prompts.generated.json`：生成后的提示词。
- `internal/execution_manifest.json`：当前执行摘要。
- `internal/issue_queue.json`：问题队列，prepare 正常时可为空。

常见失败点：

- `缺少 --task-spec`：补任务文件路径。
- JSON 格式错误：修 `task_spec.json`。
- 页面没生成：先看命令是否报错，再看 `out/workspace/index.html` 是否存在。

下一步：确认 `prepare.html` 和 `debug/prompts.generated.json` 符合预期，再执行 dry-run。

## 5. 路径二：本地执行路径

适用场景：本机验流程或直接调用 provider 出图。

### Dry-run

不调用 provider，不消耗额度。

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --dry-run true --batch-size 1
open out/workspace/index.html
```

期望输出：

- `workspace/index.html`
- `workspace/record.html`
- `internal/execution_manifest.json`

常见失败点：

- 没先 `prepare`：`execute` 找不到 `debug/prompts.generated.json`。
- 素材路径不存在：问题会进入 `workspace/issues.html`。

下一步：确认链路可跑后，切真实 provider 小样本。

### 真实 provider 小样本

`.env` 最少包含：

```env
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-image-2
```

命令：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --env-file .env --batch-size 1 --concurrency 1
open out/workspace/results.html
```

期望输出：

- `workspace/results.html`
- `workspace/issues.html`
- `assets/results/`
- `assets/issues/`
- `internal/local_execution_raw.json`
- `internal/execution_manifest.json`

常见失败点：

- API key / `.env` 缺失：补 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`。
- provider 超时：降低 `--concurrency` 或延长 `--timeout-seconds`。
- provider HTTP/API 失败：看 `internal/issue_queue.json` 的 `reason`。

下一步：成功结果进 `results.html`；失败项进 `issues.html`。

## 6. 路径三：宿主接入路径

适用场景：宿主环境负责出图，DAOGE 负责准备提示词和回填结果。

最小输入：

- `task_spec.json`
- 宿主生成的 `host_native_results.json`

命令：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
# 宿主读取 out/debug/prompts.generated.json 并生成图片
node scripts/daoge.js ingest --results-file host_native_results.json --output-dir out
open out/workspace/index.html
```

如宿主有交接包：

```bash
node scripts/daoge.js ingest \
  --results-file host_native_results.json \
  --output-dir out \
  --prompt-pack-file host_native_prompt_pack.json
```

`host_native_results.json` 最小示例：

```json
[
  {
    "index": "001",
    "title": "主视觉 A",
    "requestMode": "prompt-only",
    "status": "success",
    "output": "outputs/a.png"
  },
  {
    "index": "002",
    "title": "主视觉 B",
    "requestMode": "prompt-only",
    "status": "failed",
    "error": "provider timeout"
  }
]
```

期望输出：

- `internal/execution_manifest.json`
- `internal/issue_queue.json`
- `workspace/results.html`
- `workspace/issues.html`
- `workspace/record.html`

常见失败点：

- `status` 只能是 `success`、`needs_review`、`failed`。
- `success` 和 `needs_review` 必须有 `output`。
- 相对 `output` 按 `host_native_results.json` 所在目录解析。
- schema 错误时 `ingest` 会失败，不会写假成功。

下一步：从 `workspace/index.html` 进入结果或问题页。

## 7. 路径四：失败恢复路径

适用场景：出现失败、缺图、缺素材、待复核、workspace 输出异常。

先打开：

```bash
open out/workspace/issues.html
```

再看实际文件：

```bash
cat out/internal/issue_queue.json
cat out/internal/execution_manifest.json
```

如果只是刷新工作台：

```bash
node scripts/daoge.js review --output-dir out
```

如果 provider 失败可补跑：

```bash
node scripts/daoge.js rerun \
  --prompts-file out/debug/prompts.generated.json \
  --resume-manifest out/internal/local_execution_raw.json \
  --failed-only true \
  --env-file .env \
  --output-dir out_rerun
```

常见失败点和动作：

- API key / `.env` 问题：补 key 后重跑 `execute`。
- provider 执行失败：看 `issue_queue.json`，可补跑则 `rerun --failed-only`。
- 素材路径失败：修 `task_spec.json` 或素材路径，重新 `prepare`。
- reference bindings 缺失：看 `debug/prompts.generated.json`，确认参考图、遮罩、输入图存在。
- host-native schema 错误：修 `host_native_results.json` 后重跑 `ingest`。
- workspace 输出为空：先跑 `review --output-dir out`，再看 `internal/workspace_state.json`。
- prompt 不符合预期：改 `task_spec.json` 后重新 `prepare`。

下一步：能补跑就补跑；不能补跑先修输入，再从对应路径重进。

## 8. 工作台页面

- `workspace/index.html`：总入口和下一步。
- `workspace/prepare.html`：准备确认。
- `workspace/results.html`：结果筛选。
- `workspace/issues.html`：问题处理。
- `workspace/record.html`：任务记录。

用户资产：

- `assets/results/`：成功结果。
- `assets/review/`：待复核结果。
- `assets/issues/`：失败或缺图结果。
- `assets/selected/`：已选结果。
- `assets/exports/`：交付候选。

## 9. 排查文件

| 文件 | 什么时候看 | 说明 |
| --- | --- | --- |
| `workspace/index.html` | 每次完成命令后 | 当前状态和下一步 |
| `debug/task_spec.normalized.json` | 任务不对 | 看 DAOGE 理解后的任务 |
| `debug/prompts.generated.json` | prompt 不对、素材路径错 | 看最终提示词和素材引用 |
| `internal/execution_manifest.json` | 结果数量或状态不对 | 看 success / failed / needs_review |
| `internal/issue_queue.json` | 有失败或缺图 | 看原因、影响、下一步 |
| `internal/local_execution_raw.json` | provider 补跑 | `rerun --resume-manifest` 输入 |
| `internal/host_native_execution.json` | 宿主回填后 | ingest 原始执行摘要 |
| `host_native_results.json` | 宿主 schema 错 | 宿主输出源文件 |

## 10. 示例库

先看：

- `references/examples/task_spec.minimal.json`
- `references/examples/README.md`
- `references/examples/examples_catalog.html`

示例 JSON 可作为 task spec 参考。真正开跑时，优先复制成自己的 `task_spec.json`，再走统一入口。

## 11. 文档分层

用户入口：

- `skills/interactive-image-batch/README.md`
- 本文档

示例：

- `skills/interactive-image-batch/references/examples/README.md`

宿主接入：

- `skills/interactive-image-batch/references/host_native_adapter_playbook_zh.md`
- `skills/interactive-image-batch/references/host_native_integration_sop_zh.md`

发布契约：

- `skills/interactive-image-batch/docs/release_contract_zh.md`

历史规划：

- 文件名包含 `phase`、`plan`、`trial` 的旧文档只作历史记录，不作为当前入口。
