# DAOGE Interactive Image Batch

## 新手路径

普通用户只走这一条：

1. 选任务类型：`references/task_catalog_zh.json`
2. 生成准备或执行输出
3. 打开输出目录的 `workspace/index.html`
4. 看准备：`workspace/prepare.html`
5. 看结果：`workspace/results.html`
6. 处理问题：`workspace/issues.html`
7. 找资产和回看记录：`assets/`、`workspace/record.html`

`workspace/index.html` 是唯一推荐入口。页面上的主动作会告诉你下一步进准备、结果、问题还是记录。

## 常用起步

先看 6 个常用任务：

```bash
node scripts/run_example_catalog_prepare.js --starter true
```

按任务方向起步：

```bash
node scripts/run_example_catalog_prepare.js --intent portrait
node scripts/run_example_catalog_prepare.js --intent studio
node scripts/run_example_catalog_prepare.js --intent ecommerce
node scripts/run_example_catalog_prepare.js --intent packaging
node scripts/run_example_catalog_prepare.js --intent cinematic
node scripts/run_example_catalog_prepare.js --intent oralboard
```

## 输出目录

- `workspace/`：五个用户页面
- `assets/inputs/`：原始输入
- `assets/references/`：人物、风格、场景、产品参考
- `assets/masks/`：局部修改范围
- `assets/results/`：全部生成结果
- `assets/review/`：建议复核结果
- `assets/issues/`：问题资料
- `assets/selected/`：用户已选、建议优先看的候选，或等待选择的占位
- `assets/exports/`：可交付候选和交付清单
- `assets/archive/`：历史过程资料

维护资料在 `internal/` 和 `debug/`。新手不用打开。

## 维护说明

v2 架构、契约和调试分层见：

- `docs/architecture_v2_zh.md`
