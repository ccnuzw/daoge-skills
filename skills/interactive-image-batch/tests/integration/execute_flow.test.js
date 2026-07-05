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
  writeJson,
  assertWorkspacePagesExist,
} = require('../helpers/workspace_v2_test_utils');
const { createOperationalArtifacts, renderWorkspaceBundle } = require('../../scripts/run_batch_artifacts');
const { refreshWorkspaceV2 } = require('../../scripts/refresh_workspace_v2');

function normalizePathText(text) {
  return String(text).replace(/\\/g, '/');
}

const RETIRED_PAGES = /workspace_home\.html|prepare_workspace\.html|result_workspace\.html|exception_workspace\.html|run_record\.html/;

test('local runner dry-run emits v2 workspace structure', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  runScript('run_batch.js', [
    '--prompts-file', path.join(skillRoot, 'tests', 'fixtures', 'prompts.minimal.json'),
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
  ]);
  assertWorkspacePagesExist(assert, outputDir);
  const readme = normalizePathText(fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8'));
  assert.match(readme, /workspace\/index\.html/);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'compat', 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'manifest.json')), false);
  const runIndex = readJson(path.join(tempDir, 'daoge_run_index.json'));
  assert.equal(runIndex[0].manifest.endsWith(path.join('debug', 'compat', 'manifest.json')), true);
  assert.equal(fs.existsSync(runIndex[0].manifest), true);
  assert.doesNotMatch(normalizePathText(JSON.stringify(runIndex)), RETIRED_PAGES);
  const runIndexMarkdown = normalizePathText(fs.readFileSync(path.join(tempDir, 'daoge_run_index.md'), 'utf8'));
  const taskCenterState = normalizePathText(fs.readFileSync(path.join(tempDir, 'task_center_state.json'), 'utf8'));
  const taskCenterHtml = normalizePathText(fs.readFileSync(path.join(tempDir, 'task_center.html'), 'utf8'));
  assert.match(taskCenterState, /workspace\/index\.html/);
  assert.match(taskCenterState, /workspace\/record\.html/);
  assert.match(taskCenterHtml, /workspace\/index\.html/);
  assert.doesNotMatch(runIndexMarkdown, RETIRED_PAGES);
  assert.doesNotMatch(taskCenterState, RETIRED_PAGES);
  assert.doesNotMatch(taskCenterHtml, RETIRED_PAGES);
  const operationsReport = readJson(path.join(outputDir, 'debug', 'compat', 'operations_report.json'));
  assert.equal(operationsReport.manifest.endsWith(path.join('debug', 'compat', 'manifest.json')), true);
  assert.equal(fs.existsSync(operationsReport.manifest), true);
});

test('local runner result details and archive markdown run before final v2 cleanup', () => {
  const tempDir = makeTempDir();
  const outputDir = path.join(tempDir, 'out');
  const envFile = path.join(tempDir, '.env');
  writeEnv(envFile);
  runScript('run_batch.js', [
    '--prompts-file', path.join(skillRoot, 'tests', 'fixtures', 'prompts.minimal.json'),
    '--env-file', envFile,
    '--dry-run', 'true',
    '--output-dir', outputDir,
    '--batch-size', '1',
    '--concurrency', '1',
    '--emit-optional-pages', 'result-details',
    '--emit-archive-markdown', 'true',
  ]);
  assertWorkspacePagesExist(assert, outputDir);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'compat', 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'manifest.json')), false);
});

test('diagnostic selection board points to v2 workspace and debug compatibility files', () => {
  const outputDir = path.join(makeTempDir(), 'out');
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = {
    outputDir,
    generatedAt: new Date().toISOString(),
    promptSource: path.join(outputDir, 'prompts.generated.json'),
    selectedCount: 1,
    success: 0,
    failed: 1,
    skipped: 0,
    batchCount: 1,
    batchSize: 1,
    model: 'gpt-image-2',
    defaultSize: '1024x1024',
    batches: [{ batchNumber: 1, failed: 1, success: 0, results: [{ index: 1, ok: false, error: 'timeout' }] }],
  };
  writeJson(path.join(outputDir, 'manifest.json'), manifest);
  writeJson(path.join(outputDir, 'prompts.generated.json'), [{ index: 1, title: '失败项' }]);
  createOperationalArtifacts(outputDir, manifest, manifest.batches[0].results, { readJson, writeJson }, {
    generateDiagnosticMarkdown: true,
  });
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'prompts.generated.json')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'compat', 'manifest.json')), true);
  let selectionBoard = normalizePathText(fs.readFileSync(path.join(outputDir, 'selection_board.md'), 'utf8'));
  assert.match(selectionBoard, /debug\/compat\/manifest\.json/);
  assert.match(selectionBoard, /debug\/prompts\.generated\.json/);

  refreshWorkspaceV2({ outputDir, manifestFile: path.join(outputDir, 'manifest.json'), pruneLegacy: true });
  selectionBoard = normalizePathText(fs.readFileSync(path.join(outputDir, 'selection_board.md'), 'utf8'));
  assert.match(selectionBoard, /workspace\/issues\.html/);
  assert.match(selectionBoard, /debug\/compat\/manifest\.json/);
  assert.match(selectionBoard, /debug\/prompts\.generated\.json/);
  assert.doesNotMatch(selectionBoard, /result_workspace\.html/);
  assert.doesNotMatch(selectionBoard, /exception_workspace\.html/);
});

