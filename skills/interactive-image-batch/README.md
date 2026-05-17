# DAOGE Interactive Image Batch

`interactive-image-batch` 是一套面向 DAOGE / 刀哥工作流的批量生图 skill。

它不是一个“只会读 prompts.json 然后盲跑接口”的简易脚本，而是一套完整的批量生图工作流：

- 对话式参数收集
- `task_spec.json` 规范化
- `prompt_strategy.json` 分发策略
- `prompts.generated.json` 生成
- 批次执行与失败续跑
- 预检、预览、看板、结果汇总
- 文生图 / 图生图 / 分镜板 / 局部重绘 的统一编排

这个项目的核心目标不是追求“所有模式统一到一个最新 API”，而是：

**优先成功率，保留现代路径，并且内置 fallback。**

---

## 适合什么场景

这个 skill 适合下面几类任务：

- 批量文生图
- 带参考图的图生图
- 带 mask 的局部重绘
- 分镜板 / 口播分镜 / 故事板生成
- 从 Markdown 提示词库批量生成 prompts
- 多模板、多风格、多批次的可控出图

尤其适合：

- 已经有一套 `.env` 和 provider，需要稳定落地
- 需要一边保留“新路径”，一边保留“可回退旧路径”
- 不希望一次失败就整批废掉
- 需要把准备、执行、复跑、选图做成可追踪流程

---

## 核心能力

### 1. 结构化准备阶段

不是直接对用户输入做一次性 prompt 拼接，而是拆成多个中间产物：

- `task_spec.json`
- `prompt_strategy.json`
- `prompt_slots.json`
- `prompt_draft_bundle.json`
- `prompts.generated.json`

这让工作流更容易检查、复跑、调整和审计。

### 2. 面向分镜板与参考图的扩展

支持：

- `reference_images`
- `mask_image`
- `reference_bindings.json`
- 分镜 slot 绑定
- continuity / camera move / shot id 等结构字段

适合做：

- 口播分镜板
- 连续角色分镜
- 局部修改某一格
- 保留同一人物设定的多图任务

### 3. 失败续跑与结果归档

运行结束后会生成一整套可追踪产物，例如：

- `manifest.json`
- `job_state.json`
- `checkpoint.json`
- `stage_plan.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `rerun_candidates.json`
- `selection_board.md`
- `operations_report.md`
- `daoge_result_hub.md`

这意味着：

- 跑挂了可以只补失败项
- 中断后可以跳过已完成项
- 批量任务可以分阶段推进
- 后续选图和复跑都有依据

### 4. 可复用模板模式

除了通用工作流，这个 skill 也支持模板化复用。

当前已经内置并适合长期复用的方向包括：

- `campaign-poster`
- `cinematic-storyboard`
- `oral-storyboard-board`

其中 `oral-storyboard-board` 适合：

- 跨领域口播分镜板
- 导演式横版整板分镜
- 虚拟主理人 / 主持人口播提案板
- 左信息区 + 右侧分镜网格 + 底部KV 的整板任务

对应示例包见：

- `references/examples/finance-storyboard/`

---

## 工作流概览

标准流程如下：

1. 读取用户需求或提示词库
2. 生成 `task_spec.json`
3. 验证并标准化 task spec
4. 生成 `prompt_strategy.json`
5. 生成 `prompt_slots.json`
6. 生成 `prompt_draft_bundle.json`
7. 生成最终 `prompts.generated.json`
8. 执行预检与预览
9. 分批执行 `run_batch.js`
10. 输出结果面板与复跑产物

如果是分镜板模式，还会附加：

- `content_manifest.json`
- `layout_manifest.json`
- `reference_bindings.json`
- `render_config.json`

---

## 路由策略

这个项目当前采用的是“成功率优先”的路由策略。

### `prompt-only`

- 默认：`POST /v1/images/generations`
- 可选现代路径：`POST /v1/responses` + `image_generation`
- 如果显式开启 `--generate-path /v1/responses`
  - 先走 `Responses API`
  - 失败自动 fallback 到 `Images API`

### `reference-assisted`

适用于：

- 有 `reference_images`
- 没有 `mask_image`

路由策略：

- 默认：`POST /v1/images/edits`
- 可选现代路径：`POST /v1/responses` + `image_generation` + `input_image`
- 如果显式开启 `--edit-path /v1/responses`
  - 先走 `Responses API`
  - 失败自动 fallback 到 `Images API edits`
- 如果槽位被判定为 `reference-assisted`，但 `reference_images` 缺失或文件不存在，预检应直接阻断，而不是放到执行阶段再报错

### `masked-edit`

适用于：

- `reference_images + mask_image`
- 局部重绘 / inpainting

路由策略：

- 固定：`POST /v1/images/edits`

当前 runner **不会**把 `masked-edit` 强行切到 `Responses`，因为这条链路在不同 provider 上兼容性差，风险更高。
- 如果槽位被判定为 `masked-edit`，但 `reference_images` 或 `mask_image` 缺失，预检应直接阻断，因为执行阶段一定失败

### 为什么这么设计

原因很简单：

- `Images API` 仍然是正式路径，不是废弃路径
- `Responses API` 更现代，但 provider 差异更大
- 真正可用的策略不该是“统一”，而该是“默认稳 + 可升级 + 可回退”

---

## 模型位说明

这里有两个模型位，职责不同。

### `OPENAI_MODEL`

真正负责出图的模型。

常见值：

- `gpt-image-2`

### `OPENAI_RESPONSES_MODEL`

只在 `Responses` 路径下使用。

它不是出图模型本体，而是顶层 Responses 调度模型。

常见值：

- `gpt-5.4`
- `gpt-5.5`

当前脚本优先级如下：

1. `--responses-model`
2. `OPENAI_RESPONSES_MODEL`
3. 默认回落到 `gpt-5.4`

也就是说，它不是写死的，可以换，但前提是你的 provider 支持该模型走 `/v1/responses`。

---

## 安装到 Codex

### 用 `npx skills` 安装

项目级安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch
```

