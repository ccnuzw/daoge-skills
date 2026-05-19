# DAOGE 第二阶段第四批优化计划

## 目标

第三批已经让 `host-native-image-tool` 路径拥有了稳定的 prompt 交接包：

- `host_native_prompt_pack.json`
- `host_native_summary.md`
- `host_native_summary.html`

第四批要解决的不是 prompt 交接，而是**结果回填**。

也就是说，当宿主原生图像工具已经完成出图后，DAOGE 需要能把这些结果重新接回自己的审阅、归档和复盘链路，而不是停在“prompt 已交出去”这一步。

---

## 背景判断

当前本地 runner 主线已经具备完整结果链：

- `manifest.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `review_board.html`
- `completion_board.html`
- `result_hub.html`

但 `host-native` 路径仍然缺一个问题：

- prompt 交接已经有了
- 宿主侧结果也可能真实存在
- 但没有标准脚本把这些结果导回 DAOGE 体系

结果是：

- `host-native` 只能做到“前半段结构化”
- 后半段审阅、归档、复盘仍然断链

---

## 本批实施范围

本批只做以下四类改造：

1. 新增 `host-native` 结果导入脚本
2. 生成最小结果文件与轻量 manifest
3. 复用现有结果看板链路
4. 将该脚本接入测试、文档和统一 smoke

本批暂不做：

- 宿主图像工具的自动抓取器
- 自动识别图片优劣的复杂视觉评审
- 完整替代本地 runner 的执行态
- 新的 review 体系分叉

---

## 任务拆解

### Task 1. 新增 host-native 结果导入脚本

新增脚本：

- `skills/interactive-image-batch/scripts/ingest_host_native_results.js`

职责：

- 读取 `host_native_prompt_pack.json`
- 读取宿主侧结果清单
- 生成最小 DAOGE 结果文件
- 调用现有 HTML / Markdown 看板脚本

建议输入：

- `--prompt-pack-file`
- `--results-file`
- `--output-dir`

建议输出：

- `manifest.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `rerun_candidates.json`
- `operations_report.json`
- `operations_report.md`
- `daoge_result_hub.md`
- `result_hub.html`
- `review_board.html`
- `completion_board.html`
- `run_overview.html`
- `rerun_board.html`

### Task 2. 定义最小结果清单格式

宿主侧结果文件不要求模拟 runner 的所有字段，但至少应支持：

- `index`
- `title`
- `output`
- `slotId`
- `requestMode`
- `status`
- `error`
- `textPolicy`
- `scene`
- `composition`

其中：

- `status=success` 进入 `success.json`
- `status=failed` 进入 `failed.json`
- `status=needs_review` 进入 `needs_review.json`

### Task 3. 复用现有结果链路

这批不新造结果门户，而是尽量复用现有：

- `render_result_hub.js`
- `render_result_hub_board.js`
- `render_review_board.js`
- `render_completion_report.js`
- `render_completion_board.js`
- `render_run_overview.js`
- `render_rerun_board.js`

目标是让 `host-native` 结果回填后，也能和本地 runner 一样进入统一浏览路径。

### Task 4. 增加测试与 smoke

至少补两类测试：

1. 导入脚本能生成最小结果文件
2. 导入后能成功渲染关键结果看板

统一 smoke 需要补一个最小 fixture 检查。

---

## 实施顺序

按以下顺序落地：

1. 新增本计划文档
2. 实现 `ingest_host_native_results.js`
3. 补 smoke test
4. 更新 `README.md`
5. 更新 `references/trigger_modes_zh.md`
6. 接入统一 smoke 并完成验证

---

## 完成标准

本批完成时，至少满足：

1. 存在可执行的 `ingest_host_native_results.js`
2. 能把宿主结果清单转成 DAOGE 最小结果链
3. 能生成 `result_hub / review_board / completion_board` 等结果入口
4. smoke test 有对应覆盖
5. 统一 smoke 全绿

---

## 风险提醒

本批最容易犯的错有两个：

1. 试图把 host-native 结果导入器做成新的 runner
   - 结果边界又变重
2. 结果导入后不复用原有看板链
   - 结果维护两套门户，后面一定漂移

所以本批的核心原则是：

- 只做结果回填，不做执行重放
- 尽量复用既有看板与报告
- 轻量 manifest 足够即可

---

## 本批交付物

预期新增或修改：

- `docs/daoge_phase2_host_native_result_ingest_plan_zh.md`
- `skills/interactive-image-batch/scripts/ingest_host_native_results.js`
- `skills/interactive-image-batch/tests/smoke.test.js`
- `skills/interactive-image-batch/scripts/run_smoke_tests.sh`
- `skills/interactive-image-batch/README.md`
- `skills/interactive-image-batch/references/trigger_modes_zh.md`
