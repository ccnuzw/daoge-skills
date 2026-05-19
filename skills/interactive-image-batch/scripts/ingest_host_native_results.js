const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, readJson, ensureDir, writeJson } = require('./script_utils');

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (Array.isArray(value.items)) return value.items;
  return [];
}

function normalizeStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['success', 'ok', 'done', 'completed'].includes(status)) return 'success';
  if (['needs_review', 'review', 'manual_review'].includes(status)) return 'needs_review';
  if (['failed', 'error', 'timeout'].includes(status)) return 'failed';
  return 'success';
}

function countBy(items, key) {
  const counts = {};
  items.forEach((item) => {
    const value = item[key];
    const label = value === undefined || value === null || value === '' ? 'missing' : String(value);
    counts[label] = (counts[label] || 0) + 1;
  });
  return Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

function writeMarkdown(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

function runNode(scriptName, args) {
  execFileSync(process.execPath, [path.join(__dirname, scriptName), ...args], {
    stdio: 'ignore',
  });
}

function normalizeResult(item, index) {
  const status = normalizeStatus(item.status);
  const absoluteOutput = item.output ? path.resolve(item.output) : null;
  return {
    ok: status !== 'failed',
    skipped: false,
    index: item.index ?? String(index + 1).padStart(3, '0'),
    slug: item.slug || null,
    title: item.title || item.slug || `host-native-${index + 1}`,
    output: absoluteOutput,
    slotId: item.slotId || item.slot_id || null,
    shotId: item.shotId || item.shot_id || null,
    shotLabel: item.shotLabel || item.shot_label || null,
    requestMode: item.requestMode || item.request_mode || 'prompt-only',
    textPolicy: item.textPolicy || item.text_policy || null,
    revisedPrompt: item.revisedPrompt || item.revised_prompt || null,
    scene: item.scene || null,
    composition: item.composition || null,
    styleFamily: item.styleFamily || item.style_family || null,
    slotRole: item.slotRole || item.slot_role || null,
    error: status === 'failed' ? (item.error || 'host-native execution failed') : null,
    hostNativeStatus: status,
    hostNativeSource: item.source || item.host_native_source || 'host-native',
  };
}

function createSelectionArtifacts(outputDir, manifest, allResults) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const needsReview = allResults.filter((item) => item.hostNativeStatus === 'needs_review');
  const rerunCandidates = failed.map((item) => ({
    index: item.index,
    slug: item.slug,
    title: item.title,
    slotId: item.slotId || null,
    shotId: item.shotId || null,
    requestMode: item.requestMode || null,
    error: item.error || null,
  }));

  const files = {
    successFile: path.join(outputDir, 'success.json'),
    failedFile: path.join(outputDir, 'failed.json'),
    skippedFile: path.join(outputDir, 'skipped.json'),
    needsReviewFile: path.join(outputDir, 'needs_review.json'),
    rerunCandidatesFile: path.join(outputDir, 'rerun_candidates.json'),
    selectionBoard: path.join(outputDir, 'selection_board.md'),
  };

  writeJson(files.successFile, successful);
  writeJson(files.failedFile, failed);
  writeJson(files.skippedFile, []);
  writeJson(files.needsReviewFile, needsReview);
  writeJson(files.rerunCandidatesFile, rerunCandidates);

  const lines = [
    '# Selection Board',
    '',
    `- Success: ${successful.length}`,
    `- Failed: ${failed.length}`,
    `- Needs review: ${needsReview.length}`,
    '',
    '## Host-native rerun note',
    '',
    failed.length
      ? '- 当前失败项来自宿主原生图像工具，建议回到宿主侧按同一 prompt 包只补失败项。'
      : '- 当前没有失败项。',
  ];

  writeMarkdown(files.selectionBoard, lines);
  return {
    ...files,
    successful,
    failed,
    needsReview,
    rerunCandidates,
  };
}

function createOperationsReport(outputDir, allResults) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    outputDir,
    manifest: path.join(outputDir, 'manifest.json'),
    counts: {
      success: successful.length,
      failed: failed.length,
      skipped: 0,
    },
    distributions: {
      requestMode: countBy(successful, 'requestMode').slice(0, 12),
      styleFamily: countBy(successful, 'styleFamily').slice(0, 12),
      slotRole: countBy(successful, 'slotRole').slice(0, 12),
    },
  };

  const reportPath = path.join(outputDir, 'operations_report.json');
  const reportMd = path.join(outputDir, 'operations_report.md');
  writeJson(reportPath, report);

  const lines = [
    '# Operations Report',
    '',
    `- Success: ${report.counts.success}`,
    `- Failed: ${report.counts.failed}`,
    `- Skipped: ${report.counts.skipped}`,
    '',
    '## Request modes',
    '',
    ...(report.distributions.requestMode.length ? report.distributions.requestMode.map((item) => `- ${item.name}: ${item.count}`) : ['- None']),
    '',
    '## Style families',
    '',
    ...(report.distributions.styleFamily.length ? report.distributions.styleFamily.map((item) => `- ${item.name}: ${item.count}`) : ['- None']),
    '',
    '## Slot roles',
    '',
    ...(report.distributions.slotRole.length ? report.distributions.slotRole.map((item) => `- ${item.name}: ${item.count}`) : ['- None']),
  ];
  writeMarkdown(reportMd, lines);
  return { reportPath, reportMd, report };
}

