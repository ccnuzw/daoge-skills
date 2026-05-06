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

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function sumCounts(items) {
  return ensureArray(items).reduce((acc, item) => acc + Math.max(0, Math.floor(parseNumber(item.count, 0))), 0);
}

function normalizeCountItems(items) {
  return ensureArray(items)
    .map((item) => ({
      name: String(item.name || '').trim(),
      count: Math.max(0, Math.floor(parseNumber(item.count, 0))),
    }))
    .filter((item) => item.name);
}

function normalizeStringArray(items) {
  return ensureArray(items).map(String).map((item) => item.trim()).filter(Boolean);
}

function normalizeAxisOptions(options) {
  return ensureArray(options)
    .map((option) => {
      if (typeof option === 'string') return { name: option.trim(), weight: 1 };
      return {
        name: String(option.name || option.value || '').trim(),
        weight: Math.max(0, parseNumber(option.weight, 1)),
        maps_to: String(option.maps_to || '').trim() || null,
        prompt_hint: String(option.prompt_hint || option.description || '').trim() || null,
        lock_group: String(option.lock_group || '').trim() || null,
      };
    })
    .filter((option) => option.name);
}

function normalizeVariantAxes(axes) {
  return ensureArray(axes)
    .map((axis) => ({
      name: String(axis.name || axis.id || '').trim(),
      field: String(axis.field || axis.name || '').trim(),
      strategy: String(axis.strategy || 'cycle').trim(),
      batch_balance: String(axis.batch_balance || 'none').trim(),
      avoid_repeat_within_batch: Boolean(axis.avoid_repeat_within_batch),
      options: normalizeAxisOptions(axis.options || axis.values),
      notes: String(axis.notes || '').trim() || null,
    }))
    .filter((axis) => axis.name && axis.field && axis.options.length);
}

function normalizeTemplateVariant(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return { id: value.trim(), name: value.trim(), source: 'user' };
  return {
    id: String(value.id || value.name || '').trim(),
    name: String(value.name || value.id || '').trim(),
    source: String(value.source || 'user').trim(),
  };
}

