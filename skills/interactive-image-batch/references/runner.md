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
- `board_id`
- `slot_id`
- `slot_role`
- `shot_id`
- `shot_label`
- `layout_region_id`
- `timecode`
- `reference_images`
- `mask_image`
- `reference_notes`
- `prompt_hints`
- `continuity_notes`
- `voiceover`
- `music`
- `sound_effects`
- `camera_move`

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

Recommended preflight sequence starts with the single DAOGE entrypoint:

```bash
node scripts/daoge.js prepare \
  --task-spec /abs/path/task_spec.json \
  --batch-size 30 \
  --output-dir /abs/path/out
```

If you already have a curated prompt list, pass it directly:

```bash
node scripts/daoge.js prepare \
  --task-spec /abs/path/task_spec.json \
  --prompts-file /abs/path/prompts.generated.json \
  --batch-size 30 \
  --output-dir /abs/path/out
```

`prepare` validates inputs and creates:

- `debug/prompts.generated.json`
- `debug/prompt_validation_report.json`
- `internal/batch_plan.json`
- `workspace/index.html`
- `workspace/prepare.html`

The workspace pages should be treated as the human review surface. They should summarize:

- style-family distribution
- grade/intensity distribution when present
- scene distribution
- wardrobe distribution
- batch plan
- representative prompt samples
- when in storyboard mode, show slot roles, shot ids, timecodes, and reference-image counts

When both versions exist:

- prefer `workspace/index.html` for the primary user-facing flow
- use `workspace/prepare.html` for preparation detail
- keep generated prompt and diagnostic files under `debug/`

## Runner flags

`--prompts-file <abs-or-rel-path>` optional. If omitted, `prepare` generates `debug/prompts.generated.json`, and `execute` reads that file from `--output-dir`.

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
- `--resume-manifest <path>` rerun prompts referenced by a previous `internal/local_execution_raw.json`
- `--failed-only <true|false>` default `true` when `--resume-manifest` is present
- `--select-indexes <csv>` rerun only specific prompt indexes, e.g. `3,5,9`
- `--select-slot-ids <csv>` rerun only specific storyboard slots, e.g. `shot_3,kv`
- `--reuse-output-as-reference <true|false>` when used with `--resume-manifest`, inject the previous successful output as the first reference image for the selected slot
- `--dry-run <true|false>` write plans/manifests without calling the image API
- `--skip-existing <true|false>` skip a prompt when the expected image and metadata already exist in the target batch folder
- `--stage-size <number>` split large runs into stages by prompt count; default disabled
- `--sample-size <number>` run the first N prompts as a sample stage before production stages
- `--stop-after-sample <true|false>` pause after the sample stage for review
- `--auto-pause <true|false>` enable pause policy checks; default `true`
- `--max-consecutive-failures <number>` pause when consecutive failures reach this threshold; default `0` disabled
- `--max-batch-failure-rate <number>` pause when one batch exceeds this failure rate, e.g. `0.3`; default `1.1` disabled

For storyboard board workflows:

- keep storyboard planning fields in `task_spec.json`
- run `scripts/daoge.js prepare --task-spec /abs/path/task_spec.json --output-dir /abs/path/out`
- inspect `workspace/prepare.html` and `debug/prompt_validation_report.json` before real execution
- slots may mix `reference-assisted` and `prompt-only` modes
- missing `reference_images` / `mask_image` for `reference-assisted` or `masked-edit` slots should block preflight, because execution would fail later
- slots with `reference_images` now route to `images/edits`
- slots with both `reference_images` and `mask_image` now route to `images/edits + mask`
- `prompt-only` slots continue to use `images/generations`
- provider-side behavior still depends on model capabilities; masks are guidance, not pixel-perfect guarantees
- for “只改单格” workflows, prefer `--resume-manifest + --select-slot-ids + --reuse-output-as-reference true`
- when `--reuse-output-as-reference true` is used for storyboard/local-edit reruns, match previous outputs by `slot_id` whenever available to avoid reusing the wrong base image
- when `--resume-manifest` is combined with `--select-indexes` or `--select-slot-ids`, DAOGE now defaults `--failed-only` to `false`, because this is usually an explicit local-edit rerun instead of a failed-only rerun
- if you really want “只改失败项里的某几个分镜”, then add `--failed-only true` explicitly

