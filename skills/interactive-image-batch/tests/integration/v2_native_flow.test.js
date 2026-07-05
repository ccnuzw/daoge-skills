const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { refreshWorkspaceV2 } = require('../../src/domain/workspace_service');
const {
  makeTempDir,
  readJson,
  runScript,
  skillRoot,
  writeJson,
  writeTinyPng,
  assertWorkspacePagesExist,
} = require('../helpers/workspace_v2_test_utils');

function refreshWithManifest(manifest, extra = {}) {
  const outputDir = makeTempDir();
  const manifestFile = path.join(outputDir, 'manifest.json');
  writeJson(manifestFile, { outputDir, ...manifest });
  refreshWorkspaceV2({ outputDir, manifestFile, ...extra });
  return outputDir;
}

test('prepare-only v2 output does not imply generated images', () => {
  const outputDir = refreshWithManifest({
    runtimeMode: 'prepare-only',
    selectedCount: 2,
    batchCount: 1,
    defaultSize: '1024x1024',
  });
  assertWorkspacePagesExist(assert, outputDir);
  const state = readJson(path.join(outputDir, 'internal', 'workspace_state.json'));
  assert.equal(state.stage.id, 'prepare');
  assert.equal(state.counts.total, 0);
  assert.equal(state.primaryAction.targetPage, 'results.html');
});

test('execute success-only outputs results, selected and exports', () => {
  const outputDir = makeTempDir();
  const image = path.join(outputDir, 'raw', 'batch_001', 'ok.png');
  writeTinyPng(image);
  const manifestFile = path.join(outputDir, 'manifest.json');
  writeJson(manifestFile, {
    outputDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 1,
    success: 1,
    failed: 0,
    batches: [{ batchNumber: 1, success: 1, failed: 0, results: [{ index: 1, ok: true, output: image }] }],
  });
  refreshWorkspaceV2({ outputDir, manifestFile });
  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  assert.equal(library.assets.some((asset) => asset.group === '已选结果'), true);
  assert.equal(library.assets.some((asset) => asset.group === '交付成果'), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'assets', 'exports', 'report.html')), true);
});

test('full refresh routes missing success output to issues without fake selected exports', () => {
  const outputDir = refreshWithManifest({
    runtimeMode: 'local-batch-runner',
    selectedCount: 1,
    success: 1,
    failed: 0,
    batches: [{ batchNumber: 1, success: 1, failed: 0, results: [{ index: 1, ok: true, output: 'raw/missing.png' }] }],
  });
  const state = readJson(path.join(outputDir, 'internal', 'workspace_state.json'));
  const queue = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  const issuesHtml = fs.readFileSync(path.join(outputDir, 'workspace', 'issues.html'), 'utf8');
  assert.equal(state.primaryAction.targetPage, 'issues.html');
  assert.equal(queue.summary.blocking, 1);
  assert.equal(queue.summary.rerunCandidates, 1);
  assert.equal(queue.items.some((item) => item.type === 'hard_failure' && /文件缺失/.test(item.title)), true);
  assert.equal(library.assets.some((asset) => asset.kind === 'selected_result'), false);
  assert.equal(library.assets.some((asset) => asset.kind === 'export_image'), false);
  assert.equal(library.groups.find((group) => group.id === 'issues').assetIds.length, 1);
  assert.match(issuesHtml, /文件缺失/);
});

test('execute failed rerun candidate routes to issues with rerun reason', () => {
  const outputDir = refreshWithManifest({
    runtimeMode: 'local-batch-runner',
    selectedCount: 1,
    success: 0,
    failed: 1,
    batches: [{ batchNumber: 1, failed: 1, results: [{ index: 1, ok: false, worthRerun: true, rerunReason: '关键镜头失败', error: 'timeout' }] }],
  });
  const state = readJson(path.join(outputDir, 'internal', 'workspace_state.json'));
  const queue = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(state.primaryAction.targetPage, 'issues.html');
  assert.equal(queue.items.some((item) => item.type === 'rerun_candidate' && /关键镜头失败/.test(item.impact)), true);
});

test('execute needs-review-only sends primary action back to results', () => {
  const outputDir = makeTempDir();
  const image = path.join(outputDir, 'raw', 'batch_001', 'review.png');
  writeTinyPng(image);
  const manifestFile = path.join(outputDir, 'manifest.json');
  writeJson(manifestFile, {
    outputDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 1,
    success: 1,
    failed: 0,
    needsReview: 1,
    batches: [{ batchNumber: 1, success: 1, failed: 0, results: [{ index: 1, status: 'needs_review', ok: true, output: image }] }],
  });
  refreshWorkspaceV2({ outputDir, manifestFile });
  const state = readJson(path.join(outputDir, 'internal', 'workspace_state.json'));
  const queue = readJson(path.join(outputDir, 'internal', 'issue_queue.json'));
  assert.equal(queue.summary.blocking, 0);
  assert.equal(state.primaryAction.targetPage, 'results.html');
});

