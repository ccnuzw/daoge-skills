# Prompt bundle contract

Use this contract after generating `prompts.generated.json` and before preview or execution.

## Goal

A prompt bundle should be:

- structurally valid
- aligned with `task_spec.normalized.json`
- sufficiently varied for the requested batch size
- reviewable by a human before execution

## Minimum acceptance checks

Validate these before running images:

1. The file is a JSON array.
2. The prompt count matches the intended `total_count` unless the user explicitly asked for a subset.
3. Every item has:
   - `index`
   - `slug`
   - `title`
   - `generation_prompt` or `prompt`
4. Slugs are unique.
5. Prompt texts are not empty.
6. For large runs, the bundle includes style metadata sufficient for review:
   - `style_family`
   - `scene` or `scene_anchor`
   - `composition`
   - `text_policy`

## Recommended coverage checks

For batches larger than 30, also check:

- style-family distribution is not collapsed into one family unless the user explicitly asked for one family
- repeated prompts are not near-identical in wording
- wardrobe, scene, and composition vary enough to support the requested total
- grade or intensity distribution is intentional when a source library exposes it
- prompt text is long enough to carry scene, product, lighting, composition, and text-safety signals
- template-required slot fields are present when DAOGE selected a template
- native output sizes are explicit and width/height are multiples of 16
- provider/model-specific size budgets are satisfied before execution
- campaign-poster prompts include campaign/KV intent, scene signal, full-body or hero framing, and typography-safe-space language

## Human review outputs

After validation, always produce:

- `prompt_validation_report.json`
- `prompt_preview.md`
- `batch_plan.json`

## When to fail hard

Hard-fail validation when:

- the prompt bundle is not valid JSON
- required fields are missing from many items
- prompt count is zero
- more than 10% of items have empty prompt text
- slug collisions exist and would overwrite outputs
- any requested per-item size is not a multiple of 16
- any requested size violates provider/model pixel-budget or aspect-ratio limits
- strict quality mode is enabled and template-required fields are missing

## When to warn only

Warn, but do not hard-fail, when:

- optional review fields are missing
- one style family dominates the batch
- many prompts are short or semantically close
- `negative_prompt` is absent
- campaign-poster prompts may be missing KV intent, full-body signal, scene signal, or text-safe-space signal
