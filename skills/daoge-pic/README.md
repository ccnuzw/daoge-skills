# DAOGE Pic

> 发布级别：`Beta`。将中文生图需求转换为可审阅的批量任务，并在本地工作台管理结果、问题、选择与导出。

DAOGE Pic 是一个面向批量生图工作流的 Codex Skill 和本地工作台。它把自然语言 brief 先整理为可检查的 `task_spec.json`，生成结构化提示词与批次计划；随后可以在本地调用图片 provider，也可以把提示词交给宿主原生工具、第三方工作台或自建脚本，最后将结果统一回填、筛选、补跑和导出。

它的重点不是替代所有图像生成工具，而是让一次包含多张图、多批次、参考图、分镜、失败重试和人工筛选的任务不再依赖零散提示词与人工记忆。

当前包版本：`4.0.0`。

## 目录

- [适用场景与边界](#适用场景与边界)
- [安装与运行要求](#安装与运行要求)
- [核心工作流](#核心工作流)
- [五分钟最小路径](#五分钟最小路径)
- [本地执行与 Provider](#本地执行与-provider)
- [宿主工具回填](#宿主工具回填)
- [本地工作台](#本地工作台)
- [任务规格与模板](#任务规格与模板)
- [失败恢复与补跑](#失败恢复与补跑)
- [输出目录与数据边界](#输出目录与数据边界)
- [命令索引](#命令索引)
- [验证、排障与安全](#验证排障与安全)
- [参考资料](#参考资料)

## 适用场景与边界

适合下列任务：

- 一次需要生成多张海报、商品图、人物主视觉、品牌包装、社媒素材、UI mockup、信息图、地图、分镜或图文视觉资料。
- 希望在正式调用 provider 前，先检查任务理解、提示词、尺寸、参考素材、批次数量与运行参数。
- 需要把图片结果统一整理为可筛选资产，并记录成功、失败、待复核和补跑原因。
- 图片由 Codex、第三方工作台或自建脚本生成，但希望采用统一提示词交接包和结果回填格式。
- 需要把失败项或部分分镜安全地重新执行，而不是从头重复整批任务。

不适合或不能替代的事情：

- 不会在用户确认前自动调用真实图片 provider；先 `prepare`，再由用户决定是否执行。
- 不保证任何 provider 一定能生成精确文字、像素级局部修改或完全一致的人物/产品身份；模型能力和 provider 约束仍然适用。
- 不会把缺失素材、无效结果文件、provider 失败伪装成成功结果。
- 不提供云端队列、账号托管、成本结算或跨机器资源调度；运行与密钥都由本地或宿主环境负责。

## 安装与运行要求

### 安装单个 Skill

只安装生图 Skill：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-pic
```

全局安装：

```bash
npx skills add ccnuzw/daoge-skills -a codex -s daoge-pic -g
```

也可以直接使用单个 Skill 路径：

```bash
npx skills add https://github.com/ccnuzw/daoge-skills/tree/main/skills/daoge-pic -a codex
```

安装后重启 Codex。这个 Skill 可以单独使用，不要求安装同仓库的 `daoge-docs`。

### 本地 CLI 前提

| 项目 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | 推荐使用包含 `node:sqlite` 的当前 LTS | 完整本地 Workbench 使用 SQLite 保存项目、资产、选择、问题与导出记录 |
| npm | 与所用 Node.js 匹配 | 包本身没有第三方运行依赖；用于运行测试和安装器 |
| 网络与 provider 凭证 | 仅真实执行需要 | `prepare`、模板查询和 dry-run 不会调用真实 provider |
| 本地磁盘 | 每个任务独立输出目录 | 原图、缩略图、快照和导出文件保存在该目录 |

若当前 Node.js 不支持 `node:sqlite`，`prepare`、`execute`、`review` 仍可生成 JSON 与兼容工作区页面；`open` 的数据库型工作台则会提示升级 Node.js。不要把密钥写入代码、`task_spec.json`、提示词、测试或 Git 历史。

执行命令前建议先进入 Skill 目录：

```bash
cd skills/daoge-pic
```

所有本地操作使用一个入口：

```bash
node scripts/daoge.js <command> [options]
```

普通用户只需要记住一个命令入口；根据当前阶段选择 `prepare`、`execute`、`ingest`、`review` 或 `open`，不要从内部 JSON 或数据库文件开始操作。

## 核心工作流

DAOGE 将一次批量生图任务拆成五个清晰阶段：

```text
中文 brief / 素材
  -> task_spec.json
  -> prepare：规范化、提示词、批次与预检
  -> 选择执行方式：本地 provider 或宿主工具
  -> 结果回填、复核、补跑与选择
  -> 导出报告或已选资产清单
```

| 阶段 | 主要命令 | 做什么 | 是否调用真实 provider |
| --- | --- | --- | --- |
| 准备 | `prepare` | 读取任务规格，生成提示词、预检、批次计划和工作区 | 否 |
| 本地执行 | `execute` | 先 dry-run，或按 provider 配置批量生成图片 | dry-run 否；真实执行是 |
| 宿主回填 | `ingest` | 导入其他工具或脚本的标准结果文件 | 否 |
| 复核恢复 | `review` / `rerun` | 刷新工作区、处理问题、仅补跑可重试项 | `review` 否；`rerun` 视模式而定 |
| 交付 | `export report` / `export pack` | 导出工作台报告或已选资产清单 | 否 |

`prepare` 是所有路径的共同起点。不要直接从一段自然语言 brief 进入真实执行，也不要手工伪造 `internal/` 中的结果状态。

## 五分钟最小路径

以下路径不会调用真实 provider，适合首次验证安装、任务规范和工作台。

```bash
node scripts/daoge.js prepare \
  --task-spec references/examples/task_spec.minimal.json \
  --output-dir out

node scripts/daoge.js open --output-dir out
```

`open` 会启动一个仅绑定本机的 HTTP 工作台，并在终端输出类似 `http://127.0.0.1:<port>/` 的地址。用浏览器打开该地址；按 `Ctrl+C` 停止服务。

这条路径产生：

```text
out/
├── daoge.db                           # 本地工作台状态数据库
├── workspace/                         # 兼容静态页面
├── assets/                            # 输入、结果、复核、选择与导出资产
├── snapshots/                         # 可审计 JSON 快照
├── debug/task_spec.normalized.json    # 规范化后的任务
├── debug/prompts.generated.json       # 最终提示词清单
├── debug/prompt_validation_report.json
├── internal/                           # 机器可读运行与问题状态
└── internal/issue_queue.json
```

先在工作台的“总览”和“任务”页面检查生成数量、提示词、素材、尺寸与提醒；确认无误后，再选择本地执行或宿主回填路径。

## 本地执行与 Provider

### 先进行 dry-run

dry-run 会检查执行路径、批次和素材，但不发起网络图片生成、不消耗 provider 额度：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute --output-dir out --dry-run true --batch-size 1
node scripts/daoge.js open --output-dir out
```

如果 dry-run 已暴露缺素材或任务不符，先修 `task_spec.json` 或素材路径，再重新 `prepare`。不要直接跳过问题进入真实执行。

### 真实 provider 小样本

从模板复制配置文件，仅填写本次要使用的 provider：

```bash
cp .env.example .env
```

以 OpenAI Images 为例：

```env
IMAGE_PROVIDER=openai-images
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-image-2
```

先用小批次验证：

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out
node scripts/daoge.js execute \
  --output-dir out --env-file .env \
  --batch-size 1 --concurrency 1
node scripts/daoge.js open --output-dir out
```

CLI 的 `--provider` 优先于 `.env` 中的 `IMAGE_PROVIDER`。目前 provider ID 为：

| Provider ID | 环境变量前缀 | 适用方式 |
| --- | --- | --- |
| `openai-images` | `OPENAI_*` | OpenAI Images 或兼容图片接口 |
| `gemini-image` | `GEMINI_IMAGE_*` | Gemini 原生图片接口 |
| `gemini-openai-compatible` | `GEMINI_OPENAI_*` | Gemini 的 OpenAI-compatible 图片接口 |
| `xai-grok-image` | `XAI_IMAGE_*` | xAI/Grok 图片接口 |

完整字段、鉴权方式、端点覆盖和 provider 限制见 [Provider 配置说明](./docs/provider_configuration_zh.md) 与 [`.env.example`](./.env.example)。真实测试会访问外部服务，只有明确需要时才运行；不要把 `.env` 提交到仓库。

### 批次、并发与运行参数

运行控制既可写在 `task_spec.json` 中，也可通过 CLI 覆盖：

```bash
node scripts/daoge.js execute \
  --output-dir out --env-file .env \
  --batch-size 10 --concurrency 3 \
  --timeout-seconds 450 --retry-count 1
```

- `concurrency` 会限制在 `1..12`。
- `batch-size` 决定每批处理多少提示词。
- `timeout-seconds` 和 `retry-count` 控制单项失败时的等待与重试。
- `width`、`height` 与 `output-format` 可由任务规格给出，也可在 CLI 覆盖。

大批量任务应先小样本验证，再逐步扩大批次或并发。不要因为准备阶段无阻塞，就假定 provider、配额、模型能力和素材结果一定可用。

## 宿主工具回填

如果图片由 Codex 原生图像工具、第三方工作台或自建脚本生成，DAOGE 仍可负责提示词准备、结果审阅与资产管理。

```bash
node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out

# 宿主读取 out/debug/prompts.generated.json 生成图片，并写出结果文件。
node scripts/daoge.js ingest \
  --results-file host_native_results.json \
  --output-dir out

node scripts/daoge.js open --output-dir out
```

`host_native_results.json` 的最小结构：

```json
[
  {
    "index": "001",
    "title": "主视觉 A",
    "requestMode": "prompt-only",
    "status": "success",
    "output": "outputs/a.png"
  },
  {
    "index": "002",
    "title": "主视觉 B",
    "requestMode": "prompt-only",
    "status": "failed",
    "error": "provider timeout"
  }
]
```

规则：

- `status` 只能是 `success`、`needs_review` 或 `failed`。
- `success` 与 `needs_review` 必须提供 `output`。
- 相对 `output` 路径相对于 `host_native_results.json` 所在目录解析。
- `failed` 建议提供 `error`，否则后续问题定位能力会下降。

如果宿主侧另有交接包，可以额外传入 `--prompt-pack-file host_native_prompt_pack.json`。导入会先校验结果契约，错误的 schema 不会写成成功资产。完整接入方式见 [宿主接入手册](./references/host_native_adapter_playbook_zh.md) 和 [结果契约](./references/host_native_results.schema.json)。

## 本地工作台

`node scripts/daoge.js open --output-dir out` 是推荐的人类操作入口。它启动本地 UI 与 API，读取 `out/daoge.db` 中的项目状态；如果是旧工作区且只有兼容 JSON，启动时会尝试导入并建立可审计快照。

工作台围绕开发者和内容人员的实际决策组织：

| 页面 | 主要用途 |
| --- | --- |
| 总览 | 当前任务、运行状态、资产数量、未处理问题和下一步 |
| 任务 | 查看批次、准备/执行阶段、成功失败与运行记录 |
| 资产 | 搜索、查看、比较、标记已选或拒绝的图片资产 |
| 问题 | 查看缺素材、provider 失败、待复核和可补跑项 |
| 提示词 | 查看、复制和筛选本轮提示词及其输入参数 |
| 对比 | 将 2、4 或 9 张候选图放在同一视图中进行评审 |
| 导出 | 导出工作台报告或已选资产清单 |

侧边栏中的“队列与活动”会持续显示运行、补跑和事件状态，它是跨页面状态面板，不是额外的工作台页面。工作台中的“补跑”只会为当前项目建立补跑任务，不会自动突破原任务的素材、provider 或确认边界。交付前应处理关键问题、确认已选资产，再导出：

```bash
node scripts/daoge.js export report --output-dir out
node scripts/daoge.js export pack --output-dir out
```

也可在工作台内点击相应导出操作。导出结果写入 `out/assets/exports/`：

- `workbench_report.json`：项目、运行、资产和问题报告。
- `selected_pack_manifest.json`：当前已选资产清单。

兼容静态页面仍会生成在 `out/workspace/`，用于离线查看、兼容旧流程和诊断；其中 `out/workspace/index.html` 是兼容静态页面入口。日常使用优先通过 `open` 进入数据库型本地工作台。

## 任务规格与模板

### 最小 `task_spec.json`

将需求先写成结构化任务。最小示例：

```json
{
  "content_brief": "高端时尚竖版海报，主体清楚，顶部和底部留标题安全区",
  "output_mode": "photoreal campaign poster",
  "style_requirements": ["full-body", "9:16 poster", "quiet luxury"],
  "total_count": 2,
  "batch_size": 1,
  "width": 1440,
  "height": 2560
}
```

实际任务通常还会补充：

- `source_files`：参考文案、素材清单或风格资料。
- `source_images`：任务级参考图。
- `variation_requirements`：如何避免近似重复、覆盖哪些场景差异。
- `text_policy`：排版安全区、文字、logo 与水印约束。
- `negative_requirements`：明确禁止出现的内容。
- `run_preset`：仅补足运行控制参数，不会替你编造内容意图。
- `storyboard_plan`：分镜任务的布局、内容、渲染与引用绑定。

`content_brief`、输出模式、数量、变化要求和文字策略应在正式执行前明确。预设只能提供批次、并发、尺寸等运行默认值，不能替代业务内容、风格意图或素材规则。

完整字段与分镜模式见 [任务规格契约](./references/task_spec.md)。

### 模板与示例库

查看推荐模板：

```bash
node scripts/daoge.js catalog --recommended true
```

按类别或关键词筛选：

```bash
node scripts/daoge.js catalog --category product-visuals
node scripts/daoge.js catalog --keyword 电商
```

模板目录覆盖活动海报、商品视觉、人物与头像、包装、信息图、技术图、UI mockup、地图、分镜、社媒矩阵等场景。示例库从 [examples README](./references/examples/README.md) 进入；复制接近的 `*.example.json` 为自己的 `task_spec.json`，再运行 `prepare`。示例用于上手，不应替代你的内容、品牌与合规约束。

## 失败恢复与补跑

先从工作台的“问题”页面查看失败原因和建议动作，或刷新兼容工作区：

```bash
node scripts/daoge.js review --output-dir out
node scripts/daoge.js open --output-dir out
```

provider 失败且问题被标记为可重试时，可只补跑失败项：

```bash
node scripts/daoge.js rerun \
  --prompts-file out/debug/prompts.generated.json \
  --resume-manifest out/internal/local_execution_raw.json \
  --failed-only true \
  --env-file .env \
  --output-dir out_rerun
```

| 问题 | 优先处理方式 |
| --- | --- |
| 缺素材、参考图或遮罩 | 修正源路径或 `task_spec.json`，重新 `prepare`；不要直接补跑 |
| 提示词或风格不符合预期 | 修改任务规格或参考资料，重新 `prepare` 并重新审阅 |
| provider 超时、网络或服务失败 | 检查 `.env`、provider、并发和超时；确认可补跑后用 `rerun` |
| 宿主结果 schema 无效 | 修正 `host_native_results.json`，再次执行 `ingest` |
| 结果需要人工判断 | 保持 `needs_review`，在工作台中筛选、选择或拒绝，不要伪装成成功 |
| 静态页面或状态未刷新 | 运行 `review`，再通过 `open` 重新查看工作台 |

常用排查入口：

- `out/debug/task_spec.normalized.json`：DAOGE 对任务的规范化理解。
- `out/debug/prompts.generated.json`：最终提示词与素材引用。
- `out/internal/execution_manifest.json`：成功、失败、跳过和结果状态。
- `out/internal/issue_queue.json`：原因、影响、建议动作和是否可补跑。
- `out/internal/local_execution_raw.json`：本地 provider 的补跑基线。

## 输出目录与数据边界

建议为每个业务任务使用独立输出目录，例如 `out/campaign-2026q3/`。不要把多个不相关活动写到同一目录，也不要把输出目录放进 Skill 源码目录。

| 路径 | 责任 | 是否建议直接编辑 |
| --- | --- | --- |
| `daoge.db` | 本地工作台的项目、资产、问题、选择、导出和事件状态 | 否，使用 CLI 或工作台操作 |
| `assets/` | 输入素材、参考图、生成结果、复核、选择、导出与归档 | 仅按业务需要管理源文件；不要伪造结果记录 |
| `snapshots/` | 运行、导入、导出的可审计快照 | 否，保留用于追踪 |
| `workspace/` | 兼容静态页面与离线诊断入口 | 否，由工具生成 |
| `internal/` | 兼容机器状态与页面视图模型 | 否，由工具生成 |
| `debug/` | 规范化任务、提示词、验证与批次诊断 | 用于阅读和排查；修改输入后应重新生成 |

图片二进制不写入 SQLite；数据库保存资产索引、状态和关系。工作台与 CLI 只服务和操作所选输出目录，避免将无关文件暴露为项目资产。

## 命令索引

| 命令 | 用途 | 常用示例 |
| --- | --- | --- |
| `prepare` | 规范化任务、生成提示词、批次计划和预检 | `node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out` |
| `execute` | dry-run 或通过 provider 执行批量生成 | `node scripts/daoge.js execute --output-dir out --dry-run true` |
| `ingest` | 导入宿主原生结果 | `node scripts/daoge.js ingest --results-file host_native_results.json --output-dir out` |
| `rerun` | 基于既有清单仅重试可补跑项 | `node scripts/daoge.js rerun --resume-manifest out/internal/local_execution_raw.json --output-dir out_rerun` |
| `review` | 从已有数据刷新兼容工作区和状态 | `node scripts/daoge.js review --output-dir out` |
| `init` | 初始化一个空的数据库型项目目录 | `node scripts/daoge.js init --output-dir out --name "活动视觉"` |
| `open` | 启动仅本机可访问的 Workbench UI 与 API | `node scripts/daoge.js open --output-dir out` |
| `projects` / `library` | 查看或登记最近使用的本地项目 | `node scripts/daoge.js projects` |
| `export report` | 导出工作台报告 | `node scripts/daoge.js export report --output-dir out` |
| `export pack` | 导出已选资产清单 | `node scripts/daoge.js export pack --output-dir out` |
| `catalog` | 查询模板、分类、关键词和推荐示例 | `node scripts/daoge.js catalog --recommended true` |

运行时不要用空参数调用 `open`、`init` 或 `review`，除非你确实希望把当前目录作为项目输出目录。建议始终显式传递 `--output-dir`，避免在源码目录或仓库根目录生成工作台数据。

## 验证、排障与安全

### 开发与发布验证

在 Skill 目录执行：

```bash
npm run test:unit
npm run test:contracts
npm run test:integration
npm run test:artifacts
npm run test:smoke
```

完整回归：

```bash
npm test
```

真实 provider 集成测试默认不会运行，必须显式提供有效 `.env` 和开关。它们会产生网络请求与潜在费用，因此只在有明确测试授权时执行：

```bash
RUN_PROVIDER_INTEGRATION=1 npm run test:integration

# xAI/Grok provider 使用独立开关
RUN_XAI_PROVIDER_INTEGRATION=1 npm run test:integration
```

### 安全边界

- 将 `.env` 保留在本地，密钥不进入 Git、截图、报告、prompt 或结果文件。
- `open` 默认只监听 `127.0.0.1`；不要为了临时共享而将它公开到不受控网络。
- 真实执行前优先小样本、低并发和人工确认，特别是大批量、付费 provider、参考图和品牌资产任务。
- 图片输出、日志和导出包可能含业务或个人资料，应按项目自身的数据保留规则管理。
- provider 的模型、接口与内容政策由对应服务决定；执行前确认你有权使用输入素材和账号。

## 参考资料

- [Skill 执行规范](./SKILL.md)：Codex 在接收生图任务时遵循的流程和确认规则。
- [任务规格契约](./references/task_spec.md)：`task_spec.json` 字段、预设和分镜模式。
- [示例库入口](./references/examples/README.md)：从最小任务到分镜、包装、商品、人物等示例。
- [模板映射](./references/template_map_zh.md)：按任务类型选择模板与示例。
- [Provider 配置说明](./docs/provider_configuration_zh.md)：图片 provider 的环境变量和接入边界。
- [宿主接入手册](./references/host_native_adapter_playbook_zh.md)：将其他图像工具接入提示词与结果回填链路。
- [宿主结果契约](./references/host_native_results.schema.json)：`host_native_results.json` 的机器可读要求。
- [发布契约](./docs/release_contract_zh.md)：版本、资产和兼容性约束。
- [DAOGE Skills 系列首页](../../README.md)：查看同仓库的其他独立 Skill。
