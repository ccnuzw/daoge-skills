const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    args[key] = value;
    if (value !== 'true') i += 1;
  }
  return args;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function slugify(value) {
  const original = String(value || '').trim();
  const hasNonAscii = /[^\x00-\x7F]/.test(original);
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || (hasNonAscii ? 'zh-item' : 'item');
}

function buildUniqueSlug(family, scene, wardrobe, index) {
  const prefix = String(index).padStart(4, '0');
  const core = slugify(`${family}-${scene}-${wardrobe}`);
  return `${prefix}-${core}`.slice(0, 110);
}

function expandCounts(items) {
  const out = [];
  for (const item of ensureArray(items)) {
    const count = Math.max(0, Number(item.count || 0));
    for (let i = 0; i < count; i += 1) {
      out.push(String(item.name).trim());
    }
  }
  return out;
}

function cyclePick(pool, index) {
  if (!pool.length) return null;
  return pool[index % pool.length];
}

function weightedPick(options, index) {
  const expanded = [];
  for (const option of ensureArray(options)) {
    const weight = Math.max(1, Number((typeof option === 'object' ? option.weight : 1) || 1));
    for (let i = 0; i < weight; i += 1) expanded.push(option);
  }
  return cyclePick(expanded, index);
}

function optionName(option) {
  if (typeof option === 'string') return option;
  return option.name || option.value || option.prompt_hint || null;
}

function optionValue(option) {
  if (typeof option === 'string') return option;
  return option.prompt_hint || option.name || option.value || null;
}

function pickAxisOption(axis, index, batchIndex) {
  const options = ensureArray(axis.options);
  if (!options.length) return null;
  if (axis.strategy === 'weighted') return weightedPick(options, index);
  if (axis.strategy === 'batch-balanced' || axis.batch_balance === 'within-batch') {
    return cyclePick(options, batchIndex);
  }
  return cyclePick(options, index);
}

function assignVariantAxes(axes, index, batchIndex) {
  const assignments = {};
  const summary = [];
  for (const axis of ensureArray(axes)) {
    if (!axis.field) continue;
    const option = pickAxisOption(axis, index, batchIndex);
    if (!option) continue;
    const value = optionValue(option);
    if (!value) continue;
    assignments[axis.field] = value;
    summary.push({
      axis: axis.name || axis.field,
      field: axis.field,
      value,
      option: optionName(option) || value,
      strategy: axis.strategy || 'cycle',
    });
  }
  return { assignments, summary };
}

function buildFieldSources(slot, explicitFields, sourceLabel = 'strategy') {
  const sources = {};
  explicitFields.forEach((field) => {
    if (slot[field] !== undefined && slot[field] !== null && String(slot[field]).trim() !== '') {
      sources[field] = sourceLabel;
    }
  });
  return sources;
}

function applyAutofill(slot, policy, index) {
  if (!policy || policy.enabled === false) return slot;
  const sourceField = policy.source_field || 'field_sources';
  const sources = { ...(slot[sourceField] || {}) };
  for (const rule of ensureArray(policy.rules)) {
    if (!rule.field || !ensureArray(rule.values).length) continue;
    const current = slot[rule.field];
    if (rule.when_missing !== false && current !== undefined && current !== null && String(current).trim() !== '') continue;
    const value = cyclePick(rule.values, index);
    slot[rule.field] = value;
    if (policy.mark_sources !== false) sources[rule.field] = rule.source || policy.default_source_label || 'autofill';
  }
  if (Object.keys(sources).length) slot[sourceField] = sources;
  return slot;
}

