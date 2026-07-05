const test = require('node:test');
const assert = require('node:assert/strict');
const { generate } = require('../../src/providers/openai_images');

test('responses generate fallback clears responses path before Images API request', async () => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return new Response('data: {"error":"bad"}\n\n', { status: 500 });
    }
    return new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from('ok').toString('base64') }],
      model: 'gpt-image-2',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await generate({
      id: 'fallback-test',
      baseUrl: 'https://example.com/v1',
      apiKey: 'test',
      model: 'gpt-image-2',
      responsesModel: 'gpt-5.4',
      prompt: 'test',
      size: '1024x1024',
      outputFormat: 'png',
      timeoutMs: 1000,
      generatePath: '/responses',
    });
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(urls[0], 'https://example.com/v1/responses');
  assert.equal(urls[1], 'https://example.com/v1/images/generations');
});
