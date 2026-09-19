# daoge-pic 以人为本升级 · 第 3 批施工单

> **本文件在套装中的位置**：方案文档 = 宪法（为什么改 / 改成什么）；规格书（`daoge-pic-upgrade-spec-zh.md`）= 法律（跨批次不变的规矩）；
> **本文件 = 行政命令**，定「这一批做什么」。**施工单不得违背规格书；规格书不得违背方案。**
>
> **本批是否触发规格书改动：否。** 唯一一处「细化」：方案 §5.3/§5.4 把「provider 三处运行时态」排在第三批，
> 但它同时是开放项 **#26 磁盘满 / #28 provider 全挂** 的落点（第 2 批 7.1 表写着「三批」）——两者合并为同一组 P，属**细化合并**，不是新增。

---

## 进度快照（**每次做完一组就在这里更新一行；换会话时先读这一节**）

| 日期 | 进度 | 下一步 |
|---|---|---|
| 2026-09-18 | **施工单编制完成（未开工）**。第 1 / 2 批已收束并推送（`9849807`，`main` 与 origin 同步）；第 2 批的三件「发布动作」按规格书留待正式发布。本批范围见第 2 节（G / H / P 三组 + 技术债 T，**S 组列为待定**） | 刀哥拍板决策点 D1–D3，再写 0.3 守卫桩 |
| 2026-09-18 | **决策 D1–D4 已拍板**（按推荐：D1 本地草稿 / D2 队列底栏 / D3 9.8 推迟到第 4 批 / D4 T1 搭车）。0.3 的桩接口约定已定（见下） | 写 0.3 守卫桩并确认红 |
| 2026-09-18 | **0.3 守卫桩写完并确认红**：6 个新测试文件 / 16 条断言，**16 红**（红的原因都是「实现尚不存在」，不是测试自身写错）。见第 8 节日志 | 动代码（先 G 组，再 P 组，再 T 组） |
| 2026-09-18 | **G 组完成 → 编排闭环落地** 🎉 圈选发起（画布多选进请求上下文）、空白双击就地建任务、`照它再来` 统一走本地草稿（并修掉「第 4 个动词被菜单上限切掉」的真缺陷）、`拿出去` 挂选中。浏览器实测通过。**全套 822 项 → 815 通过 / 5 失败 / 2 跳过**，5 = **P1–P4 + T1 尚未实现的桩**。见第 8 节日志 | 开 P 组（provider 运行时态） |
| 2026-09-18 | **P 组完成（P4 仅一半，事后核对修正）**：配置即测（保存/切换后自动测一次）、能力徽章加「当前模型能不能用」（`runtime.desired.modelCapability`）、退避/限流上队列底栏状态行（D2）、**未配置**的人话文案。⚠️ `all_providers_down` / `disk_full` **只有文案与守卫、没有信号源与首屏提示**（P4 未完成）。**全套 822 项 → 819 通过 / 1 失败 / 2 跳过**，1 = T1 桩。见第 8 节日志 | 开 T 组（A11 读侧迁移 + 重试闭环核对） |
| 2026-09-18 | **T 组完成（读侧迁移 + 闭环核对）** 🎉 T1：项目作用域与 `assetBelongsToProject` 改为**列优先、空列回退关系**，并补真行为对拍。T2：UI→队列→CLI 接单→卡片「agent 正在理解…」全链验通。**全套 823 项 → 821 通过 / 0 失败 / 2 跳过**。见第 8 节日志 | 刀哥批准真跑重试 |
| 2026-09-19 | **T2 真跑完成（0 花费）**：agent 执行重试 3 项 → 出站守卫拦在发送前（DNS 又解析到 198.18.x fake-ip 段），**没发出、没计费**；按协议 `resolve-unknown` 结为 failed + `request-done --reply` 结单，界面卡片变「3 张没成 · 看这一批」+ 回复——**闭环成立**。队列已清空。⚠️ 环境问题（域名解析）留给刀哥 | 修两处：多批次进度矛盾 + H1 |
| 2026-09-19 | **两处修复完成** 🎉 ① 进度卡片：`roundForRequest` 改为「权威指向 → 在跑 → 最新运行 → 最新批次」，且**结单带回复时不再叠批次进度**（修掉与回复自相矛盾的显示）；② H1：资产页加单一来源的「这里是资产后台…挑图在画布」说明（只加强调用，不删能力）。浏览器实测通过。**全套 826 项 → 824 通过 / 0 失败 / 2 跳过** | 刀哥要求复核完整性 → 见下方核对结论 |
| 2026-09-19 | **完整性复核（刀哥要求）→ 结论：未 100%**。缺口 3：① **P4 只完成一半**；② **P1 的界面路径、刷新还原**未复验；③ **S 组 9.7（可选）** 未做。见第 8 节末「复核结论」 | 刀哥定：补 P4；P1 实测不做 |
| 2026-09-19 | **P4 补完 → 本批功能收齐** 🎉 服务端给「最近几次终态运行 + 首条错误摘要」事实，前端用单一分类来源判定 `all_providers_down` / `disk_full`，首屏级提示条渲染。磁盘签名并入系统信号（顺带修掉 4.10 的一处归因缺口）。**全套 829 项 → 827 通过 / 0 失败 / 2 跳过** | 提交（待刀哥确认范围） |
| 2026-09-18 | **跨批修：Windows 门禁转绿**——C1 守卫（`agent-detect.test.js`）的夹具改为按平台归一，**实现未动**；本机用 `path.win32` 语义复现并两向验证。见第 8 节日志 | 继续 P 组（provider 运行时态） |

