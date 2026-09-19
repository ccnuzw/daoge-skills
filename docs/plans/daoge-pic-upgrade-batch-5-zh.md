# daoge-pic 以人为本升级 · 第 5 批施工单

> **本文件在套装中的位置**：方案文档（宪法）定「为什么改、改成什么」；规格书（`daoge-pic-upgrade-spec-zh.md`）定「跨批次不变的规矩」；
> **本文件 = 行政命令**，定「这一批做什么」。**施工单不得违背规格书；规格书不得违背方案。**
>
> **本批的界面依据不是宪法，而是界面宪法**：`studio-interface-layout-plan-zh.md`（全站界面标准与布局规范，v2）。
> 该文件第 11 节的 D1–D7 已于 2026-09-19 全部拍板，本批是其**第 8.2 节「批 A · 底座」**的落地。
>
> **本批是否触发规格书改动：否**——纯前端；四条红线（事实源 / 鉴权 / 确认闸门 / 能力不删）、schema、协议、API 全部不动。

---

## 进度快照（**每次做完一组就在这里更新一行；换会话时先读这一节**）

| 日期 | 进度 | 下一步 |
|---|---|---|
| 2026-09-19 | **施工单编制完成（未开工）**。前置 = 第 4 批收束（第 4 批仍在改 `web/src/main.jsx`，本批会与它撞车）；决策 D1–D7 已按建议拍板 | 第 4 批收束并推送后，写 0.3 守卫桩并确认红 |
| 2026-09-19 | **前置已满足**：第 4 批已收束并推送（`ec3d220`，工作区干净）；界面方案同日两轮审计（数字对账 + **以人为本专项**，见方案 §12），本单 §0.1/§0.3/§0.5/§0.6/§8 已同步（迁移面 21→29 处、G11 前置改批 C、新增「不许弄坏的八条交互」） | 写 0.3 的 7 个守卫桩并确认红 |
| 2026-09-19 | **0.3 守卫桩写完并确认红**：6 个新文件 + `view-registry` 扩 1 条 = **13 条断言，12 红 1 绿**（绿的是**有意锁住的不变量**：class 字面量「只减不增」的棘轮当下正好等于基线 29 处）。`lint` 0 error。见第 8 节日志 | 按 A1→A7 动代码（先 A1 token + A2 PageFrame） |
| 2026-09-19 | **A4 完成（状态槽收敛）** ✅ 新增 `status-slot-model.mjs`（优先级写死，G4 3/3）+ `StatusSlot.jsx`；7 条状态条收进 items，**同一时刻只显示一条**、其余折叠并**点名**。实测：无状态条→无槽；provider 全挂时 alert 在台前；同时有第二条时「还有 1 条 · 连接异常」且 alert 仍在台前。见第 8 节日志 | A5 断点收敛 |
| 2026-09-19 | **A3b 完成（逐屏页头）** ✅ 11 屏的页面级页头换成 `PageHeader`（`PageToolbar` 归位）：projects / project-overview / tasks / assets / trash / deliveries / prompts / studio-overview / library / shared-assets / guide / troubleshoot（含 `PageHeader` 新增 `kicker` 槽，**原 eyebrow 文案一条不丢**）。**实测 12 屏：标题 20px、页头 56–82px（≤88）、无文档溢出**；lineage / runs 无页面级页头（其形态属 B2/C1/C3）。**全套 866 项 → 864 通过 / 0 失败 / 2 跳过** | 收尾（typecheck/lint/回归/build/审计证据入档） |
| 2026-09-19 | 🎉 **A 组桩全部转绿**：A1 / A2 / A3a / A4 / A5 / A6 / A7（钩子与棘轮）完成，**全套 866 项 → 864 通过 / 0 失败 / 2 跳过**。A5 连带迁移 2 处钉着旧断点的断言（`lineage-inspector`、`phase4-navigation-registry` 的 800→900）。**A 组只剩 A3b（逐屏页头换 `PageHeader`/`PageToolbar`）** | 做 A3b → 收尾（typecheck/lint/回归/build/证据入档） |
| 2026-09-19 | **A5 完成（断点收敛 13→3）** ✅ 按 §4.1 映射把 68 个 `@media` 块的宽度值并到 **640 / 900 / 1280**（`min-width:801→901` 属 900 档）。G2 两绿。实测：1440/1180/960/860/640/600 六档 × 4 屏，**同宽度下各屏形态一致、无横向溢出**（画布屏的 `scrollWidth>clientWidth` 是画布固有的裁剪，`overflow:hidden`，非回归）。见第 8 节日志 | **A3b 页头**（A 组仅剩它）或收尾 |
| 2026-09-19 | **A6 完成（布局体检可测）** ✅ 新增 `layout-audit.mjs`（纯模型，G5 3/3）+ `LayoutAuditOverlay.jsx`（仅 `?audit=layout` 挂载）+ 区域标记（`header`/`bottom`/`status`/`page`）。实测：带参数出面板与一行控制台证据、不带参数**零 DOM**。**立刻量出真问题：三档的「首元素 y」全部越界（353/389px）**——队列常驻在内容之上把画布推下去（F0/F2 的账，第一次有了数字）。见第 8 节日志 | A4 状态槽收敛 |
| 2026-09-19 | **A3a 完成（容器与宽度统一）** ✅ 14 个 view 全在 `viewRenderers` 这一唯一入口被 `PageFrame` 包住；`VIEW_LAYOUTS` 注册表落地（G12 绿）；CSS 撤掉 10 处页面容器的 `max-width`/`margin auto`（含 `.run-stage` 的 960 覆盖）。**G1 两绿、G13 两绿**。浏览器实测 14 屏：档位正确、**零横向溢出**；1920 宽下 lineage/runs 1516、assets 1180、guide 820 ✓。**A3b（逐屏页头换 `PageHeader`/`PageToolbar`）待做**。见第 8 节日志 | A3b 或 A4/A6 |
| 2026-09-19 | **A2 完成（PageFrame 三件套）** ✅ 新增 `templates/PageFrame.jsx`（`data-region="page"` + `data-layout`、三档兜底 default=standard）、`components/PageHeader.jsx`（不放导航）、`components/PageToolbar.jsx`（只回答「怎么看」）、`styles/templates.css`（宽度只来自 token）。G1 第 1 条转绿、第 2 条**真红**（7 个容器仍自写宽度，A3 收）。**顺手抓到一条假绿**：G1 第 2 条原用 `readFrontendSource()` 查 CSS，而那条口径不含样式表 → 断言永真；已改 `readStyles()`。见第 8 节日志 | A3 八屏迁入 PageFrame |
| 2026-09-19 | **A1 完成（token + 分层汇聚）** ✅ `tokens/tokens.css`（S4 全量）+ `tokens/literal-baseline.json`（棘轮基线）+ `styles.css` 改汇聚入口；既有 1503 行规则**逐字搬进** `styles/base.css`(9 行) 与 `styles/surfaces/workbench.css`(其余)。G3 三绿。**浏览器实测**：规则数 1971（与开工前一致）、尾部规则生效、关键计算样式不变。见第 8 节日志 | A2 `PageFrame` 三件套 |

