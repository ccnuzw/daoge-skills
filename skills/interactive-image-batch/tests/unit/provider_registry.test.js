const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProviderConfig } = require('../../src/providers/registry');

test('provider registry keeps OpenAI images as default provider', () => {
  const config = buildProviderConfig({
    OPENAI_BASE_URL: 'https://example.com/v1',
    OPENAI_API_KEY: 'test-key',
  }, { envFile: '.env' });
  assert.equal(config.providerId, 'openai-images');
  assert.equal(config.model, 'gpt-image-2');
});

test('provider registry reports missing Gemini config clearly', () => {
  assert.throws(() => buildProviderConfig({
    IMAGE_PROVIDER: 'gemini-image',
    GEMINI_IMAGE_BASE_URL: 'https://example.com',
  }, { envFile: '.env' }), /gemini-image 配置缺少 GEMINI_IMAGE_API_KEY/);
});

test('provider registry builds Gemini config from Gemini env names only', () => {
  const config = buildProviderConfig({
    IMAGE_PROVIDER: 'gemini-image',
    GEMINI_IMAGE_BASE_URL: 'https://example.com',
    GEMINI_IMAGE_API_KEY: 'test-key',
    GEMINI_IMAGE_MODEL: 'gemini-test-image',
    GEMINI_IMAGE_AUTH_MODE: 'bearer',
    GEMINI_IMAGE_ENABLE_REFERENCE: '1',
  }, { envFile: '.env' });
  assert.equal(config.providerId, 'gemini-image');
  assert.equal(config.model, 'gemini-test-image');
  assert.equal(config.authMode, 'bearer');
  assert.equal(config.referenceImagesEnabled, true);
});

test('provider registry resolves Gemini OpenAI-compatible aliases and config', () => {
  const config = buildProviderConfig({
    IMAGE_PROVIDER: 'gemini-oai',
    GEMINI_OPENAI_BASE_URL: 'https://example.com',
    GEMINI_OPENAI_API_KEY: 'test-key',
    GEMINI_OPENAI_MODEL: 'gemini-test-image',
    GEMINI_OPENAI_IMAGE_GENERATE_PATH: '/custom/images/generations',
  }, { envFile: '.env' });
  assert.equal(config.providerId, 'gemini-openai-compatible');
  assert.equal(config.generatePath, '/custom/images/generations');
  assert.equal(config.authMode, 'bearer');
  assert.equal(config.referenceImagesEnabled, false);
});

test('provider registry resolves xAI/Grok aliases and defaults', () => {
  const config = buildProviderConfig({
    IMAGE_PROVIDER: 'grok-image',
    XAI_IMAGE_API_KEY: 'test-key',
  }, { envFile: '.env' });
  assert.equal(config.providerId, 'xai-grok-image');
  assert.equal(config.baseUrl, 'https://api.x.ai/v1');
  assert.equal(config.model, 'grok-imagine-image-quality');
});
