# daoge-pic 以人为本升级 · 实施规格书

> **本文件在套装中的位置**：方案文档（`studio-creator-centric-refactor-plan-zh.md`）= 宪法，定「为什么改、改成什么」；
> **本文件 = 法律**，定「跨批次不变的规矩」；批次施工单 = 行政命令，定「这一批做什么」。
> **从属纪律**：施工单不得违背本文件；本文件不得违背方案文档。**施工中发现方案有误 → 回头改方案文档（其第 10 节就是为此存在），不得就地绕过。**
>
> **本文件什么时候该改**：只在**不变量发生变化**时改（版本策略、红线判据、守卫规则、DoD）。
> 一份施工单若需要改本文件才能执行，说明本文件的规矩当初定错了——那是大事，停下来单独处理。

| 项 | 值 |
|---|---|
| 方案文档（冻结，只追加「已实施 @ 日期」） | `daoge-pic-plans/studio-creator-centric-refactor-plan-zh.md` |
| 本规格书 | `daoge-pic-plans/daoge-pic-upgrade-spec-zh.md` |
| 施工单（一批一份，做完归档） | `daoge-pic-plans/daoge-pic-upgrade-batch-N-zh.md` |
| 实施日志（跨批次总账） | `daoge-skills/CHANGELOG.md` 的「实施视角」段 |
| 发布说明（对外交付物） | `daoge-skills/docs/daoge_pic_6.0.0_release_notes_zh.md` |

---

## 1. 版本策略

| 维度 | 现状（5.14.2） | 目标（本次大版本） | 依据 |
|---|---|---|---|
| 制品版本 | `5.14.2` | **`6.0.0`** | 跨出运行时兼容上界 `>=5.14.2 <6.0.0`，语义上就是一次 breaking 大版本 |
| Skill 协议 | `daoge-pic-skill-protocol/2.0.0` | **`/3.0.0`** | 请求队列是**协议级新能力**（agent 要按新协议读队列、回执），属 breaking |
| 运行时兼容范围 | `>=5.14.2 <6.0.0` | **`>=6.0.0 <7.0.0`** | 同制品版本一起改 |
| `STUDIO_SCHEMA_VERSION` | `34` | **从 34 递增**（具体值实施时定） | 新库 schema 全量重设计；`database.ts` 仍是事实源 |
| Node 运行时要求 | `>= 22.17.0` | **不变** | 与本次改造无关 |

**⚠️ 协议版本号有四处硬编码，必须同步改（否则协议升级是假的）**：

1. `web/src/main.jsx:130`（前端发 `x-daoge-skill-protocol`）
2. `skills/daoge-pic/SKILL.md` 第 8 行（协议声明）与第 157 行（请求头要求）
3. `scripts/package-smoke.js:108`（冒烟断言 `protocolManifest.version === '2.0.0'`）
4. `tests/vnext/protocol-contract.test.js`（协议契约守卫）

---

## 2. 四条红线的实施判据

红线是抽象的，实施时必须能**当场判定"越界没有"**。以下判据是本次改造的验收口径。

### 2.1 `studio.db` 是唯一事实依据，前端不造影子状态

- **判据**：界面上任何数字、状态、进度，**都必须能在库里找到对应字段**；刷新/断网恢复后必须还原。
- **检查法**：① 断网刷新，状态是否还原？② 界面上每个数字，能不能说出它来自哪张表的哪个字段？
- **反例（必须避免）**：把「生成中 2/4」存在前端 state 里靠事件累加；把「已选片」存在 localStorage。
- **正例**：进度从 `run_items` 状态算出来；选片是库里的关系（`review_decisions` / 项目选片）。

### 2.2 鉴权边界（bearer / cookie 的分工判据）

- **判据（`route-authorization.ts` 表头原话的精神）**：
  **会花钱、会起停进程、会改存储凭据的动作 → `bearer`（可追责的一方）；
  人的闸门 → `cookie`；其余一律默认「两者皆可」，不登记。**
- **本次只动一条**：`runs.pause` / `runs.cancel` → `cookie`（**止损动作不花钱、减少支出**；原登记防的是 agent 自作主张，结果防住了人）。
- **保持 bearer 的**：`runs.retry` / `runs.resume` / `runs.outcomes-resolve`（会重新花钱）——界面按钮走队列 → agent 执行。
- **检查法**：新增或修改任何路由时，问一句「**有没有一道不依赖调用方身份的防线**」——有 → 登记；没有 → 不登记。
- **连带**：改 `runs.pause/cancel` 必须同步改 `SKILL.md` 第 43 行（该行把「取消」列为 Bearer 专属）与 `route-authorization.test.js`。

### 2.3 确认闸门只有人能过

