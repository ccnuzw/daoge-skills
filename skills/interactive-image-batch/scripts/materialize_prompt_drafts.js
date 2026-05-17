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

function ensureSentence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function ensureList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function ensureObjectList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : [];
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length) return value;
    if (value !== undefined && value !== null && String(value).trim() !== '') return value;
  }
  return null;
}

function pushIf(parts, value) {
  const sentence = ensureSentence(value);
  if (sentence) parts.push(sentence);
}

function sectionLabel(section) {
  const labels = {
    subject_baseline: 'Subject',
    campaign_intent: 'Campaign intent',
    scene_hierarchy: 'Scene hierarchy',
    wardrobe_product_focus: 'Wardrobe and product focus',
    pose_expression: 'Pose and expression',
    lighting_palette: 'Lighting and palette',
    composition_layout: 'Composition and layout',
    typography_safe_area: 'Typography safe area',
    commercial_finish: 'Commercial finish',
    studio_setup: 'Studio setup',
    wardrobe_material: 'Wardrobe material',
    lighting_control: 'Lighting control',
    editorial_finish: 'Editorial finish',
    product_readability: 'Product readability',
    clean_scene: 'Clean scene',
    series_context: 'Series context',
    lookbook_consistency: 'Lookbook consistency',
    portrait_intent: 'Portrait intent',
    edit_goal: 'Edit goal',
    preserve_rules: 'Preserve rules',
    change_boundary: 'Change boundary',
    target_scene_style: 'Target scene style',
    consistency_rules: 'Consistency rules',
    quality_constraints: 'Quality constraints',
    story_beat: 'Story beat',
    camera_language: 'Camera language',
    continuity_rules: 'Continuity rules',
    grid_role: 'Grid role',
    series_consistency: 'Series consistency',
    ad_test_hypothesis: 'Ad test hypothesis',
    controlled_variables: 'Controlled variables',
    detail_page_role: 'Detail page role',
  };
  return labels[section] || String(section || '').replace(/_/g, ' ');
}

