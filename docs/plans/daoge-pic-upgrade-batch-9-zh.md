# daoge-pic 以人为本升级 · 第 9 批施工单（界面批 E · 拆分与守卫 L0–L6）

## 进度快照（**每搬完一片就在这里更新一行**）

| 日期 | 事件 | 状态 |
| --- | --- | --- |
| 2026-09-19 | **施工单编制完成**。前置：批 D 已推送（`e80f993`/`e64b85d`，工作区干净）。本批 = 界面宪法 §8.2 批 E：**App 拆 app/+views/ · 画布拆三件 · CSS 按块归属 · G1–G13 全绿** | 开工 |
| 2026-09-19 | **E1.1 完成**：`IconButton`/`StatusPill` → `components/`；`AssetCard`/`AssetSelectionStrip`/`ListPager` → `app/asset-surfaces.jsx`。main **3370 → 3295 行**；build ✓ / lint 0 / **全量 895 项 → 893 通过 / 0 失败 / 2 跳过** / 三屏冒烟全过；G24 源级守卫已跟着搬到新家 | 继续 E1.2 |
| 2026-09-19 | **E1.2 完成**：13 个创建/引用/衍生/驳回对话框 + 33 个文案助手 → `app/creation-dialogs.jsx` + `app/creation-model.mjs`；`api` 请求口与其 5 助手 → `app/api.js`。main **3295 → 2577 行**；3 处源级守卫迁移（协议头/边界句/api 重试）后全量 895→893/0/2；新建批次与新建项目对话框实测正常 | 继续 E1.3 |
| 2026-09-19 | **E1.3 完成**：8 个运行面组件 + 2 助手 → `app/run-surfaces.jsx`。main **2577 → 2368 行**。顺手把搬迁手法固化成 `tools/lift.py`（行界+编译器驱动补 import；修了三个工具 bug：跨度重复导致重复切割、`class` 不在顶层正则里、拼装未去重）。2 处源级守卫迁移后全量 895→893/0/2；运行页冒烟通过 | 继续 E1.4 |

## 0. 前置

### 0.0 性质与红线（这是**纯搬运**批）

批 E 不加功能、不改行为。**红线三条**：
1. **行为零变化**——每搬一片，`build` 通过 + 全量回归绿 + 浏览器冒烟一遍（创作平台/资产/交付三屏）；
2. **一次只搬一片**，一片一提交（可回滚的最小单位）；
3. **不许顺手改文案/样式/结构**——搬运中发现的真问题记进日志，另开提交。

**现状实测（编单时）**：`main.jsx` **3370 行**（~40 个顶层组件 + App 壳）· `creative-lineage-canvas.jsx` **1672 行** ·
`styles/surfaces/workbench.css` **1560 行** · 目标：`app/` ≤250、`views/` ≤400、画布三件各自成文件、CSS 一块一文件。

### 0.1 分片计划（每片一个可验证的搬运）

| 片 | 内容 | 目标文件 | 验证 |
| --- | --- | --- | --- |
| **E1.1** | 原语与资产面组件 | `components/IconButton.jsx`、`components/StatusPill.jsx`、`app/asset-surfaces.jsx`（AssetCard/AssetSelectionStrip/ListPager） | build + 全量 + 资产页冒烟 |
| **E1.2** | 对话框群（创建/引用/衍生/驳回/查看器） | `app/dialogs/…`（按对话框一族一文件） | 同上（每族一片） |
| **E1.3** | 运行面组件（Run*/GenerationHistory/Evidence/AdvancedDetails） | `app/run-surfaces.jsx` | build + 全量 + 运行页冒烟 |
| **E1.4** | 项目/任务面组件（ProjectIndex/Overview/TaskList/QualityMetrics/ManagedTaskList） | `views/projects.jsx`、`views/tasks.jsx` | build + 全量 + 两页冒烟 |
| **E1.5** | 壳件（WorkspaceContextBar/SessionPlanSummary/StudioSearch/StatusSlot 接线） | `app/shell-pieces.jsx` | build + 全量 + 面包屑冒烟 |
| **E1.6** | App 收敛：`viewRenderers` 逐个变视图组件（props 显式化），App 壳 ≤250 | `app/workbench-app.jsx` + `views/*.jsx` | 每移一个视图跑一次全量 |
| **E2.1** | 画布：检查器簇（Inspector/PlanActions/ReplyHistoryPanel/GroupActions） | `canvas/lineage-inspector.jsx` | build + 全量 + 画布冒烟 |
| **E2.2** | 画布：舞台簇（节点/连线/右键菜单/小地图/快捷键盘/文本视图） | `canvas/lineage-stage.jsx` | 同上 |
| **E2.3** | 画布：`CreatorWorkbench` 成为编排组件（状态与副作用留这里） | `canvas/creator-workbench.jsx` | 同上 |
| **E3.1** | CSS 按块归属：`workbench.css` 按组件拆块（与其组件同目录或同前缀文件） | `styles/blocks/*.css` | `layout-tokens` + 全量 |
| **E3.2** | `style-ownership-guard`（G4）：同一选择器不跨文件重复 | — | 新守卫红→绿 |
| **E4** | G1–G13 全绿：补齐缺的（G1 views 无 max-width / G3 全层无裸字面量 / G4 归属 / G5 views 不渲染全宽状态条 / G7 层依赖 / G8 行数上限 / G9 hover 必带 focus-visible / G10 导航去重全量） | — | 守卫表逐个绿 |

