# daoge-pic 以人为本升级 · 第 4 批施工单

> **本文件在套装中的位置**：方案文档 = 宪法（为什么改 / 改成什么）；规格书（`daoge-pic-upgrade-spec-zh.md`）= 法律（跨批次不变的规矩）；
> **本文件 = 行政命令**，定「这一批做什么」。**施工单不得违背规格书；规格书不得违背方案。**
>
> **本批是否触发规格书改动：⚠️ 是（仅一处，且必须最先做）**——`sessions.context` 的角色收口属**鉴权不变量**变更，
> 规格书 §2.2 明写「本次只动一条（pause/cancel）」；把它改成 bearer-only 是**第二处边界改动**。
> 按从属纪律：**先改规格书 §2.2，再动实现**；改不了就整项移出本批（见决策点 D2）。

---

## 进度快照（**每次做完一组就在这里更新一行；换会话时先读这一节**）

| 日期 | 进度 | 下一步 |
|---|---|---|
| 2026-09-19 | **施工单编制完成（未开工）**。第 3 批已收束并推送（`77c4c9c`，`main` 与 origin 同步）。本批 = **B（出图问法倒过来，4.1）** + 四个小项（9.8 / 9.7 / 9.6 / `sessions.context`）+ T1 补完；**不含** UI 重设计（见下） | 刀哥拍板 D1–D4，再写 0.3 守卫桩 |
| 2026-09-19 | **决策 D1–D4 已拍板**（按建议）；**规格书已改**（§1 协议 `3.1.0` 加法、§2.2 追加 `sessions.context` → bearer）；桩接口约定已定 | 写 0.3 守卫桩并确认红 |
| 2026-09-19 | **0.3 守卫桩写完并确认红**：7 个新测试文件 + `route-authorization` 扩 1 条 = **8 条桩 / 20 条断言，19 红 1 绿**（绿的那条是**有意锁住的不变量**：预检本就忽略未知字段，加入「理解说明」不改变计划）。`lint` 0 error | 动代码：先 Q 组（回执与问法），再 C/M/X |
| 2026-09-19 | **Q 组完成 → 回执与问法落地** 🎉 卡片给出人话回执 + 「就这么出 / 改一下」（两个动作都实测有真去处）；建批次默认不再出「目的问卷」，`改一下` 展开全部 5 项；父批次改成显式必答。**全套 850 项 → 838 通过 / 10 失败 / 2 跳过**，10 = C/M/X 尚未实现的桩（预期）。见第 8 节日志 | 开 C 组（理解说明 / 失败建议） |
| 2026-09-19 | **C + M + X 组完成 → 第 4 批功能收齐** 🎉 协议升 **3.1.0**（9.8 加法字段，旧 agent 兼容）+ 理解说明进检查器；失败「原因→建议」映射（词表与前端对拍）；我的配方（存得下 / 带得出 / 不自动执行）；`sessions.context` 收成 bearer；`queries.ts` 手写链收口并补上缺失的 studio 谓词。**全套 851 项 → 849 通过 / 0 失败 / 2 跳过** ✅ | 提交（需与另一会话的侦查改动分开） |
| 2026-09-19 | **跨批修：agent 宿主覆盖扩到主流一档**（连接面板侦查 + `register-skill --host`）；本机实测 15 个宿主认出 7 个（含 omp / pi / opencode）。⚠️ 刀哥一眼抓出两处「把 IDE 当 CLI」的编造，已修并补守卫。见第 8 节 | 继续 Q 组（回执与问法） |

> **本批不做（刀哥 2026-09-19 明确）**：**Studio 的界面重设计与布局**（创作台、agent 对话形态）。
> 那是独立主题，等这批功能落完再单独立项；本批**不改**创作台/对话的信息架构，只动「问法与回执」这一处流程。

---

## 0. 前置

### 0.0 本批的性质

- **不是收尾批**：不跑规格书 §8 完整 DoD；只跑落在本批的条目（见第 6 节）。
- **不动 schema**：预期 `STUDIO_SCHEMA_VERSION` 保持 41；若实施中确需新列 → **停下改方案**。
- **不动版本**：`6.0.0` / 协议 `3.0.0` **仍未发布**（刀哥 2026-09-19：人工细节测试与界面重设计未完成，不发）。
  本批**唯一可能动协议**的是 9.8（新增**可选**字段，属加法）——**是否顺手升 `3.1.0` 由 D3 定**。