- **判据**：`rounds.confirm` **永远 cookie-only**；agent 的 bearer token **在任何情况下都不能被接受为确认者**。
- **连带约束（协议层，已存在，不得削弱）**：确认挑战绑定 `planHash + expectedVersion + sessionId + conversationId` 且**有过期时间**（`confirmation-gate.ts`）。计划一改（`plan_version` / `version` 双递增），旧确认自动失效。
- **检查法**：`route-authorization.test.js` 的漂移守卫必须始终为绿。

### 2.4 工程能力只加强不删

- **判据**：任何被「收起来」的能力，**必须在检查器 / 列表视图 / 系统面板 / 疑难层之一能找到入口**。
- **检查法**：动任何视图之前，先写一份「**这个视图/按钮承载的能力清单**」，改完后逐条指出新家；**列不出新家的不许收**。
- **已有守卫可依赖**：`phase4-navigation-registry.test.js` 已经在防「视图变孤儿」（断言辅助区视图必须有真入口）。

---

## 3. 守卫规则与迁移总表

### 3.1 三条铁律

1. **单一来源**：改任何文案/规则/清单，**先改单一来源**（`terminology.mjs` / `boundary-copy.mjs` / `route-authorization.ts` / `ROUTE_AUTHORIZATION_RULES` 等），再改消费方。
2. **先写守卫桩，再动代码**（对应 9.1）：每批开工前先列「本批会破坏哪些守卫、新守卫是什么」，**把新守卫写成会 fail 的桩**，然后动代码让它变绿。
3. **类型检查分档清白**：`tsconfig.web.json` 现处第 1 档（0 错）。**抬档的唯一合法路径是先把当前档清零**；本批引入的类型错误必须在本批修掉。

### 3.2 守卫迁移总表

`tests/vnext/` 现有 **109** 个测试文件，其中守卫/契约类 **15** 个。下表是**重构必然撞上**的 7 个及其归属批次：

| 守卫 | 锁什么 | 一批 | 二批 | 三批 | 四批 |
|---|---|---|---|---|---|
| `route-authorization.test.js` | 18 条鉴权规则 + 漂移检测 | | **改**（暂停/取消 → cookie） | | |
| `terminology-guard.test.js` | 术语单 + 三面隔离 + 技术详情白名单 | **改**（轮次→批次进单） | | | |
| `workbench-route.test.js` | 路由归一化不变量（如「assets/lineage 深链永不保留 studio 作用域」） | **预期不改**（A1 已降级为小改，见方案 7.7.2 的施工修正） | | | |
| `phase4-navigation-registry.test.js` | 视图↔渲染器一一对应、辅助区不许变孤儿 | **改**（视图注册表，方案 7.8.2） | | | |
| `studio-schema-contract.test.js` | schema 契约 | | **改**（新库） | | |
| `protocol-contract.test.js` | Skill 协议契约 | | **改**（协议 → 3.0.0） | | |
| `source-text-guard.test.js` | 前端源码文本级断言（配合 `source-text.js`） | **改** | **改** | **改** | **改** |

其余 8 个（`cli-contract` / `skill-startup-contract` / `background-process-contract` / `multi-session-contract` / `provenance-contract` / `studio-scope` / `delivery-studio-scope-api` / `phase4-route-refresh`）
**逐批核对"本批是否触及"，触及即改**。

---

## 4. Schema 变更摘要（一页纸）

> **事实源仍是** `src/vnext/studio/database.ts` + `src/vnext/studio/migrations.ts` + `studio-schema-contract.test.js`。
> 本节只是给人看的索引，**不作为实现依据**。

**新增**

| 表 | 用途 | 依据 |
|---|---|---|
| `studio_requests` | 请求队列（一行一请求；**状态用列表达**，不用事件序列） | 方案 7.1 |

**修改**

| 表 | 变更 | 依据 |
|---|---|---|
| `assets` | 加 `project_id`（可空外键）——归属从「关系表拼五跳」升格为约束 | 方案 7.7.1 |
| `run_items` | 加 `asset_id`（可空外键）——产出图的 id 从 `result_json` 里提出来 | 方案 7.2 |
| `canvas_layouts` | 删 `scope_type` / `scope_id`；**一项目一份**（不再 61 份） | 方案 7.4 / 6.2 |
| `canvas_node_layouts` | `entity_type` 收敛到 `task` / `round` / `asset` / `group`；**只存用户动过的节点**（没记录 = 自动布局） | 方案 7.3 / 7.5 |
| `studio_sessions` | `active_*` 改名 `agent_*`（**归还给 agent 独占**；界面选中态由路由承载） | 方案 7.7.3 |

**不迁移**

**旧结构数据与图片资产全部不迁**（方案 6.5，2026-09-17 定）。新库从零开始；旧库与素材**原地存档、不主动删除**。

---

## 5. 环境策略

