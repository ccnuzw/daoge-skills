# DAOGE 触发模式

本文件定义 `interactive-image-batch` 的标准触发方式。

## 总体原则

把流程拆成两个明确阶段：

1. `prepare`
2. `execute`

`prepare` 只负责整理、校验、预览、总览，不正式生图。

`execute` 只在用户确认后触发，负责真正生成图片，并产出完成报告。

但是这个“两阶段主线”主要面向 **本地 runner 模式**。

如果当前环境命中的是：

- `host-native-image-tool`
- 或 `prompt-advisor`

则不必强行进入完整本地 `prepare -> execute` 路线。

推荐先运行：

```bash
node scripts/detect_runtime_mode.js
```

然后再决定走哪条路径。

## 运行模式与触发关系

### 1. `local-batch-runner`

这是默认完整主线：

- 先 `prepare`
- 再 `execute`

适用于：

- 有本地 `.env`
- 有 `OPENAI_BASE_URL`
- 有 `OPENAI_API_KEY`
- 用户确实要 DAOGE 本地跑图

### 2. `host-native-image-tool`

这是轻量路径，不要求强行进入完整本地 execute。

推荐行为：

- 做 DAOGE intake
- 做模板选择
- 做 prompt structuring
- 如果需要，产出 `prompts.generated.json` 或等价 prompt 摘要
- 推荐补一份稳定交付物：
  - `host_native_prompt_pack.json`
  - `host_native_summary.md`
  - `host_native_summary.html`
- 把真正的出图动作交给宿主原生图像工具
- 当宿主侧出图完成后，再把结果回填回 DAOGE 结果链

这里的重点是：

- 保留 DAOGE 的“规划能力”
- 不伪造本地 runner 的执行产物
- 让宿主侧接手时仍然有一份结构化交接包

推荐入口：

```bash
node scripts/build_host_native_prompt_pack.js \
  --prompts-file /abs/path/prompts.generated.json \
  --task-spec /abs/path/task_spec.normalized.json \
  --strategy-file /abs/path/prompt_strategy.normalized.json \
  --runtime-mode-file /abs/path/runtime_mode.json \
  --output-dir /abs/path/output_dir
```

宿主结果回填入口：

```bash
node scripts/ingest_host_native_results.js \
  --prompt-pack-file /abs/path/host_native_prompt_pack.json \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

推荐先独立校验结果文件：

```bash
node scripts/validate_host_native_results.js \
  --results-file /abs/path/host_native_results.json
```

相关契约文件：

- `references/host_native_results.schema.json`
- `references/examples/host-native/host_native_results.example.json`

### 3. `prompt-advisor`

这是顾问路径。

推荐行为：

- 完成 prompt 规划和结构化输出
- 不进入本地 execute
- 明确告诉用户当前只完成了提示词或规划层

### 4. `local-edit / rerun`

这条路径仍然依赖本地 runner 语义，因为它本质上依赖：

- `manifest.json`
- `resume-manifest`
- 旧输出复用
- slot 绑定安全

## 何时触发 prepare

当以下关键参数已经在对话中明确后，就可以触发 `prepare`：

- 内容主题
- 输出模式
- 总张数
- 运行参数：显式每批张数 / 分辨率 / 并发 / 超时 / 重试，或选择 DAOGE 运行预设
- 变化要求
- 文字排版要求

如果内容、输出模式、总张数、变化要求或文字排版要求没有明确，继续由 `DAOGE` 补参，不进入 `prepare`。

如果只缺运行控制参数，允许使用默认“安全 2K 海报”预设进入 `prepare`，并在总览面板里展示中文参数来源。

## prepare 的职责

`prepare` 需要一次性完成：

- `task_spec.normalized.json`
- `prompt_strategy.normalized.json`
- `prompt_slots.json`
- `prompt_draft_bundle.json`
- `prompt_validation_report.json`
- `prompt_preview.md`
- `batch_plan.json`
- `daoge_run_summary.md`
- `daoge_preflight_dashboard.md`

推荐入口：

```bash
node scripts/daoge_prepare_run.js \
  --task-spec /abs/path/task_spec.json \
  --strategy-file /abs/path/prompt_strategy.json \
  --prompts-file /abs/path/prompts.generated.json \
  --batch-size 30 \
  --preview-count 12
```

补充说明：

- 如果运行模式是 `host-native-image-tool`，可以只完成到 prompt planning / preview 层
- 不要求为了“流程完整”而硬生成本地 execute 产物
- 但至少应留下：
  - `prompts.generated.json`
  - `host_native_prompt_pack.json`
  - `host_native_summary.md`
- 如果宿主侧已经出图，则建议继续生成：
  - `manifest.json`
  - `success.json`
  - `needs_review.json`
  - `workspace/workspace_home.html`
  - `workspace/result_workspace.html`
  - `workspace/exception_workspace.html`
  - `workspace/run_record.html`

## 何时触发 execute

只有在用户明确表达以下同义意图后，才进入 `execute`：

- 开始执行
- 开始生图
- 确认执行
- 没问题，开始跑

如果用户只是在看预览、问问题、要求修改参数，都不进入 `execute`。

## execute 的职责

`execute` 负责：

- 按 batch 正式生图
- 写出 `manifest.json`
- 写出每批 `manifest.json`
- 生成 `contact_sheet.png`（若条件满足）
- 生成 `daoge_completion_report.md`

推荐入口：

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --sample-size 20 \
  --stage-size 200 \
  --batch-size 30 \
  --width 1440 \
  --height 2560 \
  --timeout-seconds 450 \
  --retry-count 1 \
  --concurrency 8 \
  --auto-pause true \
  --max-consecutive-failures 10 \
  --max-batch-failure-rate 0.3 \
  --skip-existing true
```

补充说明：

- 只有在 `local-batch-runner` 或 `local-edit / rerun` 语义下，才应进入本地 execute
- `host-native-image-tool` 路径的真正出图可以发生在宿主工具中，而不是这里

## DAOGE 的对话行为

- 对话完成且参数齐全后：自动进入 `prepare`
- `prepare` 完成后：把 `daoge_preflight_dashboard.md` 作为最终确认面板展示
- 用户确认后：再进入 `execute`
- `execute` 完成后：优先展示 `daoge_completion_report.md`

如果运行模式不是本地 runner 主线，则调整为：

- `host-native-image-tool`
  - 先做轻量 prompt 规划
  - 再根据宿主能力决定是否立刻出图
- `prompt-advisor`
  - 停在 prompt / plan 输出层
  - 不宣称已经执行
