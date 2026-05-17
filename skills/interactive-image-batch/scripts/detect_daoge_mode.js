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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function buildCorpus(taskSpec, strategy) {
  const storyboardSignals = [
    taskSpec.storyboard_plan?.generation_mode,
    taskSpec.storyboard_plan?.assembly_mode,
    taskSpec.storyboard_plan?.reference_mode,
    taskSpec.storyboard_plan?.layout_manifest,
    taskSpec.storyboard_plan?.content_manifest,
    taskSpec.storyboard_plan?.render_config,
  ];
  return [
    taskSpec.content_brief,
    taskSpec.output_mode,
    ...(taskSpec.style_requirements || []),
    ...(taskSpec.source_images || []),
    ...(taskSpec.variation_requirements || []),
    strategy.output_mode,
    ...(strategy.scene_pool || []),
    ...(strategy.wardrobe_pool || []),
    ...(strategy.variation_rules || []),
    ...storyboardSignals,
  ].filter(Boolean).join(' ').toLowerCase();
}

function scoreTrigger(corpus, trigger) {
  const normalizedTrigger = String(trigger || '').trim().toLowerCase();
  if (!normalizedTrigger) return 0;
  const weakTriggers = new Set(['poster', '海报', 'campaign', '广告', '主视觉', 'kv']);
  const negativeHints = [
    `no ${normalizedTrigger}`,
    `not ${normalizedTrigger}`,
    `without ${normalizedTrigger}`,
    `非${normalizedTrigger}`,
    `不要${normalizedTrigger}`,
    `不是${normalizedTrigger}`,
    `去掉${normalizedTrigger}`,
  ];
  if (negativeHints.some((hint) => corpus.includes(hint))) return 0;
  if (!corpus.includes(normalizedTrigger)) return 0;
  return weakTriggers.has(normalizedTrigger) ? 0.4 : 1;
}

function scoreTemplate(template, corpus) {
  return (template.triggers || []).reduce((acc, trigger) => acc + scoreTrigger(corpus, trigger), 0);
}

function createGenericTemplate() {
  return {
    id: 'generic',
    name: '通用模板',
    category: 'generic',
    description: '未命中专用模板时使用的通用保底模板',
    triggers: [],
    required_focus: [],
    ask_fields: [],
    required_slot_fields: [],
    prompt_sections: [],
    composition_bias: [],
    quality_rules: [],
    default_negative_terms: [],
    anti_patterns: [],
    variants: [],
    autofill_policy: null,
  };
}

function detectTemplate(registry, corpus) {
  const scored = (registry.templates || []).map((template) => ({
    ...template,
    score: scoreTemplate(template, corpus),
  })).sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 1 ? scored[0] : createGenericTemplate();
}

function stripRuntimeScore(template) {
  const { score, ...rest } = template;
  return rest;
}

function maybeReadTemplateDoc(template, registryPath) {
  if (!template.template_doc) return null;
  const skillRoot = path.resolve(path.dirname(registryPath), '..');
  const docPath = path.resolve(skillRoot, template.template_doc);
  if (!fs.existsSync(docPath)) return { path: docPath, exists: false, excerpt: null };
  const text = fs.readFileSync(docPath, 'utf8');
  return {
    path: docPath,
    exists: true,
    excerpt: text.split(/\r?\n/).slice(0, 80).join('\n'),
  };
}

function detectMode(taskSpec) {
  if (taskSpec.storyboard_plan?.enabled) {
    if (taskSpec.source_images && taskSpec.source_images.length) return 'storyboard-image-edit';
    return 'storyboard-board';
  }
  if (taskSpec.source_images && taskSpec.source_images.length) return 'image-edit';
  if (taskSpec.require_confirmation === false) return 'execute-ready';
  return 'prepare-only';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['task-spec']) throw new Error('Missing required flag: --task-spec');
  if (!args['strategy-file']) throw new Error('Missing required flag: --strategy-file');

  const taskSpec = readJson(args['task-spec']);
  const strategy = readJson(args['strategy-file']);
  const registryPath = path.resolve(args['registry-file'] || path.join(__dirname, '..', 'references', 'template_registry_zh.json'));
  const registry = readJson(registryPath);

  const corpus = buildCorpus(taskSpec, strategy);
  const template = detectTemplate(registry, corpus);
  const mode = detectMode(taskSpec);

  const result = {
    detected_mode: mode,
    detected_template: stripRuntimeScore(template),
    template_document: maybeReadTemplateDoc(template, registryPath),
  };

  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(path.resolve(args['task-spec'])), 'daoge_mode_detection.json'));
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ outputPath, detectedMode: result.detected_mode, detectedTemplate: result.detected_template.id }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
