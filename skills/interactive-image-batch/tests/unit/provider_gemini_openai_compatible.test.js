const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const {
  buildGeminiOpenAiEndpoint,
  generate,
  edit,
} = require('../../src/providers/gemini_openai_compatible');
const {
  validateDownloadUrl,
  isNonGlobalIpv4,
  isNonGlobalIpv6,
} = require('../../src/providers/openai_style_image');

const tinyPngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luzacwAAAABJRU5ErkJggg==';

function mockHttpsRequest(handler) {
  const original = https.request;
  const calls = [];
  https.request = (url, options, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      calls.push(String(url));
      const parsed = new URL(String(url));
      const finish = () => {
        const response = handler(String(url), options);
        const res = Readable.from(response.body ? [response.body] : []);
        res.statusCode = response.statusCode || 200;
        res.headers = response.headers || {};
        callback(res);
      };
      if (typeof options?.lookup === 'function' && !/^\d+\.\d+\.\d+\.\d+$/.test(parsed.hostname)) {
        options.lookup(parsed.hostname, {}, (error) => {
          if (error) req.emit('error', error);
          else finish();
        });
      } else {
        finish();
      }
    };
    req.destroy = (error) => req.emit('error', error);
    return req;
  };
  return {
    calls,
    restore() {
      https.request = original;
    },
  };
}

test('Gemini OpenAI-compatible endpoint uses openai path defaults', () => {
  assert.equal(
    buildGeminiOpenAiEndpoint('https://example.com'),
    'https://example.com/v1beta/openai/images/generations'
  );
  assert.equal(
    buildGeminiOpenAiEndpoint('https://example.com/v1beta/openai'),
    'https://example.com/v1beta/openai/images/generations'
  );
  assert.equal(
    buildGeminiOpenAiEndpoint('https://example.com/v1beta'),
    'https://example.com/v1beta/openai/images/generations'
  );
  assert.equal(
    buildGeminiOpenAiEndpoint('https://example.com', '/openai/images/generations'),
    'https://example.com/openai/images/generations'
  );
});

test('Gemini OpenAI-compatible sends Bearer auth and b64_json request body', async () => {
  const originalFetch = global.fetch;
  let captured;
  global.fetch = async (url, options) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      data: [{ b64_json: tinyPngB64, revised_prompt: 'drawn' }],
      model: 'gemini-test-image',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await generate({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    });
    const body = JSON.parse(captured.options.body);
    assert.equal(captured.url, 'https://example.com/v1beta/openai/images/generations');
    assert.equal(captured.options.headers.Authorization, 'Bearer test-key');
    assert.equal(body.model, 'gemini-test-image');
    assert.equal(body.prompt, 'draw test');
    assert.equal(body.n, 1);
    assert.equal(body.response_format, 'b64_json');
    assert.equal(result.b64, tinyPngB64);
    assert.equal(result.outputFormat, 'png');
    assert.equal(result.outputMimeType, 'image/png');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Gemini OpenAI-compatible downloads url response and converts to base64', async () => {
  const originalFetch = global.fetch;
  const httpsMock = mockHttpsRequest((url) => {
    assert.equal(url, 'https://93.184.216.34/image.png');
    return {
      statusCode: 200,
      headers: { 'content-type': 'image/png' },
      body: Buffer.from(tinyPngB64, 'base64'),
    };
  });
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ data: [{ url: 'https://93.184.216.34/image.png' }] }), { status: 200 });
  };
  try {
    const result = await generate({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    });
    assert.equal(httpsMock.calls[0], 'https://93.184.216.34/image.png');
    assert.equal(result.b64, tinyPngB64);
    assert.equal(result.outputFormat, 'png');
  } finally {
    global.fetch = originalFetch;
    httpsMock.restore();
  }
});

test('Gemini OpenAI-compatible rejects unsupported edit/reference paths', async () => {
  await assert.rejects(() => edit({ referenceImages: ['reference.png'] }), /reference image support is disabled/);
  await assert.rejects(() => edit({ maskImage: 'mask.png' }), /does not support mask edit/);
});

test('OpenAI-style image download rejects non-global IP ranges', () => {
  [
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
  ].forEach((address) => {
    assert.equal(isNonGlobalIpv4(address), true);
    assert.throws(() => validateDownloadUrl(`https://${address}/image.png`), /blocked private IPv4\/non-global/);
  });

  [
    '64:ff9b::10.0.0.1',
    '64:ff9b::a00:1',
    '64:ff9b:1::a00:1',
    '2002:0a00:0001::',
    '2001::1',
    '2001:2::1',
    '2001:10::1',
    '2001:20::1',
    '3ffe::1',
    '3fff::1',
    'ff00::1',
    'ff02::1',
    '2001:db8::1',
    '100::1',
  ].forEach((address) => {
    assert.equal(isNonGlobalIpv6(address), true);
    assert.throws(() => validateDownloadUrl(`https://[${address}]/image.png`), /blocked private IPv6\/non-global/);
  });

  assert.equal(isNonGlobalIpv6('3ff0::1'), false);
  assert.doesNotThrow(() => validateDownloadUrl('https://[3ff0::1]/image.png'));
});

test('Gemini OpenAI-compatible reports auth, model, incompatible response, and response size errors', async () => {
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
    await assert.rejects(() => generate({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    }), /authentication failed/);

    global.fetch = async () => new Response(JSON.stringify({ error: { message: 'missing model' } }), { status: 404 });
    await assert.rejects(() => generate({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    }), /model or endpoint unavailable/);

    global.fetch = async () => new Response(JSON.stringify({ data: [{}] }), { status: 200 });
    await assert.rejects(() => generate({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    }), /response format incompatible/);

    global.fetch = async () => new Response('{}', {
      status: 200,
      headers: { 'content-length': String(129 * 1024 * 1024) },
    });
    await assert.rejects(() => generate({
      baseUrl: 'https://example.com',
      apiKey: 'test-key',
      model: 'gemini-test-image',
      prompt: 'draw test',
      timeoutMs: 1000,
    }), /response too large/);
  } finally {
    global.fetch = originalFetch;
  }
});
