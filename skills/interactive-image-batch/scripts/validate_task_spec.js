const fs = require('fs');
const path = require('path');
const { buildSizeValidationIssues, normalizeProvider, resolveRuntimeTarget } = require('./provider_size_rules');

const DEFAULT_RUN_PRESET_ID = 'safe_2k_poster';

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

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isMissingValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function assertExplicitNonEmpty(raw, key, kind = 'value') {
  if (hasOwn(raw, key) && isMissingValue(raw[key])) {
    throw new Error(`task_spec.${key} cannot be empty when provided explicitly (${kind})`);
  }
}

function assertExplicitFiniteNumber(raw, key) {
  assertExplicitNonEmpty(raw, key, 'number');
  if (hasOwn(raw, key) && !Number.isFinite(Number(raw[key]))) {
    throw new Error(`task_spec.${key} must be a valid number when provided explicitly`);
  }
}

function ensureNonEmptyStringArray(value) {
  return ensureArray(value).map(String).map((item) => item.trim()).filter(Boolean);
}

function resolveMaybePath(baseDir, value) {
  const text = String(value || '').trim();
  if (!text) return null;
  return path.isAbsolute(text) ? text : path.resolve(baseDir, text);
}

function resolveMaybePathArray(baseDir, value) {
  return ensureNonEmptyStringArray(value).map((item) => resolveMaybePath(baseDir, item)).filter(Boolean);
}

function normalizeStoryboardPlan(rawPlan, baseDir) {
  if (!rawPlan || typeof rawPlan !== 'object') return null;
  const enabledByFields = ['layout_manifest', 'content_manifest', 'render_config'].some((key) => {
    return rawPlan[key] !== undefined && rawPlan[key] !== null && String(rawPlan[key]).trim() !== '';
  });
  const enabled = parseBoolean(rawPlan.enabled, enabledByFields);
  if (!enabled && !enabledByFields) return null;
  return {
    enabled,
    layout_manifest: resolveMaybePath(baseDir, rawPlan.layout_manifest),
    content_manifest: resolveMaybePath(baseDir, rawPlan.content_manifest),
    render_config: resolveMaybePath(baseDir, rawPlan.render_config),
    reference_bindings: resolveMaybePath(baseDir, rawPlan.reference_bindings),
    generation_mode: String(rawPlan.generation_mode || 'per-slot').trim(),
    assembly_mode: String(rawPlan.assembly_mode || 'external-compositor').trim(),
    reference_mode: String(rawPlan.reference_mode || 'metadata-only').trim(),
    variable_layout: parseBoolean(rawPlan.variable_layout, true),
    preserve_reference_metadata: parseBoolean(rawPlan.preserve_reference_metadata, true),
  };
}

function loadRunPresets() {
  const presetPath = path.resolve(__dirname, '..', 'references', 'run_presets_zh.json');
  const data = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
  return Array.isArray(data.presets) ? data.presets : [];
}