> **本批不做**（留给后续批次，别顺手做）：
> **批 B 的导航去重**（rail 三区重排、面包屑替换上下文条、页签移入检查器）、**批 C 的创作平台 chrome 收敛**（四条 chrome 收成一条、队列贴底、`Aside` 统一）、**批 D 的三面归位**、**批 E 的拆分与 CSS 分块**。
> 本批只做「底座 + 可见的一致性」，**不改任何业务流程与交互语义**。

---

## 0. 前置

### 0.0 本批的性质

- **纯前端**：只改 `web/src/**`、`tests/vnext/**`、`docs/plans/**`；不碰 `src/vnext/**`（除测试夹具需要时）。
- **不是收尾批**：不跑规格书 §8 完整 DoD；只跑落在本批的条目（见第 6 节）。
- **行为零变化**：本批的可见变化只有「版式一致性」与「状态条只显一条」。任何功能入口、跳转、数据流、文案语义**不得改变**；发现必须改行为才能做完的，停下来记进第 8 节，按方案 §9.3 走标准变更。
- **与第 4 批互斥**：第 4 批未推送前不开工（`main.jsx` 是共同热点）。

### 0.1 本批会破坏的守卫（**先写桩，再动代码**）

按规格书 §3.1 铁律 2：先列破坏面，桩先红，再动代码。

| 守卫 | 为什么会被破坏 | 处置 |
|---|---|---|
| `provider-runtime-state.test.js` | 断言 `className="provider-outage-strip"`；A4 把这条并进 `StatusSlot` | 断言迁到钩子 `data-region="status"` + `data-tone`（G13） |
| `asset-backstage.test.js` | 断言 `className="asset-backstage-note"`（第 3 批 H1 加的）；A3 换外层容器时会触及 | 属**组件内部**呈现：容器换了它仍在 → 预期不改；若失败按钩子迁移 |
| `workbench-bulk-ui.test.js` | 10 处 class 断言，其中 `className="error-strip"` 属状态位；其余 `asset-action-*` / `selection-item*` / `lineage-mode-panel` 会被 A3 的容器替换影响 | 逐条迁移：属于状态位的走钩子；属于组件内部的保留在组件自己的测试里 |
| `asset-card-layout.test.js` | 9 处 class 断言（`project-index-list` / `asset-select-control` / `asset-card-tools` / `asset-view-*` / `inspector-image-frame`） | A3 只换**外层容器**，组件内部 class 不动 → 预期不改；若因容器替换而失败，按钩子迁移 |
| `phase4-navigation-registry.test.js` | 断言 `const viewRenderers = {`、`const renderActiveView = viewRenderers[routeView]`、`const mainItems = [`、四个一级入口 label | A3 保留 `viewRenderers` 结构（拆分在批 E），本批**预期不改** |
| `source-text-guard.test.js` | 前端源码文本级断言 | 逐条核对；被 A2/A3 触及的断言按钩子迁移 |
| `web-typecheck.test.js` | 新增文件必须过 `tsconfig.web.json`（第 1 档 0 错） | 新增文件必须类型清白 |

### 0.2 本批会触及、需逐条复核的守卫（规格书 §3.2 的「其余按批核对」）

`terminology-guard.test.js`（若页头说明文案改动）、`view-registry.test.js`（新增 `layout` 维度，**只加不删**）、`workbench-route.test.js`（**预期不改**：路由字段与归一化不动）、`delivery-page-render.test.js`、`creator-delivery-ui.test.js`（预期不改，批 D 才动）、`build-isolation.test.js`、`workbench-performance.test.js`。

### 0.3 新增守卫桩（本批必须新建，**先写成 fail**）

| # | 桩文件 | 断言（写成 fail 后再实现） |
|---|---|---|
| **G1** | `tests/vnext/layout-page-frame.test.js` | `views/`（本批为 `main.jsx` 的各 view 段）不得出现 `max-width:`；每屏最外层携带 `data-region="page"` 与 `data-layout` |
| **G2** | `tests/vnext/layout-breakpoints.test.js` | `styles.css` + 其分层文件里的 `@media` 只允许 `1280 / 900 / 640 / prefers-reduced-motion`；**基线清单外的新文件零例外** |
| **G3** | `tests/vnext/layout-tokens.test.js` | `tokens/` 存在且包含 S4 规定的 token 名；**基线清单之外**的 CSS 不得出现裸 hex/rgba（基线清单每批只减不增） |
| **G4** | `tests/vnext/layout-slot.test.js` | shell 内状态位渲染点唯一；`views/` 内不得出现全宽状态条类 |
| **G5** | `tests/vnext/layout-audit-model.test.js` | 预算纯函数：给定各区高度返回 `主区占比 / 顶部 chrome / 首元素 y / 越界标记`；阈值取方案 §11 D6 的三档表 |
| **G12 扩展** | `tests/vnext/view-registry.test.js`（既有文件） | 每个 view 在注册表里声明合法 `layout` 档位，且与 `PageFrame` 实际使用的档一致 |
| **G13** | `tests/vnext/structure-hook.test.js` | 每个 view 根元素带 `data-region="page"`；**新增测试文件不得出现 `className="…"` 字面量断言**（既有断言按 §0.1 迁移，迁移进度记在第 8 节） |
| **G11 扩展** | — | **本批不做**（刀哥 2026-09-19 定）：布局词进术语单 + 快捷键进手册表属 **批 C**（两条前置也在批 C 建） |

