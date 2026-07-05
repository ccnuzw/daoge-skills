---
name: interactive-image-batch
description: Interactive batch image generation for DAOGE / 刀哥. Use when the user asks DAOGE to plan, prepare, execute, rerun, ingest, or review batch image generation tasks.
---

# Interactive image batch

用户可见沟通默认使用中文。DAOGE 的职责是把对话里的生图需求变成可执行任务，并把结果整理成用户能理解的工作台。

## 用户原则

- 普通用户只需要知道：任务、当前阶段、下一步、结果、问题处理。
- 普通用户入口始终是输出目录的 `workspace/index.html`。
- 用户页面不解释工程概念，不展示内部文件名，不要求用户理解程序状态。
- 有问题时先说明影响和建议动作，再给补跑或忽略选项。

## 唯一命令入口

所有本地操作从一个入口开始：

```bash
node scripts/daoge.js <command> [options]
```

命令：

- `prepare`：准备任务，生成工作台和开跑前检查
- `execute`：执行任务，支持文生图、图生图、mask 编辑、批量、干跑
- `rerun`：基于上次结果只复跑失败项
- `ingest`：回填宿主原生图像工具结果
- `refresh`：从已有结果刷新工作台

## 常用路径

准备任务：

```bash
node scripts/daoge.js prepare \
  --task-spec /abs/path/task_spec.json \
  --strategy-file /abs/path/prompt_strategy.json \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output
```

执行任务：

```bash
node scripts/daoge.js execute \
  --prompts-file /abs/path/prompts.generated.json \
  --task-spec /abs/path/task_spec.json \
  --env-file /abs/path/.env \
  --output-dir /abs/path/output
```

小样测试：

```bash
node scripts/daoge.js execute \
  --prompts-file /abs/path/prompts.generated.json \
  --task-spec /abs/path/task_spec.json \
  --env-file /abs/path/.env \
  --dry-run true \
  --batch-size 1 \
  --output-dir /abs/path/output
```

失败复跑：

```bash
node scripts/daoge.js rerun \
  --prompts-file /abs/path/prompts.generated.json \
  --resume-manifest /abs/path/output/internal/local_execution_raw.json \
  --failed-only true \
  --env-file /abs/path/.env \
  --output-dir /abs/path/rerun_output
```

宿主结果回填：

```bash
node scripts/daoge.js ingest \
  --prompt-pack-file /abs/path/host_native_prompt_pack.json \
  --results-file /abs/path/host_results.json \
  --output-dir /abs/path/output
```

## 输出结构

- `workspace/`：用户页面
- `assets/`：用户资产
- `internal/`：机器状态和页面视图模型
- `debug/`：维护诊断

`internal/workspace_state.json` 是唯一工作台状态源。页面只读 `internal/view_models/*.json`。

## provider 契约

provider 只暴露：

- `generate(request)`
- `edit(request)`
- `capabilities()`

文生图走 `generate`。图生图和 mask 编辑走 `edit`。

## 执行约束

- 不从模糊需求直接执行，先明确任务说明、提示词、数量、尺寸和参考素材。
- 需要真实调用接口时，确认 `.env` 里有 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`。
- 大批量建议先 `--dry-run true` 或小批量确认。
- 失败复跑基于上次执行记录，不手工重建提示词子集。
- 执行完成后先打开 `workspace/index.html`，再按页面主动作走。
