const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skillRoot,
  makeTempDir,
  readJson,
  runScript,
  writeEnv,
  assertWorkspacePagesExist,
} = require('../helpers/workspace_v2_test_utils');

test('rerun flow can use previous execution record and still emits workspace structure', () => {
  const tempDir = makeTempDir();
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  const resumeManifest = path.join(tempDir, 'resume_manifest.json');
  fs.writeFileSync(resumeManifest, JSON.stringify({
    batches: [
      {
        batchNumber: 1,
        results: [
          { index: 1, slug: 'hero-fashion-studio', ok: false, error: 'timeout' },
        ],
      },
    ],
  }, null, 2));
  const secondOut = path.join(tempDir, 'second');
  runScript('daoge.js', ['rerun',
    '--prompts-file', path.join(skillRoot, 'tests', 'fixtures', 'prompts.minimal.json'),
    '--env-file', envFile,
    '--dry-run', 'true',
    '--resume-manifest', resumeManifest,
    '--failed-only', 'true',
    '--output-dir', secondOut,
    '--batch-size', '1',
    '--concurrency', '1',
    '--output-format', 'webp',
    '--generate-path', '/custom-generate',
    '--edit-path', '/custom-edit',
    '--skip-existing', 'true',
  ]);
  assertWorkspacePagesExist(assert, secondOut);
  assert.equal(fs.existsSync(path.join(secondOut, 'workspace', 'index.html')), true);
  const manifest = readJson(path.join(secondOut, 'internal', 'local_execution_raw.json'));
  assert.equal(manifest.outputFormat, 'webp');
  assert.equal(manifest.generatePath, '/custom-generate');
  assert.equal(manifest.editPath, '/custom-edit');
  assert.equal(manifest.skipExisting, true);
  assert.deepEqual(manifest.rerun.selectedIndexes, [1]);
});

test('failed-only rerun skips successful and missing-material items', () => {
  const tempDir = makeTempDir();
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  const promptsFile = path.join(tempDir, 'prompts.json');
  fs.writeFileSync(promptsFile, JSON.stringify([
    { index: 1, title: '成功项', generation_prompt: 'ok image' },
    { index: 2, title: '缺素材项', generation_prompt: 'missing material image' },
    { index: 3, title: '超时项', generation_prompt: 'timeout image' },
  ], null, 2));
  const resumeManifest = path.join(tempDir, 'resume_manifest.json');
  fs.writeFileSync(resumeManifest, JSON.stringify({
    results: [
      { index: 1, status: 'success' },
      { index: 2, status: 'failed', reason: 'missing_material', error: '素材文件缺失', rerunnable: false },
      { index: 3, status: 'failed', error: 'timeout' },
    ],
  }, null, 2));
  const out = path.join(tempDir, 'rerun');
  runScript('daoge.js', ['rerun',
    '--prompts-file', promptsFile,
    '--env-file', envFile,
    '--dry-run', 'true',
    '--resume-manifest', resumeManifest,
    '--failed-only', 'true',
    '--output-dir', out,
    '--batch-size', '1',
  ]);
  const promptCopy = readJson(path.join(out, 'debug', 'prompts.generated.json'));
  assert.deepEqual(promptCopy.map((item) => item.title), ['超时项']);
  const manifest = readJson(path.join(out, 'internal', 'local_execution_raw.json'));
  assert.deepEqual(manifest.rerun.selectedIndexes, [3]);
  assert.equal(manifest.selectedCount, 1);
});