全局安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s interactive-image-batch -g
```

也可以直接从 skill 路径安装：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/interactive-image-batch -a codex
```

安装完成后建议重启 Codex。

### 手动安装

把 `skills/interactive-image-batch` 复制到以下任一目录：

- 项目级：`.agents/skills/interactive-image-batch/`
- 全局：`~/.codex/skills/interactive-image-batch/`

如果你是手动覆盖更新，也建议重启 Codex，让新版本 skill 被重新加载。

---

## 快速开始

### 1. 准备环境

建议准备一个 `.env`：

```env
OPENAI_BASE_URL=https://your-provider.example.com
OPENAI_API_KEY=your_api_key
OPENAI_MODEL=gpt-image-2
OPENAI_RESPONSES_MODEL=gpt-5.4
```

### 2. 准备 prompts 文件

最小可运行格式：

```json
[
  {
    "index": 1,
    "slug": "hero-cover",
    "title": "Hero Cover",
    "generation_prompt": "生成一张16:9科技财经风横版主视觉，蓝金质感，单人物，画面干净高级。"
  }
]
```

### 3. 执行默认文生图

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output \
  --env-file /abs/path/.env
```

### 4. 执行无 mask 参考图模式

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output \
  --env-file /abs/path/.env \
  --edit-path /v1/responses \
  --responses-model gpt-5.4
```

### 5. 执行 prompt-only 的 Responses 模式

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output \
  --env-file /abs/path/.env \
  --generate-path /v1/responses \
  --responses-model gpt-5.4
