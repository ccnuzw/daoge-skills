# DAOGE 第二阶段第三批优化计划

## 目标

第二阶段前两步已经补齐：

1. 运行模式探测
2. `host-native` 轻量路径的规则层定义

第三批的目标不是继续扩治理，而是让 `host-native-image-tool` 路径通过统一 `prepare` 入口拥有稳定、可检查、可复用的最小产物链。

也就是说，当宿主环境已经能直接出图时，DAOGE 仍然需要留下：

- 结构化 prompt 产物：`debug/prompts.generated.json`
- 可读工作台入口：`workspace/index.html`
- 模式、模板、批次和关键参数说明

而不是只在对话里口头说明“你现在可以去出图了”。

---

## 背景判断

当前 `interactive-image-batch` 已经具备完整本地 runner 主线：

- `task_spec`
- `prompt_strategy`
- `prompt_slots`
- `prompt_draft_bundle`
- `debug/prompts.generated.json`
- `prepare / execute / rerun / review`

但 `host-native-image-tool` 路径仍然缺一个问题：

- 它有运行模式判断
- 也有文档规则
- 但缺少明确的统一 `prepare` 最小交付物口径

结果是：

- 轻量路径的产物边界不够清晰
- 维护者不容易知道“至少该留下什么”
- 统一 smoke 还无法直接验证这条轻量链路

---

## 本批实施范围

本批只做以下四类改造：

1. 强化 `scripts/daoge.js prepare` 的 `host-native` 最小产物输出
2. 稳定输出 `debug/prompts.generated.json` 和 `workspace/index.html`
3. 将该入口接入测试与统一 smoke
4. 把新的最小产物链写回文档

本批暂不做：

- 宿主原生图像工具的自动调用器
- 复杂的 host-native 结果抓取
- 对完整 `daoge.js prepare` 的重写
- 新一轮模板制度改造

---

## 任务拆解

### Task 1. host-native 最小产物入口

当前提示词准备已合并到单入口：

- `skills/interactive-image-batch/scripts/daoge.js prepare`

职责：

- 接收已有 prompt / task / strategy / runtime mode 输入
- 汇总成统一 `prepare` 最小可交付物
- 不伪造本地 execute 产物

建议输入：

- `--prompts-file`
- `--task-spec`
- `--strategy-file`
- `--runtime-mode-file`
- `--output-dir`

稳定输出：

- `debug/prompts.generated.json`
- `workspace/index.html`

### Task 2. 统一最小交付物结构

`host-native` 最小产物至少要回答这些问题：

1. 当前运行模式是什么
2. 为什么命中这条路径
3. 当前选中了什么模板或风格方向
4. 当前 prompt 数量、批次摘要和关键参数是什么
5. 用户下一步该把什么交给宿主原生图像工具

因此 JSON 产物至少要包括：

- `runtime_mode`
- `recommendation`
- `prompts_file`
- `prompt_count`
- `template`
- `style_summary`
- `batch_summary`
- `task_summary`
- `next_actions`

### Task 3. 增加测试

至少补两类测试：

1. `scripts/daoge.js prepare` 能生成稳定产物
2. 产物内容包含最小摘要字段

### Task 4. 接入统一 smoke

统一入口：

- `skills/interactive-image-batch/scripts/run_smoke_tests.sh`

需要把统一 `prepare` 最小产物链纳入最小回归闭环。

---

## 实施顺序

按以下顺序落地：

1. 新增本计划文档
2. 在 `scripts/daoge.js prepare` 中实现 host-native 可用提示词准备
3. 补 smoke test
4. 更新 `SKILL.md`
5. 更新 `references/trigger_modes_zh.md`
6. 更新 `README.md`
7. 接入统一 smoke 并完成验证

---

## 完成标准

本批完成时，至少满足：

1. 存在可执行的 `scripts/daoge.js prepare`
2. 能稳定输出 `debug/prompts.generated.json` 和 `workspace/index.html`
3. `host-native-image-tool` 路径的最小产物链在文档里被明确写清
4. smoke test 有对应覆盖
5. `run_smoke_tests.sh` 全绿

---

## 风险提醒

本批最容易犯的错有两个：

1. 又把轻量路径做成半套重 runner
   - 结果丢掉了 `host-native` 的意义
2. 只补 JSON，不补可读摘要
   - 维护者和用户都不方便直接审阅

所以本批的核心原则是：

- 轻量
- 可读
- 可验证
- 不伪造 execute 产物

---

## 本批交付物

预期新增或修改：

- `docs/daoge_phase2_host_native_artifacts_plan_zh.md`
- `skills/interactive-image-batch/scripts/daoge.js`
- `skills/interactive-image-batch/tests/smoke.test.js`
- `skills/interactive-image-batch/scripts/run_smoke_tests.sh`
- `skills/interactive-image-batch/SKILL.md`
- `skills/interactive-image-batch/references/trigger_modes_zh.md`
- `skills/interactive-image-batch/README.md`
