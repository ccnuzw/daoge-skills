> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第二阶段第八批优化计划

## 目标

第七批已经补了：

1. 宿主接入 SOP
2. README 维护导航

第八批要解决的不是“怎么接入”，而是“接入完成后怎么沉淀成果”。

也就是说，每接完一个新宿主，最好都能留下同一格式的归档说明，至少回答：

1. 这个宿主是什么
2. 已验证到哪一步
3. 有哪些限制
4. 字段映射怎么做
5. 以后复用时先看什么

---

## 背景判断

当前 `host-native` 路径已经有：

1. playbook
2. quickstart
3. schema / example
4. SOP

但仍然缺一个问题：

- 接入动作有方法
- 接入后的结论没有统一归档模板

结果是：

- 每次接宿主的经验容易散落在会话、提交说明或脑子里
- 下次接同类宿主时，不容易快速复用

---

## 本批实施范围

本批只做以下三类改造：

1. 新增宿主接入成果归档模板
2. 把模板接回 README / SOP
3. 运行最小验证

本批暂不做：

- 实际宿主接入报告内容填充
- 新的脚本
- 新的 schema

---

## 任务拆解

### Task 1. 新增归档模板

新增文件：

- `docs/host_native_adapter_archive_template_zh.md`

目标：

- 给每次宿主接入提供统一归档格式
- 让团队以后复盘时可以横向比较不同宿主

建议包含：

1. 宿主名称与类型
2. 接入日期
3. 已验证能力
4. 未解决限制
5. prompt 包使用方式
6. 结果 schema 映射说明
7. 已跑验证命令
8. 结论与建议

### Task 2. 更新 README / SOP

在维护入口中补一句：

- 接完新宿主后，顺手用归档模板沉淀结果

目标：

- 不让模板只躺在 `docs/` 里

### Task 3. 最小验证

至少验证：

- 模板文件存在
- README / SOP 引用已接上
- 统一 smoke 仍然全绿

---

## 实施顺序

按以下顺序落地：

1. 新增本计划文档
2. 新增 `host_native_adapter_archive_template_zh.md`
3. 更新 `README.md`
4. 更新 `host_native_integration_sop_zh.md`
5. 运行最小验证

---

## 完成标准

本批完成时，至少满足：

1. 存在宿主接入成果归档模板
2. README / SOP 能把维护者导向这份模板
3. 统一 smoke 全绿

---

## 风险提醒

本批最容易犯的错有两个：

1. 模板写太空
   - 以后归档没法直接用
2. 模板写太重
   - 维护者懒得填

所以本批原则是：

- 够完整
- 但必须能快速填写

---

## 本批交付物

预期新增或修改：

- `docs/daoge_phase2_host_native_archive_template_plan_zh.md`
- `docs/host_native_adapter_archive_template_zh.md`
- `skills/interactive-image-batch/README.md`
- `skills/interactive-image-batch/references/host_native_integration_sop_zh.md`
