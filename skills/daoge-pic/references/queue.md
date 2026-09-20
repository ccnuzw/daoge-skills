# 请求队列（受限请求入口）

Workbench 的受限请求入口与 Agent 对话共用**同一条队列**（`studio_requests`，一行一请求，状态用列表达）。队列接的是「用户说的话」，不是「出图指令」——两类话都接，分别处理。SKILL.md 只留三条 MUST，这里是完整规则。

- **每次入场先看队列**（MUST）：`request-list` 列出 `pending` 条目；条目自带 `context_json`（项目 / 任务 / 选中的图 + **机器可读的流程要求**）。用户请求需走 daoge-pic 计划流程时，条目会声明它，Agent 按声明执行，不靠自觉。
- **领单用租约**：`request-accept --request <id>` 原子领取并写租约（`lease_token` + 过期时间）；同一单**不能被两个 Agent 重复消费**。租约过期未处理会自动回队；连续 3 次超时标记失败。
- **长活要续租（MUST）**：写计划 → 等用户确认 → 预检 → 出图 → 收图之间可能隔很久（人工确认急不来）。**每次等待或每个阶段之间调 `request-renew --request <id>`**。例外已内建：这一单若正卡在 `awaiting_confirmation`（球在用户脚下），过期时只松开租约、保留 `accepted`，不计失败也不会被别的 Agent 抢走；Agent 仍应在用户确认后回来把活干完（`request-done`）。
- **出图类请求**：按正常流程产出计划 → 用户在 Workbench 确认 → 预检 → 入队运行；请求通过 `result_round_id` 关联到产生的轮次。
- **花动作请求（重试 / 恢复）**：Workbench 里的重试 / 恢复按钮**不直调 Bearer**（会重新花钱），而是把意图写成请求：`context_json` 带 `intent`（`retry` / `resume`）、`runId` 与 `itemIds`（可选，缺省表示整批）。Agent 接单后**按这三个字段精确执行** `retry` / `resume`，不要从自然语言里猜；完成后 `request-done` 带回结果。暂停 / 取消是止损动作，仍由 Workbench 直达，不经队列。
- **非出图类请求**（如「帮我看看这批怎么样」）：Agent 以普通对话回应，`request-done --request <id> --reply <text>` 把回复内容带回发起处显示。
- **需要追问时**：用 `request-done --request <id> --needs-input <text>` 把问题带回请求卡片；用户在卡片内联回答，回答续上同一请求，Agent 不丢上下文。
- **做不了**：`request-reject --request <id> --reason <text>`，文案用人话（如「这个我做不了：目前只能出图片」），状态标「无法处理」，不让用户沮丧。
- **上下文连续性靠数据，不靠记忆**：请求的 `context_json` 会带上 `previousRequestId`（就地回答追问时自动写入）。`request-detail --request <id>` 会把上一条的原话一并返回；**原话住在请求表里**，计划只写 `requestId` 外键，不复制文本。写计划时把 `requestId` 放进 `plan`，服务端会校验它确属本 Studio。
- **未接单可撤**：Workbench 可撤回还没被领取的请求；**不插队**。
