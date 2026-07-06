const path = require('path');
const {
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  ensureV2Layout,
  normalizeResultStatus,
  flattenManifestResults,
  relativeToOutput,
} = require('../shared/workspace');

function resolveSourceOutput(outputDir, output) {
  if (!output) return null;
  const text = String(output).trim();
  if (!text) return null;
  return path.isAbsolute(text) ? text : path.resolve(outputDir, text);
}

function normalizeExecutionResult(item = {}, index = 0, outputDir) {
  const status = normalizeResultStatus(item);
  const sourceOutput = resolveSourceOutput(outputDir, item.output);
  const numeric = Number.parseInt(String(item.index || index + 1).replace(/\D/g, ''), 10);
  const ordinal = Number.isFinite(numeric) && numeric > 0 ? numeric : index + 1;
  const shotLabel = normalizeText(item.shotLabel || item.shot_label || item.shotTitle || item.scene);
  const userLabel = shotLabel || (item.shotId || item.shot_id || item.slotId || item.slot_id
    ? `第 ${ordinal} 格 / 镜头 ${ordinal}`
    : '');
  return {
    id: `result_${String(index + 1).padStart(3, '0')}`,
    index: item.index || ordinal,
    title: normalizeText(item.title || item.slug, `结果 ${String(index + 1).padStart(3, '0')}`),
    status,
    output: sourceOutput ? relativeToOutput(outputDir, sourceOutput) : null,
    sourceOutput,
    batchNumber: item.batchNumber || null,
    shotLabel,
    userLabel,
    requestKind: normalizeText(item.requestMode || item.request_mode, 'prompt-only'),
    error: status === 'failed' ? normalizeText(item.error, '生成失败') : null,
    worthRerun: Boolean(item.worthRerun || item.worth_rerun || item.critical || item.required),
    rerunnable: item.rerunnable === undefined ? null : Boolean(item.rerunnable),
    reason: normalizeText(item.reason || item.failureReason || item.failure_reason),
    rerunReason: normalizeText(item.rerunReason || item.rerun_reason),
    retryCount: Number(item.retryCount || item.retry_count || 0),
    durationMs: Number(item.durationMs || item.duration_ms || 0) || null,
  };
}

function buildExecutionManifest(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const manifest = readJsonIfExists(options.manifestFile || path.join(outputDir, 'manifest.json')) || {};
  const explicitResults = toArray(readJsonIfExists(options.resultsFile));
  const sourceResults = explicitResults.length ? explicitResults : flattenManifestResults(manifest);
  const countsFromResults = { success: 0, failed: 0, needsReview: 0, skipped: 0 };
  const results = sourceResults.map((item, index) => {
    const result = normalizeExecutionResult(item, index, outputDir);
    if (result.status === 'success') countsFromResults.success += 1;
    else if (result.status === 'failed') countsFromResults.failed += 1;
    else if (result.status === 'needs_review') countsFromResults.needsReview += 1;
    else if (result.status === 'skipped') countsFromResults.skipped += 1;
    return result;
  });
  const isPrepareOnly = normalizeText(manifest.runtimeMode).toLowerCase() === 'prepare-only';
  const hasResultRows = results.length > 0;
  const counts = {
    total: isPrepareOnly ? 0 : (results.length || Number(manifest.selectedCount || 0)),
    success: hasResultRows ? countsFromResults.success : Number(manifest.success || 0),
    failed: hasResultRows ? countsFromResults.failed : Number(manifest.failed || 0),
    needsReview: hasResultRows ? countsFromResults.needsReview : Number(manifest.needsReview || 0),
    skipped: hasResultRows ? countsFromResults.skipped : Number(manifest.skipped || 0),
  };

  const executionManifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    phase: 'execute',
    outputDir,
    execution: {
      mode: normalizeText(manifest.runtimeMode, 'local-batch-runner'),
      provider: normalizeText(manifest.model, 'unknown'),
      paused: Boolean(manifest.paused),
      pauseReason: manifest.pauseReason || null,
      dryRun: Boolean(manifest.dryRun),
    },
    counts,
    batches: toArray(manifest.batches).map((batch) => ({
      batchNumber: batch.batchNumber || null,
      success: Number(batch.success || 0),
      failed: Number(batch.failed || 0),
      skipped: Number(batch.skipped || 0),
    })),
    results,
  };

  const outputFile = options.outputFile || path.join(outputDir, 'internal', 'execution_manifest.json');
  writeJson(outputFile, executionManifest);
  return executionManifest;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args['output-dir'] || process.cwd();
  const executionManifest = buildExecutionManifest({
    outputDir,
    outputFile: args['output-file'],
    manifestFile: args['manifest-file'],
    resultsFile: args['results-file'],
  });
  console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir), total: executionManifest.counts.total }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { buildExecutionManifest, normalizeExecutionResult, resolveSourceOutput };
