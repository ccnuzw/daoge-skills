# DAOGE v2.0.1 真实任务验收矩阵计划

## 基本信息

- 验收目标：验证 `skills/interactive-image-batch` 在真实用户路径中的准备、执行、回填、问题队列、补跑、工作台和发布包完整性。
- 当前包版本：`interactive-image-batch@2.0.1`
- 仓库路径：`/Users/apple/Progame/daoge/daoge-skills`
- 隔离测试目录：`/Users/apple/Progame/daoge/daoge-goal45-real-validation`
- `.env` 路径：`/Users/apple/Progame/daoge/.env`，只验证存在和必需字段，不记录 key。
- 真实 provider 预算：控制在 12-20 张，优先取 12 张；若 provider 失败，记录 HTTP/配置/素材原因，不重试扩大成本。

## 验收矩阵

| 编号 | 路径 | 方式 | 计划数量 | 覆盖点 |
| --- | --- | --- | ---: | --- |
| T01 | 纯文本方图 | 真实 provider | 2 | prompt-only、方图、`assets/results`、`assets/selected`、`assets/exports` |
| T02 | 纯文本竖图 | 真实 provider | 2 | prompt-only、竖图、任务默认尺寸 |
| T03 | 纯文本横图 | 真实 provider | 2 | prompt-only、横图、尺寸覆盖 |
| T04 | 参考图生图 | 真实 provider | 1 | reference-assisted、参考素材解析、参考资产复制 |
| T05 | 遮罩局部修改 | 真实 provider | 1 | masked-edit、遮罩素材、edit 路径 |
| T06 | storyboard 分镜板 | dry-run 优先，真实 provider 小样本 | 4 | shot/frame 命名、slot 元数据、workspace 展示 |
| T07 | host-native ingest 成功+复核 | 不烧图 | 2 条结果 | 相对路径导入、`needs_review`、资产分类 |
| T08 | host-native ingest 失败 | 不烧图 | 1 条失败 | failed 状态、问题页、错误记录 |
| T09 | 缺失素材问题队列 | dry-run + execute | 1 | 不假成功、`assets/issues`、`workspace/issues.html` |
| T10 | rerun / failed-only | dry-run | 1 | 只选失败项、路径稳定、manifest 保留补跑状态 |
| T11 | 发布包 smoke | npm pack 解包 | 2-3 个 smoke | 用户安装视角、脚本和必需文件存在 |

预计真实 provider 出图数：T01 2 + T02 2 + T03 2 + T04 1 + T05 1 + T06 4 = 12 张。

## 检查清单

每个任务完成后检查：

- `workspace/index.html`
- `workspace/prepare.html`
- `workspace/results.html`
- `workspace/issues.html`
- `workspace/record.html`
- `assets/results`
- `assets/selected`
- `assets/exports`
- `assets/issues`
- `internal/local_execution_raw.json` 或 host-native 对应原始 manifest
- `internal/execution_manifest.json`
- `internal/asset_library.json`
- `internal/workspace_state.json`

## 执行策略

1. 先为每个 task spec 跑 `prepare`，确认验证报告和工作台页面生成。
2. 对高风险路径先跑 `execute --dry-run true`，确认结构和问题队列。
3. 对真实 provider 仅用 `--batch-size 1 --concurrency 1 --retry-count 0`，避免并发和重试扩大成本。
4. host-native ingest 使用隔离目录中的小 PNG 文件，不调用 provider。
5. 缺失素材路径必须出现失败记录和 issue 资产，不能计入成功。
6. rerun 使用上一轮失败 manifest，只补失败项，检查 `failedOnly` 和 `resumeManifest`。
7. 发布包 smoke 使用 `npm pack --pack-destination`，先验证当前开发包 pack 产物；如需对比已发布 `v2.0.1` 或最新安装包，记录包来源和版本，再在隔离目录解包后运行最小命令。

## 问题分级

- P0：阻断主链路，必须修。
- P1：用户会明显困惑或产物错误，必须修。
- P2：体验、文档、命名优化；只修低风险高收益项。
- P3：暂缓，记录原因。

## 修复与验证

发现问题后先复现并确认是否真实成立。只修 P0/P1 和低风险高收益 P2。每个修复必须补测试，至少覆盖失败路径或契约。

固定验证命令：

```bash
npm --prefix skills/interactive-image-batch run test:contracts
npm --prefix skills/interactive-image-batch run test:integration
```

若修改核心执行链路，再跑：

```bash
npm --prefix skills/interactive-image-batch test
```
