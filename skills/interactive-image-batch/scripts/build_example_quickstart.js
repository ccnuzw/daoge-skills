const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, writeJson, ensureDir } = require('./script_utils');

const DEFAULTS = {
  total_count: 4,
  batch_size: 2,
  concurrency: 2,
  retry_count: 1,
  timeout_seconds: 450,
  width: 1440,
  height: 2560,
  preview_count: 4,
  require_confirmation: true,
};

const TEMPLATE_REQUIRED_FIELD_DEFAULTS = {
  'academic-figure-board': {
    figure_type: 'graphical abstract',
    comparison_mode: 'single-path',
    annotation_density: 'balanced',
  },
  'brand-packaging-board': {
    packaging_format: 'box packaging',
    brand_asset_scope: 'identity board',
    material_signal: 'premium carton',
  },
  'illustrated-scene-set': {
    scene_mood: 'healing',
    narrative_anchor: 'environment-led',
    illustration_surface: 'textured storybook',
  },
  'map-route-board': {
    map_type: 'route map',
    route_logic: 'linear path',
    label_density: 'balanced',
  },
  'type-layout-poster': {
    headline_role: 'giant title',
    language_mode: 'bilingual balanced',
    type_dominance: 'type-led',
  },
  'asset-prop-sheet': {
    asset_role: 'icon sheet',
    surface_style: 'retro skeuomorphic',
    presentation_mode: 'isolated board',
  },
  'avatar-profile-pack': {
    identity_policy: 'same person or same character identity stays stable across the whole set',
  },
  'technical-diagram': {
    diagram_goal: 'technical structure explanation',
    relationship_semantics: 'directional node relationships stay readable',
    legend_label_policy: 'labels stay short and diagram-safe',
  },
  'infographic-board': {
    information_goal: 'structured visual explanation',
    module_grouping: 'clear modular grouping with obvious reading order',
    headline_label_policy: 'headline and labels stay short and replacement-safe',
  },
};

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function cleanStrings(items) {
  return ensureArray(items).map(String).map((item) => item.trim()).filter(Boolean);
}

function resolveExamplePath(example, value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (path.isAbsolute(text)) return text;
  const exampleFile = String(example.__example_file || '').trim();
  const exampleDir = exampleFile ? path.dirname(exampleFile) : process.cwd();
  return path.resolve(exampleDir, text);
}

function guessCompositionPool(templateId) {
  switch (templateId) {
    case 'campaign-poster':
      return ['full-body 9:16 poster', 'head-to-toe campaign extension layout'];
    case 'ui-mockup-board':
      return ['device-framed interface hero', 'split-screen product interface layout'];
    case 'avatar-profile-pack':
      return ['centered avatar crop', 'head-and-shoulders identity portrait'];
    case 'infographic-board':
      return ['modular infographic board', 'top-down information layout'];
    case 'technical-diagram':
      return ['layered technical board', 'clean node-link diagram'];
    case 'avatar-profile-pack':
      return ['centered avatar crop', 'circular-safe profile framing'];
    case 'visual-doc-slide':
      return ['title-led report layout', 'left-text-right-visual slide page'];
    default:
      return ['structured hero layout', 'clean editorial layout'];
  }
}

function guessWardrobePool(templateId) {
  switch (templateId) {
    case 'avatar-profile-pack':
      return ['consistent character styling', 'series-safe identity outfit'];
    case 'academic-figure-board':
      return ['publication annotation styling', 'evidence-led panel styling'];
    case 'map-route-board':
      return ['guide legend styling', 'landmark marker styling'];
    case 'type-layout-poster':
      return ['headline-safe layout styling', 'editorial type styling'];
    case 'asset-prop-sheet':
      return ['collectible asset styling', 'ui-embedded asset styling'];
    default:
      return ['signature visual styling', 'secondary supporting styling'];
  }
}