> **交接约定**：换会话后，新会话只需读 **本节 + 第 8 节实施日志** + 技能记忆，即可无损接续。
> **没写进这三处的东西等于没发生。**

---

## 0. 前置

### 0.0 本批的性质

- **不是收尾批**：不跑规格书 §8 的完整 DoD；只跑落在本批的条目（见第 6 节）。
- **不做 schema 迁移**：方案 §5.4 里动 schema 的项已在第 2 批一次做完（迁移 35–41）。
  本批预期 **`STUDIO_SCHEMA_VERSION` 保持 41**；若实施中确需新列，**必须先停下改方案**，不得就地加。
- **不翻转版本**：`6.0.0` / 协议 `3.0.0` **尚未发布**，本批仍是它的一部分；除非 **D3** 拍板 9.8 要动协议，否则不动版本号。

### 0.1 本批会破坏的守卫（先写桩，再动代码）

| 守卫 | 为什么会红 | 处理 |
|---|---|---|
| `lineage-menu.test.js` | `canDerive` 从恒 false 打开（G3） | **改**：断言改为「derive 项按新语义出现」，并锁住它走的是拍板后的路径 |
| `source-text-guard.test.js` | 前端新增圈选/发起/交付/状态卡改动 | **改**：逐条核对（文本变了断言跟着变，**不许删断言**） |
| `phase4-navigation-registry.test.js` | 若系统状态卡落进 rail（P3） | **改**：新增状态卡入口不得让视图变孤儿 |
| `provider-settings-ui.test.js` | 保存/切换自动测、能力实时态（P1/P2） | **改**：扩展断言，不是放宽 |
| `provider-concurrency.test.js` | 退避状态浮到状态卡（P3） | **复核**：只读消费，预期不改；若改行为则扩展 |
| `request-queue-ui.test.js` | composer 上下文要能带「画布圈选」（G1） | **改**：新增圈选 → context 断言 |
| `creator-delivery-ui.test.js` / `delivery-page-render.test.js` | 「拿出去」入口从选中发起（H） | **复核**：入口位置变化，断言随之 |
| `terminology-guard.test.js` | 新增人话文案 | **复核**：新文案必须走术语单，不引入裸枚举 |

### 0.2 本批会触及、需逐条复核的守卫（规格书 §3.2 的「其余按批核对」）

- `studio-scope` / `delivery-studio-scope-api`（交付发起挂选中是否改作用域口径）
- `background-process-contract`（P1 自动测是否会触发额外进程——**不允许**，测的是 HTTP 端点）
- `multi-session-contract`（不碰 session）
- `provenance-contract`（不碰来源链）
- `phase4-route-refresh`（若动路由参数则触及）
- `lineage-inspector.test.js` / `lineage-density.test.js`（G1 圈选与工具条）
- `project-selection-api.test.js`（选中语义）

### 0.3 新增守卫桩（本批必须新建，先写成 fail）

1. **圈选发起**（G1）——画布多选图节点 → 请求上下文 `assetIds` 必须含这些图；**不许**只靠「选片」关系。
2. **就地建任务/批次**（G2）——空白双击 / 选中菜单建结构时**不跳页**，且结构立即出现在画布上。
3. **derive 路径唯一**（G3）——「照它再来」只有一条实现路径（拍板后：本地草稿 **或** 队列），**不许两套并存各说各话**。
4. **交付发起挂选中**（H）——在画布/检查器选中已保留成果 → 「拿出去」→ 生成交付草稿；**未经选中时不得凭空发起**。
5. **provider 配置即测**（P1）——保存 / 切换 profile 后**自动测一次**，失败也是一句人话（不是静默）。
6. **provider 实时能力**（P2）——能力徽章读的是**运行时态**，不是静态「支持/不支持」。
7. **退避可见**（P3）——限流 / 内存退避状态能在**不打开设置页**的地方看到（状态卡）。
8. **provider 全挂 / 磁盘满给人话**（P4）——首屏级提示，不出现术语、不出现「结果未知」式黑话，且**告诉下一步**。
9. **A11 读侧（T1，若做）**——产出归属查询走 `assets.project_id`，与旧「拼五跳」结果一致（对拍，不是替换断言）。

> 第 3 条依赖 **D1** 拍板；第 8 条依赖 **D2**（落点）；第 9 条依赖 **D4**（是否本批做）。

**桩的接口约定**（D1–D4 拍板后定稿；实现必须与守卫同名同形，否则「桩绿了、功能没接」）：

| 桩 | 新增/扩展 | 接口 |
|---|---|---|
| 1 | 新增 `web/src/canvas-request-context.mjs` | `requestContextAssetIds({ canvasAssetIds, selectedAssetIds })` → 去重后的数组 |
| 2 | 新增 `web/src/canvas-creation-model.mjs` | `inPlaceCreationRoute({ view, projectId, taskId, kind, id })` → 保持 `view` 不变的 route |
| 3 | 新增 `web/src/derive-path-model.mjs` | `DERIVE_PATH`（= `'draft'`）· `deriveAvailability(node)` → `{ available, path }` |
| 4 | 扩展 `web/src/delivery-workflow.mjs` | `deliveryIntentFromSelection({ projectId, selection })` → `{ canStart, reason, copy }` |
| 5 | 新增 `web/src/provider-connection-model.mjs` | `profileChangeNeedsTest(previous, next)` → 布尔 |
| 6 | 扩展 `/api/providers` 的 `runtime` | `runtime.modelCapability`（当前模型运行时可用的显式布尔组） |
| 7 | 新增 `web/src/provider-runtime-model.mjs` | `providerRuntimeNotice(runtime)` → 人话句子（healthy 时为空串） |
| 8 | 扩展 `web/src/failure-copy-model.mjs` | `providerOutageCopy({ kind })`（`disk_full` / `all_providers_down`）→ 人话 + 下一步 |
| 9 | 扩展 `src/vnext/domain/output-attribution.ts` | `assetBelongsToProject(db, { studioId, assetId, projectId })` → 布尔（读侧以 `project_id` 为准） |

