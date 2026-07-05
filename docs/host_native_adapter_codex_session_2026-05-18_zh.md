# Host-Native 宿主接入成果归档

## 1. 基本信息

- 宿主名称：Codex 会话内置图像工具信号演练环境
- 宿主类型：内置图像工具型
- 接入日期：2026-05-18
- 接入人：Codex
- 关联分支 / 会话标识：`main`

---

## 2. 本次目标

- 这次接入要解决什么：
  - 验证 `host-native` 路径是否能从模式探测、prompt 包、结果 schema 校验，一路走到结果回填与审阅门户
- 预期接到哪一层：
  - 全链路验证

---

## 3. 已验证能力

- 运行模式探测：
  - 已验证
- prompt 交接包：
  - 已验证
- `host_native_results.json` 组织：
  - 已验证
- schema 校验：
  - 已验证
- 结果回填：
  - 已验证
- `result_hub / review_board / completion_board`：
  - 已验证

---

## 4. 关键文件与字段映射

### 4.1 宿主侧输入

- 宿主实际读取哪些文件：
  - `prompts.generated.json`
  - `host_native_prompt_pack.json`
- 是否直接消费 `host_native_prompt_pack.json`：
  - 是，作为主摘要与交接文件
- 是否只消费 `prompts.generated.json`：
  - 否，仍建议同时看 prompt pack

### 4.2 宿主侧输出

- 结果文件路径：
  - `/tmp/daoge-host-native-demo.z0FzP4/host_native_results.json`
- 图片输出路径规则：
  - 演练中为临时目录下的绝对路径 PNG
- 命名规则：
  - `host_result_1.png`
  - `host_result_2.png`

### 4.3 字段映射

| DAOGE 字段 | 宿主字段/来源 | 备注 |
|-----------|---------------|------|
| `index` | `host_native_results.json.index` | 直接映射 |
| `title` | `host_native_results.json.title` | 直接映射 |
| `requestMode` | `host_native_results.json.requestMode` | 直接映射 |
| `status` | `host_native_results.json.status` | 映射为 `success / needs_review / failed` |
| `output` | `host_native_results.json.output` | 成功/待复核项必带 |
| `slotId` | `host_native_results.json.slotId` | 演练中使用 `shot_1~3` |
| `error` | `host_native_results.json.error` | 失败项提供 |

---

## 5. 已跑命令

```bash
# prepare prompt list and workspace
node skills/interactive-image-batch/scripts/daoge.js prepare \
  --task-spec /tmp/daoge-host-native-demo.z0FzP4/task_spec.json \
  --output-dir /tmp/daoge-host-native-demo.z0FzP4/out

# ingest host-native results
node skills/interactive-image-batch/scripts/daoge.js ingest \
  --results-file /tmp/daoge-host-native-demo.z0FzP4/host_native_results.json \
  --output-dir /tmp/daoge-host-native-demo.z0FzP4/out/ingested

# run smoke
bash skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

---

## 6. 验证结果

- 关键输出文件是否生成：
  - 是
  - 已生成 `manifest.json`、`success.json`、`failed.json`、`needs_review.json`
  - 已生成 `daoge_result_hub.md`、`result_hub.html`、`review_board.html`、`completion_board.html`
- smoke 是否通过：
  - 是
  - `run_smoke_tests.sh` 全绿
- 是否存在人工绕过步骤：
  - 否
  - 结果文件先过 schema 校验，再导入
- 是否还有未验证路径：
  - 有
  - 尚未验证真实第三方宿主的自动结果收集
  - 尚未验证 storyboard 装板类 host-native 结果回填

---

## 7. 已知限制

- 限制 1：
  - 这次演练使用的是临时本地结果文件，不代表真实第三方宿主的下载或导出链路已经验证
- 限制 2：
  - 当前 `host-native` 结果回填更偏单轮静态图片，不包含更复杂的 storyboard 装板回填
- 限制 3：
  - 宿主结果文件仍需外部整理或外部脚本生成，当前没有自动抓取器

---

## 8. 后续建议

- 这个宿主适合什么场景：
  - 验证 `host-native` 全链路是否可用
  - 演练 prompt 包到结果门户的最小闭环
- 不适合什么场景：
  - 证明第三方宿主真实下载链路已经成熟
  - 证明 storyboard 复杂回填已完善
- 下次再接入时，优先复用哪份文件：
  - `references/host_native_integration_sop_zh.md`
  - `references/host_native_adapter_playbook_zh.md`
  - `references/examples/host-native/adapter_quickstart.example.md`
  - `docs/host_native_adapter_archive_template_zh.md`

---

## 9. 最终结论

- 可作为实验性支持宿主

补充说明：

- 本次演练过程中发现并修复了一个真实问题：
  - `scripts/daoge.js ingest` 原来先渲染 `result_hub`，后渲染 `review_board`
  - 这会导致结果总入口第一次生成时看不到审阅入口
  - 现已调整顺序，先产出 `review_board` / `rerun_board`，再产出 `result_hub`
