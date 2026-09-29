# 证据新鲜度与失效传播

`evidence-freshness.mjs` 是只读诊断器。它读取 `docs-facts.json` 中事实或切片的 `evidence` 引用，检查证据路径、JSON 状态、`generatedAt`、代码提交绑定和 freshness 窗口，并沿 `relations` 传播受影响节点。

```bash
node scripts/evidence-freshness.mjs
node scripts/evidence-freshness.mjs --now 2026-09-30T00:00:00Z
node scripts/evidence-freshness.mjs --strict
```

证据可以使用字符串路径，也可以使用对象：

```json
{
  "id": "V1-E2E-001",
  "path": "docs/05-测试与发布/端到端验收/报告/e2e-20260930.json",
  "generated_at": "2026-09-30T10:00:00+08:00",
  "commit": "完整源码提交 SHA",
  "status": "passed",
  "max_age_days": 30
}
```

字符串形式只提供路径，报告文件仍必须自行包含 `generatedAt`、`commit` 和通过状态。`--strict` 会在证据缺失、路径越界、报告失败、日期无效、超过 freshness 窗口或注册表错误时返回非零；默认模式只输出诊断，适合迁移期和本地检查。

`affected` 是图传播结果，不代表所有受影响节点都需要重跑同一种测试。它表示节点依赖了已失效或过期证据，交付门禁应结合环境、风险和切片重新选择验证范围。
