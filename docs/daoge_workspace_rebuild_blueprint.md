# DAOGE 可视化工作台重构正式蓝图

> 归档说明：本文记录旧工作台重构阶段的设计草案，不代表当前发布入口。当前入口以 `skills/interactive-image-batch/README.md` 为准：`node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out`，然后打开 `out/workspace/index.html`。

## 0. 终版执行结论

当前重构的终极目标已经明确为：

**DAOGE 是一套对话驱动、状态统一、工作台同步的个人图像任务系统，而不是生成一堆 HTML / JSON / Markdown 的脚本集合。**

终版用户主链只有一条：

1. `node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out`
2. `node scripts/daoge.js execute --output-dir out --env-file .env`
3. `workspace/index.html`
4. `workspace/prepare.html`
5. `workspace/results.html`
6. `workspace/issues.html`
7. `workspace/record.html`

终版状态协议：

- `workspace_live_state.json` 承担任务内实时状态。
- `workspace_state.json` 承担统一工作台状态模型。
- `runtime_state.json` 承担运行阶段进度。
- `task_center_live_state.json` 承担跨任务总控实时状态。
- `workbench_state.json` 只作内部派生工作台快照，不作为主状态源。

终版生成策略：

- 主链页默认生成，并优先镜像到 `workspace/`。
- 准备深看页只在 `prepare-details` / `all` 生成。
- 结果深看页只在 `result-details` / `all` 生成。
- `daoge_portal.html` 与 `result_hub.html` 不属于新 DAOGE 架构，渲染器已移除，历史残留会被清理。
- README、run record、Markdown / JSON 说明不得把普通用户重新引回复杂产物堆。

后文保留重构过程和历史拆解；若历史章节与本终版结论冲突，以本节为准。

## 1. 这次重构真正要解决什么

这次重构不再只是“把几张 HTML 做得更统一”，而是要把 `interactive-image-batch` 从一套偏工程化的产物流水线，升级成一套真正面向个人用户的可视化工作台系统。

目标不是让用户理解：

- `manifest`
- `prompt bundle`
- `review board`
- `selection board`
- `operations report`

目标是让用户只需要理解三件事：

1. 现在进行到哪一步
2. 下一步该做什么
3. 当前沉淀了哪些可用成果

因此，这次大改的本质不是单纯前端改版，而是：

- 入口层统一
- 后端资产统一
- 模式分流统一
- 状态模型统一
- 工作台 UI 统一
- 对话与工作台协同统一

这六件事一起推进。

## 2. 北极星目标

重构后的 DAOGE 应该成为一套“对话驱动 + 可视化同步”的个人工作台。

用户体验目标：

1. 用户在 Codex 对话框中持续推进任务。
2. 用户同时可以在工作台中看到当前阶段、进展、异常、结果和资产沉淀。
3. 用户无需理解内部脚本产物和程序字段。
4. 用户始终感觉自己在使用同一个系统，而不是在多个 HTML 和文件之间来回跳转。
5. 正常用户只走最短主链，异常处理和专业信息按需出现。

一句话定义：

DAOGE 不是“生成一堆文件的 skill”，而是“带有统一工作台外壳的对话式图像任务系统”。

## 3. 当前架构的真实问题

现有体系已经有很强基础，但核心问题很明确：

### 3.1 当前更像“阶段产物集合”，还不是“统一工作台”

当前已经有：

- `workspace_home.html`
- `prepare_workspace.html`
- `result_workspace.html`
- `exception_workspace.html`
- `task_center.html`
- `run_record.html`

这说明页面壳已经开始成型。

但页面背后依然是“多个中间文件 + 多个说明文件 + 多个统计文件 + 多个 HTML 页面并列生成”的模式，所以整体仍然偏工程产物集合，而不是统一状态驱动系统。

### 3.2 用户可见层和系统资产层没有彻底分层

当前一个 run 目录下常见文件包括：

