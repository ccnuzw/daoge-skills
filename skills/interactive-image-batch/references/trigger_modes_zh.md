# DAOGE 触发模式

本文件定义 `interactive-image-batch` 的标准触发方式。

## 总体原则

把流程拆成两个明确阶段：

1. `prepare`
2. `execute`

`prepare` 只负责整理、校验、预览、总览，不正式生图。

`execute` 只在用户确认后触发，负责真正生成图片，并产出完成报告。

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

## DAOGE 的对话行为

- 对话完成且参数齐全后：自动进入 `prepare`
- `prepare` 完成后：把 `daoge_preflight_dashboard.md` 作为最终确认面板展示
- 用户确认后：再进入 `execute`
- `execute` 完成后：优先展示 `daoge_completion_report.md`
