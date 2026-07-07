const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseEnvFile } = require('../../src/shared/env');
const { generate } = require('../../src/providers/xai_grok_image');

function candidateEnvFiles() {
  return ['.env', '../.env', '../../.env', '../../../.env'].map((item) => path.resolve(item));
}

function loadEnv() {
  const envFile = candidateEnvFiles().find((file) => fs.existsSync(file));
  let fileEnv = {};
  if (envFile) fileEnv = parseEnvFile(envFile);
  return { ...fileEnv, ...process.env };
}

test('xAI/Grok image provider real images/generations call', { skip: (() => {
  const env = loadEnv();
  const missing = ['XAI_IMAGE_API_KEY'].filter((key) => !env[key]);
  if (env.RUN_XAI_PROVIDER_INTEGRATION !== '1') return 'RUN_XAI_PROVIDER_INTEGRATION is not 1';
  if (missing.length) return `missing ${missing.join(', ')}`;
  return false;
})() }, async () => {
  const env = loadEnv();
  const result = await generate({
    baseUrl: env.XAI_IMAGE_BASE_URL || 'https://api.x.ai/v1',
    apiKey: env.XAI_IMAGE_API_KEY,
    model: env.XAI_IMAGE_MODEL || 'grok-imagine-image-quality',
    responseFormat: env.XAI_IMAGE_RESPONSE_FORMAT || '',
    prompt: env.XAI_IMAGE_TEST_PROMPT || 'Generate one simple product-style image of a plain red cube on white background.',
    size: env.XAI_IMAGE_TEST_SIZE || '1024x1024',
    timeoutMs: Number(env.XAI_IMAGE_TEST_TIMEOUT_MS || 120000),
    maxResponseBytes: Number(env.XAI_IMAGE_MAX_RESPONSE_BYTES || 128 * 1024 * 1024),
    maxDownloadBytes: Number(env.XAI_IMAGE_MAX_DOWNLOAD_BYTES || 64 * 1024 * 1024),
  });
  assert.equal(typeof result.b64, 'string');
  assert.equal(result.b64.length > 100, true);
});
