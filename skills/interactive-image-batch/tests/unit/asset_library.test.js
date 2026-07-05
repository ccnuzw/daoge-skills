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

test('asset library export report shows user labels instead of lifecycle codes', () => {
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
  buildAssetLibrary({ outputDir });
  const report = fs.readFileSync(path.join(outputDir, 'assets', 'exports', 'report.html'), 'utf8');
  [
    'recommended_first_pass',
    'deliverable_candidate',
    'waiting_for_user_selection',
    'needs_review',
    'needs_attention',
  ].forEach((term) => {
    assert.doesNotMatch(report, new RegExp(term), term);
  });
  assert.match(report, /建议优先看/);
  assert.match(report, /交付候选/);
  assert.match(report, /需要复核/);
  assert.match(report, /需要处理/);
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

test('asset library recommends selected candidates without copying every success', () => {
  const outputDir = makeTempDir();
  const sourceImage = path.join(outputDir, 'source.png');
  writeTinyPng(sourceImage);
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    task: { title: '人物主视觉' },
  });
  writeJson(path.join(outputDir, 'internal', 'execution_manifest.json'), {
    results: [1, 2, 3, 4, 5].map((index) => ({
      id: `result_${String(index).padStart(3, '0')}`,
      index,
      status: 'success',
      sourceOutput: sourceImage,
    })),
  });
  const library = buildAssetLibrary({ outputDir });
  const results = library.assets.filter((asset) => asset.kind === 'image_result');
  const selected = library.assets.filter((asset) => asset.kind === 'selected_result');
  const exports = library.assets.filter((asset) => asset.kind === 'export_image');
  assert.equal(results.length, 5);
  assert.equal(selected.length, 3);
  assert.equal(exports.length, 3);
  selected.forEach((asset) => {
    assert.equal(asset.lifecycleStatus, 'recommended_first_pass');
    assert.equal(Boolean(asset.relationships.sourceResultId), true);
    assert.equal(Boolean(asset.relationships.derivedFromAssetId), true);
  });
});

test('asset library recommendation uses fallback result ids when source ids are missing', () => {
  const outputDir = makeTempDir();
  const sourceImage = path.join(outputDir, 'source.png');
  writeTinyPng(sourceImage);
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    task: { title: '人物主视觉' },
  });
  writeJson(path.join(outputDir, 'internal', 'execution_manifest.json'), {
    results: [1, 2, 3, 4, 5].map((index) => ({
      index,
      status: 'success',
      sourceOutput: sourceImage,
    })),
  });
  const library = buildAssetLibrary({ outputDir });
  const selected = library.assets.filter((asset) => asset.kind === 'selected_result');
  const exports = library.assets.filter((asset) => asset.kind === 'export_image');
  const placeholder = library.assets.find((asset) => asset.kind === 'selection_placeholder');
  assert.equal(selected.length, 3);
  assert.equal(exports.length, 3);
  assert.deepEqual(selected.map((asset) => asset.relationships.sourceResultId), ['result_001', 'result_002', 'result_003']);
  assert.equal(Boolean(placeholder), true);
  assert.equal(placeholder.sourceReason, '有成功结果，但没有明确用户选择');
  const report = fs.readFileSync(path.join(outputDir, 'assets', 'exports', 'report.html'), 'utf8');
  assert.doesNotMatch(report, /用户已选占位/);
  assert.doesNotMatch(report, /waiting_for_user_selection/);
});

test('asset library exposes user lifecycle fields and traceable review issue export relations', () => {
  const outputDir = makeTempDir();
  const sourceImage = path.join(outputDir, 'source.png');
  writeTinyPng(sourceImage);
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    task: { title: '人物主视觉' },
  });
  writeJson(path.join(outputDir, 'internal', 'execution_manifest.json'), {
    results: [
      { id: 'result_001', index: 1, status: 'success', selected: true, sourceOutput: sourceImage },
      { id: 'result_002', index: 2, status: 'needs_review', sourceOutput: sourceImage },
      { id: 'result_003', index: 3, status: 'failed', error: 'timeout' },
    ],
  });
  const library = buildAssetLibrary({ outputDir });
  library.assets.forEach((asset) => {
    assert.equal(Boolean(asset.userPurpose), true);
    assert.equal(Boolean(asset.userAction), true);
    assert.equal(Boolean(asset.lifecycleStatus), true);
    assert.equal(Boolean(asset.sourceReason), true);
    assert.equal(typeof asset.relationships, 'object');
  });
  assert.equal(library.assets.find((asset) => asset.group === '建议复核').lifecycleStatus, 'needs_review');
  assert.equal(library.assets.find((asset) => asset.group === '问题相关').lifecycleStatus, 'needs_attention');
  assert.equal(library.assets.find((asset) => asset.kind === 'export_image').relationships.derivedFromAssetId.startsWith('selected_'), true);
});
