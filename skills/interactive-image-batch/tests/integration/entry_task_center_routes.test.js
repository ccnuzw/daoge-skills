const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  skillRoot,
  makeTempDir,
  readJson,
  runScript,
  writeJson,
} = require('../helpers/workspace_v2_test_utils');
const { buildTaskCenterState } = require('../../scripts/task_center_state_shared');
const { refreshRuntimeWorkbench } = require('../../scripts/workbench_state_runtime');

const RETIRED_PAGES = /workspace_home\.html|prepare_workspace\.html|result_workspace\.html|exception_workspace\.html|run_record\.html/;

function normalize(text) {
  return String(text || '').replace(/\\/g, '/');
}

function writeMinimalCatalog(filePath) {
  writeJson(filePath, {
    examples: [
      {
        id: 'portrait-basic',
        name: '人物肖像',
        category: 'portraits-and-characters',
        description: '生成一组人物肖像。',
        starter_intent: 'portrait',
        template_id: 'portrait',
        template_variant: 'basic',
        example_file: 'portrait.example.json',
      },
    ],
  });
}

test('task center latest workspace and record point to v2 pages', () => {
  const rootDir = makeTempDir();
  const outputDir = path.join(rootDir, 'run-a');
  fs.mkdirSync(path.join(outputDir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'workspace', 'index.html'), '');
  fs.writeFileSync(path.join(outputDir, 'workspace', 'record.html'), '');
  const indexFile = path.join(rootDir, 'daoge_run_index.json');
  writeJson(indexFile, [
    {
      outputDir,
      manifest: path.join(outputDir, 'debug', 'compat', 'manifest.json'),
      generatedAt: '2026-07-05T00:00:00.000Z',
      selectedCount: 1,
      success: 1,
      failed: 0,
      skipped: 0,
      batchCount: 1,
      batchSize: 1,
      model: 'gpt-image-2',
      defaultSize: '1024x1024',
    },
  ]);

  runScript('render_task_center.js', [
    '--index-file', indexFile,
    '--output-file', path.join(rootDir, 'task_center.html'),
  ]);

  const state = buildTaskCenterState(indexFile);
  assert.equal(normalize(state.latestWorkspace).endsWith('/workspace/index.html'), true);
  assert.equal(normalize(state.latestRecord).endsWith('/workspace/record.html'), true);

  const html = normalize(fs.readFileSync(path.join(rootDir, 'task_center.html'), 'utf8'));
  assert.match(html, /run-a\/workspace\/index\.html/);
  assert.doesNotMatch(html, RETIRED_PAGES);
  assert.doesNotMatch(normalize(JSON.stringify(state)), RETIRED_PAGES);
});

test('entry state next step and workbench card point to v2 prepare page', () => {
  const rootDir = makeTempDir();
  const outputDir = path.join(rootDir, 'run-b');
  const catalogFile = path.join(rootDir, 'examples.catalog.json');
  const entryStateFile = path.join(outputDir, 'entry_state.json');
  fs.mkdirSync(outputDir, { recursive: true });
  writeMinimalCatalog(catalogFile);

  runScript('build_entry_state.js', [
    '--catalog-file', catalogFile,
    '--selected-id', 'portrait-basic',
    '--output-dir', outputDir,
    '--output-file', entryStateFile,
  ]);

  const state = readJson(entryStateFile);
  const serialized = normalize(JSON.stringify(state));
  assert.equal(normalize(state.recommendedNextStep.target).endsWith('/workspace/prepare.html'), true);
  assert.equal(normalize(state.entryWorkbench.workbench.cards[2].file).endsWith('/workspace/prepare.html'), true);
  assert.doesNotMatch(serialized, RETIRED_PAGES);
});

test('example catalog route recommends only v2 workspace pages', () => {
  const rootDir = makeTempDir();
  const catalogFile = path.join(rootDir, 'examples.catalog.json');
  const entryStateFile = path.join(rootDir, 'entry_state.json');
  const outputFile = path.join(rootDir, 'examples_catalog.html');
  fs.mkdirSync(path.join(rootDir, 'workspace'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'workspace', 'prepare.html'), '');
  writeMinimalCatalog(catalogFile);
  runScript('build_entry_state.js', [
    '--catalog-file', catalogFile,
    '--selected-id', 'portrait-basic',
    '--output-dir', rootDir,
    '--output-file', entryStateFile,
  ]);

  runScript('render_example_catalog_board.js', [
    '--catalog-file', catalogFile,
    '--entry-state-file', entryStateFile,
    '--output-file', outputFile,
  ]);

  const html = normalize(fs.readFileSync(outputFile, 'utf8'));
  assert.match(html, /workspace\/prepare\.html/);
  assert.doesNotMatch(html, RETIRED_PAGES);
});