### 0.1 本批会破坏的守卫（先写桩，再动代码）

| 守卫 | 为什么会红 | 处理 |
|---|---|---|
| `terminology-guard.test.js` | 去问卷后可发现「轮次目的」术语的呈现方式变了 | **改**：术语单与三面隔离随文案同步（不删条目） |
| `source-text-guard.test.js` | `main.jsx` 的问卷结构与回执文案 | **改**：逐条核对（文本变了断言跟着变，**不许删断言**） |
| `lineage-menu.test.js` / `lineage-inspector.test.js` | 回执要能从批次节点进确认 | **复核**：入口变化即扩展 |
| `request-queue-ui.test.js` | 请求卡片新增「回执」形态与「就这么出 / 改一下」 | **改**：新增回执形态与两个动作的断言 |
| `request-progress.test.js` | 卡片的阶段另加「计划已就绪 · 待确认」外的回执态 | **复核**：以扩展为主，不许放宽 |
| `protocol-contract.test.js` / `skill-startup-contract.test.js` | 9.8 若动协议与 `SKILL.md` | **改**：随协议版本与契约同步（若 D3 定升级） |
| `preflight` 相关（`runner.test` / `preflight-*`） | `PreflightPlan` 新增字段 | **改**：断言新字段可空、不破坏旧计划 |

### 0.2 本批会触及、需逐条复核的守卫（规格书 §3.2 的「其余按批核对」）

- `studio-scope` / `provenance-contract`（T1 补完会动 `queries.ts` 的拼链——**必须**改走 `joinInStudioSql` / `selectInStudioSql`）
- `route-authorization.test.js`（X1 若动 `sessions.context`）
- `phase4-navigation-registry.test.js`（若「我的配方」新增入口）
- `cli-contract.test.js`（若 9.7 落到 CLI 侧的可查清单）
- `provider-settings-ui.test.js`（不预期触及，把「我的配方」与 provider 配置分清楚）

### 0.3 新增守卫桩（本批必须新建，先写成 fail）

1. **回执形态**（Q1）——批次处于待确认时，请求卡片给出**人话回执**（「我准备这么出：…」）与两个动作：**就这么出 / 改一下**；
   两个动作都要有真实去处（不许只弹一句话）。
2. **确认闸门不松动**（Q1）——「就这么出」**只能由 cookie 走既有确认闸门**；agent 的 bearer **任何情况下**都不能代替确认（规格书 §2.3）。
3. **上一批是必答题**（Q2）——回执里「有没有上一批」必须**明示且可否决**；猜错代价高，不许静默推断。
4. **去问卷**（Q2）——建批次不再要求先认领 5 个「轮次目的」之一；**但「改一下」展开后那套控件一个都不少**（红线 2.4）。
5. **理解说明字段**（C1 / 9.8）——`PreflightPlan` 的新字段**可空**；旧计划（无此字段）读取不报错；检查器能显示它。
6. **失败建议映射**（C2 / 9.7）——「原因 → 建议」是一份**机器可查**的映射（额度→充值；审核→换词；网络→等），
   且与「归因只认两类信号」的既有判据一致（不新造第三套关键词）。
7. **我的配方**（M1 / 9.6）——用户能把一次可用的配置存为「我的配方」（跨项目），并在下次发起时**可被带出且可改**；
   带出**不自动执行**（不越过确认闸门）。
8. **`sessions.context` 角色**（X1，⚠️ 依赖 D2）——改为 **bearer-only**（agent 独占），且界面选中态完全由路由承载；
   若 D2 不通过，本桩整体移出。
9. **T1 补完**（X2）——`queries.ts` 不再手写 JOIN 链（改走 `joinInStudioSql` / `selectInStudioSql`）；
   task / round 作用域**如实记录**为何仍需关系链（列里只有 project，没有 task/round）。

**桩的接口约定**（D1–D4 已拍板；实现必须与守卫同名同形，否则「桩绿了、功能没接」）：

