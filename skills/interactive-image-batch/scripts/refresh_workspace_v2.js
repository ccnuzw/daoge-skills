const fs = require('fs');
const path = require('path');
const {
  parseArgs,
  ensureV2Layout,
  readJsonIfExists,
  writeJson,
} = require('./workspace_v2_shared');
const { buildRunPlan } = require('./build_run_plan');
const { buildExecutionManifest } = require('./build_execution_manifest');
const { buildIssueQueue } = require('./build_issue_queue');
const { buildAssetLibrary } = require('./build_asset_library');
const { buildWorkspaceState } = require('./build_workspace_state_v2');
const { buildViewModels } = require('./build_view_models');
const { renderViewModelFile } = require('./render_workspace_page_v2');

const LEGACY_ROOT_FILES = [
  'workspace_home.html',
  'prepare_workspace.html',
  'result_workspace.html',
  'exception_workspace.html',
  'run_record.html',
  'workspace_state.json',
  'workspace_assets.json',
  'workspace_timeline.json',
  'workbench_state.json',
  'manifest.json',
  'batch_plan.json',
  'stage_plan.json',
  'job_state.json',
  'checkpoint.json',
  'workspace_live_state.json',
  'workbench_state.json',
  'runtime_state.json',
  'operations_report.json',
  'success.json',
  'failed.json',
  'skipped.json',
  'needs_review.json',
  'rerun_candidates.json',
  'prompts.generated.json',
  'workspace_layout_manifest.json',
  'workspace_chrome.css',
  'workspace_chrome.js',
];

const LEGACY_WORKSPACE_FILES = [
  'workspace_home.html',
  'prepare_workspace.html',
  'result_workspace.html',
  'exception_workspace.html',
  'run_record.html',
  'review_board.html',
  'completion_board.html',
  'run_overview.html',
  'rerun_board.html',
  'prompt_preview.html',
  'preflight_board.html',
  'assets_board.html',
  'result_hub.html',
  'daoge_portal.html',
];

const DEBUG_CANDIDATES = [
  ['prompts.generated.json', 'prompts.generated.json'],
  ['prompt_strategy.enriched.json', 'prompt_strategy.json'],
  ['task_spec.normalized.json', 'task_spec.json'],
  ['daoge_mode_detection.json', 'mode_detection.json'],
  ['provider_trace.json', 'provider_trace.json'],
  ['template_registry_validation_report.json', 'template_detection.json'],
  ['template_registry_report.html', 'registry_report.html'],
];

const COMPAT_DEBUG_FILES = [
  'manifest.json',
  'batch_plan.json',
  'stage_plan.json',
  'job_state.json',
  'checkpoint.json',
  'workspace_live_state.json',
  'runtime_state.json',
  'operations_report.json',
  'success.json',
  'failed.json',
  'skipped.json',
  'needs_review.json',
  'rerun_candidates.json',
  'workspace_layout_manifest.json',
];

function removeIfExists(filePath) {
  if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
}

function copyDebugFiles(outputDir) {
  DEBUG_CANDIDATES.forEach(([sourceName, targetName]) => {
    const source = path.join(outputDir, sourceName);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return;
    fs.copyFileSync(source, path.join(outputDir, 'debug', targetName));
  });
}

function pruneLegacyFiles(outputDir) {
  const compatDir = path.join(outputDir, 'debug', 'compat');
  fs.mkdirSync(compatDir, { recursive: true });
  COMPAT_DEBUG_FILES.forEach((fileName) => {
    const source = path.join(outputDir, fileName);
    if (fs.existsSync(source) && fs.statSync(source).isFile()) {
      fs.copyFileSync(source, path.join(compatDir, fileName));
    }
    const internalSource = path.join(outputDir, 'internal', fileName);
    if (fs.existsSync(internalSource) && fs.statSync(internalSource).isFile()) {
      fs.copyFileSync(internalSource, path.join(compatDir, fileName));
      removeIfExists(internalSource);
    }
  });
  LEGACY_ROOT_FILES.forEach((fileName) => removeIfExists(path.join(outputDir, fileName)));
  LEGACY_WORKSPACE_FILES.forEach((fileName) => removeIfExists(path.join(outputDir, 'workspace', fileName)));
}

function writeReadme(outputDir) {
  const state = readJsonIfExists(path.join(outputDir, 'internal', 'workspace_state.json')) || {};
  const lines = [
    '# DAOGE 当前任务入口',
    '',
    '请从 `workspace/index.html` 开始。',
    '',
    '- 先看：当前任务、当前步骤、主动作、下一句可以怎么说',
    '- 素材：在 `assets/` 里按输入、参考、结果、已选、复核、问题和交付整理',
    '- 维护资料：普通使用不需要打开',
    '',
    '## 当前状态',
    '',
    `- 任务：${state.task?.title || '生图任务'}`,
    `- 阶段：${state.stage?.name || '开跑前确认'}`,
    `- 主动作：${state.primaryAction?.label || '继续'}`,
    `- 建议回复：${state.primaryAction?.reply || '继续'}`,
  ];
  fs.writeFileSync(path.join(outputDir, 'README.md'), `${lines.join('\n')}\n`);
}

