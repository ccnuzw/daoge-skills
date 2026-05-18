---
name: interactive-image-batch
description: Interactive batch image generation for DAOGE / 刀哥 from conversation requirements and optional referenced markdown prompt libraries. Trigger this skill when the user asks for DAOGE, 刀哥, 交互式批量生图, or uses colloquial wake-up phrases such as “刀哥，我来了”, “刀哥，干活”, “刀哥，来跑批”, “刀哥，生图”, “刀哥，起来干活”, “刀哥，开工”, “刀哥，出图”, “刀哥，开始跑”, “刀哥，准备干活”, “刀哥，开始批量生图”, “DAOGE，开工”. Use when Codex needs to read a user-provided `.md`/prompt library, synthesize many differentiated prompts, and run configurable native image generation batches where API settings come from local `.env` and run parameters such as total count, batch size, concurrency, retries, timeout, size, aspect ratio, and style constraints are injected through dialogue.
---

# Interactive image batch

Use this skill to turn the current conversation into a prompt batch and run it through the bundled batch runner.

All user-facing dialogue for this skill should be in Chinese unless the user explicitly requests another language.
If the user uses a DAOGE / 刀哥 wake-up phrase such as `刀哥，我来了`, `刀哥，干活`, `刀哥，来跑批`, `刀哥，生图`, `刀哥，起来干活`, `刀哥，开工`, `刀哥，出图`, `刀哥，开始跑`, `刀哥，准备干活`, `刀哥，开始批量生图`, `DAOGE，开工`, or similar colloquial variants, treat that as an activation request for this skill and immediately show the DAOGE layered welcome flow before the first intake turn.
On first activation, use the layered welcome flow from `references/dialogue_templates_zh.md`: first the ASCII welcome header, then the DAOGE self-introduction, then the novice-first startup menu before intake questions.
Treat `DAOGE` as the conversational agent identity throughout the intake, preview, confirmation, and completion flow.
Use Chinese display labels for user-facing parameter names. Internal JSON may keep machine fields such as `batch_size`, but dialogue, preview dashboards, and summaries should show labels such as `每批张数`, `并发数`, and `失败重试次数`.
For usability, every major user-facing step should include a DAOGE status line, a compact three-item summary when there is enough information, and short Chinese quick replies the user can copy verbatim.
Support an experienced-user fast path. When the user already sounds like a repeat DAOGE user and gives a direct execution phrase such as `刀哥，来跑批`, `刀哥，生图`, `刀哥，开始跑`, `我先给你一个 md`, or `我已经有 prompts.json`, prefer the concise fast-lane flow from `references/dialogue_templates_zh.md`: skip the long self-introduction, keep only a compact DAOGE identity line, echo extracted parameters, and ask only for missing fields.

## Workflow

1. Read the current user request carefully.
2. Before generating prompts, run a guided intake pass. Use [references/guided_intake.md](references/guided_intake.md) and [references/dialogue_templates_zh.md](references/dialogue_templates_zh.md). First perform a natural-language extraction pass on the user's original sentence or paragraph: extract any explicit content, mode, count, size, preset, timeout, retry, concurrency, preview preference, markdown file path, style retention, or text-layout signals before asking questions. Do not proceed until the required conversation fields are explicit. For first-time or uncertain users, start with the novice-first menu instead of the full parameter form, and only expand into full custom parameters when the user asks for it. The default startup shape should be two-step: first choose task type, then choose run mode. Whenever possible, show copyable example replies so the user can answer by picking rather than composing.
3. Read any markdown or prompt-library files explicitly referenced in the request. If the user chooses the `md 文件驱动` branch, prefer asking only for the file path, generation target, total count, style-retention rule, and typography policy before you read and synthesize the library.
4. Build a `task_spec.json` before prompt generation. Use [references/task_spec.md](references/task_spec.md) for the schema and normalization rules.
4.1. If the user is building a storyboard board with per-shot references or variable layout, also read [references/storyboard_board_mode.md](references/storyboard_board_mode.md). Keep layout, content, and render policy as separate manifests instead of collapsing them into one fixed prompt schema.
4.2. If the user uploads images in the chat rather than passing file paths, treat the attachments as storyboard reference assets and ask for or infer a `reference_bindings.json` mapping. If the user says "按上传顺序对应", bind assets to slots in that order. If only some slots have references, mark the rest `prompt-only`.
4.3. If the user uploads an extra image and says it is a mask / 遮罩图 for one slot, keep it separate from normal references. Bind it through `reference_bindings.json -> slot_assignments[].mask_asset_ids`, then surface that slot as `masked-edit` in preview and preflight.
4.4. When the assets come from unstable desktop/chat paths, prefer `scripts/import_reference_assets.js` before storyboard validation. It should copy uploaded files into the current run directory, create `reference_bindings.imported.json`, and emit `task_spec.with_imported_assets.json` so downstream validation uses stable paths instead of transient attachment locations.
4.5. The asset importer now has two inference layers:
   - rule inference: filename / label / notes / slot-order heuristics, enabled by default
   - vision inference: optional `--enable-vision-analysis true`, used as a recommendation layer for unbound assets when `.env` provides a working Responses endpoint
   Keep explicit user slot assignments authoritative. Use vision inference to improve defaults, not to silently override confirmed mappings.