test('runtime workbench refresh emits v2 workspace surfaces only', () => {
  const outputDir = path.join(makeTempDir(), 'running');
  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, 'manifest.json'), {
    outputDir,
    runtimeMode: 'local-batch-runner',
    selectedCount: 2,
    success: 0,
    failed: 0,
    batchCount: 1,
    batches: [],
  });
  writeJson(path.join(outputDir, 'job_state.json'), {
    status: 'running',
    selectedCount: 2,
    progress: {
      totalBatches: 1,
      completedBatches: 0,
      currentBatch: 1,
      currentStage: 1,
      success: 0,
      failed: 0,
      skipped: 0,
      completedPrompts: 0,
    },
  });
  writeJson(path.join(outputDir, 'stage_plan.json'), {
    stages: [{ stageNumber: 1, type: 'production' }],
  });
  [
    'workspace_home.html',
    'prepare_workspace.html',
    'result_workspace.html',
    'exception_workspace.html',
    'run_record.html',
  ].forEach((fileName) => {
    fs.writeFileSync(path.join(outputDir, fileName), 'retired');
  });

  const refreshed = refreshRuntimeWorkbench(outputDir);
  assert.equal(normalize(refreshed.workspaceIndexPath).endsWith('/workspace/index.html'), true);
  assert.equal(normalize(refreshed.workspaceHomePath).endsWith('/workspace/index.html'), true);
  assert.equal(normalize(refreshed.prepareWorkspacePath).endsWith('/workspace/prepare.html'), true);
  assert.equal(normalize(refreshed.resultWorkspacePath).endsWith('/workspace/results.html'), true);
  assert.equal(normalize(refreshed.exceptionWorkspacePath).endsWith('/workspace/issues.html'), true);
  assert.equal(refreshed.workbenchStatePath, refreshed.unifiedWorkbenchStatePath);
  assert.equal(normalize(refreshed.workspaceTimelinePath).endsWith('/internal/workspace_state.json'), true);
  assert.equal(fs.existsSync(refreshed.unifiedWorkbenchStatePath), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'workspace', 'index.html')), true);
  assert.equal(fs.existsSync(path.join(outputDir, 'workspace_home.html')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'prepare_workspace.html')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'result_workspace.html')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'exception_workspace.html')), false);
  assert.equal(fs.existsSync(path.join(outputDir, 'run_record.html')), false);

  const runtimeState = normalize(fs.readFileSync(path.join(outputDir, 'runtime_state.json'), 'utf8'));
  const liveStateRaw = fs.readFileSync(refreshed.unifiedWorkbenchStatePath, 'utf8');
  const liveState = normalize(liveStateRaw);
  const liveStateJson = JSON.parse(liveStateRaw);
  assert.match(runtimeState, /workspace\/index\.html/);
  assert.match(liveState, /workspace\/index\.html/);
  assert.equal(Boolean(liveStateJson.runtimeState.currentStatus), true);
  assert.equal(Object.prototype.hasOwnProperty.call(liveStateJson.runtimeState, 'snapshot'), false);
  assert.doesNotMatch(runtimeState, RETIRED_PAGES);
  assert.doesNotMatch(liveState, RETIRED_PAGES);
});

test('example quickstart summary returns v2 workspace fields', () => {
  const outputDir = makeTempDir();
  const stdout = runScript('run_example_quickstart_prepare.js', [
    '--example-file', path.join(skillRoot, 'references', 'examples', 'portraits-and-characters', 'portrait_kv.example.json'),
    '--output-dir', outputDir,
  ]);
  const summary = JSON.parse(stdout);
  const serialized = normalize(JSON.stringify(summary));
  assert.equal(normalize(summary.workspaceIndex).endsWith('/workspace/index.html'), true);
  assert.equal(normalize(summary.workspacePrepare).endsWith('/workspace/prepare.html'), true);
  assert.doesNotMatch(serialized, RETIRED_PAGES);
});