| 桩 | 新增/扩展 | 接口 |
|---|---|---|
| 1 | 扩展 `web/src/request-progress-model.mjs` | `receiptFor({ request, round, plan })` → `{ ready, lines }`（人话回执行） |
| 2 | 新增 `web/src/confirmation-entry-model.mjs` | `confirmationEntry({ hasChallenge, roundStatus })` → `{ open, via: 'gate', reason }`（**只允许走闸门**） |
| 3 | 扩展同一回执模型 | `parentDecision({ parentRoundId, suggestedParentId })` → `{ required: true, suggested, revocable: true }` |
| 4 | 新增 `web/src/plan-questionnaire-model.mjs` | `questionnaireVisible()` · `advancedControls()`（「改一下」展开的控件清单，**一个都不删**） |
| 5 | 扩展 `src/vnext/runner/preflight.ts` + 新增 `web/src/plan-understanding-model.mjs` | `PreflightPlan.understanding?: string`（可空）· `understandingNote(plan)` → 人话行 |
| 6 | 新增 `src/vnext/skill/failure-advice.ts`（SKILL.md 同步一份人读表） | `failureAdvice({ status, summary })` → `{ owner, advice }`（复用既有判据，不新造关键词） |
| 7 | 新增 `web/src/recipe-model.mjs` | `recipeDraftFrom({ plan, task })` · `recipeSuggestion({ recipes, brief })`（带出且可改，**不自动执行**） |
| 8 | 扩展 `src/vnext/api/route-authorization.ts` | `sessions.context` 登记为 `bearer`（⚠️ 先改规格书 §2.2） |
| 9 | 扩展 `src/vnext/domain/queries.ts` | 不再手写 JOIN 链（改走 `joinInStudioSql` / `selectInStudioSql`） |

### 0.4 环境与影响提示

- 前端改动刷新即生效；**后端改动必须换真进程**（先查 `generation_runs` 无 `queued/running/pausing` → `kill` → `open`）。
- **本批动的是「出图问法」**，属高频路径：改完**必须**用真实浏览器把「说一句 → 回执 → 就这么出 → 确认 → 预检」整条走一遍。
- ⚠️ **域名解析（fake-ip）未修好**：真实出图仍会被出站守卫拦下（第 3 批 T2 的实测结论）。
  本批验收**以「到预检为止」为准**，不把真实出图算作本批门槛。

---

## 1. 目标（可验收的一句话）

**用户不必先认领五个「轮次目的」术语，也能出图**——说一句，agent 把「我准备这么出」摆回来（含「有没有上一批」这道必答题），
点「就这么出」走原有确认闸门，点「改一下」展开今天那套控件；**同时把三个小项收掉**（理解说明、失败建议、我的配方），
并把 T1 的读侧拼链补完。

---

## 2. 任务分解

### Q 组 · 问法与回执（方案 4.1；本批主任务）

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **Q1** | **回执 + 就这么出 / 改一下** | `web/src/request-queue.jsx`、`main.jsx`（`openGenerationConfirmation` / 计划摘要）、`web/src/request-progress-model.mjs` | 批次待确认时，卡片给**人话回执**（沿用既有 `confirmationPlanSummary` 的口径），两个动作**各有真去处**：「就这么出」→ 既有**确认闸门**（cookie-only，绝不旁路）；「改一下」→ **展开现有控件**（一个都不删） | 4.1 / 4.5 / 规格书 §2.3 |
| **Q2** | **去问卷：purpose 交给 agent 推** | `main.jsx`（`ROUND_PURPOSE_OPTIONS` 与建批次对话框）、`SKILL.md`（会话工作法） | 建批次**不再要求先选** 5 个目的之一；推断方是 **agent**（`plan_json` 本来就该带 `purpose`），前端不硬编码规则。**不动**：`purpose` 字段、5 个枚举、默认参数、后端契约、表结构 | 4.1 |
| **Q3** | **「有没有上一批」必问** | `main.jsx`（`shouldSuggestParent` 一带）、回执渲染 | 唯一**必须问**的结构性判断：明示 + 可否决（现散在「父轮次下拉 + shouldSuggestParent」两处） | 4.1 |

### C 组 · 契约与 skill 小项

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **C1** | **计划契约「理解说明」**（9.8） | `src/vnext/runner/preflight.ts`（`PreflightPlan`）、`SKILL.md` 会话工作法第 3 条、检查器 | 新增 3–5 句**结论性说明**（不是推理链）：**可选**、旧计划读取不报错、检查器可查。⚠️ 是否顺手把协议升 `3.1.0` 由 **D3** 定 | 9.8 |
| **C2** | **失败原因 → 建议动作映射**（9.7） | `SKILL.md`（或 skill 侧清单）、复用 `failure-copy-model` 的判据 | 把「额度→充值 / 审核拒→换词 / 网络→等」落成**机器可查**的一份映射，agent 接重试单查表不走脑子；**关键词不新造一套** | 9.7 / 4.10 |

