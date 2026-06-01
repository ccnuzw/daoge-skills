const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { shellQuote, portableRunnerPreambleLines } = require('./run_batch_cli');
const { ensureWorkspaceChromeAssets } = require('./workspace_chrome_ui');
const { buildTaskCenterState } = require('./task_center_state_shared');
const {
  buildOptionalPageDecision,
  buildDefaultGenerationContract,
  resolveOptionalPageEmission,
  summarizeOptionalPageEmission,
} = require('./default_generation_contract');

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

function createSelectionArtifacts(outputDir, manifest, allResults, options = {}) {
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

  const resultWorkspacePath = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspacePath = path.join(outputDir, 'exception_workspace.html');
  const storyboardBoardPath = path.join(outputDir, 'storyboard_board.html');
  const lines = [
    '# DAOGE 结果挑选与补救说明',
    '',
    '这份说明只回答三件事：本轮结果稳不稳、要不要补救、下一步该回哪个工作台。',
    '',
    '## 1. 当前状态',
    '',
    `- 成功结果: ${successful.length}`,
    `- 失败结果: ${failed.length}`,
    `- 待人工再看: ${needsReview.length}`,
    `- 当前建议回到: ${failed.length || needsReview.length ? exceptionWorkspacePath : resultWorkspacePath}`,
    '',
    '## 2. 下一步建议',
    '',
  ];

  if (failed.length || needsReview.length) {
    lines.push(`- 先回异常工作台统一处理: ${exceptionWorkspacePath}`);
    if (failed.length) {
      lines.push('- 当前存在硬失败，建议先缩小范围，再决定是否补跑。');
    }
    if (needsReview.length) {
      lines.push('- 当前有待复核项，通常来自局部编辑或边界敏感结果。');
    }
  } else {
    lines.push(`- 当前没有明显补救压力，建议直接回结果工作台继续筛图: ${resultWorkspacePath}`);
    if (fs.existsSync(storyboardBoardPath)) {
      lines.push(`- 如果你想结合分镜上下文复看镜头关系，再按需打开分镜整板补充页: ${storyboardBoardPath}`);
    }
  }

  lines.push('');
  lines.push('## 3. 需要处理的结果');
  lines.push('');
  if (failed.length) {
    failed.slice(0, 8).forEach((item) => {
      lines.push(`- 失败: ${item.index} / ${item.title || item.slug || '未命名结果'}${item.error ? ` - ${item.error}` : ''}`);
    });
  }
  if (needsReview.length) {
    needsReview.slice(0, 8).forEach((item) => {
      lines.push(`- 待复核: ${item.index} / ${item.title || item.slug || '未命名结果'}`);
    });
  }
  if (!failed.length && !needsReview.length) {
    lines.push('- 当前没有失败项，也没有明显待复核项。');
  }

  if (failed.length) {
    lines.push('');
    lines.push('## 4. 维护者补跑命令');
    lines.push('');
    lines.push('如果你确实要只补跑失败项，可以使用下面这条命令：');
    lines.push('');
    lines.push('```bash');
    lines.push(...portableRunnerPreambleLines());
    lines.push('node "$DAOGE_RUNNER" \\');
    lines.push(`  --prompts-file ${shellQuote(path.join(outputDir, 'prompts.generated.json'))} \\`);
    lines.push(`  --resume-manifest ${shellQuote(path.join(outputDir, 'manifest.json'))} \\`);
    lines.push('  --failed-only true');
    lines.push('```');
  }

  if (options.generateDiagnosticMarkdown !== false) {
    fs.writeFileSync(files.selectionBoard, `${lines.join('\n')}\n`);
  }
  return {
    ...files,
    successful,
    failed,
    needsReview,
    rerunCandidates,
  };
}

