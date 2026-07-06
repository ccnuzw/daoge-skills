# Task spec reference

Use a task spec as the normalized conversation contract before prompt generation.

## Minimal schema

```json
{
  "content_brief": "What to generate",
  "output_mode": "photoreal campaign poster",
  "style_requirements": [
    "full-body",
    "9:16 poster",
    "leave typography space"
  ],
  "source_files": [
    "/abs/path/library.md"
  ],
  "source_images": [
    "/abs/path/ref-01.png"
  ],
  "run_preset": "large_batch_stable",
  "total_count": 300,
  "batch_size": 30,
  "concurrency": 10,
  "retry_count": 1,
  "timeout_seconds": 450,
  "width": 1440,
  "height": 2560,
  "variation_requirements": [
    "avoid near-duplicate prompts within the same batch",
    "spread hero prompts across all batches"
  ],
  "text_policy": "leave top and bottom clean for later typography",
  "output_format": "png",
  "preview_count": 12,
  "contact_sheet": true,
  "require_confirmation": true,
  "storyboard_plan": {
    "enabled": true,
    "layout_manifest": "/abs/path/layout_manifest.json",
    "content_manifest": "/abs/path/content_manifest.json",
    "render_config": "/abs/path/render_config.json",
    "reference_bindings": "/abs/path/reference_bindings.json",
    "generation_mode": "per-slot",
    "assembly_mode": "external-compositor",
    "reference_mode": "hybrid"
  }
}
```

## Rules

- Dialogue overrides everything except missing API credentials.
- `run_preset` is a DAOGE runtime preset layer. It fills missing run controls only; it never fills content intent, style intent, variation rules, or typography policy.
- If `run_preset` is omitted, DAOGE uses `safe_2k_poster` as the default runtime preset.
- Supported presets live in `references/run_presets_zh.json`: `safe_2k_poster`, `large_batch_stable`, `fast_preview`, and `provider_stress_safe`.
- Explicit dialogue values always override preset values. For example, `run_preset=large_batch_stable` plus `concurrency=4` must keep `concurrency=4`.
- The validator writes `field_sources` so the preflight dashboard can show whether each runtime value came from `dialogue`, `preset:<id>`, or `default`.
- `source_files` may be empty only when `style_requirements` already contains explicit inline style guidance.
- `source_images` is optional. Use it for task-level reference images. If you need per-shot references for a storyboard board, put them in `content_manifest.json` instead of only here.
- Storyboards can freely mix `reference-assisted` and `prompt-only` slots; not every slot needs a reference image.
- If you want to upload images first and decide which shot they go to later, use `reference_bindings.json` as the mapping layer.
- `content_brief`, `output_mode`, `total_count`, `variation_requirements`, and `text_policy` should be explicit before the run starts.
- `batch_size`, `width`, `height`, `concurrency`, `retry_count`, and `timeout_seconds` may be explicit or supplied by the selected runtime preset.
- Default `require_confirmation=true`, but the user can explicitly opt out by saying to start immediately.
- Only set `require_confirmation=false` when the user explicitly says to start immediately.
- For large runs, prefer `run_preset=large_batch_stable` unless the user gives a specific custom batch plan.
- Clamp `concurrency` to `1..12`.
- Keep `preview_count` small enough for human review. Default `12` if the user does not care.
- Prefer widths and heights that are multiples of `16` for native generation stability.
- For variable storyboard board layouts, keep `storyboard_plan` in `task_spec` and let the layout/content manifests carry slot-level structure.

## Recommended additions

Add these when useful:

```json
{
  "aspect_ratio_label": "9:16",
  "identity_policy": "generic-adult-model",
  "negative_requirements": [
    "no watermark",
    "no cheap e-commerce look"
  ],
  "sample_size": 20,
  "stage_size": 200,
  "stop_after_sample": false,
  "auto_pause": true,
  "max_consecutive_failures": 10,
  "max_batch_failure_rate": 0.3,
  "skip_existing": true,
  "run_label": "ck-poster-wave-01",
  "notes": "Derived from conversation on 2026-05-06",
  "storyboard_plan": {
    "enabled": true,
    "layout_manifest": "/abs/path/layout_manifest.json",
    "content_manifest": "/abs/path/content_manifest.json",
    "render_config": "/abs/path/render_config.json",
    "reference_bindings": "/abs/path/reference_bindings.json",
    "generation_mode": "per-slot",
    "assembly_mode": "external-compositor",
    "reference_mode": "hybrid",
    "variable_layout": true,
    "preserve_reference_metadata": true
  }
}
```

## Storyboard board mode

When the task is a storyboard board instead of a single image set:

- keep the board-level intent in `task_spec.json`
- keep slot-level content in `content_manifest.json`
- keep layout regions and bindings in `layout_manifest.json`
- keep render policy in `render_config.json`

Recommended path:

1. put `storyboard_plan` into `task_spec.json`
2. run `scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --output-dir /abs/path/out`
3. inspect `workspace/prepare.html` and `debug/prompt_validation_report.json`

See `references/storyboard_board_mode.md` and `references/examples/storyboard/`.

## Preset examples

Use the default DAOGE 2K poster preset while keeping content fields explicit:

```json
{
  "content_brief": "premium fashion poster campaign",
  "output_mode": "photoreal campaign poster",
  "style_requirements": ["full-body", "premium scene variation"],
  "source_files": [],
  "total_count": 300,
  "variation_requirements": ["avoid near-duplicates", "rotate scenes and wardrobe"],
  "text_policy": "leave clean top and bottom space for later typography"
}
```

Use a large-batch preset but override one field:

```json
{
  "run_preset": "large_batch_stable",
  "content_brief": "premium fashion poster campaign",
  "output_mode": "photoreal campaign poster",
  "style_requirements": ["full-body", "premium scene variation"],
  "source_files": [],
  "total_count": 500,
  "concurrency": 4,
  "variation_requirements": ["avoid near-duplicates", "rotate scenes and wardrobe"],
  "text_policy": "leave clean top and bottom space for later typography"
}
```

## Output files

Keep both:

- `task_spec.json` original conversational interpretation
- `task_spec.normalized.json` normalized result from the validator
