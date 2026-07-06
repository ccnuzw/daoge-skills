> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第二阶段优化计划

## 目标

第一阶段已经完成模板治理、主链校验、治理报告、维护 SOP 和骨架化 `SKILL.md`。

第二阶段不再继续强化“治理深度”，而是补齐当前相对 `gpt-image-2` 仍然偏弱的两类能力：

1. 运行环境适配能力
2. 轻量使用路径

目标是让 `interactive-image-batch` 从“强运行时系统”升级成：

- 强运行时系统
- 同时具备轻量 host-native 路径
- 同时具备明确运行模式探测

---

## 背景判断

当前 skill 的优势已经很清楚：

- 结构化运行时完整
- 模板治理成熟
- 分镜 / 引用资产 / rerun / review 工作流强

当前剩余差距主要在：

1. 缺少独立的运行模式探测入口
2. `host-native` 场景还停留在文档层，没有形成明确的轻量路径
3. 默认叙事仍偏“本地 runner 主线”，对宿主原生出图环境不够友好

---

## 本阶段实施范围

本阶段只做以下三类改造：

1. 新增运行模式探测脚本
2. 明确并落地 `host-native` 轻量路径规则
3. 将上述规则接入文档、测试和统一 smoke

本阶段暂不做：

- 模板大规模扩容
- 新一轮模板治理机制
- runner 执行链路重写
- UI 门户大改版

---

## 任务拆解

### Task 1. 新增运行模式探测脚本

新增脚本：

- `scripts/detect_runtime_mode.js`

目标：

- 给出当前环境推荐使用的运行模式
- 避免用户和维护者只能靠阅读 `SKILL.md` 自己猜

最小输出字段建议：

- `mode`
- `recommendation`
- `has_openai_base_url`
- `has_openai_api_key`
- `has_local_runner`
- `host_native_signal`
- `summary`

建议模式：

- `local-batch-runner`
- `host-native-image-tool`
- `prompt-advisor`
- `local-runner-missing-credentials`

### Task 2. 明确 host-native 轻量路径

要做的不是把现有 runner 改成宿主工具调用器，而是明确一条轻量路径：

- 当宿主自带图像工具时
- DAOGE 仍然负责 intake / template / strategy / prompt structuring
- 但不强制进入本地 `prepare -> execute` runner 主线

需要落地到：

- `SKILL.md`
- `references/trigger_modes_zh.md`
- `README.md`

### Task 3. 为 host-native 路径定义最小交付物

当走 host-native 轻量路径时，不要求完整 batch runner 产物，但至少应保留：

- 最终 prompt 或 prompt bundle
- 选中的模板信息
- 关键参数摘要

建议最小结果：

- `prompts.generated.json` 或等价 prompt 产物
- 一个简短的运行模式总结

### Task 4. 增加测试

至少补两类测试：

1. `detect_runtime_mode.js` 的模式探测测试
2. host-native 路径的文档和行为基线测试

### Task 5. 接入统一回归入口

统一回归入口必须继续保持单命令闭环：

- `scripts/run_smoke_tests.sh`

如果第二阶段新增了探测脚本或测试，应纳入统一 smoke。

---

## 实施顺序

按以下顺序落地：

1. `detect_runtime_mode.js`
2. 对应 smoke test
3. `SKILL.md` 增补 host-native 轻量路径
4. `trigger_modes_zh.md` 补充 host-native 规则
5. `README.md` 补充第二阶段说明
6. 统一 smoke 验证

---

## 完成标准

本阶段完成时，至少满足：

1. 存在可执行的 `scripts/detect_runtime_mode.js`
2. 有对应测试覆盖
3. `SKILL.md` 明确区分：
   - local batch runner
   - host-native image tool
   - prompt advisor
4. `trigger_modes_zh.md` 不再只描述本地 `prepare/execute` 主线，而能解释 host-native 轻量路径
5. 统一 smoke 全绿

---

## 风险提醒

本阶段最容易犯的错有两个：

1. 把 host-native 路径做得过重
   - 结果又回到本地 runner 思维
2. 只写文档，不做实际探测入口
   - 用户和维护者仍然要靠猜

所以本阶段优先级必须是：

- 先做探测脚本
- 再收敛轻量路径文档

---

## 本阶段交付物

预期新增或修改：

- `docs/daoge_phase2_optimization_plan_zh.md`
- `scripts/detect_runtime_mode.js`
- `tests/smoke.test.js`
- `SKILL.md`
- `references/trigger_modes_zh.md`
- `README.md`
- `scripts/run_smoke_tests.sh`（如有需要）
