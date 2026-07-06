> 历史规划文档：本文只保留为设计、试跑或阶段记录，不作为当前发布入口。当前用户入口以 `skills/interactive-image-batch/README.md` 和 `docs/DAOGE_完整使用说明.md` 为准。

# DAOGE 第三轮意图入口试用回归报告

## 本轮范围

本轮按新用户视角，对 5 条意图入口做了真实试用回归：

- `ui`
- `academic`
- `packaging`
- `map`
- `typography`

统一路径：

- `--intent <name> -> quickstart -> prepare`

## 首轮结果

5 / 5 全部跑通，均成功生成：

- `task_spec.quickstart.json`
- `prompt_strategy.quickstart.json`
- `prompts.generated.quickstart.json`
- `prepare/workspace/prepare.html`
- `prepare/workspace/prepare.html`

这说明：

- 第三轮新增的“按任务意图开始”入口没有破坏链路
- onboarding 已经从“记模板名”推进到“先说任务意图”

## 试运行中发现的真实问题

虽然 5 条 intent 都能跑通，但首轮并不是全部都能直接开跑：

- `ui`
- `packaging`
- `map`

这 3 条在首轮会出现预检红灯。

### 根因

问题不在 `--intent` 入口本身，而在 quickstart 的 prompt 草稿展开层：

- `materialize_prompt_drafts.js`

当模板走 `template_prompt_sections` 路径时，部分非人物模板的 section 值没有被真正展开，导致：

- 可见 prompt 文本过短
- 不同条目之间文本差异不够
- `prompt_validation_report.json` 命中“重复提示词”

其中最明显的是 `packaging`：

- 4 条 quickstart prompt 几乎只剩一句 `Subject`
- 首轮直接出现 `duplicatePromptCount: 3`

## 已完成修复

修复位置：

- `skills/interactive-image-batch/scripts/materialize_prompt_drafts.js`

本次补齐了以下模板 section 的真实展开：

- `ui_goal`
- `screen_context`
- `module_hierarchy`
- `interaction_focus`
- `brand_goal`
- `asset_scope`
- `packaging_structure`
- `material_surface`
- `layout_hierarchy`
- `brand_finish`
- `figure_structure`
- `comparison_logic`
- `annotation_policy`
- `publication_finish`
- `map_goal`
- `spatial_structure`
- `route_landmark_logic`
- `label_legend_policy`
- `guide_finish`
- `text_render_policy`
- `presentation_finish`

## 修复后复跑结果

对以下 3 条问题 intent 做了第二轮复跑：

- `ui`
- `packaging`
- `map`

修复后结果：

- `ui`：`duplicatePromptCount 1 -> 0`
- `packaging`：`duplicatePromptCount 3 -> 0`
- `map`：`duplicatePromptCount 1 -> 0`

同时：

- 短 prompt 警告消失
- 预检不再因为重复提示词进入红灯

## 当前判断

第三轮的 onboarding 主线已经从：

- 推荐起步入口
- 按任务意图开始

进一步升级为：

- **按任务意图开始，并且默认 quickstart 不再轻易撞上“重复提示词”红灯**

这意味着第三轮已经不只是“入口更好懂”，而是“第一次上手的默认成功体验更稳定”。

## 对下一阶段模板扩充的启发

在继续做模板扩充之前，这轮试运行给出一个明确约束：

新增模板如果要进入 onboarding 层，至少要满足两件事：

1. 有明确的推荐起步定位或意图定位
2. quickstart 生成的 prompt 不能因为 section 展开不足而默认撞红灯

否则模板虽然“加入进来了”，但第一次使用体验仍然会掉回工程态。