### 0.5 G13 迁移清单（29 处，随本批交付）

口径：`className="…"` 字面量断言按**用途**分三类，**不是一律迁**——迁错了反而把「组件内部结构」变成公共契约。

| 类 | 处理 | 处数 |
|---|---|---|
| **迁钩子**（状态位 / 页面容器 / 将被替换的外壳） | A3/A4 落地时同批改成 `data-region` / `data-tone` / `data-action` | **4** |
| **保留在组件内**（组件自己的结构，是它的实现细节） | 不动；将来组件重构时随组件测试一起改 | **20** |
| **保留为删除守卫**（`assert.doesNotMatch`，防旧类复活） | **永不迁**：它断言的是「那个东西不存在」，钩子表达不了这个意思 | **5** |
| 合计 | 4 + 20 + 5 | **29** |

**必须迁的 4 处（本批 A3/A4 完成时同步改）**：

| # | 位置 | 现状断言 | 迁到 |
|---|---|---|---|
| 1 | `provider-runtime-state.test.js:142` | `className="provider-outage-strip"` | `data-region="status"` + `data-tone="provider-outage"`（A4 收敛进 `StatusSlot`） |
| 2 | `workbench-bulk-ui.test.js:427` | `className="error-strip" role="alert" aria-live="assertive"` | `data-region="status"` + `data-tone="error"`，**`role`/`aria-live` 断言原样保留** |
| 3 | `workbench-bulk-ui.test.js:21` | `className="workspace-context-select workspace-context-task"` | 随 **B2** 面包屑替换一起重写（本批可先不动，登记为跨批项） |
| 4 | `local-auth-workbench.test.js:64` | `className="local-auth-failure"` | `data-region="gate"`（L6 鉴权门，是外壳级区域） |

**保留在组件内的 20 处**（分文件，合计 9+5+3+1+1+1 = 20）：`asset-card-layout` 9（`asset-select-control` / `asset-card-tools` /
`asset-view-options` / `asset-view-current` / `asset-grid` / `inspector-image-frame` / `project-index-list` /
`asset-action-menu` / legend 的 `className={className}`）、`workbench-bulk-ui` 5（`asset-import-button` ×2 /
`selection-item` / `selection-item-copy` / `asset-action-menu`）、`terminology-guard` 3（`confirmation-dialog-note` /
`provider-glossary-panel` / `provider-profile-panel`）、`creator-delivery-ui` 1、`lineage-menu` 1、`asset-backstage` 1。

> ⚠️ **一处例外要写进 G13 的注释**：`asset-backstage-note`（第 3 批加的）是**页面级说明条**，
> 若批 D 把它并入 `PageHeader.description`，这条断言随批 D 一起迁（不是本批）。

**保留为删除守卫的 5 处**：`task-more-tabs`（`workbench-bulk-ui:28`）、`asset-action-group`（`:275`）、
`lineage-mode-panel`（`:408`）、`connection-state`（`phase4-navigation-registry:71`）、
`provider-model-fetch`（`provider-settings-ui:17`）。

### 0.6 不许弄坏的交互（对齐界面方案 §3.1，2026-09-19 创作者的八条判据）

本批虽然「行为零变化」，但 **A3 换外层容器、A4 收敛状态条** 会碰到交互——以下八条是**红线**，
每条在 §0.3 之外**不新建守卫**（它们由批 B/C/D 的验收销账），但**本批实测必须逐条确认没坏**：

| # | 判据 | 批 A 的具体风险点 | 实测怎么做 |
|---|---|---|---|
| I1 | 选中 + 说一句能同时成立 | A3 换容器时不要把 composer 挪进任何「条件渲染」 | 选一张图后，输入框仍在且可发送 |
| I2 | 挑完就地接下一步 | A3 只换外层，**放大层/选片条/资产卡的「继续」保留** | 放大一张图，能看到「用这张继续」 |
| I3 | 已出的图立即可用 | A3/A4 不许给画布加遮挡层 | 出图中已出的图可点选、可评审 |
| I4 | 选中是一切动作的前提 | A3 不许把浮条收进工具条 | 选中节点 → 浮条出现 |
| I5 | 控制就地 | A3 不许把批次级运行控制挪进检查器 | 批次节点上仍有暂停/取消/重试入口 |
| I7 | 出完了叫我 | A4 的状态槽别把「未读完成」吞了（它在标题+顶栏，不属状态槽） | 标题计数仍在 |
| I8 | 卡片的四种形态可就地读完、追问就地答 | A4 收敛时卡片区不动 | 卡片仍能内联回答 |
| — | **alert 级不折叠** | A4 把 `provider-outage` 折进「还有 N 条」就错了（S7） | 同时触发两条时，alert 级那条仍在最上且 assertive |

> 判据全文与出处见 `studio-interface-layout-plan-zh.md` §3.1 与 §12 的专项审计记录。

### 0.4 环境与影响提示

- **只影响 Workbench 产物**：改完跑 `npm run build:workbench`，daemon 无需重启（它按工作区服务静态 bundle）。**日用环境会立刻看到新布局**——建议先在隔离 workspace 验证一遍再同步，做法沿用规格书 §5。
- **本批不跑**全量 `npm test`（收尾才跑）；开发期只跑本批相关测试，避免中途互相阻塞。
- 构建基线：`build:vnext` 不需要重跑（本批不动 `src/vnext`）；`typecheck:web` 必须过。

---

## 1. 目标（可验收的一句话）

**八屏共用一套骨架与一套 token**——同样的页头结构、同样的宽度档、同样的状态位；并且 `?audit=layout` 能对每一屏给出四个数字（主区占比 / 顶部 chrome / 首元素 y / 常驻横带数），让「上半屏占太多」第一次变成可测事实。

---

