const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('./run_batch_cli');
const { chunkArray, resolvePromptFileForRerun } = require('./script_utils');
const {
  sanitize,
  parseNumber,
  clampNumber,
  parseBoolean,
  slugify,
} = require('./run_batch_shared');
const {
  readJson,
  hasExplicitSelectionArgs,
  selectResumePrompts,
  selectExplicitPrompts,
  applyPreviousOutputReuse,
  writeRerunPlan,
} = require('./run_batch_selection');
const {
  renderCompletionReport,
  renderRunRecord,
  renderWorkspaceHome,
  renderResultWorkspace,
  renderExceptionWorkspace,
  renderStoryboardBoard,
  renderWorkspaceState,
  renderVisualReviewAnalysis,
  createOperationalArtifacts,
  removeFileIfExists,
} = require('./run_batch_artifacts');
const {
  resolveOptionalPageEmission,
  buildOptionalPageDecision,
} = require('./default_generation_contract');
const {
  writeJson,
  createJobState,
  writeJobState,
  writeCheckpoint,
  translatePauseReason,
  printExecutionStart,
  printBatchStart,
  printBatchSummary,
  updateStateAfterBatch,
  evaluatePausePolicy,
} = require('./run_batch_runtime');
const { refreshTaskCenterRuntimeState } = require('./task_center_state_runtime');
const { refreshRuntimeWorkbench } = require('./workbench_state_runtime');
const {
  buildContactSheet,
  runBatch,
} = require('./run_batch_executor');
const { readJsonIfExists } = require('./script_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const { summarizeUserWorkbenchProtocol } = require('./workspace_page_shared');

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function parseEnv(file) {
  const out = {};
  const raw = fs.readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const normalizedLine = line.replace(/^\s*export\s+/, '');
    const idx = normalizedLine.indexOf('=');
    if (idx === -1) continue;
    const key = normalizedLine.slice(0, idx).trim();
    let value = normalizedLine.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    out[key] = value.trim();
  }
  return out;
}

function summarizeBatchItems(items, batchNumber, offsetBase) {
  return {
    batchNumber,
    promptCount: items.length,
    firstIndex: items[0]?.index ?? offsetBase + 1,
    lastIndex: items[items.length - 1]?.index ?? offsetBase + items.length,
    offsetBase,
  };
}

