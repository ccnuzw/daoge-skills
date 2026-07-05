# DAOGE 完整使用说明

这是一份面向实际使用的中文版完整手册，基于当前 `interactive-image-batch` 技能的真实字段、真实预设、真实运行器整理，不是脱离实现的概念稿。

目标很明确：

- 让第一次接触 DAOGE 的人知道怎么用
- 让已经会用的人知道还有哪些参数和能力
- 让大批量跑图的人知道怎么配更稳
- 让用户真正理解 Prompt 变体系统，而不是只会“多生成几条 prompt”

## 0. 当前终版入口

现在使用 DAOGE，只从 workspace-first 主链开始。普通用户只记这一条主链：

1. `node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out`
2. `node scripts/daoge.js execute --output-dir out --env-file .env`
3. `workspace/index.html`
4. `workspace/prepare.html`
5. `workspace/results.html`
6. `workspace/issues.html`
7. `workspace/record.html`

`daoge_portal.html` 与 `result_hub.html` 不属于新 DAOGE 架构，相关渲染器已移除，不会由默认、深看或完整展开模式生成。

维护诊断只进入 `internal/` 和 `debug/`，普通用户不需要打开。

如果你只想知道“现在到哪一步、下一步做什么、结果在哪里”，优先看工作台，不要先翻 JSON、Markdown 或内部诊断说明。

---

## 1. DAOGE 是什么

`DAOGE` 是一个中文优先、对话驱动、面向批量生图的 Skill。

它不只是“帮你写一条 Prompt”，而是把一整条批量生图链路串起来：

1. 读取你的自然语言需求
2. 自动抽取关键参数
3. 读取你给的 `.md` / 风格库 / Prompt 库
4. 生成结构化任务配置
5. 生成 Prompt 规划与变体矩阵
6. 先做预检、预览、红黄绿判断
7. 再按批次正式执行
8. 失败自动重试、自动暂停、失败续跑
9. 产出结果汇总、筛图入口和补跑入口

一句话理解：

> DAOGE 是“对话式批量生图调度器 + Prompt 变体引擎 + 跑批执行器”。

---

## 2. 最小配置

DAOGE 的设计原则是：

- `.env` 里只放接口相关配置
- 其他绝大多数参数通过对话注入或预设补齐

最小 `.env`：

```env
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
```

说明：

- `OPENAI_BASE_URL`：你的生图接口地址
- `OPENAI_API_KEY`：接口密钥
- `OPENAI_MODEL`：可选，不填默认走 `gpt-image-2`

建议：

- `OPENAI_BASE_URL`、`OPENAI_API_KEY` 必填
- `OPENAI_MODEL` 建议也写上，避免后续 provider 默认模型变化

---

## 3. 如何唤醒 DAOGE

### 3.1 最稳方式

```text
使用 $interactive-image-batch
```

### 3.2 中文口语唤醒

以下说法都适合作为 DAOGE 的唤醒入口：

- `刀哥，我来了`
- `刀哥，干活`
- `刀哥，来跑批`
- `刀哥，生图`
- `刀哥，开始跑`
- `刀哥，起来干活`
- `刀哥，开工`
- `刀哥，出图`
- `刀哥，开始批量生图`
- `DAOGE，开工`

### 3.3 两种交互模式

#### 新手模式

适合第一次使用：

- 先展示欢迎页
- 再展示任务菜单
- 再分层引导你把关键参数说清楚

#### 老用户极速模式

适合已经知道自己要跑什么的人：

- DAOGE 先自动抽参
- 回显“我已识别到什么”
- 只追问缺口
- 缺项补齐后直接进入预检

---

## 4. DAOGE 适合处理什么任务

### 4.1 直接描述需求

适合你脑子里已经有画面，但没有成体系文档。

例如：

```text
刀哥，做一套 2K 竖版海报，黑色极简内衣，品牌 KV 风格，50 张，先预览再执行。
```

### 4.2 用 `.md` 风格库驱动

适合你已经有：

- 风格库
- 品牌视觉文档
- 玩法模板
- Prompt 库
- 竞品视觉拆解

例如：

```text
刀哥，我先给你一个 md，你按里面的风格做 300 张品牌海报，默认安全 2K 海报预设。
```

