#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { parseEnvFile } = require('../src/shared/env');
const {
  buildImageGenerationEndpoint,
  buildAuthRequest,
  parseImageGenerationResponse,
  readResponseText,
  parseProviderError,
} = require('../src/providers/openai_style_image');

function candidateEnvFiles() {
  const explicit = process.argv[2] || process.env.GEMINI_OPENAI_ENV_FILE;
  if (explicit) return [path.resolve(explicit)];
  return ['.env', '../.env', '../../.env', '../../../.env'].map((item) => path.resolve(item));
}

function loadEnv() {
  const envFiles = candidateEnvFiles();
  const envFile = envFiles.find((file) => fs.existsSync(file)) || envFiles[0];
  try {
    return { envFile, env: { ...parseEnvFile(envFile), ...process.env } };
  } catch {
    return { envFile, env: { ...process.env } };
  }
}

function safeError(value) {
  return String(value || '')
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .slice(0, 500);
}

function responseShape(json) {
  const first = json?.data?.[0] || {};
  const payload = parseImageGenerationResponse(json);
  return {
    hasDataArray: Array.isArray(json?.data),
    dataCount: Array.isArray(json?.data) ? json.data.length : 0,
    hasB64Json: Boolean(first.b64_json),
    hasUrl: Boolean(first.url),
    outputMimeType: payload?.outputMimeType || first.mime_type || first.mimeType || null,
    outputFormat: payload?.outputFormat || null,
    hasError: Boolean(json?.error),
    errorKeys: json?.error ? Object.keys(json.error) : [],
  };
}

async function tryRequest({ env, pathOverride, authMode }) {
  const endpoint = buildImageGenerationEndpoint(env.GEMINI_OPENAI_BASE_URL, {
    generatePath: pathOverride,
    defaultFamily: 'gemini-openai',
    providerLabel: 'gemini-openai-compatible',
  });
  const auth = buildAuthRequest(endpoint, env.GEMINI_OPENAI_API_KEY, authMode);
  const body = {
    model: env.GEMINI_OPENAI_MODEL,
    prompt: env.GEMINI_OPENAI_PROBE_PROMPT || 'Generate one simple small image of a red square on white background.',
    n: 1,
    response_format: 'b64_json',
  };
  const started = Date.now();
  const res = await fetch(auth.url, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(env.GEMINI_OPENAI_PROBE_TIMEOUT_MS || 60000)),
  });
  const text = await readResponseText(res, 'gemini-openai probe', Number(env.GEMINI_OPENAI_PROBE_MAX_RESPONSE_BYTES || 8 * 1024 * 1024));
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { nonJson: true };
  }
  const payload = parseImageGenerationResponse(json);
  return {
    path: new URL(endpoint).pathname,
    authMode,
    status: res.status,
    ok: res.ok,
    elapsedMs: Date.now() - started,
    parsedB64Json: Boolean(payload?.b64),
    parsedUrl: Boolean(payload?.url),
    shape: responseShape(json),
    errorSummary: res.ok ? null : safeError(parseProviderError(json, res.status, 'gemini-openai-compatible')),
  };
}

async function main() {
  const { envFile, env } = loadEnv();
  const enabled = env.RUN_PROVIDER_INTEGRATION === '1';
  const required = ['GEMINI_OPENAI_BASE_URL', 'GEMINI_OPENAI_API_KEY', 'GEMINI_OPENAI_MODEL'];
  const missing = required.filter((key) => !env[key]);
  if (!enabled || missing.length) {
    console.log(JSON.stringify({
      skipped: true,
      reason: !enabled ? 'RUN_PROVIDER_INTEGRATION is not 1' : `missing ${missing.join(', ')}`,
      envFile,
      required,
    }, null, 2));
    return;
  }

  const defaultPaths = [
    '/v1beta/openai/images/generations',
    '/openai/images/generations',
    '/v1/images/generations',
    '/images/generations',
  ];
  const pathCandidates = [
    env.GEMINI_OPENAI_IMAGE_GENERATE_PATH,
    ...defaultPaths,
  ].filter(Boolean);
  const authCandidates = (env.GEMINI_OPENAI_PROBE_AUTH_MODES || env.GEMINI_OPENAI_AUTH_MODE || 'bearer,x-goog-api-key,query-key')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const results = [];
  for (const pathOverride of Array.from(new Set(pathCandidates))) {
    for (const authMode of authCandidates) {
      try {
        const result = await tryRequest({ env, pathOverride, authMode });
        results.push(result);
        if (result.ok && (result.parsedB64Json || result.parsedUrl)) {
          console.log(JSON.stringify({
            skipped: false,
            conclusion: 'OpenAI-compatible image response parsed',
            selected: result,
            tested: results,
          }, null, 2));
          return;
        }
      } catch (error) {
        results.push({
          path: String(pathOverride || '').replace(/\{model\}/g, '[model]'),
          authMode,
          ok: false,
          errorSummary: safeError(error?.message || error),
        });
      }
    }
  }
  console.log(JSON.stringify({
    skipped: false,
    conclusion: 'no tested Gemini OpenAI-compatible path/auth combination returned parsed image data',
    tested: results,
    next: '确认代理是否支持 /v1beta/openai/images/generations、Bearer 鉴权、response_format=b64_json。',
  }, null, 2));
}

main().catch((error) => {
  console.error(safeError(error?.message || error));
  process.exit(1);
});
