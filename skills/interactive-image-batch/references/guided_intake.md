# Guided intake

Use this reference before creating `task_spec.json`.

For user-facing dialogue, use Chinese by default. Read [dialogue_templates_zh.md](dialogue_templates_zh.md) before starting intake.

## Goal

Turn the conversation into an explicit run contract.

Do not start prompt generation until the required run controls are clear enough to survive a large batch without guesswork.

DAOGE has a runtime preset layer. Presets may supply missing run controls, but they do not supply content intent or style intent.

## Natural-language extraction first

Before asking the user for more information, DAOGE should first extract what is already present in the user's natural-language request.

Always try to extract these signals first:

- `content_brief`
- `output_mode`
- `source_files`
- `source_images`
- `style_requirements`
- `total_count`
- `run_preset`
- `width` / `height` / `aspect_ratio_label`
- `batch_size`
- `concurrency`
- `retry_count`
- `timeout_seconds`
- `variation_requirements`
- `text_policy`
- preview preference or “start immediately”

Rules:

- Do not ask again for values that were already explicit.
- If the user says `按 DAOGE 推荐`, `我不懂参数`, or similar, switch to preset-first mode and stop追问底层运行参数 unless there is a real ambiguity.
- If the user says `2K`, `9:16`, `海报`, or similar but does not give an exact size, prefer mapping that to `safe_2k_poster` unless the user later overrides it.
- If the user says `先预览`, infer `require_confirmation=true`.
- If the user says `直接开始`, infer `require_confirmation=false`.
- If the user gives a markdown file path plus a generation goal in one sentence, go straight into `md 文件驱动` intake and ask only for the missing items.
- If the user says this is a `分镜版`, `分镜板`, `六格分镜`, `每格都有垫图`, or `布局不固定`, switch to storyboard intake and ask for `layout_manifest / content_manifest / render_config` or equivalent structure.
- If the user says only some slots有垫图、其余靠提示词生成，按混合模式处理，不要默认全量参考图。
- If the user gives direct execution language such as `刀哥，来跑批`, `刀哥，生图`, `刀哥，开始跑`, or a complete md/prompt-json task sentence, switch to the experienced-user fast lane.

The first reply after extraction should look like:

1. what DAOGE has already understood
2. what is still missing
3. a short grouped follow-up question
4. 2-4 copyable example replies

For new users, do not begin with a full parameter form. Start with a novice-first menu:

1. choose a task type first
2. then choose a preset or “give me an md and use its style”
3. explain the options if asked
4. only expand the full parameter form when the user says they want custom parameters
5. whenever possible, provide copyable example replies so the user can answer without inventing phrasing

## Required conversation fields

These must be explicitly established in dialogue before the run starts:

- `content_brief`
- `output_mode`
- style source:
  - either `source_files`
  - or non-empty `style_requirements`
- if this is a storyboard board:
  - `storyboard_plan`
  - and the linked `layout_manifest` + `content_manifest` + `render_config`
  - optionally `reference_bindings`
  - support a mix of `reference-assisted` and `prompt-only` slots
- `total_count`
- runtime plan:
  - explicit 每批张数、图片宽高、并发数、失败重试次数、单张超时秒数
  - or a named DAOGE 运行预设
- `variation_requirements`
- `text_policy`
- confirmation mode:
  - either `require_confirmation=true`
  - or the user explicitly says to start immediately

## Uploaded storyboard references

When the user uploads multiple images in chat for a storyboard board, DAOGE should not immediately assume file-to-shot mapping.

Use this checklist:

1. confirm how many images were received
2. confirm how many storyboard slots need image generation
3. ask whether the mapping follows upload order
4. ask which slots are `prompt-only`
5. ask whether any image should map to multiple slots
6. echo back a draft `reference_bindings.json`

Suggested grouped prompt:

```text
我先帮你把参考图和分镜对上。

当前我收到：
- 参考图：X 张
- 目标分镜：Y 格

你直接告诉我三件事就行：
- 是否按上传顺序对应
- 哪些分镜不用图，直接走 prompt-only
- 有没有一张图要给多个分镜复用

我会先整理 reference_bindings.json，再继续预览。
```

If the user also uploads a mask image for one slot, extend the checklist with:

7. which uploaded image is the mask
8. which slot it belongs to
9. what region should change

Suggested grouped prompt:

```text
如果你这次还补了遮罩图，我再多确认三件事：
- 哪一张是遮罩图
- 这张遮罩图对应哪个分镜
- 这次只改哪个局部

我会把它写进 reference_bindings.json 的 mask_asset_ids，不会和普通参考图混掉。
```

## Single-slot edit intake

When the user says they only want to change one storyboard shot or one local region, DAOGE should switch to edit-intake instead of full rerun-intake.

Ask these four things:

1. which slot to change
2. whether to reuse the previous generated output as the edit base
3. whether a new mask image is provided
4. what exactly should change and what must stay unchanged

Suggested grouped prompt:

```text
我理解你这次不是整板重做，而是只改单格。

你直接告诉我这四件事：
- 改哪一个分镜：例如 分镜3 / shot_3
- 是否直接复用上一轮成图做底图
- 有没有新的遮罩图
- 只改什么，不要改什么

我会优先走单格局部编辑，不重跑整板。
```

Intent normalization hints:

- `只改分镜3 / 只改第3格 / 只改 shot_3` -> target the selected slot only
- `复用上一轮结果做底图 / 用上一版继续修` -> `reuse_output_as_reference=true`
- `我补一张遮罩图 / 我传一个 mask` -> expect or attach `mask_image`
- `只改蒸汽 / 只改右下角礼盒 / 只改盒盖高光` -> keep this in prompt constraints as “只改什么”
- `盒身别动 / 构图不变 / 其他分镜别动` -> keep this in prompt constraints as “不要改什么”

