# DAOGE 完整使用说明

本文是发布前正式用户手册。普通用户只需要理解少量入口：一个 CLI、一个工作台入口、三条常用路径。

## 1. DAOGE 是什么

DAOGE 是批量生图任务工作台。它负责：

1. 根据 `task_spec.json` 准备任务。
2. 执行 dry-run 或真实 provider 生图。
3. 接收 host-native 宿主结果。
4. 把结果、问题和记录整理进工作台。

普通用户只打开：

```bash
out/workspace/index.html
```

`workspace/index.html` 会告诉你当前状态和下一步。

## 2. 唯一 CLI

发布版只使用：

```bash
node scripts/daoge.js prepare
node scripts/daoge.js execute
node scripts/daoge.js ingest
node scripts/daoge.js rerun
node scripts/daoge.js review
```

旧脚本入口、旧工作台页面名和旧 HTML 看板不作为当前使用入口。

## 3. 准备 task_spec

最小示例：

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

保存为：

```text
task_spec.json
```

常用字段：

- `content_brief`：这次要生成什么。
- `output_mode`：输出类型。
- `style_requirements`：风格要求。
- `reference_images`：参考图，可选。
- `total_count`：生成数量。
- `batch_size`：每批数量。
- `width` / `height`：尺寸。

## 4. 路径一：dry-run 验流程

用途：第一次跑、检查任务、检查页面，不消耗生图额度。

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --dry-run true --batch-size 1
open out/workspace/index.html
```

完成后看：

- `workspace/index.html`：现在到哪一步。
- `workspace/prepare.html`：开跑前确认。
- `workspace/record.html`：本轮记录。

## 5. 路径二：真实 provider 小样本

用途：确认真实 provider 能出图。建议先只跑 1 批。

`.env` 至少包含：

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

完成后看：

- `workspace/results.html`：筛选成功结果。
- `workspace/issues.html`：处理失败或缺素材。
- `workspace/record.html`：回看本轮做了什么。

## 6. 路径三：host-native 回填

用途：宿主环境自己生成图片，DAOGE 只负责准备、导入和工作台整理。

先准备：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
```

宿主侧生成 `host_native_results.json`：

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

导入：

```bash
node scripts/daoge.js ingest --results-file host_native_results.json --output-dir out
open out/workspace/index.html
```

说明：

- `success` 和 `needs_review` 必须有 `output`。
- `failed` 建议有 `error`。
- 相对 `output` 路径按 `host_native_results.json` 所在目录解析。
- `--prompt-pack-file` 只是可选宿主交接包，不是默认必填。

## 7. 工作台怎么看

只从 `workspace/index.html` 开始。

页面含义：

- `index.html`：当前状态和下一步。
- `prepare.html`：准备是否齐。
- `results.html`：筛图。
- `issues.html`：失败、缺素材、待处理问题。
- `record.html`：任务记录。

状态落点：

- 成功结果进入结果页。
- 待复核结果进入结果页的复核区域。
- 失败、缺文件、缺素材进入问题页。
- 本轮记录进入记录页。

## 8. 普通用户不用打开什么

以下目录存在，但不是普通用户入口：

- `internal/`
- `debug/`

你只需要打开 `workspace/index.html`。如果页面提示去结果页、问题页或记录页，按页面按钮走即可。

## 9. 复跑和复核

如果页面显示有问题，先打开：

```bash
open out/workspace/issues.html
```

如果需要复跑，先按 `issues.html` 页面提示确认要复跑的失败项。命令行复跑需要上次执行记录，普通用户不需要手工填写内部路径。

如果只是刷新工作台：

```bash
node scripts/daoge.js review --output-dir out
```

## 10. 文档分层

用户使用：

- `skills/interactive-image-batch/README.md`
- 本文档

宿主接入：

- `skills/interactive-image-batch/references/host_native_adapter_playbook_zh.md`
- `skills/interactive-image-batch/references/host_native_integration_sop_zh.md`

开发维护：

- `skills/interactive-image-batch/docs/architecture_v2_zh.md`
- `skills/interactive-image-batch/docs/release_contract_zh.md`

历史规划：

- 文件名包含 `phase`、`plan`、`trial` 的旧文档只作历史记录，不作为当前入口。

## 11. 第一轮验收清单

跑完后确认：

1. `workspace/index.html` 能打开。
2. 页面能告诉你下一步。
3. 成功图能在结果页看到。
4. 失败或缺素材能在问题页看到。
5. 记录页能说明本轮做了什么。
6. 你没有被要求打开 `internal/` 或 `debug/`。
