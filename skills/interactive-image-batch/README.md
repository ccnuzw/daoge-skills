# DAOGE Interactive Image Batch

DAOGE 是批量生图任务工作台。它把准备、执行、宿主结果回填和复核整理成一条稳定主线。

普通用户只需要记住一个页面入口：

```bash
open out/workspace/index.html
```

`workspace/index.html` 会告诉你当前阶段、下一步、该看结果还是先处理问题。`internal/` 和 `debug/` 是机器与维护诊断目录，不是普通用户入口。

## 最快三条路径

### 1. Dry-run 验流程

不消耗生图额度，用来确认任务、页面和路径能跑通。

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --dry-run true --batch-size 1
open out/workspace/index.html
```

### 2. 真实 provider 小样本

用真实 provider 跑 1 批小样本。需要 `.env` 里有可用 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`。

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --env-file .env --batch-size 1 --concurrency 1
open out/workspace/results.html
```

### 3. Host-native 结果回填

宿主侧出图后，只要整理出 `host_native_results.json`，就能回填到 DAOGE 工作台。

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js ingest --results-file host_native_results.json --output-dir out
open out/workspace/index.html
```

如果宿主侧另有交接包，可以额外传：

```bash
node scripts/daoge.js ingest \
  --prompt-pack-file host_native_prompt_pack.json \
  --results-file host_native_results.json \
  --output-dir out
```

`host_native_results.json` 中的相对 `output` 路径按该结果文件所在目录解析。

## 唯一 CLI

发布版只保留一个脚本入口：

```bash
node scripts/daoge.js prepare
node scripts/daoge.js execute
node scripts/daoge.js ingest
node scripts/daoge.js rerun
node scripts/daoge.js review
```

不再使用旧脚本入口。

## 用户会看到什么

- `workspace/index.html`：当前任务入口。
- `workspace/prepare.html`：开跑前确认。
- `workspace/results.html`：结果筛选。
- `workspace/issues.html`：问题和失败处理。
- `workspace/record.html`：任务记录。
- `assets/`：结果、复核、问题、已选和交付文件。

普通用户不用打开：

- `internal/`
- `debug/`

## 最小 task_spec

```json
{
  "content_brief": "高端时尚竖版海报",
  "output_mode": "photoreal campaign poster",
  "style_requirements": ["full-body", "9:16 poster"],
  "total_count": 2,
  "batch_size": 1,
  "width": 1440,
  "height": 2560
}
```

保存为 `task_spec.json` 后即可运行 dry-run 路径。

## 文档分层

- 用户使用：本 README、[`../../docs/DAOGE_完整使用说明.md`](../../docs/DAOGE_完整使用说明.md)
- 宿主接入：[`references/host_native_adapter_playbook_zh.md`](references/host_native_adapter_playbook_zh.md)、[`references/host_native_integration_sop_zh.md`](references/host_native_integration_sop_zh.md)
- 开发维护：[`docs/architecture_v2_zh.md`](docs/architecture_v2_zh.md)、[`docs/release_contract_zh.md`](docs/release_contract_zh.md)
- 验收报告：[`docs/user_acceptance_report_zh.md`](docs/user_acceptance_report_zh.md)

带 `phase`、`plan`、`trial` 的历史文档只作规划记录，不作为当前用户入口。

## 测试

```bash
npm test
```
