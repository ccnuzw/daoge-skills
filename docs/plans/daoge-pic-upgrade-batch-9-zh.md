# daoge-pic 以人为本升级 · 第 9 批施工单（界面批 E · 拆分与守卫 L0–L6）

## 进度快照（**每搬完一片就在这里更新一行**）

| 日期 | 事件 | 状态 |
| --- | --- | --- |
| 2026-09-19 | **施工单编制完成**。前置：批 D 已推送（`e80f993`/`e64b85d`，工作区干净）。本批 = 界面宪法 §8.2 批 E：**App 拆 app/+views/ · 画布拆三件 · CSS 按块归属 · G1–G13 全绿** | 开工 |
| 2026-09-19 | **E1.1 完成**：`IconButton`/`StatusPill` → `components/`；`AssetCard`/`AssetSelectionStrip`/`ListPager` → `app/asset-surfaces.jsx`。main **3370 → 3295 行**；build ✓ / lint 0 / **全量 895 项 → 893 通过 / 0 失败 / 2 跳过** / 三屏冒烟全过；G24 源级守卫已跟着搬到新家 | 继续 E1.2 |

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