### 0.4 环境与影响提示

- **前端改动刷新即生效**（daemon 按请求读盘、`cache-control: no-store`）；**后端改动必须换真进程**
  （先查 `generation_runs` 无 `queued/running/pausing` → `kill <pid>` → `open`）——`daoge restart` 是同进程重跑，**不加载新代码**。
- 日用环境即验收环境（第 2 批已就地升级到 schema 41）；**动后端前先确认无活跃运行**（第 2 批自伤事故的教训）。
- 界面改动**必须用真实浏览器**（Playwright + Chrome）渲染核对：单测绿 + 产物含字符串 ≠ 界面真的对。

---

## 1. 目标（可验收的一句话）

**让「选中 + 说一句」真正成为画布上的编排动作**——圈住几张图就能就地发起、照着再来、拿去交付，中途不跳页；
**让生成服务与 agent 的运行时真相浮到看得见的地方**（限流 / 退避 / 全挂 / 磁盘满），人不必打开设置页才知道服务在慢下来。

---

## 2. 任务分解

### G 组 · 编排闭环（依赖第 2 批的队列；方案 4.3 第四刀 / 4.4 / 4.8-4）

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **G1** | **圈选发起** | `web/src/creative-lineage-canvas.jsx`（`selectedKeys` / 框选 `handleCanvasPointer…`）、`web/src/main.jsx`（composer `context`）、`web/src/request-queue-model.mjs` | 画布**多选图节点**要喂给请求 composer 的 `assetIds`。现状核实：画布 `selectedKeys` 与「选片」`selectedAssetIds` 是**两条链**，composer 只读后者 → 圈选不生效。做成**单向只读**：圈选 → context（发起后仍由既有选片/评审承担持久化，**不造影子状态**） | 4.3 第四刀 / 4.5 |
| **G2** | **就地建任务 / 批次** | `creative-lineage-canvas.jsx`（空白双击、`onCreateTask` / `onCreateRound`）、`main.jsx` | 「创建」不该是离开画布的理由：空白双击与选中菜单都能就地建，**建完留在画布**、结构立即上屏 | 4.3「画布外 / 创建」 |
| **G3** | **「照它再来」统一路径**（⚠️ **决策点 D1**） | `creative-lineage-canvas.jsx:873`（`canDerive`）、`lineage-menu-model.mjs`、`main.jsx`（`openDerivedRoundDialog` / `requestRunAction`） | 现状核实：**已有两条 derive 路径**——选片条 / 资产卡的 `openDerivedRoundDialog`（本地建草稿，**能用**）与节点菜单的 `canDerive:false`（**禁用**）。方案 4.3 说「复制出来是**草稿**，不是执行命令」，第 1 批却记「要经队列派 agent」。**二选一，不许并存** | 4.3 / 4.8-4 / 第 1 批 C2 |
| **G4** | **交付发起挂「选中」** | `web/src/main.jsx`（`deliverableIntent` / `navigateRoute` 到 deliveries）、`creative-lineage-canvas.jsx`（`canDeliver` / `open-delivery`）、`creator-delivery.jsx` | 「拿出去」是**动作**，接在「选中」这个共同前提上；交付**一级入口保留**（已导出的图要有家）。第 2 批已补 `includeCreativeRecord` 开关，本项只动**触发方式** | 7.11.2 / 4.3 |

### H 组 · 资产管理退后台（方案 7.11.1；与 G4 同一条判据）

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **H1** | **资产管理的定位收口** | `web/src/main.jsx`（assets 视图）、`asset-state-legend.jsx` | 挑图已在画布（第 1 批）；资产页退为「导入 / 整理 / 去重 / 回收 / 跨项目共享」的**后台**。**只调整入口与文案的强调，不删能力**（红线 2.4） | 7.11.1 / 7.11.5 |

> **H 与 G4 是同一件事的两面**：G4 是「动作挂选中」，H1 是「地方退后台」。若工期紧，**G4 优先、H1 可与 G4 合并交付**。

### P 组 · provider 运行时态（方案 7.11.4 + 开放项 #26 / #28）

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **P1** | **配置即测** | `provider-settings.jsx`、`src/vnext/api/server.ts`（provider test 端点） | 保存 / 切换 profile 后**自动测一次**（「配完就安心」）。失败给人话，不静默 | 7.11.4 |
| **P2** | **能力徽章加实时态** | `provider-settings.jsx`、`/api/providers` 返回体 | 「支持」≠「当前模型能用」：徽章要读**当前模型**的运行时能力 | 7.11.4 |
| **P3** | **退避 / 限流浮到状态卡**（⚠️ **决策点 D2**） | `main.jsx`（rail / 状态卡落点）、`provider-settings.jsx:356`（现埋点）、`/api/providers.runtime` | 现状核实：`runtimeReasonLabel` **已存在**，但埋在二级设置页。要把它浮到**不打开设置就看得到**的地方。落点需拍板（rail？队列底栏？新系统面板？） | 7.11.4 / 方案 §5.4 |
| **P4** | **provider 全挂 / 磁盘满给人话** | 前端首屏级提示 + 后端错误分类（`quality-metrics` / `error_json` 已有分类） | 开放项 #26 / #28：区分「我的问题」和「系统的问题」，**给下一步**、**别让他反复试**；不出现术语 | 4.10 / 7.1 表 |