### M 组 · 我的配方（9.6）

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **M1** | **存为我的配方 → 下次带出** | `web/src/main.jsx`、`src/vnext/api/server.ts`（`confirmed-templates` / `style-kits` / `brand-kits` 已存在）、检查器/发起处 | 用户侧跨项目复用：把一次可用的配置/风格存为配方；下次发起时**带出且可改**（不带出=空谈，自动执行=越闸门）。能力只加强不删 | 9.6 / 7.10 |

### X 组 · 收口（含一处需先改规格书）

| # | 任务 | 涉及文件 | 要点 | 依据 |
|---|---|---|---|---|
| **X1** | **`sessions.context` 角色收口**（⚠️ **依赖 D2**） | `route-authorization.ts`、`route-authorization.test.js`、`SKILL.md`、**规格书 §2.2（先改）** | 目标：**bearer-only**（agent 独占），界面选中态完全由路由承载（第 2 批已做）。**属不变量变更**：先改规格书，再动实现；改不动就整项移出 | 规格书 §2.2 / 第 2 批开放项 |
| **X2** | **T1 补完（读侧拼链）** | `src/vnext/domain/queries.ts`（`listRuns` / `getLatestRun` 等手写链）、`assets.ts`（task/round 作用域） | `queries.ts` 改走 `joinInStudioSql` / `selectInStudioSql`（studio-scope 守卫盯着）；task/round 作用域**如实记录**为何仍需关系链（`assets.project_id` 只到项目一级），能用列做先导过滤就做 | 7.7.1 / 第 3 批 T1 |

### 收尾

双端 typecheck → `npm run lint` 0 error → 全套回归（`npm test`）→ `npm run build` → `cmp` 线上产物与磁盘 → **只 commit 不 push**。

---

## 3. 守卫变更（汇总）

- **改**：`terminology-guard`（Q2 文案）、`source-text-guard`（Q 组）、`request-queue-ui`（Q1）、`protocol-contract` / `skill-startup-contract`（C1，若 D3 定升协议）、`route-authorization`（X1，若 D2 通过）、`preflight` 相关。
- **复核**：`lineage-menu` / `lineage-inspector`、`request-progress`、`studio-scope` / `provenance-contract`、`phase4-navigation-registry`、`cli-contract`。
- **新增 9 条桩**（见 0.3）；其中第 8 条依赖 D2，第 5 条依赖 D3。

---

## 4. 迁移或切换步骤（**本批无 schema 迁移**）

1. **无数据迁移**；若实施中确需新列 → 停下改方案。
2. **前端刷新即生效**；**后端**（X2 / M1 若动服务端）换真进程。
3. **回滚**：前端回退 bundle / 后端 kill + 起旧进程；`studio.db` 原地不动。
4. ⚠️ **本批回滚风险点**：Q 组动的是高频路径，回滚要同时回退「问法」与「回执」两端，**不要只回一端**（会出现「没有回执也没有问卷」的空档）。

---

## 5. 验收清单

- [ ] **说一句就能出图**：不必认识 5 个「轮次目的」，说一句话即可发起
- [ ] **回执可读**：卡片给出「我准备这么出：上一批是… / 出 N 张 / 改什么保持什么」，人话、无术语
- [ ] **就这么出**：一键进既有确认闸门（cookie）；**agent 的 bearer 依旧确认不了**
- [ ] **改一下**：展开今天那套控件，**一个都不少**（红线 2.4）
- [ ] **上一批必问**：回执明示「承接哪一批」，且**可否决**
- [ ] **理解说明**（9.8）：检查器能看「它为什么这么理解」，旧计划不报错
- [ ] **失败建议**（9.7）：重试类请求能看到「原因 → 建议」，建议与归因口径一致
- [ ] **我的配方**（9.6）：存得下、下次带得出、**不自动执行**
- [ ] **X1**（若做）：`sessions.context` bearer-only，界面选中态仍由路由承载
- [ ] **X2**：`queries.ts` 不再手写 JOIN 链；task/round 为何仍用关系链有书面结论
- [ ] **真实浏览器**：说一句 → 回执 → 就这么出 → 确认 → 预检（**到预检为止**，真实出图受 fake-ip 限制不算门槛）
- [ ] `tsconfig` 双端 0 错；`lint` 0 error；全套回归绿
- [ ] **四条红线逐条过**（规格书 §2）