function hashSeed(...values) {
  const text = values.filter(Boolean).join('|');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function pick(pool, seed, offset = 0) {
  if (!pool.length) return null;
  return pool[(seed + offset) % pool.length];
}

const HUMAN_FAMILY_TRAITS = {
  'just-woke-up': {
    descriptor: 'luxury intimate morning campaign direction',
    gesture: ['natural overhead stretch', 'barefoot pause beside the bed', 'slow turn toward the window', 'soft weight shift with relaxed shoulders'],
    eye_language: ['sleepy direct gaze', 'calm reflective gaze', 'quiet just-awake expression', 'soft composed eye contact'],
    candidness: ['fleeting unposed campaign moment', 'controlled candid stillness', 'natural in-between movement', 'restrained editorial spontaneity'],
    lighting: ['soft morning window light with gentle rim', 'clean side light with subtle shoulder contour', 'diffused daylight with lifted whites', 'backlit morning glow with refined skin texture'],
    palette: ['ivory white, soft skin, pale taupe accents', 'clean white, black, and warm skin contrast', 'muted cream and cool grey neutrals', 'white studio neutrals with soft matte blacks'],
    mood: ['expensive, restrained, calm', 'clean, premium, intimate', 'quiet confidence with soft luxury', 'minimal and elevated campaign polish'],
  },
  'casual-candid': {
    descriptor: 'premium lifestyle campaign direction',
    gesture: ['walking glance back over the shoulder', 'one hand brushing hair away', 'casual lean into the doorway', 'mid-step movement with relaxed posture'],
    eye_language: ['brief direct glance', 'cool detached gaze', 'playful but controlled eye contact', 'natural observational expression'],
    candidness: ['captured between movements', 'editorial off-guard realism', 'casual premium spontaneity', 'lived-in campaign naturalism'],
    lighting: ['window light with soft contrast', 'ambient daylight with clean skin highlights', 'mixed natural interior light with subtle contour', 'diffused side light with polished contrast'],
    palette: ['warm neutrals with black accents', 'cream walls with soft graphite contrast', 'beige, ivory, and muted charcoal', 'light stone interiors with crisp monochrome styling'],
    mood: ['effortless, expensive, controlled', 'casual luxury with cool restraint', 'easy confidence and premium ease', 'refined everyday editorial energy'],
  },
  'looking-back': {
    descriptor: 'cinematic fashion-poster direction',
    gesture: ['turn-back stance with a long body line', 'half-step turn with shoulder reveal', 'paused stride and backward glance', 'rotational pose emphasizing waist and back line'],
    eye_language: ['direct over-shoulder gaze', 'cold measured eye contact', 'quiet magnetic stare', 'composed luxury-brand intensity'],
    candidness: ['posed to feel instant and alive', 'campaign-controlled spontaneity', 'fashion-editorial precision with natural tension', 'cinematic in-between movement'],
    lighting: ['single-side contour light with soft fill', 'controlled rim light across shoulders and waist', 'cool-warm mixed light with sculpted depth', 'clean highlight edge with balanced face exposure'],
    palette: ['monochrome black, white, and skin tone', 'cool neutrals with matte black contrast', 'white architectural backdrop with graphite accents', 'silver-grey neutrals and warm skin balance'],
    mood: ['calm, expensive, powerful', 'restrained magnetism with editorial tension', 'high-end poise and cool control', 'international campaign sharpness'],
  },
  default: {
    descriptor: 'premium commercial fashion campaign direction',
    gesture: ['relaxed full-body pose', 'controlled standing pose', 'soft shift in body weight', 'editorial natural stance'],
    eye_language: ['direct camera gaze', 'calm composed expression', 'soft premium eye contact', 'measured editorial gaze'],
    candidness: ['polished campaign naturalism', 'controlled candid energy', 'clean premium stillness', 'editorial spontaneity'],
    lighting: ['soft premium studio light', 'clean directional daylight', 'diffused contour light', 'balanced commercial portrait light'],
    palette: ['clean neutrals and skin tones', 'white, black, and warm skin contrast', 'soft stone neutrals', 'matte monochrome neutrals'],
    mood: ['premium and restrained', 'clean expensive polish', 'quiet fashion confidence', 'editorial calm'],
  },
};

const GRAPHIC_TRAITS = {
  descriptor: 'premium graphic instruction-poster direction',
  layoutEmphasis: ['modular dashboard hierarchy', 'clear instructional card rhythm', 'strong title block with guide rails', 'high-clarity poster information architecture'],
  signalEmphasis: ['bold section badges and numbered cards', 'workflow arrows and matrix connectors', 'control chips, icons, and parameter dials', 'result-hub style summary modules'],
  lighting: ['clean luminous product lighting', 'bright studio-lit interface surfaces', 'soft white panel lighting with crisp edge contrast', 'controlled glossy highlights on interface modules'],
  palette: ['orange, ivory white, and graphite black brand palette', 'warm white panels with restrained orange accents', 'high-contrast monochrome base with hardware orange highlights', 'clean ivory UI surfaces with charcoal framing'],
  mood: ['precise and instructional', 'productized and reliable', 'engineered visual clarity', 'premium branded tutorial energy'],
};

const PRODUCT_TRAITS = {
  descriptor: 'premium product-visual direction',
  layoutEmphasis: ['product-first hierarchy with supporting info zones', 'clear hero product area and secondary benefit blocks', 'controlled detail-view rhythm', 'clean ecommerce-ready poster structure'],
  signalEmphasis: ['material detail emphasis', 'shape readability and product silhouette clarity', 'benefit callout zones', 'supporting schematic or badge markers'],
  lighting: ['clean commercial softbox light', 'material-readable highlights', 'balanced studio product lighting', 'controlled reflections with clear edge detail'],
  palette: ['clean neutrals with premium accent color', 'ivory, charcoal, and product-tone balance', 'soft commercial whites with crisp contrast', 'muted premium retail palette'],
  mood: ['clear and commercial', 'premium and readable', 'product-led confidence', 'precise conversion-oriented polish'],
};

const STORYBOARD_TRAITS = {
  descriptor: 'cinematic storyboard frame for a premium commercial sequence',
  layoutEmphasis: ['left info panel, six-shot grid, bottom KV', 'clear grid hierarchy with board-wide continuity', 'reserved safe zones for brand lockup', 'each frame reads as one commercial beat'],
  signalEmphasis: ['product integrity', 'steam layers', 'packaging hierarchy', 'logo clarity', 'gesture continuity', 'shot-to-shot transition'],
  lighting: ['warm side backlight with layered steam', 'dark luxury food lighting with rim highlights', 'cinematic practical glow with deep contrast'],
  palette: ['deep green, orange gold, vermilion, and warm black', 'kitchen-dark premium tones with controlled highlights', 'brand-consistent food advertising palette'],
  mood: ['board-consistent premium food advertising', 'cinematic continuity with editorial restraint', 'high-end storyboard sequence'],
};

const SCENE_ANCHORS = {
  'bedroom morning light': ['white sheets, sheer curtains, and soft linen textures', 'sunlit bedding, pale walls, and quiet hotel-grade styling', 'crisp white bedding and an airy morning window edge'],
  'designer kitchen': ['stone island, brushed metal accents, and clean architectural lines', 'minimal cabinetry, matte surfaces, and bright luxury-residence details', 'sleek counters, quiet reflections, and restrained interior styling'],
  'window after rain': ['soft city haze on glass and reflective window highlights', 'rain-marked glass, cool daylight, and polished floor reflections', 'wet window texture, muted exterior blur, and clean interior edges'],
  'hotel bathroom': ['stone surfaces, mirror glow, and elevated spa-hotel finishes', 'soft marble textures, clean mirrors, and luxury bathroom geometry', 'muted stone walls, chrome details, and controlled reflections'],
  doorway: ['architectural doorframe, long wall lines, and clean transition light', 'minimal threshold, shadow bands, and quiet residential geometry', 'framed corridor depth and polished interior surfaces'],
  stairs: ['linear stair geometry, long perspective, and clean handrail lines', 'architectural steps, quiet shadow rhythm, and editorial interior depth', 'structured stair backdrop with crisp modern lines'],
};

const COMPOSITION_DETAILS = {
  'full-body 9:16 poster': 'head-to-toe vertical framing, subject dominant in frame, with reserved clean space for future typography',
  'full-body by window': 'vertical full-body framing near the window line, with strong negative space and long body proportions',
  'walking turn-back pose': 'vertical fashion-poster framing that preserves the full figure while emphasizing motion and the turn-back silhouette',
};

const GRADE_DETAILS = {
  S: 'softest purity expression with elegant restraint',
  A: 'balanced sensual-commercial tension with premium control',
  B: 'slightly bolder fashion-poster energy while staying upscale',
};

const MOTION_CUES = ['subtle fabric pull across the waist', 'clean shoulder line emphasis', 'soft leg-line extension', 'gentle torso twist', 'quiet collarbone highlight', 'controlled hip-line angle', 'light shirt-drape movement'];
const TEXTURE_CUES = ['matte fabric texture clearly visible', 'skin texture refined but natural', 'premium knit detail preserved', 'clean seam lines and tailored edges', 'soft textile grain with luxury finish', 'crisp material contrast without gloss'];
const POSTER_CUES = ['international brand-key-visual polish', 'hero image clarity suited for a launch poster', 'co-branded campaign readiness without rendered text', 'editorial poster finish with strong hierarchy space', 'luxury master-KV stillness'];
const EDITORIAL_NUANCES = ['clean ankle line visibility', 'long neck-and-shoulder silhouette', 'quiet fingertip relaxation', 'balanced headroom for title lockup', 'refined waist-to-hip transition', 'clear fabric fall around the thighs', 'subtle stance asymmetry', 'elevated posture with relaxed jawline', 'controlled toe-line extension', 'polished hand placement away from the torso', 'soft breathing-space around the figure'];

function buildCorpus(item) {
  return [
    item.title,
    item.slug,
    item.style_family,
    item.scene,
    item.scene_anchor,
    item.wardrobe,
    item.composition,
    item.text_policy,
    item.daoge_template_id,
    item.daoge_template_name,
    item.template_category,
    item.notes,
  ].filter(Boolean).join(' ').toLowerCase();
}

function assetMode(item) {
  if (item.asset_mode) return String(item.asset_mode).trim().toLowerCase();
  if (item.board_id || item.slot_id || item.layout_region_id || item.slot_role) return 'storyboard';
  if (item.subject_type) return String(item.subject_type).trim().toLowerCase();
  const corpus = buildCorpus(item);
  const humanSignals = ['full-body', 'head-to-toe', 'female model', 'fashion model', 'portrait', 'lingerie', 'gaze', 'pose', 'waist', 'shoulder', 'skin texture'];
  const graphicSignals = ['dashboard', 'console', 'ui', 'interface', 'manual', 'tutorial', 'workflow', 'matrix', 'engine', 'control panel', 'schematic', 'icon set', 'infographic', 'operator'];
  const productSignals = ['product image', 'packaging', 'bottle', 'device', 'detail page', 'material close detail', 'benefit breakdown', 'ecommerce'];
  if (item.eye_language || item.candidness || item.gesture || item.exposure_signal) return 'human';
  if (humanSignals.some((signal) => corpus.includes(signal))) return 'human';
  if (graphicSignals.some((signal) => corpus.includes(signal))) return 'graphic';
  if (productSignals.some((signal) => corpus.includes(signal))) return 'product';
  if (['portrait-kv', 'studio-editorial', 'lookbook'].includes(String(item.daoge_template_id || '').trim())) return 'human';
  if (String(item.daoge_template_id || '').trim() === 'detail-page-set') return 'product';
  return 'generic';
}

function traitSetFor(item, mode) {
  if (mode === 'storyboard') return STORYBOARD_TRAITS;
  if (mode === 'human') {
    const familyKey = String(item.style_family || '').trim().toLowerCase();
    return HUMAN_FAMILY_TRAITS[familyKey] || HUMAN_FAMILY_TRAITS.default;
  }
  if (mode === 'graphic') return GRAPHIC_TRAITS;
  if (mode === 'product') return PRODUCT_TRAITS;
  return GRAPHIC_TRAITS;
}

function baseSubject(item, mode, traits) {
  if (mode === 'storyboard') {
    return `Premium storyboard board frame, ${traits.descriptor}`;
  }
  if (mode === 'human') {
    return `Adult East Asian female fashion model, photoreal premium commercial poster, ${traits.descriptor}`;
  }
  if (mode === 'product') {
    return `Premium commercial product visual, ${traits.descriptor}`;
  }
  if (mode === 'graphic') {
    return `Premium branded graphic system poster, ${traits.descriptor}`;
  }
  const familyKey = String(item.style_family || '').trim().toLowerCase();
  return `Premium visual asset, ${familyKey || 'branded visual direction'}`;
}

function deriveField(item, field, fallbackPool, seed, offset = 0) {
  if (item[field] !== undefined && item[field] !== null && String(item[field]).trim() !== '') {
    return item[field];
  }
  return pick(fallbackPool, seed, offset);
}

function variantAxisSummary(item) {
  return ensureObjectList(item.variant_axes)
    .map((axis) => {
      const label = axis.axis || axis.field;
      const value = axis.value || axis.option;
      return label && value ? `${label}: ${value}` : null;
    })
    .filter(Boolean);
}

function storyboardSummary(label, items) {
  const list = ensureList(items);
  if (!list.length) return '';
  return `${label}: ${list.join('; ')}`;
}

function buildDraftPrompt(item) {
  const mode = assetMode(item);
  const traits = traitSetFor(item, mode);
  const seed = hashSeed(item.index, item.slug, item.style_family, item.scene, item.wardrobe, item.composition);
  const sceneAnchor = firstNonEmpty(item.scene_anchor, pick(SCENE_ANCHORS[String(item.scene || '').trim()] || [], seed, 1));
  const gesture = mode === 'human' ? deriveField(item, 'gesture', traits.gesture, seed, 0) : null;
  const exposureSignal = mode === 'human' ? (item.exposure_signal || pick(MOTION_CUES, seed, 2)) : pick(traits.signalEmphasis || [], seed, 2);
  const eyeLanguage = mode === 'human' ? deriveField(item, 'eye_language', traits.eye_language, seed, 1) : null;
  const candidness = mode === 'human' ? deriveField(item, 'candidness', traits.candidness, seed, 2) : null;
  const lighting = deriveField(item, 'lighting', traits.lighting, seed, 3);
  const palette = firstNonEmpty(item.palette, pick(traits.palette, seed, 4));
  const mood = firstNonEmpty(item.mood, pick(traits.mood, seed, 5));
  const composition = firstNonEmpty(item.composition, item.camera, pick(Object.values(COMPOSITION_DETAILS), seed, 0));
  const compositionDetail = COMPOSITION_DETAILS[String(item.composition || item.camera || '').trim()] || null;
  const gradeDetail = item.purity_grade ? GRADE_DETAILS[String(item.purity_grade).trim()] : null;
  const textureCue = pick(TEXTURE_CUES, seed, 6);
  const posterCue = pick(POSTER_CUES, seed, 7);
  const editorialNuance = mode === 'human'
    ? pick(EDITORIAL_NUANCES, Number(item.index || 0), seed % EDITORIAL_NUANCES.length)
    : pick(traits.layoutEmphasis || [], Number(item.index || 0), seed % Math.max((traits.layoutEmphasis || []).length, 1));
  const templateSections = ensureList(item.template_prompt_sections);
  const qualityRule = pick(ensureList(item.template_quality_rules), seed, 8);
  const compositionBias = pick(ensureList(item.template_composition_bias), seed, 9);
  const templateName = item.daoge_template_name || item.template_name;
  const variantSummary = variantAxisSummary(item);
  const storyBeat = firstNonEmpty(item.story_beat, item.narrative_beat, pick(['opening hook', 'desire moment', 'product reveal', 'emotional turn', 'closing hero frame'], seed, 10));
  const cameraLanguage = firstNonEmpty(item.camera_language, item.lens_language, item.camera, item.composition);
  const gridRole = firstNonEmpty(item.grid_role, item.content_role, pick(['cover tile', 'detail tile', 'mood tile', 'product-benefit tile', 'lifestyle tile'], seed, 11));
  const adHypothesis = firstNonEmpty(item.ad_test_hypothesis, item.test_variable, item.value_proposition, pick(['test premium restraint versus stronger product clarity', 'test scene-led desire versus product-led readability', 'test direct gaze versus candid movement'], seed, 12));
  const controlledVariables = firstNonEmpty(item.controlled_variables, variantSummary.length ? variantSummary.join('; ') : null);
  const detailPageRole = firstNonEmpty(item.detail_page_role, item.product_role, pick(['hero product image', 'material close detail', 'fit demonstration', 'lifestyle use case', 'benefit breakdown image'], seed, 13));
  const nonHumanFocus = firstNonEmpty(item.signal_emphasis, exposureSignal, pick(traits.signalEmphasis || [], seed, 14));
  const nonHumanLayout = firstNonEmpty(item.layout_emphasis, editorialNuance, pick(traits.layoutEmphasis || [], seed, 15));
  const referenceNotes = storyboardSummary('Reference intent', item.reference_notes);
  const promptHints = storyboardSummary('Shot hints', item.prompt_hints);
  const continuityNotes = storyboardSummary('Continuity', item.continuity_notes);
  const visualElements = storyboardSummary('Visual elements', item.visual_elements);
  const motionNote = firstNonEmpty(item.camera_move, item.camera_language);
  const voiceoverNote = item.voiceover ? `Voiceover mood: ${item.voiceover}` : '';

  const sectionValues = {
    subject_baseline: baseSubject(item, mode, traits),
    campaign_intent: templateName ? `${templateName} direction, brand key visual for a premium campaign, no rendered text or real logo` : 'premium campaign key visual, no rendered text or real logo',
    scene_hierarchy: [
      item.scene ? `Scene: ${item.scene}` : '',
      sceneAnchor ? `Scene anchor: ${ensureList(sceneAnchor).join(', ')}` : '',
    ].filter(Boolean).join('. '),
    wardrobe_product_focus: item.wardrobe ? `Wardrobe/product: ${item.wardrobe}; ${textureCue}; keep product shape and fabric detail readable` : textureCue,
    pose_expression: mode === 'human'
      ? [
        gesture ? `Pose and body line: ${gesture}` : '',
        exposureSignal ? `Subtle emphasis: ${exposureSignal}` : '',
        eyeLanguage ? `Eye language: ${eyeLanguage}` : '',
        candidness ? `Moment quality: ${candidness}` : '',
      ].filter(Boolean).join('. ')
      : [
        nonHumanFocus ? `Visual emphasis: ${nonHumanFocus}` : '',
        nonHumanLayout ? `Layout rhythm: ${nonHumanLayout}` : '',
      ].filter(Boolean).join('. '),
    lighting_palette: [
      lighting ? `Lighting: ${lighting}` : '',
      palette ? `Palette: ${ensureList(palette).join(', ')}` : '',
      mood ? `Mood: ${ensureList(mood).join(', ')}` : '',
    ].filter(Boolean).join('. '),
    composition_layout: [
      compositionDetail ? `Composition detail: ${compositionDetail}` : '',
      composition ? `Framing: ${composition}` : '',
      compositionBias || '',
    ].filter(Boolean).join('. '),
    typography_safe_area: item.text_policy ? `Text policy: ${item.text_policy}; leave clean layout-safe negative space, do not generate readable typography` : 'leave clean layout-safe negative space, do not generate readable typography',
    commercial_finish: [posterCue, qualityRule, editorialNuance, voiceoverNote, mode !== 'human' ? nonHumanLayout : null].filter(Boolean).join('. '),
    story_beat: [storyBeat, promptHints, visualElements, 'visible narrative progression, one clear moment in the sequence'].filter(Boolean).join('. '),
    camera_language: cameraLanguage ? `Camera language: ${cameraLanguage}; ${motionNote || 'precise shot scale, angle, and visual rhythm'}` : '',
    continuity_rules: [controlledVariables, continuityNotes, referenceNotes, 'keep character, palette, scene logic, and wardrobe continuity across the sequence'].filter(Boolean).join('. '),
    grid_role: `${gridRole}; this image must work as a distinct tile in a coherent social feed`,
    series_consistency: [controlledVariables, 'consistent palette and brand system while preserving tile-level variation'].filter(Boolean).join('. '),
    ad_test_hypothesis: `${adHypothesis}; isolate one creative variable and keep the baseline stable`,
    controlled_variables: controlledVariables || 'keep subject, product, visual quality, and layout baseline stable',
    detail_page_role: `${detailPageRole}; clear ecommerce information hierarchy for later layout`,
    studio_setup: item.scene ? `Controlled studio setup: ${item.scene}; ${sceneAnchor || 'clean premium backdrop'}` : sceneAnchor,
    wardrobe_material: item.wardrobe ? `Wardrobe material: ${item.wardrobe}; ${textureCue}` : textureCue,
    lighting_control: lighting ? `Lighting control: ${lighting}; refined skin texture and controlled contour` : '',
    editorial_finish: [posterCue, editorialNuance, mood].filter(Boolean).join('. '),
    product_readability: item.wardrobe ? `Product readability: ${item.wardrobe}; clear structure, seams, fit, and material finish` : textureCue,
    clean_scene: item.scene ? `Clean scene: ${item.scene}; no distracting props, ${sceneAnchor || 'simple premium environment'}` : '',
    series_context: `Series image ${item.index || ''}, ${item.style_family || 'coherent style family'}, preserve consistent camera language with controlled variation`,
    lookbook_consistency: [compositionBias, 'wardrobe remains readable and consistent with the series system'].filter(Boolean).join('. '),
    portrait_intent: `Face-led premium key visual, ${eyeLanguage || 'composed direct gaze'}, ${mood || 'controlled luxury mood'}`,
    edit_goal: 'Image edit target: apply the requested change while keeping the original subject structure coherent',
    preserve_rules: 'Preserve rules: keep unchanged areas stable, avoid identity drift unless explicitly requested',
    change_boundary: item.scene || item.wardrobe ? `Change boundary: apply only the requested scene or wardrobe changes: ${[item.scene, item.wardrobe].filter(Boolean).join(', ')}` : '',
    target_scene_style: [sceneAnchor, lighting, palette].filter(Boolean).join('. '),
    consistency_rules: 'Consistency rules: edited light, perspective, fabric texture, and anatomy must blend naturally',
    quality_constraints: [qualityRule, 'clean edit boundary, no visible artifacts'].filter(Boolean).join('. '),
  };

  if (templateSections.length) {
    const templatedParts = [];
    for (const section of templateSections) {
      const value = sectionValues[section];
      if (value) pushIf(templatedParts, `${sectionLabel(section)}: ${value}`);
    }
    if (templatedParts.length) return templatedParts.join(' ');
  }

  const parts = [];
  pushIf(parts, baseSubject(item, mode, traits));
  pushIf(parts, item.camera || item.composition);
  pushIf(parts, item.scene ? `Scene: ${item.scene}` : '');
  pushIf(parts, sceneAnchor ? `Scene anchor: ${ensureList(sceneAnchor).join(', ')}` : '');
  pushIf(parts, item.wardrobe ? `Wardrobe: ${item.wardrobe}` : '');
  pushIf(parts, mode === 'human' && gesture ? `Pose and body line: ${gesture}` : '');
  pushIf(parts, mode === 'human' && exposureSignal ? `Subtle emphasis: ${exposureSignal}` : '');
  pushIf(parts, mode === 'human' && eyeLanguage ? `Eye language: ${eyeLanguage}` : '');
  pushIf(parts, mode === 'human' && candidness ? `Moment quality: ${candidness}` : '');
  pushIf(parts, mode !== 'human' && nonHumanFocus ? `Visual emphasis: ${nonHumanFocus}` : '');
  pushIf(parts, mode !== 'human' && nonHumanLayout ? `Layout rhythm: ${nonHumanLayout}` : '');
  pushIf(parts, lighting ? `Lighting: ${lighting}` : '');
  pushIf(parts, palette ? `Palette: ${ensureList(palette).join(', ')}` : '');
  pushIf(parts, mood ? `Mood: ${ensureList(mood).join(', ')}` : '');
  pushIf(parts, gradeDetail ? `Intensity: ${gradeDetail}` : '');
  pushIf(parts, promptHints);
  pushIf(parts, visualElements);
  pushIf(parts, continuityNotes);
  pushIf(parts, referenceNotes);
  pushIf(parts, mode === 'human' && textureCue ? `Material cue: ${textureCue}` : '');
  pushIf(parts, editorialNuance ? `Editorial nuance: ${editorialNuance}` : '');
  pushIf(parts, compositionDetail ? `Composition detail: ${compositionDetail}` : '');
  pushIf(parts, composition ? `Poster framing: ${composition}` : '');
  pushIf(parts, motionNote ? `Camera movement: ${motionNote}` : '');
  pushIf(parts, voiceoverNote);
  pushIf(parts, posterCue ? `Poster finish: ${posterCue}` : '');
  pushIf(parts, item.text_policy ? `Text policy: ${item.text_policy}` : '');
  pushIf(parts, variantSummary.length ? `Variant matrix: ${variantSummary.join('; ')}` : '');
  return parts.join(' ');
}

function buildDraftNegative(item) {
  const base = [];
  if (item.negative_prompt) base.push(String(item.negative_prompt).trim());
  if (ensureList(item.template_default_negative_terms).length) base.push(ensureList(item.template_default_negative_terms).join(', '));
  base.push('watermark, readable text, fake logo, extra fingers, malformed hands, extra limbs, distorted anatomy');
  return Array.from(new Set(base.join(', ').split(',').map((item) => item.trim()).filter(Boolean))).join(', ');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['slots-file']) throw new Error('Missing required flag: --slots-file');

  const slotsFile = path.resolve(args['slots-file']);
  const slots = JSON.parse(fs.readFileSync(slotsFile, 'utf8'));
  if (!Array.isArray(slots)) throw new Error(`Slots file must be a JSON array: ${slotsFile}`);

  const drafts = slots.map((item) => ({
    ...item,
    generation_prompt: buildDraftPrompt(item),
    negative_prompt: buildDraftNegative(item),
  }));

  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(slotsFile), 'prompt_draft_bundle.json'));
  fs.writeFileSync(outputPath, JSON.stringify(drafts, null, 2));
  console.log(JSON.stringify({ outputPath, promptCount: drafts.length }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