### 4.3 已有 `prompts.generated.json`

适合你已经有完整 Prompt 文件，只需要 DAOGE 帮你：

- 预检
- 分批
- 正式跑图
- 失败续跑

### 4.4 大批量运营任务

适合：

- 300 张
- 500 张
- 1000 张

这类任务重点不只是“能生成”，而是：

- 分阶段
- 稳定性
- 可追踪
- 可续跑
- 可筛选
- 可复盘

---

## 5. DAOGE 的标准工作流

一次完整任务通常会经过下面这些阶段：

1. 唤醒 DAOGE
2. 自然语言抽参
3. 只补齐关键缺项
4. 生成 `task_spec.json`
5. 归一化为 `task_spec.normalized.json`
6. 生成 `prompt_strategy.json`
7. 归一化为 `prompt_strategy.normalized.json`
8. 生成 `prompt_slots.json`
9. 生成 `prompt_draft_bundle.json`
10. 生成 `prompts.generated.json`
11. 执行预检与质量门禁
12. 生成 Prompt 预览与批次计划
13. 输出红灯 / 黄灯 / 绿灯结论
14. 用户确认后正式执行
15. 输出结果面板、筛图文件、失败续跑入口

其中真正最关键的三个阶段是：

- `task_spec`：这次到底要做什么
- `prompt_strategy`：这批图如何分布与变化
- `run_batch`：怎么稳定地把图跑出来

---

## 6. 用户最需要理解的参数

DAOGE 虽然支持很多参数，但你可以把它们理解为 6 组。

### 6.1 任务内容参数

| 字段 | 中文理解 | 作用 |
|---|---|---|
| `content_brief` | 生成内容描述 | 这次到底要生成什么 |
| `output_mode` | 输出模式 | 海报、电商图、插画、KV、故事板等 |
| `style_requirements` | 风格要求 | 直接文字说明风格 |
| `source_files` | 参考文件 | `.md`、风格库、玩法库等 |
| `variation_requirements` | 变化要求 | 避免撞图、控制变化方向 |
| `text_policy` | 文案留白策略 | 顶部留白、底部留白、上下都留、不留 |
| `negative_requirements` | 额外负向要求 | 例如不要廉价电商感、不要文字水印 |
| `identity_policy` | 人物身份策略 | 身份一致性、是否允许自由变化 |

这组参数决定“图长什么样”。

### 6.2 数量与尺寸参数

| 字段 | 中文理解 | 作用 |
|---|---|---|
| `total_count` | 总张数 | 本轮总共生成多少张 |
| `batch_size` | 每批张数 | 一次切成多少张去跑 |
| `width` | 宽 | 原生宽度 |
| `height` | 高 | 原生高度 |
| `aspect_ratio_label` | 比例标签 | 例如 `9:16`、`2:3` |
| `output_format` | 输出格式 | `png` / `webp` / `jpeg` |

推荐理解：

- `width + height` 决定是不是原生大图
- `batch_size` 决定失败时一批会波及多大范围
- `total_count` 决定这次任务规模

### 6.3 稳定性参数

| 字段 | 中文理解 | 作用 |
|---|---|---|
| `concurrency` | 并发数 | 同时发几个请求 |
| `retry_count` | 失败重试次数 | 单张失败后的自动补救次数 |
| `timeout_seconds` | 单张超时秒数 | 单张图最长等待多久 |
| `require_confirmation` | 执行前确认 | 是否必须先看预检再跑 |
| `preview_count` | 预览条数 | 预览阶段展示多少条 Prompt |

推荐理解：

- `concurrency` 决定速度和 provider 压力
- `retry_count` 决定临时波动能不能自动补救
- `timeout_seconds` 决定慢请求多久后回收

### 6.4 大批量运营参数

| 字段 | 中文理解 | 作用 |
|---|---|---|
| `sample_size` | 样本张数 | 先跑多少张小样 |
| `stop_after_sample` | 样本后暂停 | 小样跑完是否先停 |
| `stage_size` | 每阶段张数 | 大任务每一阶段推进多少张 |
| `auto_pause` | 自动暂停保护 | 是否启用风控暂停 |
| `max_consecutive_failures` | 最大连续失败数 | 连续失败多少次自动停 |
| `max_batch_failure_rate` | 单批最大失败率 | 一批失败率过高时自动停 |
| `skip_existing` | 跳过已完成项 | 续跑时只跑缺失项 |

