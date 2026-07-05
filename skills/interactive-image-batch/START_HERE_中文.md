# DAOGE 使用入口

## 先记住

标准路径：

1. 选任务类型
2. 打开 `workspace/index.html`
3. 看准备
4. 看结果
5. 处理问题
6. 找资产

第一次使用先看：

- `references/task_catalog_zh.json`

## 选任务类型

常用 6 类：

- `portrait`：人物主视觉
- `studio`：棚拍质感图
- `ecommerce`：电商商品图
- `packaging`：品牌包装图
- `cinematic`：电影感分镜
- `oralboard`：口播分镜板

查看常用入口：

```bash
node scripts/run_example_catalog_prepare.js --starter true
```

按方向进入：

```bash
node scripts/run_example_catalog_prepare.js --intent portrait
node scripts/run_example_catalog_prepare.js --intent studio
node scripts/run_example_catalog_prepare.js --intent ecommerce
node scripts/run_example_catalog_prepare.js --intent packaging
node scripts/run_example_catalog_prepare.js --intent cinematic
node scripts/run_example_catalog_prepare.js --intent oralboard
```

## 跑完看哪里

只打开输出目录里的：

```text
workspace/index.html
```

然后按页面主动作走：

- 准备没完成：看 `workspace/prepare.html`
- 已有结果：看 `workspace/results.html`
- 有阻塞问题：看 `workspace/issues.html`
- 收口回看：看 `workspace/record.html`

## 资产在哪里

- 原始输入：`assets/inputs/`
- 参考素材：`assets/references/`
- 遮罩：`assets/masks/`
- 生成结果：`assets/results/`
- 建议复核：`assets/review/`
- 问题资料：`assets/issues/`
- 优先候选：`assets/selected/`
- 可交付成果：`assets/exports/`

新手不用打开 `internal/` 或 `debug/`。