## 2. 任务分解

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **A1** | **token 落地** | 新增 `web/src/tokens/tokens.css`；`web/src/styles.css` 改为 `@import` 汇聚入口 | 按 S4 落 30 个颜色 / 8 档字号 / 6 档间距 / 4 档圆角 / 3 档阴影 / 4 层 z-index；**深面颜色只在 rail 作用域**；建立「字面量基线清单」文件（记录当前仍含字面量的文件，每批只减不增） | 方案 §4 S4、§11 D5 |
| **A2** | **`PageFrame` 三件套** | 新增 `web/src/templates/PageFrame.jsx`、`web/src/components/PageHeader.jsx`、`web/src/components/PageToolbar.jsx` | 接口：`layout: 'wide'\|'standard'\|'narrow'` + `title/description/actions/toolbar`；`PageFrame` 负责宽度、内边距、`data-layout` 钩子；页面不得再自定宽度 | 方案 §5.4 |
| **A3** | **八屏迁入 `PageFrame`** | `web/src/main.jsx`（各 view 渲染段）、`creative-lineage-canvas.jsx`、`creative-delivery.jsx`、`shared-assets.jsx`、`creative-library.jsx`、`learning-center.jsx`、`troubleshoot.jsx` | 逐屏把 `.asset-stage` / `.run-stage` / `.prompt-stage` / `.guide-stage` / `.project-*-stage` / `.lineage-stage` / `.creator-delivery` / `.shared-assets-stage` / `.creative-library` 的外层容器换成 `PageFrame`；**顺带清掉 `.run-stage` 的同文件三次宽度改写**（`styles.css:32/33/839`）；组件内部 class 一律不动 | 方案 §2 F1、§4 S3 |
| **A4** | **`StatusSlot` 收敛** | 新增 `web/src/status-slot-model.mjs` + `web/src/components/StatusSlot.jsx`；改 `main.jsx:3291-3297` 一带的 7 条条件条 | 优先级 `runtime-danger > provider-outage > connection-error > request-error > cancel-undo > notice`；只渲染一条，其余折叠为「还有 N 条」；`danger` 永不折叠；撤销条并入本槽；provider 退避常显位置收为 rail 状态卡一处 | 方案 §4 S7、§5.1 |
| **A5** | **断点收敛** | `web/src/styles.css`（全表） | 按第 4 节映射表把 65 个宽度断点块并入 3 档；每个被删断点在实施日志里逐条登记 | 方案 §4 S6、§11 D3 |
| **A6** | **审计覆盖层 `?audit=layout`** | 新增 `web/src/layout-audit.mjs`（纯函数）+ 挂载点（`main.jsx`）；`data-region` 打点 | 计算并显示四个数字；控制台输出一行可复制数字串；越界标红；**只在带查询参数时生效**，生产默认零开销 | 方案 §8.1、§11 D6 |
| **A7** | **结构钩子与断言迁移** | `main.jsx`（各 view 根元素）、`tests/vnext/*`（见 §0.1） | 每个 view 根元素加 `data-region="page"`；`PageFrame` 带 `data-layout`；把 §0.1 里属于状态位/容器的 class 断言迁到钩子；**组件内部断言保留**（不要为了迁而迁） | 方案 §6.3、§8.3 G13 |

---

## 3. 守卫变更（汇总）

| 类型 | 项 |
|---|---|
| **新增** | G1 `layout-page-frame`、G2 `layout-breakpoints`、G3 `layout-tokens`、G4 `layout-slot`、G5 `layout-audit-model`、G13 `structure-hook` |
| **修改** | G12（`view-registry.test.js` 增加 `layout` 断言）、`provider-runtime-state.test.js`、`workbench-bulk-ui.test.js`（class 断言 → 钩子） |
| **保留（本批必须仍绿）** | `workbench-route.test.js`、`phase4-navigation-registry.test.js`、`route-authorization.test.js`、`studio-scope.test.js`、`delivery-studio-scope-api.test.js`、`protocol-contract.test.js`、`cli-contract.test.js` |

---

## 4. 迁移或切换步骤

### 4.1 断点映射（唯一一次，之后只许用新档）

| 旧断点 | 块数 | 去向 |
|---|---|---|
| 420 / 560 / 640 | 1 + 20 + 2 = **23** | **640** |
| 700 / 720 / 760 / 800 / 900 / 920 / 960 | 4 + 8 + 1 + 10 + 10 + 2 + 2 = **37** | **900** |
| 1100 / 1300 | 3 + 1 = **4** | **1280** |
| `min-width: 801px` | 1 | `min-width: 901px` |
| `prefers-reduced-motion` | 3 | 不变（保留） |

**行为变化必须知情**：合并后，`768–800px` 宽的窗口会提前进入「rail 变顶部横条」的形态；`901–960px` 会提前使用「900 档」的紧凑规则；`1101–1300px` 会提前使用「1280 档」。这是 D3 的代价，逐条登记在第 8 节。

### 4.2 宽度三档落地

`--page-max-wide: 1680px` / `--page-max-standard: 1180px` / `--page-max-narrow: 820px`；由 `PageFrame` 消费；`view` 注册表新增 `layout` 字段作为唯一来源。

### 4.3 无 schema 迁移、无 API 变更、无协议变更

本批不动 `src/vnext/**`、不动 `SKILL.md`、不动协议版本号。

---

## 5. 验收清单（**每条对应一个可见现象**）

