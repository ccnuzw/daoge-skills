const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skillRoot,
  makeTempDir,
  runScript,
  writeEnv,
  assertWorkspacePagesExist,
} = require('../helpers/workspace_v2_test_utils');

test('rerun flow can use compatibility manifest from debug and still emits v2 structure', () => {
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
  runScript('run_batch.js', [
    '--prompts-file', path.join(skillRoot, 'tests', 'fixtures', 'prompts.minimal.json'),
    '--env-file', envFile,
    '--dry-run', 'true',
    '--resume-manifest', resumeManifest,
    '--failed-only', 'true',
    '--output-dir', secondOut,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);
  assertWorkspacePagesExist(assert, secondOut);
  assert.equal(fs.existsSync(path.join(secondOut, 'workspace', 'index.html')), true);
});
