# daoge-pic 以人为本升级 · 第 6 批施工单（界面批 B · 外壳）

> **本文件在套装中的位置**：宪法（创作怎么走）→ 规格书（跨批次规矩）→ **界面宪法**（界面长什么样：`studio-interface-layout-plan-zh.md`）→ **本文件＝行政命令**。
> 本批是界面宪法 **§8.2 节「批 B · 外壳（导航去重）」** 的落地。第 5 批（批 A · 底座）已收束并推送（`0b8f86b`）。
>
> **本批是否触发规格书改动：否**——纯前端；四条红线、schema、协议、API 全不动。

---

## 进度快照（**每次做完一组就在这里更新一行**）

| 日期 | 进度 | 下一步 |
|---|---|---|
| 2026-09-19 | **施工单编制完成（未开工）**。前置：批 A 已推送（`0b8f86b`，工作区干净）。本批 = 界面宪法 §8.2 批 B：**rail 三区 + 状态卡合并 / 顶栏面包屑替换上下文条 / 页签去重 / 计划与历史进检查器 / 视图注册表补 `label`** | 刀哥拍板 D1；写 0.3 守卫桩并确认红 |
| 2026-09-19 | **0.3 守卫桩写完并确认红**：G10/G14/G15/G16 四组共 11 条断言，**7 红 3 绿**（绿的是「不删」不变量：rail 四个一级入口仍在、未读完成仍在） | 按 B1→B5 动代码 |
| 2026-09-19 | 🎉 **B 组全部完成**：rail 三区 + **一张状态卡**（安全重启与疑难入口都在卡里）· 顶栏**面包屑**替换上下文条（三段点开切换、不放动作）· 页签去重 · **计划/生成历史进检查器**（默认停在计划）· 注册表补 `label`。**实测**：面包屑三段可点、旧 select/页签 0 个、rail 三区、状态卡 1 张、新建批次与任务列表都到位、检查器两页签与运行列表可用。**全套 875 项 → 873 通过 / 0 失败 / 2 跳过** | 收尾（证据入档）→ 提交 |

> **本批不做**（留给后续）：**批 C**（创作平台 chrome 收敛、`Aside` 统一、底栏贴底、指标进 Aside）、**批 D**（三面归位）、**批 E**（拆分与 CSS 分块）、以及**术语单「布局词」类 + 手册快捷键表**（刀哥已定：属批 C）。

---

## 0. 前置

### 0.0 本批的性质

- **纯前端**：只改 `web/src/**`、`tests/vnext/**`、`docs/plans/**`。
- **不是收尾批**；`lint` / 双端 typecheck / 单批相关守卫绿即可，全量留收尾。
- **行为零变化**（除导航去重本身）**禁止顺手改**：不改任何业务流程、数据流、文案语义；发现必须改行为才能做完的，停下来记第 8 节。

### 0.1 本批会破坏的守卫（先写桩，再动代码）

| 守卫 | 为什么会红 | 处置 |
|---|---|---|
| `workbench-bulk-ui.test.js:21` | 断言 `className="workspace-context-select workspace-context-task"`（上下文条的任务选择器）——B2 用面包屑替换它 | **迁移**：改断言面包屑（§0.5 第 1 条） |
| `phase4-navigation-registry.test.js:30` | 断言 `const mainItems = [`（rail 渲染结构）——B1 重排 rail 三区 | **迁移**：改断言分区结构（一级入口集合不变） |
| `source-text-guard.test.js` | 前端源码文本断言（上下文条 / 页签） | 逐条核对；被触及的按钩子迁移 |
| `view-registry.test.js`（G12 扩展） | B5 给注册表加 `label` | **扩展**：新增 label 断言（只加不删） |
| `lineage-density` / `lineage-menu` / `workbench-route` | **预期不改**（B 批不动画布内部与路由字段） | 若红，先怀疑自己改错 |

### 0.2 本批会触及、需逐条复核的守卫

