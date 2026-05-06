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

function parseNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function getPromptText(item) {
  return String(item.generation_prompt || item.prompt || '').trim();
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key];
    const label = value === undefined || value === null || value === '' ? '(missing)' : String(value).trim();
    counts[label] = (counts[label] || 0) + 1;
  }
  return counts;
}

function topCounts(counts, limit = 10) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function ensureArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map((item) => String(item).trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  const normalized = normalizeText(value);
  const tokens = [];
  const matches = normalized.match(/[\p{Script=Han}]{2,}|[\p{L}\p{N}]{3,}/gu) || [];
  for (const match of matches) {
    if (/^[\p{Script=Han}]+$/u.test(match)) {
      for (let i = 0; i < match.length - 1; i += 1) {
        tokens.push(match.slice(i, i + 2));
      }
      if (match.length === 2) tokens.push(match);
    } else {
      tokens.push(match);
    }
  }
  return tokens;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function hasAny(text, terms) {
  const haystack = normalizeText(text);
  return terms.some((term) => haystack.includes(normalizeText(term)));
}

function parseSize(value) {
  if (!value || !/^\d+x\d+$/.test(String(value))) return null;
  const [width, height] = String(value).split('x').map(Number);
  return { width, height };
}

function effectiveItemSize(item, taskSpec) {
  const params = item.params || {};
  if (params.size) return parseSize(params.size);
  const width = Number(params.width || taskSpec?.width);
  const height = Number(params.height || taskSpec?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width, height };
}

function buildQualityGates(prompts, taskSpec, args) {
  const strict = parseBoolean(args.strict, false);
  const promptTokenSets = prompts.map((item) => new Set(tokenize(getPromptText(item))));
  const promptLengths = prompts.map((item) => getPromptText(item).length);
  const shortPromptThreshold = Math.max(80, Math.floor(parseNumber(args['min-prompt-chars'], 180)));
  const nearDuplicateThreshold = Math.min(0.98, Math.max(0.65, parseNumber(args['near-duplicate-threshold'], 0.86)));
  const nearDuplicatePairs = [];

  for (let i = 0; i < promptTokenSets.length; i += 1) {
    for (let j = i + 1; j < promptTokenSets.length; j += 1) {
      const score = jaccard(promptTokenSets[i], promptTokenSets[j]);
      if (score >= nearDuplicateThreshold) {
        nearDuplicatePairs.push({
          left: prompts[i].index ?? i + 1,
          right: prompts[j].index ?? j + 1,
          score: Number(score.toFixed(3)),
        });
        if (nearDuplicatePairs.length >= 50) break;
      }
    }
    if (nearDuplicatePairs.length >= 50) break;
  }

  const shortPrompts = prompts
    .filter((item, index) => promptLengths[index] < shortPromptThreshold)
    .map((item, index) => ({
      index: item.index ?? index + 1,
      chars: getPromptText(item).length,
    }))
    .slice(0, 30);

  const templateMissing = {};
  prompts.forEach((item) => {
    ensureArray(item.template_required_slot_fields).forEach((field) => {
      if (item[field] === undefined || item[field] === null || String(item[field]).trim() === '') {
        templateMissing[field] = (templateMissing[field] || 0) + 1;
      }
    });
  });

  const commercialTerms = ['poster', 'campaign', 'key visual', 'kv', '海报', '广告', '主视觉'];
  const fullBodyTerms = ['full-body', 'head-to-toe', '全身'];
  const textSafeTerms = ['negative space', 'typography', 'text policy', '留白', '文字'];
  const sceneTerms = ['scene', 'background', 'environment', 'interior', '场景'];

  const campaignPosterItems = prompts.filter((item) => item.daoge_template_id === 'campaign-poster');
  const campaignPosterIssues = {
    missingCampaignIntent: campaignPosterItems.filter((item) => !hasAny(getPromptText(item), commercialTerms)).map((item) => item.index).slice(0, 30),
    missingFullBodySignal: campaignPosterItems.filter((item) => !hasAny(`${getPromptText(item)} ${item.composition || ''}`, fullBodyTerms)).map((item) => item.index).slice(0, 30),
    missingTextSafeSignal: campaignPosterItems.filter((item) => !hasAny(`${getPromptText(item)} ${item.text_policy || ''}`, textSafeTerms)).map((item) => item.index).slice(0, 30),
    missingSceneSignal: campaignPosterItems.filter((item) => !hasAny(`${getPromptText(item)} ${item.scene || ''} ${item.scene_anchor || ''}`, sceneTerms)).map((item) => item.index).slice(0, 30),
  };

  const sizeIssues = [];
  prompts.forEach((item, index) => {
    const size = effectiveItemSize(item, taskSpec);
    if (!size) return;
    if (size.width % 16 !== 0 || size.height % 16 !== 0) {
      sizeIssues.push({
        index: item.index ?? index + 1,
        size: `${size.width}x${size.height}`,
        issue: 'width and height must be multiples of 16',
      });
    }
  });

  const warnings = [];
  const errors = [];
  const shortRatio = shortPrompts.length / Math.max(prompts.length, 1);
  const nearDuplicateRatio = nearDuplicatePairs.length / Math.max(prompts.length, 1);
  const missingTemplateTotal = Object.values(templateMissing).reduce((acc, value) => acc + value, 0);

  if (shortPrompts.length) warnings.push(`${shortPrompts.length} prompts are shorter than ${shortPromptThreshold} characters`);
  if (nearDuplicatePairs.length) warnings.push(`${nearDuplicatePairs.length} near-duplicate prompt pairs detected at threshold ${nearDuplicateThreshold}`);
  if (missingTemplateTotal) warnings.push(`Template required fields are missing ${missingTemplateTotal} times`);
  if (sizeIssues.length) errors.push(`${sizeIssues.length} prompts request sizes that are not multiples of 16`);
  if (campaignPosterIssues.missingCampaignIntent.length) warnings.push(`${campaignPosterIssues.missingCampaignIntent.length} campaign-poster prompts may miss campaign/KV intent`);
  if (campaignPosterIssues.missingFullBodySignal.length) warnings.push(`${campaignPosterIssues.missingFullBodySignal.length} campaign-poster prompts may miss full-body signal`);
  if (campaignPosterIssues.missingTextSafeSignal.length) warnings.push(`${campaignPosterIssues.missingTextSafeSignal.length} campaign-poster prompts may miss typography-safe-space signal`);
  if (campaignPosterIssues.missingSceneSignal.length) warnings.push(`${campaignPosterIssues.missingSceneSignal.length} campaign-poster prompts may miss scene signal`);

  if (strict && shortRatio > 0.2) errors.push('Strict quality gate failed: more than 20% of prompts are too short');
  if (strict && nearDuplicateRatio > 0.05) errors.push('Strict quality gate failed: near-duplicate prompt ratio is too high');
  if (strict && missingTemplateTotal > 0) errors.push('Strict quality gate failed: template required fields are missing');

  return {
    strict,
    thresholds: {
      minPromptChars: shortPromptThreshold,
      nearDuplicateThreshold,
    },
    shortPrompts,
    nearDuplicatePairs,
    templateMissing,
    campaignPosterIssues,
    sizeIssues,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['prompts-file']) throw new Error('Missing required flag: --prompts-file');

  const promptsFile = path.resolve(args['prompts-file']);
  const prompts = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
  if (!Array.isArray(prompts)) throw new Error(`Prompt file must be a JSON array: ${promptsFile}`);

  let taskSpec = null;
  if (args['task-spec']) {
    taskSpec = JSON.parse(fs.readFileSync(path.resolve(args['task-spec']), 'utf8'));
  }

  const missing = {
    index: 0,
    slug: 0,
    title: 0,
    style_family: 0,
    scene: 0,
    composition: 0,
    text_policy: 0,
    negative_prompt: 0,
    prompt_text: 0,
  };

  const slugCounts = {};
  const promptSet = new Set();
  let duplicatePromptCount = 0;

  for (const item of prompts) {
    if (item.index === undefined || item.index === null || item.index === '') missing.index += 1;
    if (!item.slug) missing.slug += 1;
    if (!item.title) missing.title += 1;
    if (!item.style_family) missing.style_family += 1;
    if (!item.scene && !item.scene_anchor) missing.scene += 1;
    if (!item.composition) missing.composition += 1;
    if (!item.text_policy) missing.text_policy += 1;
    if (!item.negative_prompt) missing.negative_prompt += 1;

    const promptText = getPromptText(item);
    if (!promptText) missing.prompt_text += 1;
    const promptKey = promptText.replace(/\s+/g, ' ').trim().toLowerCase();
    if (promptKey) {
      if (promptSet.has(promptKey)) duplicatePromptCount += 1;
      promptSet.add(promptKey);
    }

    const slug = String(item.slug || '(missing)').trim();
    slugCounts[slug] = (slugCounts[slug] || 0) + 1;
  }

  const slugCollisions = Object.entries(slugCounts)
    .filter(([, count]) => count > 1)
    .map(([slug, count]) => ({ slug, count }));

  const errors = [];
  const warnings = [];

  if (!prompts.length) errors.push('Prompt bundle is empty');
  if (missing.prompt_text > Math.ceil(prompts.length * 0.1)) errors.push('More than 10% of prompts are missing prompt text');
  if (slugCollisions.length) errors.push(`Slug collisions detected: ${slugCollisions.map((item) => `${item.slug} x${item.count}`).join(', ')}`);

  if (taskSpec && taskSpec.total_count !== undefined && Number(taskSpec.total_count) !== prompts.length) {
    warnings.push(`Prompt count ${prompts.length} does not match task spec total_count ${taskSpec.total_count}`);
  }
  if (missing.style_family > 0) warnings.push(`${missing.style_family} prompts are missing style_family`);
  if (missing.scene > 0) warnings.push(`${missing.scene} prompts are missing scene or scene_anchor`);
  if (missing.composition > 0) warnings.push(`${missing.composition} prompts are missing composition`);
  if (missing.text_policy > 0) warnings.push(`${missing.text_policy} prompts are missing text_policy`);
  if (missing.negative_prompt > 0) warnings.push(`${missing.negative_prompt} prompts are missing negative_prompt`);
  if (duplicatePromptCount > 0) warnings.push(`${duplicatePromptCount} prompts appear to be duplicate or near-identical by exact text`);

  const familyCounts = countBy(prompts, 'style_family');
  const topFamily = topCounts(familyCounts, 1)[0];
  if (topFamily && topFamily.name !== '(missing)' && topFamily.count / Math.max(prompts.length, 1) > 0.8) {
    warnings.push(`Style family is highly concentrated: ${topFamily.name} = ${topFamily.count}/${prompts.length}`);
  }

  const qualityGates = buildQualityGates(prompts, taskSpec, args);
  errors.push(...qualityGates.errors);
  warnings.push(...qualityGates.warnings);

  const report = {
    promptsFile,
    taskSpec: args['task-spec'] ? path.resolve(args['task-spec']) : null,
    promptCount: prompts.length,
    missing,
    slugCollisions,
    duplicatePromptCount,
    qualityGates,
    distributions: {
      style_family: topCounts(countBy(prompts, 'style_family')),
      purity_grade: topCounts(countBy(prompts, 'purity_grade')),
      scene: topCounts(countBy(prompts, 'scene')),
      wardrobe: topCounts(countBy(prompts, 'wardrobe')),
      composition: topCounts(countBy(prompts, 'composition')),
    },
    errors,
    warnings,
    ok: errors.length === 0,
  };

  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(promptsFile), 'prompt_validation_report.json'));
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ outputPath, ok: report.ok, promptCount: report.promptCount, errorCount: errors.length, warningCount: warnings.length }, null, 2));

  if (!report.ok) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