---

## 6. 端到端检查

**本批不是收尾批**，不跑规格书 §8 完整 DoD。落在本批的条目：

- **DoD 2 的「回执」那一半**（「说一句 → 收到回执 → 就这么出」）——这是本批的核心验收；
- **DoD 2 的「双击空白建任务」**已在第 3 批 G2 完成；
- **红线 2.4**——Q2 是「换问法」不是「删控件」：改一下展开后必须一个不少。

---

## 7. 开放项销账

| 项 | 本批如何覆盖 |
|---|---|
| **方案 §5.3 四批：出图问法倒过来** | Q1–Q3 |
| **9.8 理解说明字段** | C1（随 4.1 一起做最省，正是第 3 批 D3 的记录） |
| **9.7 失败原因→建议映射** | C2 |
| **9.6 我的配方** | M1 |
| **`sessions.context` 角色**（第 2 批开放项 4） | X1（需先改规格书） |
| **第 3 批 T1 补完** | X2 |
| **发布动作（CHANGELOG / 证据段 / `test:package`）** | **不做**（刀哥：人工测试与界面重设计未完成，不发版） |
| **Studio 界面重设计（创作台 / agent 对话）** | **不做**（本批只管功能；下一阶段单独立项） |
| **域名解析 fake-ip** | 环境问题，刀哥自修；本批不碰信任模式 |

---

## 8. 实施日志

### 2026-09-19 · 施工单编制完成（未开工）

- 依据方案 §4.1 / §4.5 / §7.10 / §9.6–9.8、规格书 §2 / §3、第 1–3 批实施日志编制。
- **编制前的进度核对（对着代码，不只看文档）**：
  - 目的问卷（`ROUND_PURPOSE_OPTIONS`）与建批次对话框**仍在**（`main.jsx`），4.1 未做；
  - `PreflightPlan` 只有 `operation / itemCount / prompt / itemPrompts / referenceAssetIds / maskAssetId / output`，**没有**理解说明字段（9.8 未做）；
  - 配方底子齐：`confirmed-templates` / `style-kits` / `brand-kits` 的读写端点都在（9.6 有地基）；
  - T1 只迁了 **project** 作用域；`queries.ts` 仍手写 JOIN 链（X2 的由来）。
- **未开工**，无实测偏差。

### 2026-09-19 · **规格书修订 + 0.3 守卫桩确认红**

**规格书两处修订**（属不变量变更，按从属纪律先改法律）：
- §1：Skill 协议 `3.0.0` → **`3.1.0`**（9.8 的 `understanding` 是**加法**；仍在 `>=3.0.0 <4.0.0`，
  3.0.0 的 agent 保持兼容）。
- §2.2：追加 **`sessions.context` → `bearer`（agent 独占）**，写明理由（它记的是 agent 的操作上下文；
  界面选中态已由路由承载；两侧都能写必然互相覆盖）与连带（`route-authorization.test.js` + `SKILL.md` 第 35 行）。

**0.3 守卫桩（8 条桩 / 20 条断言，19 红 1 绿）**：

| 文件 / 位置 | 覆盖桩 | 结果 | 红的原因 |
|---|---|---|---|
| `request-receipt.test.js` | 1 回执 · 3 上一批必问 | 3 红 | `request-progress-model` 无 `receiptFor` / `parentDecision` |
| `confirmation-entry.test.js` | 2 确认只走闸门 | 3 红 | `confirmation-entry-model.mjs` 不存在 |
| `plan-questionnaire.test.js` | 4 去问卷 | 2 红 | `plan-questionnaire-model.mjs` 不存在 |
| `plan-understanding.test.js` | 5 理解说明 | 1 绿 2 红 | 绿＝**有意锁住**「旧计划照跑、说明不改计划」；红＝类型契约无 `understanding`、展示模型不存在 |
| `failure-advice.test.js` | 6 失败建议映射 | 3 红 | `src/vnext/skill/failure-advice.ts` 不存在 |
| `recipe-model.test.js` | 7 我的配方 | 3 红 | `recipe-model.mjs` 不存在 |
| `route-authorization.test.js`（扩 1 条） | 8 `sessions.context` bearer | 1 红 | 该路由仍未被登记 |
| `queries-scope-chain.test.js` | 9 T1 补完 | 1 红 | `queries.ts:134` 仍手写 `JOIN creative_tasks task ON …` |