function removeFileIfExists(filePath) {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function createEphemeralArchiveMarkdownPath(outputDir, enabled, fileName) {
  if (enabled) {
    return {
      tempDir: null,
      filePath: path.join(outputDir, fileName),
    };
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daoge-archive-markdown-'));
  return {
    tempDir,
    filePath: path.join(tempDir, fileName),
  };
}

function createOperationsReport(outputDir, manifest, allResults, options = {}) {
  const successful = allResults.filter((item) => item.ok && !item.skipped);
  const failed = allResults.filter((item) => !item.ok);
  const skipped = allResults.filter((item) => item.skipped).length;
  const report = {
    generatedAt: new Date().toISOString(),
    outputDir,
    manifest: path.join(outputDir, 'manifest.json'),
    counts: {
      success: successful.length,
      failed: failed.length,
      skipped,
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

  const successRate = successful.length + failed.length
    ? `${Math.round((successful.length / (successful.length + failed.length)) * 100)}%`
    : '0%';
  const lines = [
    '# DAOGE 运行复盘',
    '',
    '这份复盘用于帮助你快速判断：这一轮整体稳不稳、主要集中在哪类结果、下一步该怎么继续。',
    '',
    '## 1. 总体情况',
    '',
    `- 成功结果: ${report.counts.success}`,
    `- 失败结果: ${report.counts.failed}`,
    `- 跳过已有结果: ${report.counts.skipped}`,
    `- 本轮成功率: ${successRate}`,
    `- 当前是否暂停: ${manifest.paused ? '是' : '否'}`,
    `- 暂停原因: ${manifest.pauseReason || '无'}`,
    '',
    '## 2. 批次摘要',
    '',
    ...((manifest.batches || []).length
      ? (manifest.batches || []).map((batch) => `- 第 ${batch.batchNumber} 批: 成功 ${batch.success || 0}，失败 ${batch.failed || 0}`)
      : ['- 当前没有批次数据']),
    '',
    '## 3. 结果结构',
    '',
    '### 请求方式',
    '',
    ...(report.distributions.requestMode.length ? report.distributions.requestMode.map((item) => `- ${item.name}: ${item.count}`) : ['- 当前没有可展示的数据']),
    '',
    '### 风格分布',
    '',
    ...(report.distributions.styleFamily.length ? report.distributions.styleFamily.map((item) => `- ${item.name}: ${item.count}`) : ['- 当前没有可展示的数据']),
    '',
    '### 槽位角色',
    '',
    ...(report.distributions.slotRole.length ? report.distributions.slotRole.map((item) => `- ${item.name}: ${item.count}`) : ['- 当前没有可展示的数据']),
    '',
    '## 4. 下一步建议',
    '',
    ...(failed.length
      ? ['- 当前仍有失败项，建议先回异常工作台收口，再考虑继续扩图。']
      : ['- 当前没有失败项，可以回结果工作台继续筛图；分镜任务再按需打开分镜整板补充页看上下文。']),
    ...(skipped ? ['- 本轮存在跳过结果，继续下一轮前建议确认这些已有结果是否仍然适用。'] : ['- 当前没有跳过项，结果覆盖比较完整。']),
  ];

  if (options.generateDiagnosticMarkdown !== false) {
    fs.writeFileSync(reportMd, `${lines.join('\n')}\n`);
  }
  return { reportPath, reportMd, report };
}

function createContactSheetIndex(outputDir, manifest, options = {}) {
  if (options.generateArchiveMarkdown !== true) {
    removeFileIfExists(path.join(outputDir, 'contact_sheet_index.md'));
    return null;
  }
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
  return renderCompletionReportWithOptions(outputDir, {});
}

function renderCompletionReportWithOptions(outputDir, options = {}) {
  if (options.generateArchiveMarkdown !== true) {
    removeFileIfExists(path.join(outputDir, 'daoge_completion_report.md'));
    return null;
  }
  const scriptPath = path.join(__dirname, 'render_completion_report.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const reportPath = path.join(outputDir, 'daoge_completion_report.md');
  execFileSync(process.execPath, [scriptPath, '--manifest-file', manifestPath, '--output-file', reportPath], {
    stdio: 'ignore',
  });
  return reportPath;
}

function renderRunRecord(outputDir, options = {}) {
  const scriptPath = path.join(__dirname, 'render_run_record.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const archiveMarkdown = createEphemeralArchiveMarkdownPath(outputDir, options.generateArchiveMarkdown === true, 'run_record.md');
  const markdownPath = archiveMarkdown.filePath;
  const htmlPath = path.join(outputDir, 'run_record.html');
  execFileSync(process.execPath, [
    scriptPath,
    '--manifest-file', manifestPath,
    '--markdown-file', markdownPath,
    '--html-file', htmlPath,
  ], {
    stdio: 'ignore',
  });
  if (options.generateArchiveMarkdown !== true) {
    removeFileIfExists(path.join(outputDir, 'run_record.md'));
  }
  if (archiveMarkdown.tempDir) {
    fs.rmSync(archiveMarkdown.tempDir, { recursive: true, force: true });
  }
  return { markdownPath: options.generateArchiveMarkdown === true ? markdownPath : null, htmlPath };
}

function renderTaskCenter(outputDir) {
  const scriptPath = path.join(__dirname, 'render_task_center.js');
  const rootDir = path.dirname(outputDir);
  const indexPath = path.join(rootDir, 'daoge_run_index.json');
  const htmlPath = path.join(rootDir, 'task_center.html');
  if (!fs.existsSync(indexPath)) return null;
  execFileSync(process.execPath, [
    scriptPath,
    '--index-file', indexPath,
    '--output-file', htmlPath,
  ], {
    stdio: 'ignore',
  });
  return htmlPath;
}

function renderWorkspaceHome(outputDir) {
  const scriptPath = path.join(__dirname, 'render_workspace_home.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const workspacePath = path.join(outputDir, 'workspace_home.html');
  execFileSync(process.execPath, [scriptPath, '--manifest-file', manifestPath, '--output-file', workspacePath], {
    stdio: 'ignore',
  });
  return workspacePath;
}

function renderPrepareWorkspace(outputDir) {
  const scriptPath = path.join(__dirname, 'render_prepare_workspace.js');
  const workspacePath = path.join(outputDir, 'prepare_workspace.html');
  execFileSync(process.execPath, [scriptPath, '--output-dir', outputDir, '--output-file', workspacePath], {
    stdio: 'ignore',
  });
  return workspacePath;
}

function renderResultWorkspace(outputDir) {
  const scriptPath = path.join(__dirname, 'render_result_workspace.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const workspacePath = path.join(outputDir, 'result_workspace.html');
  execFileSync(process.execPath, [scriptPath, '--manifest-file', manifestPath, '--output-file', workspacePath], {
    stdio: 'ignore',
  });
  return workspacePath;
}

function renderExceptionWorkspace(outputDir) {
  const scriptPath = path.join(__dirname, 'render_exception_workspace.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const workspacePath = path.join(outputDir, 'exception_workspace.html');
  execFileSync(process.execPath, [scriptPath, '--manifest-file', manifestPath, '--output-file', workspacePath], {
    stdio: 'ignore',
  });
  return workspacePath;
}

function renderStoryboardBoard(outputDir) {
  const storyboardFile = path.join(outputDir, 'storyboard_bundle.validation.json');
  const resultsFile = path.join(outputDir, 'success.json');
  if (!fs.existsSync(storyboardFile) || !fs.existsSync(resultsFile)) return null;

  const scriptPath = path.join(__dirname, 'render_storyboard_board.js');
  const boardPath = path.join(outputDir, 'storyboard_board.html');
  execFileSync(process.execPath, [
    scriptPath,
    '--storyboard-file', storyboardFile,
    '--results-file', resultsFile,
    '--output-dir', outputDir,
    '--output-file', boardPath,
  ], {
    stdio: 'ignore',
  });
  return boardPath;
}

function renderWorkspaceState(outputDir) {
  const scriptPath = path.join(__dirname, 'build_workspace_state.js');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const workspaceStatePath = path.join(outputDir, 'workspace_state.json');
  const workspaceAssetsPath = path.join(outputDir, 'workspace_assets.json');
  const workspaceTimelinePath = path.join(outputDir, 'workspace_timeline.json');
  const workbenchStatePath = path.join(outputDir, 'workbench_state.json');
  execFileSync(process.execPath, [
    scriptPath,
    '--manifest-file', manifestPath,
    '--output-dir', outputDir,
    '--workspace-state-file', workspaceStatePath,
    '--workspace-assets-file', workspaceAssetsPath,
    '--workspace-timeline-file', workspaceTimelinePath,
    '--workbench-state-file', workbenchStatePath,
  ], {
    stdio: 'ignore',
  });
  return {
    workspaceStatePath,
    workspaceAssetsPath,
    workspaceTimelinePath,
    workbenchStatePath,
  };
}

function renderVisualReviewAnalysis(outputDir, manifest, options = {}) {
  if (!options.enable) return null;
  const successFile = path.join(outputDir, 'success.json');
  if (!fs.existsSync(successFile)) return null;
  const scriptPath = path.join(__dirname, 'analyze_review_results.js');
  const outputFile = path.join(outputDir, 'review_analysis.json');
  const args = [
    scriptPath,
    '--success-file', successFile,
    '--output-file', outputFile,
    '--output-dir', outputDir,
  ];
  if (options.envFile) args.push('--env-file', options.envFile);
  if (options.responsesModel) args.push('--responses-model', options.responsesModel);
  if (options.visionTimeoutMs) args.push('--vision-timeout-ms', String(options.visionTimeoutMs));
  if (options.maxItems) args.push('--max-items', String(options.maxItems));
  execFileSync(process.execPath, args, {
    stdio: 'ignore',
  });
  return outputFile;
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
  const taskCenterStatePath = path.join(rootDir, 'task_center_state.json');
  const taskCenterState = buildTaskCenterState(indexPath);
  helpers.writeJson(taskCenterStatePath, taskCenterState);
  const indexMd = path.join(rootDir, 'daoge_run_index.md');
  execFileSync(process.execPath, [
    path.join(__dirname, 'render_run_index.js'),
    '--index-file', indexPath,
    '--markdown-file', indexMd,
  ], {
    stdio: 'ignore',
  });
  return { indexPath, indexMd, taskCenterStatePath };
}

function createOperationalArtifacts(outputDir, manifest, allResults, helpers, options = {}) {
  ensureWorkspaceChromeAssets(outputDir);
  const generateDiagnosticMarkdown = options.generateDiagnosticMarkdown === true;
  const generateArchiveMarkdown = options.generateArchiveMarkdown === true;
  const selection = createSelectionArtifacts(outputDir, manifest, allResults, { generateDiagnosticMarkdown });
  const operations = createOperationsReport(outputDir, manifest, allResults, { generateDiagnosticMarkdown });
  const contactSheetIndex = createContactSheetIndex(outputDir, manifest, { generateArchiveMarkdown });
  if (!generateDiagnosticMarkdown) {
    removeFileIfExists(selection.selectionBoard);
    removeFileIfExists(operations.reportMd);
  }
  const runIndex = updateRunIndex(outputDir, manifest, allResults, { selection, operations, contactSheetIndex }, helpers);
  const taskCenter = renderTaskCenter(outputDir);
  return { selection, operations, contactSheetIndex, runIndex, taskCenter };
}

module.exports = {
  renderCompletionReport: renderCompletionReportWithOptions,
  renderRunRecord,
  renderTaskCenter,
  renderWorkspaceHome,
  renderPrepareWorkspace,
  renderResultWorkspace,
  renderExceptionWorkspace,
  renderStoryboardBoard,
  renderWorkspaceState,
  renderVisualReviewAnalysis,
  createOperationalArtifacts,
  removeFileIfExists,
  resolveOptionalPageEmission,
  summarizeOptionalPageEmission,
  buildDefaultGenerationContract,
  buildOptionalPageDecision,
};
