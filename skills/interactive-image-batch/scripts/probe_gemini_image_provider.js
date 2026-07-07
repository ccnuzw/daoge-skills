#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { parseEnvFile } = require('../src/shared/env');
const {
  buildGenerateContentEndpoint,
  buildAuthRequest,
  buildGenerateContentBody,
  extractGeminiImagePayload,
  parseGeminiError,
  isRetryableError,
  readResponseText,
} = require('../src/providers/gemini_image');

function candidateEnvFiles() {
  const explicit = process.argv[2] || process.env.GEMINI_IMAGE_ENV_FILE;
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

function responseShape(json) {
  const parts = Array.isArray(json?.candidates?.[0]?.content?.parts)
    ? json.candidates[0].content.parts
    : [];
  const firstPart = parts[0] || {};
  const inlinePart = parts.find((part) => part?.inlineData?.data || part?.inline_data?.data) || {};
  const inlineData = inlinePart.inlineData || inlinePart.inline_data || null;
  return {
    hasCandidates: Array.isArray(json?.candidates),
    candidateCount: Array.isArray(json?.candidates) ? json.candidates.length : 0,
    firstPartKeys: Object.keys(firstPart),
    hasInlineData: Boolean(inlineData?.data),
    inlineMimeType: inlineData?.mimeType || inlineData?.mime_type || null,
    hasError: Boolean(json?.error),
    errorKeys: json?.error ? Object.keys(json.error) : [],
  };
}

async function tryRequest({ env, pathOverride, authMode }) {
  const endpoint = buildGenerateContentEndpoint(env.GEMINI_IMAGE_BASE_URL, env.GEMINI_IMAGE_MODEL, pathOverride);
  const auth = buildAuthRequest(endpoint, env.GEMINI_IMAGE_API_KEY, authMode);
  const body = buildGenerateContentBody({
    prompt: env.GEMINI_IMAGE_PROBE_PROMPT || 'Generate one simple small image of a red square on white background.',
    referenceImages: [],
    referenceImagesEnabled: false,
  });
  const started = Date.now();
  const res = await fetch(auth.url, {
    method: 'POST',
    headers: auth.headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(env.GEMINI_IMAGE_PROBE_TIMEOUT_MS || 60000)),
  });
  const text = await readResponseText(res, 'gemini probe', Number(env.GEMINI_IMAGE_PROBE_MAX_RESPONSE_BYTES || 8 * 1024 * 1024));
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { nonJson: true };
  }
  const payload = extractGeminiImagePayload(json);
  return {
    path: new URL(endpoint).pathname,
    authMode,
    status: res.status,
    ok: res.ok,
    elapsedMs: Date.now() - started,
    retryable: isRetryableError(res.status, json),
    shape: responseShape(json),
    parsedImage: Boolean(payload?.b64),
    parsedMimeType: payload?.mimeType || null,
    errorSummary: res.ok ? null : parseGeminiError(json, res.status),
  };
}

async function main() {
  const { envFile, env } = loadEnv();
  const enabled = env.RUN_PROVIDER_INTEGRATION === '1';
  const required = ['GEMINI_IMAGE_BASE_URL', 'GEMINI_IMAGE_API_KEY', 'GEMINI_IMAGE_MODEL'];
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

  const pathCandidates = (env.GEMINI_IMAGE_PROBE_PATHS || env.GEMINI_IMAGE_GENERATE_PATH || '/v1beta/models/{model}:generateContent,/v1/models/{model}:generateContent')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const authCandidates = (env.GEMINI_IMAGE_AUTH_MODE || env.GEMINI_IMAGE_PROBE_AUTH_MODES || 'x-goog-api-key,bearer,query-key')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const results = [];
  for (const pathOverride of pathCandidates) {
    for (const authMode of authCandidates) {
      try {
        const result = await tryRequest({ env, pathOverride, authMode });
        results.push(result);
        if (result.ok && result.parsedImage) {
          console.log(JSON.stringify({
            skipped: false,
            conclusion: 'generateContent image response parsed',
            selected: result,
            tested: results,
          }, null, 2));
          return;
        }
      } catch (error) {
        results.push({
          path: pathOverride.replace(/\{model\}/g, '[model]'),
          authMode,
          ok: false,
          errorSummary: String(error?.message || error).replace(/([?&]key=)[^&]+/i, '$1[REDACTED]'),
        });
      }
    }
  }
  console.log(JSON.stringify({
    skipped: false,
    conclusion: 'no tested Gemini endpoint/auth combination returned parsed inline image data',
    tested: results,
    next: '确认代理是否支持 Gemini 原生 generateContent，或提供 GEMINI_IMAGE_GENERATE_PATH / GEMINI_IMAGE_AUTH_MODE。',
  }, null, 2));
}

main().catch((error) => {
  console.error(String(error?.message || error).replace(/([?&]key=)[^&]+/i, '$1[REDACTED]'));
  process.exit(1);
});
