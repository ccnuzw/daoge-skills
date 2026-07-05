const path = require('path');
const {
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  ensureV2Layout,
  summarizeCounts,
} = require('./workspace_v2_shared');
const {
  buildDecision,
  buildUserJourneyDecision,
  decidePrimaryAction,
  decideStage,
} = require('./build_user_journey_decision');

const decideAction = decidePrimaryAction;

function buildWorkspaceState(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const runPlan = readJsonIfExists(options.runPlanFile || path.join(outputDir, 'internal', 'run_plan.json')) || {};
  const executionManifest = readJsonIfExists(options.executionManifestFile || path.join(outputDir, 'internal', 'execution_manifest.json')) || {};
  const issueQueue = readJsonIfExists(options.issueQueueFile || path.join(outputDir, 'internal', 'issue_queue.json')) || {};
  const assetLibrary = readJsonIfExists(options.assetLibraryFile || path.join(outputDir, 'internal', 'asset_library.json')) || {};
  const task = runPlan.task || {
    id: 'portrait',
    title: '生图任务',
    summary: '生成一组可筛选的视觉结果',
  };
  const journey = buildUserJourneyDecision(runPlan, executionManifest, issueQueue, assetLibrary);
  const counts = summarizeCounts(executionManifest, issueQueue, assetLibrary);

  const workspaceState = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    task: {
      id: normalizeText(task.id, 'portrait'),
      title: normalizeText(task.title || task.name, '生图任务'),
      summary: normalizeText(task.summary || task.plainSummary, '生成一组可筛选的视觉结果'),
    },
    stage: journey.stage,
    primaryAction: journey.primaryAction,
    secondaryActions: journey.secondaryActions,
    replySuggestions: journey.replySuggestions,
    decision: journey.decision,
    nextBestStep: journey.nextBestStep,
    counts,
    assetSummary: {
      readyResults: counts.success,
      needsReview: counts.needsReview,
      issueAssets: counts.failed,
      selected: toArray(assetLibrary.groups?.find?.((item) => item.id === 'selected')?.assetIds).length,
      exportsPath: 'assets/exports',
    },
    issueSummary: issueQueue.summary || {
      blocking: 0,
      attention: 0,
      rerunCandidates: 0,
      ignored: 0,
      resolved: 0,
    },
    paths: {
      workspace: 'workspace/index.html',
      assets: 'assets',
      selected: 'assets/selected',
      exports: 'assets/exports',
    },
  };

  const outputFile = options.outputFile || path.join(outputDir, 'internal', 'workspace_state.json');
  writeJson(outputFile, workspaceState);
  return workspaceState;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args['output-dir'] || process.cwd();
  const workspaceState = buildWorkspaceState({
    outputDir,
    outputFile: args['output-file'],
    runPlanFile: args['run-plan'],
    executionManifestFile: args['execution-manifest'],
    issueQueueFile: args['issue-queue'],
    assetLibraryFile: args['asset-library'],
  });
  console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir), stage: workspaceState.stage.id }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { buildWorkspaceState, decideStage, decideAction, buildDecision };
