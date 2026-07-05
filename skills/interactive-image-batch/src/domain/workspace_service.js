const fs = require('fs');
const path = require('path');
const {
  VIEW_IDS,
  ensureV2Layout,
  readJsonIfExists,
  writeJson,
} = require('../shared/workspace');
const { buildRunPlan } = require('./run_plan');
const { buildExecutionManifest } = require('./execution_manifest');
const { buildIssueQueue } = require('./issue_queue');
const { buildAssetLibrary } = require('./asset_library');
const { buildWorkspaceState } = require('./workspace_state');
const { buildViewModels } = require('./view_models');
const { renderViewModelFile } = require('../renderers/workspace_page');
const { assertContract } = require('../contracts');

const RETIRED_FILES = [
  'workspace_home.html',
  'prepare_workspace.html',
  'result_workspace.html',
  'exception_workspace.html',
  'run_record.html',
  'manifest.json',
  'batch_plan.json',
  'stage_plan.json',
  'job_state.json',
  'checkpoint.json',
  'success.json',
  'failed.json',
  'skipped.json',
  'needs_review.json',
  'rerun_candidates.json',
];

const RETIRED_WORKSPACE_FILES = [
  'workspace_home.html',
  'prepare_workspace.html',
  'result_workspace.html',
  'exception_workspace.html',
  'run_record.html',
  'review_board.html',
  'completion_board.html',
  'run_overview.html',
  'rerun_board.html',
  'preflight_board.html',
  'prompt_preview.html',
];

function removeRetiredFiles(outputDir) {
  RETIRED_FILES.forEach((fileName) => {
    fs.rmSync(path.join(outputDir, fileName), { force: true });
  });
  RETIRED_WORKSPACE_FILES.forEach((fileName) => {
    fs.rmSync(path.join(outputDir, 'workspace', fileName), { force: true });
  });
}

function writeWorkspaceReadme(outputDir) {
  const state = readJsonIfExists(path.join(outputDir, 'internal', 'workspace_state.json')) || {};
  const lines = [
    '# DAOGE 当前任务入口',
    '',
    '从 `workspace/index.html` 开始。',
    '',
    `- 任务：${state.task?.title || '生图任务'}`,
    `- 当前阶段：${state.stage?.name || '准备中'}`,
    `- 下一步：${state.primaryAction?.label || '继续'}`,
    `- 可回复：${state.primaryAction?.reply || '继续'}`,
    '',
    '用户页面在 `workspace/`。图片和可交付内容在 `assets/`。机器状态在 `internal/`。维护诊断在 `debug/`。',
  ];
  fs.writeFileSync(path.join(outputDir, 'README.md'), `${lines.join('\n')}\n`);
}

function refreshWorkspace(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const internalDir = path.join(outputDir, 'internal');
  const runPlanPath = path.join(internalDir, 'run_plan.json');
  const executionManifestPath = path.join(internalDir, 'execution_manifest.json');
  const issueQueuePath = path.join(internalDir, 'issue_queue.json');
  const assetLibraryPath = path.join(internalDir, 'asset_library.json');
  const workspaceStatePath = path.join(internalDir, 'workspace_state.json');

  const runPlan = buildRunPlan({
    outputDir,
    outputFile: runPlanPath,
    taskSpecFile: options.taskSpecFile,
    promptsFile: options.promptsFile,
    batchPlanFile: options.batchPlanFile,
    validationReportFile: options.validationReportFile,
    modeFile: options.modeFile,
    manifestFile: options.manifestFile,
    materialBaseDir: options.materialBaseDir,
    materialsFile: options.materialsFile,
    intent: options.intent,
  });
  const executionManifest = buildExecutionManifest({
    outputDir,
    outputFile: executionManifestPath,
    manifestFile: options.manifestFile,
    resultsFile: options.resultsFile,
  });
  const issueQueue = buildIssueQueue({
    outputDir,
    outputFile: issueQueuePath,
    executionManifestFile: executionManifestPath,
  });
  const assetLibrary = buildAssetLibrary({
    outputDir,
    outputFile: assetLibraryPath,
    runPlanFile: runPlanPath,
    executionManifestFile: executionManifestPath,
  });
  const workspaceState = buildWorkspaceState({
    outputDir,
    outputFile: workspaceStatePath,
    runPlanFile: runPlanPath,
    executionManifestFile: executionManifestPath,
    issueQueueFile: issueQueuePath,
    assetLibraryFile: assetLibraryPath,
  });
  const viewModels = buildViewModels({
    outputDir,
    workspaceStateFile: workspaceStatePath,
    runPlanFile: runPlanPath,
    issueQueueFile: issueQueuePath,
    assetLibraryFile: assetLibraryPath,
  });

  assertContract('runPlan', runPlan);
  assertContract('executionManifest', executionManifest);
  assertContract('issueQueue', issueQueue);
  assertContract('assetLibrary', assetLibrary);
  assertContract('workspaceState', workspaceState);
  Object.values(viewModels).forEach((viewModel) => assertContract('viewModel', viewModel));

  VIEW_IDS.forEach((pageId) => {
    renderViewModelFile(
      path.join(outputDir, 'internal', 'view_models', `${pageId}.json`),
      path.join(outputDir, 'workspace', `${pageId}.html`)
    );
  });

  writeJson(path.join(internalDir, 'workspace_refresh_summary.json'), {
    generatedAt: new Date().toISOString(),
    outputDir,
    pages: VIEW_IDS.map((pageId) => `workspace/${pageId}.html`),
  });
  writeWorkspaceReadme(outputDir);
  removeRetiredFiles(outputDir);

  return {
    outputDir,
    workspaceIndex: path.join(outputDir, 'workspace', 'index.html'),
    pages: Object.fromEntries(VIEW_IDS.map((pageId) => [pageId, path.join(outputDir, 'workspace', `${pageId}.html`)])),
    internal: {
      runPlan: runPlanPath,
      executionManifest: executionManifestPath,
      issueQueue: issueQueuePath,
      assetLibrary: assetLibraryPath,
      workspaceState: workspaceStatePath,
    },
    viewModels,
  };
}

module.exports = { refreshWorkspace, refreshWorkspaceV2: refreshWorkspace };