### T 组 · 技术债（可搭车；⚠️ **决策点 D4**）

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **T1** | **A11 读侧迁移** | `domain/queries.ts`、`domain/creative-records.ts` 等按关系拼五跳的读路径 | 写入侧已在第 2 批升格为 `assets.project_id`，读侧仍拼五跳。**用对拍守卫**（新旧结果一致）逐步替换，不是一次性重写 | 7.7.1 / 第 2 批 A11 |
| **T2** | **重试回调链端到端核对** | `runner/run-commands.ts`、`web/src/request-progress-model.mjs` | 第 2 批验到「重试→已排队」为止；真实 agent 执行到界面闭环**未端到端核实**。本批用真实 agent 跑通一次并补证 | 4.9 / 第 2 批 |

### S 组 · 待定（**不默认进本批**，见决策点 D3）

| # | 任务 | 归属建议 | 备注 |
|---|---|---|---|
| **9.6 我的配方** | 用户侧跨项目复用（`confirmed_templates` / `style_kits` / `brand_kits` 底子都在） | 三批后半或第 4 批 | 「存为我的配方 → 下次自动带出」 |
| **9.7 失败原因→建议映射** | skill 侧（`SKILL.md` + 分类代码） | 本批可选（小，改善重试闭环） | 额度→充值；审核拒→换词；网络→等 |
| **9.8 计划契约「理解说明」字段** | **动 `SKILL.md` + `preflight.ts` 的 `PreflightPlan`** | **建议随第 4 批 4.1 一起** | 与「出图问法倒过来」同源，单做会动两次协议 |

### 收尾

双端 typecheck（`typecheck:web` + `typecheck:vnext`）→ `npm run lint` 全量 0 error → 全套回归（`npm test`）→ `npm run build` → `cmp` 线上产物与磁盘 → **只 commit 不 push**（push 单独确认）。

---

## 3. 守卫变更（汇总）

- **改**：`lineage-menu`（G3）、`source-text-guard`（G/H/P）、`provider-settings-ui`（P1/P2）、`request-queue-ui`（G1）、`phase4-navigation-registry`（P3 若落 rail）。
- **复核**：`provider-concurrency`、`creator-delivery-ui` / `delivery-page-render`、`terminology-guard`、`studio-scope` / `delivery-studio-scope-api`、`lineage-inspector` / `lineage-density`、`project-selection-api`。
- **新增 9 条桩**（见 0.3）；其中第 3、8、9 条分别依赖 D1 / D2 / D4 拍板后才定稿。

---

## 4. 迁移或切换步骤（**本批无 schema 迁移**）

1. **无数据迁移**：本批预期不动 schema（仍 41）；若实施中确需新列 → **停下改方案**，不就地加。
2. **前端**：改完刷新即生效；**后端**：换真进程（查无活跃运行 → `kill` → `open`）。
3. **回滚**：前端回退到上一 bundle / 后端 kill + 起旧进程即可；`studio.db` 原地不动。

---

## 5. 验收清单

- [ ] **圈选发起**：画布圈住 2–4 张图 → 说一句 → 请求上下文带这些图，卡片出现在队列里
- [ ] **就地建任务 / 批次**：空白双击或选中菜单建完**不跳页**，结构立即上屏
- [ ] **照它再来**：选中图 / 批次 → 「照它再来」按拍板路径生效（**只有一条路径**），界面有明确下一步
- [ ] **拿出去**：选中已保留成果 → 「拿出去」→ 交付草稿；未选中时给一句人话（不是空按钮）
- [ ] **资产管理**：挑图在画布仍可用；资产页作为「导入 / 整理 / 回收」后台入口可达（能力一个不删）
- [ ] **配置即测**：保存 / 切换 profile 后自动测一次，结果给人话
- [ ] **实时能力**：能力徽章随当前模型变（支持 ≠ 可用）
- [ ] **退避可见**：限流 / 退避能在**不打开设置**的地方看到
- [ ] **全挂 / 磁盘满**：给的是「系统的问题 + 下一步」，不出现术语、不诱导反复重试
- [ ] **刷新浏览器**：以上状态全部还原（唯一事实）；界面无前端影子状态
- [ ] **T2**：真实 agent 从队列接重试 → 界面闭环（端到端一次）
- [ ] `tsconfig` 双端 0 错；`lint` 0 error；全套回归绿
- [ ] **四条红线逐条过**（规格书 §2）

---

## 6. 端到端检查

**本批不是收尾批**，不跑规格书 §8 完整 DoD。落在本批的条目：

- **DoD 8 的「拿出去」触发方式**（从选中发起）——第 2 批已验交付三阶段与三件套，本批验**入口**。
- **DoD 6 的闭环**——重试走队列已在第 2 批验到「已排队」；本批用真实 agent 验到**执行完成、界面更新**（T2）。
- **红线 2.4**——G/H 是「收」不是「删」：交付 / 资产管理的能力都要指出新家。

---

## 7. 开放项销账