function buildReadmeFromWorkspaceState(outputDir, fallback = {}) {
  const workspaceState = loadWorkbenchState(outputDir).workspaceState || {};
  const artifactGovernance = workspaceState?.artifactGovernance || {};
  const summary = artifactGovernance.summary || {};
  const directoryProtocol = workspaceState?.assetLayers?.directoryProtocol || {};
  const directorySurfaces = directoryProtocol?.surfaces || {};
  const workbenchProtocol = {
    ...summarizeUserWorkbenchProtocol(workspaceState?.assetLayers?.userWorkbenchProtocol, { outputDir }),
    summary: String(workspaceState?.assetLayers?.userWorkbenchProtocol?.summary || '').trim()
      || String(directoryProtocol.summary || '').trim()
      || summarizeUserWorkbenchProtocol(workspaceState?.assetLayers?.userWorkbenchProtocol, { outputDir }).summary,
  };
  const workspaceSupport = Array.isArray(artifactGovernance.workspaceSupport) ? artifactGovernance.workspaceSupport : [];
  const supportEntries = workspaceSupport.filter((item) => item.exists);
  const defaultEntryPath = summary.defaultEntryPath || fallback.workspaceHomePath || null;
  const defaultEntryLabel = workbenchProtocol.defaultEntryLabel || summary.defaultEntryLabel || '工作台首页';
  const resultWorkspacePath = fallback.resultWorkspacePath || path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspacePath = fallback.exceptionWorkspacePath || path.join(outputDir, 'exception_workspace.html');
  const runRecordPath = fallback.runRecordHtmlPath || path.join(outputDir, 'run_record.html');
  const completionReportPath = fallback.completionReportPath || null;
  const storyboardBoardPath = fallback.storyboardBoardPath || null;
  const statusLines = Array.isArray(fallback.statusLines) ? fallback.statusLines : [];
  const principle = String(summary.principle || '').trim() || workbenchProtocol.userRule;
  const directorySummary = workbenchProtocol.summary;
  const filesystemCount = Number(directorySurfaces?.filesystem?.count || 0);
  const archiveCount = Number(directorySurfaces?.archive?.count || 0);
  const internalCount = Number(directorySurfaces?.internal?.count || 0);

  return [
    '# DAOGE 当前任务入口',
    '',
    `请先打开${defaultEntryLabel}。这份 README 只负责告诉你从哪里进入、进去后先看什么、下一步怎么和 DAOGE 继续。`,
    '',
    `- 先看这里: ${defaultEntryPath}`,
    `- 打开后先看: 当前阶段、推荐下一步、回到对话框怎么说`,
    `- 不用先看: JSON / Markdown 内部记录、旧说明页、深看页`,
    '',
    '## 当前状态',
    '',
    ...statusLines,
    '',
    '## 这轮怎么进入',
    '',
    `- 主链: 任务总控 -> ${workbenchProtocol.defaultVisibleLabels.join(' -> ')}`,
    `- 当前主入口: ${defaultEntryLabel}`,
    `- 进入后: 先看页面顶部主动作，再按推荐按钮继续`,
    `- 补充入口: ${supportEntries.length ? supportEntries.map((item) => item.label).join('、') : workbenchProtocol.supportEntryLabel}`,
    `- 已后退: 深看页、旧说明页、JSON / Markdown 内部记录`,
    `- 使用原则: ${principle}`,
    `- 目录规则: ${directorySummary}`,
    '',
    '## 按需直达',
    '',
    `- 结果工作台: ${resultWorkspacePath}`,
    `- 异常工作台: ${exceptionWorkspacePath}`,
    `- 任务档案: ${runRecordPath}`,
    ...(completionReportPath ? [`- 完成报告: ${completionReportPath}`] : []),
    ...(storyboardBoardPath ? [`- 分镜整板页: ${storyboardBoardPath}`] : []),
    ...supportEntries
      .filter((item) => item.path && ![runRecordPath, completionReportPath, storyboardBoardPath].filter(Boolean).includes(item.path))
      .map((item) => `- ${item.label}: ${item.path}`),
    '',
    '## 这三份说明各看什么',
    '',
    `- README: 只看入口、主链和目录分层，不展开过程细节`,
    `- 任务档案: 只看这轮发生了什么、当前到了哪一步、下一步回哪里`,
    `- 完成报告: 只看这轮是否已经可以收口，以及最后该怎么处理`,
    '',
    '## 目录分层',
    '',
    `- 用户直看层: 主链工作台 + 任务档案这类少量补充入口`,
    `- 文件落盘层: ${filesystemCount > 0 ? `${filesystemCount} 个文件，仅用于目录落盘说明` : '当前没有额外文件落盘入口'}`,
    `- 归档层: ${archiveCount > 0 ? `${archiveCount} 个文件，仅在归档回看时使用` : '当前没有归档文件'}`,
    `- 内部状态层: ${internalCount > 0 ? `${internalCount} 个文件，服务状态底盘、续跑和诊断` : '当前没有内部状态文件'}`,
  ].join('\n');
}

function buildExecutionPlan(selectedPrompts, batchSize, stageSize, sampleSize) {
  const stages = [];
  const allBatches = [];
  let batchNumber = 1;

  function appendStage(type, items, stagePromptOffset) {
    if (!items.length) return;
    const stageNumber = stages.length + 1;
    const chunks = chunkArray(items, batchSize);
    const batches = chunks.map((chunk, chunkIndex) => {
      const offsetBase = stagePromptOffset + chunkIndex * batchSize;
      const summary = summarizeBatchItems(chunk, batchNumber, offsetBase);
      const plannedBatch = { ...summary, items: chunk, stageNumber, stageType: type };
      batchNumber += 1;
      allBatches.push(plannedBatch);
      return summary;
    });
    stages.push({
      stageNumber,
      type,
      promptCount: items.length,
      batchCount: batches.length,
      batches,
    });
  }

  const normalizedSampleSize = Math.max(0, Math.min(sampleSize, selectedPrompts.length));
  let cursor = 0;
  if (normalizedSampleSize > 0) {
    appendStage('sample', selectedPrompts.slice(0, normalizedSampleSize), 0);
    cursor = normalizedSampleSize;
  }

  const remaining = selectedPrompts.slice(cursor);
  if (remaining.length) {
    const effectiveStageSize = stageSize > 0 ? stageSize : remaining.length;
    for (let i = 0; i < remaining.length; i += effectiveStageSize) {
      appendStage('production', remaining.slice(i, i + effectiveStageSize), cursor + i);
    }
  }

  return {
    totalPrompts: selectedPrompts.length,
    batchSize,
    stageSize: stageSize > 0 ? stageSize : null,
    sampleSize: normalizedSampleSize,
    stageCount: stages.length,
    batchCount: allBatches.length,
    stages,
    batches: allBatches,
  };
}

