# Runner reference

## Prompt file schema

The runner expects a JSON array. Each item must include:

- `generation_prompt` or `prompt` required

Recommended fields:

- `index`
- `slug`
- `title`
- `style_family`
- `scene`
- `wardrobe`
- `lighting`
- `mood`
- `composition`
- `text_policy`
- `source_refs`
- `negative_prompt`
- `notes`

Optional per-item request overrides:

- `params.model`
- `params.size`
- `params.width`
- `params.height`
- `params.output_format`
- `params.timeout_seconds`

Example:

```json
[
  {
    "index": 1,
    "slug": "morning-bedroom",
    "title": "Morning bedroom",
    "style_family": "morning-soft",
    "scene": "sunlit bedroom with linen curtains",
    "wardrobe": "ivory cotton lingerie set",
    "lighting": "warm natural morning window light",
    "mood": "serene, intimate, premium",
    "composition": "full-body 9:16 poster with top negative space",
    "text_policy": "leave clean top and bottom for later typography",
    "source_refs": ["@library.md#JW-02"],
    "negative_prompt": "readable text, watermark, logo",
    "generation_prompt": "Adult East Asian fashion model, full-body..."
  }
]
```

## Preview flow

Recommended preflight sequence:

```bash
node scripts/scaffold_prompt_bundle.js \
  --strategy-file /abs/path/prompt_strategy.normalized.json \
  --output-file /abs/path/prompt_slots.json

node scripts/materialize_prompt_drafts.js \
  --slots-file /abs/path/prompt_slots.json \
  --output-file /abs/path/prompt_draft_bundle.json
```

Then revise `prompt_draft_bundle.json` into `prompts.generated.json`, validate it, and render the preview.

Use `scripts/render_prompt_preview.js` to create:

- `prompt_preview.md`
- `batch_plan.json`

Use `scripts/validate_prompt_bundle.js` to create:

- `prompt_validation_report.json`

Typical usage:

```bash
node scripts/validate_prompt_bundle.js \
  --prompts-file /abs/path/prompts.generated.json \
  --task-spec /abs/path/task_spec.normalized.json

node scripts/render_prompt_preview.js \
  --prompts-file /abs/path/prompts.generated.json \
  --batch-size 30 \
  --preview-count 12
```

The preview file should be treated as the human review surface. It should summarize:

- style-family distribution
- grade/intensity distribution when present
- scene distribution
- wardrobe distribution
- batch plan
- representative prompt samples

## Runner flags

`--prompts-file <abs-or-rel-path>` required

When running from a normalized DAOGE task spec, map fields directly:

- `width` -> `--width`
- `height` -> `--height`
- `output_format` -> `--output-format`
- `timeout_seconds` -> `--timeout-seconds`
- `retry_count` -> `--retry-count`
- `concurrency` -> `--concurrency`
- `batch_size` -> `--batch-size`
- `contact_sheet` -> `--contact-sheet`
- `sample_size` -> `--sample-size`
- `stage_size` -> `--stage-size`
- `stop_after_sample` -> `--stop-after-sample`
- `auto_pause` -> `--auto-pause`
- `max_consecutive_failures` -> `--max-consecutive-failures`
- `max_batch_failure_rate` -> `--max-batch-failure-rate`
- `skip_existing` -> `--skip-existing`

Optional flags:

- `--output-dir <path>`
- `--env-file <path>` default `./.env`
- `--width <number>` default `1440`
- `--height <number>` default `2560`
- `--output-format <png|webp|jpeg>` default `png`
- `--timeout-seconds <number>` default `450`
- `--retry-count <number>` default `1`
- `--concurrency <number>` default `3`, clamped to `1..12`
- `--batch-size <number>` default all selected prompts in one batch
- `--offset <number>` default `0`
- `--limit <number>` default all remaining prompts
- `--contact-sheet <true|false>` default `true`
- `--run-label <value>` optional output label
- `--resume-manifest <path>` rerun prompts referenced by a previous root `manifest.json`
- `--failed-only <true|false>` default `true` when `--resume-manifest` is present
- `--dry-run <true|false>` write plans/manifests without calling the image API
- `--skip-existing <true|false>` skip a prompt when the expected image and metadata already exist in the target batch folder
- `--stage-size <number>` split large runs into stages by prompt count; default disabled
- `--sample-size <number>` run the first N prompts as a sample stage before production stages
- `--stop-after-sample <true|false>` pause after the sample stage for review
- `--auto-pause <true|false>` enable pause policy checks; default `true`
- `--max-consecutive-failures <number>` pause when consecutive failures reach this threshold; default `0` disabled
- `--max-batch-failure-rate <number>` pause when one batch exceeds this failure rate, e.g. `0.3`; default `1.1` disabled

## Environment

Required from `.env`:

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`

Optional:

- `OPENAI_MODEL` default `gpt-image-2`

## Notes

- The runner uses native size generation and writes exactly one final image per prompt.
- The runner writes a root `manifest.json` plus one `batch_###/manifest.json` per batch.
- The runner writes operational artifacts after each run:
  - `success.json`
  - `failed.json`
  - `skipped.json`
  - `needs_review.json`
  - `rerun_candidates.json`
  - `selection_board.md`
  - `operations_report.json`
  - `operations_report.md`
  - `contact_sheet_index.md`
  - `job_state.json`
  - `checkpoint.json`
  - `checkpoints/checkpoint_batch_###.json`
  - `stage_plan.json`
  - `generated_images/daoge_run_index.json`
  - `generated_images/daoge_run_index.md`
- Failure reruns create a new output directory, copy only the selected prompts, and write `rerun_plan.json`.
- Interrupted runs can be resumed into the same output directory with `--skip-existing true` to avoid regenerating images that already have both output image and metadata.
- To rerun only failed images from a previous run:

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/original/prompts.generated.json \
  --resume-manifest /abs/path/original/manifest.json \
  --failed-only true \
  --batch-size 10 \
  --concurrency 6
```

To continue a partially completed same-directory run:

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/original/prompts.generated.json \
  --output-dir /abs/path/original/output_dir \
  --skip-existing true \
  --batch-size 30 \
  --concurrency 6
```

For 300-1000 image production runs, prefer staged execution:

```bash
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

After reviewing the sample, continue in the same directory:

```bash
node scripts/run_batch.js \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output_dir \
  --skip-existing true \
  --stage-size 200 \
  --batch-size 30 \
  --concurrency 8
```

- It does not synthesize prompts for you. The agent must create the prompt JSON before running it.
- Prompt bundle slugs should be unique and stable. Use a numeric prefix or equivalent strategy instead of relying on truncated natural-language slugs alone.
