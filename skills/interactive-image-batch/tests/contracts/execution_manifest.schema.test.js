const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildExecutionManifest } = require('../../scripts/build_execution_manifest');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

test('execution_manifest contract normalizes execution results', () => {
  const outputDir = makeTempDir();
  const manifestFile = path.join(outputDir, 'manifest.json');
  writeJson(manifestFile, {
    runtimeMode: 'local-batch-runner',
    model: 'gpt-image-2',
    batches: [{ batchNumber: 1, results: [{ index: 1, title: 'A', ok: true }] }],
  });
  const manifest = buildExecutionManifest({ outputDir, manifestFile });
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.execution.mode, 'local-batch-runner');
  assert.equal(manifest.results[0].id, 'result_001');
  assert.equal(manifest.counts.success, 1);
});
