const { sanitize } = require('../domain/run_item');
const net = require('net');
const dns = require('dns');
const http = require('http');
const https = require('https');

const DEFAULT_TIMEOUT_MS = 120000;
const MAX_RESPONSE_TEXT_BYTES = 128 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS = 3;

function byteLimitLabel(bytes) {
  if (bytes < 1024 * 1024) return `${bytes}B`;
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

function positiveNumber(value, fallback) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : fallback;
}

function normalizePathPart(value) {
  const text = String(value || '').trim();
  return text.startsWith('/') ? text : `/${text}`;
}

function buildImageGenerationEndpoint(baseUrl, options = {}) {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalizedBase) throw new Error(`${options.providerLabel || 'provider'} missing base URL`);

  const generatePath = String(options.generatePath || '').trim();
  if (generatePath) {
    if (/^https?:\/\//i.test(generatePath)) return generatePath.replace(/\/+$/, '');
    return `${normalizedBase}${normalizePathPart(generatePath)}`.replace(/\/+$/, '');
  }

  if (/\/images\/generations$/i.test(normalizedBase)) return normalizedBase;
  if (options.defaultFamily === 'gemini-openai') {
    if (/\/openai$/i.test(normalizedBase)) return `${normalizedBase}/images/generations`;
    if (/\/v1(?:beta)?$/i.test(normalizedBase)) return `${normalizedBase}/openai/images/generations`;
    return `${normalizedBase}/v1beta/openai/images/generations`;
  }
  if (/\/v1$/i.test(normalizedBase)) return `${normalizedBase}/images/generations`;
  return `${normalizedBase}/images/generations`;
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
  const normalized = String(value || 'bearer').trim().toLowerCase();
  if (['bearer', 'x-goog-api-key', 'query-key'].includes(normalized)) return normalized;
  throw new Error(`OpenAI-style image auth mode unsupported: ${normalized}`);
}

