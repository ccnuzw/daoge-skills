const path = require('path');
const { execFileSync } = require('child_process');
const { writeRuntimeStateSnapshot } = require('./runtime_state_snapshot');
const { resolveUnifiedWorkbenchStatePath } = require('./workbench_state_shared');

function refreshRuntimeWorkbench(outputDir) {
  const absoluteOutputDir = path.resolve(outputDir);
  const manifestPath = path.join(absoluteOutputDir, 'manifest.json');
  const workspaceStatePath = path.join(absoluteOutputDir, 'workspace_state.json');
  const workspaceAssetsPath = path.join(absoluteOutputDir, 'workspace_assets.json');
  const workspaceTimelinePath = path.join(absoluteOutputDir, 'workspace_timeline.json');
  const workbenchStatePath = path.join(absoluteOutputDir, 'workbench_state.json');
  const unifiedWorkbenchStatePath = resolveUnifiedWorkbenchStatePath(absoluteOutputDir);
  const workspaceHomePath = path.join(absoluteOutputDir, 'workspace_home.html');
  const prepareWorkspacePath = path.join(absoluteOutputDir, 'prepare_workspace.html');
  const resultWorkspacePath = path.join(absoluteOutputDir, 'result_workspace.html');
  const exceptionWorkspacePath = path.join(absoluteOutputDir, 'exception_workspace.html');
  const runtimeState = writeRuntimeStateSnapshot(absoluteOutputDir);

  execFileSync(process.execPath, [
    path.join(__dirname, 'build_workspace_state.js'),
    '--manifest-file', manifestPath,
    '--output-dir', absoluteOutputDir,
    '--workspace-state-file', workspaceStatePath,
    '--workspace-assets-file', workspaceAssetsPath,
    '--workspace-timeline-file', workspaceTimelinePath,
    '--workbench-state-file', workbenchStatePath,
    '--unified-workbench-state-file', unifiedWorkbenchStatePath,
  ], {
    stdio: 'ignore',
  });

  execFileSync(process.execPath, [
    path.join(__dirname, 'render_workspace_home.js'),
    '--manifest-file', manifestPath,
    '--output-file', workspaceHomePath,
  ], {
    stdio: 'ignore',
  });
  execFileSync(process.execPath, [
    path.join(__dirname, 'render_prepare_workspace.js'),
    '--manifest-file', manifestPath,
    '--output-file', prepareWorkspacePath,
  ], {
    stdio: 'ignore',
  });
  execFileSync(process.execPath, [
    path.join(__dirname, 'render_result_workspace.js'),
    '--manifest-file', manifestPath,
    '--output-file', resultWorkspacePath,
  ], {
    stdio: 'ignore',
  });
  execFileSync(process.execPath, [
    path.join(__dirname, 'render_exception_workspace.js'),
    '--manifest-file', manifestPath,
    '--output-file', exceptionWorkspacePath,
  ], {
    stdio: 'ignore',
  });

  return {
    runtimeStatePath: runtimeState?.outputFile || null,
    workspaceStatePath,
    workspaceAssetsPath,
    workspaceTimelinePath,
    workbenchStatePath,
    unifiedWorkbenchStatePath,
    workspaceHomePath,
    prepareWorkspacePath,
    resultWorkspacePath,
    exceptionWorkspacePath,
  };
}

module.exports = {
  refreshRuntimeWorkbench,
};
