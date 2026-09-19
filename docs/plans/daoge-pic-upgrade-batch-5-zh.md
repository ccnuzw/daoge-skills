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
  - `tests/vnext` 中 10 个文件共 21 处 `className="…"` 字面量断言（`workbench-bulk-ui` 10 处、`asset-card-layout` 9 处、`terminology-guard` 3 处、其余 7 个文件各 1 处），是 G13 要收口的那一层。
- **待办**：第 4 批收束 → 写 §0.3 的 7 个守卫桩 → 确认红 → 按 A1→A7 动代码。

---

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