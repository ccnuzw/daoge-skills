const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseEnvFile } = require('../../src/shared/env');
const { generate } = require('../../src/providers/gemini_image');

function candidateEnvFiles() {
  return ['.env', '../.env', '../../.env', '../../../.env'].map((item) => path.resolve(item));
}

function loadGeminiEnv() {
  const envFile = candidateEnvFiles().find((file) => fs.existsSync(file));
  let fileEnv = {};
  if (envFile) fileEnv = parseEnvFile(envFile);
  return { ...fileEnv, ...process.env };
}

test('Gemini provider real generateContent call', { skip: (() => {
  const env = loadGeminiEnv();
  const missing = ['GEMINI_IMAGE_BASE_URL', 'GEMINI_IMAGE_API_KEY', 'GEMINI_IMAGE_MODEL'].filter((key) => !env[key]);
  if (env.RUN_PROVIDER_INTEGRATION !== '1') return 'RUN_PROVIDER_INTEGRATION is not 1';
  if (missing.length) return `missing ${missing.join(', ')}`;
  return false;
})() }, async () => {
  const env = loadGeminiEnv();
  const result = await generate({
    baseUrl: env.GEMINI_IMAGE_BASE_URL,
    apiKey: env.GEMINI_IMAGE_API_KEY,
    model: env.GEMINI_IMAGE_MODEL,
    authMode: env.GEMINI_IMAGE_AUTH_MODE || 'x-goog-api-key',
    generatePath: env.GEMINI_IMAGE_GENERATE_PATH || '',
    prompt: env.GEMINI_IMAGE_TEST_PROMPT || 'Generate one simple product-style image of a plain red cube on white background.',
    timeoutMs: Number(env.GEMINI_IMAGE_TEST_TIMEOUT_MS || 120000),
    maxResponseBytes: Number(env.GEMINI_IMAGE_MAX_RESPONSE_BYTES || 128 * 1024 * 1024),
  });
  assert.equal(typeof result.b64, 'string');
  assert.equal(result.b64.length > 100, true);
});