`terminology-guard`（rail/面包屑文案若动；**布局词仍属批 C，本批不扩类**）、`delivery-page-render` / `creator-delivery-ui`（预期不改）、`build-isolation`、`workbench-performance`、`layout-page-frame`（G1：页面容器仍不得自写宽度）、`layout-slot`（G4：状态槽仍是一处）、`structure-hook`（G13：`data-region` 与 class 棘轮只减不增）。

### 0.3 新增守卫桩（先写成 fail）

| # | 桩文件 | 断言 |
|---|---|---|
| **G10** | `tests/vnext/navigation-dedup.test.js` | **同一目的地在 rail 与页签里不得同名出现**（对照 `VIEW_HOSTS`/`NAVIGATION_ITEMS` 与上下文条渲染段）；**上下文条不再含导航项**（只剩面包屑） |
| **G14** | `tests/vnext/shell-breadcrumb.test.js` | 面包屑三段（项目 ▾ › 任务 ▾ › 批次 ▾）**只读路径 + 点开切换**；**顶栏不放动作**（新建/导出类不在顶栏） |
| **G15** | `tests/vnext/rail-sections.test.js` | rail 三区（工作区 / 资料 / 状态）；**状态区只有一张卡**（一行结论 + 点开明细 + 疑难入口）；provider 退避结论出现在状态卡里（S7 的唯一常显位置） |
| **G16 扩展** | `tests/vnext/view-registry.test.js`（既有） | 每个 view 声明人话 `label`（供面包屑与 rail）；`label` 非空且不是英文枚举 |

### 0.5 G13 迁移清单（本批涉及的 2 处）

1. `workbench-bulk-ui.test.js:21`：`workspace-context-select workspace-context-task` → 断言面包屑的**任务段**
   （`data-region="breadcrumb"` + 段数）；**旧的 select 类断言删除**（那是 A 组 §0.5 里预告的 4 处之一，合同到期）。
2. `phase4-navigation-registry.test.js:30`：`const mainItems = [` → 断言 rail 的**三区结构**与一级入口**集合不变**
   （`data-region="rail-workspace|rail-library|rail-status"`）。

> 其余 2 处（`local-auth-failure`、`provider-outage-strip`）不属本批：前者随其自身批次，后者类名仍在（状态槽内）。

### 0.6 不许弄坏的交互（对齐界面宪法 §3.1 与批 A 的成果）

| # | 判据 | 本批风险点 |
|---|---|---|
| I1 | **composer 常显**（选中 + 说一句能同时成立） | B 批不动底栏；**不许**因为「外壳重排」把它塞进条件渲染 |
| I7 | **出完了叫我**（未读完成） | B2 换顶栏时**未读必须在顶栏有位置**（指示点 + 标题计数） |
| — | **alert 不折叠** | B1 合并状态卡时，`provider-outage` 等 alert 仍走状态槽（G4），不许降级 |
| — | **能力入口不删** | 上下文条去掉的是**重复**导航；「新建批次 / 任务列表」这类**动作**必须指到新家（见 D1），不能消失 |

---

## 1. 目标（可验收的一句话）

**同一块屏幕不再出现两处同名导航**：rail 只留四个一级入口 + 一张状态卡，顶栏只剩一条**面包屑**
（只读路径、点开才成菜单），计划与生成历史回到**批次检查器**里——用户不用记「这个功能在哪一页」。

---

