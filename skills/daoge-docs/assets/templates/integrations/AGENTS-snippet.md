## 中文文档驱动开发

项目文档、功能规划、ADR、任务书、需求追踪和发布证据统一使用 `$daoge-docs`。

实现前必须运行 `python3 .daoge-docs/daoge_docs.py gate --root . --stage feature-ready --feature <ID>`。发布前必须运行 `gate --stage release`。

大型任务必须先运行 `prepare-goal`，每次开始或恢复前运行 `goal-resume-context`。只修改当前任务的 `allowed_paths`，提交代码后立即运行 `goal-checkpoint`；全部任务完成后运行 `goal-complete`。不得跳过失败验证、手工修改 Goal 状态，或依赖聊天历史恢复。

产品要求、当前实现和验证证据必须分开；发现新的业务语义、权威冲突或范围扩张时，先更新规格和决策，再继续修改代码。

文档默认使用中文。仅在代码、路径、字段、协议、标准缩写和第三方专有名词中保留英文。
