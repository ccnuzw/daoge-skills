const fs = require('fs');
const path = require('path');
const { sanitize, detectMimeType } = require('../domain/run_item');

const MAX_RESPONSE_TEXT_BYTES = 128 * 1024 * 1024;
const MAX_REFERENCE_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 120000;
const SUPPORTED_REFERENCE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function byteLimitLabel(bytes) {
  if (bytes < 1024 * 1024) return `${bytes}B`;
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function normalizeModelName(model) {
  return String(model || '').trim().replace(/^models\//, '');
}

function normalizePathPart(value) {
  const text = String(value || '').trim();
  return text.startsWith('/') ? text : `/${text}`;
}

function buildGenerateContentEndpoint(baseUrl, model, generatePath) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  const normalizedModel = encodeURIComponent(normalizeModelName(model));
  if (!normalizedBase) throw new Error('gemini-image provider missing GEMINI_IMAGE_BASE_URL');
  if (!normalizedModel) throw new Error('gemini-image provider missing GEMINI_IMAGE_MODEL');

  const pathOverride = String(generatePath || '').trim();
  if (pathOverride) {
    const replaced = pathOverride.replace(/\{model\}/g, normalizedModel);
    if (/^https?:\/\//i.test(replaced)) return replaced.replace(/\/+$/, '');
    return `${normalizedBase}${normalizePathPart(replaced)}`.replace(/\/+$/, '');
  }
  if (/\/models\/[^/]+:generateContent$/i.test(normalizedBase)) return normalizedBase;
  if (/\/v1(?:beta)?$/i.test(normalizedBase)) return `${normalizedBase}/models/${normalizedModel}:generateContent`;
  return `${normalizedBase}/v1beta/models/${normalizedModel}:generateContent`;
}

function redactEndpoint(url) {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has('key')) parsed.searchParams.set('key', '[REDACTED]');
    return parsed.toString();
  } catch {
    return String(url || '').replace(/([?&]key=)[^&]+/i, '$1[REDACTED]');
  }
}

function authModeFrom(value) {
  const normalized = String(value || 'x-goog-api-key').trim().toLowerCase();
  if (['x-goog-api-key', 'bearer', 'query-key'].includes(normalized)) return normalized;
  throw new Error(`gemini-image auth mode unsupported: ${normalized}. Supported: x-goog-api-key, bearer, query-key`);
}

function buildAuthRequest(endpoint, apiKey, authMode = 'x-goog-api-key') {
  if (!apiKey) throw new Error('gemini-image provider missing GEMINI_IMAGE_API_KEY');
  const mode = authModeFrom(authMode);
  const headers = { 'Content-Type': 'application/json' };
  let url = endpoint;
  if (mode === 'x-goog-api-key') headers['x-goog-api-key'] = apiKey;
  if (mode === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  if (mode === 'query-key') {
    const parsed = new URL(endpoint);
    parsed.searchParams.set('key', apiKey);
    url = parsed.toString();
  }
  return { url, headers, authMode: mode };
}

function getContentLength(res) {
  const raw = res.headers?.get?.('content-length');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function readResponseText(res, label, maxBytes = MAX_RESPONSE_TEXT_BYTES) {
  const contentLength = getContentLength(res);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error(`${label} response too large: ${byteLimitLabel(contentLength)} exceeds ${byteLimitLabel(maxBytes)}.`);
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    const bytes = Buffer.byteLength(text);
    if (bytes > maxBytes) {
      throw new Error(`${label} response too large: ${byteLimitLabel(bytes)} exceeds ${byteLimitLabel(maxBytes)}.`);
    }
    return text;
  }

  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? value : Buffer.from(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel?.();
      throw new Error(`${label} response too large: ${byteLimitLabel(totalBytes)} exceeds ${byteLimitLabel(maxBytes)}.`);
    }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function assertReferenceImage(filePath) {
  const absolutePath = path.resolve(filePath);
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    throw new Error(`reference file not found: ${absolutePath}`);
  }
  if (!stat.isFile()) throw new Error(`reference file not found: ${absolutePath}`);
  if (stat.size > MAX_REFERENCE_FILE_BYTES) {
    throw new Error(`reference image too large: ${absolutePath} is ${byteLimitLabel(stat.size)}, max ${byteLimitLabel(MAX_REFERENCE_FILE_BYTES)}`);
  }
  const mimeType = detectMimeType(absolutePath);
  if (!SUPPORTED_REFERENCE_MIME_TYPES.includes(mimeType)) {
    throw new Error(`gemini-image reference image mime unsupported: ${mimeType}. Supported: ${SUPPORTED_REFERENCE_MIME_TYPES.join(', ')}`);
  }
  return { absolutePath, mimeType };
}

function buildGeminiParts({ prompt, referenceImages = [], referenceImagesEnabled = false }) {
  const parts = [{ text: prompt }];
  if (!referenceImages.length) return parts;
  if (!referenceImagesEnabled) {
    throw new Error('gemini-image reference image support is disabled. Set GEMINI_IMAGE_ENABLE_REFERENCE=1 only after provider probe confirms inlineData image input works.');
  }
  referenceImages.forEach((imagePath) => {
    const { absolutePath, mimeType } = assertReferenceImage(imagePath);
    parts.push({
      inlineData: {
        mimeType,
        data: fs.readFileSync(absolutePath).toString('base64'),
      },
    });
  });
  return parts;
}

function buildGenerateContentBody({ prompt, referenceImages, referenceImagesEnabled }) {
  return {
    contents: [
      {
        role: 'user',
        parts: buildGeminiParts({ prompt, referenceImages, referenceImagesEnabled }),
      },
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };
}

function extractGeminiImagePayload(json) {
  const candidates = Array.isArray(json?.candidates) ? json.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part.inlineData || part.inline_data;
      if (inlineData?.data) {
        return {
          b64: inlineData.data,
          mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
          text: part.text || null,
        };
      }
    }
  }
  if (json?.inlineData?.data || json?.inline_data?.data) {
    const inlineData = json.inlineData || json.inline_data;
    return {
      b64: inlineData.data,
      mimeType: inlineData.mimeType || inlineData.mime_type || 'image/png',
      text: null,
    };
  }
  return null;
}

