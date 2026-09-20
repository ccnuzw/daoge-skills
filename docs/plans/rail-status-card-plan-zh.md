# rail 底部「系统状态」卡 · 重做方案（**已实施**，2026-09-20）

> 状态：**已按 D1=A / D2=A / D3=A 落地**（刀哥 2026-09-20 拍板）。实施结果与验收证据见文末 §8；§1–§7 保留决策当时的原文，便于回看。
> 依据：界面宪法 §5.3「三区」、§4 S7「同一事实只有一个常显位置」；现状实测见 §1。

## 1. 现状（真机实测，2026-09-20）

受控 Chromium 打开 daemon 会话（1440×900，rail 展开 276px）：

| 量到的 | 值 |
| --- | --- |
| 卡内**可见文字** | `系统状态 \| 看明细`（就这两个词） |
| 算出来的结论 | `一切正常` —— 在 DOM 里，`getComputedStyle(small).display === 'none'`，**任何宽度都不显示** |
| 收起态（72px）盒子 | 44×**59**（同排按钮一律 44×44；多出来的 15px 是漏在图标下方的 `<summary>看明细</summary>`） |
| `.rail-status-popover` | CSS 在（`position:absolute`，守卫锁着），**JSX 从来没渲染过**（死规则） |
| 五种状态 | `tone` 只体现为左侧 2px 竖线；图标恒为 `Server`/`CloudOff`（只看 provider 配没配，不看运行异常） |

一句话：**这张卡把唯一有价值的那句话（结论）用 CSS 关掉了，常显的只有固定词。**

## 2. 为什么「特别不好」（四条，都能指到具体代码）

1. **S7 的落点是空的**：宪法要求「一张卡 = 一行结论 + 点开两条明细」。结论 `conclusion` 算得对（谁在挡路：运行异常 > 生成服务未配置 > 配置热加载 > 限流/退避 > 一切正常），但 `shell.css` 里 `.rail-status-copy small{display:none}` 让它永远不渲染 → 卡上永远是「系统状态」四个字，用户看一百次也不知道现在有没有事。
2. **可点区域和外观不符**：卡头（图标 + 文字）是死区，只有 10px 的「看明细」能点。它看着像一整行能点的东西，实际点不动——最常见的误操作。
3. **收起态破坏栅格**：同排的工作区/资料按钮都是干净的 44×44；状态卡是 44×59，图标下面漏一行 10px 文字（`看明细`），整列节奏在这里断掉。
4. **图标不跟结论走**：`运行异常`（danger）时仍是服务器图标，只有一根 2px 竖线变红；同屏最容易扫到的是图标，它却不说话。

## 3. 目标（一句话）

**卡在任何宽度下都先说出结论；收起态是一个干净的 44×44 图标按钮，点开在右侧弹出同一份明细。**

## 4. 改法（三处，都在 rail 自己的块里）

### 4.1 JSX：`web/src/workbench-navigation.jsx` · `UnifiedStatusCard`

- **结论占常显行**：`<strong>` 渲染 `conclusion`，不再渲染固定词「系统状态」；固定词降级为 `aria-label` 与 `title`（「系统状态：一切正常」），收起态靠它兜住可访问名（S9 那条复查的结论仍成立）。
- **一张卡 = 一个开关**：把现有 `<header class="rail-status-head">` 搬进 `Disclosure` 的 `summary`（该组件已在本文件里用着：`<Disclosure className="rail-status-more" summary={<summary>看明细</summary>}>`）。
  搬进去之后「看明细」这个 10px 的开关词就退场了——点卡面任意位置都能展开，不再有「看着能点却点不动」的死区。
  顺带吃到 `Disclosure` 已有的三条行为：点外部收（`pointerdown`）、Esc 收并还焦点、同屏只开一个。
- **图标随 tone**：`danger → TriangleAlert`、`warning → TriangleAlert`、`ready → Server`、未配置 → `CloudOff`（图标仍只用 lucide 一套，尺寸 16/17 档不变）。
- **收起态**：外壳把已有的 `railCollapsed` 传进 `WorkbenchNavigation`；收起时用现有的 `.rail-status-popover`（CSS 早有 `left:calc(100% + 12px); bottom:0; width:280px`）在**右侧**弹出明细，卡本身退化成一个 44×44 图标按钮。

### 4.2 CSS：`web/src/styles/blocks/shell.css`

```css
/* 结论必须常显：这是这张卡存在的理由（S7）。收起态另说（见下）。 */
.rail-status-copy small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* 收起态：卡是纯图标按钮，明细走右侧浮层——不再往 44×44 里塞一行 10px 文字。 */
.studio-shell.is-rail-collapsed .rail-status-card { display:grid; place-items:center; width:44px; min-height:44px; padding:0; }
.studio-shell.is-rail-collapsed .rail-status-card .rail-status-more > summary { display:none; }
.studio-shell.is-rail-collapsed .rail-status-popover { position:absolute; left:calc(100% + 12px); bottom:0; width:280px; }
```