- [ ] **A1** `web/src/tokens/tokens.css` 存在；`styles.css` 以 `@import` 汇聚；构建后产物样式完整（无变量未定义）
- [ ] **A2** 任一屏的页头高度 ≤88px（工作台面 ≤56px），且标题字号为 20（不再是 34 的常驻 hero）
- [ ] **A3** 项目管理 / 任务 / 资产 / 交付 / 资料五屏的**页头结构、左右边距、内容宽度肉眼一致**；`.run-stage` 的三次宽度定义只剩一处
- [ ] **A4** 同时触发「运行异常」与一条普通通知时，**首屏只看到一条**；另一条折叠在「还有 1 条」里；运行危险级永不折叠
- [ ] **A5** `styles.css` 中 `@media` 只剩 `640 / 900 / 1280 / prefers-reduced-motion`；被删断点清单与映射表逐条对得上
- [ ] **A6** 打开 `?audit=layout`：四个数字可见；在项目管理页、资产页、交付页给出 **主区 ≥55%、顶部 chrome ≤200px、首元素 y ≤210px、常驻横带 ≤3**；不带参数时页面上查不到任何审计 DOM
- [ ] **A7** 每个 view 根元素带 `data-region="page"`；G13 桩变绿；§0.1 列出的 class 断言已迁移（迁移清单记进第 8 节）
- [ ] **收尾** 双端 typecheck → `npm run lint` 0 error → 全套回归绿 → `npm run build:workbench` 成功；本批相关浏览器实测证据按方案 §8.4 格式入档

---

## 6. 端到端检查

本批**非收尾批**，不跑规格书 §8 完整 DoD。落在本批的检查：

1. 8 屏逐屏打开一次，确认无一屏出现「双滚动条」「页头缺失」「宽度越界」；
2. 视窗 1440 / 1180 / 960 / 860 / 640 各拖一遍，确认退化规则一致（同一宽度下所有屏形态相同）；
3. `?audit=layout` 在 8 屏各跑一次，数字入档（含反例检查）。

---

## 7. 开放项销账（从方案 §2 F8 摘与本批相关的）

| 项 | 本批处置 |
|---|---|
| 刷新/断网后状态还原（记 UNKNOWN） | **不在本批**：属行为项，随批 B/C 核对 |
| 可访问性逐项验收（记 UNKNOWN） | 本批只保证不倒退（G9 的 `:hover ⇒ :focus-visible` 在批 E 全量生效）；逐项验收随批 C/D |
| 「S1 预算可测」 | ✅ 本批新销：`?audit=layout` 上线后即为可测事实 |
| 「断点收敛」 | ✅ 本批新销：13 档 → 3 档 |
| 其余 F8 条目 | 全部随批 B / 批 C / 批 D 逐条销账（见方案 §8.2） |

---

## 8. 实施日志（实际偏差、踩的坑、需要回头改方案的发现）

### 2026-09-19 · 施工单编制完成（未开工）

- 编制依据：方案 `studio-interface-layout-plan-zh.md` v2 §8.2 批 A；D1–D7 已于同日拍板。
- 已核实但**尚未执行**的两处现状：
  - `web/src/styles.css` 现有 68 个 `@media` 块（13 个宽度断点 + reduced-motion），映射表见 §4.1；
  - `tests/vnext` 中 **10 个文件共 29 处** `className="…"` 字面量断言（审后复算：`workbench-bulk-ui` 10、`asset-card-layout` 9、
  `terminology-guard` 3、`provider-settings-ui` / `provider-runtime-state` / `phase4-navigation-registry` / `local-auth-workbench` / `lineage-menu` 各 1，其余为 0），是 G13 要收口的那一层。
  ⚠️ 原写「21 处」——第 3/4 批又添了几条（含 `provider-outage-strip`、`asset-backstage-note`），按 **29 处**执行。
- **待办**：第 4 批收束 → 写 §0.3 的 7 个守卫桩 → 确认红 → 按 A1→A7 动代码。

---

### 2026-09-19 · **0.3 守卫桩写完并确认红**（13 条断言，12 红 1 绿）

| 桩 | 文件 | 断言 | 结果 | 红的原因 |
|---|---|---|---|---|
| G1 | `layout-page-frame.test.js` | PageFrame 存在 + `data-region="page"`/`data-layout`；页面容器不再自写 max-width | 2 红 | `web/src/templates/PageFrame.jsx` 不存在 |
| G2 | `layout-breakpoints.test.js` | 断点只允许 640/900/1280；归一 `(max-width:800px)`；三档真被使用 | 2 红 | 现存 13 档（420/560/640/700/720/760/800/900/920/960/1100/1300/801min） |
| G3 | `layout-tokens.test.js` | `tokens.css` 含 S4 token；字面量基线只减不增；`styles.css` 改 `@import` 分层 | 3 红 | tokens 与基线都不存在、styles.css 仍是巨石 |
| G4 | `layout-slot.test.js` | `status-slot-model.mjs`（优先级写死）+ `StatusSlot.jsx` + `data-region="status"` | 2 红 | 模型与组件都不存在 |
| G5 | `layout-audit-model.test.js` | `layout-audit.mjs` 的三档预算、底部槽口径、未知 kind 报错 | 3 红 | 模型不存在 |
| G12 扩展 | `view-registry.test.js`（扩 1 条） | 每个 view 声明 `layout`（wide/standard/narrow），与 `WORKBENCH_VIEWS` 一一对应 | 1 红 | `VIEW_LAYOUTS` 不存在 |
| G13 | `structure-hook.test.js` | view 根元素 `data-region="page"`；class 字面量只减不增 | **1 红 1 绿** | 红＝钩子还没加；绿＝棘轮当下正好 29（有意锁住） |

**口径说明（写进守卫注释，防以后互掐）**：G13 的计数口径是「**含 `className=` 的行数**」，
与 §0.5 的 29 处同口径；守卫文件自身必须提到这个词，已显式排除在扫描之外。

**现状盘点（开工前）**：14 个 view（projects / project-overview / lineage / assets / tasks / studio-overview /
prompts / runs / guide / library / shared-assets / deliveries / trash / troubleshoot）；
样式仍是单文件 `styles.css`（1512 行 / 1157 六位色值 / 68 `@media`）。

**下一步**：A1（token + 分层汇聚）→ A2（PageFrame 三件套）→ A3（八屏迁入）→ A4（状态槽）→ A5（断点收敛）→ A6（审计层）→ A7（钩子与迁移）。

### 2026-09-19 · **A1 完成：token + 分层汇聚**

**产物**：
- 新增 `web/src/tokens/tokens.css`：S4 全量 token（30 色 / 8 档字号 / 6 档间距 / 4 档圆角 / 3 档阴影 / 4 层 z / 动效 / 三档页宽）。
  **取值原则**：颜色取**现网最高频真实值**（如 `--surface-card:#fffef9`、`--accent:#456e53`），
  这样后续替换是「直替」不是「重设计」——本批只统一、不换向（D5）。深面（rail）变量只在 `.studio-rail` 作用域。