If the user gives both “selected slot” and “reuse previous output” clearly, DAOGE should treat it as local edit by default instead of failed-only rerun logic.

## Stability notes

Why these are required:

- 每批张数：controls staging and failure blast radius
- 图片宽高：avoids accidental 1K fallback and preserves native output intent
- 并发数：prevents provider overload and keeps runs predictable
- 失败重试次数：determines whether transient provider failures self-heal
- 单张超时秒数：avoids hanging indefinitely on slow generations
- 变化控制要求：reduces near-duplicate prompt collapse in large runs
- 文字排版策略：avoids accidental rendered text or missing poster-safe space

## DAOGE runtime presets

Use these presets when the user wants DAOGE to handle run controls:

- `safe_2k_poster`: default preset. 1440x2560, 9:16, conservative 2K poster settings, preview first.
- `large_batch_stable`: for 300-1000 image jobs with sample stage, staged execution, auto-pause, and resume-friendly defaults.
- `fast_preview`: for small quick direction checks.
- `provider_stress_safe`: for unstable or rate-limited providers with lower concurrency and stronger pause thresholds.

Rules:

- If the user does not choose a preset and omits runtime controls, use `safe_2k_poster`.
- If the user chooses a preset and also gives a specific value, keep the user value.
- Always show the selected preset and Chinese field source summary in the preflight dashboard.
- Never use presets to invent `content_brief`, `output_mode`, style source, `variation_requirements`, or `text_policy`.

## Recommended but optional fields

- `preview_count`
- `output_format`
- `identity_policy`
- `negative_requirements`
- `run_label`
- `notes`

## Size rule

If the provider benefits from native sizes aligned to hardware limits, confirm that `width` and `height` are legal for the target provider.

For the current local workflow, prefer widths and heights that are multiples of `16`.
For `openai` + `gpt-image-2`, also require:

- total pixels between `655360` and `8294400`
- aspect ratio no wider than `3:1`
- examples:
  - `1024x576` is invalid because `589824` pixels is below the minimum budget
  - `1280x720`, `1536x864`, `1024x1024`, and `1024x1536` are valid examples

## Intake template

When parameters are missing, the agent should gather them in compact grouped form instead of asking one question per field.

Before using any template below, do one extraction pass on the raw user message and convert obvious values into a draft task spec in memory.
Then use the template only to fill missing or ambiguous items.

Novice-first branching:

1. first offer a task-type menu:
   - I describe the content directly
   - give me an md and follow its style
   - I already have full prompts or prompt JSON
   - I want custom parameters
   - explain the task types first
2. then offer a run-mode menu:
   - use default safe 2K preset
   - use stable large-batch preset
   - explain the options first
3. if the user chooses a preset, ask only for:
   - content
   - total count
   - style source / md file
   - variation requirements
   - typography space
   - preview first or start immediately
4. if the user chooses `md` mode, ask only for:
   - md file path
   - what content to generate from it
   - total count
   - what style signals to keep
   - run mode or “use DAOGE recommendation”
   - typography space
5. if the user chooses custom parameters, then expand the full grouped intake
6. if the user says they do not understand parameters, default to DAOGE recommendation mode and keep the questions minimal
7. after every menu-like question, prefer to give 2-5 ready-made example replies

Automatic extraction follow-up order:

1. extract everything obvious from the user's original sentence
2. reflect it back in Chinese using “我先替你抽一版参数”
3. ask only for the missing fields
4. if the missing fields are all runtime controls and the user sounds uncertain, recommend a DAOGE preset instead of expanding the full form

## Experienced-user fast lane

Use the fast lane when the user already sounds like a repeat DAOGE operator.

Typical signals:

- gives a direct run command
- references `md 路径` or `prompts.json` immediately
- asks to rerun failures / continue expansion / resume an old batch
- already includes count + preset + execution intent in one sentence

Fast-lane rules:

- skip the long layered welcome
- skip the full novice menu
- reflect extracted parameters immediately
- ask only for missing fields
- if enough fields are already explicit, go straight to normalized confirmation or `prepare`

Suggested grouping:

1. Content and mode
   - what to generate
   - output mode
   - referenced markdown files or inline style instructions
2. Batch and size
   - total count
   - choose a DAOGE preset, or provide batch size, width, and height explicitly
3. Runtime controls
   - choose a DAOGE preset, or provide concurrency, retry count, and timeout seconds explicitly
4. Variation and layout
   - variation requirements
   - text policy
   - if it is a storyboard board: whether references are global or per-slot, and whether layout is fixed or variable
5. Execution gate
   - preview first or start immediately

## Chinese-first rule

Unless the user explicitly requests another language:

- ask intake questions in Chinese
- summarize normalized parameters in Chinese
- explain preview, confirmation, and rerun steps in Chinese
- translate validator failures into Chinese instead of echoing raw script errors

## Example normalized intent

```json
{
  "content_brief": "Generate a premium co-branded lingerie poster campaign",
  "output_mode": "photoreal campaign poster",
  "style_requirements": [
    "full-body",
    "premium fashion lighting",
    "poster-safe composition"
  ],
  "source_files": [
    "/abs/path/library.md"
  ],
  "run_preset": "large_batch_stable",
  "total_count": 300,
  "batch_size": 30,
  "width": 1440,
  "height": 2560,
  "concurrency": 10,
  "retry_count": 1,
  "timeout_seconds": 450,
  "variation_requirements": [
    "avoid near-duplicate prompts within the same batch",
    "spread hero prompts across all batches"
  ],
  "text_policy": "leave top and bottom clean for later typography",
  "preview_count": 12,
  "require_confirmation": true
}
```