4.6. If the user gives a short Chinese binding sentence instead of a JSON manifest, prefer `--binding-text "<中文说明>"`. Supported patterns include sequential bindings such as `前两张按上传顺序对应 shot_1、shot_2`, explicit ordinals such as `第一张给 shot_1`, and mask statements such as `最后一张是 shot_2 的遮罩图`.
4.7. If the user wants the system to understand a richer Chinese binding description before execution, prefer the two-step planner:
   - `scripts/generate_binding_intent_draft.js` to produce `binding_intent_draft.json`
   - `scripts/plan_binding_from_draft.js` to normalize it into `binding_plan.json`
   Then pass the plan into `import_reference_assets.js`. Do not let the LLM draft directly become the final execution binding without the planner step.
5. Run `scripts/validate_task_spec.js --task-spec /abs/path/task_spec.json` to normalize defaults and catch missing fields. The validator applies the DAOGE runtime preset layer from [references/run_presets_zh.json](references/run_presets_zh.json): explicit dialogue values win, preset values only fill missing runtime controls, and the normalized spec records `field_sources`.
5.1. If `task_spec.storyboard_plan.enabled=true`, run `scripts/validate_storyboard_bundle.js --task-spec /abs/path/task_spec.normalized.json` and treat its `slot_blueprint` / `generation_slots` as the storyboard-slot contract.
6. If validation fails because a required content or style field is missing, go back to dialogue in Chinese and resolve it. Runtime controls may be supplied by `run_preset`, but content intent must not be guessed.
7. Extract style signals from referenced files instead of copying them verbatim when the user wants a different output mode.
8. Build a `prompt_strategy.json` before generating prompts. Use [references/prompt_strategy.md](references/prompt_strategy.md) for the schema and planning rules.
9. Run `scripts/validate_prompt_strategy.js --strategy-file /abs/path/prompt_strategy.json --task-spec /abs/path/task_spec.normalized.json`.
10. Detect DAOGE mode and template. Use `scripts/detect_daoge_mode.js` plus [references/template_registry_zh.json](references/template_registry_zh.json). If `template_document` exists in the detection result, use it as the detailed playbook for the selected template.
11. Treat the detected template as a writing contract, not only a label. Carry its required fields, prompt section order, negative terms, quality rules, anti-patterns, template variants, default variant axes, and autofill policy into the prompt slots.
12. When the task needs stronger variation, add `variant_axes` to `prompt_strategy.json` for matrix-controlled fields such as `camera_language`, `lighting`, `mood`, `grid_role`, `story_beat`, `ad_test_hypothesis`, `detail_page_role`, `gesture`, or `exposure_signal`. If the strategy does not define axes, the prepare script may inherit template defaults.
13. Run `scripts/scaffold_prompt_bundle.js --strategy-file /abs/path/prompt_strategy.normalized.json --mode-file /abs/path/daoge_mode_detection.json` to create `prompt_slots.json`.
13.1. In storyboard mode, also pass `--storyboard-file /abs/path/storyboard_bundle.validation.json` so prompt slots inherit `shot_id`, `slot_role`, `reference_images`, `continuity_notes`, and `camera_move`.
13.2. If a `reference_bindings.json` exists, pass it through the storyboard validator so the slot-to-image mapping can be checked before preview.
14. Run `scripts/materialize_prompt_drafts.js --slots-file /abs/path/prompt_slots.json` to create `prompt_draft_bundle.json`. Draft prompts should follow the selected template section order and visibly include assigned `variant_axes`.
15. Refine `prompt_draft_bundle.json` into `prompts.generated.json` by polishing `generation_prompt` and `negative_prompt` while preserving the scaffolded metadata, template fields, `variant_axes`, and `variant_signature`.
16. Treat dialogue as the primary source of truth for:
   - content requirements
   - output mode
   - style requirements
   - total image count
   - batch size / whether to stage execution
   - width and height
   - timeout, retry count, and concurrency
   - variation requirements
   - whether to reserve typography space
   - whether to preview prompts before running