function buildMatrixPlan(slots, strategy, batchSize) {
  const axes = ensureArray(strategy.variant_axes);
  const axisDistributions = {};
  const combinationCounts = {};
  const batchAxisDistributions = {};

  slots.forEach((slot) => {
    const batchNumber = Math.floor((slot.index - 1) / batchSize) + 1;
    batchAxisDistributions[batchNumber] = batchAxisDistributions[batchNumber] || {};
    const combo = [];
    ensureArray(slot.variant_axes).forEach((axis) => {
      const axisName = axis.axis || axis.field;
      const value = axis.option || axis.value;
      if (!axisName || !value) return;
      axisDistributions[axisName] = axisDistributions[axisName] || {};
      axisDistributions[axisName][value] = (axisDistributions[axisName][value] || 0) + 1;
      batchAxisDistributions[batchNumber][axisName] = batchAxisDistributions[batchNumber][axisName] || {};
      batchAxisDistributions[batchNumber][axisName][value] = (batchAxisDistributions[batchNumber][axisName][value] || 0) + 1;
      combo.push(`${axisName}=${value}`);
    });
    if (combo.length) {
      const key = combo.join('|');
      combinationCounts[key] = (combinationCounts[key] || 0) + 1;
    }
  });

  return {
    totalCount: slots.length,
    batchSize,
    batchCount: Math.ceil(slots.length / batchSize),
    templateVariant: strategy.template_variant || null,
    axes: axes.map((axis) => ({
      name: axis.name,
      field: axis.field,
      strategy: axis.strategy,
      batchBalance: axis.batch_balance,
      avoidRepeatWithinBatch: Boolean(axis.avoid_repeat_within_batch),
      optionCount: ensureArray(axis.options).length,
    })),
    axisDistributions,
    combinationCounts,
    batchAxisDistributions,
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function loadTemplateContract(filePath) {
  if (!filePath) return null;
  const detected = readJson(filePath);
  return detected.detected_template || detected.template || detected;
}

function slotTemplateFields(template) {
  if (!template) return {};
  return {
    daoge_template_id: template.id || null,
    daoge_template_name: template.name || null,
    template_category: template.category || null,
    template_focus: ensureArray(template.required_focus),
    template_required_slot_fields: ensureArray(template.required_slot_fields),
    template_prompt_sections: ensureArray(template.prompt_sections),
    template_composition_bias: ensureArray(template.composition_bias),
    template_quality_rules: ensureArray(template.quality_rules),
    template_default_negative_terms: ensureArray(template.default_negative_terms),
    template_anti_patterns: ensureArray(template.anti_patterns),
  };
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function loadStoryboardBlueprint(filePath) {
  if (!filePath) return null;
  const data = readJson(filePath);
  if (data && Array.isArray(data.generation_slots)) return data;
  return null;
}

function flattenSourceRefs(strategyRefs, itemRefs, referenceImages) {
  return Array.from(new Set([
    ...ensureArray(strategyRefs).map(String).map((item) => item.trim()).filter(Boolean),
    ...ensureArray(itemRefs).map(String).map((item) => item.trim()).filter(Boolean),
    ...ensureArray(referenceImages).map(String).map((item) => item.trim()).filter(Boolean),
  ]));
}

function buildStoryboardSlots({ storyboardData, strategy, templateFields }) {
  const sourceFiles = ensureArray(strategy.source_files).map(String).map((item) => item.trim()).filter(Boolean);
  const generationSlots = ensureArray(storyboardData.generation_slots);
  if (!generationSlots.length) throw new Error('Storyboard bundle has no generation_slots');
  const fallbackFamily = firstNonEmptyString(
    ensureArray(strategy.style_families)[0]?.name,
    ensureArray(strategy.style_families)[0],
    strategy.output_mode,
    'storyboard-board'
  );

  return generationSlots.map((item, index) => {
    const shotLabel = firstNonEmptyString(item.shot_label, item.slot_id, `shot-${index + 1}`);
    const scene = firstNonEmptyString(item.scene, ensureArray(item.prompt_hints)[0], shotLabel);
    const composition = firstNonEmptyString(
      item.composition_hint,
      item.layout_region?.aspect_ratio ? `${item.layout_region.aspect_ratio} storyboard frame` : null,
      `layout region ${item.layout_region_id}`
    );
    const cameraLanguage = firstNonEmptyString(item.camera_move, composition);
    const variantAxes = [];
    if (item.sequence !== undefined && item.sequence !== null) {
      variantAxes.push({
        axis: 'story-beat',
        field: 'story_beat',
        value: `${item.sequence}. ${shotLabel}`,
        option: `${item.sequence}. ${shotLabel}`,
        strategy: 'storyboard',
      });
    }
    if (cameraLanguage) {
      variantAxes.push({
        axis: 'camera-language',
        field: 'camera_language',
        value: cameraLanguage,
        option: cameraLanguage,
        strategy: 'storyboard',
      });
    }

    return {
      index: index + 1,
      slug: buildUniqueSlug(item.board_id || 'board', item.slot_id || shotLabel, item.slot_role || 'shot', index + 1),
      title: shotLabel,
      style_family: firstNonEmptyString(item.asset_mode, fallbackFamily),
      style_variant: null,
      purity_grade: null,
      scene,
      scene_anchor: ensureArray(item.prompt_hints).join('; ') || null,
      wardrobe: firstNonEmptyString(item.wardrobe, item.asset_mode, 'storyboard product frame'),
      exposure_signal: ensureArray(item.visual_elements).join('; ') || null,
      gesture: null,
      camera: composition,
      camera_language: cameraLanguage,
      eye_language: null,
      candidness: null,
      lighting: firstNonEmptyString(item.lighting_hint, 'warm side backlight with layered steam and deep contrast'),
      palette: null,
      mood: firstNonEmptyString(item.board_theme, null),
      composition,
      variant_axes: variantAxes,
      variant_signature: variantAxes.map((axis) => `${axis.axis}=${axis.option}`).join(' | ') || null,
      template_variant: strategy.template_variant || null,
      text_policy: firstNonEmptyString(item.text_policy, strategy.text_policy),
      source_refs: flattenSourceRefs(sourceFiles, item.source_refs, item.reference_images),
      negative_prompt: strategy.negative_policy || null,
      field_sources: {
        style_family: 'storyboard',
        scene: 'storyboard',
        composition: 'storyboard',
        text_policy: item.text_policy ? 'storyboard' : 'strategy',
      },
      notes: [
        `Storyboard slot ${item.slot_id}`,
        item.notes,
        item.voiceover ? `Voiceover: ${item.voiceover}` : null,
        item.music ? `Music: ${item.music}` : null,
      ].filter(Boolean).join(' | '),
      shot_id: item.shot_id || item.slot_id,
      shot_label: shotLabel,
      slot_id: item.slot_id,
      slot_role: item.slot_role,
      layout_region_id: item.layout_region_id,
      board_id: item.board_id,
      timecode: item.timecode || null,
      reference_images: ensureArray(item.reference_images),
      mask_image: item.mask_image || null,
      reference_notes: ensureArray(item.reference_notes),
      prompt_hints: ensureArray(item.prompt_hints),
      continuity_notes: ensureArray(item.continuity_notes),
      visual_elements: ensureArray(item.visual_elements),
      voiceover: item.voiceover || null,
      music: item.music || null,
      sound_effects: item.sound_effects || null,
      camera_move: item.camera_move || null,
      story_beat: firstNonEmptyString(shotLabel, item.timecode),
      ...templateFields,
    };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['strategy-file']) throw new Error('Missing required flag: --strategy-file');

  const strategyPath = path.resolve(args['strategy-file']);
  const strategy = JSON.parse(fs.readFileSync(strategyPath, 'utf8'));
  const template = loadTemplateContract(args['mode-file'] || args['template-file']);
  const templateFields = slotTemplateFields(template);
  const storyboardData = loadStoryboardBlueprint(args['storyboard-file']);

  let slots;
  let batchSize;
  if (storyboardData) {
    slots = buildStoryboardSlots({ storyboardData, strategy, templateFields });
    batchSize = Math.max(1, Number(strategy.batch_size || slots.length || 1));
    slots = slots.map((slot, index) => applyAutofill(slot, strategy.autofill_policy, index));
  } else {
    const styleFamilies = expandCounts(strategy.style_families);
    const grades = expandCounts(strategy.grade_distribution);
    const scenes = ensureArray(strategy.scene_pool).map(String).map((item) => item.trim()).filter(Boolean);
    const wardrobes = ensureArray(strategy.wardrobe_pool).map(String).map((item) => item.trim()).filter(Boolean);
    const compositions = ensureArray(strategy.composition_pool).map(String).map((item) => item.trim()).filter(Boolean);
    const sourceFiles = ensureArray(strategy.source_files).map(String).map((item) => item.trim()).filter(Boolean);
    const variantAxes = ensureArray(strategy.variant_axes);

    if (!styleFamilies.length) throw new Error('Strategy has no expandable style_families');
    if (!scenes.length) throw new Error('Strategy has no scene_pool');
    if (!wardrobes.length) throw new Error('Strategy has no wardrobe_pool');
    if (!compositions.length) throw new Error('Strategy has no composition_pool');

    const totalCount = Math.max(styleFamilies.length, Number(strategy.total_count || styleFamilies.length));
    batchSize = Math.max(1, Number(strategy.batch_size || totalCount || 1));
    slots = [];
    for (let i = 0; i < totalCount; i += 1) {
      const batchIndex = i % batchSize;
      const family = styleFamilies[i] || cyclePick(styleFamilies, i);
      const grade = grades.length ? (grades[i] || cyclePick(grades, i)) : null;
      const scene = cyclePick(scenes, i);
      const wardrobe = cyclePick(wardrobes, i);
      const composition = cyclePick(compositions, i);
      const variantAxisResult = assignVariantAxes(variantAxes, i, batchIndex);
      const slug = buildUniqueSlug(family, scene, wardrobe, i + 1);
      const slot = {
        index: i + 1,
        slug,
        title: `${family} ${i + 1}`,
        style_family: family,
        style_variant: null,
        purity_grade: grade,
        scene,
        scene_anchor: null,
        wardrobe,
        exposure_signal: null,
        gesture: null,
        camera: composition,
        eye_language: null,
        candidness: null,
        lighting: null,
        palette: null,
        mood: null,
        composition,
        variant_axes: variantAxisResult.summary,
        variant_signature: variantAxisResult.summary.map((item) => `${item.axis}=${item.option}`).join(' | ') || null,
        template_variant: strategy.template_variant || null,
        text_policy: strategy.text_policy || null,
        source_refs: sourceFiles,
        negative_prompt: strategy.negative_policy || null,
        field_sources: {},
        notes: `Scaffolded from prompt strategy: ${path.basename(strategyPath)}`,
        ...templateFields,
        ...variantAxisResult.assignments,
      };
      slot.field_sources = buildFieldSources(slot, ['style_family', 'purity_grade', 'scene', 'wardrobe', 'composition', 'text_policy', ...variantAxisResult.summary.map((item) => item.field).filter(Boolean)], 'strategy');
      slots.push(applyAutofill(slot, strategy.autofill_policy, i));
    }
  }

  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(strategyPath), 'prompt_slots.json'));
  const matrixPlanPath = path.resolve(args['matrix-plan-file'] || path.join(path.dirname(outputPath), 'variant_matrix_plan.json'));
  fs.writeFileSync(outputPath, JSON.stringify(slots, null, 2));
  fs.writeFileSync(matrixPlanPath, JSON.stringify(buildMatrixPlan(slots, strategy, batchSize), null, 2));
  console.log(JSON.stringify({ outputPath, matrixPlanPath, totalCount: slots.length, exampleSlug: slots[0]?.slug || null }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