（`.rail-status-popover` 的两条规则已存在，这里只是让它**真的被渲染**。守卫 `phase4-navigation-registry.test.js` 断言的那行原文不动。）

### 4.3 守卫与文档

- `rail-sections.test.js` 的三条（三区钩子 / `rail-status-card` 只出现一次 / 不许出现 `rail-status-details` / 必消费 `providerRuntimeNotice`）在改法下**全部继续成立**，不需要改写。
- **新增一条源级守卫**：状态卡的常显行必须渲染 `conclusion` 变量本身（防止退回「只渲染固定词」——这正是本次 bug 的形态，且现有守卫拦不住）。
- 改完把现象补进 `studio-interface-layout-plan-zh.md` §12 台账。

## 5. 验收（可见现象）

1. 正常时：rail 底部一行 `一切正常`，左侧竖线为 `ready` 色；悬浮提示 `系统状态：一切正常`。
2. 未配 provider / 运行异常时：**同一行文字与图标一起变**（`生成服务未配置` / `运行异常：…`），不需要点开就已经知道出事了。
3. 收起态（72px）：一个 44×44 图标，与工作区/资料按钮同高，图标下方没有文字；点它 → 右侧浮层出「生成服务 / 运行状态」两条明细 + 疑难处理。
4. 复验口径：受控 Chromium 实测 `cardBox === [44, 44]`（收起）/ 可见文字含结论（展开），两张截图入档；再跑 `node --test tests/vnext/rail-sections.test.js` 与新守卫。

## 6. 边界与风险

- **能力一个不丢**：打开设置 / 安全重启 / 刷新 / 复制诊断 / 疑难处理五条动作原样保留，权限与位置不变。
- **S7 不搬家**：provider 退避/限流的**常显结论**仍只在卡里，队列底栏那条（`providerRuntimeNotice`）不受影响。
- **回归面**：展开态卡从一行 40px 变两行 10px+12px（约 50px 高）。rail 是定宽列、竖直滚动，不会挤到内容区；`≤900` 的横向条同理。
- **不做**：不改 `UnifiedStatusCard` 的结论优先级算法；不把明细拆成第二张卡（`rail-sections` 守卫明确禁止）。

## 7. 决策点（需要刀哥拍板；三处都取 A = 下面 §5 的验收直接成立）

**先看两条尺寸事实**（决定 D1/D3 怎么选）：
① 常显行的**可写宽度**：卡 243px − 内边距 20 − 图标 22 − 行尾标记 ≈ **197px**；12px 字号下 ≈ **14–15 个汉字**；
② 结论档里最长的两条是限流/内存提示：`生成服务在限流，先把出图放慢（不是你的操作问题）。`（24 字）、
`内存吃紧，先把出图放慢；等它缓过来会自动恢复。`（23 字）；其余档位（`一切正常` / `生成服务未配置` / `后台任务需要重启` / `配置正在热加载`）都在 4–8 字。

| # | 问题 | 选项 | 建议与理由 |
| --- | --- | --- | --- |
| **D1** | 常显行写哪句话 | **A**：短结论常显（≤14 字档，即 `runtime.title` 这一档），**长句（限流/内存 23–24 字）完整落在明细的「生成服务」行**，`title` 给全文<br>**B**：原样渲染 `conclusion`（含长句），单行省略号 + `title` 全文<br>**C**：`系统状态 · <短结论>` 两段式 | **A**。B 改动最小，但 S7 点名的那条限流结论会被截成 `生成服务在限流，先把出图放…`，恰好把「先看具体原因」的规则（限流/额度/磁盘）截掉；C 多占 ~50px，等于把可写字数从 15 压到 10，换来的只是「系统状态」这个区块名（而它已经在 `aria-label` 里） |
| **D2** | 收起态（72px）怎么看明细 | **A**：卡退化成 44×44 图标按钮，点开在**右侧浮层**出同一份明细（复用已有的 `.rail-status-popover`，CSS 早在、从没渲染过）<br>**B**：不弹浮层，直接跳「疑难处理」页<br>**C**：只给 `title` 悬停文字，明细必须展开 rail | **A**。B 想「看一眼运行状态」也得离开当前页，且看不到「生成服务」那条；C 等于今天的行为——图标颜色是唯一常显信号，而今天折叠态恰恰是最难看的形态（44×59 + 漏一行 `看明细`）。A 还能顺带吃到 `Disclosure` 已有的点外部收 / Esc 还焦点 / 同屏只开一个 |
| **D3** | 卡高 | **A**：**保持 40px**，「看明细」三个字退场（卡头搬进 `summary` 后它本来就没了），点开靠行尾 `›` 表态<br>**B**：保留「看明细」小字，卡变两行 ≈50px | **A**。A 与工作区 / 资料行同高（40px），整列节奏一致，且**比今天更矮**——今天展开态 40px 但收起态 44×59；B 多一行解释，代价是在 40px 的行列里插一个 50px 的例外（跟折叠态 44×59 是同一类毛病） |

