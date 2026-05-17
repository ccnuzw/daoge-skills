const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { shellQuote, portableRunnerPreambleLines } = require('./run_batch_cli');

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

function createSelectionArtifacts(outputDir, manifest, allResults) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const needsReview = successful.filter((item) => item.requestMode === 'masked-edit' || item.editSource === 'previous-output');
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

  fs.writeFileSync(files.successFile, JSON.stringify(successful, null, 2));
  fs.writeFileSync(files.failedFile, JSON.stringify(failed, null, 2));
  fs.writeFileSync(files.skippedFile, JSON.stringify(allResults.filter((item) => item.skipped), null, 2));
  fs.writeFileSync(files.needsReviewFile, JSON.stringify(needsReview, null, 2));
  fs.writeFileSync(files.rerunCandidatesFile, JSON.stringify(rerunCandidates, null, 2));

  const lines = [
    '# Selection Board',
    '',
    `- Success: ${successful.length}`,
    `- Failed: ${failed.length}`,
    `- Needs review: ${needsReview.length}`,
    '',
    '## Failed rerun',
    '',
  ];

  if (failed.length) {
    lines.push('```bash');
    lines.push(...portableRunnerPreambleLines());
    lines.push('node "$DAOGE_RUNNER" \\');
    lines.push(`  --prompts-file ${shellQuote(path.join(outputDir, 'prompts.generated.json'))} \\`);
    lines.push(`  --resume-manifest ${shellQuote(path.join(outputDir, 'manifest.json'))} \\`);
    lines.push('  --failed-only true');
    lines.push('```');
  } else {
    lines.push('- No failed items.');
  }

  fs.writeFileSync(files.selectionBoard, `${lines.join('\n')}\n`);
  return {
    ...files,
    successful,
    failed,
    needsReview,
    rerunCandidates,
  };
}

function createOperationsReport(outputDir, manifest, allResults) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    outputDir,
    manifest: path.join(outputDir, 'manifest.json'),
    counts: {
      success: successful.length,
      failed: failed.length,
      skipped: allResults.filter((item) => item.skipped).length,
    },
    distributions: {
      requestMode: countBy(successful, 'requestMode').slice(0, 12),
      styleFamily: countBy(successful, 'styleFamily').slice(0, 12),
      slotRole: countBy(successful, 'slotRole').slice(0, 12),
    },
  };

  const reportPath = path.join(outputDir, 'operations_report.json');
  const reportMd = path.join(outputDir, 'operations_report.md');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

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

  fs.writeFileSync(reportMd, `${lines.join('\n')}\n`);
  return { reportPath, reportMd, report };
}

function createContactSheetIndex(outputDir, manifest) {
  const lines = [
    '# Contact Sheet Index',
    '',
    '## Batch Outputs',
    '',
    ...(manifest.batches || []).map((batch) => `- Batch ${batch.batchNumber}: ${batch.outputDir || 'unknown'} (${batch.success || 0} success, ${batch.failed || 0} failed)`),
  ];
  const outputPath = path.join(outputDir, 'contact_sheet_index.md');
  fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
  return outputPath;
}

function renderCompletionReport(outputDir) {
  const scriptPath = path.join(__dirname, 'render_completion_report.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const reportPath = path.join(outputDir, 'daoge_completion_report.md');
  execFileSync(process.execPath, [scriptPath, '--manifest-file', manifestPath, '--output-file', reportPath], {
    stdio: 'ignore',
  });
  return reportPath;
}

function renderResultHub(outputDir) {
  const scriptPath = path.join(__dirname, 'render_result_hub.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const hubPath = path.join(outputDir, 'daoge_result_hub.md');
  execFileSync(process.execPath, [scriptPath, '--manifest-file', manifestPath, '--output-file', hubPath], {
    stdio: 'ignore',
  });
  return hubPath;
}

function updateRunIndex(outputDir, manifest, allResults, artifacts, helpers) {
  const rootDir = path.dirname(outputDir);
  const indexPath = path.join(rootDir, 'daoge_run_index.json');
  let index = [];
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = helpers.readJson(indexPath);
      index = Array.isArray(parsed) ? parsed : [];
    } catch {
      index = [];
    }
  }
  const entry = {
    outputDir,
    manifest: path.join(outputDir, 'manifest.json'),
    generatedAt: manifest.generatedAt,
    promptSource: manifest.promptSource,
    selectedCount: manifest.selectedCount,
    success: manifest.success,
    failed: manifest.failed,
    skipped: allResults.filter((item) => item.skipped).length,
    batchCount: manifest.batchCount,
    batchSize: manifest.batchSize,
    model: manifest.model,
    defaultSize: manifest.defaultSize,
    resumeManifest: manifest.resumeManifest,
    artifacts,
  };
  index = index.filter((item) => item.outputDir !== outputDir);
  index.push(entry);
  helpers.writeJson(indexPath, index);
  const indexMd = path.join(rootDir, 'daoge_run_index.md');
  const lines = [
    '# DAOGE Run Index',
    '',
    ...index.slice(-100).reverse().map((item) => `- ${item.generatedAt || 'unknown'} | success ${item.success}/${item.selectedCount} | failed ${item.failed} | skipped ${item.skipped || 0} | ${item.outputDir}`),
  ];
  fs.writeFileSync(indexMd, `${lines.join('\n')}\n`);
  return { indexPath, indexMd };
}

function createOperationalArtifacts(outputDir, manifest, allResults, helpers) {
  const selection = createSelectionArtifacts(outputDir, manifest, allResults);
  const operations = createOperationsReport(outputDir, manifest, allResults);
  const contactSheetIndex = createContactSheetIndex(outputDir, manifest);
  const runIndex = updateRunIndex(outputDir, manifest, allResults, { selection, operations, contactSheetIndex }, helpers);
  return { selection, operations, contactSheetIndex, runIndex };
}

module.exports = {
  renderCompletionReport,
  renderResultHub,
  createOperationalArtifacts,
};
