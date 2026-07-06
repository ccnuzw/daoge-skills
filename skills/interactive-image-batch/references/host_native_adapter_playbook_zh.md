# Host-Native 宿主接入手册

这份文档面向维护者，不面向最终用户。

目标只有一个：

把新的宿主环境接入 `interactive-image-batch` 时，尽量变成一套固定动作，而不是每次重新摸索。

---

## 一句话理解

DAOGE 的 `host-native` 路径现在分成三层：

1. 准备阶段生成提示词和工作台
2. 宿主侧按提示词完成出图
3. 结果文件回填到工作台主链

接入一个新宿主时，你的工作基本就是：

1. 决定它属于哪类宿主
2. 让它吃下 `debug/prompts.generated.json` 或等价提示词清单
3. 让它吐出 `host_native_results.json`
4. 用 `scripts/daoge.js ingest` 接回 DAOGE

---

## 接入总流程

推荐按这个顺序走：

1. 先准备 DAOGE 工作台和提示词

```bash
node scripts/daoge.js prepare \
  --task-spec /abs/path/task_spec.json \
  --output-dir /abs/path/output_dir
```

2. 在宿主侧读取提示词

- `/abs/path/output_dir/debug/prompts.generated.json`

3. 在宿主侧完成出图

4. 组织 `host_native_results.json`

5. 导入回 DAOGE 结果链

```bash
node scripts/daoge.js ingest \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

如果宿主侧另有交接包，也可以一并传入：

```bash
node scripts/daoge.js ingest \
  --prompt-pack-file /abs/path/host_native_prompt_pack.json \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

6. 进入工作台主链审阅入口

- `workspace/index.html`
- `workspace/results.html`
- `workspace/issues.html`
- `workspace/record.html`

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

- `debug/prompts.generated.json`
- 可选宿主侧交接包

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
- 相对 `output` 路径按 `host_native_results.json` 所在目录解析
- 失败项尽量带 `error`

---

## 校验与导入

不要绕过 DAOGE 的导入入口手工写结果链。

推荐固定入口：

```bash
node scripts/daoge.js ingest \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

原因很简单：

- `ingest` 会先校验宿主结果契约
- 合法结果再进入结果链和工作台主链

这样出问题时更容易定位到底是“宿主结果文件错了”，还是“导入逻辑坏了”。

---

## 常见错误

### 1. 结果文件缺 `output`

现象：

- `success` / `needs_review` 条目无法进入正常审阅

处理：

- 检查宿主是否导出了真实图片路径
- 如果写相对路径，确认它是相对 `host_native_results.json` 所在目录，而不是相对 DAOGE 输出目录

### 2. `status` 写成宿主私有值

现象：

- `ingest` 内置校验直接拦截

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
- 如有分镜名，可补 `shotLabel`

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