| 项 | 本批如何覆盖 |
|---|---|
| **方案 §5.4 资产管理退后台 / 交付发起挂选中** | G4 + H1 |
| **方案 §5.4 / 7.11.4 provider 三处运行时态** | P1 / P2 / P3 |
| **开放项 #26 磁盘满 / #28 provider 全挂** | P4 |
| **第 2 批 #26/#28 归三批的记录** | 同上（P4） |
| **第 1 批 4.8-4「挑完就地接下一步」** | G3（derive 统一） |
| **第 2 批 A11 读侧迁移** | T1（视 D4） |
| **第 2 批「重试回调链」** | T2 |
| **开放项 #25 daemon 重启时的图** | 既有「恢复中」机制，本批不动 |
| **#10 / #11 归档与物理删除** | 不做（疑难层，后续单独） |
| **方案 §5.3「全局对话」** | 已由第 2 批的队列 composer（项目内全局）承载；本批不新增内嵌对话（§6.1 已定「当前不支持」） |

---

## 8. 实施日志

### 2026-09-18 · 施工单编制完成（未开工）

- 本单依据方案 §4.3/4.4/4.5/4.8/4.10/5.3/5.4/7.11、规格书 §1–§3、第 1 / 2 批实施日志编制。
- **编制前的进度核对（对着代码，不只看文档）**：
  - 「重试走队列」「暂停/取消 cookie」「agent 连接 C1–C5」「#21 取消撤销」**已在前两批/上轮完成**，故**不再列入三批**；
  - 「全局对话」按方案 §6.1 不内嵌对话，队列 composer 已承载，**降级为无需单列**；
  - **新核出**：画布圈选（`selectedKeys`）与 composer 的 `assetIds`（`selectedAssetIds`）是**两条链**（G1 的真缺口）；
  - **新核出**：derive 有**两条并存路径**（本地草稿可用 / 节点菜单禁用），需定一条（D1）。
- **未开工**，无实测偏差。

### 2026-09-18 · **0.3 守卫桩写完并确认红**（6 个新测试文件 / 16 条断言，16 红）

| 文件 | 覆盖桩 | 结果 | 红的原因 |
|---|---|---|---|
| `canvas-request-context.test.js` | 1 圈选发起 | 3 红 | `web/src/canvas-request-context.mjs` 不存在 |
| `canvas-in-place-create.test.js` | 2 就地建任务/批次 | 3 红 | `web/src/canvas-creation-model.mjs` 不存在 |
| `lineage-derive-path.test.js` | 3 derive 路径唯一 | 2 红 | `web/src/derive-path-model.mjs` 不存在 |
| `delivery-from-selection.test.js` | 4 交付发起挂选中 | 3 红 | `delivery-workflow.mjs` 无 `deliveryIntentFromSelection` |
| `provider-runtime-state.test.js` | 5–8 provider 运行时态 | 4 红 | 连接/运行时模型不存在；`/api/providers.runtime.desired.modelCapability` 缺失；`failure-copy-model` 无 `providerOutageCopy` |
| `output-attribution-read.test.js` | 9 A11 读侧 | 1 红 | `output-attribution` 无 `assetBelongsToProject` |

**结论**：桩有效——红的原因全是「实现尚不存在」。`lint` 0 error。

**一处环境坑（记录）**：`tests/vnext/provider-runtime-state.test.js` 单跑时须自设
`DAOGE_PIC_PROVIDER_SECRET_BACKEND=plaintext`（全套由 `scripts/run-tests.js` 注入）。
否则 provider 密钥落到「系统后端」并因缺 `paths` 抛错——那是**环境问题**，会让桩「红错了原因」。
桩内已补默认值，单跑也能红得其所。

### 2026-09-18 · **G 组完成（编排闭环）**

**四个纯模型 + 接线**（守卫 `canvas-request-context` 3/3、`canvas-in-place-create` 3/3、
`lineage-derive-path` 2/2、`delivery-from-selection` 3/3 全绿）：

- **G1 圈选发起**：新增 `canvas-request-context.mjs`（`requestContextAssetIds`）。画布把选中的**图 id**
  往上报（`onCanvasAssetSelection` → `canvasSelectedAssetIds`），composer 的 `assetIds` 由「画布圈选 + 选片」
  合并去重。**只影响指代、不持久化选中态**（红线 2.1）。浏览器实测：圈 2 张 + 选片 1 张 → 请求体
  `context.assetIds` 去重后正好 3 条。
- **G2 就地创建**：新增 `canvas-creation-model.mjs`（`inPlaceCreationRoute`，强制 `view` 不变）。
  空白双击画布 → 就地弹「新建任务」，**不跳页**；两条创建流程的路由也改由它拼。浏览器实测：
  空白双击出「新建任务」弹层且 URL 仍在 `view=lineage`。
- **G3 照它再来**：新增 `derive-path-model.mjs`（`DERIVE_PATH='draft'`，D1）。节点菜单 `canDerive` 由
  `deriveAvailability(node)` 决定，动作复用既有 `openDerivedRoundDialog`（本地草稿）。
  ⚠️ **实测抓到一个真缺陷**：`lineage-menu-model` 把「详情」也算进 4 项上限（`slice(0, LIMIT-1)`），
  于是候选图的第 4 个动词 `照它再来几张` **被永远切掉**——桩绿了但工具条上不可达。
  已改为「**4 个动词 + 详情**」（方案 4.4 的候选菜单本就是四个动词），并补了一条**可达性**断言。
  浏览器实测：候选图工具条出现「照它再来几张」，点击弹出「基于图片创建下一轮 · 只记草稿，不出图」。
