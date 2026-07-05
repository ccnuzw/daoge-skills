# DAOGE Interactive Image Batch

DAOGE 是批量生图任务工作台。普通用户只有一个推荐入口：输出目录里的 `workspace/index.html`。

## 最短使用路径

准备任务：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
```

执行任务：

```bash
node scripts/daoge.js execute --output-dir out --env-file .env
```

打开工作台：

```bash
open out/workspace/index.html
```

`prepare` 未传 `--prompts-file` 时，会根据 `task_spec.json` 自动生成 `debug/prompts.generated.json`。需要精细控制时再传策略和提示词文件：

```bash
node scripts/daoge.js prepare \
  --task-spec task_spec.json \
  --strategy-file prompt_strategy.json \
  --prompts-file prompts.json \
  --output-dir out
```

执行时未传 `--prompts-file`，会优先读取 `out/debug/prompts.generated.json`。

## 常用命令

小样或流程测试：

```bash
node scripts/daoge.js execute --output-dir out --env-file .env --dry-run true --batch-size 1
```

失败复跑：

```bash
node scripts/daoge.js rerun \
  --resume-manifest out/internal/local_execution_raw.json \
  --failed-only true \
  --env-file .env \
  --output-dir out_rerun
```

宿主原生结果回填：

```bash
node scripts/daoge.js ingest \
  --prompt-pack-file host_native_prompt_pack.json \
  --results-file host_results.json \
  --output-dir out
```

## 用户输出

- `workspace/`：用户页面，只包含 `index.html`、`prepare.html`、`results.html`、`issues.html`、`record.html`
- `assets/`：输入、参考、遮罩、结果、复核、问题、已选、交付、归档
- `internal/`：机器状态和页面视图模型
- `debug/`：维护诊断和生成的提示词

普通用户打开 `workspace/index.html`，页面会显示当前任务、当前阶段、下一步、可回复内容和问题处理入口。

## 代码结构

- `src/cli/`：单一命令入口
- `src/contracts/`：任务、结果、问题、资产、状态、页面视图契约
- `src/domain/`：准备、执行、计划、问题、资产库、工作台状态
- `src/providers/`：OpenAI Images 和宿主原生结果适配
- `src/renderers/`：HTML 工作台渲染
- `src/shared/`：路径、JSON、参数、环境变量等通用能力
- `scripts/`：`daoge.js` 和 smoke 测试

## 契约源

- `internal/workspace_state.json` 是唯一工作台状态源
- `internal/view_models/*.json` 是页面唯一输入
- 关键 JSON 写入使用临时文件加 rename
- provider 接口统一为 `generate(request)`、`edit(request)`、`capabilities()`

## 测试

```bash
npm test
```