17. When the user looks confused by parameters, switch from parameter names to beginner language such as “一次跑多少张”, “接口压力”, “单张等待多久”, and “是否留文案空间”. The goal is to help the user choose, not to make them write a config sheet.
18. Before asking follow-up questions, summarize the fields you successfully extracted from the user's natural-language request and ask only for missing or ambiguous items. Do not ask the user to restate values that were already explicit.
19. If the user already provided task type, source file, count, preset, or execution intent in the first sentence, treat them as an experienced user by default unless they ask for explanation. Use the fast-lane template instead of the full layered welcome, and keep the reply within one compact screen when possible.
20. Treat DAOGE runtime presets as a secondary source of truth for missing run controls only. Default preset is `safe_2k_poster`; user can choose `large_batch_stable`, `fast_preview`, or `provider_stress_safe`, and can override any preset field in dialogue.
21. Treat `.env` only as the source for `OPENAI_BASE_URL` and `OPENAI_API_KEY`. Use `OPENAI_MODEL` if present; otherwise default to `gpt-image-2`.
22. Build a prompt file before generating images. Save it as `prompts.generated.json`.
23. Run `scripts/validate_prompt_bundle.js --prompts-file /abs/path/prompts.generated.json --task-spec /abs/path/task_spec.normalized.json`. Treat `qualityGates` in the report as the preflight quality gate: surface near-duplicates, short prompts, missing template-required fields, campaign-poster omissions, and size issues before execution.
24. When the required dialogue parameters are explicit or supplied by `run_preset`, trigger `prepare` mode. Use `scripts/daoge_prepare_run.js` as the default unified preflight entrypoint.
24.1. If storyboard mode uses uploaded desktop/chat assets, pass `--import-reference-assets true` and either `--assets-manifest /abs/path/assets_manifest.json` or `--references/--masks + --slot-order` so prepare can import, classify, and bind those assets before preflight.
25. By default, `prepare` should generate:
   - `prompt_preview.md`
   - `batch_plan.json`
   - `prompt_validation_report.json`
   - `daoge_run_summary.md`
   - `daoge_mode_detection.json`
   - `daoge_preflight_dashboard.md`
   - and then show the user the preflight dashboard plus a concise Chinese summary
26. Require explicit confirmation after `prepare` unless the normalized task spec says `require_confirmation=false`.
27. Only skip preview or confirmation when the user explicitly says to start immediately.
28. The preflight dashboard must present a Chinese red/yellow/green readiness conclusion. Red means do not run yet, yellow means runnable but adjustment is recommended, green means ready to execute.
28.1. If a slot is `reference-assisted` or `masked-edit`, missing `reference_images` or `mask_image` that would cause execution to fail must be surfaced as blocking preflight errors rather than warnings.
29. After user confirmation, trigger `execute` mode with `scripts/run_batch.js` and explicit CLI arguments derived from the normalized task spec, including `sample_size`, `stage_size`, `auto_pause`, `max_consecutive_failures`, `max_batch_failure_rate`, and `skip_existing` when present.
30. Verify outputs with the script manifest and local size checks before claiming completion.
31. If any images fail, do not manually reconstruct a prompt subset. Use `scripts/run_batch.js --resume-manifest /abs/path/manifest.json --failed-only true` with the original `prompts.generated.json` to rerun only failed items into a new output directory.
32. For interrupted same-directory runs, use `--skip-existing true` so completed image+metadata pairs are skipped and only missing items are generated.
32.1. If the user says they only want to change one storyboard shot or one local region, switch to local-edit mode instead of failed-rerun mode. Prefer `--resume-manifest + --select-slot-ids/--select-indexes + --reuse-output-as-reference true`, and ask whether a new `mask_image` exists.
32.2. When `--reuse-output-as-reference true` is used for storyboard or local-edit tasks, prefer matching previous successful outputs by `slot_id`. Do not silently fall back to a looser match if that would risk binding the wrong previous output.
33. When users upload images plus a long prompt for a storyboard board, keep the interaction friendly and structured:
   - first confirm the number of images received
   - then ask which slot each image should map to
   - then ask which slots should remain prompt-only
   - then echo back the inferred `reference_bindings.json` before preparing