**一处测试自身的修正（记录）**：`plan-understanding` 第一版按 `result.ok` 断言，而契约是 `{ valid, issues, normalizedPlan }`——
**桩红的原因错了就是假红**，已按真实契约改写，改后那条转为有意绿。

`lint` 0 error。

### 2026-09-19 · **跨批修：agent 侦查扩到主流宿主 + `register-skill --host`**

**起因（刀哥）**：连接面板只认 workbuddy / codex / claude 三家，「支持的品类太少」，要求至少兼容主流
（opencode / pi / omp / grok 等）。

**改动**（先改守卫，再动实现）：

- `src/vnext/domain/agent-detect.ts`：宿主表 3 → **15 家**；每家的家目录与 skills 目录改成**候选列表**——
  XDG（`~/.config/opencode/skills`）、agent 目录（`~/.omp/agent/skills`、`~/.pi/agent/skills`）、
  antigravity 的三处（CLI `antigravity-cli` / 2.0+IDE `config` / 老版 `antigravity`）各按**第一处存在的**报告，
  但「含 daoge-pic」按**任意一处**判定。共享目录补第二个别名 `~/.config/agents/skills`。
- `register-skill --scope user --host <宿主>`：缺省 `codex`（老行为不搬家），`agents` = 跨宿主共享目录；
  未知宿主在 **flag 解析阶段**就拒绝并列可用值（不会新建目录）；`--help` 直接列出宿主名单。
- 连接面板（`agent-connection-model` + `request-queue.jsx`）：装了的排前面，未检测到的**收成一行名字**
  （名单本身就是「支持哪些」的答案）；「没找到 daoge-pic」的指引改成 `--host` 的说法。

**本机实测**（真实 daemon + 真实浏览器，临时 Studio；验完已按受控端点关闭）：
15 个宿主里认出 **7 个**——workbuddy / codex / claude / opencode / gemini / **omp** / **pi**；
面板渲染为「检测到 7 个 agent CLI · daoge-pic 已装载（至少一处）」+ 7 行明细 +
「另有 8 个未检测到：Antigravity CLI（agy）、grok、cursor-agent、qwen、kimi、amp、droid、copilot」。
`register-skill --host omp` / `--host agents` 用临时 `HOME` 实跑，落点分别是 `~/.omp/agent/skills/daoge-pic`
与 `~/.agents/skills/daoge-pic`，符号链接解析回安装包；`--host nope` 退出码 1 并列可用值。

**⚠️ 刀哥一眼抓出来的两处编造（已修，守卫已补）**：他问「agy 是个什么，我怎么没听说过」——查下去发现
这一版把**IDE 的目录当成了 CLI 的家**：

- `agy` 的家目录候选里有 `~/.gemini/antigravity`（那是 **Antigravity IDE / 2.0 的数据目录**），
  而他机器上 `~/.local/bin/agy` 与 `~/.gemini/antigravity-cli` **都不存在** —— 面板却报「agy 已装」。
  现在只认 CLI 自己的 `~/.gemini/antigravity-cli`；行名补 `label`：面板显示 `Antigravity CLI（agy）`，
  并在明细里写出「命令 agy 不在 PATH」，不再让人对着一个不认识的词猜。
- `gemini` 的家目录写的是 `~/.gemini`，而这个目录被 Antigravity 全家共用 → Antigravity-only 的机器会被
  误报「装了 Gemini CLI」。现在只认 Gemini CLI 自己的 `~/.gemini/commands` 与 `~/.gemini/skills`。
- 规则收进表头注释：**家目录只写这个宿主自己的目录；同厂产品共用的目录不许当证据**；
  新增守卫 `IDE 的数据目录不许当「装了 CLI」的证据` 钉死这条。

**边界（有意为之）**：Antigravity 的 **IDE / 2.0**（`~/.gemini/config/skills`）不进表——它不是能从终端唤起的
CLI。要让它也出现在面板里、也能装，加一行即可（刀哥定）。