Recommended local-edit patterns:

- only regenerate one storyboard shot and use the previous output as the edit base
- regenerate one storyboard shot and add a new mask for regional changes
- regenerate one slot by index when no slot id is available

Chinese intent mapping:

- `只改分镜3` -> `--resume-manifest ... --select-slot-ids shot_3`
- `只改第3格` -> `--resume-manifest ... --select-indexes 3`
- `复用上一轮结果做底图` -> `--reuse-output-as-reference true`
- `我补一张遮罩图，只改右下角礼盒` -> slot prompt item should carry `mask_image`, then run with `--reuse-output-as-reference true`

Example: rerun only `shot_3` and use the previous output as the edit base:

```bash
node scripts/daoge.js execute \
  --prompts-file /abs/path/prompts.generated.json \
  --resume-manifest /abs/path/internal/local_execution_raw.json \
  --select-slot-ids shot_3 \
  --reuse-output-as-reference true \
  --batch-size 1 \
  --concurrency 1
```

Example: rerun only `shot_3`, reuse the previous output, and force masked local edit:

```bash
node scripts/daoge.js execute \
  --prompts-file /abs/path/prompts.generated.json \
  --resume-manifest /abs/path/internal/local_execution_raw.json \
  --select-slot-ids shot_3 \
  --reuse-output-as-reference true \
  --batch-size 1 \
  --concurrency 1
```

Notes for masked local edit:

- the prompt item for `shot_3` should already include `mask_image`
- DAOGE will then auto-route that slot to `images/edits + mask`
- in preview and result metadata, this should show up as:
  - `参考模式: masked-edit`
  - `编辑底图来源: previous-output`

## Environment

Required from `.env`:

- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`

Optional:

- `OPENAI_MODEL` default `gpt-image-2`

## Notes

- The runner uses native size generation and writes exactly one final image per prompt.
- The runner writes raw execution detail under `internal/local_execution_raw.json` and debug batch folders.
- The workspace refresh writes stable internal contracts:
  - `internal/execution_manifest.json`
  - `internal/issue_queue.json`
  - `internal/asset_library.json`
  - `internal/workspace_state.json`
- User review starts from `workspace/index.html` and routes to `workspace/results.html` or `workspace/issues.html`.
- Additional recovery/debug artifacts may include:
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
node scripts/daoge.js execute \
  --prompts-file /abs/path/original/prompts.generated.json \
  --resume-manifest /abs/path/original/internal/local_execution_raw.json \
  --failed-only true \
  --batch-size 10 \
  --concurrency 6
```

To continue a partially completed same-directory run:

```bash
node scripts/daoge.js execute \
  --prompts-file /abs/path/original/prompts.generated.json \
  --output-dir /abs/path/original/output_dir \
  --skip-existing true \
  --batch-size 30 \
  --concurrency 6
```

For 300-1000 image production runs, prefer staged execution:

```bash
node scripts/daoge.js execute \
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
node scripts/daoge.js execute \
  --prompts-file /abs/path/prompts.generated.json \
  --output-dir /abs/path/output_dir \
  --skip-existing true \
  --stage-size 200 \
  --batch-size 30 \
  --concurrency 8
```

- It does not synthesize prompts for you. The agent must create the prompt JSON before running it.
- Prompt bundle slugs should be unique and stable. Use a numeric prefix or equivalent strategy instead of relying on truncated natural-language slugs alone.

## Smoke tests

For local regression after changing runner / prepare / preview scripts, use the bundled smoke entrypoint:

```bash
skills/interactive-image-batch/scripts/run_smoke_tests.sh
```

This runs:

- `node --check` for every `scripts/*.js`
- `node --test skills/interactive-image-batch/tests/smoke.test.js`

Current smoke coverage includes:

- `daoge.js execute --dry-run`
- `daoge.js prepare` minimal preflight pipeline
- mock-provider `prompt-only` execution
- mock-provider `reference-assisted` execution
- `src/renderers/workspace_page.js` HTML 审阅看板
  - includes lightweight risk tags and heuristic review scores for keep / review / rerun decisions

Recommended rule:

- if you modify `scripts/daoge.js`, `src/domain/batch_executor.js`, `src/renderers/`, `src/contracts/`, or prepare/execute services, run smoke tests before claiming the skill still works
