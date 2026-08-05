# DAOGE v2 错误恢复闭环设计

## 目标

用户遇到失败时，`workspace/issues.html`、`internal/issue_queue.json`、`internal/workspace_state.json` 和补跑命令必须给出同一套判断：

- 出了什么问题
- 是否阻断当前交付
- 是否能直接补跑
- 下一步该做什么
- 哪些可以忽略
- 哪些必须先处理

## 错误类型分类

| 类型 | 分组 | 阻断 | 可直接补跑 | 用户下一步 |
| --- | --- | --- | --- | --- |
| 缺少素材 | `must_handle` | 是 | 否 | 先补齐参考图、遮罩或输入素材，再执行 |
| provider 超时 | `must_handle` + `worth_rerun` | 是 | 是 | 可只补跑失败项 |
| provider HTTP/API 失败 | `must_handle` + `worth_rerun` | 是 | 是 | 可只补跑失败项；多次失败再检查配置 |
| 成功记录缺图 | `must_handle` + `worth_rerun` | 是 | 是 | 补跑、重新导入图片或接受缺口 |
| host-native schema 错误 | 命令失败，不写假成功 | 是 | 否 | 修正导入 JSON 后重试 |
| host-native 成功结果缺图 | `must_handle` + `worth_rerun` | 是 | 是 | 补图、修路径或补跑对应项 |
| `needs_review` | `needs_confirmation` | 否 | 否 | 先人工确认结果是否可用 |
| `skipped` / dry-run 跳过 | 不进入失败队列 | 否 | 否 | 说明未真实生成，不当成失败 |
| ignored/resolved | `can_ignore` / `resolved` | 否 | 否 | 保留历史，不影响主路径 |

## 用户可见文案原则

- 说结果，不说内部实现。用户页面不出现 `manifest`、`runtime`、`slot`、`artifact` 等词。
- 每个问题必须有一句用户标题、一句影响说明、一句下一步动作。
- “可补跑”只用于 provider 失败或输出文件缺失；缺素材必须先补素材。
- `needs_review` 不算失败。它提醒用户确认质量，不阻断可用结果。
- prepare-only 不暗示已经出图；只告诉用户还在准备阶段。

## `issue_queue` 字段语义

兼容旧字段，同时新增自助恢复字段：

- `id`：稳定问题编号。
- `group`：用户问题分组，如 `must_handle`、`needs_confirmation`、`worth_rerun`。
- `type`：旧契约类型，如 `hard_failure`、`needs_review`、`rerun_candidate`。
- `severity`：`blocking` 表示必须处理，`attention` 表示建议确认。
- `userTitle`：面向用户的问题标题。
- `userMessage`：面向用户的影响说明。
- `userAction`：建议下一步。
- `reason`：结构化原因，如 `missing_material`、`provider_timeout`、`provider_api_error`、`missing_output`。
- `rerunnable`：是否可以直接补跑。
- `rerunReason`：为什么能或不能补跑。
- `safeToIgnore`：是否可作为非关键缺口忽略。
- `sourceResultId`：来源结果 ID。
- `sourcePromptIndex`：来源提示词序号。
- `targetPage` / `href`：用户应打开页面。

## rerun 行为规则

- `failed-only` 只选择原始失败项，不选择成功项。
- 保留原始 `index`、`title`、`brief`，方便用户知道补跑哪张。
- 缺素材失败不进入直接补跑；提示先补素材。
- provider 超时、HTTP/API 失败、输出文件缺失可以进入补跑候选。
- dry-run 的正常跳过不是失败，不进入补跑候选。
- 补跑产物写入新工作区或显式输出目录，不覆盖旧成功结果。

## workspace 主动作规则

- 有阻断问题：主动作指向 `issues.html`。
- 只有 `needs_review`：主动作可指向 `results.html`，文案必须说明先确认。
- 无问题且有成功结果：主动作指向 `results.html`。
- 无执行结果或 prepare-only：停在准备阶段，不暗示已经生成图片。

## 可忽略与必须处理

- 必须处理：缺素材、provider 失败、成功记录缺图、host-native 成功缺图。
- 建议确认：`needs_review`。
- 可忽略：用户明确接受缺口后的问题，或非关键补跑候选。
- 已处理：用户已补素材、补跑成功或确认问题不影响交付。
