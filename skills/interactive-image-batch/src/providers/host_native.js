const path = require('path');
const {
  ensureV2Layout,
  readJson,
  writeJson,
  toArray,
  normalizeText,
} = require('../shared/workspace');
const { refreshWorkspace } = require('../domain/workspace_service');
const { resolveOutputPathFromFile } = require('../domain/material_resolver');

function normalizeHostResult(item = {}, index = 0, resultsFile = null) {
  const statusText = normalizeText(item.status || item.hostNativeStatus, 'success').toLowerCase();
  const failed = ['failed', 'error', 'timeout'].includes(statusText);
  const needsReview = ['needs_review', 'review', 'manual_review'].includes(statusText);
  const output = resultsFile ? resolveOutputPathFromFile(item.output, resultsFile) : (item.output ? path.resolve(item.output) : null);
  return {
    ok: !failed,
    index: item.index ?? index + 1,
    title: item.title || item.slug || `宿主结果 ${index + 1}`,
    output,
    requestMode: item.requestMode || item.request_mode || 'prompt-only',
    hostNativeStatus: needsReview ? 'needs_review' : (failed ? 'failed' : 'success'),
    error: failed ? (item.error || '宿主侧生成失败') : null,
    shotLabel: item.shotLabel || item.shot_label || null,
    slotId: item.slotId || item.slot_id || null,
    scene: item.scene || null,
  };
}

function ingestHostNativeResults(options = {}) {
  if (!options.resultsFile) throw new Error('缺少 --results-file');
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const promptPack = options.promptPackFile ? readJson(options.promptPackFile) : {};
  const resultsFile = path.resolve(options.resultsFile);
  const results = toArray(readJson(resultsFile)).map((item, index) => normalizeHostResult(item, index, resultsFile));
  const manifest = {
    runtimeMode: 'host-native-image-tool',
    dryRun: false,
    model: 'host-native',
    generatedAt: new Date().toISOString(),
    selectedCount: Number(promptPack.prompt_count || results.length),
    batchSize: Number(promptPack.task_summary?.batch_size || results.length || 1),
    batchCount: 1,
    defaultSize: promptPack.task_summary?.width && promptPack.task_summary?.height
      ? `${promptPack.task_summary.width}x${promptPack.task_summary.height}`
      : null,
    success: results.filter((item) => item.hostNativeStatus === 'success').length,
    failed: results.filter((item) => item.hostNativeStatus === 'failed').length,
    skipped: 0,
    batches: [{
      batchNumber: 1,
      totalBatches: 1,
      success: results.filter((item) => item.hostNativeStatus === 'success').length,
      failed: results.filter((item) => item.hostNativeStatus === 'failed').length,
      skipped: 0,
      results,
    }],
  };
  const manifestPath = path.join(outputDir, 'internal', 'host_native_execution.json');
  const taskSpecPath = path.join(outputDir, 'debug', 'host_native_task_spec.json');
  writeJson(manifestPath, manifest);
  writeJson(taskSpecPath, {
    content_brief: promptPack.task_summary?.content_brief || promptPack.task_summary?.summary || '宿主侧生图任务',
    total_count: manifest.selectedCount,
    batch_size: manifest.batchSize,
    width: promptPack.task_summary?.width || null,
    height: promptPack.task_summary?.height || null,
  });

  const workspace = refreshWorkspace({
    outputDir,
    taskSpecFile: taskSpecPath,
    manifestFile: manifestPath,
  });
  return {
    outputDir,
    workspaceIndex: workspace.workspaceIndex,
    success: manifest.success,
    failed: manifest.failed,
  };
}

module.exports = {
  normalizeHostResult,
  ingestHostNativeResults,
};
