# Host-Native 接入 Quickstart

这是一份给维护者改写的最小模板，不是最终用户文案。

你接一个新宿主时，建议先把下面内容复制出来，再按宿主类型改。

---

## 1. 先确认当前模式

```bash
node scripts/detect_runtime_mode.js
```

目标：

- 确认当前应走 `host-native-image-tool`

---

## 2. 先产出 prompt 交接包

```bash
node scripts/build_host_native_prompt_pack.js \
  --prompts-file /abs/path/prompts.generated.json \
  --task-spec /abs/path/task_spec.normalized.json \
  --strategy-file /abs/path/prompt_strategy.normalized.json \
  --runtime-mode-file /abs/path/runtime_mode.json \
  --output-dir /abs/path/output_dir
```

你至少要拿到：

- `host_native_prompt_pack.json`
- `host_native_summary.md`

---

## 3. 宿主侧完成出图

按宿主类型分别处理：

### A. 内置图像工具型宿主

- 把 prompt 包里的最终 prompt 交给宿主工具
- 手动记录输出图片路径
- 手动整理 `host_native_results.json`

### B. 第三方工作台型宿主

- 批量导入 prompt
- 批量下载结果图
- 按下载结果整理 `host_native_results.json`

### C. 自建脚本批量宿主

- 直接消费 `host_native_prompt_pack.json`
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

## 5. 先校验，再导入

```bash
node scripts/validate_host_native_results.js \
  --results-file /abs/path/host_native_results.json
```

```bash
node scripts/ingest_host_native_results.js \
  --prompt-pack-file /abs/path/host_native_prompt_pack.json \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

---

## 6. 导入后应该看到什么

至少应有：

- `manifest.json`
- `success.json`
- `failed.json`
- `needs_review.json`
- `result_hub.html`
- `review_board.html`
- `completion_board.html`

---

## 7. 最后自检

推荐至少跑：

```bash
bash skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

如果你改了 schema、example 或导入逻辑，不要跳过这一步。
