const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildGenerateContentEndpoint,
  buildAuthRequest,
  buildGenerateContentBody,
  extractGeminiImagePayload,
  parseGeminiError,
  isRetryableError,
  readResponseText,
  requestGeminiImage,
} = require('../../src/providers/gemini_image');
const { makeTempDir, writeTinyPng } = require('../helpers/workspace_v2_test_utils');

test('Gemini provider builds native generateContent endpoint', () => {
  assert.equal(
    buildGenerateContentEndpoint('https://example.com', 'gemini-test-image'),
    'https://example.com/v1beta/models/gemini-test-image:generateContent'
  );
  assert.equal(
    buildGenerateContentEndpoint('https://example.com/v1', 'models/gemini-test-image'),
    'https://example.com/v1/models/gemini-test-image:generateContent'
  );
  assert.equal(
    buildGenerateContentEndpoint('https://example.com', 'gemini-test-image', '/custom/models/{model}:generateContent'),
    'https://example.com/custom/models/gemini-test-image:generateContent'
  );
});

test('Gemini provider supports explicit auth modes', () => {
  const header = buildAuthRequest('https://example.com/v1beta/models/m:generateContent', 'secret', 'x-goog-api-key');
  assert.equal(header.headers['x-goog-api-key'], 'secret');
  const bearer = buildAuthRequest('https://example.com/v1beta/models/m:generateContent', 'secret', 'bearer');
  assert.equal(bearer.headers.Authorization, 'Bearer secret');
  const query = buildAuthRequest('https://example.com/v1beta/models/m:generateContent', 'secret', 'query-key');
  assert.match(query.url, /[?&]key=secret/);
});

test('Gemini provider request body uses text prompt and image modality', () => {
  const body = buildGenerateContentBody({
    prompt: 'draw test',
    referenceImages: [],
    referenceImagesEnabled: false,
  });
  assert.equal(body.contents[0].parts[0].text, 'draw test');
  assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
});

test('Gemini provider parses inlineData image response', () => {
  const payload = extractGeminiImagePayload({
    candidates: [{
      content: {
        parts: [
          { text: 'ok' },
          { inlineData: { mimeType: 'image/png', data: 'YWJj' } },
        ],
      },
    }],
  });
  assert.equal(payload.b64, 'YWJj');
  assert.equal(payload.mimeType, 'image/png');
});

test('Gemini provider maps response mime type to output format', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{ inlineData: { mimeType: 'image/jpeg', data: Buffer.from('ok').toString('base64') } }],
      },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const result = await requestGeminiImage({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    });
    assert.equal(result.outputFormat, 'jpeg');
    assert.equal(result.outputMimeType, 'image/jpeg');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini provider parses error and retryable status', () => {
  const json = { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'rate limited' } };
  assert.match(parseGeminiError(json, 429), /RESOURCE_EXHAUSTED http 429/);
  assert.equal(isRetryableError(429, json), true);
  assert.equal(isRetryableError(401, { error: { status: 'UNAUTHENTICATED' } }), false);
});

test('Gemini provider caps streamed responses without content-length', async () => {
  let cancelled = false;
  const response = {
    headers: { get: () => null },
    body: {
      getReader: () => ({
        async read() {
          return this.done
            ? { done: true }
            : (this.done = true, { done: false, value: Buffer.from('abcd') });
        },
        async cancel() {
          cancelled = true;
        },
      }),
    },
  };
  await assert.rejects(() => readResponseText(response, 'gemini test', 3), /response too large/);
  assert.equal(cancelled, true);
});

test('Gemini provider rejects reference images unless probe-enabled', async () => {
  const tempDir = makeTempDir();
  const reference = path.join(tempDir, 'reference.png');
  writeTinyPng(reference);
  try {
    assert.throws(() => buildGenerateContentBody({
      prompt: 'draw test',
      referenceImages: [reference],
      referenceImagesEnabled: false,
    }), /reference image support is disabled/);
    const body = buildGenerateContentBody({
      prompt: 'draw test',
      referenceImages: [reference],
      referenceImagesEnabled: true,
    });
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/png');
    assert.equal(typeof body.contents[0].parts[1].inlineData.data, 'string');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Gemini provider request uses native body and parses response', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('ok').toString('base64') } }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await requestGeminiImage({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    });
    assert.equal(result.b64, Buffer.from('ok').toString('base64'));
    assert.match(captured.url, /\/v1beta\/models\/gemini-test-image:generateContent$/);
    assert.equal(captured.options.headers['x-goog-api-key'], 'test-key');
    const body = JSON.parse(captured.options.body);
    assert.equal(body.contents[0].parts[0].text, 'draw test');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini provider uses default timeout when request omits timeoutMs', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('ok').toString('base64') } }],
        },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await requestGeminiImage({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
    });
    assert.equal(captured.options.signal instanceof AbortSignal, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini provider rejects incompatible successful response shape', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'no image' }] } }] }), { status: 200 });
  try {
    await assert.rejects(() => requestGeminiImage({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    }), /response format incompatible/);
  } finally {
    global.fetch = originalFetch;
  }
});