这组参数决定“大批量任务稳不稳”。

### 6.5 输出与组织参数

| 字段 | 中文理解 | 作用 |
|---|---|---|
| `run_label` | 运行标签 | 区分不同波次或任务版本 |
| `notes` | 备注 | 记录特别说明 |
| `contact_sheet` | 联系表 | 是否生成联系表索引 |

### 6.6 Prompt 规划参数

这组参数不一定由用户逐一手填，但你要知道它们存在。

| 字段 | 中文理解 | 作用 |
|---|---|---|
| `style_families` | 风格族分布 | 把总量分配到不同风格族 |
| `grade_distribution` | 强度分布 | 控制 S/A/B 等强度比例 |
| `scene_pool` | 场景池 | 不同场景来源 |
| `wardrobe_pool` | 服装池 | 不同服装来源 |
| `composition_pool` | 构图池 | 不同构图来源 |
| `variation_rules` | 变化规则 | 避免重复、控制分布 |
| `negative_policy` | 统一负向策略 | 整批图统一避免的问题 |
| `variant_axes` | 变体轴 | 用矩阵方式控制变化 |
| `autofill_policy` | 自动补全策略 | 当某些字段未写满时自动补齐 |
| `template_variant` | 模板子类型 | 如联名主 KV、AB 测试、详情页组合等 |

---

## 7. 哪些参数是“必需说清楚”的

为了稳定开跑，下面这些信息最好明确：

### 7.1 内容必填

- 生成什么内容
- 用于什么场景
- 是什么输出模式

### 7.2 运行必填

- 总张数
- 尺寸或运行预设
- 是否先预览再执行

### 7.3 稳定性建议显式说明

- 并发数
- 超时秒数
- 失败重试次数

如果你不想自己配这些值，可以直接说：

```text
使用默认安全 2K 海报预设，其它按 DAOGE 推荐。
```

---

## 8. DAOGE 内置运行预设

如果你不想自己配参数，可以直接用预设。

### 8.1 `safe_2k_poster`

中文名：`安全 2K 海报`

适合：

- 第一次使用
- 9:16 原生 2K 海报
- 品牌海报 / KV / 大图方向

默认值：

```json
{
  "batch_size": 30,
  "width": 1440,
  "height": 2560,
  "aspect_ratio_label": "9:16",
  "concurrency": 6,
  "retry_count": 1,
  "timeout_seconds": 450,
  "output_format": "png",
  "preview_count": 12,
  "contact_sheet": true,
  "require_confirmation": true,
  "sample_size": 20,
  "stage_size": 200,
  "auto_pause": true,
  "max_consecutive_failures": 10,
  "max_batch_failure_rate": 0.3
}
```

### 8.2 `large_batch_stable`

中文名：`稳定大批量`

适合：

- 300 到 1000 张跑批
- 需要样本阶段、分阶段、自动暂停保护

核心特点：

- 分批稳定推进
- 支持跳过已完成项
- 更适合长时间运营跑批

关键值：

```json
{
  "batch_size": 30,
  "width": 1440,
  "height": 2560,
  "aspect_ratio_label": "9:16",
  "concurrency": 8,
  "retry_count": 1,
  "timeout_seconds": 450,
  "sample_size": 20,
  "stage_size": 200,
  "auto_pause": true,
  "max_consecutive_failures": 10,
  "max_batch_failure_rate": 0.3,
  "skip_existing": true
}
```

### 8.3 `fast_preview`

中文名：`快速预览`

适合：

- 先看风格方向
- 先试 Prompt 策略
- 不想一开始就跑原生 2K

关键值：

```json
{
  "batch_size": 10,
  "width": 1024,
  "height": 1536,
  "aspect_ratio_label": "2:3",
  "concurrency": 4,
  "retry_count": 0,
  "timeout_seconds": 240
}
```

### 8.4 `provider_stress_safe`

中文名：`Provider 保守模式`

适合：

- provider 限流明显
- 接口波动大
- 经常超时或失败

关键值：

