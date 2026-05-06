# 中文示例会话

本文件用于示范 `interactive-image-batch` 的标准中文交互流程。

## 场景

用户希望基于一个 markdown 风格库批量生成图片，并且所有运行参数都通过对话注入。

## 示例流程

### 1. 用户提出任务

```text
我想基于 @风格库.md 批量生成 300 张写实海报图，主题是联名款内衣广告。
```

### 2. Agent 做中文 intake

```text
DAOGE 已就绪。
我是 DAOGE。
现在先确认这次任务的关键参数。
参数明确后，我会生成 prompts 并给你预览。

- 内容主题：联名款内衣广告海报
- 输出模式：写实品牌 KV 海报
- 参考来源：@风格库.md

还需要你明确这些运行参数：

- 总张数：
- 每批张数：
- 分辨率（宽 x 高）：
- 图片比例：
- 并发数：
- 超时秒数：
- 重试次数：
- 变化控制要求：
- 文字排版要求：
- 是否先预览再执行：
```

### 3. 用户补齐参数

```text
总张数 300，每批 30，1440x2560，9:16，并发 10，超时 450 秒，重试 1 次。
变化上要避免重复，每批都要有不同场景、不同款式、不同姿态。
文字排版要预留顶部和底部空间。默认先预览 prompts，再执行。
```

### 4. Agent 做参数归一化确认

```text
我是 DAOGE。
我先把这次任务整理成一版执行参数，你确认一下：

- 内容主题：联名款内衣广告海报
- 输出模式：写实品牌 KV 海报
- 参考来源：@风格库.md
- 总张数：300
- 每批张数：30
- 尺寸：1440x2560
- 比例：9:16
- 并发：10
- 超时：450 秒
- 重试：1 次
- 变化要求：避免近重复；每批分散场景、款式和姿态
- 文字排版：顶部和底部预留干净空间
- 执行方式：先预览 prompts，再确认是否正式生图

你确认后，我会继续生成 task spec、prompt strategy 和 prompt 预览。
```

### 5. Agent 生成任务文件并预览

Agent 应依次生成：

- `task_spec.json`
- `task_spec.normalized.json`
- `prompt_strategy.json`
- `prompt_strategy.normalized.json`
- `prompt_slots.json`
- `prompt_draft_bundle.json`
- `prompts.generated.json`
- `prompt_validation_report.json`
- `prompt_preview.md`
- `batch_plan.json`
- `daoge_run_summary.md`
- `daoge_preflight_dashboard.md`

### 6. Agent 中文提示预览结果

```text
我是 DAOGE。
预览已经生成，当前文件如下：

- prompt_preview.md
- batch_plan.json
- prompt_validation_report.json
- daoge_run_summary.md
- daoge_preflight_dashboard.md

这次计划共生成 300 张，分 10 批执行，每批 30 张，并发 10。

当前只是预览，还没有正式生图。你确认 prompts 和批次规划后，我再开始执行。
```

## 关键约束

- 用户没有明确 `batch_size`、`width`、`height`、`concurrency`、`retry_count`、`timeout_seconds` 时，不进入执行阶段。
- `.env` 只读取 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`，其余运行参数来自对话。
- 默认先预览 prompts，再等用户确认。
- 面向用户的说明默认中文。
- `DAOGE` 是整个对话过程中的智能体身份，不只是欢迎页标题。

## 执行完成后

正式生图结束后，Agent 还应生成：

- `manifest.json`
- `README.md`
- `daoge_completion_report.md`
