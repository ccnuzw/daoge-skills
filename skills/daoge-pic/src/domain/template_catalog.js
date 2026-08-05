const path = require('path');
const {
  readJsonIfExists,
  loadTemplateRegistry,
  toArray,
  normalizeText,
} = require('../shared/workspace');

const DEFAULT_RECOMMENDED_IDS = [
  'campaign-poster',
  'ecommerce-clean',
  'studio-editorial',
  'ui-mockup-board',
  'image-edit',
  'cinematic-storyboard',
];

function unique(values) {
  return Array.from(new Set(values.map((item) => String(item || '').trim()).filter(Boolean)));
}

function loadExampleCatalog(skillRoot = path.resolve(__dirname, '..', '..')) {
  const catalogPath = path.join(skillRoot, 'references', 'examples', 'examples.catalog.json');
  const catalog = readJsonIfExists(catalogPath) || { examples: [] };
  return Array.isArray(catalog.examples) ? catalog.examples : [];
}

function groupExamplesByTemplate(examples) {
  return examples.reduce((acc, example) => {
    const templateId = example.template_id;
    if (!templateId) return acc;
    if (!acc[templateId]) acc[templateId] = [];
    acc[templateId].push(example);
    return acc;
  }, {});
}

function categorySummary(templates) {
  const counts = templates.reduce((acc, template) => {
    acc[template.category] = (acc[template.category] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, count]) => ({ id, count }));
}

function templateSearchText(template, examples = []) {
  return [
    template.id,
    template.name,
    template.category,
    template.description,
    template.family,
    template.tier,
    ...toArray(template.triggers),
    ...toArray(template.required_focus),
    ...toArray(template.ask_fields),
    ...toArray(template.variants).flatMap((variant) => [variant.id, variant.name, variant.description]),
    ...examples.flatMap((example) => [example.name, example.description, example.template_variant]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function summarizeTemplate(template, examples = []) {
  const recommendedExample = examples.find((item) => item.recommended_start) || examples[0] || null;
  const tags = unique([
    template.category,
    template.family,
    template.tier,
    ...toArray(template.triggers),
    ...toArray(template.required_focus).slice(0, 4),
  ]).slice(0, 18);
  return {
    id: template.id,
    name: template.name,
    category: template.category,
    tags,
    bestFor: toArray(template.required_focus),
    scenarios: toArray(template.ask_fields),
    description: template.description || '',
    recommended: DEFAULT_RECOMMENDED_IDS.includes(template.id) || examples.some((item) => item.recommended_start),
    commonUse: DEFAULT_RECOMMENDED_IDS.includes(template.id),
    templateDoc: template.template_doc || null,
    variants: toArray(template.variants).map((variant) => ({
      id: variant.id,
      name: variant.name,
      description: variant.description || '',
    })),
    preview: {
      promptSections: toArray(template.prompt_sections).slice(0, 10),
      compositionBias: toArray(template.composition_bias).slice(0, 4),
      qualityRules: toArray(template.quality_rules).slice(0, 5),
      antiPatterns: toArray(template.anti_patterns).slice(0, 4),
    },
    exampleParams: recommendedExample ? {
      intent: recommendedExample.starter_intent || template.id,
      templateId: template.id,
      variant: recommendedExample.template_variant || null,
      exampleFile: recommendedExample.example_file || null,
      startCommand: `node scripts/daoge.js prepare --task-spec ${recommendedExample.example_file || 'task_spec.json'} --output-dir out`,
    } : {
      intent: template.id,
      templateId: template.id,
      variant: toArray(template.variants)[0]?.id || null,
      exampleFile: null,
      startCommand: `node scripts/daoge.js prepare --task-spec task_spec.json --output-dir out --intent ${template.id}`,
    },
  };
}

function buildTemplateDirectory(options = {}) {
  const skillRoot = options.skillRoot || path.resolve(__dirname, '..', '..');
  const templates = loadTemplateRegistry(skillRoot);
  const examplesByTemplate = groupExamplesByTemplate(loadExampleCatalog(skillRoot));
  const directory = templates.map((template) => summarizeTemplate(template, examplesByTemplate[template.id] || []));
  return {
    generatedAt: new Date().toISOString(),
    count: directory.length,
    categories: categorySummary(directory),
    recommended: directory.filter((item) => item.recommended).map((item) => item.id),
    templates: directory,
  };
}

function searchTemplateDirectory(options = {}) {
  const directory = buildTemplateDirectory(options);
  const category = normalizeText(options.category).toLowerCase();
  const keyword = normalizeText(options.keyword || options.query).toLowerCase();
  const recommendedOnly = Boolean(options.recommendedOnly);
  const examplesByTemplate = groupExamplesByTemplate(loadExampleCatalog(options.skillRoot));
  const rawTemplates = loadTemplateRegistry(options.skillRoot);
  const rawById = new Map(rawTemplates.map((item) => [item.id, item]));
  let templates = directory.templates;
  if (category) templates = templates.filter((item) => item.category === category);
  if (recommendedOnly) templates = templates.filter((item) => item.recommended || item.commonUse);
  if (keyword) {
    templates = templates.filter((item) => {
      const raw = rawById.get(item.id) || item;
      return templateSearchText(raw, examplesByTemplate[item.id] || []).includes(keyword);
    });
  }
  return { ...directory, count: templates.length, templates };
}

module.exports = {
  DEFAULT_RECOMMENDED_IDS,
  buildTemplateDirectory,
  searchTemplateDirectory,
};