function normalizeAutofillPolicy(policy) {
  const input = policy || {};
  return {
    enabled: input.enabled !== false,
    mark_sources: input.mark_sources !== false,
    source_field: String(input.source_field || 'field_sources').trim(),
    default_source_label: String(input.default_source_label || 'autofill').trim(),
    rules: ensureArray(input.rules).map((rule) => ({
      field: String(rule.field || '').trim(),
      when_missing: rule.when_missing !== false,
      values: normalizeStringArray(rule.values || rule.options),
      source: String(rule.source || input.default_source_label || 'autofill').trim(),
    })).filter((rule) => rule.field && rule.values.length),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['strategy-file']) throw new Error('Missing required flag: --strategy-file');

  const strategyPath = path.resolve(args['strategy-file']);
  const strategy = JSON.parse(fs.readFileSync(strategyPath, 'utf8'));
  let taskSpec = null;
  if (args['task-spec']) taskSpec = JSON.parse(fs.readFileSync(path.resolve(args['task-spec']), 'utf8'));

  const normalized = {
    content_brief: String(strategy.content_brief || '').trim(),
    source_files: normalizeStringArray(strategy.source_files),
    output_mode: String(strategy.output_mode || '').trim(),
    total_count: Math.max(1, Math.floor(parseNumber(strategy.total_count, taskSpec?.total_count || 1))),
    batch_size: Math.max(1, Math.floor(parseNumber(strategy.batch_size, taskSpec?.batch_size || 30))),
    variation_requirements: normalizeStringArray(strategy.variation_requirements || taskSpec?.variation_requirements),
    style_families: normalizeCountItems(strategy.style_families),
    grade_distribution: normalizeCountItems(strategy.grade_distribution),
    scene_pool: normalizeStringArray(strategy.scene_pool),
    wardrobe_pool: normalizeStringArray(strategy.wardrobe_pool),
    composition_pool: normalizeStringArray(strategy.composition_pool),
    text_policy: String(strategy.text_policy || taskSpec?.text_policy || '').trim() || null,
    negative_policy: String(strategy.negative_policy || '').trim() || null,
    variation_rules: normalizeStringArray(strategy.variation_rules),
    template_variant: normalizeTemplateVariant(strategy.template_variant),
    autofill_policy: normalizeAutofillPolicy(strategy.autofill_policy),
    variant_axes: normalizeVariantAxes(strategy.variant_axes),
    notes: String(strategy.notes || '').trim() || null,
  };

  const errors = [];
  const warnings = [];

  if (!normalized.content_brief) errors.push('content_brief is required');
  if (!normalized.output_mode) errors.push('output_mode is required');
  if (!normalized.style_families.length) errors.push('style_families must be non-empty');
  if (!normalized.scene_pool.length) errors.push('scene_pool must be non-empty');
  if (!normalized.wardrobe_pool.length) errors.push('wardrobe_pool must be non-empty');
  if (!normalized.composition_pool.length) errors.push('composition_pool must be non-empty');
  if (!normalized.variation_requirements.length) warnings.push('variation_requirements is empty; large runs may become less stable');
  normalized.variant_axes.forEach((axis) => {
    if (!/^[a-zA-Z0-9_:-]+$/.test(axis.field)) warnings.push(`variant axis field contains unusual characters: ${axis.field}`);
    if (axis.options.length < 2) warnings.push(`variant axis ${axis.name} has fewer than 2 options`);
    if (!['cycle', 'weighted', 'batch-balanced'].includes(axis.strategy)) warnings.push(`variant axis ${axis.name} uses unknown strategy ${axis.strategy}`);
  });

  const styleFamilySum = sumCounts(normalized.style_families);
  const gradeSum = sumCounts(normalized.grade_distribution);
  if (styleFamilySum !== normalized.total_count) errors.push(`style_families count sum ${styleFamilySum} does not match total_count ${normalized.total_count}`);
  if (normalized.grade_distribution.length && gradeSum !== normalized.total_count) errors.push(`grade_distribution count sum ${gradeSum} does not match total_count ${normalized.total_count}`);

  if (taskSpec && Number(taskSpec.total_count) !== normalized.total_count) {
    warnings.push(`strategy total_count ${normalized.total_count} differs from task spec total_count ${taskSpec.total_count}`);
  }
  if (taskSpec && Number(taskSpec.batch_size) !== normalized.batch_size) {
    warnings.push(`strategy batch_size ${normalized.batch_size} differs from task spec batch_size ${taskSpec.batch_size}`);
  }
  const dominantFamily = [...normalized.style_families].sort((a, b) => b.count - a.count)[0];
  if (dominantFamily && dominantFamily.count / normalized.total_count > 0.8) {
    warnings.push(`style family is highly concentrated: ${dominantFamily.name} = ${dominantFamily.count}/${normalized.total_count}`);
  }

  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(strategyPath), 'prompt_strategy.normalized.json'));
  const reportPath = path.resolve(args['report-file'] || path.join(path.dirname(strategyPath), 'prompt_strategy_validation_report.json'));
  fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify({
    strategyPath,
    outputPath,
    totalCount: normalized.total_count,
    batchSize: normalized.batch_size,
    styleFamilies: normalized.style_families,
    gradeDistribution: normalized.grade_distribution,
    templateVariant: normalized.template_variant,
    autofillRules: normalized.autofill_policy.rules.map((rule) => ({ field: rule.field, valueCount: rule.values.length, source: rule.source })),
    variantAxes: normalized.variant_axes.map((axis) => ({
      name: axis.name,
      field: axis.field,
      optionCount: axis.options.length,
      strategy: axis.strategy,
      batchBalance: axis.batch_balance,
      avoidRepeatWithinBatch: axis.avoid_repeat_within_batch,
    })),
    errors,
    warnings,
    ok: errors.length === 0,
  }, null, 2));

  console.log(JSON.stringify({ outputPath, reportPath, ok: errors.length === 0, errorCount: errors.length, warningCount: warnings.length }, null, 2));
  if (errors.length) process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