function buildManifest(outputDir, promptPack, results) {
  const promptCount = Number(promptPack.prompt_count || results.length || 0);
  const batchResults = results.map((item) => item);
  const success = batchResults.filter((item) => item.ok).length;
  const failed = batchResults.filter((item) => !item.ok).length;
  const size = promptPack?.task_summary?.width && promptPack?.task_summary?.height
    ? `${promptPack.task_summary.width}x${promptPack.task_summary.height}`
    : 'unknown';

  return {
    outputDir,
    generatedAt: new Date().toISOString(),
    promptSource: promptPack.prompts_file || path.join(outputDir, 'prompts.generated.json'),
    promptSourceOriginal: promptPack.prompts_file || path.join(outputDir, 'prompts.generated.json'),
    promptCount,
    selectedCount: results.length,
    success,
    failed,
    skipped: 0,
    batchCount: 1,
    batchSize: Number(promptPack?.task_summary?.batch_size || results.length || 1),
    stageCount: 1,
    sampleSize: 0,
    dryRun: false,
    paused: false,
    failedOnly: false,
    model: 'host-native-image-tool',
    defaultSize: size,
    runtimeMode: promptPack.runtime_mode || 'host-native-image-tool',
    recommendation: promptPack.recommendation || 'use-host-native-light-path',
    hostNative: true,
    batches: [
      {
        batchNumber: 1,
        success,
        failed,
        outputDir,
        results: batchResults,
      },
    ],
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const required = ['prompt-pack-file', 'results-file', 'output-dir'];
  for (const key of required) {
    if (!args[key]) throw new Error(`Missing required flag: --${key}`);
  }

  const promptPackFile = path.resolve(args['prompt-pack-file']);
  const resultsFile = path.resolve(args['results-file']);
  const outputDir = path.resolve(args['output-dir']);

  const promptPack = readJson(promptPackFile);
  runNode('validate_host_native_results.js', ['--results-file', resultsFile]);
  const rawResults = asArray(readJson(resultsFile));
  const normalizedResults = rawResults.map(normalizeResult);

  ensureDir(outputDir);

  const manifest = buildManifest(outputDir, promptPack, normalizedResults);
  const manifestPath = path.join(outputDir, 'manifest.json');
  writeJson(manifestPath, manifest);

  createSelectionArtifacts(outputDir, manifest, normalizedResults);
  createOperationsReport(outputDir, normalizedResults);

  runNode('render_completion_report.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'daoge_completion_report.md')]);
  runNode('render_completion_board.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'completion_board.html')]);
  runNode('render_run_overview.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'run_overview.html')]);
  runNode('render_review_board.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'review_board.html')]);
  runNode('render_rerun_board.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'rerun_board.html')]);
  runNode('render_result_hub.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'daoge_result_hub.md')]);
  runNode('render_result_hub_board.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'result_hub.html')]);
  runNode('render_portal_home.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'daoge_portal.html')]);

  const summary = {
    ok: true,
    outputDir,
    manifest: manifestPath,
    success: manifest.success,
    failed: manifest.failed,
    generated: {
      completion_report: path.join(outputDir, 'daoge_completion_report.md'),
      completion_board: path.join(outputDir, 'completion_board.html'),
      review_board: path.join(outputDir, 'review_board.html'),
      result_hub_markdown: path.join(outputDir, 'daoge_result_hub.md'),
      result_hub_html: path.join(outputDir, 'result_hub.html'),
      rerun_board: path.join(outputDir, 'rerun_board.html'),
      run_overview: path.join(outputDir, 'run_overview.html'),
      portal_home: path.join(outputDir, 'daoge_portal.html'),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
