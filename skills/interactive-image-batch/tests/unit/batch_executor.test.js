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