- 新增 `web/src/tokens/literal-baseline.json`：字面量**棘轮基线**（口径＝六位色值出现次数）。
  `base.css: 8` / `surfaces/workbench.css: 1887`；**只减不增**，由 G3 盯着。
- `web/src/styles.css` 从巨石改为**汇聚入口**：`tokens → base → surfaces/workbench`（顺序即级联，不许调换）。

**切分方式（有意保守）**：前 9 行（`:root` / `*` / `body` / `button` / `:focus-visible` / loading-shell / `@keyframes spin`）
逐字搬进 `styles/base.css`，其余 1503 行逐字搬进 `styles/surfaces/workbench.css`。
**按块归属的进一步拆分（一个组件一个块、一个文件只选自己块内的类，G4）留给批 E**——本批只把「层」建起来。

**验证（三层，缺一不可）**：
1. **逐字不丢**：切分前后六位色值出现次数 **1895 = 1895**；
2. **构建不残留**：产物 CSS 里 `@import` **0 处**（Vite 已内联），构建通过、`lint` 0 error；
3. **浏览器实测**（真实 Chrome，1440×900）：样式表规则数 **1971**（与开工前盘点一致）、
   文件**尾部**规则生效（`.provider-outage-strip` 的 `border-left-width: 4px` —— 证明整表都在）、
   关键计算样式不变（品牌色 `rgb(244,241,233)`、画布底 `rgb(238,242,233)`、节点底 `rgb(251,252,248)`、
   composer 底 `rgb(251,252,246)` 与左边框 `rgb(61,107,76)`）。

**连带改动（共享层，必须记）**：样式分层动了**测试读样式的单一入口**，两处要一起搬：
1. `tests/vnext/source-text.js`：新增 `styleFiles()`（按真实层叠顺序：tokens → base → primitives → components → organisms → templates → surfaces，
   未知新层兜底追加）与 `webSourceExists()`（给「已规划但还没实现」的守卫做存在性判断）；
   **`readStyles()` 改为聚合全部层**——否则它只能看到入口那 3 行 `@import`，一批样式断言会**静默失效**
   （实测：`terminology-guard` 2 条、`phase4-navigation-registry` 3 条当场变红，正是这个原因）。
2. `lineage-inspector.test.js`：从「读 `web/src/styles.css` 单文件」改成 `readStyles()`（断言不变，只是跟着单一入口走）。
3. 本批 5 个新桩改用 `source-text` 的单一入口（`readSource` / `readStyles` / `webSourceExists`），
   **不再裸读 `web/src`**——`source-text-guard` 当场抓到过这个写法（它盯的就是「绕过收口」）。

**验证**：`lint` 0 error；**全量 866 项 → 853 通过 / 11 失败 / 2 跳过**，
`11 = 本批尚未实现的桩`（G1×2 / G2×2 / G4×2 / G5×3 / G12×1 / G13×1），其余全绿（含三处被连带修好的守卫）。

**偏差（如实记）**：`styles.css` 现在只剩 3 行 `@import`；`styles/base.css` 与 `surfaces/` 是新目录——
§6.2 的目标目录里 `styles/` 下应还有 `primitives/components/organisms/templates.css`，本批**不建空文件**，
等对应层真的被拆出来再建（空文件只会骗守卫）。

### 2026-09-19 · **A2 完成：PageFrame 三件套**

**产物**：
- `web/src/templates/PageFrame.jsx`：`layout: wide|standard|narrow`（非法值兜底 `standard`），渲染 `data-region="page"` 与 `data-layout`；
  可选 `title/description/actions/toolbar`；**页面不自定宽度、不自造页头、标题区不放导航**。
- `web/src/components/PageHeader.jsx`：一行「这是什么页」+ 最多两个页面级动作；`data-block="header"`。
- `web/src/components/PageToolbar.jsx`：`role="toolbar"` + `data-block="toolbar"`；**只放「怎么看」与页面级创建**，
  批量动作按 I4 去浮条（写在组件注释里，防以后顺手加回来）。
- `web/src/styles/templates.css`：**颜色/字号/间距只用 token**（0 字面量，不动棘轮基线）；
  宽度只来自 `--page-max-*`；页头/工具条高度按 S1 第 6 条写死；640 档退化。

**验证**：`lint` 0；`build:workbench` 通过且产物里能看到 `.page-frame.is-* { max-width: var(--page-max-*) }` 与 token 变量；
`source-text-guard` 5/5、`web-typecheck` 4/4、`terminology-guard` 17/17。
G1：第 1 条**转绿**（PageFrame 存在且钩子齐全），第 2 条**真红**——7 个页面容器仍自写宽度
（`run-stage` / `library-stage` / `overview-stage` / `guide-stage` / `project-tasks-stage` / `shared-assets-stage` / `lineage-stage`），属 A3 范围。

**⚠️ 顺手抓到一条「假绿」（值得记进纪律）**：G1 第 2 条原本用 `readFrontendSource()` 去查 CSS 里的 `max-width`——
但那条口径**明确不含样式表**（`source-text-guard` 里就断言了「样式表单独用 readStyles()」），
于是断言**永远为真**（空断言）。已改用 `readStyles()`，当场变成真红。
**教训与第 2 批「字符串断言 ≠ 行为正确」同型：口径选错，守卫就成了摆设。**

### 2026-09-19 · **A3a 完成：容器与宽度统一（A3 的前半）**

**做法（一次落在唯一入口，风险最低）**：在 `main.jsx` 的 `viewRenderers` 上包一层
`page(view, node) => <PageFrame layout={VIEW_LAYOUTS[view] || 'standard'}>`，
`VIEW_LAYOUTS` 落在 `workbench-navigation-model.mjs`（与「视图 → 宿主」同一处，G12 消费）。
**不动任何组件内部结构**——「行为零变化」只把「容器与宽度」交出去。

