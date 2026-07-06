> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第三轮第二批优化计划

## 本轮目标

在“推荐起步入口”基础上，再往前退一步，把用户从“记模板名”切换到“先说任务意图”。

本轮北极星目标：

**用户第一次进入 example catalog 时，可以先按任务意图找入口，而不是先理解模板名。**

## 本轮范围

1. 在 catalog 元数据里增加 `starter_intent`
2. CLI 支持 `--intent <意图>`
3. HTML catalog 增加“按任务意图开始”区
4. README / examples README 补充意图入口说明
5. smoke 覆盖意图筛选

## 本轮意图集合

第一批只覆盖最常见的 5 类：

- `ui`
- `academic`
- `packaging`
- `map`
- `typography`

## 设计原则

### 1. 意图名优先用户语言

命令层允许传入短意图名，而不是模板 id。

### 2. 一种意图先只推荐一个起步入口

不做复杂排序，不做多候选决策，先保证路径清晰。

### 3. 保持旧入口完全兼容

以下入口继续有效：

- `--list true`
- `--starter true`
- `--example-id ...`

## 验证要求

1. `--intent ui` 能返回 `ui-mockup-board`
2. `--intent academic` 能返回 `academic-figure-board`
3. HTML 里能看到“按任务意图开始”
4. 全量 smoke 继续通过
