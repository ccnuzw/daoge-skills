const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { buildAssetLibrary } = require('../../scripts/build_asset_library');
const { makeTempDir, writeJson, writeTinyPng } = require('../helpers/workspace_v2_test_utils');

test('asset library creates human readable result, review and issue assets', () => {
  const outputDir = makeTempDir();
  const sourceImage = path.join(outputDir, 'source.png');
  writeTinyPng(sourceImage);
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    task: { title: '人物主视觉' },
  });
  writeJson(path.join(outputDir, 'internal', 'execution_manifest.json'), {
    results: [
      { id: 'result_001', index: 1, status: 'success', sourceOutput: sourceImage },
      { id: 'result_002', index: 2, status: 'needs_review', sourceOutput: sourceImage },
      { id: 'result_003', index: 3, status: 'failed', error: 'timeout' },
    ],
  });
  const library = buildAssetLibrary({ outputDir });
  assert.equal(library.assets.filter((asset) => asset.kind === 'image_result' || asset.kind === 'issue_record').length, 3);
  library.assets.forEach((asset) => {
    assert.equal(Boolean(asset.userTitle), true);
    assert.equal(Boolean(asset.userStatus), true);
    assert.equal(Boolean(asset.group), true);
    assert.equal(Boolean(asset.source.stage), true);
    assert.equal(typeof asset.usage.canSelect, 'boolean');
    assert.equal(typeof asset.usage.needsReview, 'boolean');
    assert.equal(typeof asset.usage.hasIssue, 'boolean');
    assert.equal(typeof asset.usage.canExport, 'boolean');
    assert.doesNotMatch(asset.path, /batch_\d+/);
  });
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'results')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'review')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'issues')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'selected')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'exports', 'report.html')), true);
});

test('asset library escapes export report text and links', () => {
  const outputDir = makeTempDir();
  const sourceImage = path.join(outputDir, 'source.png');
  writeTinyPng(sourceImage);
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    task: { title: '<img src=x onerror=alert(1)>' },
  });
  writeJson(path.join(outputDir, 'internal', 'execution_manifest.json'), {
    results: [
      { id: 'result_001', index: 1, status: 'success', userLabel: '<script>alert(1)</script>', sourceOutput: sourceImage },
    ],
  });
  buildAssetLibrary({ outputDir });
  const report = fs.readFileSync(path.join(outputDir, 'assets', 'exports', 'report.html'), 'utf8');
  assert.doesNotMatch(report, /<script>alert\(1\)<\/script>/);
  assert.match(report, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('asset library downgrades missing successful image to issue asset', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    task: { title: '人物主视觉' },
  });
  writeJson(path.join(outputDir, 'internal', 'execution_manifest.json'), {
    results: [
      { id: 'result_001', index: 1, status: 'success', output: 'missing.png' },
    ],
  });
  const library = buildAssetLibrary({ outputDir });
  assert.equal(library.assets.some((asset) => asset.kind === 'image_result'), false);
  assert.equal(library.assets.some((asset) => asset.kind === 'selected_result'), false);
  assert.equal(library.assets.some((asset) => asset.kind === 'export_image'), false);
  const issue = library.assets.find((asset) => asset.kind === 'issue_record');
  assert.equal(issue.userStatus, '文件缺失');
  assert.equal(issue.usage.hasIssue, true);
  assert.equal(fs.existsSync(path.join(outputDir, issue.path)), true);
});

test('asset library writes missing material placeholder as json without preview', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    task: { title: '人物主视觉' },
    materials: {
      baseDir: outputDir,
      references: [{ id: 'reference_001', title: '人物参考', path: 'missing.png', category: '人物参考' }],
    },
  });
  const library = buildAssetLibrary({ outputDir });
  const asset = library.assets.find((item) => item.id === 'reference_001');
  assert.match(asset.path, /\.json$/);
  assert.equal(asset.previewPath, null);
  assert.equal(fs.existsSync(path.join(outputDir, asset.path)), true);
});
