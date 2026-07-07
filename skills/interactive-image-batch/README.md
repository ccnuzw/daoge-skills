# DAOGE Interactive Image Batch

DAOGE 是本地批量生图资产管理工作台。skills 负责把需求整理成任务，CLI 负责准备、执行、导入、补跑和导出，SQLite 负责状态，`assets/` 负责图片文件，`daoge open` 负责启动固定 Workbench UI。

适合用 DAOGE 的场景：

- 一次要生成多张图，需要批量提示词和筛选页。
- 要先 dry-run 检查任务，不想马上消耗额度。
- 图片由宿主工具生成，但结果要回填到统一工作台。
- 失败后要知道是 key、provider、素材、结果 schema 还是 prompt 问题。

最短可跑命令：

```bash
node scripts/daoge.js prepare --task-spec references/examples/task_spec.minimal.json --output-dir out
node scripts/daoge.js open --output-dir out
```

输出入口：

- `node scripts/daoge.js open --output-dir out`：新主入口，启动本地 Workbench。
- `out/daoge.db`：项目状态中枢，只存状态、索引、关系、事件和元数据。
- `out/assets/`：输入、参考图、结果、缩略图、导出包和归档；图片二进制不写入 SQLite。
- `out/snapshots/`：可审计 JSON 快照。
- `out/workspace/index.html`：兼容静态页面和报告入口，不再是主工作台。
- `out/debug/task_spec.normalized.json`：准备后的任务。
- `out/debug/prompts.generated.json`：准备后的提示词。
- `out/internal/issue_queue.json`：失败和待处理问题。

普通用户只需要记住一个命令入口：`node scripts/daoge.js open --output-dir out`。

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
node scripts/daoge.js init
node scripts/daoge.js open
node scripts/daoge.js projects
node scripts/daoge.js export report
node scripts/daoge.js export pack
node scripts/daoge.js catalog
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
node scripts/daoge.js open --output-dir out
```

期望输出：

- `out/workspace/index.html`
- `out/daoge.db`
- `out/snapshots/run_*.json`
- `out/workspace/prepare.html`
- `out/debug/task_spec.normalized.json`
- `out/debug/prompts.generated.json`
- `out/internal/execution_manifest.json`
- `out/internal/issue_queue.json`

常见失败点：

- `缺少 --task-spec`：命令没传任务文件。
- JSON 语法错误：检查逗号、引号、括号。
- Workbench 空：打开本地 URL 前确认 `prepare` 没报错。

下一步动作：运行 `node scripts/daoge.js open --output-dir out`，在 Workbench 看任务和提示词是否符合预期；没问题再走 dry-run 或真实 provider。

## 路径二：本地执行路径

适用场景：要在本机执行 dry-run 或调用 provider 出图。

最小输入：已跑过 `prepare` 的 `out/`。真实 provider 还需要 `.env`。

dry-run：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --dry-run true --batch-size 1
node scripts/daoge.js open --output-dir out
```

真实 provider 小样本：

```bash
cp .env.example .env
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --env-file .env --batch-size 1 --concurrency 1
node scripts/daoge.js open --output-dir out
```

`.env.example` 提供完整模板；复制成 `.env` 后只填写要用的 provider。OpenAI Images 最少需要：

```env
IMAGE_PROVIDER=openai-images
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-image-2
```

Gemini 图片 provider 使用独立配置，不按 OpenAI Images API 兼容处理：

```env
IMAGE_PROVIDER=gemini-image
GEMINI_IMAGE_BASE_URL=
GEMINI_IMAGE_API_KEY=
GEMINI_IMAGE_MODEL=
GEMINI_IMAGE_AUTH_MODE=x-goog-api-key
```

Gemini OpenAI-compatible provider 走 `/images/generations` 风格：

```env
IMAGE_PROVIDER=gemini-openai-compatible
GEMINI_OPENAI_BASE_URL=
GEMINI_OPENAI_API_KEY=
GEMINI_OPENAI_MODEL=
GEMINI_OPENAI_IMAGE_GENERATE_PATH=
```

xAI/Grok 图片 provider：

```env
IMAGE_PROVIDER=xai-grok-image
XAI_IMAGE_BASE_URL=https://api.x.ai/v1
XAI_IMAGE_API_KEY=
XAI_IMAGE_MODEL=grok-imagine-image-quality
XAI_IMAGE_RESPONSE_FORMAT=
```

