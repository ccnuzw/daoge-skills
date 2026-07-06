const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  makeTempDir,
  writeJson,
  writeTinyPng,
  runScript,
  readJson,
  assertWorkspacePagesExist,
} = require('../helpers/workspace_v2_test_utils');

test('host-native ingest emits the same v2 workspace and asset library', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const imageA = path.join(tempDir, 'a.png');
  const imageB = path.join(tempDir, 'b.png');
  writeTinyPng(imageA);
  writeTinyPng(imageB);
  const promptPack = path.join(tempDir, 'prompt_pack.json');
  const resultsFile = path.join(tempDir, 'results.json');
  writeJson(promptPack, {
    runtime_mode: 'host-native-image-tool',
    prompt_count: 3,
    task_summary: { content_brief: '人物主视觉', batch_size: 1, width: 1024, height: 1024 },
  });
  writeJson(resultsFile, [
    { index: '001', title: 'A', output: imageA, requestMode: 'prompt-only', status: 'success' },
    { index: '002', title: 'B', output: imageB, requestMode: 'masked-edit', status: 'needs_review' },
    { index: '003', title: 'C', requestMode: 'prompt-only', status: 'failed', error: 'timeout' },
  ]);
  runScript('daoge.js', ['ingest',
    '--prompt-pack-file', promptPack,
    '--results-file', resultsFile,
    '--output-dir', outputDir,
  ]);
  assertWorkspacePagesExist(assert, outputDir);
  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  assert.equal(library.assets.filter((asset) => asset.kind === 'image_result' || asset.kind === 'issue_record').length, 3);
  assert.equal(library.assets.some((asset) => asset.group === '已选结果'), true);
  assert.equal(library.assets.some((asset) => asset.group === '交付成果'), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'results')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'review')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'selected')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'exports', 'report.html')), true);
});

test('host-native needs_review does not block result review', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const image = path.join(tempDir, 'review.png');
  writeTinyPng(image);
  const promptPack = path.join(tempDir, 'prompt_pack.json');
  const resultsFile = path.join(tempDir, 'results.json');
  writeJson(promptPack, {
    prompt_count: 1,
    task_summary: { content_brief: '人物主视觉', batch_size: 1, width: 1024, height: 1024 },
  });
  writeJson(resultsFile, [
    { index: '001', title: '待确认', output: image, requestMode: 'prompt-only', status: 'needs_review' },
  ]);
  runScript('daoge.js', ['ingest',
    '--prompt-pack-file', promptPack,
    '--results-file', resultsFile,
    '--output-dir', outputDir,
  ]);
  const state = readJson(path.join(outputDir, 'internal', 'workspace_state.json'));
  const issues = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(issues.summary.blocking, 0);
  assert.equal(issues.items[0].type, 'needs_review');
  assert.equal(state.primaryAction.targetPage, 'results.html');
  assert.match(state.primaryAction.label, /确认/);
});

test('host-native success with missing output lands on issues', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const promptPack = path.join(tempDir, 'prompt_pack.json');
  const resultsFile = path.join(tempDir, 'results.json');
  writeJson(promptPack, {
    prompt_count: 1,
    task_summary: { content_brief: '人物主视觉', batch_size: 1, width: 1024, height: 1024 },
  });
  writeJson(resultsFile, [
    { index: '001', title: '缺图结果', output: 'missing.png', requestMode: 'prompt-only', status: 'success' },
  ]);
  runScript('daoge.js', ['ingest',
    '--prompt-pack-file', promptPack,
    '--results-file', resultsFile,
    '--output-dir', outputDir,
  ]);
  const state = readJson(path.join(outputDir, 'internal', 'workspace_state.json'));
  const issues = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(state.primaryAction.targetPage, 'issues.html');
  assert.equal(issues.summary.blocking, 1);
  assert.equal(issues.summary.rerunCandidates, 1);
  assert.equal(issues.items.some((item) => item.reason === 'missing_output' && item.rerunnable === true), true);
  const issuesVm = readJson(path.join(outputDir, 'internal', 'view_models', 'issues.json'));
  assert.equal(issuesVm.issueSummary.worthRerun, 1);
  assert.equal(issuesVm.issueSummary.safeToIgnore, 1);
  const issuesHtml = fs.readFileSync(path.join(outputDir, 'workspace', 'issues.html'), 'utf8');
  assert.match(issuesHtml, /文件缺失|可补跑/);
});