test('diagnostic selection board does not emit rerun command when prompts are missing', () => {
  const outputDir = path.join(makeTempDir(), 'out');
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = {
    outputDir,
    generatedAt: new Date().toISOString(),
    promptSource: path.join(outputDir, 'missing.prompts.json'),
    selectedCount: 1,
    success: 0,
    failed: 1,
    skipped: 0,
    batchCount: 1,
    batchSize: 1,
    model: 'gpt-image-2',
    defaultSize: '1024x1024',
    batches: [{ batchNumber: 1, failed: 1, success: 0, results: [{ index: 1, ok: false, error: 'timeout' }] }],
  };
  writeJson(path.join(outputDir, 'manifest.json'), manifest);
  createOperationalArtifacts(outputDir, manifest, manifest.batches[0].results, { readJson, writeJson }, {
    generateDiagnosticMarkdown: true,
  });
  const selectionBoard = normalizePathText(fs.readFileSync(path.join(outputDir, 'selection_board.md'), 'utf8'));
  assert.match(selectionBoard, /缺少可用的提示词文件/);
  assert.doesNotMatch(selectionBoard, /--prompts-file/);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'compat', 'manifest.json')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'debug', 'prompts.generated.json')), false);
});

test('diagnostic selection board does not treat prompt directories as rerunnable prompt files', () => {
  const outputDir = path.join(makeTempDir(), 'out');
  fs.mkdirSync(outputDir, { recursive: true });
  const promptDirectory = path.join(outputDir, 'prompt-dir');
  fs.mkdirSync(promptDirectory, { recursive: true });
  const manifest = {
    outputDir,
    generatedAt: new Date().toISOString(),
    promptSource: promptDirectory,
    selectedCount: 1,
    success: 0,
    failed: 1,
    skipped: 0,
    batchCount: 1,
    batchSize: 1,
    model: 'gpt-image-2',
    defaultSize: '1024x1024',
    batches: [{ batchNumber: 1, failed: 1, success: 0, results: [{ index: 1, ok: false, error: 'timeout' }] }],
  };
  writeJson(path.join(outputDir, 'manifest.json'), manifest);
  createOperationalArtifacts(outputDir, manifest, manifest.batches[0].results, { readJson, writeJson }, {
    generateDiagnosticMarkdown: true,
  });
  const selectionBoard = normalizePathText(fs.readFileSync(path.join(outputDir, 'selection_board.md'), 'utf8'));
  assert.match(selectionBoard, /缺少可用的提示词文件/);
  assert.doesNotMatch(selectionBoard, /--prompts-file/);
});

test('diagnostic selection board accepts prompts already materialized in debug path', () => {
  const outputDir = path.join(makeTempDir(), 'out');
  fs.mkdirSync(path.join(outputDir, 'debug'), { recursive: true });
  const debugPromptPath = path.join(outputDir, 'debug', 'prompts.generated.json');
  writeJson(debugPromptPath, [{ index: 1, title: '失败项' }]);
  const manifest = {
    outputDir,
    generatedAt: new Date().toISOString(),
    promptSource: debugPromptPath,
    selectedCount: 1,
    success: 0,
    failed: 1,
    skipped: 0,
    batchCount: 1,
    batchSize: 1,
    model: 'gpt-image-2',
    defaultSize: '1024x1024',
    batches: [{ batchNumber: 1, failed: 1, success: 0, results: [{ index: 1, ok: false, error: 'timeout' }] }],
  };
  createOperationalArtifacts(outputDir, manifest, manifest.batches[0].results, { readJson, writeJson }, {
    generateDiagnosticMarkdown: true,
  });
  const selectionBoard = normalizePathText(fs.readFileSync(path.join(outputDir, 'selection_board.md'), 'utf8'));
  assert.match(selectionBoard, /--prompts-file/);
  assert.match(selectionBoard, /debug\/prompts\.generated\.json/);
});

test('workspace bundle exposes v2 state paths without legacy state aliases', () => {
  const outputDir = path.join(makeTempDir(), 'out');
  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, 'manifest.json'), {
    outputDir,
    runtimeMode: 'prepare-only',
    selectedCount: 0,
    batchCount: 0,
  });
  const bundle = renderWorkspaceBundle(outputDir);
  assert.equal(bundle.workspaceIndex.endsWith(path.join('workspace', 'index.html')), true);
  assert.equal(bundle.workspaceResults.endsWith(path.join('workspace', 'results.html')), true);
  assert.equal(bundle.workspaceRecord.endsWith(path.join('workspace', 'record.html')), true);
  assert.equal(bundle.workspaceHomePath.endsWith(path.join('workspace', 'index.html')), true);
  assert.equal(bundle.resultWorkspacePath.endsWith(path.join('workspace', 'results.html')), true);
  assert.equal(bundle.workspaceStateArtifacts.workspaceStatePath.endsWith(path.join('internal', 'workspace_state.json')), true);
  assert.equal(bundle.workspaceStateArtifacts.assetLibraryPath.endsWith(path.join('internal', 'asset_library.json')), true);
  assert.equal(bundle.workspaceStateArtifacts.issueQueuePath.endsWith(path.join('internal', 'issue_queue.json')), true);
  assert.equal(bundle.workspaceStateArtifacts.runPlanPath.endsWith(path.join('internal', 'run_plan.json')), true);
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.workspaceStateArtifacts, 'workspaceAssetsPath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.workspaceStateArtifacts, 'workspaceTimelinePath'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(bundle.workspaceStateArtifacts, 'workbenchStatePath'), false);
});
