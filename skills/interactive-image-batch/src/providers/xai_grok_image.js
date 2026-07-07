const {
  MAX_RESPONSE_TEXT_BYTES,
  MAX_DOWNLOAD_BYTES,
  buildImageGenerationEndpoint,
  requestOpenAiStyleImage,
} = require('./openai_style_image');

function parseSize(size) {
  const match = /^(\d+)x(\d+)$/i.exec(String(size || '').trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

function nearestAspectRatio(size) {
  const parsed = parseSize(size);
  if (!parsed) return null;
  const ratio = parsed.width / parsed.height;
  const candidates = [
    ['1:1', 1],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
  ];
  const best = candidates
    .map(([label, value]) => ({ label, delta: Math.abs(ratio - value) / value }))
    .sort((a, b) => a.delta - b.delta)[0];
  return best && best.delta <= 0.08 ? best.label : null;
}

function resolutionFromSize(size) {
  const parsed = parseSize(size);
  if (!parsed) return null;
  const maxSide = Math.max(parsed.width, parsed.height);
  if (Math.abs(maxSide - 1024) <= 256) return '1k';
  if (Math.abs(maxSide - 2048) <= 384) return '2k';
  return null;
}

function buildXaiEndpoint(baseUrl, generatePath) {
  return buildImageGenerationEndpoint(baseUrl, {
    generatePath,
    defaultFamily: 'openai-style',
    providerLabel: 'xai-grok-image',
  });
}

function buildXaiExtraBody({ size }) {
  const body = {};
  const aspectRatio = nearestAspectRatio(size);
  const resolution = resolutionFromSize(size);
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  if (resolution) body.resolution = resolution;
  return body;
}

function capabilities(options = {}) {
  return {
    provider: 'xai-grok-image',
    generate: true,
    edit: false,
    maskEdit: false,
    referenceImages: false,
    referenceInputMimeTypes: [],
    outputFormats: ['data[0].url', 'data[0].b64_json'],
    sizeEffective: true,
    qualityEffective: false,
    timeoutMs: options.timeoutMs || null,
    maxResponseBytes: Number(options.maxResponseBytes || MAX_RESPONSE_TEXT_BYTES),
    maxDownloadBytes: Number(options.maxDownloadBytes || MAX_DOWNLOAD_BYTES),
    retryableError: 'HTTP 408/409/429/5xx',
  };
}

async function generate(request = {}) {
  return requestOpenAiStyleImage({
    baseUrl: request.baseUrl,
    apiKey: request.apiKey,
    model: request.model,
    prompt: request.prompt,
    timeoutMs: request.timeoutMs,
    generatePath: request.generatePath,
    authMode: 'bearer',
    responseFormat: request.responseFormat || undefined,
    extraBody: buildXaiExtraBody({ size: request.size }),
    maxResponseBytes: request.maxResponseBytes,
    maxDownloadBytes: request.maxDownloadBytes,
    providerLabel: 'xai-grok-image',
    defaultFamily: 'openai-style',
  });
}

async function edit(request = {}) {
  if (request.maskImage) {
    throw new Error('xai-grok-image provider does not support mask edit in this release');
  }
  throw new Error('xai-grok-image provider text-to-image is implemented; reference/edit support requires a separate probe and implementation.');
}

module.exports = {
  MAX_RESPONSE_TEXT_BYTES,
  MAX_DOWNLOAD_BYTES,
  buildXaiEndpoint,
  nearestAspectRatio,
  resolutionFromSize,
  buildXaiExtraBody,
  generate,
  edit,
  capabilities,
};
