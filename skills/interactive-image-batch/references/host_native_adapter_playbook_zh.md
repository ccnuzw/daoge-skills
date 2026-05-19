# Host-Native 宿主接入手册

这份文档面向维护者，不面向最终用户。

目标只有一个：

把新的宿主环境接入 `interactive-image-batch` 时，尽量变成一套固定动作，而不是每次重新摸索。

---

## 一句话理解

DAOGE 的 `host-native` 路径现在分成四层：

1. 运行模式探测
2. prompt 交接包
3. 结果文件契约
4. 结果回填与审阅门户

接入一个新宿主时，你的工作基本就是：

1. 决定它属于哪类宿主
2. 让它吃下 `host_native_prompt_pack.json`
3. 让它吐出 `host_native_results.json`
4. 用校验和导入脚本接回 DAOGE

---

## 接入总流程

推荐按这个顺序走：

1. 先探测当前模式

```bash
node scripts/detect_runtime_mode.js
```

2. 生成 prompt 交接包

```bash
node scripts/build_host_native_prompt_pack.js \
  --prompts-file /abs/path/prompts.generated.json \
  --task-spec /abs/path/task_spec.normalized.json \
  --strategy-file /abs/path/prompt_strategy.normalized.json \
  --runtime-mode-file /abs/path/runtime_mode.json \
  --output-dir /abs/path/output_dir
```

3. 在宿主侧完成出图

4. 组织 `host_native_results.json`

5. 先校验结果文件

```bash
node scripts/validate_host_native_results.js \
  --results-file /abs/path/host_native_results.json
```

6. 再导入回 DAOGE 结果链

```bash
node scripts/ingest_host_native_results.js \
  --prompt-pack-file /abs/path/host_native_prompt_pack.json \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

7. 进入现有审阅入口

- `result_hub.html`
- `review_board.html`
- `completion_board.html`

---

## 宿主类型分类

### 1. 内置图像工具型宿主

典型特征：

- 宿主本身已经有图像生成按钮或内置工具
- 结果文件可能需要人工整理
- 更适合先走轻量 prompt 包，再做手动结果回填

适配重点：

- 让 prompt 包足够清楚
- 结果文件尽量按 schema 组织

### 2. 第三方工作台型宿主

典型特征：

- 有自己的任务面板、批量导入或导出机制
- 可能支持批量图像下载
- 结果更容易汇总成 `host_native_results.json`

适配重点：

- 保留稳定文件命名
- 让每条结果能回指 `index / title / slotId`

### 3. 自建脚本批量宿主

典型特征：

- 通常有自己的 CLI 或自动脚本
- 最容易和 DAOGE 的 JSON 契约直接对接
- 也最适合把 `host_native_results.json` 自动生成出来

适配重点：

- 直接复用 schema
- 让失败项也稳定写出 `status=failed` 和 `error`

---

## prompt 交接包怎么用

宿主侧接入时，优先关注这几个文件：

- `prompts.generated.json`
- `host_native_prompt_pack.json`
- `host_native_summary.md`
- `host_native_summary.html`

最低要求：

- 宿主能读到最终 prompt 列表
- 宿主能知道当前主模板、批次摘要和关键参数

不要求：

- 宿主必须理解 DAOGE 全部中间产物

也就是说，宿主接入优先吃“最终 prompt + 摘要”，而不是强行吃完整 prepare 链路。

---

## 结果文件怎么组织

优先参考：

- schema: `references/host_native_results.schema.json`
- example: `references/examples/host-native/host_native_results.example.json`

最小必填：

- `index`
- `title`
- `requestMode`
- `status`

常用补充：

- `output`
- `slotId`
- `scene`
- `composition`
- `textPolicy`
- `error`

原则：

- 成功或待复核项要带 `output`
- 失败项尽量带 `error`

---

## 校验与导入

不要直接把宿主结果文件丢给导入脚本。

推荐固定顺序：

1. 先跑 `validate_host_native_results.js`
2. 再跑 `ingest_host_native_results.js`

原因很简单：

- 校验负责挡住契约错误
- 导入负责生成结果链和门户

这样出问题时更容易定位到底是“宿主结果文件错了”，还是“导入逻辑坏了”。

---

## 常见错误

### 1. 结果文件缺 `output`

现象：

- `success` / `needs_review` 条目无法进入正常审阅

处理：

- 检查宿主是否导出了真实图片路径

### 2. `status` 写成宿主私有值

现象：

- 校验脚本直接拦截

处理：

- 映射到标准值：
  - `success`
  - `needs_review`
  - `failed`

### 3. 失败项没有 `error`

现象：

- 不一定阻断，但后续定位困难

处理：

- 让宿主导出最短错误原因

### 4. 结果文件能导入，但 review 看板信息太空

现象：

- 只有图片，没有足够上下文

处理：

- 补 `scene / composition / textPolicy / slotId`

---

## 维护建议

每接入一种新宿主，优先补两样东西：

1. 一个最小 `host_native_results.json` 示例
2. 一份接入备注或 quickstart

不要一上来改主脚本逻辑。

优先原则始终是：

- 先套现有契约
- 不够再扩 example
- 实在不够再扩 schema
