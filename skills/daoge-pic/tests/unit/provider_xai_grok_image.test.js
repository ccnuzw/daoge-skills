const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('dns');
const https = require('https');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const {
  buildXaiEndpoint,
  nearestAspectRatio,
  resolutionFromSize,
  buildXaiExtraBody,
  generate,
  edit,
} = require('../../src/providers/xai_grok_image');

const tinyJpegB64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';

function mockHttpsRequest(handler) {
  const original = https.request;
  const calls = [];
  const responses = [];
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
        const originalResume = res.resume.bind(res);
        const originalDestroy = res.destroy.bind(res);
        res.resumeCalled = false;
        res.destroyCalled = false;
        res.resume = (...args) => {
          res.resumeCalled = true;
          return originalResume(...args);
        };
        res.destroy = (...args) => {
          res.destroyCalled = true;
          return originalDestroy(...args);
        };
        responses.push(res);
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
    responses,
    restore() {
      https.request = original;
    },
  };
}

test('xAI/Grok endpoint appends images/generations to v1 base URL', () => {
  assert.equal(
    buildXaiEndpoint('https://api.example.com/v1'),
    'https://api.example.com/v1/images/generations'
  );
  assert.equal(
    buildXaiEndpoint('https://api.example.com/v1', '/custom/images/generations'),
    'https://api.example.com/v1/custom/images/generations'
  );
});

test('xAI/Grok maps project size to aspect_ratio and resolution when close enough', () => {
  assert.equal(nearestAspectRatio('1024x1024'), '1:1');
  assert.equal(nearestAspectRatio('1792x1024'), '16:9');
  assert.equal(nearestAspectRatio('1024x1792'), '9:16');
  assert.equal(nearestAspectRatio('1200x1000'), null);
  assert.equal(resolutionFromSize('1024x1024'), '1k');
  assert.equal(resolutionFromSize('2048x1152'), '2k');
  assert.deepEqual(buildXaiExtraBody({ size: '1792x1024' }), { aspect_ratio: '16:9', resolution: '2k' });
});

test('xAI/Grok sends Bearer request and downloads url response', async () => {
  const originalFetch = global.fetch;
  const httpsMock = mockHttpsRequest((url) => {
    assert.equal(url, 'https://93.184.216.34/image.jpg');
    return {
      statusCode: 200,
      headers: { 'content-type': 'image/jpeg' },
      body: Buffer.from(tinyJpegB64, 'base64'),
    };
  });
  const calls = [];
  let captured;
  global.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (calls.length === 1) {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ data: [{ url: 'https://93.184.216.34/image.jpg' }] }), { status: 200 });
    }
    throw new Error('download should not use fetch');
  };
  try {
    const result = await generate({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'grok-imagine-image-quality',
      prompt: 'draw test',
      size: '1792x1024',
      timeoutMs: 1000,
      responseFormat: 'url',
    });
    const body = JSON.parse(captured.options.body);
    assert.equal(captured.url, 'https://api.example.com/v1/images/generations');
    assert.equal(captured.options.headers.Authorization, 'Bearer test-key');
    assert.equal(body.model, 'grok-imagine-image-quality');
    assert.equal(body.prompt, 'draw test');
    assert.equal(body.n, 1);
    assert.equal(body.response_format, 'url');
    assert.equal(body.aspect_ratio, '16:9');
    assert.equal(body.resolution, '2k');
    assert.equal(result.b64, tinyJpegB64);
    assert.equal(result.outputFormat, 'jpeg');
    assert.equal(result.outputMimeType, 'image/jpeg');
    assert.deepEqual(httpsMock.calls, ['https://93.184.216.34/image.jpg']);
  } finally {
    global.fetch = originalFetch;
    httpsMock.restore();
  }
});

test('xAI/Grok supports b64_json response without download', async () => {
  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({ data: [{ b64_json: tinyJpegB64 }] }), { status: 200 });
  };
  try {
    const result = await generate({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'grok-imagine-image-quality',
      prompt: 'draw test',
      size: '1024x1024',
      timeoutMs: 1000,
      responseFormat: 'b64_json',
    });
    assert.equal(fetchCount, 1);
    assert.equal(result.b64, tinyJpegB64);
    assert.equal(result.outputFormat, 'jpeg');
  } finally {
    global.fetch = originalFetch;
  }
});