## 8. 实施结果与验收证据（2026-09-20，D1/D2/D3 全取 A）

**落地清单**

| 文件 | 改了什么 |
| --- | --- |
| `web/src/provider-runtime-model.mjs` | 限流/退避文案收进一张 `THROTTLE_COPY` 表：同一 `lastReason` 出**短句**（`providerRuntimeHeadline`，常显行用）与**整句**（`providerRuntimeNotice`，明细/队列底栏用）。两处同源，不可能各说各话 |
| `web/src/workbench-navigation.jsx` | 常显行改为结论本身：`<strong>{headline}</strong>` 写进 `Disclosure` 的 `summary`；图标随 tone（缺配置 `CloudOff` / 挡路 `TriangleAlert` / 其余 `Server`）；`aria-label`＋`title` = `系统状态：<结论>`；整句限流文案进明细「生成服务」行；明细包一层 `.rail-status-popover`（这条 CSS 此前从没被渲染过） |
| `web/src/styles/components.css` | 卡退成**挂载点**（`position:relative`；行在 `summary` 上、浮层锚在卡上）；`summary` 即行（40px、行尾 `›`、hover、`:focus-visible`）；删掉死规则 `.rail-status-head`、`.rail-status-copy small` |
| `web/src/styles/blocks/shell.css` | 卡从 rail 行原语里摘出；收起态卡 44×44（含 2px 语气竖线，左缘与其它行对齐）、行内文字与 `›` 退场；`.rail-status-popover` 加 `max-height/overflow`；清掉四条死规则 `.rail-status-details*`（其「展开高亮」改挂新选择器，字面量原样复用） |
| `web/src/styles/blocks/responsive.css` | 900 / 640 两档跟着换到 `summary` 上；≤900 放开卡宽（标签要显示）、≤640 收成 44px 并藏行尾标记（此处要压过 ≤900 的更高特异性规则） |
| `tests/vnext/rail-sections.test.js` | 新增守卫：常显行必须是 `{headline}`、不许退回固定词、不许再把结论放进 `small` 槽（**这正是本次 bug 的形态**） |
| `tests/vnext/provider-runtime-state.test.js` | 新增断言：常显短句存在且 **≤14 字**（rail 常显行的物理容量） |

**真机复验（受控 Chromium + daemon 会话 Cookie，1440 / 900 / 640）**

| 验收项 | 实测 |
| --- | --- |
| 常显行说结论 | 展开：`一切正常`；`aria-label="系统状态：一切正常"`；卡 `243×40`（与工作区/资料行同高） |
| 收起态 | 卡 `10,853,44,44` —— 与 `.rail-guide-card`、一级入口按钮**同 x 同尺寸**；文本为空、行尾标记 `display:none`；图标 32px |
| 点开（收起态） | 右侧 280px 浮层：`生成服务 / 打开设置 / 运行状态 / 刷新 / 复制诊断 / 疑难处理`（五条能力一个不丢）；Esc 关闭并把焦点还给 `summary` |
| 状态跟着变（未配置） | 注入 `status.configured=false` → `is-danger` ＋ `CloudOff` ＋ `生成服务未配置`（竖线、图标、文字一起变） |
| 状态跟着变（限流） | 注入 `providerConcurrency.lastReason=rate_limited` → 常显 `is-warning` ＋ `生成服务在限流`（7 字）；明细「生成服务」行给出整句 `…· 生成服务在限流，先把出图放慢（不是你的操作问题）。` |
| 断点 | 900：横向条里 `一切正常 ›` 可读；640：44×44 纯图标、无行尾标记 |
| 回归 | `npm run build:workbench` ✓（含 tsc）；相关 12 个测试文件 **71/71**；**全量 916 项 / 914 通过 / 0 失败 / 2 跳过** |
| 反例检查 | 收起态全页常驻描边扫描 `[]`（S15 的回归没回来）；`.rail-status-details` 在 CSS 里已无定义、JSX 里仍被守卫禁止 |

截图：`daoge-pic-plans/rail-card-{expanded,collapsed,collapsed-open,throttle,unconfigured}.png`