```json
{
  "batch_size": 10,
  "width": 1440,
  "height": 2560,
  "aspect_ratio_label": "9:16",
  "concurrency": 3,
  "retry_count": 2,
  "timeout_seconds": 600,
  "skip_existing": true
}
```

---

## 9. Prompt 变体系统是怎么工作的

这一部分是 DAOGE 的核心增强能力。

很多工具所谓“批量生图”，本质只是把一段需求改写成很多相似 Prompt。这样的问题是：

- 图容易撞
- 节奏单一
- 镜头语言单一
- 同批次很快塌缩成近重复

DAOGE 的做法不是“乱随机”，而是“分层规划 + 变体矩阵”。

### 9.1 Prompt 生成链路

DAOGE 的 Prompt 不是一步生成的，而是经过下面这些阶段：

1. `task_spec.json`
2. `task_spec.normalized.json`
3. `prompt_strategy.json`
4. `prompt_strategy.normalized.json`
5. `prompt_slots.json`
6. `prompt_draft_bundle.json`
7. `prompts.generated.json`

理解这一点很重要：

- `task_spec` 负责定义任务
- `prompt_strategy` 负责定义分布和玩法
- `prompt_slots` 负责把每一张图的结构分配好
- `prompts.generated.json` 才是最后真正拿去生图的 Prompt 文件

### 9.2 Prompt Strategy 负责什么

`prompt_strategy.json` 的职责不是写最终 Prompt，而是回答：

- 这批图要分成哪些风格族
- 每种风格族各占多少张
- 哪些场景会被覆盖
- 哪些服装会被覆盖
- 哪些构图会被覆盖
- 哪些镜头语言、情绪、角色、材质强调要被矩阵化分配

### 9.3 Prompt Strategy 核心字段

#### `style_families`

风格族分布。

例子：

```json
[
  { "name": "极简高奢棚拍", "count": 120 },
  { "name": "都市橱窗夜景", "count": 90 },
  { "name": "酒店氛围主海报", "count": 90 }
]
```

它决定整批图不会只有一种气质。

#### `grade_distribution`

强度分布。

例子：

```json
[
  { "name": "S", "count": 60 },
  { "name": "A", "count": 180 },
  { "name": "B", "count": 60 }
]
```

作用：

- 不把所有图都做成同一个强度
- 让一批图里既有英雄图，也有可用的中段图

#### `scene_pool`

场景池。

例如：

```json
[
  "极简白色摄影棚",
  "高级酒店落地窗",
  "清晨柔光卧室",
  "设计师公寓走廊"
]
```

#### `wardrobe_pool`

服装池。

例如：

```json
[
  "黑色极简内衣套装",
  "象牙白棉质套装",
  "黑色套装搭配白衬衫外披"
]
```

#### `composition_pool`

构图池。

例如：

```json
[
  "全身 9:16 海报构图",
  "中远景站姿主视觉",
  "行走回头式海报构图"
]
```

#### `variation_rules`

变化规则。

例如：

```json
[
  "避免相同 scene+wardrobe+gesture 三元组重复",
  "S 级英雄图要分散到所有批次",
  "每批至少覆盖 4 种场景"
]
```

这类规则是大批量稳定性的关键。

### 9.4 什么是 `variant_axes`

`variant_axes` 可以理解为“变体轴”或“变化维度矩阵”。

它不是一句“多变化一点”，而是明确告诉系统：

- 这批图要沿着哪些维度系统变化
- 每个维度有哪些选项
- 每个选项按什么策略分发

常见字段：

- `name`
- `field`
- `strategy`
- `options`

常见可控维度：

- `camera_language`
- `lighting`
- `mood`
- `grid_role`
- `story_beat`
- `ad_test_hypothesis`
- `detail_page_role`
- `gesture`
- `exposure_signal`

### 9.5 `variant_axes` 示例