function normalizePresetKey(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveRunPreset(raw) {
  const presets = loadRunPresets();
  const requested = raw.run_preset || raw.runtime_preset || raw.preset || raw.daoge_preset || DEFAULT_RUN_PRESET_ID;
  const requestedKey = normalizePresetKey(typeof requested === 'object' ? (requested.id || requested.name) : requested);
  if (!requestedKey) return null;

  const preset = presets.find((item) => {
    if (normalizePresetKey(item.id) === requestedKey) return true;
    if (normalizePresetKey(item.name) === requestedKey) return true;
    return (item.aliases || []).some((alias) => normalizePresetKey(alias) === requestedKey);
  });

  if (!preset) {
    const available = presets.map((item) => item.id).join(', ');
    throw new Error(`Unknown task_spec.run_preset: ${requested}. Available presets: ${available}`);
  }

  return {
    ...preset,
    explicit: hasOwn(raw, 'run_preset') || hasOwn(raw, 'runtime_preset') || hasOwn(raw, 'preset') || hasOwn(raw, 'daoge_preset'),
  };
}

function applyPresetValues(raw, preset) {
  const merged = { ...raw };
  const fieldSources = {};
  Object.keys(raw).forEach((key) => {
    if (!isMissingValue(raw[key])) fieldSources[key] = 'dialogue';
  });

  if (!preset) return { merged, fieldSources };

  Object.entries(preset.values || {}).forEach(([key, value]) => {
    if (isMissingValue(merged[key])) {
      merged[key] = value;
      fieldSources[key] = `preset:${preset.id}`;
    }
  });

  return { merged, fieldSources };
}

function sourceFor(fieldSources, key, fallback = 'default') {
  return fieldSources[key] || fallback;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['task-spec']) throw new Error('Missing required flag: --task-spec');

  const taskSpecPath = path.resolve(args['task-spec']);
  const taskSpecDir = path.dirname(taskSpecPath);
  const raw = JSON.parse(fs.readFileSync(taskSpecPath, 'utf8'));
  assertExplicitNonEmpty(raw, 'content_brief', 'string');
  assertExplicitNonEmpty(raw, 'output_mode', 'string');
  assertExplicitFiniteNumber(raw, 'total_count');
  assertExplicitFiniteNumber(raw, 'batch_size');
  assertExplicitFiniteNumber(raw, 'concurrency');
  assertExplicitFiniteNumber(raw, 'retry_count');
  assertExplicitFiniteNumber(raw, 'timeout_seconds');
  assertExplicitFiniteNumber(raw, 'width');
  assertExplicitFiniteNumber(raw, 'height');
  assertExplicitNonEmpty(raw, 'text_policy', 'string');
  if (hasOwn(raw, 'provider') && !normalizeProvider(raw.provider)) {
    throw new Error('task_spec.provider cannot be empty when provided explicitly');
  }
  if (hasOwn(raw, 'variation_requirements') && !ensureNonEmptyStringArray(raw.variation_requirements).length) {
    throw new Error('task_spec.variation_requirements cannot be empty when provided explicitly');
  }
  const runPreset = resolveRunPreset(raw);
  const { merged, fieldSources } = applyPresetValues(raw, runPreset);

  if (!merged.content_brief || !String(merged.content_brief).trim()) {
    throw new Error('task_spec.content_brief is required');
  }
  if (!merged.output_mode || !String(merged.output_mode).trim()) {
    throw new Error('task_spec.output_mode is required');
  }
  if (!hasOwn(merged, 'total_count')) throw new Error('task_spec.total_count must be explicit');
  if (!hasOwn(merged, 'batch_size')) throw new Error('task_spec.batch_size must be explicit or supplied by run_preset');
  if (!hasOwn(merged, 'concurrency')) throw new Error('task_spec.concurrency must be explicit or supplied by run_preset');
  if (!hasOwn(merged, 'retry_count')) throw new Error('task_spec.retry_count must be explicit or supplied by run_preset');
  if (!hasOwn(merged, 'timeout_seconds')) throw new Error('task_spec.timeout_seconds must be explicit or supplied by run_preset');
  if (!hasOwn(merged, 'width')) throw new Error('task_spec.width must be explicit or supplied by run_preset');
  if (!hasOwn(merged, 'height')) throw new Error('task_spec.height must be explicit or supplied by run_preset');
  if (!hasOwn(merged, 'text_policy')) throw new Error('task_spec.text_policy must be explicit');
  if (!hasOwn(merged, 'variation_requirements')) throw new Error('task_spec.variation_requirements must be explicit');

  const totalCount = Math.max(1, Math.floor(parseNumber(merged.total_count, 1)));
  const styleRequirements = ensureNonEmptyStringArray(merged.style_requirements);
  const sourceFiles = ensureNonEmptyStringArray(merged.source_files);
  const sourceImages = resolveMaybePathArray(taskSpecDir, merged.source_images);
  const variationRequirements = ensureNonEmptyStringArray(merged.variation_requirements);
  const textPolicy = String(merged.text_policy || '').trim();
  const storyboardPlan = normalizeStoryboardPlan(merged.storyboard_plan, taskSpecDir);
  if (!styleRequirements.length && !sourceFiles.length) {
    throw new Error('task_spec must include source_files or non-empty style_requirements');
  }
  if (!variationRequirements.length) {
    throw new Error('task_spec.variation_requirements must be a non-empty array or string');
  }
  if (!textPolicy) {
    throw new Error('task_spec.text_policy must be a non-empty string; use an explicit no-typography policy when needed');
  }

  const width = Math.max(16, Math.floor(parseNumber(merged.width, 1440)));
  const height = Math.max(16, Math.floor(parseNumber(merged.height, 2560)));
  const runtimeTarget = resolveRuntimeTarget({
    provider: normalizeProvider(merged.provider) || 'openai',
  });
  const sizeIssues = buildSizeValidationIssues({
    width,
    height,
    provider: normalizeProvider(merged.provider) || runtimeTarget.provider,
    model: runtimeTarget.model,
  });
  if (sizeIssues.length) throw new Error(sizeIssues[0].displayMessage);

  const normalized = {
    provider: normalizeProvider(merged.provider) || runtimeTarget.provider,
    run_preset: runPreset ? {
      id: runPreset.id,
      name: runPreset.name,
      description: runPreset.description,
      explicit: runPreset.explicit,
    } : null,
    content_brief: String(merged.content_brief).trim(),
    output_mode: String(merged.output_mode).trim(),
    style_requirements: styleRequirements,
    source_files: sourceFiles,
    source_images: sourceImages,
    total_count: totalCount,
    batch_size: Math.max(1, Math.floor(parseNumber(merged.batch_size, totalCount > 30 ? 30 : totalCount))),
    concurrency: clampNumber(Math.floor(parseNumber(merged.concurrency, 3)), 1, 12),
    retry_count: Math.max(0, Math.floor(parseNumber(merged.retry_count, 1))),
    timeout_seconds: Math.max(1, Math.floor(parseNumber(merged.timeout_seconds, 450))),
    width,
    height,
    variation_requirements: variationRequirements,
    output_format: String(merged.output_format || 'png').trim() || 'png',
    preview_count: Math.max(1, Math.floor(parseNumber(merged.preview_count, Math.min(12, totalCount)))),
    contact_sheet: parseBoolean(merged.contact_sheet, true),
    require_confirmation: parseBoolean(merged.require_confirmation, true),
    aspect_ratio_label: merged.aspect_ratio_label ? String(merged.aspect_ratio_label).trim() : null,
    sample_size: hasOwn(merged, 'sample_size') ? Math.max(0, Math.floor(parseNumber(merged.sample_size, 0))) : undefined,
    stage_size: hasOwn(merged, 'stage_size') ? Math.max(0, Math.floor(parseNumber(merged.stage_size, 0))) : undefined,
    stop_after_sample: parseBoolean(merged.stop_after_sample, false),
    auto_pause: parseBoolean(merged.auto_pause, true),
    max_consecutive_failures: hasOwn(merged, 'max_consecutive_failures') ? Math.max(0, Math.floor(parseNumber(merged.max_consecutive_failures, 0))) : undefined,
    max_batch_failure_rate: hasOwn(merged, 'max_batch_failure_rate') ? Math.max(0, parseNumber(merged.max_batch_failure_rate, 1.1)) : undefined,
    skip_existing: parseBoolean(merged.skip_existing, false),
    identity_policy: merged.identity_policy ? String(merged.identity_policy).trim() : null,
    negative_requirements: ensureNonEmptyStringArray(merged.negative_requirements),
    run_label: merged.run_label ? String(merged.run_label).trim() : null,
    text_policy: textPolicy,
    storyboard_plan: storyboardPlan,
    notes: merged.notes ? String(merged.notes).trim() : null,
  };

  if (normalized.batch_size > normalized.total_count) normalized.batch_size = normalized.total_count;
  if (parseBoolean(merged.start_immediately, false) === true) normalized.require_confirmation = false;

  normalized.field_sources = {
    provider: sourceFor(fieldSources, 'provider', 'default'),
    run_preset: runPreset ? (runPreset.explicit ? 'dialogue' : 'default') : 'none',
    content_brief: sourceFor(fieldSources, 'content_brief'),
    output_mode: sourceFor(fieldSources, 'output_mode'),
    style_requirements: sourceFor(fieldSources, 'style_requirements'),
    source_files: sourceFor(fieldSources, 'source_files'),
    source_images: sourceFor(fieldSources, 'source_images'),
    total_count: sourceFor(fieldSources, 'total_count'),
    batch_size: sourceFor(fieldSources, 'batch_size'),
    concurrency: sourceFor(fieldSources, 'concurrency'),
    retry_count: sourceFor(fieldSources, 'retry_count'),
    timeout_seconds: sourceFor(fieldSources, 'timeout_seconds'),
    width: sourceFor(fieldSources, 'width'),
    height: sourceFor(fieldSources, 'height'),
    variation_requirements: sourceFor(fieldSources, 'variation_requirements'),
    output_format: sourceFor(fieldSources, 'output_format'),
    preview_count: sourceFor(fieldSources, 'preview_count'),
    contact_sheet: sourceFor(fieldSources, 'contact_sheet'),
    require_confirmation: sourceFor(fieldSources, 'require_confirmation'),
    aspect_ratio_label: sourceFor(fieldSources, 'aspect_ratio_label'),
    sample_size: sourceFor(fieldSources, 'sample_size'),
    stage_size: sourceFor(fieldSources, 'stage_size'),
    stop_after_sample: sourceFor(fieldSources, 'stop_after_sample'),
    auto_pause: sourceFor(fieldSources, 'auto_pause'),
    max_consecutive_failures: sourceFor(fieldSources, 'max_consecutive_failures'),
    max_batch_failure_rate: sourceFor(fieldSources, 'max_batch_failure_rate'),
    skip_existing: sourceFor(fieldSources, 'skip_existing'),
    text_policy: sourceFor(fieldSources, 'text_policy'),
    storyboard_plan: sourceFor(fieldSources, 'storyboard_plan'),
  };

  const outputPath = path.resolve(args['output-file'] || path.join(path.dirname(taskSpecPath), 'task_spec.normalized.json'));
  fs.writeFileSync(outputPath, JSON.stringify(normalized, null, 2));
  console.log(JSON.stringify({ taskSpecPath, outputPath, totalCount: normalized.total_count, batchSize: normalized.batch_size, concurrency: normalized.concurrency, requireConfirmation: normalized.require_confirmation }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
