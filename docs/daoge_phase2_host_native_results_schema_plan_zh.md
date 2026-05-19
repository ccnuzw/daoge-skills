# DAOGE 第二阶段第五批优化计划

## 目标

第四批已经补齐了 `host-native` 结果回填层：

- `ingest_host_native_results.js`
- 轻量 `manifest`
- 审阅 / 完成 / 归档看板复用

第五批要解决的不是“能不能导入”，而是“导入协议是否稳定”。

也就是说，`host_native_results.json` 不能再只是 README 里的一段建议字段说明，而要升级成：

1. 正式 schema
2. 示例模板
3. 校验脚本

这样不同宿主工具接入时，才不会每次重新约定字段。

---

## 背景判断

当前 `host-native` 路径已经有两层稳定产物：

1. prompt 交接包
2. 结果回填层

但 `host_native_results.json` 仍然存在几个问题：

- 只在 README 里有简略字段说明
- 没有正式 schema 文件
- 没有 example 文件
- 没有单独校验入口

结果是：

- 宿主侧接入依然容易字段漂移
- 新维护者很难知道哪些字段是强约束，哪些是可选补充
- smoke 虽然能测导入，但不能单独验证结果文件契约

---

## 本批实施范围

本批只做以下四类改造：

1. 新增 `host_native_results` schema
2. 新增 example 文件
3. 新增校验脚本
4. 将校验接入文档、测试和统一 smoke

本批暂不做：

- 复杂 JSON Schema 校验库引入
- 宿主工具 SDK 适配器
- 更复杂的视觉审阅字段设计
- 新一轮 review 门户改造

---

## 任务拆解

### Task 1. 新增 schema 文件

新增文件：

- `skills/interactive-image-batch/references/host_native_results.schema.json`

目标：

- 固定 `host_native_results.json` 的最小契约
- 区分必填字段和推荐字段
- 说明允许的 `status` 值

最低必填建议：

- `index`
- `title`
- `requestMode`
- `status`

条件字段建议：

- `output`
  - 当 `status=success` 或 `status=needs_review` 时应提供
- `error`
  - 当 `status=failed` 时建议提供

### Task 2. 新增 example 文件

新增文件：

- `skills/interactive-image-batch/references/examples/host-native/host_native_results.example.json`

目标：

- 给不同宿主工具一个可直接抄用的模板
- 让 README 和测试不再重复手写内嵌示例

### Task 3. 新增校验脚本

新增脚本：

- `skills/interactive-image-batch/scripts/validate_host_native_results.js`

职责：

- 校验结果文件是否是数组
- 校验最小必填字段
- 校验 `status` 是否合法
- 校验 `success/needs_review` 是否带 `output`
- 校验 `failed` 是否建议带 `error`

### Task 4. 接入导入链路

`ingest_host_native_results.js` 在导入前应优先跑一次自身校验逻辑，至少做到：

- 非法结果文件直接阻断
- 输出明确错误
- 合法结果文件再继续生成轻量结果链

### Task 5. 增加测试与 smoke

至少补三类测试：

1. example 文件可通过校验
2. 非法 `status` 会报错
3. smoke 里加入独立 schema 校验

---

## 实施顺序

按以下顺序落地：

1. 新增本计划文档
2. 新增 `host_native_results.schema.json`
3. 新增 example 文件
4. 实现 `validate_host_native_results.js`
5. 让 `ingest_host_native_results.js` 复用校验
6. 更新 README / `trigger_modes_zh.md`
7. 接入 smoke 并完成验证

---

## 完成标准

本批完成时，至少满足：

1. 存在正式 schema 文件
2. 存在可复用 example 文件
3. 存在独立校验脚本
4. `ingest_host_native_results.js` 不再盲信输入
5. smoke test 有 schema 校验覆盖
6. 统一 smoke 全绿

---

## 风险提醒

本批最容易犯的错有两个：

1. schema 写得过重
   - 导致宿主工具很难适配
2. schema 只落文件，不接入脚本和 smoke
   - 最终还是回到靠人记忆

所以本批原则是：

- 契约清楚
- 校验轻量
- 示例可复用
- 必须接入自动化

---

## 本批交付物

预期新增或修改：

- `docs/daoge_phase2_host_native_results_schema_plan_zh.md`
- `skills/interactive-image-batch/references/host_native_results.schema.json`
- `skills/interactive-image-batch/references/examples/host-native/host_native_results.example.json`
- `skills/interactive-image-batch/scripts/validate_host_native_results.js`
- `skills/interactive-image-batch/scripts/ingest_host_native_results.js`
- `skills/interactive-image-batch/tests/smoke.test.js`
- `skills/interactive-image-batch/scripts/run_smoke_tests.sh`
- `skills/interactive-image-batch/README.md`
- `skills/interactive-image-batch/references/trigger_modes_zh.md`
