# DAOGE 第七阶段中文 Catalog 单页试用回归报告

日期：2026-05-19  
范围：`references/examples/examples_catalog.html` 中文任务首页  
目标：验证用户在**不看任何说明文档**的情况下，是否能只靠中文 catalog 首页选对入口并顺利跑到 `prepare`

## 一、试用前提

本轮试用刻意不允许先看：

- `README.md`
- `README.md`
- `template_map_zh.md`

只允许用户看到：

- `references/examples/examples_catalog.html`

也就是模拟更真实的情况：

- 用户直接点开 catalog 首页
- 只根据首页任务分组、意图卡片和起步入口做选择

## 二、首页结构检查

当前中文 catalog 首页已收缩为：

### 首屏 6 个任务意图

- `portrait`
- `studio`
- `ecommerce`
- `packaging`
- `cinematic`
- `oralboard`

### 首屏 6 个推荐起步入口

- 肖像主视觉
- 棚拍大片
- 电商主图
- 品牌包装板
- 电影分镜组
- 口播分镜整板

这意味着首页不再把 20+ starter 和 100+ example 直接摊给第一次使用者。

## 三、真实试用路径

本轮只从首页可见的 6 个任务意图里抽 3 条最典型路径：

1. `portrait`
2. `ecommerce`
3. `oralboard`

执行命令：

```bash
node skills/interactive-image-batch/scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --intent portrait --output-dir /tmp/daoge-trial-catalog-only-portrait
node skills/interactive-image-batch/scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --intent ecommerce --output-dir /tmp/daoge-trial-catalog-only-ecommerce
node skills/interactive-image-batch/scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --intent oralboard --output-dir /tmp/daoge-trial-catalog-only-oralboard
```

## 四、试用结果

结论：**3/3 全部可跑通到 `prepare`。**

### 1. 肖像主视觉

- 命中入口：`portrait-kv`
- 结果：
  - `task_spec.quickstart.json`
  - `prompt_strategy.quickstart.json`
  - `prepare/preflight_board.html`
  - `prepare/prompt_preview.html`

### 2. 电商主图

- 命中入口：`ecommerce-clean`
- 结果：
  - `task_spec.quickstart.json`
  - `prompt_strategy.quickstart.json`
  - `prepare/preflight_board.html`
  - `prepare/prompt_preview.html`

### 3. 口播分镜整板

- 命中入口：`oral-storyboard-board`
- 结果：
  - `task_spec.quickstart.json`
  - `prompt_strategy.quickstart.json`
  - `prepare/preflight_board.html`
  - `prepare/prompt_preview.html`
  - `storyboard_bundle.validation.quickstart.json`

## 五、当前判断

本轮回归说明两件事：

1. **中文 catalog 首页现在已经能承担“第一次选入口”的职责**
   - 用户不必先理解模板名
   - 只靠中文任务意图就能完成第一次选择

2. **做减法是对的**
   - 当首页只保留 6 个高频入口时，选择成本明显下降
   - 如果把全部 starter 再摊回首页，用户会再次进入“看不懂、选不动”的状态

## 六、仍然存在的问题

虽然首页已经能承担第一次选择，但还存在两个残留问题：

1. 首页下半部分仍然保留完整大类 + 主链 + 变体入口
   - 这对第二步探索有价值
   - 但对极弱新手来说，仍可能形成信息压力

2. 首页卡片里仍会显示内部字段
   - 例如 `template_id`
   - `template_variant`
   - `example_file`
   - 这些字段更适合“维护者详情”，不适合作为新手第一屏信息

## 七、建议下一步

优先级建议：

1. 把 catalog 首页卡片继续压缩成“新手视图 / 维护视图”
2. 新手视图只显示：
   - 中文任务名
   - 适合做什么
   - 一条命令
3. 把 `template_id / template_variant / example_file` 收到“展开详情”里

当前不建议：

- 继续加新入口
- 继续加新 starter
- 继续加新 intent

因为首页可用性的主要矛盾，已经不是“入口不够”，而是“入口太多后如何不压垮第一次使用的人”。