**宽度分档（S3）**：wide＝lineage / runs / studio-overview；standard＝projects / project-overview / tasks /
assets / trash / deliveries；narrow＝prompts / library / shared-assets / guide / troubleshoot。

**CSS 撤宽（10 处）**：`.asset-stage`/`.run-stage` 从 1560 组拆出；`.run-stage` 的 **960 覆盖**删除（F1 说的「三次改写」清零）；
`.overview-stage`（1560）、`.prompt-stage`/`.guide-stage`（1120）、`.project-*-stage`（1120）、
`.guide-stage-full`（1180）、`.library-stage`（1120）、`.lineage-stage`（1680）、`.creative-library`（1180）、
`.shared-assets-stage`（1180）、`.creator-delivery`（1180）——全部交给 `PageFrame`。
状态条类（`.error-strip` / `.surface-header` / `.view-switcher` / `.notice-strip` / `.runtime-health-banner` 等）**宽度不动**（A4 统一处理）。

**连带迁移的 4 处既有断言**（§0.1 预告过；全部是「扩展而非放宽」——绑定与 props 不变，只跟随 PageFrame 包裹）：
`delivery-page-render`（`deliveries`）、`workbench-bulk-ui`（`assets`）、
`creative-library-boundary`（`library` + `shared-assets`）、`workbench-generation-confirmation`（`prompts`）。

**验证**：
- 守卫：G1 **2/2**、G12 **4/4**、G13 **2/2**、G3 3/3；`phase4-navigation-registry` / `source-text-guard` /
  `terminology-guard` / `workbench-route` / `asset-card-layout` / `creator-delivery-ui` 全绿；
  `lint` 0；`build:workbench` 通过。
- **浏览器实测（1440×900，14 屏逐屏）**：全部有 `[data-region="page"]`、档位正确、**零横向溢出**。
- **浏览器实测（1920×1080）**：lineage/runs 宽 1516（可用宽）、assets 1180（standard 封顶）、guide 820（narrow 封顶），
  且**居中**（左右对称）——分档真的在起作用。
- 全量：**866 项 → 857 通过 / 7 失败 / 2 跳过**；`7 = 尚未实现的桩`（G2×2 / G4×2 / G5×3）。

**如实记（A3 未做完）**：本步只统一了**容器与宽度**。A3 验收里「**页头结构**肉眼一致」需要把 11 个组件各自的
页头（`asset-stage-head` / `learning-masthead` / `library-masthead` / `overview-head` / `project-*-head` /
`shared-assets-head` / `run-focus` …）换成 `PageHeader`/`PageToolbar`——记作 **A3b**，未做。

### 2026-09-19 · **A6 完成：布局体检（`?audit=layout`）**

**产物**：
- `web/src/layout-audit.mjs`（纯模型，G5 的判据）：D6 三档阈值、`内容占比 = (视口高 − 顶部 chrome − 底部槽) / 视口高`、
  **状态条在时 topChrome/firstElementY 各放宽 44px**（S1 第 2 条）、**展开态不设占比阈值**（S1 第 7 条，只看折叠态）、
  未知 kind 直接报错。另出 `layoutAuditLine()`——§8.4 证据格式那一行。
- `web/src/components/LayoutAuditOverlay.jsx`：量 `[data-region]` 各区高度（ResizeObserver + resize），
  右上角面板显示四个数字、越界标红；同一行打到控制台（**同值不重复打**，便于复制）。
  **只在带 `?audit=layout` 时挂载**——生产零开销（实测不带参数时 DOM 里查不到 `.layout-audit`）。
- 区域标记：上下文条 → `data-region="header"`；队列底栏 → `data-region="bottom"`；
  状态条区块包一层 `data-region="status"`（透明包裹，不改样式）；页面 → `data-region="page"`（PageFrame 自带）。

**⚠️ 一处桩自身的不自洽（顺手修正）**：G5 第 2 条原来的数据没算「状态条 +44px 放宽」，
导致「236px 在列表面算不算越界」自相矛盾。已按 S1 第 2 条改成：状态条在时阈值放宽 44px（236 ≤ 244 通过），
并把 workbench 那组数据调到真正越界（236 > 224）。

**实测（1440×900，三档各一屏）**：
| 屏 | 档 | 主区占比 | 顶部 chrome | 首元素 y | 横带 |
|---|---|---|---|---|---|
| projects | list | 77% | 0px | **353px ✗（限 210）** | 1 |
| lineage | workbench | 69% | 70px | **389px ✗（限 190）** | 1 |
| guide | reading | 77% | 0px | **353px ✗（限 240）** | 1 |

**这张表本身就是价值**：它第一次把「队列常驻在内容之上、把画布推下去」变成可测事实
（F0/F2 的账）——**修它的是 A3b/C4**（底栏贴底 + 页头收窄），不是本项的职责。
另注：`顶部 chrome` 目前只统计已打标的区域；画布内部那四条横条（工具条/条件条/筛选条/搜索条）
要等 **C1** 合并成一条并打 `data-region="toolbar"` 后才计入——**不假装现在就算准了**。

**验证**：`lint` 0；`build:workbench` 通过；G5 3/3；实测见上表（含反例：不带参数无面板）。

### 2026-09-19 · **A4 完成：状态槽（同一时刻只显示一条）**

- 新增 `web/src/status-slot-model.mjs`：`STATUS_PRIORITY`（S7 顺序写死）+ `statusSlotPlan(items)`。
  **`danger` 永不折叠是结构性保证**——`runtime-danger` 在优先级表最前，只要在场就必然是被显示的那条，
  不需要额外开关；其余折叠进「还有 N 条」并**在摘要里点名**（不静默）。
- 新增 `web/src/components/StatusSlot.jsx`：渲染 `[data-region="status"]`，primary + 折叠区。
- 接线：七条状态条（运行异常 / provider 全挂 / 连接异常 / 操作失败 / 刚才的位置没恢复 / 撤销取消 / 通知）
  收成 `statusItems`，**每条保留自己的 class 与 role**（外观与无障碍不变），谁在台前由槽决定。
