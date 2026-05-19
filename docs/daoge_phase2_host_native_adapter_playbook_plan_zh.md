# DAOGE 第二阶段第六批优化计划

## 目标

第五批已经把 `host_native_results.json` 固化成：

1. 正式 schema
2. example 文件
3. 校验脚本

第六批要解决的不是契约本身，而是**接入成本**。

也就是说，后续无论接的是：

- ChatGPT / Codex 内置图像工具
- 第三方图像工作台
- 自建脚本型宿主

都应该尽量变成“照手册填模板”，而不是每次重新摸索。

---

## 背景判断

当前 `host-native` 路径已经具备：

1. 运行模式探测
2. prompt 交接包
3. 结果回填层
4. 正式结果 schema / example / 校验

但还缺一个问题：

- 规则是完整的
- 契约是稳定的
- 但是没有“宿主接入手册”

结果是：

- 新接一个宿主时仍然要自己推断怎么对接
- 维护者需要在 README、脚本、tests 里来回翻
- 缺少一份面向接入者的最短路径说明

---

## 本批实施范围

本批只做以下三类改造：

1. 新增宿主接入手册
2. 新增宿主接入模板
3. 将手册与模板接入 README / SOP

本批暂不做：

- 新宿主 SDK 开发
- 自动探测更多宿主类型
- 更复杂的运行模式扩展
- 新一轮脚本架构重构

---

## 任务拆解

### Task 1. 新增宿主接入手册

新增文件：

- `skills/interactive-image-batch/references/host_native_adapter_playbook_zh.md`

目标：

- 明确 host-native 接入的最短工作流
- 解释 prompt 包、结果文件、校验、导入、审阅的关系
- 让维护者可以一眼知道接入顺序

建议内容：

1. 接入总流程
2. 宿主类型分类
3. prompt 交接包怎么产出
4. 结果文件怎么组织
5. 校验和导入怎么跑
6. 常见错误与排查

### Task 2. 新增宿主接入模板

新增目录或文件：

- `skills/interactive-image-batch/references/examples/host-native/adapter_quickstart.example.md`

目标：

- 给接入者一个可以直接改的“最小接入模板”
- 不要求复杂说明，优先强调步骤和命令

建议覆盖三类宿主：

1. 内置图像工具型宿主
2. 第三方工作台型宿主
3. 自建脚本批量宿主

### Task 3. 更新 README / SOP

要把这批内容接回：

- `README.md`
- 如果合适，也补到维护 SOP 区域

目标：

- 让手册不是“藏在 references 里没人看”
- 新维护者先看到 README 就知道去哪里找接入说明

---

## 实施顺序

按以下顺序落地：

1. 新增本计划文档
2. 新增 `host_native_adapter_playbook_zh.md`
3. 新增 `adapter_quickstart.example.md`
4. 更新 `README.md`
5. 运行最小验证

---

## 完成标准

本批完成时，至少满足：

1. 存在正式宿主接入手册
2. 存在最小接入模板
3. README 能把维护者导向这两份文档
4. 统一 smoke 不被破坏

---

## 风险提醒

本批最容易犯的错有两个：

1. 手册写得太散
   - 最后变成一份新 README
2. 只讲概念，不给模板
   - 接入者仍然不知道从哪一行开始

所以本批原则是：

- 手册讲流程
- 模板讲落地
- README 负责指路

---

## 本批交付物

预期新增或修改：

- `docs/daoge_phase2_host_native_adapter_playbook_plan_zh.md`
- `skills/interactive-image-batch/references/host_native_adapter_playbook_zh.md`
- `skills/interactive-image-batch/references/examples/host-native/adapter_quickstart.example.md`
- `skills/interactive-image-batch/README.md`