- **G4 拿出去挂选中**：`delivery-workflow.mjs` 新增 `deliveryIntentFromSelection`；选片工具条的
  「去交付」按它决定可用与文案（给不出给人话）。⚠️ **一处自查纠偏**：曾把画布 `canDeliver` 收窄到
  「asset 且 keep」，那会**删掉批次的整体交付能力**（红线 2.4）——已恢复原判据；图的交付本就由
  `lineage-menu-model` 按「已选定」把关。浏览器实测：去交付按钮文案＝「1 张已保留选片可创建交付草稿。」。

**验证**：`lint` 0 error；`typecheck:web` + `build` 通过；**全套 822 项 → 815 通过 / 5 失败 / 2 跳过**
（5 = P1–P4 + T1 的桩，尚未实现，属预期）。

### 2026-09-18 · **跨批修：Windows 门禁转绿（C1 守卫的夹具按平台归一）**

**症状**：`DAOGE Pic Windows` 四个组合（`windows-2022` / `windows-2025` × Node `22.17.0` / `24`）自
`891e305`（第 2 批补 C1 侦查）起**每次都红**，唯一失败项是 `tests/vnext/agent-detect.test.js:53`
（`codex.homeExists` 断言 `false !== true`）。同期的 CONNECT 隧道用例只在 `09-17 05:29Z`（`51474a44`）那次红过，
此后各次运行里都是绿的。

**根因**：守卫的注入探针按**精确字符串**比对，而侦查会把注入的 `homeRoot` 解析成绝对路径。
win32 下 `path.resolve('/home/creator')` 会用当前盘符补齐（CI 的 cwd 是 `D:\a\daoge-skills\skills\daoge-pic`，
于是得到 `D:\home\creator`），夹具却按 `\home\creator\.codex` 建键——两边永远对不上。
macOS 的 `path.resolve` 对 POSIX 根是恒等变换，所以本机永远绿（典型的只在 Windows 成立的失败）。

**修法**（只改守卫，不动实现）：探针像真实探针的 `fs.statSync` 一样按平台解析路径，夹具因此**钉路径身份而不是拼写**。
**两向验证**：把实现里 codex 的 skills 目录改名 → 守卫红（真回归照样抓得住）；把实现改成不解析注入根 → 守卫绿（不锁实现细节）。

**本机复现**：用 `path.win32` 语义（含 CI 的盘符）替换 `node:path` 后单跑守卫——修前 `fail 1`（同一文件、同一行、同一断言），
修后 `3/3`。CI 侧仍是**未验证状态**：本机没有 Windows runner，实机结论待下一个提交推上去后由 GitHub 上那四个 job 给出。

**验证**：`lint` 0 error；全套 822 项 → 819 通过 / 1 失败 / 2 跳过（1 = T1「归属读侧只认列」的桩，尚未实现，属预期）。

### 2026-09-18 · **P 组完成（provider 运行时态）**

**P1 配置即测**：新增 `provider-connection-model.mjs`（`profileChangeNeedsTest`）——身份 / 版本 / 模型 / 服务商
变了、或密钥被替换过才需要重测。`provider-settings.jsx` 的保存与激活接上 `autoTest()`：**保存/切换后自动打一次
连接测试**，结果并进反馈（失败也给一句话）。测的是 HTTP 端点，不起额外进程。

**P2 能力实时态**：`/api/providers` 的 `runtime.desired` 新增 `modelCapability`（模型 + 配置是否已生效 +
每项能力的可用性与原因）。设置页能力卡在**选中的是激活配置**时多一行运行时结论。
实测接口返回 `gpt-image-2.5 / applied:true / 四项可用`，界面显示「当前模型 gpt-image-2.5：配置已生效；上面这些能力此刻都可用。」

**P3 退避可见（D2）**：新增 `provider-runtime-model.mjs`（`providerRuntimeNotice`）。`refreshStudio` 保留
`/api/providers` 的 runtime，队列底栏状态行新增一格（与 agent 在场卡同处，零新入口）。
拦截实测：`lastReason=rate_limited` → 「生成服务在限流，先把出图放慢（不是你的操作问题）。」；健康时不显示。

**P4 全挂 / 磁盘满 / 未配置给人话**：`failure-copy-model.mjs` 新增 `providerOutageCopy`（分清「我的问题 /
系统的问题」、永远给下一步、明说「别反复点重试」）。`configured=false` 已接到状态行；实测提示
「还没有可用的生成服务。先去「生成服务」里配好一个，再回来说一句。」
⚠️ **如实记录**：`all_providers_down` / `disk_full` 目前**只有文案模型与守卫，尚未接到真实信号**
（前者需要「所有 profile 均不可用」的聚合，后者需要媒体写入失败的分类）——留待有信号源时接线，不编造。

**验证**：`lint` 0 error；双端 typecheck + `build` 通过；**全套 822 项 → 819 通过 / 1 失败 / 2 跳过**
（1 = T1 桩）。后端改动按纪律**换真进程**加载（先查无活跃运行 → `kill 9725` → `open`，新 pid 43896）。
⚠️ **P1 的界面路径未做「真改动 provider」的浏览器实测**：自动测会打真实网络且要改 live 配置；
模型有单测、接线已复核，浏览器只验了 P2/P3/P4。

### 2026-09-18 · **T 组（A11 读侧迁移 + 重试闭环核对）**

**T1 读侧迁移（D4 搭车）**：
- `assets.ts` 的**项目作用域**改为「**列优先 + 空列回退关系链**」：
  `((a.project_id = ?) OR (a.project_id IS NULL AND EXISTS(<原关系链>)))`。
  写入侧第 2 批已写死列，所以关系链从此只服务没有列值的历史/特殊行——
  「一次 SQL 说清归属」不再跳五跳，且**列能压过关系**（防止关系残留把图拖回旧项目）。