- `manifest.json`
- `job_state.json`
- `checkpoint.json`
- `batch_plan.json`
- `stage_plan.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `rerun_candidates.json`
- `operations_report.json`
- `operations_report.md`
- `selection_board.md`
- `run_record.md`
- `run_record.html`
- `workspace_home.html`
- `result_workspace.html`
- `exception_workspace.html`
- `storyboard_board.html`

这些文件里混合了：

- 系统运行状态
- 中间调试产物
- 用户阅读摘要
- 用户浏览页面

用户看到的不是一套“工作台体系”，而是一堆产物并列存在。

### 3.3 同一件事常常被多个文件重复表达

例如“这轮任务发生了什么”，现在可能同时存在于：

- `README.md`
- `run_record.md`
- `operations_report.md`
- `selection_board.md`
- 某些 HTML 页面的摘要区

这会造成：

- 信息重复
- 叙事重复
- 页面角色重叠
- 用户心智不稳定

### 3.4 工作台页面还不是状态驱动，而是文件拼接驱动

现在的页面渲染逻辑大多是“分别读取多个文件，再拼成页面”。  
这种方式在早期有效，但一旦要做“统一工作台”，就会遇到几个问题：

1. 每个页面都在自己判断上下文
2. 多个页面会重复读取和翻译同一批信息
3. 很难做到真正统一的阶段语义
4. 页面之间容易出现轻微不一致

## 4. 重构核心判断

在重新深度扫描当前开发版之后，需要先补一个更高一层的判断：

### 4.1 这个 skill 已经不是单一批量脚本，而是一套产品化雏形

当前系统已经同时具备：

- 中文引导入口
- starter / intent 任务入口
- 中文模板展示板
- template registry 与 template docs
- runtime mode 探测
- prepare / execute 双阶段
- host-native 轻量路径
- storyboard / reference binding 专用工作流
- run 内工作台体系
- 结果回灌与审阅链
- 较强 smoke 测试护栏

这意味着未来蓝图不能只围绕 `run` 目录和结果页展开。

### 4.2 DAOGE 实际上有两套前台

第一套前台是入口前台：

- 用户先判断任务类型
- 用户先选择 starter intent / example
- 用户先决定走本地 runner、宿主原生，还是只做规划

第二套前台才是 run 工作台：

- 当前阶段
- 当前进展
- 当前异常
- 当前结果
- 当前资产沉淀

如果只重构第二套，而不把第一套纳入统一体验，系统依然会割裂。

### 4.3 template / example / starter 不是一回事

当前系统里：

- `examples` 更偏上手入口与示例
- `template_registry_zh.json` 与 `references/templates/*` 才是模板事实来源

所以未来架构必须明确区分：

- 用户入口层
- 模板治理层

不能让 examples catalog 承担全部事实来源，也不能让模板内部术语直接压到普通用户前台。

### 4.4 runtime mode 是一等公民

当前系统明确支持：

- `local-batch-runner`
- `host-native-image-tool`
- `prompt-advisor`
- `local-edit / rerun`

因此“统一工作台”不能默认假设所有任务都走完整本地 `prepare -> execute -> result` 路径。

真正统一的应该是：

- 统一任务状态表达
- 按模式切换不同主链

### 4.5 storyboard 是专用结构化子系统

storyboard 的核心不是“多几张图”，而是：

- content slot
- layout binding
- render config
- reference bindings
- continuity / camera_move / mask / slot role

所以未来状态层必须允许保留 storyboard 专用字段，而不是简单压成普通批量图任务。

如果要达到最终目标，现有 skill 的整体思路和架构必须一起调整。

不是只改 HTML，也不是只删几个 JSON。

必须从“产物流水线”升级成“多层统一体系”：

1. 统一入口层
2. 统一模式分流层
3. 统一资产层
4. 统一状态层
5. 统一工作台层

其中最关键的是中间那层：

**统一状态层**

它是后端资产和前端工作台真正汇合的地方。

## 5. 重构后的总架构

重构后的 DAOGE 建议采用六层结构：

### 5.1 对话层

职责：

- 和用户交互
- 收集任务意图
- 补齐缺失参数
- 做关键确认
- 对当前状态做人话解释

特点：

- 以中文为主
- 不要求用户理解文件结构
- 只暴露决策所需信息

### 5.2 入口与任务映射层

职责：

- 把“我想做什么”翻译成系统入口
- 提供 starter intent、任务地图和中文模板展示板
- 成为普通用户第一次接触 DAOGE 的入口前台

代表物：

- `README.md`
- `references/template_map_zh.md`
- `references/examples/examples_catalog.html`
- `scripts/daoge.js prepare`

这层不是附属说明，而是系统前场的一部分。

### 5.3 模式分流层

职责：

- 判断当前走哪条主线
- 区分本地 runner、宿主原生、顾问路径、局部编辑 / 复跑
- 决定后面需要生成哪些工作台和资产

代表物：

- `detect_runtime_mode.js`
- `detect_daoge_mode.js`

### 5.4 统一状态层

职责：

- 汇总任务当前阶段、进度、风险、结果、资产、推荐动作
- 为所有工作台页面提供统一状态来源
- 成为系统唯一的人机共享状态源

这是本次大改最关键的一层。

### 5.5 工作台层

职责：

- 把统一状态层翻译成用户可理解的页面模块
- 统一视觉、密度、导航、文案
- 让用户通过少量页面看懂当前全局

### 5.6 内部运行层

职责：

- 保留底层执行、恢复、补跑、调试能力
- 支持本地 runner、host-native、prepare-only、rerun 等模式

这一层继续服务系统和维护者，但不再直接主导用户可见体验。

### 5.7 模板治理层

职责：

- 管理模板事实来源
- 管理 template registry 与 template docs
- 保持 example、starter、template、variant 的关系清晰

代表物：

- `references/template_registry_zh.json`
- `references/templates/*`
- `references/template_authoring_zh.md`

## 6. 资产分层方案

未来的资产不应再平铺并列，而应分为四类。

## 7. 主链页面正式定版

在继续往后推进之前，必须先把“哪些页面属于主链、哪些页面只是辅助页”正式定下来。

否则页面再怎么修，系统仍然会反复长回旧的多入口、多看板、多链路形态。

### 7.1 一级主链页

以下页面是未来 DAOGE 面向普通用户的正式主链：

1. `中文模板展示板`
2. `任务总控`
3. `工作台首页`
4. `准备工作台`
5. `结果工作台`
6. `异常工作台`
7. `任务档案`

说明：

- 这七个页面共同构成“个人工作流 UI”的主外壳
- 普通用户默认只走这套主链
- 所有主链页必须统一语言、统一视觉、统一导航规则

### 7.2 条件页 / 辅助页

以下页面不再属于普通用户默认主链，只在特定情境下按需出现：

1. `Storyboard 装板`
2. `审阅看板`
3. `完成摘要细页`
4. `预检总览`
5. `提示词预览页`
6. `素材看板`
7. `运行概览`
8. `补跑页`

说明：

- 这些页面继续保留系统价值
- 但默认不再和主链并列抢入口
- 它们应被工作台主链“按需引用”，而不是让用户自己理解和选择

### 7.3 已删除历史入口

以下页面不属于新工作台体系，也不再拥有渲染链路：

1. `daoge_portal.html`
2. `result_hub.html`

说明：

- 它们不进入普通用户导航主链
- 它们不在默认、深看或完整展开模式生成
- 如输出目录里存在历史同名文件，清理规则会删除

### 7.4 系统规则

从这一版开始，页面身份不再靠“约定俗成”，而要进入系统注册表与统一状态层：

- 页面注册表负责定义：
  - 页面 id
  - 页面标签
  - 页面所属分组
  - 是否默认生成
  - 对应阶段与摘要
- 统一状态层负责对外暴露：
  - `primary` 主链页
  - `secondary` 辅助页
  - `defaultGenerated` 默认生成页

这样后续无论是：

- 顶部导航
- 进度轨道
- 工作台入口卡片
- 对话框中的“下一步推荐”

都可以共用同一套页面身份规则，而不会再次散落到各个脚本中。

### 7.5 生成策略原则

页面分层不仅影响导航，也必须影响生成策略。

正式原则如下：

1. `primary` 主链页默认生成
2. `secondary` 辅助页默认不作为普通用户主链产物
3. 已删除历史入口不再进入任何生成集合

也就是说，未来系统要逐步从“生成很多页，再做收敛”变成：

- 先只生成主链页
- 条件满足时再按需生成辅助页
- 已删除历史入口从生成链路移除，历史残留由清理规则处理

这是从“产物集合”升级成“单工作台系统”的关键分水岭。

### 6.1 第一类：用户工作台资产

这是普通用户真正应该看到的内容。

保留为主入口：

- `references/examples/examples_catalog.html`
- `task_center.html`
- `workspace_home.html`
- `prepare_workspace.html`
- `result_workspace.html`
- `exception_workspace.html`
- `run_record.html`

条件保留：

- `storyboard_board.html`

原则：

- 这些文件必须面向人，而不是面向程序
- 只讲人话
- 只讲当前任务推进所需要的信息

### 6.2 第二类：统一状态资产

这是本次新增的核心层。

建议新增：

- `entry_state.json`
- `workspace_state.json`
- `workspace_assets.json`
- `workspace_timeline.json`

其中：

`entry_state.json`
职责：

- 当前入口选择
- starter intent
- 当前任务大类
- 当前推荐模板入口
- 当前推荐运行模式

它服务的是入口层，而不是 run 内工作台。

其中：

`workspace_state.json`
职责：

- 当前阶段
- 当前状态
- 当前结论
- 当前推荐下一步
- 当前异常压力
- 当前用户入口

`workspace_assets.json`
职责：

- 当前任务关键素材
- 当前结果图摘要
- 当前重要页面入口
- 当前结果/异常/整板等重要资源映射

`workspace_timeline.json`
职责：

- 当前任务里程碑
- prepare 完成情况
- execute 完成情况
- rerun / pause / resume 事件

原则：

- 页面默认优先读取这组统一状态
- 其它 JSON 只作为底层数据源存在

### 6.3 第三类：运行恢复资产

这些文件对系统很重要，应保留，但退出用户视野。

保留：

- `manifest.json`
- `job_state.json`
- `checkpoint.json`
- `batch_plan.json`
- `stage_plan.json`

职责：

- 执行状态恢复
- 续跑
- 补跑
- 分段执行
- 维护者定位问题

原则：

- 不作为普通用户主入口
- 主要给脚本和维护者使用

### 6.4 第四类：调试与专业资产

这些文件很多并非无用，但不应再与用户主链并列。

包括：

- `task_spec.normalized.json`
- `prompt_strategy.normalized.json`
- `prompt_strategy.enriched.json`
- `prompt_slots.json`
- `variant_matrix_plan.json`
- `prompt_draft_bundle.json`
- `prompt_validation_report.json`
- `operations_report.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `rerun_candidates.json`
- 以及各类绑定、分析、validation 产物

建议：

- 后续逐步归入 `internal/` 或 `debug/`
- 对普通用户默认隐藏
- 只在维护者模式或专业模式下暴露

### 6.5 第五类：模板治理资产

这类资产不是 run 期产物，但它们是整个 skill 的事实来源。

包括：

- `references/template_registry_zh.json`
- `references/templates/*`
- `references/template_authoring_zh.md`
- `references/examples/examples.catalog.json`

原则：

- template registry / template docs 是事实来源
- examples catalog 负责入口展示，不承担全部事实契约职责

## 7. 哪些文件应该保留，哪些应该合并

### 7.1 应长期保留的文件

用户侧：

- `references/examples/examples_catalog.html`
- `task_center.html`
- `workspace_home.html`
- `prepare_workspace.html`
- `result_workspace.html`
- `exception_workspace.html`
- `run_record.html`
- `storyboard_board.html`（条件）

状态侧：

- `entry_state.json`
- `workspace_state.json`
- `workspace_assets.json`
- `workspace_timeline.json`

运行侧：

- `manifest.json`
- `job_state.json`
- `checkpoint.json`
- `batch_plan.json`
- `stage_plan.json`

治理侧：

- `references/template_registry_zh.json`
- `references/templates/*`
- `references/examples/examples.catalog.json`

### 7.2 可以逐步合并或降级的文件

建议合并进统一状态或统一档案层：

- `operations_report.md`
- `selection_board.md`
- `README.md` 中的运行摘要部分
- 某些 run 摘要型 Markdown

它们不是完全无用，但可以降级成：

- 统一任务档案 `run_record.html`
- 统一状态层中的结构化字段

### 7.3 应从主链退出的文件

这些文件未来不再作为普通用户一级入口：

- `review_board.html`
- `completion_board.html`
- `rerun_board.html`
- `run_overview.html`
- `prompt_preview.html`
- `preflight_board.html`
- `assets_board.html`
- 已删除历史入口：`result_hub.html`、`daoge_portal.html`

处理方式：

- 准备深看页进入 `prepare-details` / `all`
- 结果深看页进入 `result-details` / `all`
- `result_hub.html` 与 `daoge_portal.html` 已从生成链路删除

## 8. 统一状态模型设计

### 8.1 `entry_state.json` 建议结构

```json
{
  "version": 1,
  "entryMode": "starter|intent|example|custom",
  "taskCategory": "电商与商业视觉",
  "starterIntent": "ecommerce",
  "templateId": "ecommerce-clean",
  "templateVariant": "ecommerce-clean-flatlay-commerce",
  "runtimeMode": "local-batch-runner",
  "recommendedNextStep": {
    "label": "生成预检工作台",
    "target": "prepare_workspace.html"
  },
  "updatedAt": "2026-05-21T00:00:00.000Z"
}
```

### 8.2 `workspace_state.json` 建议结构

```json
{
  "version": 1,
  "runId": "board_A_full",
  "taskLabel": "本轮任务标题",
  "mode": "entry|prepare|execute|result|exception|completed",
  "runtimeMode": "local-batch-runner|host-native-image-tool|prompt-and-plan",
  "workflowKind": "standard|storyboard|host-native|local-edit",
  "status": {
    "phase": "结果阶段",
    "tone": "good|warn|bad|info",
    "headline": "结果整体稳定，可以继续收口",
    "summary": "当前建议先筛图，再决定是否看整板。"
  },
  "counts": {
    "selected": 6,
    "success": 6,
    "failed": 0,
    "needsReview": 0,
    "batches": 1,
    "stages": 1
  },
  "nextAction": {
    "label": "进入结果工作台",
    "reason": "当前已经完成执行，最适合继续筛图和收口。",
    "target": "result_workspace.html"
  },
  "risk": {
    "hasIssue": false,
    "summary": "当前没有明显异常压力"
  },
  "routes": {
    "catalog": "references/examples/examples_catalog.html",
    "taskCenter": "task_center.html",
    "home": "workspace_home.html",
    "prepare": "prepare_workspace.html",
    "result": "result_workspace.html",
    "exception": "exception_workspace.html",
    "record": "run_record.html",
    "storyboard": "storyboard_board.html"
  },
  "panels": {
    "showCatalog": true,
    "showPrepare": true,
    "showResult": true,
    "showException": false,
    "showStoryboard": true
  },
  "specialization": {
    "storyboard": {
      "enabled": true,
      "slotCount": 6,
      "hasReferenceBindings": true,
      "hasMaskedEditSlots": false
    }
  },
  "updatedAt": "2026-05-21T00:00:00.000Z"
}
```

### 8.3 `workspace_assets.json` 建议结构

```json
{
  "previewImages": [],
  "referenceAssets": [],
  "resultAssets": [],
  "reviewAssets": [],
  "exceptionItems": [],
  "keyFiles": {
    "manifest": "manifest.json",
    "jobState": "job_state.json",
    "promptPreview": "prompt_preview.md"
  }
}
```

### 8.4 `workspace_timeline.json` 建议结构

```json
{
  "events": [
    {
      "type": "prepare_completed",
      "title": "准备阶段已完成",
      "summary": "提示词预览、放行检查和准备工作台已生成",
      "time": "2026-05-21T00:00:00.000Z"
    },
    {
      "type": "execution_completed",
      "title": "执行阶段已完成",
      "summary": "结果已生成，可进入结果工作台继续筛图",
      "time": "2026-05-21T00:10:00.000Z"
    }
  ]
}
```

## 9. 页面体系正式定义

未来采用：

**一个入口工作台体系 + 一个 run 工作台体系**

### 9.1 `references/examples/examples_catalog.html`

定位：

- 中文模板选择工作台
- 新任务起步前台

它不只是参考页，而是整个 skill 的第一层工作台。

### 9.2 `task_center.html`

定位：

- 跨 run 总入口
- 开始新任务
- 继续旧任务

只回答：

1. 现在是开新任务还是继续旧任务
2. 哪一轮任务最值得继续

### 9.3 `workspace_home.html`

定位：

- 单任务唯一主工作台

只回答：

1. 当前任务在哪个阶段
2. 当前推荐下一步是什么
3. 有没有异常压力
4. 当前有哪些关键资产和入口

原则：

- 这是整个 run 的第一主页面
- 它不是跳转页
- 它是统一总控页

### 9.4 `prepare_workspace.html`

定位：

- 准备层深看页

只在用户需要深看以下内容时进入：

- 方向确认
- 提示词预览
- 放行判断
- 素材绑定

### 9.5 `result_workspace.html`

定位：

- 结果深看页

只负责：

- 图片细看
- 保留取舍
- 异常回流
- 整板复看

### 9.6 `exception_workspace.html`

定位：

- 问题处理页

只在确有异常或待复核时抬到前台。

### 9.7 `run_record.html`

定位：

- 统一任务档案

它负责把原来分散在多个 Markdown 里的“人话总结”统一收进一个地方。

### 9.8 `storyboard_board.html`

定位：

- 分镜类任务的专业深看页

原则：

- 不是所有任务都需要
- 不进入普通任务默认主链

## 10. 特殊工作流的正式定位

### 10.1 host-native 是正式主线之一

未来蓝图必须明确：

- host-native 不是兼容边路
- 它是 DAOGE 的正式运行模式之一

因此它应该拥有：

- 独立模式识别
- 独立轻量交接资产
- 独立结果回填契约
- 接回统一工作台状态层

### 10.2 storyboard 是专用结构化子系统

storyboard 的核心不是多图数量，而是：

- content slot
- layout binding
- reference bindings
- mask / continuity / camera_move

因此在状态层里应保留专用字段，而不是强行压平。

### 10.3 local-edit / rerun 是专业路径，不应误删

它不应该继续抬成普通用户第一主链，
但也不应在未来收口中被误删。

它应该成为：

- 异常页的专业处理路径
- storyboard 的局部修订路径

## 11. 对话与工作台如何协同

这是本次蓝图最重要的体验定义之一。

未来要形成以下协同模式：

### 11.1 对话负责“推进”

对话做：

- 采集需求
- 追问缺失信息
- 做关键确认
- 提醒用户当前风险
- 告诉用户现在该看工作台哪里

### 11.2 工作台负责“呈现”

工作台做：

- 当前阶段可视化
- 当前进展可视化
- 当前结果和异常可视化
- 当前资产沉淀可视化
- 下一步动作可视化

### 11.3 统一状态负责“同步”

每推进一个关键阶段，就刷新统一状态文件。

这样用户即使暂时不看对话，也能从工作台里直接理解局势。

### 11.4 最终体验目标

用户会感觉：

- 对话像助手在带着自己推进
- 工作台像一个实时同步的任务面板
- 两边说的是同一套语言
- 不是一边在聊天，一边在看另一个系统

## 12. 现有脚本链应该怎么调整

### 12.1 当前事实

当前脚本链主要是：

- `daoge.js prepare`
- `daoge.js execute`
- `internal asset builder`
- `scripts/daoge.js ingest`
- 各类 `render_*` 脚本

当前模式是：

1. 先生成大量结构化文件
2. 再分别生成 Markdown 和 HTML

### 12.2 调整原则

后续不应该推翻整条链，而应该做“聚合层插入”：

1. 保留现有运行资产
2. 新增统一状态聚合步骤
3. 页面优先读取统一状态
4. 老页面逐步退出主链

### 12.3 建议新增脚本

建议新增：

- `build_entry_state.js`
- `build_workspace_state.js`
- `build_workspace_assets.js`
- `build_workspace_timeline.js`

职责：

- 从现有入口、运行和结果资产中聚合出统一状态文件

### 12.4 渲染脚本未来职责

未来渲染脚本应该调整为：

- `render_example_catalog_board.js` 优先读 `entry_state.json`
- `render_workspace_home.js` 优先读 `workspace_state.json`
- `render_prepare_workspace.js` 优先读 `workspace_state.json + workspace_assets.json`
- `render_result_workspace.js` 优先读 `workspace_state.json + workspace_assets.json`
- `render_exception_workspace.js` 优先读 `workspace_state.json + workspace_assets.json`
- `render_run_record.js` 优先读 `workspace_state.json + workspace_timeline.json`

### 12.5 迁移约束

迁移期间必须尊重现有 smoke 护栏。

策略：

1. 先加聚合层，不破坏既有文件输出
2. 再让页面逐步切换到统一状态读取
3. 最后再继续压缩内部归档和诊断说明的默认暴露

## 12. 实施阶段

### 第一阶段：入口层与状态聚合层落地

目标：

- 不破坏现有主链
- 不破坏 starter / intent / example 路径
- 新增统一状态层
- 页面开始逐步摆脱多文件拼装

实施项：

1. 新增 `entry_state.json`
2. 新增 `workspace_state.json`
3. 新增 `workspace_assets.json`
4. 新增 `workspace_timeline.json`
5. 在 `scripts/daoge.js prepare`、`internal asset builder` 和 `scripts/daoge.js ingest` 中接入状态聚合
6. 保持现有 smoke 测试通过

验收标准：

- 入口层和 run 层都能稳定生成统一状态
- 状态字段能覆盖当前工作台需要的核心信息

### 第二阶段：页面改成状态驱动

目标：

- 让工作台页面真正共用同一套状态语言

实施项：

1. 改 `examples_catalog`
2. 改 `workspace_home`
3. 改 `prepare_workspace`
4. 改 `result_workspace`
5. 改 `exception_workspace`
6. 改 `run_record`

验收标准：

- 页面之间不再出现明显重复和冲突表达
- 入口页和 run 页共用同一套系统语言
- 主要页面只依赖统一状态源和少量专题资产

### 第三阶段：深看页分级与历史入口删除

目标：

- 结束“多看板并列主链”的历史包袱

实施项：

1. `review_board.html` 降级
2. `completion_board.html` 降级
3. `rerun_board.html` 降级
4. `prompt_preview.html` / `preflight_board.html` / `assets_board.html` 降级
5. 删除 `result_hub.html` / `daoge_portal.html` 渲染链路

验收标准：

- 普通用户只需理解一套主链
- 专业页只在按需路径中出现

### 第四阶段：目录收敛

目标：

- 把内部产物和用户产物物理分层

实施项：

建议未来逐步引入：

- `workspace/`
- `internal/`
- `debug/`

例如：

- `workspace/*.html`
- `internal/*.json`
- `debug/*.md`

验收标准：

- run 目录顶层不再充满并列产物
- 用户一眼能看出主入口

## 13. 页面与资产最终关系

未来推荐关系如下：

### 用户入口主链

1. `references/examples/examples_catalog.html`
2. `task_center.html`

### 用户 run 主链

1. `workspace_home.html`
2. `prepare_workspace.html`
3. `result_workspace.html`

### 条件页

1. `exception_workspace.html`
2. `storyboard_board.html`

### 统一人话归档

1. `run_record.html`

### 统一入口状态

1. `entry_state.json`

### 内部状态

1. `workspace_state.json`
2. `workspace_assets.json`
3. `workspace_timeline.json`

### 底层运行资产

1. `manifest.json`
2. `job_state.json`
3. `checkpoint.json`
4. `batch_plan.json`
5. `stage_plan.json`

### 专业与调试资产

1. `success.json`
2. `failed.json`
3. `needs_review.json`
4. `rerun_candidates.json`
5. `operations_report.json`
6. 其它 prepare 中间产物

### 模板治理资产

1. `references/template_registry_zh.json`
2. `references/templates/*`
3. `references/examples/examples.catalog.json`

## 14. 这份蓝图落地后的直接收益

### 对用户

- 更少页面
- 更清晰入口
- 更统一文案
- 更稳定心智
- 更像真实工作台

### 对系统

- 入口层和运行层语言一致
- 模式分流更稳定
- 状态表达统一
- 页面逻辑更干净
- 更容易扩展新任务类型
- 更容易支持 host-native / local-runner 双模式
- 更容易支持 storyboard / local-edit 这类专用结构化工作流

### 对后续改造

- 后续不再是零散修补
- 每一刀都可以明确落到统一架构上
- 前端、后端、对话层终于能说同一套语言

## 15. 这份蓝图之后的第一刀

下一步最值得先动的，不是继续修视觉，而是：

**先做入口层与统一状态层第一版**

也就是：

1. 设计并落地 `entry_state.json`
2. 设计并落地 `workspace_state.json`
3. 从现有入口资产和运行资产自动聚合出第一版状态
4. 先让 `workspace_home.html` 和 `examples_catalog.html` 逐步读取统一状态

原因：

- 风险最小
- 收益最大
- 能最快验证这条总路线是否成立
- 一旦状态层跑通，后面所有页面收束都会变得顺手很多

## 16. 结论

这次大改的正确方向已经非常明确：

不是继续往当前体系里叠更多页面和说明，
而是把整个 skill 升级成：

**统一状态驱动的 DAOGE 可视化工作台系统**

它的核心公式是：

**入口映射 + 模式分流 + 对话推进 + 状态聚合 + 工作台呈现 + 资产分层**

这份蓝图将作为后续所有相关重构的总依据。后续页面调整、脚本调整、资产归并，都应以这份蓝图为准，而不是再回到“加一个板、补一个页、再挂一个链接”的旧思路。