## 2. 任务分解

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **B1** | **rail 三区 + 状态卡合并** | `workbench-navigation.jsx`、`styles/surfaces/workbench.css` | 三区：**工作区**（4 个一级入口）→ **资料**（规则资料 / 共享素材 / 创作手册）→ **状态**。两张卡（生成服务 / 运行状态）合并为**一张**：一行结论 + 点开两条明细 + 疑难入口；**provider 退避/限流的常显结论落这里**（S7 的唯一常显位置，队列底栏只在拖慢当前动作时提示） | §5.3、S7 |
| **B2** | **顶栏 + 面包屑（替换上下文条）** | `main.jsx`（`WorkspaceContextBar` → `WorkspaceBreadcrumb`）、新增 `components/WorkspaceBreadcrumb.jsx`（或就地改） | 顶栏：左＝品牌 + `项目 ▾ › 任务 ▾ › 批次 ▾`（**只读路径 + 点开切换**，不常驻 select）；右＝刷新 + **未读完成**（I7）+（仅运行时）运行指示点；**不放动作**。`data-region="header"` 保留（审计依赖） | §5.1、§5.2 |
| **B3** | **上下文条页签去重** | `main.jsx`（`task-local-tabs`） | 删掉 **资产管理 / 创作平台 / 批次对比**三个页签（rail 与画布各有其位）；`计划` / `生成历史` 由 B4 送进检查器；**动作类**（新建批次等）按 D1 的决议落位 | §5.3 去重表 |
| **B4** | **计划 / 生成历史进 `Aside`** | `creative-lineage-canvas.jsx`（检查器）、`main.jsx`（renderer 出口） | 批次检查器内两页签：**计划**（确认闸门所在）/ **生成历史**（运行与重试所在）；点批次即得，不离开画布。**能力不删**：`prompts` / `runs` 两个 view 仍可从深链进入（旧深链不 404） | §5.3、§5.8 |
| **B5** | **注册表补 `label`** | `workbench-navigation-model.mjs`、`workbench-navigation.jsx` | 每个 view 一句**人话标签**（供面包屑/rail 消费），与 `VIEW_HOSTS`、`VIEW_LAYOUTS` 并列；`label` 有守卫（G16 扩展） | §5.2、G12 家族 |

### 收尾

双端 typecheck → `npm run lint` 0 error → 单批相关守卫绿 → `npm run build:workbench` → `?audit=layout` 在受影响屏上采证据（§8.4 格式）。

---

## 3. 守卫变更（汇总）

- **新增**：G10 `navigation-dedup`、G14 `shell-breadcrumb`、G15 `rail-sections`；G16＝扩展 `view-registry`。
- **修改**：`workbench-bulk-ui`（上下文条 → 面包屑）、`phase4-navigation-registry`（rail 三区）。
- **必须仍绿**：G1/G4/G13（批 A）、`workbench-route`、`lineage-*`、`terminology-guard`、`build-isolation`。

---

## 4. 迁移或切换步骤

**无 schema / API / 协议变更**。前端改完刷新即生效；改完在隔离 workspace 或日用环境都行（纯前端，回滚＝回退 bundle）。

**旧深链不 404**：`?view=prompts` / `?view=runs` 仍可进入（B4 只改「从画布怎么到达」）。

---

## 5. 验收清单（每条一个可见现象）

- [ ] **B1** rail 三区有分区语义；状态区只有**一张**卡，一行结论；点开有两条明细与疑难入口
- [ ] **B2** 顶栏只有面包屑（三段且都能点开切换）；**没有**任何动作按钮；未读完成可见（I7）
- [ ] **B3** 任一屏**看不到两处同名导航**；同屏可切换的层级控件只有 1 个
- [ ] **B4** 点批次 → 检查器里能看**计划**与**生成历史**，确认闸门与重试都在其中；`?view=prompts` / `?view=runs` 深链仍可用
- [ ] **B5** 面包屑/rail 用的人话标签来自注册表（不是英文枚举、不是散落字面量）
- [ ] `?audit=layout`：受影响屏的**常驻横带数 ≤3**、无新增越界（`首元素 y` 的既有越界等批 C4）
- [ ] 双端 typecheck 0 错；`lint` 0；本批相关守卫全绿；`build:workbench` 通过
- [ ] **四条红线逐条过**（规格书 §2）

---

## 6. 端到端检查（本批非收尾批）

1. 八屏逐屏打开：**导航不重名**、面包屑可切换、**能力入口一个不少**（新建批次 / 任务列表 / 导入 / 交付 / 回收站按 D1 落位）；
2. 刷新一次：导航与选中态全部还原（唯一事实）；
3. 检查器：计划 / 生成历史两页签在批次上可用。

