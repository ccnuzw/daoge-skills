# 多类型契约索引

## 1. 定位

`contract-index.mjs` 生成契约导航层，不复制 HTTP schema、事件字段、Driver 语义或 migration 规则。各类契约继续由自己的权威文件维护，索引只记录来源、入口、实现阶段和功能追踪。

支持的契约类型：

| 类型 | 默认来源或配置 | 索引内容 |
| --- | --- | --- |
| `http` | OpenAPI/Swagger 文件 | path、method、operationId、功能 ID、实现状态 |
| `event` | `docs-policy.json` 的 `contracts.sources` | event/action ID、功能 ID、来源 |
| `driver` | manifest/schema/配置文件 | driver key 或 operation ID、来源 |
| `migration` | `migrations/`、`server/migrations/` | migration 文件和来源 |
| `page` | 页面路由矩阵或 routes 文件 | 页面来源和功能 ID |
| `custom` | `contracts.sources` | 项目自定义的机器契约入口 |

## 2. 用法

```bash
node scripts/spec-docs.mjs contracts --dir . --json
node scripts/contract-index.mjs --dir . --out .tmp/contract-index.json
node scripts/contract-index.mjs --dir . --strict
```

项目可以在 `docs-policy.json` 中登记非 HTTP 契约：

```json
{
  "contracts": {
    "sources": [
      {
        "type": "driver",
        "path": "docs/04-技术架构/current-driver.json",
        "operationPattern": "driver_key\\s*[:=]\\s*[\\\"']?([A-Za-z0-9._:-]+)"
      }
    ]
  }
}
```

`--strict` 会阻断配置错误、缺失来源和已登记事实中不存在的功能 ID；普通模式输出缺口但不修改项目。