function parseGeminiError(json, status) {
  const error = json?.error || {};
  const code = error.code || status;
  const state = error.status || '';
  const message = error.message || json?.message || 'gemini-image request failed';
  if (status === 401 || status === 403) return `authentication failed (${status}): ${sanitize(message)}`;
  if (status === 404) return `model or endpoint unavailable (${status}): ${sanitize(message)}`;
  return `${state ? `${state} ` : ''}http ${code}: ${sanitize(message)}`;
}

function isRetryableError(status, json = {}) {
  const geminiStatus = String(json?.error?.status || '').toUpperCase();
  return [408, 409, 429, 500, 502, 503, 504].includes(Number(status))
    || ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'DEADLINE_EXCEEDED', 'ABORTED'].includes(geminiStatus);
}

function responseSizeFromMime(mimeType) {
  if (!mimeType) return null;
  if (/png/i.test(mimeType)) return 'png';
  if (/jpe?g/i.test(mimeType)) return 'jpeg';
  if (/webp/i.test(mimeType)) return 'webp';
  return mimeType;
}

function outputFormatFromMime(mimeType) {
  const value = responseSizeFromMime(mimeType);
  if (value === 'jpeg' || value === 'png' || value === 'webp') return value;
  return null;
}

function positiveNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

async function requestGeminiImage({
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs,
  generatePath,
  authMode,
  referenceImages = [],
  referenceImagesEnabled = false,
  maxResponseBytes = MAX_RESPONSE_TEXT_BYTES,
}) {
  const requestTimeoutMs = positiveNumber(timeoutMs, DEFAULT_TIMEOUT_MS);
  const responseLimitBytes = positiveNumber(maxResponseBytes, MAX_RESPONSE_TEXT_BYTES);
  const endpoint = buildGenerateContentEndpoint(baseUrl, model, generatePath);
  const auth = buildAuthRequest(endpoint, apiKey, authMode);
  const body = buildGenerateContentBody({ prompt, referenceImages, referenceImagesEnabled });
  let res;
  try {
    res = await fetch(auth.url, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${redactEndpoint(auth.url)}: ${sanitize(error?.message || error)}`);
  }

  const text = await readResponseText(res, 'gemini image generation', responseLimitBytes);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`gemini-image non-json response (${res.status}): ${text.slice(0, 300)}`);
  }

  const payload = extractGeminiImagePayload(json);
  if (!res.ok) {
    const retryable = isRetryableError(res.status, json) ? ' retryable' : '';
    throw new Error(`gemini-image${retryable} ${parseGeminiError(json, res.status)}`);
  }
  if (!payload?.b64) {
    throw new Error('gemini-image response format incompatible: missing candidates[].content.parts[].inlineData.data');
  }
  return {
    b64: payload.b64,
    revisedPrompt: payload.text || null,
    responseSize: responseSizeFromMime(payload.mimeType),
    outputFormat: outputFormatFromMime(payload.mimeType),
    outputMimeType: payload.mimeType,
    responseModel: model,
  };
}

function capabilities(options = {}) {
  return {
    provider: 'gemini-image',
    generate: true,
    edit: Boolean(options.referenceImagesEnabled),
    maskEdit: false,
    referenceImages: Boolean(options.referenceImagesEnabled),
    referenceInputMimeTypes: SUPPORTED_REFERENCE_MIME_TYPES,
    outputFormats: ['inlineData.data base64'],
    sizeEffective: false,
    qualityEffective: false,
    timeoutMs: options.timeoutMs || null,
    maxResponseBytes: Number(options.maxResponseBytes || MAX_RESPONSE_TEXT_BYTES),
    retryableError: 'HTTP 408/409/429/5xx or Gemini RESOURCE_EXHAUSTED/UNAVAILABLE/DEADLINE_EXCEEDED/ABORTED',
  };
}

async function generate(request = {}) {
  return requestGeminiImage(request);
}

async function edit(request = {}) {
  if (request.maskImage) {
    throw new Error('gemini-image provider does not support mask edit');
  }
  return requestGeminiImage(request);
}

module.exports = {
  MAX_RESPONSE_TEXT_BYTES,
  DEFAULT_TIMEOUT_MS,
  SUPPORTED_REFERENCE_MIME_TYPES,
  buildGenerateContentEndpoint,
  buildAuthRequest,
  buildGenerateContentBody,
  extractGeminiImagePayload,
  parseGeminiError,
  isRetryableError,
  readResponseText,
  outputFormatFromMime,
  requestGeminiImage,
  generate,
  edit,
  capabilities,
};
