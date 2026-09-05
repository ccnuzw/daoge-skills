const fs = require('node:fs');
const http = require('node:http');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createImageProvider } = require('../../dist/vnext/providers/http-adapters');
const { sanitizeProviderMetadata, sanitizeProviderRequestId } = require('../../dist/vnext/providers/response-sanitizer');
const { cleanupProviderResult } = require('../../dist/vnext/media/generated-assets');
const { decodeBoundedBase64, downloadHttpResource, readBoundedResponse } = require('../../dist/vnext/providers/http-safety');

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
test('large Provider Base64 results stream to a temporary file instead of returning a large Buffer', async () => {
  const large = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024 - png.length, 0x41)]);
  let result = null;
  await withServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ data: [{ b64_json: large.toString('base64') }] }));
    });
  }, async (baseUrl) => {
    const provider = createImageProvider({ providerId: 'openai-images', baseUrl, apiKey: 'fixture-key', model: 'fixture-model', referenceEnabled: false });
    result = await provider.generate({ requestId: 'large-response', idempotencyKey: 'large-response-key', prompt: 'large response', output: {}, referenceAssets: [] }, { abortSignal: new AbortController().signal });
  });
  try {
    assert.equal(result.bytes, undefined);
    assert.equal(typeof result.filePath, 'string');
    assert.equal(result.byteSize, large.length);
    assert.equal(fs.statSync(result.filePath).size, large.length);
  } finally {
    if (result) await cleanupProviderResult(result);
  }
  assert.equal(fs.existsSync(result.filePath), false);
});


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

test('Provider request IDs use a bounded metadata-safe format and reject exact sensitive values', () => {
  const sensitive = { apiKey: 'opaque-provider-key', baseUrl: 'https://provider.example/private/v1' };
  assert.equal(sanitizeProviderRequestId('request_01-safe:value', sensitive), 'request_01-safe:value');
  assert.equal(sanitizeProviderRequestId('request id with spaces', sensitive), undefined);
  assert.equal(sanitizeProviderRequestId('r'.repeat(129), sensitive), undefined);
  assert.equal(sanitizeProviderRequestId('prefix-' + sensitive.apiKey, sensitive), undefined);
  assert.equal(sanitizeProviderRequestId(sensitive.baseUrl, sensitive), undefined);
  const metadata = sanitizeProviderMetadata({ nested: [{ note: 'echo ' + sensitive.apiKey }, { urlEcho: sensitive.baseUrl }], providerRequestId: sensitive.apiKey, [sensitive.apiKey]: 'reflected-key-name' }, sensitive);
  const serialized = JSON.stringify(metadata);
  assert.equal(serialized.includes(sensitive.apiKey), false);
  assert.equal(serialized.includes(sensitive.baseUrl), false);
  assert.equal(Object.hasOwn(metadata, 'providerRequestId'), false);
});

test('vNext Gemini edit rejects redirects without forwarding its API key', async () => {
  const received = [];
  await withServer((request, response) => {
    received.push({ url: request.url, apiKey: request.headers['x-goog-api-key'] || null });
    request.resume();
    response.writeHead(request.url.includes(':generateContent') ? 307 : 200, request.url.includes(':generateContent') ? { location: '/redirect-target' } : { 'content-type': 'application/json' });
    response.end(request.url.includes(':generateContent') ? undefined : JSON.stringify(responseFor('gemini-image')));
  }, async (baseUrl) => {
    const provider = createImageProvider({ providerId: 'gemini-image', baseUrl, apiKey: 'gemini-secret-key', model: 'fixture-model', referenceEnabled: true });
    await assert.rejects(() => provider.edit({ requestId: 'gemini-edit', idempotencyKey: 'gemini-edit-key', prompt: 'edit fixture', output: {}, referenceAssets: [{ assetId: 'asset-reference', mediaType: 'image/png', bytes: png }] }, { abortSignal: new AbortController().signal }), /http 307/);
  });
  assert.deepEqual(received, [{ url: '/v1beta/models/fixture-model:generateContent', apiKey: 'gemini-secret-key' }]);
});