function buildAuthRequest(endpoint, apiKey, authMode = 'bearer') {
  if (!apiKey) throw new Error('OpenAI-style image provider missing API key');
  const mode = authModeFrom(authMode);
  const headers = { 'Content-Type': 'application/json' };
  let url = endpoint;
  if (mode === 'bearer') headers.Authorization = `Bearer ${apiKey}`;
  if (mode === 'x-goog-api-key') headers['x-goog-api-key'] = apiKey;
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
  const limit = positiveNumber(maxBytes, MAX_RESPONSE_TEXT_BYTES);
  const contentLength = getContentLength(res);
  if (contentLength !== null && contentLength > limit) {
    throw new Error(`${label} response too large: ${byteLimitLabel(contentLength)} exceeds ${byteLimitLabel(limit)}.`);
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const text = await res.text();
    const bytes = Buffer.byteLength(text);
    if (bytes > limit) {
      throw new Error(`${label} response too large: ${byteLimitLabel(bytes)} exceeds ${byteLimitLabel(limit)}.`);
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
    if (totalBytes > limit) {
      await reader.cancel?.();
      throw new Error(`${label} response too large: ${byteLimitLabel(totalBytes)} exceeds ${byteLimitLabel(limit)}.`);
    }
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

async function readResponseBuffer(res, label, maxBytes = MAX_DOWNLOAD_BYTES) {
  const limit = positiveNumber(maxBytes, MAX_DOWNLOAD_BYTES);
  const contentLength = getContentLength(res);
  if (contentLength !== null && contentLength > limit) {
    throw new Error(`${label} download too large: ${byteLimitLabel(contentLength)} exceeds ${byteLimitLabel(limit)}.`);
  }
  const reader = res.body?.getReader?.();
  if (!reader) {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > limit) {
      throw new Error(`${label} download too large: ${byteLimitLabel(buffer.byteLength)} exceeds ${byteLimitLabel(limit)}.`);
    }
    return buffer;
  }

  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value instanceof Uint8Array ? Buffer.from(value) : Buffer.from(value);
    totalBytes += chunk.byteLength;
    if (totalBytes > limit) {
      await reader.cancel?.();
      throw new Error(`${label} download too large: ${byteLimitLabel(totalBytes)} exceeds ${byteLimitLabel(limit)}.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(value || ''));
  if (!match) return null;
  return { mimeType: match[1], b64: match[2] };
}

function inferMimeFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer.slice(1, 4).toString('ascii') === 'PNG') return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function inferMimeFromBase64(value) {
  try {
    return inferMimeFromBuffer(Buffer.from(String(value || '').slice(0, 64), 'base64'));
  } catch {
    return null;
  }
}

function inferOutputFormatFromMime(mimeType) {
  if (/png/i.test(mimeType || '')) return 'png';
  if (/jpe?g/i.test(mimeType || '')) return 'jpeg';
  if (/webp/i.test(mimeType || '')) return 'webp';
  return null;
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!normalized) return true;
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  if (normalized === 'metadata.google.internal') return true;
  if (normalized === 'metadata' || normalized.endsWith('.metadata')) return true;
  return false;
}

function isPrivateIpv4(hostname) {
  const parts = String(hostname || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return false;
}

function isNonGlobalIpv4(hostname) {
  const parts = String(hostname || '').split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c, d] = parts;
  if (isPrivateIpv4(hostname)) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  if (a === 255 && b === 255 && c === 255 && d === 255) return true;
  return false;
}

function expandIpv6(address) {
  const normalized = String(address || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized.includes(':')) return null;
  const [headRaw, tailRaw] = normalized.split('::');
  const head = headRaw ? headRaw.split(':').filter(Boolean) : [];
  const tail = tailRaw ? tailRaw.split(':').filter(Boolean) : [];
  const convertPart = (part) => {
    if (!part.includes('.')) return [part];
    const pieces = part.split('.').map((item) => Number(item));
    if (pieces.length !== 4 || pieces.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) return [part];
    return [
      ((pieces[0] << 8) | pieces[1]).toString(16),
      ((pieces[2] << 8) | pieces[3]).toString(16),
    ];
  };
  const expandedHead = head.flatMap(convertPart);
  const expandedTail = tail.flatMap(convertPart);
  const fill = normalized.includes('::') ? Array(Math.max(0, 8 - expandedHead.length - expandedTail.length)).fill('0') : [];
  const parts = [...expandedHead, ...fill, ...expandedTail];
  if (parts.length !== 8) return null;
  const values = parts.map((part) => Number.parseInt(part || '0', 16));
  if (values.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff)) return null;
  return values;
}

function ipv4FromMappedIpv6(parts) {
  if (!Array.isArray(parts) || parts.length !== 8) return null;
  const isMapped = parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff;
  if (!isMapped) return null;
  return [
    (parts[6] >> 8) & 0xff,
    parts[6] & 0xff,
    (parts[7] >> 8) & 0xff,
    parts[7] & 0xff,
  ].join('.');
}

function isPrivateIpv6(hostname) {
  const parts = expandIpv6(hostname);
  if (!parts) return false;
  if (parts.every((part) => part === 0) || (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1)) return true;
  if ((parts[0] & 0xffc0) === 0xfe80) return true;
  if ((parts[0] & 0xfe00) === 0xfc00) return true;
  const mapped = ipv4FromMappedIpv6(parts);
  return mapped ? isPrivateIpv4(mapped) : false;
}

function isNonGlobalIpv6(hostname) {
  const parts = expandIpv6(hostname);
  if (!parts) return false;
  if (isPrivateIpv6(hostname)) return true;
  if ((parts[0] & 0xff00) === 0xff00) return true;
  // 图片下载只允许公网目标；NAT64 前缀可编码 IPv4，保守拒绝转换地址。
  if (parts[0] === 0x0064 && parts[1] === 0xff9b) return true;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return true;
  if (parts[0] === 0x2001 && parts[1] === 0x0002 && parts[2] === 0) return true;
  if (parts[0] === 0x2001 && (parts[1] & 0xfff0) === 0x0010) return true;
  if (parts[0] === 0x2001 && (parts[1] & 0xfff0) === 0x0020) return true;
  if (parts[0] === 0x2001 && parts[1] === 0) return true;
  if (parts[0] === 0x2002) return true;
  if (parts[0] === 0x3ffe) return true;
  if (parts[0] === 0x3fff && (parts[1] & 0xf000) === 0x0000) return true;
  if (parts[0] === 0x0100 && parts[1] === 0 && parts[2] === 0 && parts[3] === 0) return true;
  const mapped = ipv4FromMappedIpv6(parts);
  return mapped ? isNonGlobalIpv4(mapped) : false;
}

function assertAllowedResolvedRecords(hostname, records = []) {
  if (!records.length) {
    throw new Error(`image download rejected: DNS lookup returned no address for ${hostname}`);
  }
  for (const record of records) {
    const address = String(record?.address || '').replace(/^\[|\]$/g, '');
    if (net.isIP(address) === 4 && isNonGlobalIpv4(address)) {
      throw new Error(`image download rejected: hostname ${hostname} resolves to blocked private IPv4/non-global ${address}`);
    }
    if (net.isIP(address) === 6 && isNonGlobalIpv6(address)) {
      throw new Error(`image download rejected: hostname ${hostname} resolves to blocked private IPv6/non-global ${address}`);
    }
  }
}

function checkedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, records = []) => {
    if (error) {
      callback(error);
      return;
    }
    try {
      assertAllowedResolvedRecords(hostname, records);
    } catch (validationError) {
      callback(validationError);
      return;
    }
    const preferredFamily = options?.family;
    const selected = records.find((record) => !preferredFamily || record.family === preferredFamily) || records[0];
    callback(null, selected.address, selected.family);
  });
}

function validateDownloadUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('image download rejected: invalid URL');
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`image download rejected: unsupported URL protocol ${parsed.protocol || 'missing'}`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    throw new Error(`image download rejected: blocked hostname ${hostname || 'missing'}`);
  }
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4 && isNonGlobalIpv4(hostname)) {
    throw new Error(`image download rejected: blocked private IPv4/non-global ${hostname}`);
  }
  if (ipVersion === 6 && isNonGlobalIpv6(hostname)) {
    throw new Error(`image download rejected: blocked private IPv6/non-global ${hostname}`);
  }
  return parsed.toString();
}

function parseImageGenerationResponse(json) {
  const directData = json?.data?.[0] || {};
  const rawB64 = directData.b64_json || directData.base64 || directData.image_base64 || null;
  if (rawB64) {
    const dataUrl = parseDataUrl(rawB64);
    const b64 = dataUrl?.b64 || rawB64;
    const mimeType = dataUrl?.mimeType || directData.mime_type || directData.mimeType || inferMimeFromBase64(b64);
    return {
      b64,
      url: null,
      revisedPrompt: directData.revised_prompt || null,
      outputMimeType: mimeType || null,
      outputFormat: inferOutputFormatFromMime(mimeType),
    };
  }
  if (directData.url) {
    return {
      b64: null,
      url: directData.url,
      revisedPrompt: directData.revised_prompt || null,
      outputMimeType: directData.mime_type || directData.mimeType || null,
      outputFormat: inferOutputFormatFromMime(directData.mime_type || directData.mimeType),
    };
  }
  return null;
}

function parseProviderError(json, status, providerLabel) {
  const error = json?.error || {};
  const message = error.message || json?.message || `${providerLabel} request failed`;
  const code = error.code || error.type || status;
  if (status === 401 || status === 403) return `authentication failed (${status}): ${sanitize(message)}`;
  if (status === 404) return `model or endpoint unavailable (${status}): ${sanitize(message)}`;
  return `http ${status} ${sanitize(code)}: ${sanitize(message)}`;
}

async function readNodeResponseBuffer(res, label, maxBytes = MAX_DOWNLOAD_BYTES) {
  const limit = positiveNumber(maxBytes, MAX_DOWNLOAD_BYTES);
  const contentLength = Number(res.headers?.['content-length']);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    res.resume?.();
    res.destroy?.();
    throw new Error(`${label} download too large: ${byteLimitLabel(contentLength)} exceeds ${byteLimitLabel(limit)}.`);
  }
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of res) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > limit) {
      res.destroy?.();
      throw new Error(`${label} download too large: ${byteLimitLabel(totalBytes)} exceeds ${byteLimitLabel(limit)}.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function releaseNodeResponse(res) {
  res?.resume?.();
  res?.destroy?.();
}

function requestDownloadOnce(url, timeoutMs, providerLabel) {
  const safeUrl = validateDownloadUrl(url);
  const parsed = new URL(safeUrl);
  const client = parsed.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(parsed, {
      method: 'GET',
      lookup: checkedLookup,
      timeout: timeoutMs,
    }, (res) => {
      resolve({ res, safeUrl });
    });
    req.on('timeout', () => req.destroy(new Error(`${providerLabel} image download timed out`)));
    req.on('error', reject);
    req.end();
  });
}

async function downloadImageUrlToBase64({
  url,
  timeoutMs,
  maxDownloadBytes = MAX_DOWNLOAD_BYTES,
  providerLabel = 'image provider',
}) {
  const requestTimeoutMs = positiveNumber(timeoutMs, DEFAULT_TIMEOUT_MS);
  let currentUrl = String(url || '');
  let res;
  for (let redirectCount = 0; redirectCount <= MAX_DOWNLOAD_REDIRECTS; redirectCount += 1) {
    let safeUrl;
    try {
      ({ res, safeUrl } = await requestDownloadOnce(currentUrl, requestTimeoutMs, providerLabel));
    } catch (error) {
      throw new Error(`${providerLabel} image download failed: ${sanitize(error?.message || error)}`);
    }
    if (![301, 302, 303, 307, 308].includes(Number(res.statusCode))) break;
    const location = res.headers?.location;
    if (!location) {
      releaseNodeResponse(res);
      throw new Error(`${providerLabel} image download failed: redirect ${res.statusCode} missing Location header`);
    }
    if (redirectCount === MAX_DOWNLOAD_REDIRECTS) {
      releaseNodeResponse(res);
      throw new Error(`${providerLabel} image download failed: too many redirects`);
    }
    releaseNodeResponse(res);
    currentUrl = new URL(location, safeUrl).toString();
  }
  const contentType = String(res.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (Number(res.statusCode) < 200 || Number(res.statusCode) >= 300) {
    releaseNodeResponse(res);
    throw new Error(`${providerLabel} image download failed: http ${res.statusCode}`);
  }
  if (!/^image\//i.test(contentType)) {
    releaseNodeResponse(res);
    throw new Error(`${providerLabel} image download rejected: content-type ${contentType || 'missing'} is not image/*`);
  }
  const bodyTimeout = setTimeout(() => {
    res.destroy?.(new Error(`${providerLabel} image download timed out while reading response body`));
  }, requestTimeoutMs);
  let buffer;
  try {
    buffer = await readNodeResponseBuffer(res, `${providerLabel} image`, maxDownloadBytes);
  } finally {
    clearTimeout(bodyTimeout);
  }
  const inferredMime = contentType || inferMimeFromBuffer(buffer);
  return {
    b64: buffer.toString('base64'),
    outputMimeType: inferredMime,
    outputFormat: inferOutputFormatFromMime(inferredMime),
  };
}

async function requestOpenAiStyleImage({
  baseUrl,
  apiKey,
  model,
  prompt,
  timeoutMs,
  generatePath,
  authMode = 'bearer',
  responseFormat,
  extraBody = {},
  maxResponseBytes = MAX_RESPONSE_TEXT_BYTES,
  maxDownloadBytes = MAX_DOWNLOAD_BYTES,
  providerLabel = 'OpenAI-style image provider',
  defaultFamily = 'openai-style',
}) {
  const endpoint = buildImageGenerationEndpoint(baseUrl, { generatePath, providerLabel, defaultFamily });
  const auth = buildAuthRequest(endpoint, apiKey, authMode);
  const body = {
    model,
    prompt,
    n: 1,
    ...extraBody,
  };
  if (responseFormat) body.response_format = responseFormat;

  let res;
  try {
    res = await fetch(auth.url, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(positiveNumber(timeoutMs, DEFAULT_TIMEOUT_MS)),
    });
  } catch (error) {
    throw new Error(`fetch failed for ${redactEndpoint(auth.url)}: ${sanitize(error?.message || error)}`);
  }

  const text = await readResponseText(res, providerLabel, maxResponseBytes);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${providerLabel} non-json response (${res.status}): ${sanitize(text.slice(0, 300))}`);
  }
  if (!res.ok) {
    throw new Error(`${providerLabel} ${parseProviderError(json, res.status, providerLabel)}`);
  }

  const payload = parseImageGenerationResponse(json);
  if (!payload) {
    throw new Error(`${providerLabel} response format incompatible: missing data[0].b64_json or data[0].url`);
  }

  if (payload.b64) {
    return {
      b64: payload.b64,
      revisedPrompt: payload.revisedPrompt,
      responseSize: json.size || null,
      responseModel: json.model || model,
      outputFormat: payload.outputFormat,
      outputMimeType: payload.outputMimeType,
    };
  }

  const downloaded = await downloadImageUrlToBase64({
    url: payload.url,
    timeoutMs,
    maxDownloadBytes,
    providerLabel,
  });
  return {
    b64: downloaded.b64,
    revisedPrompt: payload.revisedPrompt,
    responseSize: json.size || null,
    responseModel: json.model || model,
    outputFormat: downloaded.outputFormat || payload.outputFormat,
    outputMimeType: downloaded.outputMimeType || payload.outputMimeType,
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_RESPONSE_TEXT_BYTES,
  MAX_DOWNLOAD_BYTES,
  buildImageGenerationEndpoint,
  buildAuthRequest,
  readResponseText,
  readResponseBuffer,
  parseImageGenerationResponse,
  inferOutputFormatFromMime,
  validateDownloadUrl,
  isNonGlobalIpv4,
  isNonGlobalIpv6,
  downloadImageUrlToBase64,
  requestOpenAiStyleImage,
  parseProviderError,
};
