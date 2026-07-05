const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildAssetLibrary } = require('../../src/domain/asset_library');
const { buildExecutionManifest } = require('../../src/domain/execution_manifest');
const { makeTempDir, writeJson, writeTinyPng } = require('../helpers/workspace_v2_test_utils');

test('asset paths use user-readable result names instead of batch folders', () => {
  const outputDir = makeTempDir();
  const sourceImage = path.join(outputDir, 'raw', 'batch_001', 'x.png');
  writeTinyPng(sourceImage);
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), { task: { title: '人物主视觉' } });
  writeJson(path.join(outputDir, 'internal', 'execution_manifest.json'), {
    results: [{ id: 'result_001', index: 1, status: 'success', sourceOutput: sourceImage }],
  });
  const library = buildAssetLibrary({ outputDir });
  assert.match(library.assets[0].path, /^assets\/results\/001_人物主视觉_可筛选\.png$/);
  assert.doesNotMatch(library.assets[0].path, /batch_001/);
  assert.equal(require('fs').existsSync(path.join(outputDir, 'assets', 'results', '001_人物主视觉_可筛选.png')), true);
});

test('relative execution outputs are resolved from output directory before copying', () => {
  const outputDir = makeTempDir();
  const relativeOutput = path.join('raw', 'relative_result.png');
  writeTinyPng(path.join(outputDir, relativeOutput));
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), { task: { title: '人物主视觉' } });
  const manifestFile = path.join(outputDir, 'manifest.json');
  writeJson(manifestFile, {
    batches: [{ batchNumber: 1, results: [{ index: 1, ok: true, output: relativeOutput }] }],
  });
  buildExecutionManifest({ outputDir, manifestFile });
  const library = buildAssetLibrary({ outputDir });
  const copiedPath = path.join(outputDir, library.assets[0].path);
  assert.equal(require('fs').existsSync(copiedPath), true);
});