test('xAI/Grok rejects oversized and non-image downloads', async () => {
  const originalFetch = global.fetch;
  let httpsMock = null;
  try {
    httpsMock = mockHttpsRequest((url) => {
      assert.equal(url, 'https://93.184.216.34/image.txt');
      return {
        statusCode: 200,
        headers: { 'content-type': 'text/plain' },
        body: Buffer.from('not an image'),
      };
    });
    global.fetch = async (url) => {
      return new Response(JSON.stringify({ data: [{ url: 'https://93.184.216.34/image.txt' }] }), { status: 200 });
    };
    await assert.rejects(() => generate({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'grok-imagine-image-quality',
      prompt: 'draw test',
      size: '1024x1024',
      timeoutMs: 1000,
    }), /content-type text\/plain is not image/);
    assert.equal(httpsMock.responses[0].resumeCalled, true);
    assert.equal(httpsMock.responses[0].destroyCalled, true);
    httpsMock.restore();

    httpsMock = mockHttpsRequest((url) => {
      assert.equal(url, 'https://93.184.216.34/image.jpg');
      return {
        statusCode: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(65 * 1024 * 1024),
        },
        body: Buffer.from(tinyJpegB64, 'base64'),
      };
    });
    global.fetch = async (url) => {
      return new Response(JSON.stringify({ data: [{ url: 'https://93.184.216.34/image.jpg' }] }), { status: 200 });
    };
    await assert.rejects(() => generate({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'grok-imagine-image-quality',
      prompt: 'draw test',
      size: '1024x1024',
      timeoutMs: 1000,
    }), /download too large/);
    assert.equal(httpsMock.responses[0].resumeCalled, true);
    assert.equal(httpsMock.responses[0].destroyCalled, true);
  } finally {
    global.fetch = originalFetch;
    httpsMock?.restore();
  }
});

test('xAI/Grok rejects local and metadata image URLs before download fetch', async () => {
  const originalFetch = global.fetch;
  try {
    for (const blockedUrl of [
      'http://127.0.0.1/private.png',
      'http://169.254.169.254/latest/meta-data',
      'http://metadata.google.internal/computeMetadata/v1',
      'http://[fe81::1]/private.png',
      'http://[::ffff:7f00:1]/private.png',
    ]) {
      const calls = [];
      global.fetch = async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ data: [{ url: blockedUrl }] }), { status: 200 });
      };
      await assert.rejects(() => generate({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
        model: 'grok-imagine-image-quality',
        prompt: 'draw test',
        size: '1024x1024',
        timeoutMs: 1000,
      }), /image download rejected/);
      assert.equal(calls.length, 1);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('xAI/Grok rejects image URL hostnames that resolve to private addresses before download fetch', async () => {
  const originalFetch = global.fetch;
  const originalLookup = dns.lookup;
  const httpsMock = mockHttpsRequest(() => {
    throw new Error('response handler should not run after blocked lookup');
  });
  const calls = [];
  dns.lookup = (hostname, options, callback) => {
    assert.equal(hostname, 'attacker.example');
    assert.deepEqual(options, { all: true, verbatim: true });
    callback(null, [{ address: '10.0.0.1', family: 4 }]);
  };
  global.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ data: [{ url: 'https://attacker.example/image.jpg' }] }), { status: 200 });
  };
  try {
    await assert.rejects(() => generate({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'grok-imagine-image-quality',
      prompt: 'draw test',
      size: '1024x1024',
      timeoutMs: 1000,
    }), /resolves to blocked private IPv4/);
    assert.equal(calls.length, 1);
    assert.deepEqual(httpsMock.calls, ['https://attacker.example/image.jpg']);
  } finally {
    global.fetch = originalFetch;
    dns.lookup = originalLookup;
    httpsMock.restore();
  }
});

test('xAI/Grok rejects redirects to private image URLs before redirected fetch', async () => {
  const originalFetch = global.fetch;
  const httpsMock = mockHttpsRequest((url) => {
    assert.equal(url, 'https://93.184.216.34/image.jpg');
    return {
      statusCode: 302,
      headers: { location: 'http://127.0.0.1/private.jpg' },
    };
  });
  const calls = [];
  global.fetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ data: [{ url: 'https://93.184.216.34/image.jpg' }] }), { status: 200 });
  };
  try {
    await assert.rejects(() => generate({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      model: 'grok-imagine-image-quality',
      prompt: 'draw test',
      size: '1024x1024',
      timeoutMs: 1000,
    }), /blocked private IPv4/);
    assert.deepEqual(calls, ['https://api.example.com/v1/images/generations']);
    assert.deepEqual(httpsMock.calls, ['https://93.184.216.34/image.jpg']);
    assert.equal(httpsMock.responses[0].resumeCalled, true);
    assert.equal(httpsMock.responses[0].destroyCalled, true);
  } finally {
    global.fetch = originalFetch;
    httpsMock.restore();
  }
});

test('xAI/Grok edit and reference support is explicit disabled path', async () => {
  await assert.rejects(() => edit({ referenceImages: ['reference.png'] }), /reference\/edit support requires/);
  await assert.rejects(() => edit({ maskImage: 'mask.png' }), /does not support mask edit/);
});
