# Prompt bundle generation

Use this reference after you have:

- `task_spec.normalized.json`
- `prompt_strategy.normalized.json`
- `prompt_slots.json`

## Goal

Convert prompt slots into final prompt items without losing the structural plan.

The slot file should control:

- how many prompts exist
- which style family each prompt belongs to
- which scene/wardrobe/composition bucket each prompt uses
- how batches stay balanced

The LLM should only supply the final language of each `generation_prompt`, plus any optional refinements such as richer negative prompts.

## Required discipline

Do not regenerate the distribution from scratch at this stage.

At this stage:

- preserve `index`
- preserve `slug` unless there is a clear collision or naming defect
- preserve `style_family`
- preserve `style_variant` if present
- preserve `purity_grade` if present
- preserve `scene`
- preserve `wardrobe`
- preserve `composition`
- preserve `text_policy`
- preserve `source_refs`
- preserve `variant_axes` and `variant_signature` if present
- preserve any matrix fields written by `variant_axes`, such as `camera_language`, `grid_role`, `story_beat`, `ad_test_hypothesis`, `detail_page_role`, `lighting`, `mood`, `palette`, `gesture`, or `exposure_signal`

Only write or refine:

- `generation_prompt`
- `negative_prompt`
- `notes`

If the slot plan is sparse, the draft-writing layer should still inject deterministic micro-variation so that large runs do not collapse into dozens of exact prompt duplicates.

If `variant_axes` are present, use them as intentional differences, not decorative metadata. Each final prompt should visibly include the assigned matrix values.

## Writing pattern

For each slot:

1. Read the assigned structural fields.
2. Translate them into one coherent prompt.
3. Keep the wording specific enough to differentiate nearby variants.
4. Reflect the current output mode from the task spec.
5. Keep brand/layout instructions consistent with the task spec.

## Example slot

```json
{
  "index": 17,
  "slug": "jw-bedroom-ivory-batch-01",
  "title": "Morning ivory bedroom variant 17",
  "style_family": "just-woke-up",
  "style_variant": "stretching-arms",
  "purity_grade": "S",
  "scene": "luxury bedroom with morning window light",
  "scene_anchor": "white sheets, sheer curtains, soft bed textures",
  "wardrobe": "ivory cotton lingerie set",
  "exposure_signal": "subtle waistline reveal from stretch",
  "gesture": "arms raised overhead in a natural stretch",
  "camera": "full-body 9:16 poster framing",
  "eye_language": "sleepy, innocent, soft direct gaze",
  "candidness": "fleeting unposed campaign moment",
  "lighting": "warm natural backlit window light with soft rim",
  "palette": "cream white, warm skin, soft blush highlights",
  "mood": "intimate, expensive, soft",
  "composition": "negative space for top and bottom typography",
  "text_policy": "leave typography space, do not render readable text",
  "source_refs": ["@library.md#JW-07"]
}
```

## Example finished item

```json
{
  "index": 17,
  "slug": "jw-bedroom-ivory-batch-01",
  "title": "Morning ivory bedroom variant 17",
  "style_family": "just-woke-up",
  "style_variant": "stretching-arms",
  "purity_grade": "S",
  "scene": "luxury bedroom with morning window light",
  "scene_anchor": "white sheets, sheer curtains, soft bed textures",
  "wardrobe": "ivory cotton lingerie set",
  "exposure_signal": "subtle waistline reveal from stretch",
  "gesture": "arms raised overhead in a natural stretch",
  "camera": "full-body 9:16 poster framing",
  "eye_language": "sleepy, innocent, soft direct gaze",
  "candidness": "fleeting unposed campaign moment",
  "lighting": "warm natural backlit window light with soft rim",
  "palette": "cream white, warm skin, soft blush highlights",
  "mood": "intimate, expensive, soft",
  "composition": "negative space for top and bottom typography",
  "text_policy": "leave typography space, do not render readable text",
  "source_refs": ["@library.md#JW-07"],
  "negative_prompt": "watermark, readable text, extra fingers, malformed hands, cheap e-commerce look",
  "generation_prompt": "Adult East Asian female fashion model, full-body, head-to-toe visible, luxury bedroom campaign poster, ivory cotton lingerie set, arms raised overhead in a natural stretch, warm natural backlit morning window light, soft rim light along waist and legs, white sheets and sheer curtains, intimate expensive mood, negative space for top and bottom typography, no readable text, photoreal commercial fashion image."
}
```

## Large-batch quality checks

Before finalizing `prompts.generated.json`, inspect whether:

- neighboring prompts within the same family are still semantically distinct
- the same scene+wardrobe+gesture triple repeats too often
- hero prompts are spread across batches
- softer prompts exist so the run has range
- slugs remain unique even when long wardrobe or scene names are truncated for filesystem safety
