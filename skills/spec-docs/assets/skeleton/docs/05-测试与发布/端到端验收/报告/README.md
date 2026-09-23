# E2E 证据报告目录

本目录存放各批次与专项的**脱敏证据制品**：测试报告、日志片段、截图、查询计划等。只追加、不覆盖；失败批次保留原记录。

## 命名规范

| 类型 | 规范 | 示例 |
| --- | --- | --- |
| 批次报告 | `<版本>-<YYYYMMDD>-<HHMM>-<环境>.json` | `v1-20260726-1959-local-mock.json` |
| 专项制品 | `<主题>-<YYYYMMDD>[-HHMM]-<资产>.<ext>` | `<subject>-20260910-flow.json` |
| 运行清单 | `<run_id>-manifest.json` | `<run_id>-manifest.json` |

## Manifest 最小字段

每个批次报告必须有一份 manifest，字段固定。证据 commit 指向实际测试的源码提交；报告、manifest 与证据指针可在该提交之后追加，但之后不得再有源代码变更：

```json
{
  "run_id": "<版本>-YYYYMMDD-HHMM-<环境> 或 <主题>-YYYYMMDD-HHMM",
  "environment": "<环境与模式>",
  "code_version": "<构建标识>",
  "commit": "<完整 40/64 位被测源码 commit>",
  "command": "<实际执行的命令>",
  "working_directory": "<执行目录>",
  "exit_code": 0,
  "stats": { "expected": 1, "passed": 1, "failed": 0, "skipped": 0, "unexpected": 0, "flaky": 0 },
  "started_at": "<带时区时间>",
  "test_report": "<同目录报告文件名>",
  "asset_sha256": { "<被测源码或脚本路径>": "<sha256>" },
  "cleanup": "<清理情况>",
  "sanitization": "<脱敏说明>",
  "scope": "<本批次覆盖范围>",
  "limitations": "<不能证明什么；例如仅 UI 证据、无生产结论>",
  "prior_attempts": []
}
```

## 规则

1. 报告与 manifest 只追加不覆盖；重跑生成新 run_id，不修改旧文件。
2. 不包含密钥、令牌、签名 URL、完整请求体或未脱敏数据；截图与日志同理。
3. `limitations` 必须写清不能证明的结论，防止本地证据被当成生产门禁。
4. `asset_sha256` 用于证明报告与当时的源码/脚本版本对应。
5. 批次结论登记到[验证证据](../验证证据.md)，本目录只放制品。