test('vNext Provider downloads a public image URL without forwarding Provider credentials', async () => {
  const requests = [];
  const downloads = [];
  const provider = createImageProvider(
    { providerId: 'openai-images', baseUrl: 'https://provider.example/v1', apiKey: 'provider-secret-key', model: 'fixture-model', referenceEnabled: false },
    {
      resolveHost: async (hostname) => {
        assert.equal(hostname, 'cdn.example');
        return ['93.184.216.34'];
      },
      fetch: async (input, init = {}) => {
        const headers = new Headers(init.headers);
        requests.push({ url: String(input), redirect: init.redirect, authorization: headers.get('authorization'), apiKey: headers.get('x-goog-api-key') });
        return new Response(JSON.stringify({ data: [{ url: 'https://cdn.example/generated.png' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
      downloadRequest: async (url, addresses, init) => {
        downloads.push({ url: String(url), addresses, headers: init.headers });
        return { response: new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }), remoteAddress: '93.184.216.34' };
      }
    }
  );
  const result = await provider.generate({ requestId: 'url-output', idempotencyKey: 'url-output-key', prompt: 'fixture prompt', output: {}, referenceAssets: [] }, { abortSignal: new AbortController().signal });
  assert.deepEqual(result.bytes, png);
  assert.deepEqual(requests, [
    { url: 'https://provider.example/v1/images/generations', redirect: 'manual', authorization: 'Bearer provider-secret-key', apiKey: null }
  ]);
  assert.deepEqual(downloads, [{ url: 'https://cdn.example/generated.png', addresses: ['93.184.216.34'], headers: { accept: 'image/png, image/jpeg, image/webp' } }]);
});

test('vNext Provider rejects non-HTTP and non-public image URLs before connecting', async () => {
  let requestCount = 0;
  const options = {
    signal: new AbortController().signal,
    maxBytes: 1024,
    request: async () => {
      requestCount += 1;
      return { response: new Response(png), remoteAddress: '93.184.216.34' };
    },
    resolveHost: async () => ['10.1.2.3']
  };
  await assert.rejects(() => downloadHttpResource('file:///tmp/provider.png', options), /HTTP or HTTPS/);
  await assert.rejects(() => downloadHttpResource('http://127.0.0.1/provider.png', options), /non-public/);
  await assert.rejects(() => downloadHttpResource('http://[::ffff:127.0.0.1]/provider.png', options), /non-public/);
  await assert.rejects(() => downloadHttpResource('https://private.example/provider.png', options), /non-public/);
  assert.equal(requestCount, 0);
});

const nonGlobalResolvedAddresses = [
  ['IPv4 benchmark', '198.18.0.1'],
  ['IPv4 documentation TEST-NET-1', '192.0.2.1'],
  ['IPv4 documentation TEST-NET-2', '198.51.100.1'],
  ['IPv4 documentation TEST-NET-3', '203.0.113.1'],
  ['IPv4 reserved', '240.0.0.1'],
  ['IPv4 multicast', '224.0.0.1'],
  ['IPv4 unspecified', '0.0.0.0'],
  ['IPv6 documentation', '2001:db8::1'],
  ['IPv6 special-use', '2001::1'],
  ['IPv6 unique-local', 'fd00::1'],
  ['IPv6 link-local', 'fe80::1'],
  ['IPv6 mapped', '::ffff:8.8.8.8']
];

for (const [category, address] of nonGlobalResolvedAddresses) {
  test('vNext Provider rejects ' + category + ' resolver results before transport', async () => {
    let requestCount = 0;
    await assert.rejects(() => downloadHttpResource('https://blocked.example/provider.png', {
      signal: new AbortController().signal,
      maxBytes: 1024,
      resolveHost: async (hostname) => {
        assert.equal(hostname, 'blocked.example');
        return [address];
      },
      request: async () => {
        requestCount += 1;
        return { response: new Response(png), remoteAddress: address };
      }
    }), /non-public/);
    assert.equal(requestCount, 0);
  });
}

for (const [family, hostname, address] of [
  ['IPv4', 'public-v4.example', '93.184.216.34'],
  ['IPv6', 'public-v6.example', '2606:4700:4700::1111']
]) {
  test('vNext Provider resolves and pins a globally routable ' + family + ' address', async () => {
    const resolved = [];
    const requested = [];
    const result = await downloadHttpResource('https://' + hostname + '/provider.png', {
      signal: new AbortController().signal,
      maxBytes: 1024,
      resolveHost: async (resolvedHostname) => {
        resolved.push(resolvedHostname);
        return [address];
      },
      request: async (url, addresses) => {
        requested.push({ url: String(url), addresses });
        return { response: new Response(png, { headers: { 'content-type': 'image/png' } }), remoteAddress: address };
      }
    });
    assert.deepEqual(result.bytes, png);
    assert.deepEqual(resolved, [hostname]);
    assert.deepEqual(requested, [{ url: 'https://' + hostname + '/provider.png', addresses: [address] }]);
  });
}


test('vNext Provider pins each redirect DNS result and rejects a mismatched or private remote address', async () => {
  const resolved = [];
  const requested = [];
  await assert.rejects(() => downloadHttpResource('https://public.example/provider.png', {
    signal: new AbortController().signal,
    maxBytes: 1024,
    resolveHost: async (hostname) => { resolved.push(hostname); return hostname === 'public.example' ? ['93.184.216.34'] : ['93.184.216.35']; },
    request: async (url, addresses) => {
      requested.push({ url: String(url), addresses });
      if (url.hostname === 'public.example') return { response: new Response(null, { status: 302, headers: { location: 'https://next.example/image.png' } }), remoteAddress: '93.184.216.34' };
      return { response: new Response(png), remoteAddress: '10.0.0.9' };
    }
  }), /non-public/);
  assert.deepEqual(resolved, ['public.example', 'next.example']);
  assert.deepEqual(requested, [
    { url: 'https://public.example/provider.png', addresses: ['93.184.216.34'] },
    { url: 'https://next.example/image.png', addresses: ['93.184.216.35'] }
  ]);
});

test('vNext Provider rejects a public remote address not present in the pinned DNS set', async () => {
  await assert.rejects(() => downloadHttpResource('https://public.example/provider.png', {
    signal: new AbortController().signal,
    maxBytes: 1024,
    resolveHost: async () => ['93.184.216.34'],
    request: async () => ({ response: new Response(png), remoteAddress: '93.184.216.35' })
  }), /did not match the pinned DNS result/);
});

test('bounded response reading cancels a chunked N+1 body despite a forged Content-Length', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2, 3, 4));
      controller.enqueue(Uint8Array.of(5, 6));
    },
    cancel() {
      cancelled = true;
    }
  }), { headers: { 'content-length': '1' } });
  await assert.rejects(() => readBoundedResponse(response, 5, 'bounded response exceeded'), /bounded response exceeded/);
  assert.equal(cancelled, true);
});

test('base64 image size is rejected from its encoded length before decoding', () => {
  assert.throws(() => decodeBoundedBase64('AAAA', 1), /size limit/);
});
test('Provider download aborts while DNS resolution remains pending', async () => {
  const controller = new AbortController();
  const pending = downloadHttpResource('https://public.example/provider.png', {
    signal: controller.signal,
    maxBytes: 1024,
    resolveHost: async () => await new Promise(() => {}),
    request: async () => { throw new Error('request must not run before DNS resolution'); }
  });
  setTimeout(() => controller.abort(new Error('test abort')), 10);
  await assert.rejects(Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error('DNS abort did not settle')), 250))]), /test abort/);
});