function buildVariantAxes(example) {
  const templateId = String(example.template_id || '').trim();
  const explicit = Object.entries(example.sample_variant_axes || {});
  const defaults = TEMPLATE_REQUIRED_FIELD_DEFAULTS[templateId] || {};
  const merged = new Map(explicit.map(([field, value]) => [field, value]));
  Object.entries(defaults).forEach(([field, value]) => {
    if (!merged.has(field)) merged.set(field, value);
  });
  return Array.from(merged.entries()).map(([field, value]) => ({
    name: field.replace(/_/g, '-'),
    field,
    strategy: 'cycle',
    batch_balance: 'within-batch',
    options: [
      { name: String(value).trim(), weight: 1 },
      { name: `${String(value).trim()} alt`, weight: 1 },
    ],
  }));
}

function buildTaskSpec(example) {
  const storyboardSlots = Array.isArray(example.__storyboard_content?.slots)
    ? example.__storyboard_content.slots.filter((slot) => slot && slot.generate_image !== false)
    : [];
  const storyboardCount = storyboardSlots.length || null;
  const storyboardCanvas = example.__storyboard_layout?.canvas && typeof example.__storyboard_layout.canvas === 'object'
    ? example.__storyboard_layout.canvas
    : null;
  const taskSpec = {
    content_brief: String(example.content_brief || '').trim(),
    output_mode: String(example.output_mode || '').trim(),
    style_requirements: cleanStrings(example.style_requirements),
    source_files: [],
    total_count: storyboardCount || DEFAULTS.total_count,
    batch_size: storyboardCount ? Math.min(DEFAULTS.batch_size, storyboardCount) : DEFAULTS.batch_size,
    concurrency: DEFAULTS.concurrency,
    retry_count: DEFAULTS.retry_count,
    timeout_seconds: DEFAULTS.timeout_seconds,
    width: Number(storyboardCanvas?.width) > 0 ? Number(storyboardCanvas.width) : DEFAULTS.width,
    height: Number(storyboardCanvas?.height) > 0 ? Number(storyboardCanvas.height) : DEFAULTS.height,
    variation_requirements: cleanStrings(example.variation_requirements),
    text_policy: String(example.text_policy || '').trim(),
    preview_count: DEFAULTS.preview_count,
    require_confirmation: DEFAULTS.require_confirmation,
    run_label: `${String(example.template_id || 'example').trim()}-quickstart`,
  };
  if (example.storyboard_plan && typeof example.storyboard_plan === 'object') {
    taskSpec.storyboard_plan = {
      ...example.storyboard_plan,
      layout_manifest: resolveExamplePath(example, example.storyboard_plan.layout_manifest),
      content_manifest: resolveExamplePath(example, example.storyboard_plan.content_manifest),
      render_config: resolveExamplePath(example, example.storyboard_plan.render_config),
      reference_bindings: resolveExamplePath(example, example.storyboard_plan.reference_bindings),
    };
  }
  return taskSpec;
}

function buildTemplateExtras(example) {
  const templateId = String(example.template_id || '').trim();
  const variantId = String(example.template_variant || '').trim();
  const contentBrief = String(example.content_brief || '').trim();
  const styleRequirements = cleanStrings(example.style_requirements);
  const variationRequirements = cleanStrings(example.variation_requirements);

  if (templateId === 'technical-diagram') {
    const diagramGoal = variantId === 'flowchart-decision'
      ? 'clarify branch decisions, process direction, and outcome routing'
      : variantId === 'state-machine'
        ? 'clarify state transitions, triggers, and start-end conditions'
        : 'clarify technical node relationships and reading order';
    return {
      diagram_goal: diagramGoal,
      relationship_semantics: variationRequirements.join('；') || 'directional node relationships stay readable',
      legend_label_policy: `${String(example.text_policy || '').trim() || 'labels stay short and replacement-safe'}；${contentBrief}`,
    };
  }

  if (templateId === 'infographic-board') {
    const informationGoal = variantId === 'comparison-infographic'
      ? 'highlight contrasts, summary conclusions, and left-right comparison logic'
      : variantId === 'bento-grid-infographic'
        ? 'balance modular cards, key metrics, and grouped explainer blocks'
        : 'organize information into clear modular explanation blocks';
    return {
      information_goal: informationGoal,
      module_grouping: variationRequirements.join('；') || 'clear modular grouping with obvious reading order',
      headline_label_policy: `${String(example.text_policy || '').trim() || 'headline and labels stay short and replacement-safe'}；${styleRequirements.join('；')}`,
    };
  }

  return {};
}

