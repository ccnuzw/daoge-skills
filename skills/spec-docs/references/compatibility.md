# 旧文档兼容与迁移诊断

## 1. 兼容原则

存量项目通常已经有自己的状态字段、功能卡和历史实现记录。兼容诊断的目标是指出需要迁移的事实，不是静默改写文件。

默认遵循以下边界：

- `spec_status` 只表达规格是否可作为开发输入。
- `implementation_status` 只表达代码和证据做到哪一步。
- `lifecycle` 表达当前、计划、废弃或归档。
- `delivery_scope` 表达是否计入当前交付。
- 功能主文档不再维护实现状态。

## 2. 常见旧写法

| 旧写法 | 诊断 | 迁移目标 |
| --- | --- | --- |
| 功能 frontmatter 中有 `status: 基础实现` | 实现状态复制 | 移入当前版本实现状态表或事实注册表 |
| 功能卡中有 `状态` 行 | 实现状态复制 | 保留 `规格状态`，删除实现状态行 |
| 功能文档和索引各自维护完成度 | 多个事实来源 | 索引只保留功能 ID、链接和摘要 |
| 本地 mock 写成“已完成” | 证据升格 | 标明环境、证据等级和限制 |
| 未来 operation 放在当前契约表 | 范围混用 | 使用 `planned` 或迁移到对应版本空间 |

## 3. 只读审计

```bash
node scripts/compatibility-audit.mjs --repo /absolute/project
node scripts/compatibility-audit.mjs --repo /absolute/project --json
node scripts/compatibility-audit.mjs --repo /absolute/project --strict
```

普通模式输出迁移建议并返回成功；`--strict` 将发现的旧状态复制、无法识别的兼容写法和配置问题作为失败。脚本不修改文档、不移动文件、不生成新的权威事实。

## 4. 推荐迁移顺序

1. 运行只读审计并保存报告。
2. 先确认当前版本实现状态表的唯一维护位置。
3. 将功能文档中的实现状态迁移为规格状态、差距和验证记录。
4. 再启用 `docs-facts.json`，登记事实入口和交付切片。
5. 最后提升 `check-docs --strict` 和 `docs-gate` 的约束等级。

旧文档进入 `99-历史归档` 前，必须先建立旧路径到新路径的迁移映射；审计工具不会替用户判断历史文档是否应删除。