- `output-attribution.ts` 新增**只认列**的 `assetBelongsToProject`（Studio 谓词走 `selectStudioSql`）。
- 守卫从 1 条扩到 2 条：新增**真行为对拍**——只有列（无关系）必须读到、列为空+有关系必须回退读到、
  列指向别处但关系指向本项目时**列赢**（`listScopedAssetProjects` 实测三条都成立）。

**T2 重试回调链（免费部分已验，花钱部分待批）**：
- 造一条真实的重试请求（`intent:retry` + `runId` + 3 个 `itemIds`，属失败批次 `round_e623c56c`）；
- 用 agent CLI（bearer）`request-accept` 接单 → 界面卡片从「等待接单」变为
  **「agent 正在理解… / 还没有产出计划。」**——不静默这条成立；
- 顺带核实了一条契约：**未登记的 agent 接单后在场卡仍说「不在场」是预期**（4.6：在场必须先登记）。
  按协议 `agent-register --cli codex --skill daoge-pic` 后，状态行立刻变
  「agent 在场 · daoge-pic 已装载 v6.0.0 · 刚刚还在」。
- ✅ **已做（2026-09-19，刀哥批准真跑）**：agent 执行 `daoge retry --run … --items …` 重试 3 项。
  **结果是「没成但没花钱」**：出站守卫把请求拦在发送前——
  `provider_transport_error: Provider image host resolved to a non-public address.`。
  实测 DNS：`cc.nextcc.cc → 198.18.0.7`、`api.openai.com → 198.18.2.204`（**198.18.0.0/15 是代理 fake-ip 段**），
  即环境又回到「域名解析成非公网地址」的状态（第 2 批 DoD 时曾被修好，现复发）。
- **诚实收尾**：3 项按协议 `resolve-unknown` 结为 `failed`（实测不可达，无可核实结果）；
  请求 `request-done --reply` 结单（回复里写明原因与下一步），界面卡片变为
  **「3 张没成 · 看这一批」+ 回复原文**——**回调链闭环成立**（发起处显示结果，8.10#8）。
  队列里的遗留测试请求已用 cookie 撤回（`pending = 0`）。
- ⚠️ **本批不修的环境问题（留给刀哥）**：出站守卫按「非公网」拦截是对的（安全边界不放松）；
  要恢复真实出图，需把域名解析恢复正常（或切回非 fake-ip 模式），**不要**为此改信任模式。

**T2 顺带发现（记录，未修）**：一个请求可链多个批次（B5 的「一个请求可出两批」），
但 `request-progress-model` 的 `roundForRequest` 会挑到**任意一个**已链批次；
若该批次的运行不在已加载的 `runs` 里，进度就回落到「已确认 · 正在准备出图」——
**与卡片自己的回复（「三张已出齐」）自相矛盾**。实测样本：`req_ac89ea2c` 链了 4 个批次
（完成 3/3、完成 1/1、失败 0/3、失败 0/3）。属**第 2 批进度卡片**的缺陷，非本批引入；
修法需产品判断（done 且带回复时是否还显示进度、多批次取哪个），**另案处理**。

**验证**：`lint` 0 error；双端 typecheck + `build` 通过；**全套 823 项 → 821 通过 / 0 失败 / 2 跳过** ✅

### 2026-09-19 · **两处修复（进度卡片多批次 + H1 资产后台）**

**① 进度卡片：一个请求链多批时挑错批次，显示与回复自相矛盾**
- 根因：`request-progress-model.mjs` 的 `roundForRequest` 取「匹配数组的最后一个」——批次顺序不由模型保证，
  等价于**任意挑一批**。实测 `req_ac89ea2c` 链了 4 批（完成 3/3、完成 1/1、失败 0/3、失败 0/3），
  被挑到没有运行的那批 → 显示「已确认 · 正在准备出图」，而同一张卡的回复却说「三张已出齐」。
- 改法（全部来自已有事实）：`roundForRequest(request, rounds, runs)` 按
  **① `resultRoundId` 权威指向 → ② 有在跑运行的那批 → ③ 运行最新的那批 → ④ 最近创建的批次**。
- 再加一条语义修正：**结单且带回复、又没有 `resultRoundId`** 时，卡片只说「已完成」——
  回复本身就是结果，不再叠一条会打架的批次进度（`replyText` 同时复用到 `withdrawn` 判定，去重了一处内联解析）。
- 守卫：`request-progress` 从 12 条扩到 14 条（多批次选址 4 种情形 + 带回复结单不叠进度），**14/14**。

**② H1 资产管理退后台（补做，上次漏了）**
- 新增单一来源 `web/src/asset-backstage-copy.mjs`：`ASSET_BACKSTAGE_COPY`
  =「这里是资产后台：导入、整理、回收与跨项目共享；挑图在画布的批次旁边做。」
- 资产页顶部渲染它（只加强调用与文案，**不删任何能力**——红线 2.4）。
- 守卫 `asset-backstage`：文案含「资产后台 / 导入整理回收 / 画布」、不出现黑话；**且全 `web/src` 只有一个来源**
  （防漂移，同 `boundary-copy` 的做法）。**2/2**。

**浏览器实测**：资产页显示后台说明；多批次请求卡片变为「已完成 + 回复原文」，不再出现矛盾的进度。

**验证**：`lint` 0 error；双端 typecheck + `build` 通过；**全套 826 项 → 824 通过 / 0 失败 / 2 跳过** ✅