### 0.3 搬运手法（防上次两类事故）

1. **用编译器当安全网**：先按行区间把组件原文搬出 → 新文件补 import → 老文件 import 回来 →
   `npm run build:workbench` + `npm run lint` 当场抓名字漏；**报错逐个修，不猜**；
2. **不做「顺手替换」**：上次（批 D）一次替换弄丢过整个分支——本批每步只做一种操作（搬/补/删），
   做完立刻 `git diff --stat` 核对行数增减是否符合预期（搬走 N 行 ≈ 新文件 +N、老文件 −N）。

### 0.6 不许弄坏

- 深链与视图注册表不变；`data-region`/`data-block`/`data-slot` 钩子一个不丢（守卫在）；
- 批 C/D 刚落的行为（只读查看器、步骤条按需、底栏三态、一个右栏）不许因搬运回退；
- 全量基线 **895 项 / 893 通过 / 0 失败 / 2 跳过**——每片结束不得低于它。

## 1. 目标（可验收的一句话）

同一份行为，更小的文件：`app/` ≤250 行、每个 `views/*.jsx` ≤400 行、画布拆成舞台/检查器/编排三件、
CSS 一块一文件且同一选择器不跨文件重复；G1–G13 全绿。

## 2. 验收清单

1. 行数：`app/workbench-app.jsx` ≤250、`views/*.jsx` ≤400、画布三件各自成文件（`wc -l` 可验）；
2. 全量回归绿（≥基线）；build/lint 0；
3. 浏览器冒烟：创作平台（工具条/底栏/右栏）、资产（只读查看器）、交付（步骤条）三屏无异常；
4. CSS：同一选择器不跨文件重复（G4 绿）；
5. G1–G13 逐个绿（表里的每一条都能说出「谁在守」）。

## 3. 开放项销账

| 开放项 | 本批动作 |
| --- | --- |
| 队列是否进 Aside（批 C 留） | 搬运不动行为；结论记在 §5 |
| 死 CSS（`.workspace-context-select` 等） | 随 E3.1 拆块时一并清（同文件内） |

## 4. 实施日志

### 2026-09-19 · **并行：界面瑕疵专项（刀哥委托）——已收口**

刀哥人工抽检出多批界面瑕疵后委托 Agent 同口径全面自查自修；台账落在
界面方案 `studio-interface-layout-plan-zh.md` §12「界面瑕疵专项排查」（S1–S9，含状态）。
本轮已开三件事：

1. **浏览器实测**（受控 Chromium + daemon 会话 Cookie；非只读代码扫描）逐屏走查 + DOM 度量；
2. **S1 修复 + 守卫**：E1.6a 拆视图时 `cond ? <X/> : null` 被包进片段，
   创作平台 / 项目总览 / 任务三屏**直接把源码文字渲染上屏**（`selectedProject ?` 与 `: null`）——
   浏览器实测抓到，已修（`ab4a139`）；守卫 `tests/vnext/view-split-guard.test.js` 对旧版源必红（验证过 2b414ec）。
   **教训**：三处真机冒烟没拦住它——「肉眼过一遍」不算门禁，可守卫的形态必须落成测试。
3. **待修队列**（台账 S2–S9）：资产工具条挤压折行（P1）、资产来源检查器缺对话框语义（P1）、
   画布资产节点「打开详情」空回调（P2）、多处输入无 label / 错误无 alert / hover 缺 focus-visible（P2）、审计覆盖层 console 噪声（P3）。

