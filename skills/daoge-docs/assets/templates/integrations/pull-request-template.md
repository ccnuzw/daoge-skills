## 变更目标

- Goal ID：
- 当前版本：
- 功能 ID：
- 最终检查点：

## 权威与范围

- [ ] 变更只涉及 Goal `allowed_paths`
- [ ] 没有新增未冻结业务语义、外部副作用或破坏性迁移
- [ ] 权威文档变化后已重新生成 Goal，而不是修改旧清单

## 验证

- [ ] `docs-check` 通过
- [ ] 对应 Feature Ready 门禁通过
- [ ] 所有任务均有通过的检查点证据
- [ ] `goal-complete` 已生成完成记录

## P2 Goal 基线

- [ ] `python3 .daoge-docs/daoge_docs.py ci-check --root . --json` 已通过
- [ ] 所有未完成 Goal 已运行 `goal-status --read-only --fail-on-stale`
- [ ] 若存在 `stale`，已从当前权威重新 `prepare-goal`，没有手改旧清单

## 证据入口

- Goal 清单：`.daoge-docs/goals/<GOAL-ID>/goal-manifest.json`
- 完成记录：`.daoge-docs/goals/<GOAL-ID>/completion.json`
- 其他机器证据：

> 开发级 Goal 完成不代表允许发布；发布仍须单独通过 `release` 门禁。
