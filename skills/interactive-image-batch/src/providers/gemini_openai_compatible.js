const {
  MAX_RESPONSE_TEXT_BYTES,
  MAX_DOWNLOAD_BYTES,
  buildImageGenerationEndpoint,
  requestOpenAiStyleImage,
} = require('./openai_style_image');

function buildGeminiOpenAiEndpoint(baseUrl, generatePath) {
  return buildImageGenerationEndpoint(baseUrl, {
    generatePath,
    defaultFamily: 'gemini-openai',
    providerLabel: 'gemini-openai-compatible',
  });
}

function capabilities(options = {}) {
  return {
    provider: 'gemini-openai-compatible',
    generate: true,
    edit: false,
    maskEdit: false,
    referenceImages: false,
    referenceInputMimeTypes: [],
    outputFormats: ['data[0].b64_json', 'data[0].url'],
    sizeEffective: false,
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
    authMode: request.authMode || 'bearer',
    responseFormat: 'b64_json',
    maxResponseBytes: request.maxResponseBytes,
    maxDownloadBytes: request.maxDownloadBytes,
    providerLabel: 'gemini-openai-compatible',
    defaultFamily: 'gemini-openai',
  });
}

async function edit(request = {}) {
  if (request.maskImage) {
    throw new Error('gemini-openai-compatible provider does not support mask edit');
  }
  throw new Error('gemini-openai-compatible provider reference image support is disabled until official/proxy probe confirms image input support.');
}

module.exports = {
  MAX_RESPONSE_TEXT_BYTES,
  MAX_DOWNLOAD_BYTES,
  buildGeminiOpenAiEndpoint,
  generate,
  edit,
  capabilities,
};
