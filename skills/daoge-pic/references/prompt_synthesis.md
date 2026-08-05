# Prompt synthesis

Use this reference when the user gives you a markdown prompt library instead of a ready JSON prompt set.

## Core idea

Do not treat a prompt library as a bag of finished prompts to copy-paste.

Treat it as a source of reusable dimensions:

- style families
- scene anchors
- pose/gesture anchors
- exposure or reveal mechanics
- eye/expression language
- candidness language
- lighting profile
- palette profile
- wardrobe classes
- composition defaults
- shared negative language
- quality/priority tiers

Your job is to transform those dimensions into a larger, non-repetitive prompt matrix that matches the current conversation request.

## What the provided library reveals

From `星语次元-擦边视觉Prompt库.md`, the useful structure is not only the prompts themselves.

It also provides:

- three top-level style families:
  - `Style-JW` just woke up
  - `Style-CC` casual candid
  - `Style-LB` looking back
- a four-anchor aesthetic system:
  - innocent gaze
  - everyday caught-off-guard setting
  - small reveal mechanic
  - warm soft natural light
- an explicit grading system:
  - `S` strong tension
  - `A` medium tension
  - `B` light tension
- reusable keyword clusters:
  - safe vocabulary
  - taboo vocabulary
  - lighting vocabulary
  - body-area emphasis vocabulary
- composition hints:
  - full-body/half-body/close-up
  - ratio recommendations

These are highly reusable even when the target output mode changes from anime wallpaper to photoreal campaign poster.

## Library-to-batch transformation

### Step 1: identify reusable dimensions

For each entry, extract as many of these as possible:

- `style_family`
- `style_variant`
- `purity_grade`
- `scene_anchor`
- `gesture`
- `exposure_signal`
- `eye_language`
- `candidness`
- `lighting`
- `palette`
- `wardrobe`
- `composition`
- `source_refs`

Example from the provided library:

- `JW-07 伸懒腰瞬间`
  - `style_family`: `just-woke-up`
  - `style_variant`: `stretching-arms`
  - `purity_grade`: `S`
  - `scene_anchor`: `bedroom morning bed`
  - `gesture`: `arms above head stretch`
  - `exposure_signal`: `top riding up reveals waistline`
  - `eye_language`: `eyes closed natural stretch`
  - `lighting`: `warm backlit morning window light`
  - `composition`: `full-body or upper-full-body vertical`

### Step 2: rewrite to current output mode

When the user wants a different mode, preserve the dimensions but rewrite the rendering language.

Examples:

- anime -> photoreal:
  - remove `anime illustration style`
  - replace with campaign/editorial/commercial realism
- voyeur wallpaper -> fashion poster:
  - replace `caught off guard偷拍感` with `editorial natural pose`, `unposed luxury lifestyle campaign`, or `fleeting candid campaign moment`
- home softness -> brand polish:
  - keep bedroom/kitchen/window scenes
  - add product styling, poster framing, typography space, premium fabric detail

### Step 3: scale without repetition

For 100+ outputs, variation must come from controlled axes, not random wording.

Use a variation matrix:

- family distribution
  - e.g. 40% `JW`, 35% `CC`, 25% `LB`
- tension distribution
  - e.g. 20% `S`, 50% `A`, 30% `B`
- environment distribution
  - bedroom, window, kitchen, sofa, bathroom, doorway, stair, rooftop, apartment, hotel
- wardrobe distribution
  - black minimal set, ivory cotton set, robe layer, oversized shirt, body suit, sporty set
- framing distribution
  - full-body hero, full-body walking pose, mid-full pose, seated editorial

This keeps the batch intentionally varied instead of semantically duplicated.

## Recommended prompt item fields

For large-scale generation, prefer this richer schema:

```json
{
  "index": 1,
  "slug": "jw-stretch-bedroom-hero",
  "title": "Morning stretch bedroom hero",
  "style_family": "just-woke-up",
  "style_variant": "stretching-arms",
  "purity_grade": "S",
  "scene": "luxury bedroom campaign set",
  "scene_anchor": "morning bed, sheer curtains, white sheets",
  "wardrobe": "ivory cotton lingerie set",
  "exposure_signal": "subtle waistline reveal from stretch",
  "gesture": "arms raised overhead in a natural stretch",
  "camera": "full-body 9:16 poster framing",
  "eye_language": "sleepy, innocent, not aggressively direct",
  "candidness": "fleeting unposed campaign moment",
  "lighting": "warm natural backlit window light with soft rim",
  "palette": "cream white, warm skin, soft blush highlights",
  "mood": "intimate, expensive, soft",
  "composition": "negative space for top and bottom typography",
  "text_policy": "leave typography space, do not render readable text",
  "source_refs": ["@星语次元-擦边视觉Prompt库.md#JW-07"],
  "negative_prompt": "...",
  "notes": "S-grade tension translated into luxury poster language",
  "generation_prompt": "..."
}
```

## How to use grades

The grade system in the source library is valuable for batch planning.

Use it to control batch intensity:

- `S`: highest visual hook, best for hero posters and covers
- `A`: most of the batch, stable and marketable
- `B`: softer fillers, useful to prevent every output from feeling over-engineered

For example, for 300 images:

- `S`: 60
- `A`: 180
- `B`: 60

Adjust the ratio if the user wants stronger or softer outputs.

## How to use shared negatives

Do not blindly reuse the original negative prompt when the output mode changes.

Split negatives into:

- mode-agnostic negatives
  - watermark, readable text, extra limbs, malformed hands, clutter
- source-style negatives
  - useful only for the original anime/wallpaper mode
- target-mode negatives
  - specific to the current run, e.g. no fake logo, no cheap e-commerce look, no exaggerated glamour

## How to answer “what are the 300 prompts?”

Do not dump 300 prompts into chat.

Instead:

1. generate `prompts.generated.json`
2. generate `prompt_preview.md`
3. generate `batch_plan.json`
4. summarize the distribution in prose:
   - style family split
   - grade split
   - scene split
   - wardrobe split

This gives the user a reviewable plan without flooding the conversation.