- 连带迁移 3 处断言：`workbench-bulk-ui`（`contextError && …` → `content: <div className="error-strip" …`，
  意图不变：仍是 alert/assertive）、`layout-slot` G4 第二条（**不能 `require` `.jsx`**，改走 source-text 单一入口）、
  以及我的新 label 踩了术语单（「上下文没恢复」→ **「刚才的位置没恢复」**，术语守卫当场抓到）。

**实测（1440×900）**：无状态条时**没有**状态槽（零多余 DOM）；强制 provider 全挂 → 槽在、`data-tone=provider-outage`、台前是它；
再注入一次请求失败 → 台前仍是 provider 全挂（alert），折叠区显示 **「还有 1 条 · 连接异常」**、折叠项 1 个。

### 2026-09-19 · **A5 完成：断点收敛（13 档 → 3 档）**

- 按 §4.1 映射表改写全部 CSS 的宽度断点：`420/560/640 → 640`、`700/720/760/800/900/920/960 → 900`、
  `1100/1300 → 1280`、`min-width:801 → 901`（901 是 900 档的 min-width 写法，守卫认它）。
  改后全仓断点分布：**640×24 / 900×37 / 901×1 / 1280×4**（+ `prefers-reduced-motion` 3 处不变）。
- **行为变化如实记**（§4.1 预告的代价，D3 已拍板）：`768–800px` 提前进入紧凑形态；`901–960px` 提前用 900 档；
  `1101–1300px` 提前用 1280 档。
- **实测（六档 × 4 屏）**：同宽度下各屏形态**完全一致**（shell 列宽 + rail 宽同一组值）；
  无文档级横向溢出。画布屏在 ≤860 时 `scrollWidth > clientWidth` —— 那是**画布固有的裁剪**
  （`.work-surface` / `.lineage-canvas` 都是 `overflow:hidden`，画布靠平移看更远的节点），不是回归。

### 2026-09-19 · **A3b 完成：逐屏页头换成 `PageHeader`**

**做法**：每个有页面级页头的屏，把各自那套页头标记（`workspace-section-head` / `asset-stage-head` /
`learning-masthead` / `library-masthead` / `shared-assets-head` / `overview-head` / `project-overview-head` /
`prompt-stage-head` / 交付 flow 的 `<header>` / 疑难 playbook 头）换成 `<PageHeader kicker title description>`，
原来的按钮进 `header` 的 children（**动作一个不丢**）；资产页那排控件整体进 `<PageToolbar>`，
计数留在工具条里（S5：一行 ≤2 个数字）。

- `PageHeader` 新增 **`kicker`** 槽：原来各屏的 `eyebrow` 文案（「Studio 项目」「规则资料」「项目概览」…）**原样保留**，
  不是删掉——换的是**结构**不是**内容**（红线：能力与信息只加强不删）。
- 资产页的「这里是资产后台」定位句从独立说明条**移到页头 description**；守卫随之迁移到
  `description={…: ASSET_BACKSTAGE_COPY}`（内容不变、位置更正规）。
- **不改**：lineage（画布）与 runs（两栏布局）没有页面级页头——它们的头部形态属于 **B2**（面包屑）与 **C1/C3**
  （画布 chrome 收敛 / 检查器页签），本批不提前动。
- 顺带记录一处**既有的版本陈旧**：创作手册的 kicker 仍写「Studio 学习中心 · v5.13.0」（代码已是 6.0.0）。
  不在本批范围，**没有顺手改**——按 §9.3「标准/文案变更不顺手做」登记待处理。

**实测（1440×900，14 屏逐屏）**：有页头的 12 屏**标题都是 20px、页头 56–82px（≤88）、无文档级横向溢出**；
lineage / runs 按设计无页面级页头。

**验证**：`lint` 0；`build:workbench` 通过；**全套 866 项 → 864 通过 / 0 失败 / 2 跳过**。

### 2026-09-19 · **收尾证据（方案 §8.4 格式）**

**批号 · 屏幕 · 视窗 / 数字 / 现象 / 反例**

```
批 A · projects · 1440×900
主区 77% / 顶部 chrome 0px / 首元素 y 353px / 常驻横带 1
现象：页头标题 20px、页头高 80px、列表与搜索正常；工具条由 PageToolbar 承载
反例：不带 ?audit=layout 时 DOM 里查不到 .layout-audit（零开销）
截图：/var/folders/.../opencode/batch5-projects.png

批 A · lineage · 1440×900
主区 69% / 顶部 chrome 70px / 首元素 y 389px / 常驻横带 1
现象：画布屏在 PageFrame(wide) 内；队列底栏打 data-region=bottom
反例：≤860 宽时画布 scrollWidth>clientWidth 属画布固有裁剪（overflow:hidden），非回归
截图：/var/folders/.../opencode/batch5-lineage.png

批 A · guide · 1440×900
主区 77% / 顶部 chrome 0px / 首元素 y 353px / 常驻横带 1
现象：narrow 档 820px 居中；页头标题 20px、高 63px
反例：文档级无横向溢出（documentElement.scrollWidth === clientWidth）
截图：/var/folders/.../opencode/batch5-guide.png
```

**⚠️ 三屏 `首元素 y` 全部越界（353/389px）——这不是本批的缺陷，是本批量出来的真账**：
队列底栏现在渲染在内容**之上**（DOM 顺序 + F0 的账），把主区推下去。修它的是 **批 C4（底栏贴底）**。
本批的职责是「让它可测」（A6），不是「把它修好」。
另：`顶部 chrome` 目前只统计已打标区域；画布内部四条横条要等 **C1** 合并成一条后计入。

## 决策点（2026-09-19 刀哥已拍板）

| # | 决策 | 决议 |
|---|---|---|
| D1 | 队列位置 | 贴底常驻槽（批 C 落地，本批不动） |
| D2 | 资产管理 | 保留 rail 一级入口（批 B 落地） |
| D3 | 断点 | **收敛到 3 档（本批 A5 执行）** |
| D4 | 项目壳 | 合并为两页签（批 B 落地） |
| D5 | 视觉方向 | **深 rail + 浅纸面（本批 A1 执行）** |
| D6 | S1 阈值 | **分三档（本批 A6 作为审计阈值）** |
| D7 | 密度开关 | 不做 |