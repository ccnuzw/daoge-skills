# 事实追踪覆盖率报告

`traceability-report.mjs` 是只读一致性报告，检查事实注册表的关系完整度，不修改 `docs-facts.json` 或 policy。

```sh
node scripts/traceability-report.mjs
node scripts/traceability-report.mjs --strict
node scripts/traceability-report.mjs --profile sdd --strict
```

报告关注：

- 事实和切片是否有权威来源；
- active 需求/功能是否进入交付切片；
- 关系两端是否存在；
- 是否存在孤立事实、重复关系或反向关系；
- operation/entity/acceptance 是否能追溯到功能或需求；
- 证据引用是否存在；
- 覆盖率和未覆盖清单。

报告同时按事实类型输出 `coverage.by_type` 和 `coverage.uncovered_by_type`。`--profile sdd --strict` 会把仍未连接到任何切片或显式关系的非归档事实作为阻断项，适合版本进入开发门禁前使用。

普通模式返回 JSON 并保留警告；`--strict` 将错误和覆盖率未达阈值转换为非零退出。它不判断业务规则是否正确，也不把文档存在升级成实现完成。
