const path = require('path');
const { toArray, normalizeText, inferTaskId } = require('../shared/workspace');
const { resolveMaterialPath } = require('./material_resolver');

function pick(list, index, fallback) {
  const items = toArray(list).filter(Boolean);
  return items.length ? items[index % items.length] : fallback;
}

function countFrom(taskSpec = {}, strategy = {}) {
  return Math.max(1, Number(taskSpec.total_count || taskSpec.totalCount || strategy.total_count || strategy.totalCount || 1) || 1);
}

function poolFromStrategy(strategy = {}, key, fallback) {
  const value = strategy[key];
  if (Array.isArray(value) && value.length) {
    return value.map((item) => (typeof item === 'string' ? item : item.name || item.title || item.id)).filter(Boolean);
  }
  return fallback;
}

function styleFamilyAt(strategy = {}, index, fallback) {
  const families = toArray(strategy.style_families);
  if (!families.length) return fallback;
  const expanded = [];
  families.forEach((item) => {
    const name = typeof item === 'string' ? item : normalizeText(item.name || item.id || item.title);
    const count = Math.max(1, Number(item.count || 1) || 1);
    for (let i = 0; i < count; i += 1) expanded.push(name);
  });
  return expanded[index % expanded.length] || fallback;
}

function normalizeSourceList(value, baseDir) {
  return toArray(value)
    .map((item) => (typeof item === 'string' ? item : item.path || item.file || item.source))
    .filter(Boolean)
    .map((item) => resolveMaterialPath(item, baseDir));
}

function buildGeneratedPrompts({ taskSpec = {}, promptStrategy = {}, taskSpecFile = null } = {}) {
  const taskBaseDir = taskSpecFile ? path.dirname(path.resolve(taskSpecFile)) : process.cwd();
  const total = countFrom(taskSpec, promptStrategy);
  const taskId = inferTaskId({
    contentBrief: taskSpec.content_brief,
    outputMode: taskSpec.output_mode,
    intent: taskSpec.intent,
  });
  const brief = normalizeText(taskSpec.content_brief || promptStrategy.content_brief, '生图任务');
  const outputMode = normalizeText(taskSpec.output_mode || promptStrategy.output_mode, 'photoreal image');
  const textPolicy = normalizeText(taskSpec.text_policy || promptStrategy.text_policy, 'keep clean space for later text layout');
  const negative = normalizeText(promptStrategy.negative_policy || taskSpec.negative_prompt, 'no watermark, no unreadable text, no distorted hands, no broken anatomy');
  const styleRequirements = toArray(taskSpec.style_requirements).join(', ');
  const variationRequirements = toArray(taskSpec.variation_requirements || promptStrategy.variation_requirements).join(', ');
  const scenes = poolFromStrategy(promptStrategy, 'scene_pool', ['clean studio scene', 'window light interior', 'simple premium background']);
  const wardrobes = poolFromStrategy(promptStrategy, 'wardrobe_pool', ['refined wardrobe', 'minimal contemporary styling', 'premium tonal styling']);
  const compositions = poolFromStrategy(promptStrategy, 'composition_pool', ['vertical poster composition', 'centered hero composition', 'clean editorial composition']);
  const lightingPool = poolFromStrategy(promptStrategy, 'lighting_pool', ['soft premium light', 'directional cinematic light', 'clean commercial light']);
  const references = normalizeSourceList(taskSpec.reference_images || taskSpec.references, taskBaseDir);
  const masks = normalizeSourceList(taskSpec.masks || taskSpec.mask_images, taskBaseDir);

  return Array.from({ length: total }, (_, index) => {
    const ordinal = index + 1;
    const scene = pick(scenes, index, 'clean studio scene');
    const wardrobe = pick(wardrobes, index, 'refined wardrobe');
    const composition = pick(compositions, index, 'vertical poster composition');
    const lighting = pick(lightingPool, index, 'soft premium light');
    const styleFamily = styleFamilyAt(promptStrategy, index, taskId);
    const promptParts = [
      outputMode,
      brief,
      `scene: ${scene}`,
      `styling: ${wardrobe}`,
      `lighting: ${lighting}`,
      `composition: ${composition}`,
      styleRequirements ? `style requirements: ${styleRequirements}` : '',
      variationRequirements ? `variation requirement: ${variationRequirements}` : '',
      `text policy: ${textPolicy}`,
      'high quality, coherent subject, polished production-ready image',
    ].filter(Boolean);
    const item = {
      index: ordinal,
      slug: `${taskId}-${String(ordinal).padStart(3, '0')}`,
      title: `${brief} ${String(ordinal).padStart(3, '0')}`,
      style_family: styleFamily,
      scene,
      wardrobe,
      lighting,
      mood: normalizeText(taskSpec.mood || promptStrategy.mood, 'clean, controlled, polished'),
      composition,
      text_policy: textPolicy,
      negative_prompt: negative,
      generation_prompt: promptParts.join(', '),
      source_refs: toArray(taskSpec.source_files).map((source) => (typeof source === 'string' ? source : source.path || source.file)).filter(Boolean),
    };
    if (references.length) item.reference_images = references;
    if (masks.length) item.mask_image = masks[index % masks.length];
    if (item.mask_image && references.length) item.reference_mode = 'masked-edit';
    if (!item.mask_image && references.length) item.reference_mode = 'reference-assisted';
    return item;
  });
}

module.exports = { buildGeneratedPrompts };
