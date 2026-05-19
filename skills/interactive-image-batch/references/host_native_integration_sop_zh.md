# Host-Native 接入 SOP

这份文档只保留检查顺序，不解释太多背景。

如果你在接一个新的宿主环境，固定按下面 7 步走。

---

## 1. 先判断宿主类型

先判断当前宿主属于哪类：

- 内置图像工具型
- 第三方工作台型
- 自建脚本批量型

如果连这一步都不清楚，先回去读：

- `references/host_native_adapter_playbook_zh.md`

---

## 2. 先生成 prompt 交接包

先跑：

```bash
node scripts/build_host_native_prompt_pack.js \
  --prompts-file /abs/path/prompts.generated.json \
  --task-spec /abs/path/task_spec.normalized.json \
  --strategy-file /abs/path/prompt_strategy.normalized.json \
  --runtime-mode-file /abs/path/runtime_mode.json \
  --output-dir /abs/path/output_dir
```

最低检查：

- `host_native_prompt_pack.json`
- `host_native_summary.md`

---

## 3. 按 schema 组织结果文件

宿主出图后，整理：

- `host_native_results.json`

优先参考：

- `references/host_native_results.schema.json`
- `references/examples/host-native/host_native_results.example.json`

如果你只是第一次接入，先照着：

- `references/examples/host-native/adapter_quickstart.example.md`

---

## 4. 先校验，再导入

先跑校验：

```bash
node scripts/validate_host_native_results.js \
  --results-file /abs/path/host_native_results.json
```

再跑导入：

```bash
node scripts/ingest_host_native_results.js \
  --prompt-pack-file /abs/path/host_native_prompt_pack.json \
  --results-file /abs/path/host_native_results.json \
  --output-dir /abs/path/output_dir
```

不要跳过校验。

---

## 5. 检查结果门户

导入后至少检查：

- `result_hub.html`
- `review_board.html`
- `completion_board.html`

如果这些都没出来，不要宣称接入完成。

---

## 6. 如果是新宿主模式，补 example 或说明

出现以下情况之一时，要补文档：

- 宿主结果字段有新习惯
- 命名方式有差异
- 需要额外接入备注

优先补：

- example
- quickstart
- playbook 备注

不要先改主脚本。

---

## 7. 最后跑统一 smoke

固定跑：

```bash
bash skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

如果 smoke 不绿，这次接入不算完成。

---

## 8. 接完后顺手归档

如果这次是一个新的宿主接入，最后顺手复制并填写：

- `docs/host_native_adapter_archive_template_zh.md`

不要把接入结论只留在会话或提交说明里。
