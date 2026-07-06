> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第二阶段第七批优化计划

## 目标

第六批已经补了：

1. 宿主接入手册
2. 宿主接入 quickstart 模板

第七批要解决的不是“有没有说明”，而是“执行时会不会漏步骤”。

也就是说，维护者在接一个新宿主时，应该能直接照一份清单做，而不是在：

- README
- 接入手册
- example
- schema

之间来回跳。

---

## 背景判断

当前 `host-native` 路径的知识已经不少了：

1. 模式探测
2. prompt 交接包
3. 结果 schema / example / 校验
4. 结果回填
5. 接入手册
6. quickstart 模板

但对维护者来说，真正高频需要的是：

- 一份固定检查表
- 一份“不要漏”的执行顺序

否则文档再齐，执行时还是容易漏：

- 忘跑 schema 校验
- 忘回填结果
- 忘更新 example
- 忘跑 smoke

---

## 本批实施范围

本批只做以下三类改造：

1. 新增宿主接入 SOP 清单
2. 把 SOP 接回 README 维护区
3. 跑最小验证，确保不破坏现有回归

本批暂不做：

- 新脚本
- 新 schema
- 新宿主类型探测
- 新门户能力

---

## 任务拆解

### Task 1. 新增 SOP 清单

新增文件：

- `skills/interactive-image-batch/references/host_native_integration_sop_zh.md`

目标：

- 用 5 到 8 步固定宿主接入顺序
- 每一步都要有明确动作和最小验证点
- 让维护者一屏就能看完

建议包含：

1. 先判断宿主类型
2. 生成 prompt 包
3. 组织结果文件
4. 校验结果 schema
5. 回填结果
6. 检查门户产物
7. 跑统一 smoke
8. 如有新模式，补 example / 文档

### Task 2. 更新 README

在维护区显式加入：

- 何时读 SOP
- 何时读 playbook
- 何时读 quickstart

目标：

- README 负责“先看什么”
- SOP 负责“怎么做”
- playbook 负责“为什么这么做”

### Task 3. 最小验证

至少验证：

- SOP 文件存在
- README 引用已接上
- `run_smoke_tests.sh` 全绿

---

## 实施顺序

按以下顺序落地：

1. 新增本计划文档
2. 新增 `host_native_integration_sop_zh.md`
3. 更新 `README.md`
4. 运行最小验证

---

## 完成标准

本批完成时，至少满足：

1. 存在独立宿主接入 SOP
2. README 维护区能把维护者导向 SOP / playbook / quickstart
3. 统一 smoke 全绿

---

## 风险提醒

本批最容易犯的错有两个：

1. SOP 写成长文
   - 最终失去“清单”意义
2. SOP 和 playbook 职责重叠
   - 最后又出现两份重复说明

所以本批原则是：

- SOP 只保留步骤
- Playbook 负责解释
- Quickstart 负责示例

---

## 本批交付物

预期新增或修改：

- `docs/daoge_phase2_host_native_sop_plan_zh.md`
- `skills/interactive-image-batch/references/host_native_integration_sop_zh.md`
- `skills/interactive-image-batch/README.md`
