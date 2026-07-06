# DAOGE v2 错误恢复闭环完成报告

## 结论

Goal 5 已完成错误恢复与用户自助闭环强化。当前 `workspace/issues.html`、`internal/issue_queue.json`、`internal/workspace_state.json` 和 `rerun --failed-only` 对失败原因、阻断状态、补跑能力、下一步动作保持一致。

本轮未跑真实 provider。验证均使用 dry-run、mock provider、fixture 和 host-native 本地导入。

## 已完成改动

以下为 Goal 5 整体变更汇总，不是本次补报告文件新增的代码改动。

- 补齐错误恢复设计文档：`docs/daoge_v2_error_recovery_plan_zh.md`。
- 补齐本完成报告：`docs/daoge_v2_error_recovery_report_zh.md`。
- 强化 `issue_queue` 契约字段：`userTitle`、`userMessage`、`userAction`、`reason`、`rerunnable`、`rerunReason`、`safeToIgnore`、`sourceResultId`、`sourcePromptIndex`、`targetPage`、`href`。
- 统一错误分类：
  - 缺素材：阻断，不直接补跑。
  - provider 超时：阻断，可补跑。
  - provider HTTP/API 失败：阻断，可补跑。
  - 成功记录缺图：阻断，可补跑或重新导入。
  - host-native schema 错误：导入前失败，不写假成功。
  - host-native 成功缺图：进入问题页，不假成功。
  - `needs_review`：只需人工确认，不阻断结果页。
  - `skipped` / dry-run 正常跳过：不当成真实失败。
- 强化 workspace 主动作：
  - 有阻断问题时指向 `issues.html`。
  - 只有复核项时指向 `results.html`，文案明确先确认。
  - prepare-only 不暗示已生成图片。
- 强化 `rerun --failed-only`：
  - 不重跑成功项。
  - 不盲目补跑缺素材项。
  - 不补跑普通失败且无明确补跑信号的项。
  - 只补跑 provider 失败、缺图或显式可补跑项。
  - 记录补跑来源、选中序号和标题。
- 强化 `issues.html`：
  - 显示必须处理、可补跑、要先补素材、只需复核、可忽略数量。
  - 每个问题显示用户标题、影响、是否可补跑、下一步动作。
  - 用户页面继续禁止内部工程词。

## 覆盖矩阵

| 场景 | 当前行为 | 测试覆盖 |
| --- | --- | --- |
| 素材缺失 | `must_handle`，`rerunnable=false`，提示先补素材 | unit + integration |
| provider 超时 | `must_handle` + `worth_rerun`，可 failed-only 补跑 | unit + integration |
| provider HTTP/API 失败 | `must_handle` + `worth_rerun`，可 failed-only 补跑 | unit + artifacts |
| 成功但输出文件缺失 | 不假成功，进 `issues.html`，可补跑 | unit + integration + contracts |
| host-native schema 错误 | ingest 前契约失败，不生成假工作区 | contracts |
| host-native 成功缺图 | 进 `issues.html`，概览不重复计数 | integration |
| host-native `needs_review` | 不阻断，主动作回结果页确认 | integration |
| failed-only 只补跑失败项 | 成功项不重跑，保留原 index/title | unit + integration |
| 普通失败无补跑信号 | 不进入 failed-only | unit |
| skipped / dry-run 正常跳过 | 不进入问题队列 | integration |
| 用户页面内部词 | `issues.html` 不出现内部工程词 | artifacts |

## 验证结果

以下验证结果引用 Goal 5 前序实现与补评审修复后的测试记录。本次仅补齐报告文件并检查文件存在，未重新运行测试。

Goal 5 前序实现已通过：

```bash
npm --prefix skills/interactive-image-batch run test:unit
npm --prefix skills/interactive-image-batch run test:contracts
npm --prefix skills/interactive-image-batch run test:integration
npm --prefix skills/interactive-image-batch run test:artifacts
```

补评审后已再次通过相关全量链路：

```bash
npm --prefix skills/interactive-image-batch run test:unit
npm --prefix skills/interactive-image-batch run test:integration
npm --prefix skills/interactive-image-batch run test:contracts
npm --prefix skills/interactive-image-batch run test:artifacts
```

## 剩余风险

- 真实 provider 的错误文本可能有新格式；当前分类覆盖 timeout、HTTP、fetch、非 JSON、缺图载荷等常见失败。
- ignored/resolved 仍是队列状态能力，未实现完整用户页面上的点击写回操作。
- `rerun --failed-only` 依赖传入的历史记录包含 index；无 index 的历史失败无法稳定映射原提示词。