---

## 7. 开放项销账

| 项 | 本批处置 |
|---|---|
| 界面宪法 §2 F3「入口重复」 | B1/B2/B3 |
| 界面宪法 §2 F8「部分/UNKNOWN」中与本批相关的两类 | B1（rail 状态卡）、B4（计划/历史进检查器） |
| §0.5 迁移清单里的 `workspace-context-select` | B2（合到期） |
| 「布局词进术语单 + 手册快捷键表」 | **不做**（刀哥已定：批 C） |
| 审计发现的 `首元素 y` 越界 | **不做**（批 C4 底栏贴底） |

---

## 8. 实施日志

### 2026-09-19 · 施工单编制完成（未开工）

- 编制依据：界面宪法 §8.2 批 B、§5.1–§5.3、§4 S7、§3.1；批 A 实施日志（`0b8f86b`）。
- **核对到的现状**：`workbench-breadcrumb` 的 CSS 已存在但**没有渲染**（B2 从零建）；上下文条有 5 个页签
  （计划 / 生成历史 / 资产管理 / 创作平台 / 批次对比）；rail 现有**两张**状态卡（生成服务 = `rail-status-card`、
  运行状态 = `rail-status-details`）；`VIEW_LAYOUTS` 已在（A 组），缺的是 `label`。
- **未开工**，无实测偏差。

### 2026-09-19 · **批 B 实施日志**

**B1 · rail 三区 + 一张状态卡**
- 三区各有稳定钩子：`data-region="rail-workspace" / "rail-library" / "rail-status"`（G15 盯住）。
- 两张卡（`ProviderStatusCard` + `RuntimeStatusCard`）合并为 `UnifiedStatusCard`：**一行结论**按「谁在挡路」排
  （运行异常 > 生成服务未配置 > 配置热加载 > 限流/退避 > 一切正常）+ 点开两条明细 + 卡底**疑难处理**入口。
- **两处能力没有丢**（自查抓到）：① 重写时漏掉的「安全重启」补回（只在 `repairable` 时出现）；
  ② provider 的**限流/退避结论**改用 `providerRuntimeNotice` 落到这一张卡（S7 的唯一常显位置）。
- 死代码删除：旧的 `ProviderStatusCard` / `RuntimeStatusCard` 与 `.rail-system-panel` 结构退场
  （CSS 里的旧类留到批 E 一起清）。

**B2 · 顶栏面包屑替换上下文条**
- `WorkspaceContextBar` 降级为**只有面包屑**（保留函数名与 `data-region="header"`，审计依赖不变）。
- 三段（项目 › 任务 › 批次）用 `<details>` 实现「**只读路径 + 点开切换**」：summary 显示当前值，菜单里是候选。
  项目段需要项目列表 → 新增 `projects` 与 `onSwitchProject` 两个 props（main 侧接上 `selectProject`）。
- **不放动作**：删掉 `context-create-round`（新建批次）、`context-task-list`（任务列表）、以及 5 个页签；
  `SessionPlanSummary`（会话语境）作为**状态**留在顶栏右侧（D1）。
- 旧断言迁移：`workbench-bulk-ui` 五条（签名、select→面包屑、页签→rail 不变量）。

**B3 · 动作按 D1 落位**
- **新建批次** → 画布工具条新增 `.lineage-new-round`（空白双击是第二条路，第 3 批 G2 已有）；
- **任务列表** → rail 工作区内的 `.rail-sub-entry`（有项目时出现，`aria-current` 跟随）；
- **会话语境恢复** → 顶栏右侧（状态性入口）。
- G10 双保险：页签块整体退场（`task-local-tabs` 在 DOM 里为 0），rail 四个一级入口 + 资料区入口**一个不少**。

**B4 · 计划 / 生成历史进检查器**
- 批次检查器加两页签，**默认停在「计划」**（确认闸门不许藏在第二下点击后面）；
- 生成历史页签是**就地**的运行列表（计划版本 + 人话状态），并保留「打开完整生成历史」——完整视图有分页/筛选/详情，
  那是能力不是入口重复。