function firstExisting(...candidates) {
  return candidates.find((filePath) => filePath && fs.existsSync(filePath)) || candidates.find(Boolean) || null;
}

function refreshWorkspaceV2(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const shouldPruneLegacy = options.pruneLegacy !== false;
  const internalDir = path.join(outputDir, 'internal');
  const debugCompatDir = path.join(outputDir, 'debug', 'compat');
  const manifestFile = firstExisting(options.manifestFile, path.join(outputDir, 'manifest.json'), path.join(debugCompatDir, 'manifest.json'));
  const taskSpecFile = firstExisting(options.taskSpecFile, path.join(outputDir, 'task_spec.normalized.json'), path.join(outputDir, 'debug', 'task_spec.json'));
  const promptsFile = firstExisting(options.promptsFile, path.join(outputDir, 'prompts.generated.json'), path.join(outputDir, 'debug', 'prompts.generated.json'));
  const batchPlanFile = firstExisting(options.batchPlanFile, path.join(outputDir, 'batch_plan.json'), path.join(debugCompatDir, 'batch_plan.json'));
  const validationReportFile = firstExisting(options.validationReportFile, path.join(outputDir, 'prompt_validation_report.json'));
  const modeFile = firstExisting(options.modeFile, path.join(outputDir, 'daoge_mode_detection.json'), path.join(outputDir, 'debug', 'mode_detection.json'));
  const runPlanPath = path.join(internalDir, 'run_plan.json');
  const executionManifestPath = path.join(internalDir, 'execution_manifest.json');
  const issueQueuePath = path.join(internalDir, 'issue_queue.json');
  const assetLibraryPath = path.join(internalDir, 'asset_library.json');
  const workspaceStatePath = path.join(internalDir, 'workspace_state.json');

  buildRunPlan({
    outputDir,
    outputFile: runPlanPath,
    taskSpecFile,
    promptsFile,
    batchPlanFile,
    validationReportFile,
    modeFile,
    manifestFile,
    intent: options.intent,
    materialBaseDir: options.materialBaseDir,
    materialsFile: options.materialsFile,
  });
  buildExecutionManifest({
    outputDir,
    outputFile: executionManifestPath,
    manifestFile,
    resultsFile: options.resultsFile,
  });
  buildIssueQueue({
    outputDir,
    outputFile: issueQueuePath,
    executionManifestFile: executionManifestPath,
  });
  buildAssetLibrary({
    outputDir,
    outputFile: assetLibraryPath,
    runPlanFile: runPlanPath,
    executionManifestFile: executionManifestPath,
  });
  buildWorkspaceState({
    outputDir,
    outputFile: workspaceStatePath,
    runPlanFile: runPlanPath,
    executionManifestFile: executionManifestPath,
    issueQueueFile: issueQueuePath,
    assetLibraryFile: assetLibraryPath,
  });
  buildViewModels({
    outputDir,
    workspaceStateFile: workspaceStatePath,
    runPlanFile: runPlanPath,
    issueQueueFile: issueQueuePath,
    assetLibraryFile: assetLibraryPath,
  });

  ['index', 'prepare', 'results', 'issues', 'record'].forEach((pageId) => {
    renderViewModelFile(
      path.join(outputDir, 'internal', 'view_models', `${pageId}.json`),
      path.join(outputDir, 'workspace', `${pageId}.html`)
    );
  });

  copyDebugFiles(outputDir);
  if (shouldPruneLegacy) {
    pruneLegacyFiles(outputDir);
  }
  writeReadme(outputDir);

  return {
    outputDir,
    workspaceIndex: path.join(outputDir, 'workspace', 'index.html'),
    prepare: path.join(outputDir, 'workspace', 'prepare.html'),
    results: path.join(outputDir, 'workspace', 'results.html'),
    issues: path.join(outputDir, 'workspace', 'issues.html'),
    record: path.join(outputDir, 'workspace', 'record.html'),
    internal: {
      runPlan: runPlanPath,
      executionManifest: executionManifestPath,
      issueQueue: issueQueuePath,
      assetLibrary: assetLibraryPath,
      workspaceState: workspaceStatePath,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = refreshWorkspaceV2({
    outputDir: args['output-dir'],
    manifestFile: args['manifest-file'],
    taskSpecFile: args['task-spec'],
    promptsFile: args['prompts-file'],
    batchPlanFile: args['batch-plan'],
    validationReportFile: args['validation-report'],
    modeFile: args['mode-file'],
    resultsFile: args['results-file'],
    intent: args.intent,
    materialBaseDir: args['material-base-dir'],
    materialsFile: args['materials-file'],
  });
  writeJson(path.join(summary.outputDir, 'internal', 'workspace_refresh_summary.json'), summary);
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { refreshWorkspaceV2, pruneLegacyFiles };