```json
[
  {
    "name": "camera-language",
    "field": "camera_language",
    "strategy": "cycle",
    "options": [
      {
        "name": "hero-front",
        "prompt_hint": "正面英雄式全身海报，垂直层级清晰"
      },
      {
        "name": "turn-back",
        "prompt_hint": "行走回头镜头语言，带轻微动势张力"
      },
      {
        "name": "low-angle",
        "prompt_hint": "轻微低机位时尚海报透视，拉长身形"
      }
    ]
  },
  {
    "name": "commercial-role",
    "field": "grid_role",
    "strategy": "cycle",
    "options": [
      "封面图",
      "材质细节图",
      "氛围图"
    ]
  },
  {
    "name": "material-emphasis",
    "field": "exposure_signal",
    "strategy": "weighted",
    "options": [
      {
        "name": "matte-fabric",
        "weight": 2,
        "prompt_hint": "哑光面料质感和缝线结构清晰可见"
      },
      {
        "name": "body-line",
        "weight": 1,
        "prompt_hint": "突出干净腰线和身体轮廓，但避免廉价夸张"
      }
    ]
  }
]
```

### 9.6 Prompt 变体系统能解决什么问题

它主要解决 5 类问题：

1. 大批量时不想只靠场景和服装做变化
2. 想系统控制镜头语言，而不是随机切镜头
3. 想做广告素材 A/B 测试
4. 想把一批图拆成不同商业角色
5. 想避免 300 张最后只像 30 张在重复

### 9.7 `autofill_policy` 是什么

`autofill_policy` 是自动补全策略。

用途：

- 当某些结构字段没有填满
- 或者策略里没有明确给出每个槽位的所有细节
- 系统可以用可追踪的方式自动补上

它不是随便瞎补，而是“带来源标记的自动补全”。

### 9.8 `prompts.generated.json` 长什么样

最终 Prompt 文件是一个 JSON 数组。

每项必须至少有：

- `generation_prompt` 或 `prompt`

推荐字段：

- `index`
- `slug`
- `title`
- `style_family`
- `style_variant`
- `purity_grade`
- `scene`
- `scene_anchor`
- `wardrobe`
- `exposure_signal`
- `gesture`
- `camera`
- `eye_language`
- `candidness`
- `lighting`
- `palette`
- `mood`
- `composition`
- `text_policy`
- `source_refs`
- `negative_prompt`
- `notes`

支持每条图单独覆盖：

```json
{
  "params": {
    "model": "gpt-image-2",
    "size": "1440x2560",
    "output_format": "png",
    "timeout_seconds": 450
  }
}
```

---

## 10. 预检与红黄绿门禁

DAOGE 在正式执行前会先跑预检。

预检输出的核心文件包括：

- `prompt_preview.md`
- `batch_plan.json`
- `prompt_validation_report.json`
- `daoge_run_summary.md`
- `daoge_mode_detection.json`
- `daoge_preflight_dashboard.md`

### 10.1 绿灯

表示：

- 结构正确
- 风险可控
- 可以直接执行

### 10.2 黄灯

表示：

- 可以跑
- 但建议先优化一些风险项

典型原因：

- Prompt 偏短
- 近重复较多
- 大批量任务没有样本阶段
- 每批张数偏大
- 并发偏高
- 没开自动暂停保护

### 10.3 红灯

表示：

- 先修问题，不建议直接跑

典型原因：

- Prompt 校验未通过
- 缺失必要字段
- 尺寸不合法
- 模板必填项缺失
- slug 冲突
- 明显重复 Prompt

---

## 11. 执行时的中文进度播报

执行阶段 DAOGE 会播报中文进度。

常见信息包括：

- `DAOGE 状态：正在执行`
- 当前总张数
- 当前阶段数
- 当前总批次数
- 当前执行到第几批
- 当前是样本阶段还是正式阶段
- 当前批次成功 / 失败 / 跳过数量
- 累计成功 / 失败 / 跳过数量
- 自动暂停原因
- 完成后的下一步建议

这对大批量任务很关键，因为你要知道：

- 当前是不是在正常推进
- 是哪一批有问题
- 是不是该暂停
- 是否应该触发补跑

---

## 12. 结果输出与文件说明

### 12.1 最重要的入口文件

#### `workspace/index.html`

本轮最应该先看的文件。

它会把这些内容收成工作台主入口：

- 本次任务总览
- 执行状态
- 下一步建议

#### `workspace/results.html`

结果筛看、可用成果、复核与补跑判断都从这里进入。

#### `workspace/record.html`

任务档案只负责回看本轮发生了什么，不作为第二套导航。