- **新环境与旧环境隔离**（方案 9.3）：新 daemon 用**独立 workspace + 独立端口**，改代码不影响当前日用。
- **`#6 不迁移`之后本条更简单**：不需要新旧并行、不共用库——**旧环境保持原样可运行**（这正是回滚方案，见第 7 节）。
- **切换新库前必须先停 daemon**：`backup-restore` 明确拒绝「目标 daemon 正在运行」（运行中替换 `studio.db` 只会得到损坏的 Studio）。
- **开发期验证**：每批完成跑全套回归（`npm test` 等价物）+ `lint` + 双端 typecheck，命令以仓库 `package.json` / 既有脚本为准。

---

## 6. 施工单模板（每批照着填）

```markdown
# 第 N 批施工单 · <批名>（日期）

## 进度快照（每次做完一组更新一行；换会话时先读这一节）
| 日期 | 进度 | 下一步 |

## 0. 前置
- 本批依据：方案文档 <章节号>；规格书 <章节号>
- 本批是否触发规格书改动：否 / 是（说明）
- 本批会破坏的守卫 → 新守卫的桩（先写桩，再动代码）

## 1. 目标（可验收的一句话）
## 2. 任务分解（逐条：做什么 / 涉及文件 / 依据章节）
## 3. 守卫变更（新增 / 修改 / 保留）
## 4. 迁移或切换步骤（如涉及）
## 5. 验收清单（可勾选；每条对应一个可见现象）
## 6. 端到端检查（若本批是收尾批，跑规格书第 8 节的 DoD）
## 7. 开放项销账（从方案第 8 / 9 节摘与本批相关的）
## 8. 实施日志（实际偏差、踩的坑、需要回头改方案的发现）
```

---

## 7. 回滚方案

**回滚 = 切回旧环境。** 因为 #6 定了「全新开始、不迁移、旧库与素材原地存档」：

1. 旧 `daoge-studio/studio.db` 与 `daoge-assets/` / `daoge-deliveries/` **原地未动**；
2. 新环境跑在独立 workspace + 端口；
3. 若新版本不可用，**停新 daemon、起旧 daemon 即可**——数据一直都在。

⚠️ **前提纪律**：**任何批次都不得删除或就地改写旧 `studio.db` 与素材目录**。将来真要回收磁盘，是一次单独的、走删除清单确认的操作。

---

## 8. 端到端验收（DoD）

整版完成的定义——**这条链必须在真实环境从头跑通**：

1. 起新 daemon → 打开 Workbench → **首屏三形态**正确（没项目 / 有项目没选 / 选了）；
2. 建项目 → 建任务（双击画布空白） → **说一句** → 收到**回执**（「我准备这么出：…」）→ 「就这么出」；
3. agent **从队列接单** → 写计划 → 预检 → 出图；
4. 出图过程中：**占位符长出来**（每出一张填一张）、**暂停/取消点了就生效**（cookie 直达）；
5. 挑图：**空格 / X / Enter** 快捷键可用；**3–4 张对比**可用；**缩放 ≥4×**；
6. 失败场景：批次显示「完成 · N 张没成」+「重试这 N 张」；重试**走队列**且界面先显示「已排队」；
7. `outcome_unknown`：先自动对账，对不出来的**请用户核实**（人话邀请，不出现「结果未知」四个字）；
8. 挑完 → **「拿出去」** → 交付三阶段 → 导出三件套（`manifest.json` + contact-sheet + creative-record）；
9. **刷新浏览器**：状态全部还原（唯一事实的验证）；
10. **对照第 2 节四条红线的判据逐条过一遍**。

---

## 9. 提交与交付纪律

- **提交前检查清单**：`git ls-files --others --exclude-standard`（逐个确认未跟踪文件是否被引用）→ 调试残留扫描 → `npm run lint` 全量（界 = 0 error）→ typecheck（web + vnext）→ 全套回归 → `cmp` 线上产物与磁盘。
- **一次提交的可构建性优先**：`main.jsx` 是多拨改动的交汇点，按文件拆提交会让中间提交不可构建——**宁可一次提交**，在提交信息里分点写清各拨改动。
- **只 commit 不 push**：push 属对外操作，单独确认。
- **实施日志**：每批完成后，在 `CHANGELOG.md` 加一条「实施视角」记录（做了什么 / 实际偏差 / 坑），**不往方案文档里塞**；方案文档只在对应小节追加「已实施 @ 日期」。

---

## 附：本规格书的依据来源

- 方案文档：`studio-creator-centric-refactor-plan-zh.md`（11 章，含第 8 节开放问题全清、第 9 节增量建议、第 10 节两轮终审记录）
- 协议与事实源：`skills/daoge-pic/SKILL.md`（v5.14.2 / 协议 2.0.0）、`src/vnext/runner/preflight.ts`、`src/vnext/api/route-authorization.ts`、`src/vnext/studio/database.ts`
- 配套施工单：`daoge-pic-plans/daoge-pic-upgrade-batch-1-zh.md`（第 1 批，纯前端）
- 核查记录：2026-09-16 至 09-17 共四轮（方案第 7 节重审 + 第 10 节终审），
  **所有技术断言均经过代码或数据库验证**；凡未验证的均标注「推演 / 待验证」
