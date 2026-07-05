const fs = require('fs');
const path = require('path');
const { writeRuntimeStateSnapshot } = require('./runtime_state_snapshot');
const { resolveUnifiedWorkbenchStatePath } = require('./workbench_state_shared');
const { refreshWorkspaceV2 } = require('./refresh_workspace_v2');
const { readJsonIfExists, writeJson } = require('./script_utils');

const RETIRED_WORKSPACE_HTML = [
  'workspace_home.html',
  'prepare_workspace.html',
  'result_workspace.html',
  'exception_workspace.html',
  'run_record.html',
];

function removeRetiredWorkspaceHtml(outputDir) {
  RETIRED_WORKSPACE_HTML.forEach((fileName) => {
    [
      path.join(outputDir, fileName),
      path.join(outputDir, 'workspace', fileName),
    ].forEach((filePath) => {
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    });
  });
}

function refreshRuntimeWorkbench(outputDir) {
  const absoluteOutputDir = path.resolve(outputDir);
  const unifiedWorkbenchStatePath = resolveUnifiedWorkbenchStatePath(absoluteOutputDir);
  const runtimeState = writeRuntimeStateSnapshot(absoluteOutputDir);
  const refreshed = refreshWorkspaceV2({
    outputDir: absoluteOutputDir,
    pruneLegacy: false,
  });
  removeRetiredWorkspaceHtml(absoluteOutputDir);
  const workspaceStatePath = refreshed.internal.workspaceState;
  const assetLibraryPath = refreshed.internal.assetLibrary;
  const runtimeSnapshot = runtimeState?.snapshot || null;
  writeJson(unifiedWorkbenchStatePath, {
    schemaVersion: 2,
    kind: 'daoge-workbench-state',
    role: 'live-workbench-state',
    generatedAt: new Date().toISOString(),
    outputDir: absoluteOutputDir,
    outputFile: unifiedWorkbenchStatePath,
    stateSources: {
      runtimeState: runtimeState?.outputFile || path.join(absoluteOutputDir, 'runtime_state.json'),
      workspaceState: workspaceStatePath,
      assetLibrary: assetLibraryPath,
      issueQueue: refreshed.internal.issueQueue,
      runPlan: refreshed.internal.runPlan,
      executionManifest: refreshed.internal.executionManifest,
    },
    runtimeState: runtimeSnapshot,
    workspaceState: readJsonIfExists(workspaceStatePath),
    paths: {
      workspaceIndex: refreshed.workspaceIndex,
      workspacePrepare: refreshed.prepare,
      workspaceResults: refreshed.results,
      workspaceIssues: refreshed.issues,
      workspaceRecord: refreshed.record,
      assets: path.join(absoluteOutputDir, 'assets'),
    },
  });

  return {
    runtimeStatePath: runtimeState?.outputFile || null,
    unifiedWorkbenchStatePath,
    workspaceStatePath,
    workspaceAssetsPath: assetLibraryPath,
    workspaceTimelinePath: workspaceStatePath,
    workbenchStatePath: unifiedWorkbenchStatePath,
    workspaceIndexPath: refreshed.workspaceIndex,
    workspacePreparePath: refreshed.prepare,
    workspaceResultsPath: refreshed.results,
    workspaceIssuesPath: refreshed.issues,
    workspaceRecordPath: refreshed.record,
    workspaceHomePath: refreshed.workspaceIndex,
    prepareWorkspacePath: refreshed.prepare,
    resultWorkspacePath: refreshed.results,
    exceptionWorkspacePath: refreshed.issues,
  };
}

module.exports = {
  refreshRuntimeWorkbench,
  removeRetiredWorkspaceHtml,
};
