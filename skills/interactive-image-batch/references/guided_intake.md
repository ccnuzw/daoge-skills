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
- `total_count`
- runtime plan:
  - explicit 每批张数、图片宽高、并发数、失败重试次数、单张超时秒数
  - or a named DAOGE 运行预设
- `variation_requirements`
- `text_policy`
- confirmation mode:
  - either `require_confirmation=true`
  - or the user explicitly says to start immediately

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
- `contact_sheet`
- `identity_policy`
- `negative_requirements`
- `run_label`
- `notes`

## Size rule

If the provider benefits from native sizes aligned to hardware limits, confirm that `width` and `height` are legal for the target provider.

For the current local workflow, prefer widths and heights that are multiples of `16`.

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