33. For large runs, prefer staged execution: use `--sample-size`, `--stop-after-sample`, `--stage-size`, `--max-consecutive-failures`, and `--max-batch-failure-rate`.
34. After execution, use the operational artifacts for review and next actions: `job_state.json`, `checkpoint.json`, `stage_plan.json`, `success.json`, `failed.json`, `skipped.json`, `needs_review.json`, `rerun_candidates.json`, `selection_board.md`, `operations_report.md`, and the global `generated_images/daoge_run_index.md`.
35. For storyboard local-edit tasks, explicitly surface whether each selected slot is:
   - `prompt-only`
   - `reference-assisted`
   - `masked-edit`
   - reusing `previous-output` as the edit base

## Transport policy

- Favor success rate over forcing one unified API.
- `prompt-only`:
  - default path: `POST /v1/images/generations`
  - optional modern path: `POST /v1/responses` with `image_generation`
  - when `--generate-path /v1/responses` is enabled, try Responses first and fall back to Images API on failure
- `reference-assisted` means one or more `reference_images` and no `mask_image`
  - default path: `POST /v1/images/edits`
  - provider-specific modern path: `POST /v1/responses` with `image_generation` and `input_image`
  - when `--edit-path /v1/responses` is enabled, try Responses first and fall back to Images API edits on failure
- `masked-edit` means `reference_images` plus `mask_image`, or any explicit local inpainting request
  - fixed safe path: `POST /v1/images/edits` with multipart `FormData`
  - do not route masked edits through the Responses bridge in this runner unless that path has been separately implemented and verified
- Recommended defaults for production reliability:
  - prompt-only: keep Images API unless the provider clearly prefers Responses
  - reference-assisted: use Responses first only if you have already verified that provider path
  - masked-edit: keep Images API
- Configuration knobs:
  - prompt-only Responses: `--generate-path /v1/responses`
  - reference-assisted Responses: `--edit-path /v1/responses`
  - top-level Responses model: `--responses-model <model>` or `OPENAI_RESPONSES_MODEL=<model>`

When the source file is a style library rather than a ready-to-run prompt file, read [references/prompt_synthesis.md](references/prompt_synthesis.md) and convert the library into reusable dimensions before generating prompts.

## Prompt building

Generate prompt sets as JSON arrays with items shaped like:

```json
[
  {
    "index": 1,
    "slug": "night-penthouse",
    "title": "Night penthouse",
    "style_family": "urban-night",
    "scene": "high-rise apartment window with city lights",
    "wardrobe": "black bodysuit with oversized white shirt",
    "lighting": "cool-warm cinematic mixed light",
    "mood": "expensive, calm, restrained",
    "composition": "full-body vertical poster, negative space for title",
    "text_policy": "leave top and bottom clean for later typography",
    "source_refs": ["@library.md#night-scene"],
    "negative_prompt": "...",
    "notes": "hero variant for batch 2",
    "generation_prompt": "..."
  }
]
```

Required fields:
- `generation_prompt` or `prompt`

Recommended fields:
- `index`
- `slug`
- `title`
- `style_family`
- `style_variant`
- `purity_grade`
- `scene`
- `scene_anchor`
- `wardrobe`
- `exposure_signal`
- `gesture`
- `camera`
- `eye_language`
- `candidness`
- `lighting`
- `palette`
- `mood`
- `composition`
- `text_policy`
- `source_refs`
- `negative_prompt`
- `notes`

Optional per-item overrides:

```json
{
  "params": {
    "model": "gpt-image-2",
    "size": "1440x2560",
    "output_format": "png",
    "timeout_seconds": 450
  }
}
```

Keep slugs filesystem-safe. Keep prompts differentiated enough that large batches do not collapse into near-duplicates.

When the source markdown is not already aligned with the requested output mode:
- keep the useful scene, lighting, pose, mood, or styling anchors
- rewrite output-specific parts to match the user request
- do not carry over incompatible constraints blindly

For very large runs, prefer one of these patterns:
- if the user explicitly says to start immediately, generate the full prompt set and run
- otherwise, generate the full set, preview a representative subset plus batch plan, then run after confirmation
- if the user requests batching, split the prompt set into staged runs while preserving one root manifest
- when the user asks for hundreds of images, default to a batch plan instead of one monolithic run

## Task spec

Always materialize a `task_spec.json` first. Keep it in the same root output directory as the generated prompts.

