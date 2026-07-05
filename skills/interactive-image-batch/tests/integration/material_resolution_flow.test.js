const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  makeTempDir,
  readJson,
  runScript,
  writeEnv,
  writeJson,
  writeTinyPng,
} = require('../helpers/workspace_v2_test_utils');
const { executeTask } = require('../../src/domain/execution_service');

test('execute resolves prompt reference paths from prompts file directory even from another cwd', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const promptDir = path.join(tempDir, 'prompt-pack');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  writeTinyPng(path.join(promptDir, 'refs', 'person.png'));
  writeJson(path.join(promptDir, 'prompts.json'), [{
    index: 1,
    title: '相对参考图',
    generation_prompt: 'reference assisted image',
    reference_images: ['refs/person.png'],
  }]);
  runScript('daoge.js', ['execute',
    '--prompts-file', path.join(promptDir, 'prompts.json'),
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
  ], { cwd: path.join(tempDir) });
  const prompts = readJson(path.join(outputDir, 'debug', 'prompts.generated.json'));
  assert.equal(prompts[0].reference_images[0], path.join(promptDir, 'refs', 'person.png'));
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.failed, 0);
  assert.equal(manifest.skipped, 1);
});

test('execute resolves prompt mask paths and marks masked edit in dry-run', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const promptDir = path.join(tempDir, 'prompt-pack');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  writeTinyPng(path.join(promptDir, 'refs', 'base.png'));
  writeTinyPng(path.join(promptDir, 'masks', 'mask.png'));
  writeJson(path.join(promptDir, 'prompts.json'), [{
    index: 1,
    title: '相对遮罩',
    generation_prompt: 'masked edit image',
    reference_images: ['refs/base.png'],
    edit_mask: 'masks/mask.png',
  }]);
  runScript('daoge.js', ['execute',
    '--prompts-file', path.join(promptDir, 'prompts.json'),
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
  ], { cwd: path.join(tempDir, '..') });
  const prompts = readJson(path.join(outputDir, 'debug', 'prompts.generated.json'));
  assert.equal(prompts[0].mask_image, path.join(promptDir, 'masks', 'mask.png'));
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.batches[0].results[0].requestMode, 'masked-edit');
});

test('missing prompt material becomes issue instead of silent success', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const promptDir = path.join(tempDir, 'prompt-pack');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  writeJson(path.join(promptDir, 'prompts.json'), [{
    index: 1,
    title: '缺参考图',
    generation_prompt: 'reference assisted image',
    reference_images: ['refs/missing.png'],
  }]);
  runScript('daoge.js', ['execute',
    '--prompts-file', path.join(promptDir, 'prompts.json'),
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
  ]);
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.failed, 1);
  assert.equal(manifest.batches[0].failed, 1);
  assert.equal(manifest.batches[0].skipped, 0);
  const issues = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(issues.summary.blocking >= 1, true);
  assert.match(issues.items[0].impact, /素材文件缺失|参考图/);
});

test('real execute does not send missing-material prompts to provider', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const promptDir = path.join(tempDir, 'prompt-pack');
  writeJson(path.join(promptDir, 'prompts.json'), [{
    index: 1,
    title: '真实执行缺参考图',
    generation_prompt: 'reference assisted image',
    reference_images: ['refs/missing.png'],
  }]);
  runScript('daoge.js', ['execute',
    '--prompts-file', path.join(promptDir, 'prompts.json'),
    '--output-dir', outputDir,
    '--batch-size', '1',
  ]);
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.dryRun, false);
  assert.equal(manifest.failed, 1);
  assert.equal(manifest.batches[0].outputDir, null);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'batches')), false);
  const issues = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(issues.summary.blocking >= 1, true);
});

test('real execute preserves original indexes when blocked prompts are filtered out', async () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const promptDir = path.join(tempDir, 'prompt-pack');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  writeJson(path.join(promptDir, 'prompts.json'), [
    {
      title: '缺参考图',
      generation_prompt: 'reference assisted image',
      reference_images: ['refs/missing.png'],
    },
    {
      title: '可执行提示词',
      generation_prompt: 'prompt only image',
    },
  ]);

  const originalFetch = global.fetch;
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from('ok').toString('base64') }],
      model: 'gpt-image-2',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    await executeTask({
      promptsFile: path.join(promptDir, 'prompts.json'),
      envFile,
      outputDir,
      batchSize: 1,
      concurrency: 1,
      width: 32,
      height: 32,
    });
  } finally {
    global.fetch = originalFetch;
  }

  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  const resultIndexes = manifest.batches.flatMap((batch) => batch.results.map((item) => String(item.index)));
  assert.deepEqual(resultIndexes, ['1', '002']);
  const promptCopy = readJson(path.join(outputDir, 'debug', 'prompts.generated.json'));
  assert.deepEqual(promptCopy.map((item) => item.index), [1, 2]);
  assert.equal(new Set(resultIndexes.map((value) => Number.parseInt(value, 10))).size, 2);
  assert.equal(fetchCount, 1);
});

test('failed-only resume matches padded numeric indexes from prior manifest', async () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const promptDir = path.join(tempDir, 'prompt-pack');
  const envFile = path.join(tempDir, '.env');
  const resumeFile = path.join(tempDir, 'resume.json');
  writeEnv(envFile);
  writeJson(path.join(promptDir, 'prompts.json'), [
    { title: '第一条', generation_prompt: 'first image' },
    { title: '第二条', generation_prompt: 'second image' },
  ]);
  writeJson(resumeFile, {
    batches: [{
      results: [
        { index: '001', ok: true },
        { index: '002', ok: false },
      ],
    }],
  });

  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    data: [{ b64_json: Buffer.from('ok').toString('base64') }],
    model: 'gpt-image-2',
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    await executeTask({
      promptsFile: path.join(promptDir, 'prompts.json'),
      resumeManifestFile: resumeFile,
      failedOnly: 'true',
      envFile,
      outputDir,
      batchSize: 1,
      concurrency: 1,
      width: 32,
      height: 32,
    });
  } finally {
    global.fetch = originalFetch;
  }

  const promptCopy = readJson(path.join(outputDir, 'debug', 'prompts.generated.json'));
  assert.equal(promptCopy.length, 1);
  assert.equal(promptCopy[0].title, '第二条');
  assert.equal(promptCopy[0].index, 2);
  const manifest = readJson(path.join(outputDir, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.selectedCount, 1);
  assert.equal(String(manifest.batches[0].results[0].index), '002');
});

test('host-native ingest resolves relative output from results file directory', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const hostDir = path.join(tempDir, 'host');
  writeTinyPng(path.join(hostDir, 'output.png'));
  writeJson(path.join(hostDir, 'pack.json'), {
    prompt_count: 1,
    task_summary: { content_brief: '人物主视觉', batch_size: 1, width: 1024, height: 1024 },
  });
  writeJson(path.join(hostDir, 'results.json'), [{
    index: '001',
    title: '人物主视觉',
    requestMode: 'prompt-only',
    output: 'output.png',
    status: 'success',
  }]);
  runScript('daoge.js', ['ingest',
    '--prompt-pack-file', path.join(hostDir, 'pack.json'),
    '--results-file', path.join(hostDir, 'results.json'),
    '--output-dir', outputDir,
  ], { cwd: path.join(tempDir, '..') });
  const execution = readJson(path.join(outputDir, 'internal', 'execution_manifest.json'));
  assert.equal(execution.counts.success, 1);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'selected')), true);
});