**验证**：`agent-detect` / `agent-connection-config` / `cli-contract` / `request-queue-ui` / `source-text-guard`
全绿；win32 路径语义下 `agent-detect` 亦绿；`lint` 0 error；`typecheck:vnext` + `typecheck:web` + Workbench 构建通过；
全套 849 项 → 829 通过 / **18 失败 / 2 跳过**，18 条失败**全是本批 0.3 的桩**（与本改动无关）。

### 2026-09-19 · **Q 组完成（回执与问法）**

**三个纯模型 + 接线**（守卫 `request-receipt` 3/3、`confirmation-entry` 3/3、`plan-questionnaire` 2/2 全绿）：

- **Q1 回执 + 就这么出 / 改一下**：
  - `request-progress-model` 新增 `receiptFor`（人话回执：有没有上一批 / 几张 · 规格 / 改什么保持什么），
    并在「待确认」阶段随进度一起给出；卡片渲染成清单。
  - 新增 `confirmation-entry-model`：**可不可以开闸门、开不了怎么跟人说**的单一来源；
    `openGenerationConfirmation` 改用它（状态不符 / 没有挑战都由它给理由），
    确认动作仍走既有闸门（cookie-only + 计划哈希/版本/会话绑定）——**没有第二条路**。
  - 「改一下」不是又一个「看这一批」：主组件记一个 `pendingPlanEditRoundId`，画布拿到对应节点后
    **打开计划编辑器**（跨组件只传 id，不暴露画布内部状态）。
- **Q2 去问卷**：新增 `plan-questionnaire-model`（`questionnaireVisible` / `advancedControls` / 默认「从零探索」）。
  建批次对话框默认**不再出现**目的问卷，改出一句「系统会按你的描述判断批次目的；想自己定，点『改一下』」；
  `改一下` 展开后**五个选项一个都不少**（红线 2.4）。
- **Q3 上一批必问**：`parentDecision`（`required` + `suggested` + `revocable`）；对话框里父批次的标签改成
  「父批次（这一批有没有上一批？必答，可改）」，建议仍可否决。

**随 Q1 更新的三处既有守卫**（§0.1 预告，**扩展而非放宽**）：
`confirmation-challenge-read`（无挑战的指引改到模型上断言）、
`request-progress` 第 11/14 条（入口文案与「每一条出口都有话说」改到模型上断言）。

**真实浏览器实测**（造了一个真实夹具：请求 → 接单 → 批次写计划 → `awaiting_confirmation` → 确认挑战）：
- 卡片回执：「从零开始（没有上一批）」「出 4 张 · 4:5」+ 两个按钮；
- 「就这么出」→ 打开既有**确认对话框**（「确认这版计划（v2）？…先核算，再出图」）；
- 「改一下」→ 打开**计划编辑**（「改计划 · 计划 v2」）；
- 建批次默认态：无问卷、有说明、父批次为必答；点`改一下`后五个选项全部出现。

**记录（并发）**：实施期间**另一个会话在同一工作区改了 agent 侦查**（`agent-detect.ts` +101、
`agent-connection-model.mjs`、`SKILL.md`、`README.md`、`cli/daoge.ts`、`register-skill.ts`、`cli-contract.test.js`
与两个测试文件，新增 omp/agy/pi 宿主、`installedRows`/`missingNames`、`--host`）。那些改动**不属于本批**、
实施一度让全量出现 4 条无关红；Q 组完成时它们已自行转绿（对方做完了）。**提交时必须分开**，不得混入本批提交。

### 2026-09-19 · **C + M + X 组完成**

**C1 · 计划「理解说明」（9.8，协议 3.1.0）**
- `PreflightPlan` 新增**可选** `understanding?: string`（3–5 句结论性说明；不是执行参数、推理链不进库）。
- **协议 3.0.0 → 3.1.0**（`SUPPORTED_PROTOCOL_RANGE` 保持 `>=3.0.0 <4.0.0`——**3.0.0 的 agent 仍兼容**，
  这也是 D3 的承诺）。同步的硬编码点：`shared/protocol.ts`、`protocol-version.json`、
  `web/src/version-negotiation-model.mjs`（前端唯一声明处）、`SKILL.md`（两处）、`scripts/package-smoke.js`、
  以及 `protocol-contract` / `protocol-version-consistency` / `skill-startup-contract` / `cli-contract` /
  `package-smoke` / `backup-restore-apply` 六个测试。
- ⚠️ **顺带发现并修掉**：`backup-restore-apply` 的夹具与 `queries/search` 一样写着版本字面量——
  改成**读单一来源**（`SKILL_PROTOCOL_VERSION`），下次协议升级不会再漏。