#### `daoge_completion_report.md`

本轮执行总结。

#### `selection_board.md`

筛图和补跑入口。

#### `operations_report.md`

运行复盘。

### 12.2 执行中常见文件

- `manifest.json`
- `batch_plan.json`
- `stage_plan.json`
- `job_state.json`
- `checkpoint.json`
- `success.json`
- `failed.json`
- `skipped.json`
- `needs_review.json`
- `rerun_candidates.json`
- `contact_sheet_index.md`
- `daoge_run_index.md`

### 12.3 图片通常存放在哪里

一般会按批次分目录，例如：

- `batch_001`
- `batch_002`
- `batch_003`

每张图片通常会有配套的 `.json` 元数据。

---

## 13. 失败续跑、同目录续跑、补跑怎么理解

### 13.1 失败续跑

适合：

- 某些图片失败了
- 不想重新跑整批

做法：

- 复用原来的 `prompts.generated.json`
- 指向原来的 `manifest.json`
- 只重跑失败项

命令示例：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/interactive-image-batch/scripts/daoge.js" execute \
  --prompts-file /path/to/prompts.generated.json \
  --resume-manifest /path/to/manifest.json \
  --failed-only true
```

### 13.2 同目录续跑

适合：

- 任务中断
- 同目录下已有部分图片完成
- 想跳过已有成果

命令示例：

```bash
node "${CODEX_HOME:-$HOME/.codex}/skills/interactive-image-batch/scripts/daoge.js" execute \
  --prompts-file /path/to/prompts.generated.json \
  --output-dir /path/to/output_dir \
  --skip-existing true