function buildPromptStrategy(example) {
  const templateId = String(example.template_id || '').trim();
  const variantId = String(example.template_variant || 'default').trim();
  const styleRequirements = cleanStrings(example.style_requirements);
  const storyboardSlots = Array.isArray(example.__storyboard_content?.slots)
    ? example.__storyboard_content.slots.filter((slot) => slot && slot.generate_image !== false)
    : [];
  const storyboardCount = storyboardSlots.length || null;
  const totalCount = storyboardCount || DEFAULTS.total_count;
  const primaryCount = Math.max(1, Math.ceil(totalCount / 2));
  const supportCount = Math.max(0, totalCount - primaryCount);
  const styleFamilies = [
    { name: `${templateId}-primary`, count: primaryCount },
    ...(supportCount ? [{ name: `${variantId}-support`, count: supportCount }] : []),
  ];
  const gradeDistribution = [
    { name: 'S', count: primaryCount },
    ...(supportCount ? [{ name: 'A', count: supportCount }] : []),
  ];

  return {
    content_brief: String(example.content_brief || '').trim(),
    source_files: [],
    output_mode: String(example.output_mode || '').trim(),
    total_count: totalCount,
    batch_size: storyboardCount ? Math.min(DEFAULTS.batch_size, storyboardCount) : DEFAULTS.batch_size,
    variation_requirements: cleanStrings(example.variation_requirements),
    style_families: styleFamilies,
    grade_distribution: gradeDistribution,
    scene_pool: styleRequirements.slice(0, 2).length ? styleRequirements.slice(0, 2) : ['structured visual scene', 'secondary variation scene'],
    wardrobe_pool: guessWardrobePool(templateId),
    composition_pool: guessCompositionPool(templateId),
    text_policy: String(example.text_policy || '').trim(),
    negative_policy: 'no watermark, no readable paragraph text',
    variation_rules: cleanStrings(example.variation_requirements),
    template_variant: {
      id: variantId,
      name: variantId,
      source: 'example',
    },
    variant_axes: buildVariantAxes(example),
    ...buildTemplateExtras(example),
    notes: `Generated from example quickstart: ${path.basename(String(example.__example_file || 'example.json'))}`,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['example-file']) throw new Error('Missing required flag: --example-file');

  const exampleFile = path.resolve(args['example-file']);
  const outputDir = path.resolve(args['output-dir'] || path.dirname(exampleFile));
  const example = readJson(exampleFile);
  example.__example_file = exampleFile;
  if (example.storyboard_plan && example.storyboard_plan.content_manifest) {
    const contentPath = resolveExamplePath(example, example.storyboard_plan.content_manifest);
    if (contentPath && fs.existsSync(contentPath)) {
      example.__storyboard_content = readJson(contentPath);
    }
  }
  if (example.storyboard_plan && example.storyboard_plan.layout_manifest) {
    const layoutPath = resolveExamplePath(example, example.storyboard_plan.layout_manifest);
    if (layoutPath && fs.existsSync(layoutPath)) {
      example.__storyboard_layout = readJson(layoutPath);
    }
  }

  ensureDir(outputDir);

  const taskSpec = buildTaskSpec(example);
  const strategy = buildPromptStrategy(example);

  const taskSpecPath = path.join(outputDir, 'task_spec.quickstart.json');
  const strategyPath = path.join(outputDir, 'prompt_strategy.quickstart.json');

  writeJson(taskSpecPath, taskSpec);
  writeJson(strategyPath, strategy);

  console.log(JSON.stringify({
    exampleFile,
    outputDir,
    taskSpecPath,
    strategyPath,
    templateId: example.template_id || null,
    templateVariant: example.template_variant || null,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
