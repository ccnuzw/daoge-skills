const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createImageProvider } = require('../../dist/vnext/providers/http-adapters');

const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTDQAAAABJRU5ErkJggg==';
const png = Buffer.from(pngBase64, 'base64');

async function withServer(handler, operation) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;
  try {
    return await operation(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function responseFor(providerId) {
  if (providerId === 'gemini-image') {
    return { candidates: [{ content: { parts: [{ inlineData: { data: pngBase64, mimeType: 'image/png' } }] } }] };
  }
  return { created: 1, model: 'fixture-model', data: [{ b64_json: pngBase64, revised_prompt: 'fixture revised prompt' }] };
}

for (const providerId of ['openai-images', 'gemini-image', 'gemini-openai-compatible', 'xai-grok-image']) {
  test('vNext adapter generates image bytes through ' + providerId, async () => {
    const received = [];
    await withServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        received.push({ url: request.url, authorization: request.headers.authorization || null, apiKey: request.headers['x-goog-api-key'] || null, body: JSON.parse(body) });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(responseFor(providerId)));
      });
    }, async (baseUrl) => {
      const config = { providerId, baseUrl, apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false };
      const provider = createImageProvider(config);
      const result = await provider.generate({ requestId: 'request-1', idempotencyKey: 'idempotency-1', prompt: 'fixture prompt', output: { size: '1024x1024', format: 'png' }, referenceAssets: [] }, { abortSignal: new AbortController().signal });
      assert.deepEqual(result.bytes, png);
      assert.equal(result.mediaType, 'image/png');
      assert.equal(provider.validateConfig(config).valid, true);
      assert.equal(provider.capabilities(config).textToImage, true);
      assert.equal(provider.capabilities(config).referenceEdit, providerId === 'openai-images');
      assert.equal(result.safeMeta.requestPath, providerId === 'gemini-image' ? '/v1beta/models/fixture-model:generateContent' : '/v1/images/generations');
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].body.prompt || received[0].body.contents?.[0]?.parts?.[0]?.text, 'fixture prompt');
    if (providerId === 'gemini-image') {
      assert.equal(received[0].apiKey, 'fixture-key');
      assert.equal(received[0].url, '/v1beta/models/fixture-model:generateContent');
    } else {
      assert.equal(received[0].authorization, 'Bearer fixture-key');
      assert.equal(received[0].url, '/v1/images/generations');
    }
  });
}


test('vNext OpenAI adapter sends managed reference and mask bytes as multipart editing input', async () => {
  let received = null;
  await withServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      received = { url: request.url, contentType: request.headers['content-type'], authorization: request.headers.authorization, body: Buffer.concat(chunks) };
      response.writeHead(200, { 'content-type': 'application/json', 'x-request-id': 'edit-request-1' });
      response.end(JSON.stringify(responseFor('openai-images')));
    });
  }, async (baseUrl) => {
    const config = { providerId: 'openai-images', baseUrl, apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false };
    const provider = createImageProvider(config);
    const result = await provider.edit({ requestId: 'request-edit', idempotencyKey: 'edit-key', prompt: 'replace backdrop', output: { size: '1024x1024' }, referenceAssets: [{ assetId: 'asset-reference', mediaType: 'image/png', bytes: png }], maskAsset: { assetId: 'asset-mask', mediaType: 'image/png', bytes: png } }, { abortSignal: new AbortController().signal });
    assert.deepEqual(result.bytes, png);
    assert.equal(result.safeMeta.managedReferenceCount, 1);
    assert.equal(result.safeMeta.usedMask, true);
  });
  assert.equal(received.url, '/v1/images/edits');
  assert.equal(received.authorization, 'Bearer fixture-key');
  assert.match(received.contentType, /^multipart\/form-data; boundary=/);
  assert.equal(received.body.includes(Buffer.from('asset-reference.png')), true);
  assert.equal(received.body.includes(Buffer.from('asset-mask.png')), true);
});


test('vNext adapters forward requested aspect ratios instead of defaulting to square output', async () => {
  for (const providerId of ['gemini-image', 'gemini-openai-compatible', 'xai-grok-image']) {
    let received = null;
    await withServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        received = JSON.parse(body);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(responseFor(providerId)));
      });
    }, async (baseUrl) => {
      const config = { providerId, baseUrl, apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false };
      const provider = createImageProvider(config);
      await provider.generate({ requestId: 'request-aspect', idempotencyKey: 'aspect-key', prompt: 'wide cinematic scene', output: { aspectRatio: '16:9' }, referenceAssets: [] }, { abortSignal: new AbortController().signal });
    });
    if (providerId === 'gemini-image') assert.equal(received.generationConfig.imageConfig.aspectRatio, '16:9');
    else if (providerId === 'xai-grok-image') assert.equal(received.aspect_ratio, '16:9');
    else assert.equal(received.size, '16:9');
  }
});

test('vNext adapter rejects generation endpoint redirects before following them', async () => {
  let redirectedRequestCount = 0;
  await withServer((request, response) => {
    if (request.url === '/v1/images/generations') {
      response.writeHead(307, { location: '/unexpected-proxy' });
      response.end();
      return;
    }
    redirectedRequestCount += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(responseFor('openai-images')));
  }, async (baseUrl) => {
    const config = { providerId: 'openai-images', baseUrl, apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false };
    const provider = createImageProvider(config);
    await assert.rejects(() => provider.generate({ requestId: 'redirect-request', idempotencyKey: 'redirect-key', prompt: 'fixture prompt', output: { size: '1024x1024' }, referenceAssets: [] }, { abortSignal: new AbortController().signal }), /http 307/);
  });
  assert.equal(redirectedRequestCount, 0);
});

test('vNext Provider adapter classifies rate limits, invalid input, and ambiguous transport errors', () => {
  const config = { providerId: 'openai-images', baseUrl: 'https://images.example.test/v1', apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false };
  const provider = createImageProvider(config);
  assert.equal(provider.classifyError(new Error('http 429: slow down')).kind, 'rate_limited');
  assert.equal(provider.classifyError(new Error('http 400: invalid prompt')).kind, 'invalid_request');
  assert.equal(provider.classifyError(new Error('socket closed after request write')).kind, 'unknown_outcome');
});