- 实测抓到两处自己的错并修掉：① `runs` 没从画布传给检查器（面板假显「没有运行记录」）；
  ② `statusPresentation` 参数顺序写反（状态显示成了 `run` 字面量）。
- 旧断言迁移：`lineage-inspector` 的 PlanActions 窗口（240→1200 字符）+ 新增「默认页签是计划」。

**B5 · 注册表补 `label`**：`VIEW_LABELS`（14 个 view 一句人话），G16 扩展断言一一对应且非英文枚举。

**验证**：`lint` 0；`build:workbench` 通过；**全套 875 项 → 873 通过 / 0 失败 / 2 跳过**（新增 9 条批 B 断言）。
**浏览器实测**（1600×950，lineage）：面包屑 `项目 · DoD 验收测试 / 任务 · DoD 验收任务 / 批次 · 计划 v2` 三段可点、
批次菜单 3 项；`.workspace-context-select` 与 `.task-local-tabs` 均为 **0**；rail 三区、**状态卡 1 张**、
任务列表入口与画布「新建批次」都在；检查器两页签可用、生成历史显示「计划 v2 | 已完成」+ 完整视图入口。

**未做完 / 留给后续**：新旧类并存（`.workspace-context-select` 等旧 CSS 已成死代码）→ **批 E** 一起清；
`首元素 y` 越界仍是 **C4** 的账（本批不动底栏）。

## 决策点（2026-09-19 刀哥已拍板：全部按建议）

| # | 决策 | 决议（2026-09-19） |
|---|---|---|
| **D1** | 上下文条去重后，条上动作的落点 | **新建批次** → 画布工具条 + 空白双击（第 3 批 G2 已有）；**任务列表** → rail「项目管理」区内；**会话语境恢复** → 顶栏运行指示点旁（有可恢复语境时才出现，属**状态**不属导航）。三条都保持「能力不删」 |
| **D2** | 状态卡合并后运行状态的展开内容 | 卡内两条明细（生成服务 / 运行状态）各一行结论，点开同一张卡的折叠区；**疑难入口固定在这张卡底部** |

## 桩的接口约定（实现须同名同形）

| 桩 | 新增/扩展 | 接口 / 钩子 |
|---|---|---|
| G10 | 新增 `navigation-dedup.test.js` | 旧上下文条页签块（`task-local-tabs`）**不得再含导航项**；rail 与页签无同名目的地 |
| G14 | 新增 `shell-breadcrumb.test.js` | `data-region="breadcrumb"` + 三段（项目/任务/批次）；**块内无 `command-button`、无「新建」**（顶栏不放动作） |
| G15 | 新增 `rail-sections.test.js` | `data-region="rail-workspace" / "rail-library" / "rail-status"`；**状态区只有一张卡**；rail 消费 `providerRuntimeNotice` |
| G16 | 扩展 `view-registry.test.js` | `VIEW_LABELS` 与 `WORKBENCH_VIEWS` 一一对应；值非空且非英文枚举 |


| # | 决策 | 建议 |
|---|---|---|
| **D1** | 上下文条去重后，条上那几个**动作**落哪：`新建批次`（现 `context-create-round`）、`任务列表`（现 `context-task-list`）、会话语境恢复（`SessionPlanSummary`/`restoreSessionContext`） | **新建批次**：画布工具条 + 空白双击（第 3 批 G2 已有）；**任务列表**：rail 的「项目管理」区内（与项目壳两页签一致）；**会话语境恢复**：并入**顶栏**的运行指示点旁（只在有可恢复语境时出现，仍不放动作类——「恢复」是状态不是导航）。三条都保持「能力不删」 |
| **D2** | 状态卡合并后，**运行状态**的展开内容放哪 | 卡内两条明细（生成服务 / 运行状态）各一行结论，点开同一张卡的折叠区；**疑难处理**入口固定在这张卡底部（与 rail 资料区不重复） |
