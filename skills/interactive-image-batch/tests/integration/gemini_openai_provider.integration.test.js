const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseEnvFile } = require('../../src/shared/env');
const { generate } = require('../../src/providers/gemini_openai_compatible');

function candidateEnvFiles() {
  return ['.env', '../.env', '../../.env', '../../../.env'].map((item) => path.resolve(item));
}

function loadEnv() {
  const envFile = candidateEnvFiles().find((file) => fs.existsSync(file));
  let fileEnv = {};
  if (envFile) fileEnv = parseEnvFile(envFile);
  return { ...fileEnv, ...process.env };
}

test('Gemini OpenAI-compatible provider real images/generations call', { skip: (() => {
  const env = loadEnv();
  const missing = ['GEMINI_OPENAI_BASE_URL', 'GEMINI_OPENAI_API_KEY', 'GEMINI_OPENAI_MODEL'].filter((key) => !env[key]);
  if (env.RUN_PROVIDER_INTEGRATION !== '1') return 'RUN_PROVIDER_INTEGRATION is not 1';
  if (missing.length) return `missing ${missing.join(', ')}`;
  return false;
})() }, async () => {
  const env = loadEnv();
  const result = await generate({
    baseUrl: env.GEMINI_OPENAI_BASE_URL,
    apiKey: env.GEMINI_OPENAI_API_KEY,
    model: env.GEMINI_OPENAI_MODEL,
    generatePath: env.GEMINI_OPENAI_IMAGE_GENERATE_PATH || '',
    prompt: env.GEMINI_OPENAI_TEST_PROMPT || 'Generate one simple product-style image of a plain red cube on white background.',
    timeoutMs: Number(env.GEMINI_OPENAI_TEST_TIMEOUT_MS || 120000),
    maxResponseBytes: Number(env.GEMINI_OPENAI_MAX_RESPONSE_BYTES || 128 * 1024 * 1024),
    maxDownloadBytes: Number(env.GEMINI_OPENAI_MAX_DOWNLOAD_BYTES || 64 * 1024 * 1024),
  });
  assert.equal(typeof result.b64, 'string');
  assert.equal(result.b64.length > 100, true);
});