test('reference-assisted and masked-edit tasks create references and masks assets', () => {
  const outputDir = makeTempDir();
  const reference = path.join(outputDir, 'person.png');
  const mask = path.join(outputDir, 'mask.png');
  writeTinyPng(reference);
  writeTinyPng(mask);
  const taskSpec = path.join(outputDir, 'task_spec.json');
  writeJson(taskSpec, {
    content_brief: '人物主视觉',
    reference_images: [{ title: '人物参考', path: reference, category: '人物参考' }],
    masks: [{ title: '遮罩 001', path: mask }],
  });
  refreshWorkspaceV2({ outputDir, taskSpecFile: taskSpec });
  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  assert.equal(library.assets.some((asset) => asset.group === '人物参考' && asset.path.startsWith('assets/references/')), true);
  assert.equal(library.assets.some((asset) => asset.group === '局部重绘遮罩' && asset.path.startsWith('assets/masks/')), true);
});

test('relative reference assets resolve from task spec directory', () => {
  const outputDir = makeTempDir();
  const specDir = path.join(makeTempDir(), 'spec');
  const reference = path.join(specDir, 'relative-person.png');
  fs.mkdirSync(specDir, { recursive: true });
  writeTinyPng(reference);
  const taskSpec = path.join(specDir, 'task_spec.json');
  writeJson(taskSpec, {
    content_brief: '人物主视觉',
    reference_images: [{ title: '人物参考', path: 'relative-person.png', category: '人物参考' }],
  });
  refreshWorkspaceV2({ outputDir, taskSpecFile: taskSpec });
  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  const asset = library.assets.find((item) => item.group === '人物参考');
  assert.equal(Boolean(asset), true);
  assert.equal(fs.existsSync(path.join(outputDir, asset.path)), true);
  assert.equal(path.extname(asset.path), '.png');
});

test('prepare entry preserves original task spec directory for relative reference assets', () => {
  const outputDir = makeTempDir();
  const specDir = path.join(makeTempDir(), 'spec');
  const reference = path.join(specDir, 'relative-person.png');
  fs.mkdirSync(specDir, { recursive: true });
  writeTinyPng(reference);
  const taskSpec = path.join(specDir, 'task_spec.json');
  writeJson(taskSpec, {
    content_brief: '人物主视觉',
    output_mode: 'photoreal campaign poster',
    reference_images: [{ title: '人物参考', path: 'relative-person.png', category: '人物参考' }],
    total_count: 1,
    batch_size: 1,
    concurrency: 1,
    retry_count: 1,
    timeout_seconds: 450,
    width: 1024,
    height: 1024,
    text_policy: 'leave clean space',
    style_requirements: ['portrait'],
    variation_requirements: ['avoid near-duplicates'],
    preview_count: 1,
    require_confirmation: true,
  });
  runScript('daoge.js', ['prepare',
    '--task-spec', taskSpec,
    '--strategy-file', path.join(skillRoot, 'tests', 'fixtures', 'prompt_strategy.minimal.json'),
    '--prompts-file', path.join(skillRoot, 'tests', 'fixtures', 'prompts.minimal.json'),
    '--output-dir', outputDir,
    '--batch-size', '1',
  ]);
  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  const asset = library.assets.find((item) => item.group === '人物参考');
  assert.equal(Boolean(asset), true);
  assert.equal(path.extname(asset.path), '.png');
  assert.equal(fs.existsSync(path.join(outputDir, asset.path)), true);
});

test('storyboard task assets use frame and shot labels instead of internal slot wording', () => {
  const outputDir = makeTempDir();
  const image = path.join(outputDir, 'shot.png');
  writeTinyPng(image);
  const manifestFile = path.join(outputDir, 'manifest.json');
  writeJson(manifestFile, {
    outputDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 1,
    success: 1,
    failed: 0,
    batches: [{ batchNumber: 1, results: [{ index: 1, ok: true, output: image, slotId: 'slot_001' }] }],
  });
  refreshWorkspaceV2({ outputDir, manifestFile });
  const library = readJson(path.join(outputDir, 'internal', 'asset_library.json'));
  assert.equal(library.assets.some((asset) => /第 1 格 \/ 镜头 1/.test(asset.userTitle)), true);
});
