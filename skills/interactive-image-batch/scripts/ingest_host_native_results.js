const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs, readJson, readJsonIfExists, ensureDir, writeJson } = require('./script_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const { summarizeUserWorkbenchProtocol } = require('./workspace_page_shared');
const { resolveOptionalPageEmission, buildOptionalPageDecision, pruneHiddenHtmlFiles } = require('./default_generation_contract');

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

function writeReadme(outputDir, summary) {
  const workspaceState = loadWorkbenchState(outputDir).workspaceState || {};
  const artifactGovernance = workspaceState?.artifactGovernance || {};
  const governanceSummary = artifactGovernance.summary || {};
  const directoryProtocol = workspaceState?.assetLayers?.directoryProtocol || {};
  const directorySurfaces = directoryProtocol?.surfaces || {};
  const workspaceSupport = Array.isArray(artifactGovernance.workspaceSupport) ? artifactGovernance.workspaceSupport.filter((item) => item.exists) : [];
  const directorySummary = String(directoryProtocol.summary || '').trim()
    || '输出目录默认只保留主链工作台给用户直看，其它文件按文件落盘、归档或内部状态层后退。';
  const filesystemCount = Number(directorySurfaces?.filesystem?.count || 0);
  const archiveCount = Number(directorySurfaces?.archive?.count || 0);
  const internalCount = Number(directorySurfaces?.internal?.count || 0);
  const workbenchProtocol = {
    ...summarizeUserWorkbenchProtocol(workspaceState?.assetLayers?.userWorkbenchProtocol, { outputDir }),
    summary: String(workspaceState?.assetLayers?.userWorkbenchProtocol?.summary || '').trim()
      || directorySummary
      || summarizeUserWorkbenchProtocol(workspaceState?.assetLayers?.userWorkbenchProtocol, { outputDir }).summary,
  };
  const lines = [
    '# DAOGE 当前任务入口',
    '',
    `请先打开${workbenchProtocol.defaultEntryLabel || governanceSummary.defaultEntryLabel || '工作台首页'}。这份 README 只负责告诉你从哪里进入，不负责解释本轮过程细节或最终收口结论。`,
    '',
    `- 先看这里: ${governanceSummary.defaultEntryPath || summary.workspaceHome}`,
    '',
    '## 当前状态',
    '',
    `- 成功结果: ${summary.success}`,
    `- 失败结果: ${summary.failed}`,
    `- 当前状态: ${summary.failed > 0 ? '存在异常，建议先处理失败项' : '整体稳定，可以继续筛图或进入下一轮'}`,
    '',
    '## 这轮怎么进入',
    '',
    `- 主链: 任务总控 -> ${workbenchProtocol.defaultVisibleLabels.join(' -> ')}`,
    `- 当前主入口: ${workbenchProtocol.defaultEntryLabel || governanceSummary.defaultEntryLabel || '工作台首页'}`,
    `- 补充入口: ${workspaceSupport.length ? workspaceSupport.map((item) => item.label).join('、') : workbenchProtocol.supportEntryLabel}`,
    '- 已后退: 深看页、旧说明页、JSON / Markdown 内部记录',
    `- 使用原则: ${governanceSummary.principle || workbenchProtocol.userRule}`,
    `- 目录规则: ${workbenchProtocol.summary}`,
    '',
    '## 按需直达',
    '',
    `- 结果工作台: ${summary.resultWorkspace}`,
    `- 异常工作台: ${summary.exceptionWorkspace}`,
    `- 任务档案: ${summary.runRecordHtml}`,
    ...(summary.completionReport ? [`- 完成报告: ${summary.completionReport}`] : []),
    ...(summary.storyboardBoard ? [`- 分镜整板页: ${summary.storyboardBoard}`] : []),
    ...workspaceSupport
      .filter((item) => item.path && ![summary.runRecordHtml, summary.completionReport, summary.storyboardBoard].filter(Boolean).includes(item.path))
      .map((item) => `- ${item.label}: ${item.path}`),
    '',
    '## 这三份说明各看什么',
    '',
    '- README: 只看入口、主链和目录分层，不展开过程细节',
    '- 任务档案: 只看这轮发生了什么、当前到了哪一步、下一步回哪里',
    '- 完成报告: 只看这轮是否已经可以收口，以及最后该怎么处理',
    '',
    '## 目录分层',
    '',
    '- 用户直看层: 主链工作台 + 任务档案这类少量补充入口',
    `- 文件落盘层: ${filesystemCount > 0 ? `${filesystemCount} 个文件，仅用于目录落盘说明` : '当前没有额外文件落盘入口'}`,
    `- 归档层: ${archiveCount > 0 ? `${archiveCount} 个文件，仅在归档回看时使用` : '当前没有归档文件'}`,
    `- 内部状态层: ${internalCount > 0 ? `${internalCount} 个文件，服务状态底盘、续跑和诊断` : '当前没有内部状态文件'}`,
  ];
  writeMarkdown(path.join(outputDir, 'README.md'), lines);
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

function createSelectionArtifacts(outputDir, manifest, allResults, options = {}) {
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

  if (options.generateDiagnosticMarkdown !== false) {
    writeMarkdown(files.selectionBoard, lines);
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

function createOperationsReport(outputDir, allResults, options = {}) {
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
  if (options.generateDiagnosticMarkdown !== false) {
    writeMarkdown(reportMd, lines);
  }
  return { reportPath, reportMd, report };
}

function buildManifest(outputDir, promptPack, results, options = {}) {
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
    optionalPageMode: String(options.optionalPageMode || '').trim().toLowerCase() || 'mainline-only',
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
  const emitArchiveMarkdown = String(args['emit-archive-markdown'] || '').trim().toLowerCase() === 'true';
  const optionalPageDecision = buildOptionalPageDecision({
    optionalPageMode: args['emit-optional-pages'],
  });
  const optionalPageEmission = optionalPageDecision;
  runNode('validate_host_native_results.js', ['--results-file', resultsFile]);
  const rawResults = asArray(readJson(resultsFile));
  const normalizedResults = rawResults.map(normalizeResult);

  ensureDir(outputDir);

  const manifest = buildManifest(outputDir, promptPack, normalizedResults, {
    optionalPageMode: optionalPageEmission.mode,
  });
  const manifestPath = path.join(outputDir, 'manifest.json');
  writeJson(manifestPath, manifest);

  createSelectionArtifacts(outputDir, manifest, normalizedResults, { generateDiagnosticMarkdown: false });
  createOperationsReport(outputDir, normalizedResults, { generateDiagnosticMarkdown: false });
  removeFileIfExists(path.join(outputDir, 'selection_board.md'));
  removeFileIfExists(path.join(outputDir, 'operations_report.md'));

  if (emitArchiveMarkdown) {
    runNode('render_completion_report.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'daoge_completion_report.md')]);
    runNode('render_run_record.js', ['--manifest-file', manifestPath, '--markdown-file', path.join(outputDir, 'run_record.md'), '--html-file', path.join(outputDir, 'run_record.html')]);
  } else {
    removeFileIfExists(path.join(outputDir, 'daoge_completion_report.md'));
    runNode('render_run_record.js', ['--manifest-file', manifestPath, '--markdown-file', path.join(outputDir, '.tmp_run_record.md'), '--html-file', path.join(outputDir, 'run_record.html')]);
    removeFileIfExists(path.join(outputDir, '.tmp_run_record.md'));
    removeFileIfExists(path.join(outputDir, 'run_record.md'));
  }
  runNode('build_workspace_state.js', [
    '--manifest-file', manifestPath,
    '--output-dir', outputDir,
    '--workspace-state-file', path.join(outputDir, 'workspace_state.json'),
    '--workspace-assets-file', path.join(outputDir, 'workspace_assets.json'),
    '--workspace-timeline-file', path.join(outputDir, 'workspace_timeline.json'),
    '--workbench-state-file', path.join(outputDir, 'workbench_state.json'),
  ]);
  runNode('render_result_workspace.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'result_workspace.html')]);
  runNode('render_exception_workspace.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'exception_workspace.html')]);
  runNode('render_workspace_home.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'workspace_home.html')]);
  if (optionalPageDecision.shouldGenerateResultDetails) {
    runNode('render_review_board.js', [
      '--manifest-file', manifestPath,
      '--success-file', path.join(outputDir, 'success.json'),
      '--failed-file', path.join(outputDir, 'failed.json'),
      '--needs-review-file', path.join(outputDir, 'needs_review.json'),
      '--rerun-candidates-file', path.join(outputDir, 'rerun_candidates.json'),
      '--operations-report-file', path.join(outputDir, 'operations_report.json'),
      '--output-file', path.join(outputDir, 'review_board.html'),
    ]);
    runNode('render_run_overview.js', [
      '--manifest-file', manifestPath,
      '--output-file', path.join(outputDir, 'run_overview.html'),
    ]);
    runNode('render_rerun_board.js', [
      '--manifest-file', manifestPath,
      '--output-file', path.join(outputDir, 'rerun_board.html'),
    ]);
    runNode('render_completion_board.js', [
      '--manifest-file', manifestPath,
      '--output-file', path.join(outputDir, 'completion_board.html'),
    ]);
  }
  if (optionalPageDecision.shouldGenerateLegacyPages) {
    runNode('render_result_hub_board.js', [
      '--manifest-file', manifestPath,
      '--output-file', path.join(outputDir, 'result_hub.html'),
    ]);
    runNode('render_portal_home.js', [
      '--manifest-file', manifestPath,
      '--output-file', path.join(outputDir, 'daoge_portal.html'),
    ]);
  }
  if (optionalPageDecision.shouldRefreshExpandedWorkspace) {
    runNode('build_workspace_state.js', [
      '--manifest-file', manifestPath,
      '--output-dir', outputDir,
      '--workspace-state-file', path.join(outputDir, 'workspace_state.json'),
      '--workspace-assets-file', path.join(outputDir, 'workspace_assets.json'),
      '--workspace-timeline-file', path.join(outputDir, 'workspace_timeline.json'),
      '--workbench-state-file', path.join(outputDir, 'workbench_state.json'),
    ]);
    runNode('render_result_workspace.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'result_workspace.html')]);
    runNode('render_exception_workspace.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'exception_workspace.html')]);
    runNode('render_workspace_home.js', ['--manifest-file', manifestPath, '--output-file', path.join(outputDir, 'workspace_home.html')]);
  }
  const storyboardBundleFile = path.join(outputDir, 'storyboard_bundle.validation.json');
  const successFile = path.join(outputDir, 'success.json');
  if (optionalPageDecision.shouldGenerateStoryboardDetails && fs.existsSync(storyboardBundleFile) && fs.existsSync(successFile)) {
    runNode('render_storyboard_board.js', [
      '--storyboard-file', storyboardBundleFile,
      '--results-file', successFile,
      '--output-dir', outputDir,
      '--output-file', path.join(outputDir, 'storyboard_board.html'),
    ]);
  } else {
    removeFileIfExists(path.join(outputDir, 'storyboard_board.html'));
  }
  pruneHiddenHtmlFiles(outputDir, optionalPageDecision);

  writeReadme(outputDir, {
    workspaceHome: path.join(outputDir, 'workspace_home.html'),
    resultWorkspace: path.join(outputDir, 'result_workspace.html'),
    exceptionWorkspace: path.join(outputDir, 'exception_workspace.html'),
    runRecordHtml: path.join(outputDir, 'run_record.html'),
    runRecordMarkdown: path.join(outputDir, 'run_record.md'),
    completionReport: emitArchiveMarkdown ? path.join(outputDir, 'daoge_completion_report.md') : null,
    storyboardBoard: fs.existsSync(path.join(outputDir, 'storyboard_board.html')) ? path.join(outputDir, 'storyboard_board.html') : null,
    success: manifest.success,
    failed: manifest.failed,
  });

  const summary = {
    ok: true,
    outputDir,
    manifest: manifestPath,
    success: manifest.success,
    failed: manifest.failed,
    generated: {
      completion_report: emitArchiveMarkdown ? path.join(outputDir, 'daoge_completion_report.md') : null,
      result_workspace: path.join(outputDir, 'result_workspace.html'),
      exception_workspace: path.join(outputDir, 'exception_workspace.html'),
      workspace_home: path.join(outputDir, 'workspace_home.html'),
      run_record: path.join(outputDir, 'run_record.html'),
      storyboard_board: fs.existsSync(path.join(outputDir, 'storyboard_board.html')) ? path.join(outputDir, 'storyboard_board.html') : null,
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
