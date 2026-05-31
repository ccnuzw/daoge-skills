const path = require('path');
const { execFileSync } = require('child_process');
const { writeJson } = require('./script_utils');
const {
  buildTaskCenterState,
  resolveTaskCenterStatePath,
  resolveUnifiedTaskCenterStatePath,
} = require('./task_center_state_shared');
const { buildRuntimeStateSnapshot, writeRuntimeStateSnapshot } = require('./runtime_state_snapshot');

function refreshTaskCenterRuntimeState(outputDir, options = {}) {
  const absoluteOutputDir = path.resolve(outputDir);
  const rootDir = path.dirname(absoluteOutputDir);
  const indexPath = path.join(rootDir, 'daoge_run_index.json');
  const statePath = resolveTaskCenterStatePath(indexPath, {
    stateFile: options.stateFile || null,
  });
  const unifiedStatePath = resolveUnifiedTaskCenterStatePath(indexPath, {
    unifiedStateFile: options.unifiedStateFile || null,
  });
  const liveRun = buildRuntimeStateSnapshot(absoluteOutputDir, options);
  const runtimeState = writeRuntimeStateSnapshot(absoluteOutputDir, options);
  const taskCenterState = buildTaskCenterState(indexPath, {
    examplesCatalogPath: options.examplesCatalogPath,
    liveRun,
  });
  writeJson(statePath, taskCenterState);
  writeJson(unifiedStatePath, taskCenterState);

  if (options.renderOutputs !== false) {
    execFileSync(process.execPath, [
      path.join(__dirname, 'render_run_index.js'),
      '--index-file', indexPath,
      '--markdown-file', path.join(rootDir, 'daoge_run_index.md'),
      '--state-file', statePath,
    ], {
      stdio: 'ignore',
    });
    execFileSync(process.execPath, [
      path.join(__dirname, 'render_task_center.js'),
      '--index-file', indexPath,
      '--output-file', path.join(rootDir, 'task_center.html'),
      '--state-file', statePath,
    ], {
      stdio: 'ignore',
    });
  }

  return {
    indexPath,
    statePath,
    unifiedStatePath,
    runtimeStatePath: runtimeState?.outputFile || null,
    liveRun,
    taskCenterState,
  };
}

module.exports = {
  buildLiveRunState: buildRuntimeStateSnapshot,
  refreshTaskCenterRuntimeState,
};