function publicExecutionPlan(plan) {
  return {
    totalPrompts: plan.totalPrompts,
    batchSize: plan.batchSize,
    stageSize: plan.stageSize,
    sampleSize: plan.sampleSize,
    stageCount: plan.stageCount,
    batchCount: plan.batchCount,
    stages: plan.stages,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args['prompts-file']) throw new Error('Missing required flag: --prompts-file');

  const cwd = process.cwd();
  const envFile = path.resolve(args['env-file'] || path.join(cwd, '.env'));
  const env = parseEnv(envFile);
  if (!env.OPENAI_BASE_URL || !env.OPENAI_API_KEY) {
    throw new Error(`Missing OPENAI_BASE_URL or OPENAI_API_KEY in ${envFile}`);
  }
  const generatePathOverride = args['generate-path'] || env.OPENAI_IMAGE_GENERATE_PATH || '';
  const editPathOverride = args['edit-path'] || env.OPENAI_IMAGE_EDIT_PATH || '';
  const responsesModel = args['responses-model'] || env.OPENAI_RESPONSES_MODEL || 'gpt-5.4';

  const promptsFile = path.resolve(args['prompts-file']);
  const promptPool = JSON.parse(fs.readFileSync(promptsFile, 'utf8'));
  if (!Array.isArray(promptPool)) throw new Error(`Prompt file must be a JSON array: ${promptsFile}`);
  const resumeManifest = args['resume-manifest'] ? path.resolve(args['resume-manifest']) : null;
  const explicitSelection = hasExplicitSelectionArgs(args);
  const failedOnlyDefault = resumeManifest ? !explicitSelection : false;
  const failedOnly = parseBoolean(args['failed-only'], failedOnlyDefault);
  const reuseOutputAsReference = parseBoolean(args['reuse-output-as-reference'], false);
  const resumePool = selectResumePrompts(promptPool, resumeManifest, failedOnly);
  const explicitPool = selectExplicitPrompts(resumePool, args);
  const preparedPool = applyPreviousOutputReuse(explicitPool, resumeManifest, reuseOutputAsReference);

  const width = Math.max(16, Math.floor(parseNumber(args.width, 1440)));
  const height = Math.max(16, Math.floor(parseNumber(args.height, 2560)));
  const outputFormat = args['output-format'] || 'png';
  const timeoutSeconds = Math.max(1, parseNumber(args['timeout-seconds'], 450));
  const retryCount = Math.max(0, Math.floor(parseNumber(args['retry-count'], 1)));
  const concurrency = clampNumber(Math.floor(parseNumber(args.concurrency, 3)), 1, 12);
  const offset = Math.max(0, Math.floor(parseNumber(args.offset, 0)));
  const limit = Math.max(0, Math.floor(parseNumber(args.limit, preparedPool.length - offset)));
  const selectedPrompts = preparedPool.slice(offset, offset + limit);
  if (!selectedPrompts.length) throw new Error('No prompts selected after applying offset/limit');

  const batchSize = Math.max(1, Math.floor(parseNumber(args['batch-size'], selectedPrompts.length)));
  const stageSize = Math.max(0, Math.floor(parseNumber(args['stage-size'], 0)));
  const sampleSize = Math.max(0, Math.floor(parseNumber(args['sample-size'], 0)));
  const stopAfterSample = parseBoolean(args['stop-after-sample'], false);
  const pausePolicy = {
    enabled: parseBoolean(args['auto-pause'], true),
    maxConsecutiveFailures: Math.max(0, Math.floor(parseNumber(args['max-consecutive-failures'], 0))),
    maxBatchFailureRate: parseNumber(args['max-batch-failure-rate'], 1.1),
  };
  const contactSheet = parseBoolean(args['contact-sheet'], true);
  const dryRun = parseBoolean(args['dry-run'], false);
  const skipExisting = parseBoolean(args['skip-existing'], false);
  const emitDiagnosticMarkdown = parseBoolean(args['emit-diagnostic-markdown'], false);
  const emitArchiveMarkdown = parseBoolean(args['emit-archive-markdown'], false);
  const optionalPageDecision = buildOptionalPageDecision({
    optionalPageMode: args['emit-optional-pages'],
  });
  const optionalPageEmission = optionalPageDecision;
  const runLabel = args['run-label'] ? slugify(args['run-label']) : `run_${stamp()}`;
  const outputDir = path.resolve(args['output-dir'] || path.join(cwd, 'generated_images', runLabel));
  fs.mkdirSync(outputDir, { recursive: true });

  const promptsCopyPath = path.join(outputDir, 'prompts.generated.json');
  fs.writeFileSync(promptsCopyPath, JSON.stringify(selectedPrompts, null, 2));
  const rerunPlanPath = writeRerunPlan(outputDir, resumeManifest, selectedPrompts);

  const executionPlan = buildExecutionPlan(selectedPrompts, batchSize, stageSize, sampleSize);
  const batches = executionPlan.batches;
  const batchPlan = batches.map(({ items, ...batch }) => batch);
  fs.writeFileSync(path.join(outputDir, 'batch_plan.json'), JSON.stringify(batchPlan, null, 2));
  fs.writeFileSync(path.join(outputDir, 'stage_plan.json'), JSON.stringify(publicExecutionPlan(executionPlan), null, 2));
  const initialManifest = {
    outputDir,
    promptSource: promptsCopyPath,
    promptSourceOriginal: promptsFile,
    promptSnapshot: promptsCopyPath,
    optionalPageMode: optionalPageEmission.mode,
    resumeManifest,
    failedOnly,
    rerunPlan: rerunPlanPath,
    selectedCount: selectedPrompts.length,
    offset,
    limit,
    batchSize,
    stageSize: stageSize || null,
    sampleSize: executionPlan.sampleSize,
    stageCount: executionPlan.stageCount,
    batchCount: batches.length,
    model: env.OPENAI_MODEL || 'gpt-image-2',
    defaultSize: `${width}x${height}`,
    generatedAt: new Date().toISOString(),
    dryRun,
    skipExisting,
    paused: false,
    pauseReason: null,
    jobState: path.join(outputDir, 'job_state.json'),
    checkpoint: path.join(outputDir, 'checkpoint.json'),
    stagePlan: path.join(outputDir, 'stage_plan.json'),
    success: 0,
    failed: 0,
    skipped: 0,
    batches: batchPlan.map((batch) => ({
      ...batch,
      outputDir: null,
      success: 0,
      failed: 0,
      skipped: 0,
      results: [],
    })),
  };
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(initialManifest, null, 2));

  const jobState = createJobState(outputDir, {
    promptsFile,
    selectedCount: selectedPrompts.length,
    batchSize,
    stageSize,
    sampleSize: executionPlan.sampleSize,
    concurrency,
    retryCount,
    timeoutSeconds,
    pausePolicy,
  }, executionPlan);
  writeJobState(outputDir, jobState);
  writeCheckpoint(outputDir, jobState);
  refreshTaskCenterRuntimeState(outputDir, {
    jobState,
    renderOutputs: true,
  });
  refreshRuntimeWorkbench(outputDir);

  console.log(`[info] output dir: ${outputDir}`);
  console.log(`[info] prompts: ${selectedPrompts.length}, stages: ${executionPlan.stageCount}, batches: ${batches.length}, batch size: ${batchSize}, concurrency: ${concurrency}, default size: ${width}x${height}, timeout per image: ${timeoutSeconds}s, retry: ${retryCount}`);
  console.log(`[info] prompt source: ${promptsFile}`);
  if (generatePathOverride) console.log(`[info] generate path override: ${generatePathOverride}`);
  if (editPathOverride) console.log(`[info] edit path override: ${editPathOverride}`);
  if (resumeManifest) console.log(`[info] resume manifest: ${resumeManifest}, failed only: ${failedOnly}`);
  if (explicitSelection) console.log('[info] explicit slot/index selection detected; defaulting failed-only to false unless explicitly overridden');
  if (reuseOutputAsReference) console.log('[info] previous successful outputs will be reused as edit references for selected prompts');
  if (dryRun) {
    const manifest = {
      ...initialManifest,
      dryRun: true,
    };
    fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    refreshRuntimeWorkbench(outputDir);
    const artifacts = createOperationalArtifacts(outputDir, manifest, [], { readJson, writeJson }, {
      generateDiagnosticMarkdown: emitDiagnosticMarkdown,
      generateArchiveMarkdown: emitArchiveMarkdown,
    });
    const runRecord = renderRunRecord(outputDir, {
      generateArchiveMarkdown: emitArchiveMarkdown,
    });
    const workspaceStateArtifacts = renderWorkspaceState(outputDir);
    const workspaceHomePath = renderWorkspaceHome(outputDir);
    const resultWorkspacePath = renderResultWorkspace(outputDir);
    const exceptionWorkspacePath = renderExceptionWorkspace(outputDir);
    const storyboardBoardPath = optionalPageDecision.shouldGenerateStoryboardDetails
      ? renderStoryboardBoard(outputDir)
      : null;
    if (!optionalPageDecision.shouldGenerateStoryboardDetails || !storyboardBoardPath) {
      removeFileIfExists(path.join(outputDir, 'storyboard_board.html'));
    }
    if (optionalPageDecision.shouldGenerateResultDetails) {
      execFileSync(process.execPath, [
        path.join(__dirname, 'render_review_board.js'),
        '--manifest-file', path.join(outputDir, 'manifest.json'),
        '--success-file', path.join(outputDir, 'success.json'),
        '--failed-file', path.join(outputDir, 'failed.json'),
        '--needs-review-file', path.join(outputDir, 'needs_review.json'),
        '--rerun-candidates-file', path.join(outputDir, 'rerun_candidates.json'),
        '--operations-report-file', path.join(outputDir, 'operations_report.json'),
        '--output-file', path.join(outputDir, 'review_board.html'),
      ], { stdio: 'ignore' });
      execFileSync(process.execPath, [
        path.join(__dirname, 'render_run_overview.js'),
        '--manifest-file', path.join(outputDir, 'manifest.json'),
        '--output-file', path.join(outputDir, 'run_overview.html'),
      ], { stdio: 'ignore' });
      execFileSync(process.execPath, [
        path.join(__dirname, 'render_rerun_board.js'),
        '--manifest-file', path.join(outputDir, 'manifest.json'),
        '--output-file', path.join(outputDir, 'rerun_board.html'),
      ], { stdio: 'ignore' });
      execFileSync(process.execPath, [
        path.join(__dirname, 'render_completion_board.js'),
        '--manifest-file', path.join(outputDir, 'manifest.json'),
        '--output-file', path.join(outputDir, 'completion_board.html'),
      ], { stdio: 'ignore' });
    }
    if (optionalPageDecision.shouldGenerateLegacyPages) {
      execFileSync(process.execPath, [
        path.join(__dirname, 'render_result_hub_board.js'),
        '--manifest-file', path.join(outputDir, 'manifest.json'),
        '--output-file', path.join(outputDir, 'result_hub.html'),
      ], { stdio: 'ignore' });
      execFileSync(process.execPath, [
        path.join(__dirname, 'render_portal_home.js'),
        '--manifest-file', path.join(outputDir, 'manifest.json'),
        '--output-file', path.join(outputDir, 'daoge_portal.html'),
      ], { stdio: 'ignore' });
    }
    if (optionalPageDecision.shouldRefreshExpandedWorkspace) {
      renderWorkspaceState(outputDir);
      renderWorkspaceHome(outputDir);
      renderResultWorkspace(outputDir);
      renderExceptionWorkspace(outputDir);
    }
    fs.writeFileSync(path.join(outputDir, 'README.md'), buildReadmeFromWorkspaceState(outputDir, {
      workspaceHomePath,
      resultWorkspacePath,
      exceptionWorkspacePath,
      runRecordHtmlPath: runRecord.htmlPath,
      completionReportPath: null,
      storyboardBoardPath,
      statusLines: [
        '- 当前状态: 模拟运行，页面和档案已经生成',
        `- 输出目录: ${outputDir}`,
      ],
    }));
    console.log('[dry-run]');
    console.log(JSON.stringify({ outputDir, selectedCount: selectedPrompts.length, batchCount: batches.length, rerunPlan: rerunPlanPath }, null, 2));
    return;
  }

  const batchResults = [];
  const allResults = [];
  let paused = false;
  let pauseReason = null;
  jobState.status = 'running';
  writeJobState(outputDir, jobState);
  refreshTaskCenterRuntimeState(outputDir, {
    jobState,
    renderOutputs: true,
  });
  refreshRuntimeWorkbench(outputDir);
  printExecutionStart({
    selectedCount: selectedPrompts.length,
    stageCount: executionPlan.stageCount,
    batchCount: batches.length,
    width,
    height,
    concurrency,
    timeoutSeconds,
    retryCount,
    outputDir,
  });

  for (let i = 0; i < batches.length; i += 1) {
    const plannedBatch = batches[i];
    jobState.progress.currentStage = plannedBatch.stageNumber;
    jobState.progress.currentBatch = plannedBatch.batchNumber;
    writeJobState(outputDir, jobState);
    refreshTaskCenterRuntimeState(outputDir, {
      jobState,
      renderOutputs: true,
    });
    refreshRuntimeWorkbench(outputDir);
    printBatchStart(plannedBatch, batches.length);

    const batchResult = await runBatch(plannedBatch.items, {
      rootOutputDir: outputDir,
      batchNumber: plannedBatch.batchNumber,
      totalBatches: batches.length,
      concurrency,
      baseUrl: env.OPENAI_BASE_URL,
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL || 'gpt-image-2',
      responsesModel,
      generatePath: generatePathOverride,
      editPath: editPathOverride,
      width,
      height,
      outputFormat,
      timeoutSeconds,
      retryCount,
      skipExisting,
      offsetBase: offset + plannedBatch.offsetBase,
      readJson,
    });
    batchResults.push(batchResult);
    allResults.push(...(batchResult.manifest.results || []));
    updateStateAfterBatch(jobState, batchResult.manifest);
    writeJobState(outputDir, jobState);
    writeCheckpoint(outputDir, jobState, batchResult.manifest);
    refreshTaskCenterRuntimeState(outputDir, {
      jobState,
      checkpoint: {
        writtenAt: new Date().toISOString(),
        latestBatch: {
          batchNumber: batchResult.manifest.batchNumber,
        },
      },
      renderOutputs: true,
    });
    refreshRuntimeWorkbench(outputDir);
    printBatchSummary(plannedBatch, batchResult.manifest, jobState);

    pauseReason = evaluatePausePolicy(batchResult.manifest, allResults, pausePolicy);
    if (!pauseReason && stopAfterSample && plannedBatch.stageType === 'sample') {
      const nextBatch = batches[i + 1];
      if (!nextBatch || nextBatch.stageType !== 'sample') pauseReason = 'sample_stage_completed_review_required';
    }
    if (pauseReason) {
      paused = true;
      jobState.status = 'paused';
      jobState.pauseReason = pauseReason;
      writeJobState(outputDir, jobState);
      writeCheckpoint(outputDir, jobState, batchResult.manifest);
      refreshTaskCenterRuntimeState(outputDir, {
        jobState,
        checkpoint: {
          writtenAt: new Date().toISOString(),
          latestBatch: {
            batchNumber: batchResult.manifest.batchNumber,
          },
        },
        renderOutputs: true,
      });
      refreshRuntimeWorkbench(outputDir);
      console.log('DAOGE 状态：已暂停，等待处理');
      console.log(`[DAOGE][自动暂停] ${translatePauseReason(pauseReason)}`);
      console.log(`[pause] ${pauseReason}`);
      break;
    }
  }

  const successfulFiles = allResults.filter((item) => item.ok && item.output).map((item) => item.output);
  if (contactSheet && successfulFiles.length) buildContactSheet(outputDir, successfulFiles);

  const manifest = {
    outputDir,
    promptSource: promptsCopyPath,
    promptSourceOriginal: promptsFile,
    promptSnapshot: promptsCopyPath,
    optionalPageMode: optionalPageEmission.mode,
    resumeManifest,
    failedOnly,
    rerunPlan: rerunPlanPath,
    selectedCount: selectedPrompts.length,
    offset,
    limit,
    batchSize,
    stageSize: stageSize || null,
    sampleSize: executionPlan.sampleSize,
    stageCount: executionPlan.stageCount,
    batchCount: batches.length,
    model: env.OPENAI_MODEL || 'gpt-image-2',
    defaultSize: `${width}x${height}`,
    generatedAt: new Date().toISOString(),
    skipExisting,
    paused,
    pauseReason,
    jobState: path.join(outputDir, 'job_state.json'),
    checkpoint: path.join(outputDir, 'checkpoint.json'),
    stagePlan: path.join(outputDir, 'stage_plan.json'),
    success: allResults.filter((item) => item.ok && !item.skipped).length,
    skipped: allResults.filter((item) => item.skipped).length,
    failed: allResults.filter((item) => !item.ok).length,
    batches: batchResults.map((item) => item.manifest),
  };
  if (!paused) {
    jobState.status = 'completed';
    jobState.pauseReason = null;
    writeJobState(outputDir, jobState);
    writeCheckpoint(outputDir, jobState);
    refreshTaskCenterRuntimeState(outputDir, {
      jobState,
      renderOutputs: true,
    });
    refreshRuntimeWorkbench(outputDir);
  }
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const artifacts = createOperationalArtifacts(outputDir, manifest, allResults, { readJson, writeJson }, {
    generateDiagnosticMarkdown: emitDiagnosticMarkdown,
    generateArchiveMarkdown: emitArchiveMarkdown,
  });
  const visualReviewAnalysisPath = renderVisualReviewAnalysis(outputDir, manifest, {
    enable: parseBoolean(args['enable-visual-review'], false),
    envFile,
    responsesModel,
    visionTimeoutMs: Number(args['vision-timeout-ms'] || 90000),
    maxItems: Number(args['review-max-items'] || 8),
  });
  const runRecord = renderRunRecord(outputDir, {
    generateArchiveMarkdown: emitArchiveMarkdown,
  });
  const workspaceStateArtifacts = renderWorkspaceState(outputDir);
  const workspaceHomePath = renderWorkspaceHome(outputDir);
  const resultWorkspacePath = renderResultWorkspace(outputDir);
  const exceptionWorkspacePath = renderExceptionWorkspace(outputDir);
  const storyboardBoardPath = optionalPageDecision.shouldGenerateStoryboardDetails
    ? renderStoryboardBoard(outputDir)
    : null;
  if (!optionalPageDecision.shouldGenerateStoryboardDetails || !storyboardBoardPath) {
    removeFileIfExists(path.join(outputDir, 'storyboard_board.html'));
  }
  if (optionalPageDecision.shouldGenerateResultDetails) {
    execFileSync(process.execPath, [
      path.join(__dirname, 'render_review_board.js'),
      '--manifest-file', path.join(outputDir, 'manifest.json'),
      '--success-file', path.join(outputDir, 'success.json'),
      '--failed-file', path.join(outputDir, 'failed.json'),
      '--needs-review-file', path.join(outputDir, 'needs_review.json'),
      '--rerun-candidates-file', path.join(outputDir, 'rerun_candidates.json'),
      '--operations-report-file', path.join(outputDir, 'operations_report.json'),
      '--output-file', path.join(outputDir, 'review_board.html'),
    ], { stdio: 'ignore' });
    execFileSync(process.execPath, [
      path.join(__dirname, 'render_run_overview.js'),
      '--manifest-file', path.join(outputDir, 'manifest.json'),
      '--output-file', path.join(outputDir, 'run_overview.html'),
    ], { stdio: 'ignore' });
    execFileSync(process.execPath, [
      path.join(__dirname, 'render_rerun_board.js'),
      '--manifest-file', path.join(outputDir, 'manifest.json'),
      '--output-file', path.join(outputDir, 'rerun_board.html'),
    ], { stdio: 'ignore' });
    execFileSync(process.execPath, [
      path.join(__dirname, 'render_completion_board.js'),
      '--manifest-file', path.join(outputDir, 'manifest.json'),
      '--output-file', path.join(outputDir, 'completion_board.html'),
    ], { stdio: 'ignore' });
  }
  if (optionalPageDecision.shouldGenerateLegacyPages) {
    execFileSync(process.execPath, [
      path.join(__dirname, 'render_result_hub_board.js'),
      '--manifest-file', path.join(outputDir, 'manifest.json'),
      '--output-file', path.join(outputDir, 'result_hub.html'),
    ], { stdio: 'ignore' });
    execFileSync(process.execPath, [
      path.join(__dirname, 'render_portal_home.js'),
      '--manifest-file', path.join(outputDir, 'manifest.json'),
      '--output-file', path.join(outputDir, 'daoge_portal.html'),
    ], { stdio: 'ignore' });
  }
  if (optionalPageDecision.shouldRefreshExpandedWorkspace) {
    renderWorkspaceState(outputDir);
    renderWorkspaceHome(outputDir);
    renderResultWorkspace(outputDir);
    renderExceptionWorkspace(outputDir);
  }
  let completionReportPath = renderCompletionReport(outputDir, {
    generateArchiveMarkdown: emitArchiveMarkdown,
  });

  fs.writeFileSync(path.join(outputDir, 'README.md'), buildReadmeFromWorkspaceState(outputDir, {
    workspaceHomePath,
    resultWorkspacePath,
    exceptionWorkspacePath,
    runRecordHtmlPath: runRecord.htmlPath,
    completionReportPath,
    storyboardBoardPath,
    statusLines: [
      `- 成功结果: ${manifest.success}`,
      `- 失败结果: ${manifest.failed}`,
      `- 跳过已有结果: ${allResults.filter((item) => item.skipped).length}`,
      `- 当前状态: ${manifest.paused ? '已暂停，建议先处理风险' : (manifest.failed > 0 ? '存在异常，建议先处理失败项' : '整体稳定，可以继续筛图或进入下一轮')}`,
      `- 运行总索引: ${artifacts.runIndex.indexMd}`,
    ],
  }));

  console.log(paused ? 'DAOGE 状态：已暂停，等待处理' : 'DAOGE 状态：任务完成');
  console.log(`[DAOGE][执行结果] 成功 ${manifest.success}，失败 ${manifest.failed}，跳过 ${allResults.filter((item) => item.skipped).length}，共 ${selectedPrompts.length} 张`);
  console.log(`[DAOGE][工作台首页] 先看这里：${workspaceHomePath}`);
  console.log(`[DAOGE][结果工作台] 结果主链入口：${resultWorkspacePath}`);
  if (storyboardBoardPath) console.log(`[DAOGE][整板页] 按需页面：${storyboardBoardPath}`);
  if (paused) {
    console.log(`[DAOGE][下一步建议] ${translatePauseReason(pauseReason)}。建议先处理风险，再决定是否继续续跑。`);
  } else if (manifest.failed > 0) {
    console.log('[DAOGE][下一步建议] 建议先查看失败记录，再使用失败续跑只补跑失败项。');
  } else {
    console.log('[DAOGE][下一步建议] 本轮已稳定完成，可以进入选图、复盘或下一轮扩图。');
  }
  console.log('[done]');
  console.log(JSON.stringify({ outputDir, workspaceHomePath, resultWorkspacePath, success: manifest.success, failed: manifest.failed, batchCount: batches.length }, null, 2));
}

main().catch((error) => {
  console.error('[fatal]', sanitize(error?.message || error));
  process.exit(1);
});
