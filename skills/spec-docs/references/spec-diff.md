# 规格差异与变更治理

`spec-diff.mjs` 对比事实注册表、切片、关系以及其 `authority` 文件摘要和仓库内冻结基线，识别事实、切片、状态、关系和权威文档变化，并输出受影响切片、权威路径与治理回写清单。

```bash
# 首次冻结当前事实层
node scripts/spec-diff.mjs --dir . --write-baseline

# 只读查看当前变更
node scripts/spec-diff.mjs --dir . --version V1

# 将未绑定交付切片的活动事实变化作为阻断
node scripts/spec-diff.mjs --dir . --version V1 --strict
```

基线默认写入 `.spec-docs/baselines/<version>.json`，也可以在 `docs-policy.json` 的 `changeGovernance.baselineDir` 中配置。普通检查不会修改基线；只有显式 `--write-baseline` 才会创建或覆盖快照。快照包含规范化的事实、切片、关系、权威文件 SHA-256 和整体摘要；权威 Markdown 改动即使没有修改 `docs-facts.json` 也会产生 `authority_changed` 差异。

差异类型包括：`added`、`removed`、`modified`、`status_changed`、`relationship_added`、`relationship_removed`。`governance` 输出受影响的事实、切片、权威路径和建议回写目标。删除、权威来源变化、交付范围变化和关系变化默认要求决策复核。启用 `changeGovernance.strict=true` 或传入 `--strict` 后，活动事实没有交付切片绑定会阻断检查；可用 `requireSliceBinding=false` 逐项目关闭该规则。