**口径**：修复按「构建 + 回归 + 浏览器复验」收口；每条修复须带可见验收（对着台账勾）。

**收口（同夜）**——台账正文在界面方案 §12，这里只记总账：

- 终态：**6 处已修 + 2 处 P0 已修 + 2 处误报撤销 + 1 处按设计保留**；S7（hover 缺 focus-visible）随 E4 的 G9 全量口径；
- 两处 P0 在 E1.6c 收口期间抓到并修掉（均属「入口级」故障，任何真机冒烟都过不去）：
  ① `useWorkbenchController()` 里留着 `if (loading) return <JSX>` → App 把元素当 props 展开，**首屏必崩**；
  ② main.jsx 重写时丢了 `import './styles.css'` → 产物里没有 CSS，**整站无样式**。修复随 `fcb8b24` 入树；
- 提交：`ab4a139`（S1）/ `8587acb`（S2/S10/S11）/ `3eb5b7d`（S3/S5）+ `fcb8b24`（两处 P0）；
- 全量回归 **896 项 / 894 通过 / 0 失败 / 2 跳过**（基线 895/893/0/2，+1 为新增 `view-split-guard`）；
- 给 E4 的建议：S12/S13 这类入口级故障应由**构建产物断言**兜住（CSS 产物存在 + 首屏非 fatal），
  与 G1–G13 一起列进守卫清单。

### 2026-09-19 · **批 E 第二轮（E1.6a/E1.6b 完成）**

| 片 | 提交 | 内容 | 进展 |
| --- | --- | --- | --- |
| E1.6a | `2b414ec` | `viewRenderers` 14 个入口 → `views/*.jsx`（每个 **6–49 行**，验收 ≤400 达标） | main 2212 → 2179 |
| E1.6b | `d2570cf` | App 的返回壳 → `app/workbench-shell.jsx`（119 props，编译器定界） | main → **2138**；App 体量 ~1700 |

**手法**：新增 `tools/split_views.py`（入口→视图组件，自动 props）与 `tools/lift_shell.py`（壳抽取）。
两者都用「编译器驱动收敛」：缺名字先试 import 映射，否则当 prop 处理。修掉的工具 bug 三个：
贪心正则截断 `page(...)` 内容、解构的 App 本地未计入、顶层辅助函数内的局部被误当 App 绑定。

**搬运中迁移的守卫**：18 处源级断言（大多数改为读「main + 壳」或指到视图文件），其中 3 处需要手工（
确认弹窗文案、预览弹层回调清单、source-text 自检——一次粗放替换误伤后已回滚）。

**一次虚惊要记档**：资产页冒烟时选择条消失。**不是回归**——服务端项目选择态被清空（疑似早先某个冒烟脚本点掉了），
而评审「成果 3」还在。用 `/api/projects/<id>/selection/batch` 恢复后，选择条 / 交付步骤条 / 只读查看器全部回来
（这是「重构未破坏接线」的证据）。**结论**：以后冒烟脚本不许点「清空/移出」类控件；夹具恢复办法记在此。

**验收现状**：`views/*.jsx` ≤400 ✓；`main.jsx` 2138（App ≤250 **未达**——余下 ~1700 行是状态/副作用/处理器，
即下一片 E1.6c：把逻辑抽成 hooks）；build/lint/全量 **895→893/0/2** 每片都绿；冒烟：画布（面包屑/rail/状态卡/新建批次）、
资产（只读查看器 + 选择条 + 去交付）、交付（步骤条 + 历史）、资料三页、项目/概览。

**下一轮建议顺序**：① **E2.1 画布检查器簇**（先做「共享助手模块」：`openNode`/`isAssetNode`/`nodeTypeLabel` 等两边都用，
需要先搬到 `canvas/` 下的模型文件；顺带把 `tools/lift.py` 泛化成 `--from <file>`）；
② E1.6c（App 逻辑 → hooks，App ≤250）；③ E2.2/E2.3（舞台簇、编排）；④ E3（CSS 按块 + G4）；⑤ E4（G1–G13 全绿）。

### 2026-09-19 · **批 E 阶段性回报（E1.1–E1.5 完成，E1.6/E2/E3/E4 待续）**

**已完成（每片一提交，全量每片都绿）**：