At minimum include:
- `content_brief`
- `output_mode`
- `style_requirements`
- `source_files`
- `total_count`
- `run_preset` or explicit runtime fields (`batch_size`, `concurrency`, `retry_count`, `timeout_seconds`, `width`, `height`)
- `variation_requirements`
- `text_policy`
- `preview_count`
- `require_confirmation`

Use `scripts/validate_task_spec.js` to normalize and validate the spec before generating prompts.

## Prompt strategy

Always materialize a `prompt_strategy.json` after normalizing the task spec and before generating prompts.

The strategy is the human-reviewable plan for how the prompt bundle will be distributed. It should answer:
- what style families will be used
- what intensity/grade distribution will be used
- what scene pool will be used
- what wardrobe pool will be used
- what composition pool will be used
- what optional variant axes will control camera, lighting, mood, role, story beat, ad hypothesis, or detail-page role
- how the total count maps onto those dimensions

Use `scripts/validate_prompt_strategy.js` before generating the final prompt bundle.

## Prompt slots

After validating the strategy, create `prompt_slots.json` with `scripts/scaffold_prompt_bundle.js`.

This file is the deterministic assignment layer between strategy and final prompt text. It should:
- preserve counts and distributions from the strategy
- assign each row a style family
- assign each row a scene, wardrobe, and composition
- assign each row any strategy `variant_axes` and preserve them as `variant_signature`
- carry text policy and source refs forward
- leave `generation_prompt` empty or omitted until the LLM fills it

The agent should then transform each slot into a final prompt item, preserving the structural fields.

## Prompt draft bundle

After scaffolding slots, create `prompt_draft_bundle.json` with `scripts/materialize_prompt_drafts.js`.

This draft bundle should already contain:
- a usable `generation_prompt`
- a baseline `negative_prompt`
- all slot metadata copied through

The LLM should then revise the draft bundle into `prompts.generated.json` instead of starting prompt text from scratch.

## Execution rules

- Invoke `scripts/run_batch.js` instead of ad hoc one-off API callers.
- Prefer `scripts/daoge_prepare_run.js` as the default preflight entrypoint.
- Invoke `scripts/render_prompt_preview.js` before `scripts/run_batch.js` unless the user explicitly opts out of preview.
- Invoke `scripts/validate_task_spec.js` before prompt generation.
- Treat validation `errors` as blocking. Treat validation `warnings` and `qualityGates` as review items in the preflight dashboard.
- Pass explicit CLI args for width, height, timeout, retry count, concurrency, and prompt file.
- Pass `--batch-size` for large runs.
- Do not rely on hardcoded prompt sources.
- Use native size output. Do not upscale and present that as native output.
- For failed reruns, pass the previous root `manifest.json` via `--resume-manifest` and keep `--failed-only true` unless the user asks to rerun all selected items.
- For explicit local-edit reruns with `--select-indexes` or `--select-slot-ids`, the runner should behave like “selected slot rerun” rather than “failed-only rerun”. If needed, users can still force `--failed-only true`.
- For interrupted runs into the same directory, pass `--skip-existing true`.
- For 300-1000 image jobs, use a sample stage first and set auto-pause thresholds. A typical safe pattern is `--sample-size 20 --stop-after-sample true --stage-size 200 --batch-size 30 --max-consecutive-failures 10 --max-batch-failure-rate 0.3`.
- For identity-sensitive requests involving real people, avoid claiming exact face preservation unless the workflow and policy clearly allow it.

## Runner usage

Read [references/runner.md](references/runner.md) when you need the bundled runner flags or the prompt file schema.
Read [references/guided_intake.md](references/guided_intake.md) when you need the required conversation checklist before creating `task_spec.json`.
Read [references/dialogue_templates_zh.md](references/dialogue_templates_zh.md) when you need the fixed Chinese intake / preview / confirmation templates.
Read [references/example_session_zh.md](references/example_session_zh.md) when you need a concrete Chinese example of the full intake-to-preview flow.
Read [references/trigger_modes_zh.md](references/trigger_modes_zh.md) when you need the standard `prepare / execute` trigger contract.
Read [references/run_presets_zh.json](references/run_presets_zh.json) when you need the DAOGE runtime preset catalog.
Read [references/template_registry_zh.json](references/template_registry_zh.json) when you need the DAOGE template registry for mode/template matching.
Read [references/task_spec.md](references/task_spec.md) when you need the request schema or normalization rules.
Read [references/prompt_strategy.md](references/prompt_strategy.md) when you need the intermediate planning schema between task spec and prompt bundle.
Read [references/prompt_bundle_generation.md](references/prompt_bundle_generation.md) when you need the slot-to-prompt writing protocol.
Read [references/final_prompt_writing.md](references/final_prompt_writing.md) when you need the fixed writing template for turning slot metadata into polished final prompts.
Read [references/prompt_synthesis.md](references/prompt_synthesis.md) when you need to turn a markdown prompt library into a large prompt batch with controlled variation.
Read [references/prompt_bundle.md](references/prompt_bundle.md) when you need the post-generation validation contract for `prompts.generated.json`.

