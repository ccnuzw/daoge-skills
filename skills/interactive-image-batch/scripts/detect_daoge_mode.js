const fs = require('fs');
const path = require('path');
const { parseArgs, readJson } = require('./script_utils');

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

function candidateCategoriesForMode(mode, taskSpec, strategy) {
  const outputSignals = [
    taskSpec.content_brief,
    taskSpec.output_mode,
    strategy.output_mode,
    ...(taskSpec.style_requirements || []),
    ...(taskSpec.variation_requirements || []),
  ].filter(Boolean).join(' ').toLowerCase();

  if (mode === 'storyboard-board' || mode === 'storyboard-image-edit') return new Set(['cinematic-sequences']);
  if (mode === 'image-edit') return new Set(['editing-workflows']);
  if (/(图像编辑|编辑任务|修图|改图|局部修正|局部编辑|background replacement|localized fix|style alignment edit|image edit|edit boundary|tone correction)/i.test(outputSignals)) {
    return new Set(['editing-workflows']);
  }
  if (/(map|city map|route map|travel route|itinerary map|distribution map|food map|地图|路线图|导览图|分布图|行程图)/i.test(outputSignals)) {
    return new Set(['maps']);
  }
  if (/(typography poster|type layout|bilingual layout|title-safe poster|headline poster|排版海报|双语排版|文字海报|标题海报)/i.test(outputSignals)) {
    return new Set(['typography-and-text-layout']);
  }
  if (/(asset sheet|prop sheet|skeuomorphic icons|game screenshot mockup|icon set|资产道具板|道具板|拟物图标|图标板|资产板)/i.test(outputSignals)) {
    return new Set(['assets-and-props']);
  }
  if (/(academic figure|academic|research poster|graphical abstract|mechanism diagram|publication chart|scientific schematic|学术图|论文图|机制图|研究海报)/i.test(outputSignals)) {
    return new Set(['academic-figures']);
  }
  if (/(branding|brand board|brand identity|packaging|package design|label design|mascot|merch|包装|包装板|品牌板|品牌系统|标签设计|周边板)/i.test(outputSignals)) {
    return new Set(['branding-and-packaging']);
  }
  if (/(illustrated scene|concept scene|healing scene|picture-book|storybook|mood scene|插画场景|绘本场景|治愈场景|情绪场景|概念场景)/i.test(outputSignals)) {
    return new Set(['scenes-and-illustrations']);
  }
  if (/(avatar|头像|贴纸|sticker|selfie|角色头像|icon portrait|profile pic|profile picture|social profile|chat avatar|chat profile|creator profile)/i.test(outputSignals)) {
    return new Set(['avatars-and-profile']);
  }
  if (/(slide|slides|幻灯页|汇报页|visual report|report page|policy slide|explainer slide)/i.test(outputSignals)) {
    return new Set(['slides-and-visual-docs']);
  }
  if (/(infographic|信息图|对比图|步骤图|数据看板|kpi|bento|图例)/i.test(outputSignals)) {
    return new Set(['infographics']);
  }
  if (/(架构图|technical diagram|system architecture|flowchart|sequence diagram|拓扑图|er diagram|状态机|mind map)/i.test(outputSignals)) {
    return new Set(['technical-diagrams']);
  }
  if (/(?:\bui\b|界面|mockup|(?:^|[^a-z])app(?:[^a-z]|$)|(?:^|[^a-z])web(?:[^a-z]|$)|landing page|dashboard|直播界面|界面稿|产品卡片|chat interface)/i.test(outputSignals)) {
    return new Set(['ui-mockups']);
  }
  if (/(lookbook|造型册|系列 lookbook|collection look|系列服装|款式轮换|章节式 lookbook|封面加稳定展示)/i.test(outputSignals)) {
    return new Set(['grids-and-collages']);
  }
  if (/(详情页|卖点|产品组图|detail page|product)/i.test(outputSignals)) return new Set(['product-visuals']);
  if (/(肖像|半身|portrait|close-up|studio|editorial)/i.test(outputSignals)) return new Set(['portraits-and-characters']);
  if (/(九宫格|社媒|instagram|feed|social)/i.test(outputSignals)) return new Set(['social-campaigns', 'grids-and-collages']);
  if (/(a\/b|ab test|投放|素材测试|转化)/i.test(outputSignals)) return new Set(['performance-creatives']);
  if (/(海报|广告|主视觉|campaign|poster|kv)/i.test(outputSignals)) return new Set(['poster-and-campaigns']);
  return null;
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

function detectTemplate(registry, corpus, options = {}) {
  const allowedCategories = options.allowedCategories;
  const pool = (registry.templates || []).filter((template) => {
    if (!allowedCategories || !allowedCategories.size) return true;
    return allowedCategories.has(String(template.category || '').trim());
  });
  const scored = pool.map((template) => ({
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
  const mode = detectMode(taskSpec);
  const allowedCategories = candidateCategoriesForMode(mode, taskSpec, strategy);
  const template = detectTemplate(registry, corpus, { allowedCategories });

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
