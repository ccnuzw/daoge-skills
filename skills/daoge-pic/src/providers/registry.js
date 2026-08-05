const openaiImages = require('./openai_images');
const geminiImage = require('./gemini_image');
const geminiOpenAiCompatible = require('./gemini_openai_compatible');
const xaiGrokImage = require('./xai_grok_image');
const { parseBoolean, parseNumber } = require('../domain/run_item');

const PROVIDERS = {
  'openai-images': openaiImages,
  'gemini-image': geminiImage,
  'gemini-openai-compatible': geminiOpenAiCompatible,
  'xai-grok-image': xaiGrokImage,
};

function normalizeProviderId(value) {
  const id = String(value || 'openai-images').trim().toLowerCase();
  if (id === 'openai' || id === 'gpt-image' || id === 'gpt-image-2') return 'openai-images';
  if (id === 'gemini' || id === 'gemini-images') return 'gemini-image';
  if (id === 'gemini-openai' || id === 'gemini-oai') return 'gemini-openai-compatible';
  if (id === 'grok-image' || id === 'xai-image') return 'xai-grok-image';
  return id;
}

function getProvider(providerId) {
  const id = normalizeProviderId(providerId);
  const provider = PROVIDERS[id];
  if (!provider) {
    throw new Error(`未知图片 provider：${id}. 支持：${Object.keys(PROVIDERS).join(', ')}`);
  }
  return provider;
}

function requireEnv(env, key, providerId, envFile) {
  const value = String(env[key] || '').trim();
  if (!value) {
    throw new Error(`${providerId} 配置缺少 ${key}：${envFile || '.env'}`);
  }
  return value;
}

function buildOpenAiConfig(env, envFile) {
  return {
    providerId: 'openai-images',
    provider: getProvider('openai-images'),
    envFile,
    baseUrl: requireEnv(env, 'OPENAI_BASE_URL', 'openai-images', envFile),
    apiKey: requireEnv(env, 'OPENAI_API_KEY', 'openai-images', envFile),
    model: env.OPENAI_MODEL || 'gpt-image-2',
    responsesModel: env.OPENAI_RESPONSES_MODEL || 'gpt-5.4',
    generatePath: env.OPENAI_IMAGE_GENERATE_PATH || '',
    editPath: env.OPENAI_IMAGE_EDIT_PATH || '',
    referenceImagesEnabled: true,
    maxResponseBytes: null,
  };
}

function buildGeminiConfig(env, envFile) {
  return {
    providerId: 'gemini-image',
    provider: getProvider('gemini-image'),
    envFile,
    baseUrl: requireEnv(env, 'GEMINI_IMAGE_BASE_URL', 'gemini-image', envFile),
    apiKey: requireEnv(env, 'GEMINI_IMAGE_API_KEY', 'gemini-image', envFile),
    model: requireEnv(env, 'GEMINI_IMAGE_MODEL', 'gemini-image', envFile),
    responsesModel: null,
    generatePath: env.GEMINI_IMAGE_GENERATE_PATH || '',
    editPath: '',
    authMode: env.GEMINI_IMAGE_AUTH_MODE || 'x-goog-api-key',
    referenceImagesEnabled: parseBoolean(env.GEMINI_IMAGE_ENABLE_REFERENCE, false),
    maxResponseBytes: Math.max(1024, parseNumber(env.GEMINI_IMAGE_MAX_RESPONSE_BYTES, geminiImage.MAX_RESPONSE_TEXT_BYTES)),
  };
}

function buildGeminiOpenAiCompatibleConfig(env, envFile) {
  return {
    providerId: 'gemini-openai-compatible',
    provider: getProvider('gemini-openai-compatible'),
    envFile,
    baseUrl: requireEnv(env, 'GEMINI_OPENAI_BASE_URL', 'gemini-openai-compatible', envFile),
    apiKey: requireEnv(env, 'GEMINI_OPENAI_API_KEY', 'gemini-openai-compatible', envFile),
    model: requireEnv(env, 'GEMINI_OPENAI_MODEL', 'gemini-openai-compatible', envFile),
    responsesModel: null,
    generatePath: env.GEMINI_OPENAI_IMAGE_GENERATE_PATH || '',
    editPath: '',
    authMode: env.GEMINI_OPENAI_AUTH_MODE || 'bearer',
    referenceImagesEnabled: false,
    maxResponseBytes: Math.max(1024, parseNumber(env.GEMINI_OPENAI_MAX_RESPONSE_BYTES, geminiOpenAiCompatible.MAX_RESPONSE_TEXT_BYTES)),
    maxDownloadBytes: Math.max(1024, parseNumber(env.GEMINI_OPENAI_MAX_DOWNLOAD_BYTES, geminiOpenAiCompatible.MAX_DOWNLOAD_BYTES)),
  };
}

function buildXaiGrokImageConfig(env, envFile) {
  return {
    providerId: 'xai-grok-image',
    provider: getProvider('xai-grok-image'),
    envFile,
    baseUrl: env.XAI_IMAGE_BASE_URL || 'https://api.x.ai/v1',
    apiKey: requireEnv(env, 'XAI_IMAGE_API_KEY', 'xai-grok-image', envFile),
    model: env.XAI_IMAGE_MODEL || 'grok-imagine-image-quality',
    responsesModel: null,
    generatePath: env.XAI_IMAGE_GENERATE_PATH || '',
    editPath: '',
    responseFormat: env.XAI_IMAGE_RESPONSE_FORMAT || '',
    referenceImagesEnabled: false,
    maxResponseBytes: Math.max(1024, parseNumber(env.XAI_IMAGE_MAX_RESPONSE_BYTES, xaiGrokImage.MAX_RESPONSE_TEXT_BYTES)),
    maxDownloadBytes: Math.max(1024, parseNumber(env.XAI_IMAGE_MAX_DOWNLOAD_BYTES, xaiGrokImage.MAX_DOWNLOAD_BYTES)),
  };
}

function buildProviderConfig(env, options = {}) {
  const providerId = normalizeProviderId(options.providerId || env.IMAGE_PROVIDER || env.PROVIDER || 'openai-images');
  if (providerId === 'openai-images') return buildOpenAiConfig(env, options.envFile);
  if (providerId === 'gemini-image') return buildGeminiConfig(env, options.envFile);
  if (providerId === 'gemini-openai-compatible') return buildGeminiOpenAiCompatibleConfig(env, options.envFile);
  if (providerId === 'xai-grok-image') return buildXaiGrokImageConfig(env, options.envFile);
  return { providerId, provider: getProvider(providerId), envFile: options.envFile };
}

module.exports = {
  PROVIDERS,
  normalizeProviderId,
  getProvider,
  buildProviderConfig,
  buildGeminiOpenAiCompatibleConfig,
  buildXaiGrokImageConfig,
};