Typical invocation:

```bash
node scripts/daoge_prepare_run.js \
  --task-spec /abs/path/task_spec.json \
  --strategy-file /abs/path/prompt_strategy.json \
  --prompts-file /abs/path/prompts.generated.json \
  --batch-size 30 \
  --preview-count 12

node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --batch-size 30 \
  --width 1440 \
  --height 2560 \
  --timeout-seconds 450 \
  --retry-count 1 \
  --concurrency 6

node scripts/run_batch.js \
  --prompts-file /abs/path/original/prompts.generated.json \
  --resume-manifest /abs/path/original/manifest.json \
  --failed-only true \
  --batch-size 10 \
  --concurrency 6

node scripts/run_batch.js \
  --prompts-file /abs/path/original/prompts.generated.json \
  --output-dir /abs/path/original/output_dir \
  --skip-existing true \
  --batch-size 30 \
  --concurrency 6

node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --sample-size 20 \
  --stop-after-sample true \
  --stage-size 200 \
  --batch-size 30 \
  --concurrency 8 \
  --max-consecutive-failures 10 \
  --max-batch-failure-rate 0.3
```

Runner / prepare implementation is now modularized. When inspecting or patching local code, use these boundaries:

- `scripts/run_batch.js`: orchestration entrypoint
- `scripts/run_batch_cli.js`: runner CLI helpers
- `scripts/run_batch_selection.js`: rerun and selection logic
- `scripts/run_batch_transport.js`: provider transport and fallback
- `scripts/run_batch_executor.js`: per-item execution and batch execution
- `scripts/run_batch_runtime.js`: state, checkpoint, pause policy, progress logs
- `scripts/run_batch_artifacts.js`: completion artifacts and review files
- `scripts/run_batch_shared.js`: runner-shared pure helpers
- `scripts/script_utils.js`: cross-script CLI / JSON / chunk helpers

## Output expectations

- Save generated files under a timestamped directory inside `generated_images/` unless the user specifies another location.
- Save `task_spec.json` and `task_spec.normalized.json`.
- Save `prompt_strategy.json` and `prompt_strategy.normalized.json`.
- Save `prompt_strategy.enriched.json` when template defaults are injected.
- Save `prompt_slots.json`.
- Save `variant_matrix_plan.json` when slots are scaffolded.
- Save `prompt_draft_bundle.json`.
- Save the synthesized prompt set as `prompts.generated.json`.
- Save prompt preview as `prompt_preview.md`.
- Save batch plan as `batch_plan.json`.
- Save prompt validation report as `prompt_validation_report.json`.
- Save DAOGE summary as `daoge_run_summary.md`.
- Save DAOGE preflight dashboard as `daoge_preflight_dashboard.md`.
- Keep `manifest.json` as the machine-readable execution summary.
- Keep `rerun_plan.json` when executing from a previous manifest.
- Keep operational review files: `success.json`, `failed.json`, `skipped.json`, `needs_review.json`, `rerun_candidates.json`, `selection_board.md`, `operations_report.json`, `operations_report.md`, and `contact_sheet_index.md`.
- Keep production control files: `job_state.json`, `checkpoint.json`, `checkpoints/checkpoint_batch_###.json`, and `stage_plan.json`.
- Keep global run indexes in `generated_images/daoge_run_index.json` and `generated_images/daoge_run_index.md`.
- If the run finishes successfully and the user would benefit from a visual overview, keep `contact_sheet.png`.
- After execution, generate `daoge_completion_report.md` as the human-readable completion report.
- Report the final directory, count of successful images, failed images, and any prompt-source file used.
- For large runs, report both root output directory and batch subdirectories.

## Validation

- Run local verification before saying the batch is done.
- At minimum, inspect `manifest.json` and validate dimensions on representative outputs with `sips`.
- If the user did not explicitly say to start immediately, confirm that the run was approved after preview before calling the runner.
- After modifying local scripts, prefer the bundled smoke entrypoint:

```bash
skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

- This should pass before you claim the skill still works end-to-end.
