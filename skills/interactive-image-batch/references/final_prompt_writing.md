# Final prompt writing

Use this reference when turning `prompt_draft_bundle.json` into `prompts.generated.json`.

## Goal

Do not improvise from scratch.

Start from the draft prompt and revise it into:

- one coherent commercial-quality `generation_prompt`
- one clean, target-mode-appropriate `negative_prompt`

while preserving the structural metadata from the slot.

## Writing order

Write prompt text in this conceptual order:

1. subject baseline
2. output mode / image type
3. scene and scene anchor
4. wardrobe
5. gesture / exposure signal
6. eye language / candidness
7. lighting / palette
8. mood
9. composition
10. text policy / branding policy

## Example structure

```text
Adult East Asian female fashion model, full-body, photoreal luxury campaign poster.
Scene: designer bedroom with sheer curtains and white sheets in warm morning light.
Wardrobe: ivory cotton lingerie set.
Pose and expression: natural overhead stretch, sleepy innocent gaze, fleeting candid campaign moment.
Lighting and palette: warm natural backlit window light, soft rim highlights, cream white and warm skin palette.
Composition: vertical 9:16 full-body framing with negative space for top and bottom typography.
Branding rule: no readable text, leave clean space for later co-branded layout.
```

The final `generation_prompt` can be one paragraph rather than line-broken text, but it should retain that logical order.

## Revision rules

- Keep the slot’s assigned scene/wardrobe/composition visible in the prompt text.
- Avoid generic filler that makes many prompts collapse into the same wording.
- When structural fields are sparse, add deterministic editorial nuance instead of reusing the same fallback sentence across a whole family.
- Do not overwrite structural choices from the slot unless the slot is defective.
- Keep language aligned with the task spec output mode.
- Remove source-mode artifacts that do not belong in the target mode.

## Negative prompt rules

Split negative concerns into three groups:

- generic image defects
- target-mode commercial defects
- explicit user exclusions

Example:

```text
watermark, readable text, fake logo, extra fingers, malformed hands, extra limbs, distorted anatomy, cheap e-commerce look, cluttered background, low-detail fabric, oversaturated skin
```

## Checklist before finalizing

For each prompt:

- Does it still reflect the assigned family?
- Is the scene visible and not just implied?
- Is the wardrobe specific enough?
- Is the composition explicit?
- Is the text policy present?
- Does it differ enough from nearby prompts?