### 2026-09-19 · **完整性复核（刀哥要求）：结论 = 未 100%**

按施工单逐条核对（跑守卫、查代码、看工作区），**7 个本批守卫全绿**、全套 826 项 824 通过 / 0 失败。
但**不能记「全部完成」**，如实列出三项缺口：

| # | 缺口 | 事实 | 性质 |
|---|---|---|---|
| 1 | **P4 只完成一半** | `providerOutageCopy` 只被 `not_configured` 调用；`all_providers_down` / `disk_full` **没有信号源、没有首屏级提示**（§5 清单与 §2 的 P4 都要求）。验收清单第 9 条**未满足** | **真缺口**，需补后端分类 + 首屏接线 |
| 2 | **P1 的界面路径未复验** | 保存/切换自动测只做了模型单测 + 接线复核；**没做真改 provider 的浏览器实测**（会打真实网络且改 live 配置） | 验证缺口（功能已接） |
| 3 | **S 组 9.7（可选）未做** | 决策 D3 只把 9.8 推给第 4 批；9.7「失败原因→建议映射」标为**本批可选** | 可选未做（计划允许） |

**另外两项如实记录**：
- **刷新还原**未针对本批新增状态重验（本批新增的只有浏览器侧配置与瞬时选中，无领域影子状态；批 2 已验过总原则）；
- **守卫覆盖与 §0.1 的差异**：§0.1 原写「扩展 `request-queue-ui` / `provider-settings-ui` 的断言」，
  实施时改为**新建更贴行为的桩**（`canvas-request-context` / `provider-connection-model` /
  `provider-runtime-model` / `provider-runtime-state`），行为覆盖等价，但**这两个既有文件的断言没动**。

**工作区状态**：本批 15 个改动文件 + 14 个新文件**全部未提交**；另有
`tests/vnext/agent-detect.test.js` 一处**非本批**改动（Windows 路径身份修正：探针夹具按平台解析路径，
避免 win32 下把「找不到家目录」误报成回归）也未提交——按纪律**提交前需刀哥确认归属**。

**结论（2026-09-19 更新）**：**P4 已按刀哥要求补完**（见下节），G / H / T / P1–P4 完成；
P1 的界面实测**刀哥决定不做**（属网络问题，他自己修）；S 组 9.7 仍是「可选未做」。

### 2026-09-19 · **P4 补完（整层故障的首屏级提示）**

**分工：服务端只给事实，前端做分类**（避免同一套关键词两个进程各写一遍）：
- 新增 `src/vnext/domain/provider-outage.ts`：`recentRunOutcomes(db, { studioId })` 给**最近几次终态运行**
  （completed / failed / partial / cancelled）与**首条错误摘要**，拼链走 `joinInStudioSql`（不手写 JOIN），
  并按 Studio 隔离（换了 Studio 什么都读不到，有守卫）。接进 `GET /api/providers` 的 `recentOutcomes`。
- 前端 `failure-copy-model.mjs`：
  - 把**磁盘签名**（`enospc` / `no space left` / `disk full` / `not enough space`）并入 `SYSTEM_SIGNALS`——
    此前磁盘满会掉进「原因没写明」，让用户白改一通描述（顺带修掉 4.10 的一处归因缺口）；
  - 新增 `providerOutageKind({ recentOutcomes })`：**最近 N 次里只要有一次成功或一次取消就不算全挂**
    （成功说明服务活着；取消是用户自己的决定）；全失败且摘要都指向磁盘 → `disk_full`；
    全失败且归因都是系统 → `all_providers_down`。分类复用 `failureAttribution`，关键词只有一份。
- 界面：首页级 `provider-outage-strip`（`role="alert"`）渲染 `providerOutageCopy`，与队列底栏的
  限流提示（P3）分工不同——一个是「整层不可用」，一个是「能用但慢了」。

**守卫**：`provider-runtime-state` 从 4 条扩到 **7 条**：判定只认事实（成功/取消不算全挂、磁盘单独归类、
用户问题不误报系统全挂、次数不够不下结论）、服务端事实与 Studio 隔离（真跑一整套 project→task→round→run）、
首屏提示真的渲染且服务端已接。

**浏览器实测**：真实 `/api/providers` 带出 5 条 `recentOutcomes`；健康时**不出条**；
强制两次系统失败 → 「生成服务现在都连不上…别反复点重试。」；强制磁盘签名 → 「磁盘空间满了…这一批不用重试。」

**验证**：`lint` 0 error；双端 typecheck + `build` 通过；后端换真进程加载（pid 64730）；
**全套 829 项 → 827 通过 / 0 失败 / 2 跳过** ✅

### 决策点（2026-09-18 刀哥已拍板）

- **D1 · derive 走哪条路？** → **本地草稿**（与 `openDerivedRoundDialog` 现有能力一致，符合方案 4.3；队列留给「真正要花钱的出图」）。
  实现：`derive-path-model.mjs` 的 `DERIVE_PATH = 'draft'`；节点菜单 `canDerive` 打开后复用本地草稿路径，**删掉/禁用另一条**。
- **D2 · 退避状态卡落点？** → **先在队列底栏状态行里加一格**（与 agent 在场卡同处，零新入口）；将来要独立系统面板再迁移。
- **D3 · 9.8「理解说明」字段？** → **随第 4 批 4.1 一起**（同源，避免动两次协议）。本批 **S 组只保留 9.7**（可选，skill 侧）。
- **D4 · T1（A11 读侧迁移）搭车？** → **搭车做**（对拍守卫，风险可控），对应 0.3 第 9 条桩。