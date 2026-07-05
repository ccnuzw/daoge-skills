# Host-Native 接入 Quickstart

这是一份给维护者改写的最小模板，不是最终用户文案。

你接一个新宿主时，建议先把下面内容复制出来，再按宿主类型改。

---

## 1. 先准备工作台和提示词

```bash
node scripts/daoge.js prepare \
  --task-spec /abs/path/task_spec.json \
  --output-dir /abs/path/output_dir
```

目标：

- 拿到 `debug/prompts.generated.json`
- 拿到 `workspace/index.html`

---

## 2. 把提示词交给宿主

你至少要拿到：

- `/abs/path/output_dir/debug/prompts.generated.json`
- 可选宿主侧交接包

---

## 3. 宿主侧完成出图

按宿主类型分别处理：

### A. 内置图像工具型宿主

- 把提示词清单里的最终 prompt 交给宿主工具
- 手动记录输出图片路径
- 手动整理 `host_native_results.json`

### B. 第三方工作台型宿主

- 批量导入 prompt
- 批量下载结果图
- 按下载结果整理 `host_native_results.json`

### C. 自建脚本批量宿主

- 直接消费 `debug/prompts.generated.json`
- 自动生成 `host_native_results.json`

---

## 4. 结果文件最小模板

参考：

- `references/host_native_results.schema.json`
- `references/examples/host-native/host_native_results.example.json`

最小形态：

```json
[
  {
    "index": "001",
    "title": "Host Native Success",
    "output": "/abs/path/result_001.png",
    "requestMode": "prompt-only",
    "status": "success"
  },
  {
    "index": "002",
    "title": "Host Native Review",
    "output": "/abs/path/result_002.png",
    "requestMode": "masked-edit",
    "status": "needs_review"
  },
  {
    "index": "003",
    "title": "Host Native Failed",
    "requestMode": "reference-assisted",
    "status": "failed",
    "error": "provider timeout"
  }
]
```

---

## 5. 导入

```bash
node scripts/daoge.js ingest \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

---

## 6. 导入后应该看到什么

至少应有：

- `internal/execution_manifest.json`
- `internal/issue_queue.json`
- `assets/results/` 或 `assets/issues/`
- `workspace/index.html`
- `workspace/results.html`
- `workspace/issues.html`
- `workspace/record.html`

---

## 7. 最后自检

推荐至少跑：

```bash
bash skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

如果你改了 schema、example 或导入逻辑，不要跳过这一步。
