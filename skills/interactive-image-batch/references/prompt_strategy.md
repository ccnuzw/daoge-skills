# Prompt strategy reference

Use a prompt strategy as the bridge between `task_spec.normalized.json` and `prompts.generated.json`.

## Purpose

The prompt strategy is where the agent turns:

- the conversation request
- referenced markdown libraries
- the normalized task spec

into an intentional generation plan before writing hundreds of prompts.

This avoids prompt bundles that are structurally valid but distributionally poor.

## Minimal schema

```json
{
  "content_brief": "Luxury lingerie campaign with soft candid tension",
  "source_files": [
    "/abs/path/library.md"
  ],
  "output_mode": "photoreal campaign poster",
  "variation_requirements": [
    "avoid near-duplicate prompts within the same batch",
    "spread hero prompts across all batches"
  ],
  "total_count": 300,
  "batch_size": 30,
  "style_families": [
    { "name": "just-woke-up", "count": 120 },
    { "name": "casual-candid", "count": 105 },
    { "name": "looking-back", "count": 75 }
  ],
  "grade_distribution": [
    { "name": "S", "count": 60 },
    { "name": "A", "count": 180 },
    { "name": "B", "count": 60 }
  ],
  "template_variant": {
    "id": "co-brand-kv",
    "name": "联名主 KV"
  },
  "scene_pool": [
    "bedroom morning light",
    "designer kitchen",
    "window after rain",
    "hotel bathroom",
    "doorway",
    "stairs"
  ],
  "wardrobe_pool": [
    "ivory cotton set",
    "black minimal set",
    "oversized white shirt layer",
    "bathrobe layer"
  ],
  "composition_pool": [
    "full-body 9:16 poster",
    "mid-full body by window",
    "walking turn-back pose"
  ],
  "variant_axes": [
    {
      "name": "camera-language",
      "field": "camera_language",
      "strategy": "cycle",
      "options": [
        { "name": "hero-front", "prompt_hint": "front-facing full-body hero framing with clean vertical hierarchy" },
        { "name": "turn-back", "prompt_hint": "walking turn-back camera language with motion tension" },
        { "name": "low-angle", "prompt_hint": "subtle low-angle fashion poster perspective with long body line" }
      ]
    },
    {
      "name": "commercial-role",
      "field": "grid_role",
      "strategy": "cycle",
      "options": ["cover tile", "material detail tile", "lifestyle mood tile"]
    },
    {
      "name": "material-emphasis",
      "field": "exposure_signal",
      "strategy": "weighted",
      "options": [
        { "name": "matte-fabric", "weight": 2, "prompt_hint": "matte fabric texture and seam detail clearly visible" },
        { "name": "body-line", "weight": 1, "prompt_hint": "clean body line and waist contour without cheap exaggeration" }
      ]
    }
  ],
  "autofill_policy": {
    "enabled": true,
    "mark_sources": true,
    "rules": [
      {
        "field": "lighting",
        "values": ["soft premium studio light", "directional rim light"],
        "source": "strategy-autofill"
      }
    ]
  },
  "text_policy": "leave top and bottom clean for later typography",
  "negative_policy": "no watermark, no readable text, no extra fingers, no cheap e-commerce look",
  "variation_rules": [
    "avoid identical scene+wardrobe+gesture triples",
    "spread S-grade prompts across batches",
    "keep at least 4 scene types per batch"
  ],
  "notes": "Derived from a purity-style library but rewritten for photoreal poster output"
}
```

## Rules

- `total_count` must match the task spec unless the user explicitly requests a subset.
- `style_families[].count` must sum to `total_count`.
- `grade_distribution[].count` must sum to `total_count`.
- `scene_pool`, `wardrobe_pool`, and `composition_pool` should be non-empty for large runs.
- `batch_size` should usually match the task spec unless the user explicitly changes it.
- `variation_rules` should operationalize the task spec's `variation_requirements` instead of inventing a different diversity target.
- Use `variant_axes` when the batch needs controlled variation beyond scene, wardrobe, and composition.
- Use `template_variant` when one selected template has multiple sub-modes such as co-brand KV, A/B single-variable test, or detail-page hero-plus-details.
- Use `autofill_policy` to fill missing slot fields deterministically while marking whether a field came from user strategy or autofill.

## Variant axes

Each `variant_axes[]` item has:

- `name`: human-readable axis name
- `field`: slot field to write, such as `camera_language`, `grid_role`, `story_beat`, `ad_test_hypothesis`, `detail_page_role`, `lighting`, `mood`, `palette`, `gesture`, or `exposure_signal`
- `strategy`: `cycle` or `weighted`
- `batch_balance`: optional, use `within-batch` when each batch should receive a balanced spread
- `avoid_repeat_within_batch`: optional boolean for review and planning metadata
- `options`: strings or objects with `name`, optional `weight`, and optional `prompt_hint`

The scaffold step writes:

- the selected value into the target `field`
- `variant_axes`: machine-readable axis assignments
- `variant_signature`: compact human-readable matrix signature
- `variant_matrix_plan.json`: batch-level and global matrix coverage report

Use variant axes for camera/lens language, lighting setups, material emphasis, mood, social-grid roles, storyboard beats, A/B test variables, and detail-page roles.

## Recommended planning heuristics

For large runs:

- do not let one family exceed 80% unless explicitly requested
- do not let one scene dominate the whole set
- spread high-intensity prompts across batches instead of front-loading them
- include softer prompts so the set has usable range, not only hero shots

## Relationship to the prompt bundle

The strategy does not replace the final prompt bundle.

Use it to ensure that each generated prompt item can be traced back to:

- one style family
- one intensity grade when relevant
- one scene pool choice
- one wardrobe pool choice
- one composition pool choice
- any `variant_axes` assignments such as camera language, grid role, story beat, or ad-test hypothesis

The prompt bundle should then record those choices in per-item fields.
