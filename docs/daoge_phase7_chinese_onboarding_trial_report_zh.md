# DAOGE 第七阶段中文入口试用回归报告

日期：2026-05-19  
范围：`skills/interactive-image-batch` 中文入口、中文任务地图、中文 catalog 首页

## 一、回归目标

本轮不验证模板扩容能力，只验证一件事：

**完全按中文入口使用时，新手是否还会卡住。**

本次试用严格限制使用路径：

- `START_HERE_中文.md`
- `references/template_map_zh.md`
- `node scripts/run_example_catalog_prepare.js --starter true`
- `node scripts/run_example_catalog_prepare.js --intent <name>`

不允许先读：

- `template_registry_zh.json`
- `references/templates/*`
- `variant_axes`
- `prompt_slots`
- `family / tier`

## 二、试用路径

本轮选 4 条最能代表中文使用入口的任务：

1. `--intent portrait`
2. `--intent packaging`
3. `--intent oralboard`
4. `--intent ecommerce`

执行命令：

```bash
node skills/interactive-image-batch/scripts/run_example_catalog_prepare.js --intent portrait --output-dir /tmp/daoge-trial-zh-portrait
node skills/interactive-image-batch/scripts/run_example_catalog_prepare.js --intent packaging --output-dir /tmp/daoge-trial-zh-packaging
node skills/interactive-image-batch/scripts/run_example_catalog_prepare.js --intent oralboard --output-dir /tmp/daoge-trial-zh-oralboard
node skills/interactive-image-batch/scripts/run_example_catalog_prepare.js --intent ecommerce --output-dir /tmp/daoge-trial-zh-ecommerce
```

## 三、试用结果

### 1. 命令层

结论：**4/4 全部可直接跑通。**

输出均成功生成：

- `task_spec.quickstart.json`
- `prompt_strategy.quickstart.json`
- `prepare/preflight_board.html`
- `prepare/prompt_preview.html`

其中 `oralboard` 额外包含：

- `storyboard_bundle.validation.quickstart.json`

说明：

- 中文 `intent` 入口已经足够稳定
- 新手不会在“第一条命令怎么写”这一层卡住

### 2. 文档层

结论：**中文入口链已经基本成立。**

优点：

- `START_HERE_中文.md` 先回答“从哪开始、看什么结果”
- `template_map_zh.md` 能把中文任务和内部模板名对应起来
- `README.md` 和 `examples/README.md` 已经不再强迫新手一上来理解工程实现

### 3. 页面层

结论：**人物、电商、包装三条路径已经比较贴脸，口播整板仍暴露底层实现语义。**

具体观察：

- `portrait`
  - `DAOGE 模板: 肖像主视觉`
  - 语义贴脸，用户容易理解
- `packaging`
  - `DAOGE 模板: 品牌包装板`
  - 语义贴脸，用户容易理解
- `ecommerce`
  - `DAOGE 模板: 电商主图`
  - 语义贴脸，用户容易理解
- `oralboard`
  - 首轮暴露问题：
    - 用户入口是“口播分镜整板”
    - 但页面显示成“电影分镜”
  - 这会让新手误以为自己走错模板

## 四、已修正问题

### 问题：`oralboard` 用户可见模板名不贴脸

根因：

- 底层检测正确复用了 `cinematic-storyboard`
- 但预检/预览展示层直接输出了底层模板名
- 导致用户看到“电影分镜”，而不是自己选择的“口播分镜整板”

修正：

- 预检 Markdown 总览改为优先显示 `task_spec.output_mode`
- 预检 HTML 总览改为优先显示 `task_spec.output_mode`
- 这样 `oralboard` 现在会显示：
  - `DAOGE 模板: 口播分镜整板`

用户收益：

- 用户看到的是任务语义
- 不需要理解系统内部的模板复用关系

## 五、当前结论

中文入口已经从“能跑”进入“基本可用”状态，主要结论如下：

1. 中文 `intent` 路径可以直接上手
2. 中文说明链已经能支持新手完成第一轮预检
3. 最大的问题已经不在命令层，而在少数页面摘要是否还暴露内部实现语义
4. 当前最有价值的工作不是继续扩模板，而是继续做：
   - 中文命名统一
   - 用户可见字段贴脸化
   - 文档信息减法

## 六、建议下一步

优先级建议：

1. 继续清理预检/预览页面中仍偏工程化的字段命名
2. 把 `intent` 帮助再压缩成更短的中文命令列表
3. 再做一轮“只看中文 catalog 页”的无说明试用回归

当前不建议继续做：

- 新增模板
- 新增 catalog 入口
- 新增 intent
- 扩更多正式变体

因为当前主要矛盾已经不是“能力不够”，而是“用户能不能稳地用起来”。