CLI `--provider` 高于 `.env` 里的 `IMAGE_PROVIDER`：

```bash
node scripts/daoge.js execute --provider openai-images --output-dir out --env-file .env --dry-run true
node scripts/daoge.js execute --provider gemini-image --output-dir out --env-file .env --batch-size 1 --concurrency 1
node scripts/daoge.js execute --provider gemini-openai-compatible --output-dir out --env-file .env --batch-size 1 --concurrency 1
node scripts/daoge.js execute --provider xai-grok-image --output-dir out --env-file .env --batch-size 1 --concurrency 1
```

运行真实 provider 测试前必须显式开启：

```bash
RUN_PROVIDER_INTEGRATION=1 npm run test:integration
```

Gemini 测试会从当前目录到上三级自动查找 `.env`，但没有 `RUN_PROVIDER_INTEGRATION=1` 时默认跳过真实网络。xAI/Grok 真实测试使用独立开关：

```bash
RUN_XAI_PROVIDER_INTEGRATION=1 npm run test:integration
```

Gemini OpenAI-compatible 用户代理探测：

```bash
RUN_PROVIDER_INTEGRATION=1 node scripts/probe_gemini_openai_provider.js .env
```

探测脚本只输出 endpoint path、auth mode、状态码和响应字段摘要；不输出密钥、真实 baseurl、响应原文或图片内容。

期望输出：

- dry-run：`workspace/index.html`、`workspace/record.html`、`internal/execution_manifest.json`
- provider：`workspace/results.html`、`workspace/issues.html`、`assets/results/`、`assets/issues/`
- Workbench：`daoge.db`、`assets/`、`snapshots/`

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
node scripts/daoge.js open --output-dir out
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

下一步动作：运行 `node scripts/daoge.js open --output-dir out`；成功看资产库，失败看问题中心。

## 路径四：失败恢复路径

适用场景：execute 或 ingest 后有失败、缺图、缺素材、待复核。

最小输入：已有 `out/`。

可复制命令：

```bash
node scripts/daoge.js open --output-dir out
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
- Workbench 问题中心可标记处理、创建补跑任务。

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
- 仓库补充文档：`docs/template_selection_guide_zh.md`、`docs/provider_configuration_zh.md`（不随 npm 包发布）

## 模板目录

查常用模板：

```bash
node scripts/daoge.js catalog --recommended true
```

按类别或关键词筛选：

```bash
node scripts/daoge.js catalog --category product-visuals
node scripts/daoge.js catalog --keyword 电商
```

返回内容包含类别、标签、适用场景、简短说明、变体、预览规则和示例参数。

## 本地 Workbench

```bash
node scripts/daoge.js init --output-dir out
node scripts/daoge.js open --output-dir out
node scripts/daoge.js projects
node scripts/daoge.js projects register --output-dir out
node scripts/daoge.js export report --output-dir out
node scripts/daoge.js export pack --output-dir out
```

`open` 默认绑定 `127.0.0.1`，只通过资产 id 访问文件，并且只服务当前项目目录内的资产。旧目录没有 `daoge.db` 时，`open` 会尝试从 `debug/` 和 `internal/` 里的兼容 JSON 导入，并写入 `snapshots/import_*.json`。

## 输出结构

- `daoge.db`：项目状态中枢，保存项目、运行、提示词、资产索引、问题、选择、标签、导出、任务和事件。
- `assets/`：输入素材、参考图、生成结果、缩略图、导出包和归档；图片二进制不进入 SQLite。
- `snapshots/`：运行、导入和导出的 JSON 快照，避免 DB 黑盒。
- `workspace/`：兼容静态页面，只稳定暴露 `index.html`、`prepare.html`、`results.html`、`issues.html`、`record.html`。
- `internal/`：兼容机器状态和页面视图模型。
- `debug/`：维护诊断；常看 `debug/task_spec.normalized.json` 和 `debug/prompts.generated.json`。

新 Workbench 以 `daoge.db` 为主状态源。`internal/workspace_state.json` 和 `internal/view_models/*.json` 继续生成，用于兼容静态页面和快照排查。

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
- 开发架构：[`docs/architecture_v2_zh.md`](docs/architecture_v2_zh.md)、[`docs/workbench_architecture_zh.md`](docs/workbench_architecture_zh.md)

## 测试

```bash
npm run test:unit
npm run test:contracts
npm run test:integration
```