```

---

## Prompt 文件格式

最关键字段只有一个：

- `generation_prompt` 或 `prompt`

推荐字段：

- `index`
- `slug`
- `title`
- `style_family`
- `scene`
- `wardrobe`
- `lighting`
- `mood`
- `composition`
- `text_policy`
- `negative_prompt`
- `source_refs`
- `notes`

支持参考图字段：

- `reference_images`
- `mask_image`
- `reference_mode`

示例：

```json
[
  {
    "index": 1,
    "slug": "storyboard-board",
    "title": "Semiconductor Storyboard",
    "style_family": "财经口播分镜板",
    "composition": "16:9 横版分镜板",
    "reference_images": [
      "/abs/path/ref1.png",
      "/abs/path/ref2.png"
    ],
    "generation_prompt": "生成一张16:9横版真实提案级财经口播分镜板，统一同一位二次元/CG主播人物。"
  }
]
```

---

## 推荐运行策略

如果你想要最稳的默认配置，我建议这样理解：

### 默认最稳

- 文生图：`Images API`
- 无 mask 图生图：已验证 provider 支持时，再切 `Responses`
- 有 mask 图生图：保持 `Images API edits`

### 何时启用 Responses

适合以下情况：

- provider 明确更偏好 `/v1/responses`
- 你已经验证过该 provider 的参考图链路能通
- 你想把文生图 / 图生图尽量向统一链路靠拢

### 何时不要强切 Responses

- 你不确定 provider 是否完整兼容
- 你在跑大批量正式任务
- 你在做 `masked-edit`

---

## 常用脚本

### 预检与准备

- `scripts/daoge_prepare_run.js`
- `scripts/validate_task_spec.js`
- `scripts/validate_prompt_strategy.js`
- `scripts/validate_prompt_bundle.js`
- `scripts/validate_storyboard_bundle.js`

### 产物生成

- `scripts/scaffold_prompt_bundle.js`
- `scripts/materialize_prompt_drafts.js`
- `scripts/render_prompt_preview.js`
- `scripts/render_preflight_dashboard.js`

### 执行与汇总

- `scripts/run_batch.js`
- `scripts/render_completion_report.js`
- `scripts/render_result_hub.js`

---

## 输出产物

每次执行通常会产出：

- `prompts.generated.json`
- `batch_plan.json`
- `stage_plan.json`
- `manifest.json`
- `job_state.json`
- `checkpoint.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `rerun_candidates.json`
- `daoge_result_hub.md`
- `operations_report.md`

如果开启联系图，还会有：

- `contact_sheet.png`
- `contact_sheet_index.md`

---

## 失败续跑

这个项目是按“可恢复”来设计的。

### 只补失败项

```bash
node scripts/run_batch.js \
  --resume-manifest /abs/path/manifest.json \
  --failed-only true \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/rerun_output \
  --env-file /abs/path/.env
```

### 中断后跳过已完成项

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/original_output \
  --env-file /abs/path/.env \
  --skip-existing true
```

### 只改一个分镜 slot

适合：

- 局部重跑
- 只改一格
- 复用上次输出当参考图

相关参数：

- `--resume-manifest`
- `--select-slot-ids`
- `--select-indexes`
- `--reuse-output-as-reference true`
- 对 storyboard / local-edit，优先按 `slot_id` 复用上一轮成功输出，避免因为 prompt 顺序变化误绑到底图

---

## 分镜板模式

如果你在做分镜板，推荐使用以下文件来分离职责：

- `content_manifest.json`
  - 讲内容结构和叙事
- `layout_manifest.json`
  - 讲版式和区域
- `reference_bindings.json`
  - 讲参考图绑定关系
- `render_config.json`
  - 讲尺寸、风格和渲染策略

这样做的好处是：

- 不会把“文案结构、镜头结构、视觉结构、运行参数”揉成一条巨型 prompt
- 更适合真实提案板和连续分镜任务

---

## 目录结构

```text
interactive-image-batch/
├── README.md
├── SKILL.md
├── agents/
├── references/
└── scripts/
```

- `SKILL.md`
  - skill 行为规范和对话工作流
- `references/`
  - 模板、说明、示例、运行预设
- `scripts/`
  - 准备、校验、执行、汇总脚本

---

## 适配建议

不同 provider 对图像接口的兼容度差异很大。

建议按下面顺序接入：

1. 先验证默认 `Images API`
2. 再验证 `reference-assisted` 的 `Responses`
3. 再决定是否启用 `prompt-only` 的 `Responses`
4. 不要先碰 `masked-edit + Responses`

换句话说：

**先跑稳，再升级。**

---

## 当前项目取舍

这个项目刻意选择了工程化取舍，而不是追“理论上最统一”：

- 保留 `Images API`
- 增加 `Responses API`
- 用显式开关控制
- 在关键路径上保留 fallback
- 对 `masked-edit` 保守处理

这让它更适合真实生产，而不是只适合 demo。

---

## License / Usage

请按你自己的仓库策略补充 license、组织说明或内部接入规范。
