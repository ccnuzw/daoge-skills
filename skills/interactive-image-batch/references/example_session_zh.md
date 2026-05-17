# 中文示例会话

本文件用于示范 `interactive-image-batch` 的标准中文交互流程。

## 场景

用户希望基于一个 markdown 风格库批量生成图片，并且所有运行参数都通过对话注入。

## 分镜上传示例

### 1. 用户上传图片并提出任务

```text
我现在上传了 6 张参考图，要做 6 格分镜版。
完整提示词如下：……
```

### 2. Agent 先确认映射关系

```text
DAOGE 状态：需要补充信息
我是 DAOGE。
我先帮你把参考图和分镜对上。

当前我识别到：
- 参考图：6 张
- 分镜位：6 格

你可以直接回复：
- 按上传顺序对应 shot_1 到 shot_6
- 自定义映射：img1 -> shot_1，img2 -> shot_3
- 这些分镜不用图：shot_4, shot_6 = prompt-only
- 一张图给多个分镜：img1 -> shot_1, shot_2
```

### 3. 用户给出对应关系

```text
按上传顺序对应 shot_1 到 shot_6。
其中 shot_5 改为 prompt-only。
```

### 4. Agent 回显 reference bindings

```text
DAOGE 状态：映射已整理，等待确认
我是 DAOGE。
我先替你整理成一版 reference_bindings：

- shot_1 -> img1
- shot_2 -> img2
- shot_3 -> img3
- shot_4 -> img4
- shot_5 -> prompt-only
- shot_6 -> img6

确认后，我继续整理 storyboard_plan、prompt preview 和开跑前总览。
```

## 单格局部编辑示例

### 1. 用户提出改单格需求

```text
我只想改分镜3，其他分镜都不用动。
想让粽叶蒸汽更明显，盒身和构图保持不变。
```

### 2. Agent 进入局部编辑模式

```text
DAOGE 状态：准备局部编辑
我是 DAOGE。
我理解这次不是整板重做，而是只改单格。

当前请你确认：
- 目标分镜：shot_3
- 是否复用上一轮结果做底图
- 有没有新的遮罩图
- 只改什么，不要改什么
```

### 3. 用户确认

```text
只改 shot_3，复用上一轮结果做底图。
没有新的遮罩图。
只增强蒸汽层次和叶面高光，盒身和构图不要动。
```

### 4. Agent 回显局部编辑执行方式

```text
DAOGE 状态：局部编辑条件已识别
我是 DAOGE。
这次我会按单格局部编辑处理，不重跑整板。

- 目标分镜：shot_3
- 处理方式：复用上一轮结果做底图
- 遮罩图：无
- 只改什么：蒸汽层次、叶面高光
- 不要改什么：盒身、构图

确认后，我只重跑 shot_3，并在预览里标明这是局部编辑任务。
```

## 遮罩图上传示例

### 1. 用户补一张遮罩图

```text
我再补一张图，这张是遮罩图，只改分镜3右下角礼盒。
```

### 2. Agent 区分普通参考图和遮罩图

```text
DAOGE 状态：需要确认遮罩图绑定
我是 DAOGE。
我收到你补的局部编辑图了。

当前我还需要你确认三件事：
- 哪一张是遮罩图
- 这张遮罩图对应哪个分镜
- 这次只改哪个局部
```

### 3. 用户确认

```text
最后上传的那张就是遮罩图。
对应 shot_3。
只改右下角礼盒，其它不动。
```

### 4. Agent 回显绑定结果

```text
DAOGE 状态：遮罩图绑定已整理
我是 DAOGE。
我先替你整理成一版局部编辑绑定：

- shot_3
  - 参考图：上一轮结果 / 或指定参考图
  - 遮罩图：最后上传那张
  - 只改区域：右下角礼盒
  - 执行模式：masked-edit

确认后，我会把这张图写进 mask_asset_ids，并在预检里明确标记这是局部编辑槽位。
```

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