```

### 13.3 补跑候选

适合：

- 成功跑完了
- 但部分图虽然成功生成，质量上仍想替换

这时可参考：

- `needs_review.json`
- `rerun_candidates.json`
- `selection_board.md`

---

## 14. 常见使用方式

### 14.1 新手最稳说法

```text
使用 $interactive-image-batch
```

或者：

```text
刀哥，我不懂参数，你按最稳的方式带我走。
```

### 14.2 用 md 驱动

```text
刀哥，我先给你一个 md。
你按里面风格做 50 张品牌海报，使用默认安全 2K 海报预设，上下都留白，先预览再执行。
```

### 14.3 老用户极速模式

```text
刀哥，来跑批。
md 路径：/path/to/library.md
生成内容：联名海报
总张数：300
运行方式：稳定大批量预设
变化控制：镜头语言和场景都要拉开
文字排版：上下都留白
执行方式：先预览再执行
```

### 14.4 已有 Prompt 文件

```text
刀哥，我已经有 prompts.generated.json。
你帮我做预检、批次规划和正式跑图。
```

### 14.5 想直接交给 DAOGE 推荐参数

```text
刀哥，我先给你一个 md。
你按最稳的方式带我走，能补的参数你补，先预览，再执行。
```

---

## 15. 参数怎么选更稳

### 15.1 并发数 `concurrency`

建议：

- 小批量：`3 ~ 6`
- 大批量：`6 ~ 8`
- 一般不建议超过：`12`

原则：

- 先稳，再快
- provider 不稳时优先降并发

### 15.2 每批张数 `batch_size`

建议：

- 小批量：`10 ~ 20`
- 中批量：`20 ~ 30`
- 大批量：`30`

原则：

- 每批越大，失败影响面越大
- 不建议第一次就把一批开得很大

### 15.3 单张超时 `timeout_seconds`

建议：

- 正常 provider：`450`
- 响应偏慢：`600`

### 15.4 失败重试次数 `retry_count`

建议：

- 正常：`1`
- provider 波动明显：`2`

### 15.5 样本阶段 `sample_size`

建议：

- 小任务可以省略
- 300 张以上强烈建议保留
- 典型值：`10 ~ 20`

### 15.6 阶段推进 `stage_size`

建议：

- 中大任务：`100 ~ 200`
- 如果 provider 不稳，可以再小一些

---

## 16. 不同任务规模的推荐配置

### 16.1 10 到 50 张

推荐：

- 预设：`safe_2k_poster`
- 执行方式：先预览再执行

### 16.2 50 到 200 张

推荐：

- 预设：`safe_2k_poster`
- provider 不稳时：`provider_stress_safe`

### 16.3 300 到 1000 张

推荐：

- 预设：`large_batch_stable`
- 必开：`sample_size`
- 必开：`stage_size`
- 必开：`auto_pause`
- 推荐：`skip_existing`

### 16.4 provider 经常炸

推荐动作：

1. 降低 `concurrency`
2. 缩小 `batch_size`
3. 提高 `timeout_seconds`
4. 增加 `retry_count`
5. 直接切到 `provider_stress_safe`

---

## 17. Prompt 变体系统的最佳实践

如果你要跑 100、300、500、1000 张，最推荐的思路不是一句“多出点变化”，而是这样规划：

### 17.1 先定义风格族

例如：

- 极简高奢棚拍
- 酒店氛围主海报
- 城市夜景落地窗
- 面料细节强调图

### 17.2 再定义结构池

例如：

- 场景池
- 服装池
- 构图池

### 17.3 再定义变体轴

例如：

- 镜头语言
- 光线策略
- 情绪层级
- 商业角色

### 17.4 最后再定义变化规则

例如：

- 同一批不要出现过多近重复
- 英雄图分散到所有批次
- 每批至少覆盖 4 种场景
- 不同商业角色均匀分配

这就是 DAOGE 的核心优势：

> 不是“随机多样”，而是“结构化多样”。

---

## 18. 用户视角最常见的问答

### 18.1 `IMAGE_GEN_PROMPT_SOURCE` 是什么

它用于指定 Prompt 来源策略。

但在当前 DAOGE 的设计里，Prompt 来源主要由下面几类实际输入决定：

- 你的自然语言需求
- 你给的 `.md` 风格库
- 你给的已有 `prompts.generated.json`
- DAOGE 生成的 `prompt_strategy`

所以对普通用户来说，核心不在于手动改这个参数，而在于把“内容目标、风格目标、数量、尺寸、稳定性要求”说清楚。

### 18.2 如果每次 md 文件都不一样怎么办

可以。

DAOGE 本来就是为这种交互式情况设计的。

你不需要把每一个 md 的路径预先写进固定配置，只需要在对话里显式告诉 DAOGE：

- 这次用哪个 md
- 要生成什么
- 总量多少
- 用什么运行预设或自定义参数

### 18.3 所有参数都必须写在 `.env` 里吗

不需要。

推荐做法：

- `.env` 只保留接口级配置
- 业务级参数都在对话中注入

### 18.4 为什么 DAOGE 要先预览 Prompt 再跑

因为大批量任务最怕的不是“跑不动”，而是“跑歪了还跑了几百张”。

先预览的价值：

- 先看方向是否对
- 先看是否有撞图风险
- 先看风格族是否合理
- 先看文案留白和商业角色是否分布正确

### 18.5 300 张为什么不建议一把梭

因为大批量任务的主要风险不是单张失败，而是：

- 方向错了
- Prompt 太像
- provider 限流
- 某一批集体失败
- 整体质量分布失衡

所以更稳的做法是：

- 样本批
- 分阶段
- 自动暂停
- 失败续跑

---

## 19. 最推荐记住的三句话

### 19.1 新手

```text
刀哥，我不懂参数，你按最稳的方式带我走。先预览，再执行。
```

### 19.2 有 md 风格库

```text
刀哥，我先给你一个 md。你按里面风格做一批图，能补的参数你补，先预览，再执行。
```

### 19.3 老用户极速模式

```text
刀哥，来跑批。我给你 md 路径、总张数和运行预设，你只补缺口。
```

---

## 20. 最后一段总结

如果你只想记最关键的逻辑，可以记这套顺序：

1. 把内容目标说清楚
2. 把总量和尺寸说清楚
3. 让 DAOGE 先做 Prompt 预览
4. 看红黄绿预检
5. 再正式开跑
6. 跑完优先看 `workspace/index.html` 和 `workspace/results.html`
7. 大批量任务一定使用样本阶段、分阶段和自动暂停保护

DAOGE 最重要的价值不是“能生成图片”，而是：

- 能稳定地批量生成
- 能在对话里完成参数注入
- 能有组织地做 Prompt 变体
- 能在大任务里保持可控、可续跑、可筛选
