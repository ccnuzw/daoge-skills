const fs = require('fs');
const path = require('path');

const OPENAI_IMAGE_MULTIPLE = 16;
const OPENAI_IMAGE_MAX_ASPECT_RATIO = 3;
const OPENAI_IMAGE_MIN_PIXELS = 655360;
const OPENAI_IMAGE_MAX_PIXELS = 8294400;

function normalizeProvider(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (!normalized) return null;
  if (['openai', 'openai_compatible'].includes(normalized)) return 'openai';
  if (['grok', 'xai'].includes(normalized)) return 'grok';
  return normalized;
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const out = {};
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const normalizedLine = line.replace(/^\s*export\s+/, '');
    const idx = normalizedLine.indexOf('=');
    if (idx === -1) continue;
    const key = normalizedLine.slice(0, idx).trim();
    let value = normalizedLine.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    out[key] = value.trim();
  }
  return out;
}

function resolveEnvFile(startDir = process.cwd()) {
  const direct = path.resolve(startDir, '.env');
  return fs.existsSync(direct) ? direct : null;
}

function resolveRuntimeTarget(taskSpec = {}, options = {}) {
  const env = options.env || parseEnvFile(options.envFile || resolveEnvFile(options.cwd || process.cwd()));
  const provider = normalizeProvider(taskSpec.provider || env.DAOGE_DEFAULT_PROVIDER || 'openai') || 'openai';
  const model = provider === 'grok'
    ? (taskSpec.model || env.GROK_MODEL || 'grok-imagine-image-lite')
    : (taskSpec.model || env.OPENAI_MODEL || 'gpt-image-2');
  return {
    provider,
    model: String(model || '').trim() || (provider === 'grok' ? 'grok-imagine-image-lite' : 'gpt-image-2'),
  };
}

function ceilToMultiple(value, multiple) {
  return Math.ceil(value / multiple) * multiple;
}

function suggestMinimumSize(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const scale = Math.sqrt(OPENAI_IMAGE_MIN_PIXELS / (width * height));
  let suggestedWidth = ceilToMultiple(width * Math.max(scale, 1), OPENAI_IMAGE_MULTIPLE);
  let suggestedHeight = ceilToMultiple(height * Math.max(scale, 1), OPENAI_IMAGE_MULTIPLE);

  while (suggestedWidth * suggestedHeight < OPENAI_IMAGE_MIN_PIXELS) {
    if (suggestedWidth / width <= suggestedHeight / height) {
      suggestedWidth += OPENAI_IMAGE_MULTIPLE;
    } else {
      suggestedHeight += OPENAI_IMAGE_MULTIPLE;
    }
  }

  return {
    width: suggestedWidth,
    height: suggestedHeight,
  };
}

function supportsOpenAiPixelBudget(model) {
  return /^gpt-image-/i.test(String(model || '').trim());
}

function buildSizeValidationIssues({ width, height, provider, model }) {
  const issues = [];
  const normalizedProvider = normalizeProvider(provider) || 'openai';
  const normalizedModel = String(model || '').trim() || (normalizedProvider === 'grok' ? 'grok-imagine-image-lite' : 'gpt-image-2');

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return [{
      code: 'invalid_dimensions',
      message: `Size ${width}x${height} is invalid`,
      displayMessage: `DAOGE 尺寸预检失败：当前尺寸 ${width} x ${height} 非法，宽高都必须是正整数。`,
    }];
  }

  if (width % OPENAI_IMAGE_MULTIPLE !== 0 || height % OPENAI_IMAGE_MULTIPLE !== 0) {
    issues.push({
      code: 'multiple_of_16',
      message: `Size ${width}x${height} must use width and height that are multiples of ${OPENAI_IMAGE_MULTIPLE}`,
      displayMessage: `DAOGE 尺寸预检失败：当前尺寸 ${width} x ${height} 不合法，宽和高都必须是 ${OPENAI_IMAGE_MULTIPLE} 的倍数。`,
    });
  }

  if (normalizedProvider !== 'openai' || !supportsOpenAiPixelBudget(normalizedModel)) {
    return issues;
  }

  const pixels = width * height;
  const aspectRatio = Math.max(width / height, height / width);

  if (aspectRatio > OPENAI_IMAGE_MAX_ASPECT_RATIO) {
    issues.push({
      code: 'aspect_ratio_too_wide',
      message: `Size ${width}x${height} exceeds the maximum aspect ratio ${OPENAI_IMAGE_MAX_ASPECT_RATIO}:1 for ${normalizedModel}`,
      displayMessage: `DAOGE 尺寸预检失败：当前尺寸 ${width} x ${height} 对 ${normalizedModel} 来说过扁或过长，长宽比不能超过 ${OPENAI_IMAGE_MAX_ASPECT_RATIO}:1。`,
    });
  }

  if (pixels < OPENAI_IMAGE_MIN_PIXELS) {
    const suggestion = suggestMinimumSize(width, height);
    issues.push({
      code: 'below_minimum_pixel_budget',
      message: `Size ${width}x${height} is below the minimum pixel budget ${OPENAI_IMAGE_MIN_PIXELS} for ${normalizedModel}; current pixels: ${pixels}; try at least ${suggestion ? `${suggestion.width}x${suggestion.height}` : 'a larger size'}`,
      displayMessage: `DAOGE 尺寸预检失败：当前尺寸 ${width} x ${height} 只有 ${pixels} 像素，低于 ${normalizedModel} 的最小像素预算 ${OPENAI_IMAGE_MIN_PIXELS}。建议至少改到 ${suggestion ? `${suggestion.width} x ${suggestion.height}` : '更大的合法尺寸'}。`,
    });
  }

  if (pixels > OPENAI_IMAGE_MAX_PIXELS) {
    issues.push({
      code: 'above_maximum_pixel_budget',
      message: `Size ${width}x${height} exceeds the maximum pixel budget ${OPENAI_IMAGE_MAX_PIXELS} for ${normalizedModel}; current pixels: ${pixels}`,
      displayMessage: `DAOGE 尺寸预检失败：当前尺寸 ${width} x ${height} 共有 ${pixels} 像素，超过 ${normalizedModel} 的最大像素预算 ${OPENAI_IMAGE_MAX_PIXELS}。请降低分辨率后再执行。`,
    });
  }

  return issues;
}

module.exports = {
  OPENAI_IMAGE_MAX_ASPECT_RATIO,
  OPENAI_IMAGE_MAX_PIXELS,
  OPENAI_IMAGE_MIN_PIXELS,
  OPENAI_IMAGE_MULTIPLE,
  buildSizeValidationIssues,
  normalizeProvider,
  resolveRuntimeTarget,
};
