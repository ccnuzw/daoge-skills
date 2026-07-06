> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE Phase 6：Lookbook 第三轮正式变体扩展计划

日期：2026-05-19

## 目标

在 `lookbook` 已有 5 个正式变体的基础上，继续补两条更贴近时尚商业组图使用场景的正式变体：

1. `editorial-pairing-lookbook`
2. `lookbook-detail-mix`

## 为什么现在补这一条

- `lookbook` 当前只有 5 个正式变体，仍低于很多核心商业家族的 6~7 区间
- 它属于 `brand-visual` 主线，和海报、包装、详情页、社媒不同
- 时尚组图、搭配组图、整身与细节混排组图是高频真实任务
- 当前已经具备 `variants + example + catalog + prepare + smoke` 完整闭环

## 本批交付

1. 更新 `lookbook` 模板文档和注册表
2. 新增两个正式变体 example
3. 接入 `examples.catalog.json`
4. 更新 `references/examples/README.md` 与主 `README.md`
5. 更新 `smoke.test.js`
6. 跑两条真实 `prepare`
7. 跑全量 smoke 和目录检查

## 目标变体定义

### `editorial-pairing-lookbook`

适用：

- 两两搭配的 editorial 组图
- 同一系列里强调造型互文、双图关系和节奏配对

重点：

- 不只是单张连排，而是成对关系更强
- 既要看出款式差异，也要看出 editorial 节奏

### `lookbook-detail-mix`

适用：

- 整身图和局部细节图混排
- 既要看全套造型，又要看材质、版型、配件或层次细节

重点：

- 整身与细节必须有清晰角色分工
- 不能变成电商详情页，也不能只剩氛围图

## 验证标准

两条新入口都必须满足：

- `scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --output-dir out` 跑通到 `prepare`
- `prompt_validation_report.json`
  - `duplicatePromptCount: 0`
  - `qualityGates.ok: true`
  - `warnings: []`

全量验证：

- `node --test skills/interactive-image-batch/tests/smoke.test.js`
- `bash skills/interactive-image-batch/scripts/run_smoke_tests.sh`
- 目录检查命令