- 新增 `plan-understanding-model.mjs`（`understandingNote`：没有就返回空串，不硬凑）；检查器「过程资产」里显示。
- **浏览器实测**：给夹具计划写入 `understanding` 后，检查器显示「理解为：延续你上一批的光影取向，只改背景色温；主体与构图保持不变。」

**C2 · 失败「原因 → 建议」映射（9.7）**
- 新增 `src/vnext/skill/failure-advice.ts`：**先看具体原因（额度 / 磁盘），再看大类（系统 / 我的）**——
  额度问题往往也报成 `blocked`，先按大类走就会被说成「内容被挡」，把人引去改描述（白改一通）。
- 词表与前端 `failure-copy-model.mjs` **逐值对拍**（沿用「两份 + 守卫」法，与 `purpose-labels` 同）；
  `failure-copy-model` 相应导出 `SYSTEM_SIGNALS` / `MY_SIGNALS` / `DISK_SIGNALS`。
- `SKILL.md` 的运行恢复节补上人读表。

**M1 · 我的配方（9.6）**
- 新增 `recipe-model.mjs`（`recipeDraftFrom` / `recipeSuggestion`）。
- ⚠️ **一处设计选择（记录）**：`confirmed-templates` 是 **bearer-only**（浏览器读写都会被拒），
  所以配方落在**用户可读写的库** `style-kits` 上（未登记鉴权 = 两者皆可），
  不越权、也不为此多绕一条队列。
- 接线：检查器「过程资产」加「存为我的配方」；建批次对话框里列出已有配方，
  **点一下把配置带进「本轮目标」，可改**（带出 ≠ 自动执行）。
- **浏览器实测**：保存后 `style-kits` 从 1 条变 2 条并给「已存为我的配方「…」」；建批次对话框出现配方 chips；
  点一下 brief 被带出成该配方的提示词。

**X1 · `sessions.context` 收成 bearer（规格书 §2.2 已先改）**
- `route-authorization.ts` 新增 `sessions.context` 规则（actor `bearer`）；前端**早已不再写它**（第 2 批已交还路由），
  `SKILL.md` 第 35 行的措辞也已就位，所以这次只差这张表。
- 测试同步：`BEARER_ONLY` 的片断改成实际文案；从 `COOKIE_WRITABLE` 移出该端点（**接口语义确有变更**，不是放宽）。

**X2 · T1 补完（读侧拼链）**
- `queries.ts` 的 `listRounds` / `listRuns` / `getLatestRun` 与搜索里的**四个相关子查询**全部改走
  `joinInStudioSql` / `selectInStudioSql`。
- ⚠️ **顺带修掉一个真隐患**：那四个子查询**原本没有 `project.studio_id` 谓词**（靠外层查询兜着）——
  手写链的风险正是「靠人记得补谓词」。现在每个子查询自己带上谓词，并由 `queries-scope-chain` 守卫盯着。

**验证**：`lint` 0 error；双端 typecheck + `build` 通过；**全套 851 项 → 849 通过 / 0 失败 / 2 跳过** ✅

**并发记录（仍然有效）**：另一个会话在本工作区改的**agent 侦查**（omp/agy/pi 宿主、`--host`、
`installedRows`/`missingNames`）不属于本批，提交时必须分开。

### 决策点（2026-09-19 刀哥已拍板）

- **D1 · 「就这么出」的落点** → **打开既有确认闸门**（同一个按钮的口径）。确认动作仍由人点、仍走挑战；
  「就这么出」只是**更好的入口**，不是快捷方式。守卫锁死：只允许 `via: 'gate'`。
- **D2 · `sessions.context` 收成 bearer-only** → **做**（界面选中态第 2 批已交还路由，它已无界面消费者；
  留着两边都能写迟早再互相覆盖）。**先改规格书 §2.2**，再动实现。
- **D3 · 9.8 顺手升协议 `3.1.0`** → **升**（加法也让旧 agent 知道契约变了；
  `3.1.0` 仍在 `>=3.0.0 <4.0.0` 内，3.0.0 的 agent 仍兼容）。四处硬编码 + `shared/protocol.ts` 同步。
- **D4 · 9.6「我的配方」的范围** → **两半都做但不自动执行**：存得下、下次带得出、带出后**可改**。