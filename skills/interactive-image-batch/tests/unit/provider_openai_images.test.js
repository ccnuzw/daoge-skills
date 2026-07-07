const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  generate,
  requestImage,
  requestImageEdit,
  requestResponsesImageEdit,
  readResponseText,
} = require('../../src/providers/openai_images');
const { makeTempDir } = require('../helpers/workspace_v2_test_utils');

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

test('image provider rejects oversized response bodies before buffering text', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('{}', {
    status: 200,
    headers: { 'content-length': String(129 * 1024 * 1024) },
  });
  try {
    await assert.rejects(() => requestImage({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test',
      model: 'gpt-image-2',
      prompt: 'test',
      size: '1024x1024',
      outputFormat: 'png',
      timeoutMs: 1000,
    }), /response too large/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('image provider caps streamed responses without content-length', async () => {
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
    text: async () => {
      throw new Error('text should not run');
    },
  };
  await assert.rejects(() => readResponseText(response, 'streamed image', 3), /response too large/);
  assert.equal(cancelled, true);
});

test('image provider checks non-streaming fallback response size', async () => {
  const response = {
    headers: { get: () => null },
    body: null,
    text: async () => 'abcd',
  };
  await assert.rejects(() => readResponseText(response, 'fallback image', 3), /response too large/);
});

test('image edit rejects oversized reference files before fetch', async () => {
  const outputDir = makeTempDir();
  const reference = path.join(outputDir, 'large-reference.png');
  fs.writeFileSync(reference, '');
  fs.truncateSync(reference, 51 * 1024 * 1024);
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };
  try {
    await assert.rejects(() => requestImageEdit({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test',
      model: 'gpt-image-2',
      prompt: 'test',
      size: '1024x1024',
      outputFormat: 'png',
      timeoutMs: 1000,
      referenceImages: [reference],
      maskImage: null,
    }), /reference image too large/);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('responses image edit uses a lower data-url reference limit before fetch', async () => {
  const outputDir = makeTempDir();
  const reference = path.join(outputDir, 'responses-reference.png');
  fs.writeFileSync(reference, '');
  fs.truncateSync(reference, 33 * 1024 * 1024);
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  };
  try {
    await assert.rejects(() => requestResponsesImageEdit({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test',
      toolModel: 'gpt-image-2',
      responsesModel: 'gpt-5.4',
      prompt: 'test',
      size: '1024x1024',
      outputFormat: 'png',
      timeoutMs: 1000,
      referenceImages: [reference],
    }), /responses reference files too large/);
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