| 片 | 提交 | 内容 | main 行数 |
| --- | --- | --- | --- |
| E1.1 | `24abd69` | IconButton/StatusPill → components/；AssetCard/AssetSelectionStrip/ListPager → app/asset-surfaces.jsx | 3370 → 3295 |
| （收口） | `6435502` | 资产卡菜单去掉评审动作（批 D 的账，§7.4） | — |
| E1.2 | `f4ea5c7` | 13 个对话框 + 33 助手 + api 请求口 → app/creation-dialogs.jsx / creation-model.mjs / api.js | 3295 → 2577 |
| E1.3 | `66f1649` | 8 个运行面组件 → app/run-surfaces.jsx；搬迁手法固化为 `tools/lift.py` | 2577 → 2368 |
| E1.4 | `9046c65` | 6 个项目/任务面组件 → app/project-surfaces.jsx | 2382 → 2296 |
| E1.5 | `023beb4` | 三件外壳（摘要/面包屑/错误条）→ app/shell-pieces.jsx | → 2212 |

**总账**：main.jsx **3370 → 2212 行（−34%）**；新增 `app/` 模块 7 个 + `components/` 2 个；全量 **895/893/0/2** 全程未降；
build/lint 每片 0；浏览器冒烟覆盖：资产（只读查看器）、交付、资料三页、运行页、项目/概览页、新建批次/新建项目对话框、面包屑与 rail。
**守卫迁移 8 处**（源级断言跟着代码搬家：G24 选择条、协议头、边界句、api 重试、归因接线、行内重试、导航去重、库边界）。

**工具 `tools/lift.py` 的三个 bug（都在过程中修掉并留档）**：
① 同名既作组件又作助手 → 跨度重复 → 同一区间被切两次（吃掉 `StudioVersionGate` 开头）；
②「下一个顶层声明」正则漏 `class` → `GenerationHistory` 的跨度吞掉 `WorkbenchErrorBoundary` 类；
③ 拼装未去重 → 重复定义（TS 报 redeclare）。

**待续（下一批从这里接）**：
- **E1.6 App 收敛**：`viewRenderers` 逐个变 `views/*.jsx` 组件（props 显式化），App ≤250；`StudioVersionGate`/`LocalStudioAuthorizationGate` 随 App 一起搬（它们渲染 `<App/>`，现在留 main 是为了不制造循环依赖）。
- **E2 画布拆分**：`canvas/lineage-inspector.jsx`（检查器簇）→ `canvas/lineage-stage.jsx`（舞台簇）→ `canvas/creator-workbench.jsx`（编排）。
- **E3 CSS 按块归属** + `style-ownership-guard`（G4）。
- **E4 G1–G13 全绿**：补齐缺的（G1 views 无 max-width / G3 全层无裸字面量 / G4 归属 / G5 views 不渲染全宽状态条 / G7 层依赖 / G8 行数上限 / G9 hover 必带 focus-visible / G10 导航去重全量）。

### 2026-09-19 · 施工单编制完成（开工）

### 2026-09-19 · **E1.1 实施日志**

**搬走**：`IconButton`、`StatusPill` → `web/src/components/`；`AssetCard`、`AssetSelectionStrip`、`ListPager` →
`web/src/app/asset-surfaces.jsx`。main.jsx **3370 → 3295**。
**手法**：按顶层函数行界摘出（regex 找 `^function NAME(` 到下一段起点）→ 新文件补 import → 老文件 import 回来 →
**编译器当安全网**逐条修（`useState`、`Ellipsis/Copy/GitFork/MessageSquareText` 漏 import 都被 TS 当场抓住）。
**守卫迁移 1 处**：`surface-placement` 的 G24 原按 `main.jsx` 切片找选择条——搬运后跟着改读
`app/asset-surfaces.jsx`（源级守卫必须跟着家走，这是搬运批的固定动作）。
**验证**：build ✓ / lint 0 / 全量 895→893/0/2 / 三屏冒烟（资产条无挑图动词且「去交付」在、查看器只读、交付步骤条与历史、共享素材搜索、资料页筛选位）全过。

**搬运中发现的真问题（不在搬运里改，另议）**：
- **资产卡的 ⋯ 菜单里仍有评审启动器**（`CreativeActionLauncher compact … label="用这张继续"`）。
  批 D 的 §7.4 只关了「选择条」那条路，卡片这条路还在——G24 现在的口径也只扫了选择条。
  待刀哥定：① 卡片菜单也去掉评审/继续动作（严格按「不复制画布评审动作」）；② 或保留（单张图的「用这张继续」算创作动作，不算挑图主路径）。

分片计划按「一次只搬一片」写死；E1.1 先行。