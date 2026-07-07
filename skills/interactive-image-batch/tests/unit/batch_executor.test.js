const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeTempDir, readJson } = require('../helpers/workspace_v2_test_utils');

test('runBatch writes image, meta and manifest from provider result', async () => {
  const providerPath = require.resolve('../../src/providers/openai_images');
  const executorPath = require.resolve('../../src/domain/batch_executor');
  const originalProvider = require.cache[providerPath];
  const originalExecutor = require.cache[executorPath];
  let outputDir = null;

  delete require.cache[executorPath];
  require.cache[providerPath] = {
    id: providerPath,
    filename: providerPath,
    loaded: true,
    exports: {
      generate: async () => ({
        b64: Buffer.from('image-bytes').toString('base64'),
        responseSize: '1024x1024',
        responseModel: 'mock-image',
        revisedPrompt: 'mock revised prompt',
      }),
      edit: async () => {
        throw new Error('edit should not run');
      },
    },
  };

  try {
    const { runBatch } = require('../../src/domain/batch_executor');
    outputDir = makeTempDir();
    const batch = await runBatch([
      { index: 1, title: '测试图片', prompt: '生成测试图片' },
    ], {
      rootOutputDir: outputDir,
      batchNumber: 1,
      totalBatches: 1,
      concurrency: 1,
      baseUrl: 'https://example.com/v1',
      apiKey: 'test',
      model: 'gpt-image-2',
      responsesModel: 'gpt-5.4',
      width: 1024,
      height: 1024,
      outputFormat: 'png',
      timeoutSeconds: 1,
      retryCount: 0,
      offsetBase: 0,
      skipExisting: false,
      readJson,
    });

    const imagePath = path.join(batch.batchDir, '001_image_1024x1024.png');
    const metaPath = path.join(batch.batchDir, '001_image.json');
    const manifestPath = path.join(batch.batchDir, 'manifest.json');
    assert.equal(fs.readFileSync(imagePath, 'utf8'), 'image-bytes');
    assert.equal(readJson(metaPath).responseModel, 'mock-image');
    assert.equal(readJson(manifestPath).success, 1);
  } finally {
    delete require.cache[executorPath];
    if (originalExecutor) require.cache[executorPath] = originalExecutor;
    if (originalProvider) require.cache[providerPath] = originalProvider;
    else delete require.cache[providerPath];
    if (outputDir) fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('runBatch skipExisting reruns when provider or model metadata changes', async () => {
  const { runBatch } = require('../../src/domain/batch_executor');
  const outputDir = makeTempDir();
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      return {
        b64: Buffer.from(`image-bytes-${calls}`).toString('base64'),
        responseSize: '1024x1024',
        responseModel: `mock-image-${calls}`,
        revisedPrompt: null,
      };
    },
    edit: async () => {
      throw new Error('edit should not run');
    },
  };
  const baseContext = {
    rootOutputDir: outputDir,
    batchNumber: 1,
    totalBatches: 1,
    concurrency: 1,
    provider,
    providerConfig: {
      providerId: 'openai-images',
      baseUrl: 'https://example.com/v1',
      apiKey: 'test',
      model: 'model-a',
      referenceImagesEnabled: true,
    },
    width: 1024,
    height: 1024,
    outputFormat: 'png',
    timeoutSeconds: 1,
    retryCount: 0,
    offsetBase: 0,
    readJson,
  };
  const items = [{ index: 1, title: '测试图片', prompt: '生成测试图片' }];

  try {
    await runBatch(items, { ...baseContext, skipExisting: false });
    assert.equal(calls, 1);

    const same = await runBatch(items, { ...baseContext, skipExisting: true });
    assert.equal(calls, 1);
    assert.equal(same.manifest.skipped, 1);

    await runBatch(items, {
      ...baseContext,
      skipExisting: true,
      providerConfig: { ...baseContext.providerConfig, providerId: 'gemini-image' },
    });
    assert.equal(calls, 2);

    await runBatch(items, {
      ...baseContext,
      skipExisting: true,
      providerConfig: { ...baseContext.providerConfig, providerId: 'gemini-image', model: 'model-b' },
    });
    assert.equal(calls, 3);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('runBatch names output with provider returned image format', async () => {
  const { runBatch } = require('../../src/domain/batch_executor');
  const outputDir = makeTempDir();
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      return {
        b64: Buffer.from('jpeg-bytes').toString('base64'),
        responseSize: 'jpeg',
        outputFormat: 'jpeg',
        outputMimeType: 'image/jpeg',
        responseModel: 'gemini-test-image',
        revisedPrompt: null,
      };
    },
    edit: async () => {
      throw new Error('edit should not run');
    },
  };
  const context = {
    rootOutputDir: outputDir,
    batchNumber: 1,
    totalBatches: 1,
    concurrency: 1,
    provider,
    providerConfig: {
      providerId: 'gemini-image',
      baseUrl: 'https://example.com',
      apiKey: 'test',
      model: 'gemini-test-image',
      referenceImagesEnabled: false,
    },
    width: 1024,
    height: 1024,
    outputFormat: 'png',
    timeoutSeconds: 1,
    retryCount: 0,
    offsetBase: 0,
    readJson,
  };

  try {
    const first = await runBatch([{ index: 1, title: '测试图片', prompt: '生成测试图片' }], {
      ...context,
      skipExisting: false,
    });
    const imagePath = path.join(first.batchDir, '001_image_1024x1024.jpeg');
    const meta = readJson(path.join(first.batchDir, '001_image.json'));
    assert.equal(fs.readFileSync(imagePath, 'utf8'), 'jpeg-bytes');
    assert.equal(meta.requestedOutputFormat, 'png');
    assert.equal(meta.outputFormat, 'jpeg');
    assert.equal(meta.outputMimeType, 'image/jpeg');

    const second = await runBatch([{ index: 1, title: '测试图片', prompt: '生成测试图片' }], {
      ...context,
      skipExisting: true,
    });
    assert.equal(calls, 1);
    assert.equal(second.manifest.skipped, 1);
    assert.equal(second.manifest.results[0].output, imagePath);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
