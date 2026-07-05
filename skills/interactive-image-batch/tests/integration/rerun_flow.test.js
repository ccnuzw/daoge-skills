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
});
