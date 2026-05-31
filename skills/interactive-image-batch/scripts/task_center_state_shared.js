const path = require('path');
const { readJsonIfExists, fileExists } = require('./script_utils');
const { loadWorkbenchState } = require('./workbench_state_shared');
const { buildLiveRunStateBundle, normalizeRuntimeProtocolState } = require('./unified_status_summary');
const { summarizeUserWorkbenchProtocol } = require('./workspace_page_shared');
const { summarizeOptionalPageEmission } = require('./default_generation_contract');
const {
  resolveEntryDefaultGenerationProtocol,
  resolveEntryMainlineActions,
} = require('./entry_state_shared');
const { resolveRecommendedWorkspacePath } = require('./workspace_layout_migration');
const {
  cleanLabel,
  pickPromptItems,
  deriveTaskLabel,
} = require('./task_label_utils');
const { buildRuntimeCopilotRelayCopy } = require('./workspace_status_dictionary');

function resolveTaskCenterStatePath(indexFile, options = {}) {
  if (options.stateFile) return path.resolve(options.stateFile);
  return path.join(path.dirname(path.resolve(indexFile)), 'task_center_state.json');
}

function resolveUnifiedTaskCenterStatePath(indexFile, options = {}) {
  if (options.unifiedStateFile) return path.resolve(options.unifiedStateFile);
  return path.join(path.dirname(path.resolve(indexFile)), 'task_center_live_state.json');
}

function formatTime(value) {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

function loadRuns(indexFile) {
  const parsed = readJsonIfExists(indexFile);
  return Array.isArray(parsed) ? parsed.slice().reverse() : [];
}

function mergeLiveRun(rawRuns, liveRun) {
  if (!liveRun || typeof liveRun !== 'object' || !liveRun.outputDir) return rawRuns;
  const liveOutputDir = path.resolve(liveRun.outputDir);
  return [
    liveRun,
    ...rawRuns.filter((item) => path.resolve(item?.outputDir || '') !== liveOutputDir),
  ];
}

function inferLegacyPhase(item, promptItems) {
  if (item.failedCount > 0) {
    return {
      phaseLabel: '异常阶段',
      phaseHeadline: '当前存在异常，建议先处理',
      phaseSummary: `当前有 ${item.failedCount} 个失败项，建议先统一处理异常。`,
      phaseTone: 'bad',
      nextActionReason: `当前有 ${item.failedCount} 个失败项，建议先统一处理异常。`,
    };
  }

  if (Number(item.sampleSize || 0) > 0 || String(item.pauseReason || '').includes('sample')) {
    return {
      phaseLabel: '抽样复核',
      phaseHeadline: '样张已产出，建议先确认方向',
      phaseSummary: '当前适合先看样张，再决定是否继续整轮推进。',
      phaseTone: 'warn',
      nextActionReason: '当前适合先看样张，再决定是否继续整轮推进。',
    };
  }

  if (item.resumeManifest || Number(item.selectedCount || 0) === 1) {
    return {
      phaseLabel: '局部修订',
      phaseHeadline: '这是一轮局部修订，可直接回看结果',
      phaseSummary: '当前更像单张修订，适合快速确认是否收口。',
      phaseTone: 'info',
      nextActionReason: '当前更像单张修订，适合快速确认是否收口。',
    };
  }

  if (promptItems.length > 1) {
    return {
      phaseLabel: '结果阶段',
      phaseHeadline: '这轮结果已经生成，可继续回看',
      phaseSummary: '当前更适合回看结果，判断是否需要下一轮推进。',
      phaseTone: 'good',
      nextActionReason: '当前更适合回看结果，判断是否需要下一轮推进。',
    };
  }

  return {
    phaseLabel: '任务记录',
    phaseHeadline: '当前任务已归档，可按需回看',
    phaseSummary: '这轮任务已经留档，适合在需要时再回看。',
    phaseTone: 'info',
    nextActionReason: '这轮任务已经留档，适合在需要时再回看。',
  };
}

function classifyRun(item, index) {
  if (item.failedCount > 0 || item.reviewCount > 0 || String(item.phaseTone || '').includes('bad') || String(item.phaseTone || '').includes('warn')) {
    return 'priority';
  }
  if (index === 0 || ['准备阶段', '结果阶段', '局部修订'].includes(item.phaseLabel)) {
    return 'active';
  }
  return 'stable';
}

function formatArtifactLayerSummary(artifactGovernance = {}) {
  const summary = artifactGovernance.userFacingSummary || artifactGovernance.summary || {};
  const principle = String(summary.principle || '').trim();
  return {
    defaultEntryLabel: String(summary.defaultEntryLabel || '工作台首页').trim(),
    mainlineCount: Number(summary.mainlineCount || 0),
    supportCount: Number(summary.supportCount || 0),
    conditionalCount: Number(summary.conditionalCount || 0),
    advancedCount: Number(summary.advancedCount || 0),
    legacyCount: Number(summary.legacyCount || 0),
    internalCount: Number(summary.internalCount || 0),
    principle: principle || '普通用户默认只看工作台主链，Markdown 与 JSON 退回补充说明或内部诊断层。',
    userFacing: Boolean(artifactGovernance.userFacingSummary),
  };
}

function summarizeUserAssetLayer(assetLayers = {}) {
  const userFacing = assetLayers && typeof assetLayers === 'object' ? (assetLayers.userFacing || {}) : {};
  const groups = Array.isArray(userFacing.groups) ? userFacing.groups : [];
  const getCount = (key) => Number(groups.find((item) => item && item.key === key)?.count || 0);
  const resultCount = getCount('result');
  const previewCount = getCount('preview');
  const reviewCount = getCount('review');
  const exceptionCount = getCount('exception');
  const referenceCount = getCount('reference');
  const pendingCount = reviewCount + exceptionCount;
  const readyCount = Math.max(resultCount, previewCount);

  return {
    readyCount,
    resultCount,
    previewCount,
    reviewCount,
    exceptionCount,
    referenceCount,
    pendingCount,
    headline: pendingCount > 0
      ? '当前还有结果需要再收一轮'
      : (readyCount > 0 ? '已经有结果可以继续推进' : '当前还没有稳定资产可继续推进'),
    summary: pendingCount > 0
      ? '已经有一部分结果可以继续看，但最好先把异常和待复核内容集中收口。'
      : (readyCount > 0
        ? (referenceCount > 0 ? '已经有结果可继续看，同时还带着素材约束，后面更要关注一致性。' : '已经有结果可继续看，可以顺着主链往下做判断。')
        : (referenceCount > 0 ? '当前主要由参考素材在支撑这一轮任务。' : '这一轮还处在更早的准备或待开始阶段。')),
  };
}

function resolveRunTaskLabel(pageState) {
  const label = cleanLabel(pageState?.taskLabel);
  if (!label || label === '未命名任务') return '';
  return label;
}

function normalizeRuntimeSummary(runtimeSummary, fallback = {}) {
  const primary = runtimeSummary && typeof runtimeSummary === 'object' ? runtimeSummary : null;
  const secondary = fallback && typeof fallback === 'object' ? fallback : {};
  if (!primary && !secondary) return null;
  const normalized = normalizeRuntimeProtocolState(primary || {}, secondary);
  return {
    outputDir: normalized.outputDir || null,
    taskLabel: cleanLabel(normalized.taskLabel) || '未命名任务',
    currentStatus: cleanLabel(normalized.currentStatus) || null,
    currentStage: cleanLabel(normalized.currentStage) || null,
    currentBatch: normalized.currentBatch ?? null,
    completedBatchCount: Number(normalized.completedBatchCount ?? 0),
    pendingBatchCount: Number(normalized.pendingBatchCount ?? 0),
    totalBatchCount: Number(normalized.totalBatchCount ?? 0),
    failedCount: Number(normalized.failedCount ?? secondary.failedCount ?? secondary.failed ?? 0),
    successCount: Number(normalized.successCount ?? secondary.successCount ?? secondary.success ?? 0),
    skippedCount: Number(normalized.skippedCount ?? secondary.skippedCount ?? secondary.skipped ?? 0),
    progressSummary: cleanLabel(normalized.progressSummary) || '',
    updatedAt: normalized.updatedAt || null,
    runningTask: cleanLabel(normalized.runningTask) || cleanLabel(normalized.taskLabel) || '未命名任务',
    nextSuggestedAction: normalized.nextSuggestedAction && typeof normalized.nextSuggestedAction === 'object'
      ? normalized.nextSuggestedAction
      : null,
    unifiedStatus: normalized.unifiedStatus && typeof normalized.unifiedStatus === 'object'
      ? normalized.unifiedStatus
      : null,
    copilotSummary: normalized.copilotSummary && typeof normalized.copilotSummary === 'object'
      ? normalized.copilotSummary
      : null,
    dialogueStatus: normalized.dialogueStatus && typeof normalized.dialogueStatus === 'object'
      ? normalized.dialogueStatus
      : null,
    runtimeWorkflow: normalized.runtimeWorkflow && typeof normalized.runtimeWorkflow === 'object'
      ? normalized.runtimeWorkflow
      : null,
    runtimeCopilotProtocol: normalized.runtimeCopilotProtocol && typeof normalized.runtimeCopilotProtocol === 'object'
      ? normalized.runtimeCopilotProtocol
      : null,
    liveCopilotDirective: normalized.liveCopilotDirective && typeof normalized.liveCopilotDirective === 'object'
      ? normalized.liveCopilotDirective
      : null,
    workflowDialogue: normalized.workflowDialogue && typeof normalized.workflowDialogue === 'object'
      ? normalized.workflowDialogue
      : null,
    sourceFiles: normalized.sourceFiles || {},
  };
}

function normalizeLiveRunSnapshot(rawLiveRun, fallback = {}) {
  const runtimeSummary = normalizeRuntimeSummary(rawLiveRun, fallback);
  if (!runtimeSummary || !runtimeSummary.currentStatus) return null;
  const liveRunBundle = buildLiveRunStateBundle({
    runtimeSummary,
    fallback,
  });
  return {
    outputDir: runtimeSummary.outputDir || fallback.outputDir || null,
    taskLabel: runtimeSummary.taskLabel || fallback.taskLabel || '未命名任务',
    currentStatus: runtimeSummary.currentStatus,
    currentStage: runtimeSummary.currentStage || null,
    currentBatch: runtimeSummary.currentBatch ?? null,
    completedBatchCount: Number(runtimeSummary.completedBatchCount || 0),
    pendingBatchCount: Number(runtimeSummary.pendingBatchCount || 0),
    totalBatchCount: Number(runtimeSummary.totalBatchCount || 0),
    failedCount: Number(runtimeSummary.failedCount || fallback.failedCount || fallback.failed || 0),
    successCount: Number(runtimeSummary.successCount || fallback.successCount || fallback.success || 0),
    skippedCount: Number(runtimeSummary.skippedCount || fallback.skippedCount || fallback.skipped || 0),
    progressSummary: liveRunBundle.progressSummary,
    updatedAt: runtimeSummary.updatedAt || fallback.latestEventTime || fallback.generatedAt || new Date().toISOString(),
    runningTask: liveRunBundle.runningTask,
    nextSuggestedAction: liveRunBundle.nextSuggestedAction,
    unifiedStatus: liveRunBundle.unifiedStatus,
    copilotSummary: runtimeSummary.copilotSummary || liveRunBundle.copilotSummary || null,
    dialogueStatus: runtimeSummary.dialogueStatus || null,
    runtimeWorkflow: runtimeSummary.runtimeWorkflow || null,
    runtimeCopilotProtocol: runtimeSummary.runtimeCopilotProtocol || liveRunBundle.runtimeCopilotProtocol || null,
    liveCopilotDirective: runtimeSummary.liveCopilotDirective || liveRunBundle.liveCopilotDirective || null,
    workflowDialogue: runtimeSummary.workflowDialogue || null,
    sourceFiles: runtimeSummary.sourceFiles || fallback.sourceFiles || {},
  };
}

function enrichRunItem(item) {
  const outputDir = path.resolve(item.outputDir || '');
  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || null;
  const workspaceTimeline = workbenchState.workspaceTimeline || pageState?.timeline || null;
  const runtimeSummary = normalizeRuntimeSummary(pageState?.runtimeSummary, item);
  const promptItems = pickPromptItems(outputDir);
  const status = pageState?.status || null;
  const counts = pageState?.counts || null;
  const nextAction = pageState?.nextAction || null;
  const events = Array.isArray(workspaceTimeline?.events) ? workspaceTimeline.events : [];
  const latestEvent = events.length ? events[events.length - 1] : null;
  const selectedCount = Number(counts?.selected ?? item.selectedCount ?? 0);
  const successCount = Number(counts?.success ?? item.success ?? 0);
  const failedCount = Number(counts?.failed ?? item.failed ?? 0);
  const reviewCount = Number(counts?.needsReview ?? 0);
  const base = {
    ...item,
    pageState,
    workspaceTimeline,
    promptItems,
    successCount,
    failedCount,
    reviewCount,
    selectedCount,
    latestEventTitle: cleanLabel(latestEvent?.title) || null,
    latestEventTime: latestEvent?.time || null,
  };
  const legacyStatus = inferLegacyPhase(base, promptItems);
  const explicitPhaseLabel = cleanLabel(item.phaseLabel);
  const explicitPhaseHeadline = cleanLabel(item.phaseHeadline);
  const explicitPhaseSummary = cleanLabel(item.phaseSummary);
  const explicitPhaseTone = cleanLabel(item.phaseTone);
  const explicitNextActionLabel = cleanLabel(item.nextActionLabel);
  const explicitNextActionReason = cleanLabel(item.nextActionReason);

  return {
    ...base,
    runtimeSummary,
    taskLabel: deriveTaskLabel({ ...base, taskLabel: resolveRunTaskLabel(pageState) }, outputDir),
    phaseLabel: cleanLabel(status?.phase) || explicitPhaseLabel || legacyStatus.phaseLabel,
    phaseHeadline: cleanLabel(status?.headline) || explicitPhaseHeadline || legacyStatus.phaseHeadline,
    phaseSummary: cleanLabel(status?.summary) || explicitPhaseSummary || legacyStatus.phaseSummary,
    phaseTone: cleanLabel(status?.tone) || explicitPhaseTone || legacyStatus.phaseTone,
    nextActionLabel: cleanLabel(nextAction?.label) || explicitNextActionLabel || null,
    nextActionReason: cleanLabel(nextAction?.reason) || explicitNextActionReason || legacyStatus.nextActionReason,
    artifactLayer: formatArtifactLayerSummary(pageState?.artifactGovernance),
    assetLayerSummary: summarizeUserAssetLayer(pageState?.assetLayers),
    workbenchProtocol: summarizeUserWorkbenchProtocol(pageState?.assetLayers?.userWorkbenchProtocol, {
      outputDir,
      fallbackDefaultVisibleLabels: [],
    }),
  };
}

function isSameRun(left, right) {
  if (!left || !right) return false;
  return path.resolve(left.outputDir || '') === path.resolve(right.outputDir || '');
}

function buildTaskCenterWorkbench(latest, latestWorkspace, examplesCatalogPath) {
  if (!latest) return null;
  const entryActions = resolveEntryMainlineActions({ hasWorkspace: Boolean(latestWorkspace), latestWorkspace });
  const assetLayerSummary = latest.assetLayerSummary || summarizeUserAssetLayer();
  const workbenchProtocol = latest.workbenchProtocol || summarizeUserWorkbenchProtocol();
  const hasWorkbenchProtocol = workbenchProtocol.defaultVisibleLabels.length > 0
    || Boolean(workbenchProtocol.summary)
    || Boolean(workbenchProtocol.primaryRuntimeSource);
  const hasExplicitWorkbenchProtocol = latest?.pageState?.assetLayers?.userWorkbenchProtocol
    && typeof latest.pageState.assetLayers.userWorkbenchProtocol === 'object'
    && Object.keys(latest.pageState.assetLayers.userWorkbenchProtocol).length > 0;
  return {
    title: '当前要做什么',
    copy: latest.runtimeSummary?.currentStatus === 'running'
      ? '这里只负责选任务。当前这轮正在执行中，总控页只保留继续当前任务和开始新任务两个动作。'
      : (hasExplicitWorkbenchProtocol && hasWorkbenchProtocol
        ? workbenchProtocol.taskCenterCopy
        : '这里只负责选任务。总控页只保留两个动作：开始新任务，或者继续某一轮已有任务。'),
    cards: [
      {
        label: entryActions.continueTask.label,
        value: latest.taskLabel,
        summary: `${latest.phaseLabel || '当前阶段待判断'} · ${assetLayerSummary.headline} · ${latest.nextActionReason || entryActions.continueTask.summary}`,
        file: latestWorkspace,
        cta: entryActions.continueTask.cta,
        pendingLabel: entryActions.continueTask.pendingLabel,
        tone: 'good',
      },
      {
        label: entryActions.startNewTask.label,
        value: entryActions.startNewTask.value,
        summary: entryActions.startNewTask.summary,
        file: examplesCatalogPath,
        cta: entryActions.startNewTask.cta,
        pendingLabel: entryActions.startNewTask.pendingLabel,
        tone: 'info',
      },
    ],
  };
}

function buildTaskCenterCopilotRelay(options = {}) {
  const runtimeStatus = cleanLabel(options.runtimeStatus);
  const runtimeFocus = cleanLabel(options.runtimeFocus);
  const progressSummary = cleanLabel(options.progressSummary);
  const primarySay = cleanLabel(options.primarySay) || '进入工作台后，按页面推荐回复继续。';
  const nextActionLabel = cleanLabel(options.nextActionLabel) || '进入工作台首页';
  const handoffRule = cleanLabel(options.handoffRule);
  const optionalPageMode = options.optionalPageMode && typeof options.optionalPageMode === 'object'
    ? options.optionalPageMode
    : summarizeOptionalPageEmission({
      optionalPageMode: options.optionalPageMode || 'mainline-only',
    });
  const generationMode = cleanLabel(optionalPageMode.label) || '主链极简模式';
  const generationRule = cleanLabel(optionalPageMode.currentFocus)
    || '默认只沿主链工作台继续，细页按需打开。';
  const deepDiveRule = cleanLabel(optionalPageMode.deepDiveSuggestion)
    || '如果需要深看，再展开对应补充页。';
  const defaultGenerationProtocol = buildTaskCenterDefaultGenerationProtocol(optionalPageMode);
  const generationContract = buildTaskCenterGenerationContractSnapshot(optionalPageMode);
  const relayCopy = buildRuntimeCopilotRelayCopy({
    runtimeStatus,
    runtimeFocus,
    progressSummary,
    nextActionLabel,
    failedCount: options.failedCount,
  });
  const watch = relayCopy.watch;
  const handoff = runtimeStatus ? relayCopy.handoff : (handoffRule || relayCopy.handoff);

  return {
    title: '实时副驾驶接力',
    status: runtimeStatus || 'static',
    watch,
    reply: primarySay,
    handoff,
    generationMode: optionalPageMode.mode || 'mainline-only',
    generationLabel: generationMode,
    generationRule,
    deepDiveRule,
    defaultGenerationProtocol,
    generationContract,
    flowMode: relayCopy.mode,
    currentLookValue: relayCopy.currentLookValue,
    currentLookSummary: relayCopy.currentLookSummary,
    summary: `实时副驾驶：${watch} 对话框可以说「${primarySay}」。${handoff} 当前是${generationMode}：${generationRule} ${deepDiveRule}`,
  };
}

function buildTaskCenterDefaultGenerationProtocol(optionalPageMode = {}) {
  const protocol = optionalPageMode?.defaultGenerationProtocol && typeof optionalPageMode.defaultGenerationProtocol === 'object'
    ? optionalPageMode.defaultGenerationProtocol
    : {};
  const mode = cleanLabel(protocol.mode || optionalPageMode?.mode) || 'mainline-only';
  return resolveEntryDefaultGenerationProtocol(protocol, {
    mode,
  });
}

function buildTaskCenterGenerationContractSnapshot(optionalPageMode = {}) {
  const contract = optionalPageMode?.generationContract && typeof optionalPageMode.generationContract === 'object'
    ? optionalPageMode.generationContract
    : summarizeOptionalPageEmission({
      optionalPageMode: optionalPageMode?.mode || 'mainline-only',
    }).generationContract;
  const currentMode = contract?.currentMode && typeof contract.currentMode === 'object'
    ? contract.currentMode
    : {};
  return {
    version: Number(contract?.version || 1),
    defaultMode: cleanLabel(contract?.defaultMode) || 'mainline-only',
    targetMode: cleanLabel(contract?.targetMode) || 'single-workbench-mainline',
    principle: cleanLabel(contract?.principle)
      || '默认只生成单一主链工作台和少量必要入口；深看页、旧说明页、诊断归档和程序状态文件不进入普通用户默认阅读层。',
    currentMode: {
      mode: cleanLabel(currentMode.mode || optionalPageMode?.mode) || 'mainline-only',
      generatedHtmlFiles: Array.isArray(currentMode.generatedHtmlFiles)
        ? currentMode.generatedHtmlFiles.slice()
        : [],
      hiddenHtmlFiles: Array.isArray(currentMode.hiddenHtmlFiles)
        ? currentMode.hiddenHtmlFiles.slice()
        : [],
      userFocus: cleanLabel(currentMode.userFocus || optionalPageMode?.currentFocus)
        || '普通用户只沿任务总控和四站工作台继续，不需要默认打开深看页。',
    },
    defaultGenerationGuardrail: contract?.defaultGenerationGuardrail && typeof contract.defaultGenerationGuardrail === 'object'
      ? { ...contract.defaultGenerationGuardrail }
      : {},
    reductionRule: cleanLabel(contract?.reductionRule)
      || '默认生成先收成主链，新增页面必须先证明能帮助用户做判断，否则进入按需层或内部层。',
  };
}

function buildTaskCenterMainlineGuide(latest, latestWorkspace, examplesCatalogPath, liveRun = null) {
  const entryActions = resolveEntryMainlineActions({ hasWorkspace: Boolean(latestWorkspace), latestWorkspace });
  const workbenchProtocol = latest?.workbenchProtocol || summarizeUserWorkbenchProtocol({}, {
    outputDir: latest?.outputDir || '',
  });
  const hasLatestWorkspace = Boolean(latest && latestWorkspace);
  const runtimeProtocol = liveRun?.runtimeCopilotProtocol && typeof liveRun.runtimeCopilotProtocol === 'object'
    ? liveRun.runtimeCopilotProtocol
    : {};
  const liveDirective = liveRun?.liveCopilotDirective && typeof liveRun.liveCopilotDirective === 'object'
    ? liveRun.liveCopilotDirective
    : {};
  const runtimeStatus = cleanLabel(liveRun?.currentStatus || runtimeProtocol.status || '');
  const failedCount = Number(liveRun?.failedCount ?? liveRun?.runtimeSummary?.failedCount ?? latest?.failedCount ?? latest?.failed ?? 0);
  const progressSummary = cleanLabel(liveRun?.progressSummary)
    || cleanLabel(runtimeProtocol.progressSummary)
    || cleanLabel(latest?.phaseSummary)
    || cleanLabel(latest?.nextActionReason)
    || '当前还没有可继续的历史任务。';
  const nextActionLabel = cleanLabel(liveDirective.nextActionLabel || liveDirective.nextAction?.label)
    || cleanLabel(liveRun?.nextSuggestedAction?.label)
    || cleanLabel(runtimeProtocol.nextActionLabel)
    || cleanLabel(latest?.nextActionLabel)
    || (hasLatestWorkspace ? '进入工作台首页' : '从中文模板展示板开始');
  const primarySay = cleanLabel(liveDirective.recommendedReply || liveDirective.primarySay)
    || cleanLabel(liveRun?.dialogueStatus?.primarySay)
    || cleanLabel(liveRun?.copilotSummary?.recommendedReply)
    || cleanLabel(runtimeProtocol.primarySay)
    || cleanLabel(runtimeProtocol.dialogueFocus)
    || cleanLabel(liveRun?.unifiedStatus?.recommendedReply)
    || '进入工作台后，按页面推荐回复继续。';
  const runtimeFocus = cleanLabel(runtimeProtocol.userFocus)
    || (runtimeStatus === 'running'
      ? '先看进度，不需要切换页面做判断。'
      : (runtimeStatus === 'paused'
        ? '先处理暂停原因，再回到主链继续。'
        : (runtimeStatus === 'completed' ? '先进入结果工作台筛图和收口。' : progressSummary)));
  const handoffRule = cleanLabel(runtimeProtocol.handoffRule)
    || '任务总控负责入口选择；进入单轮任务后，由工作台首页和实时副驾驶接住下一步。';
  const optionalPageMode = latest?.pageState?.optionalPageMode && typeof latest.pageState.optionalPageMode === 'object'
    ? latest.pageState.optionalPageMode
    : summarizeOptionalPageEmission({
      optionalPageMode: latest?.optionalPageMode || latest?.pageState?.optionalPageMode?.mode || 'mainline-only',
    });
  const defaultGenerationProtocol = buildTaskCenterDefaultGenerationProtocol(optionalPageMode);
  const generationContract = buildTaskCenterGenerationContractSnapshot(optionalPageMode);
  const copilotRelay = buildTaskCenterCopilotRelay({
    runtimeStatus,
    runtimeFocus,
    progressSummary,
    primarySay,
    nextActionLabel,
    handoffRule,
    optionalPageMode,
    failedCount,
  });
  const currentLookValue = copilotRelay.currentLookValue || nextActionLabel;
  const currentLookSummary = copilotRelay.currentLookSummary || (runtimeStatus
    ? `${runtimeFocus} ${progressSummary}`.trim()
    : progressSummary);

  return {
    title: '入口主链提醒',
    copy: '任务总控只负责两件事：开新任务，或继续某一轮任务。选定后就交给工作台首页，不在这里展开单轮细节。',
    principle: workbenchProtocol.taskCenterCopy || '默认先从工作台首页进入，再顺着准备、结果、异常三站推进。',
    runtimeMode: runtimeStatus || 'static',
    runtimeFocus,
    handoffRule,
    optionalPageMode,
    defaultGenerationProtocol,
    generationContract,
    copilotRelay,
    items: [
      {
        label: '从哪里进',
        value: hasLatestWorkspace ? '先打开工作台首页' : '先打开中文模板展示板',
        summary: hasLatestWorkspace
          ? `${latest.taskLabel || '当前任务'} 已经有主入口，先点进这轮工作台。`
          : '当前还没有历史任务，先从模板展示板选择任务类型。',
        file: hasLatestWorkspace ? latestWorkspace : examplesCatalogPath,
        cta: hasLatestWorkspace ? entryActions.openWorkspaceHome.cta : entryActions.startNewTask.cta,
        tone: hasLatestWorkspace ? 'good' : 'info',
      },
      {
        label: '现在看什么',
        value: currentLookValue,
        summary: currentLookSummary,
        file: hasLatestWorkspace ? latestWorkspace : examplesCatalogPath,
        cta: hasLatestWorkspace ? entryActions.continueTask.cta : entryActions.startNewTask.cta,
        tone: runtimeStatus === 'paused' ? 'warn' : (runtimeStatus === 'completed' ? 'good' : 'info'),
      },
      {
        label: '对话框怎么回',
        value: primarySay,
        summary: handoffRule,
        tone: 'neutral',
        hideLinkIfMissing: true,
      },
    ],
  };
}

function summarizeLiveRun(item) {
  return normalizeLiveRunSnapshot(item?.runtimeSummary, item);
}

function buildTaskCenterMarkdownLines(options = {}) {
  const runs = Array.isArray(options.runs) ? options.runs : [];
  const recent = Array.isArray(options.recent) ? options.recent : runs.slice(0, 100);
  const latest = options.latest || null;
  const liveRun = options.liveRun || null;
  const stableCount = Number(options.stableCount || 0);
  const issueCount = Number(options.issueCount || 0);
  const entryMainlineGuide = options.entryMainlineGuide && typeof options.entryMainlineGuide === 'object'
    ? options.entryMainlineGuide
    : {};
  const defaultGenerationProtocol = entryMainlineGuide.defaultGenerationProtocol && typeof entryMainlineGuide.defaultGenerationProtocol === 'object'
    ? entryMainlineGuide.defaultGenerationProtocol
    : {};
  const generationContract = entryMainlineGuide.generationContract && typeof entryMainlineGuide.generationContract === 'object'
    ? entryMainlineGuide.generationContract
    : {};
  const hiddenHtmlFiles = Array.isArray(defaultGenerationProtocol.hiddenHtmlFiles)
    ? defaultGenerationProtocol.hiddenHtmlFiles
    : (Array.isArray(generationContract.currentMode?.hiddenHtmlFiles) ? generationContract.currentMode.hiddenHtmlFiles : []);
  const generatedHtmlFiles = Array.isArray(defaultGenerationProtocol.generatedHtmlFiles)
    ? defaultGenerationProtocol.generatedHtmlFiles
    : (Array.isArray(generationContract.currentMode?.generatedHtmlFiles) ? generationContract.currentMode.generatedHtmlFiles : []);
  const hiddenSummary = hiddenHtmlFiles.length
    ? `默认隐藏高级页: ${hiddenHtmlFiles.slice(0, 8).join('、')}${hiddenHtmlFiles.length > 8 ? ' 等' : ''}`
    : '默认隐藏高级页: 无';
  const generatedSummary = generatedHtmlFiles.length
    ? `默认生成入口: ${generatedHtmlFiles.join('、')}`
    : '默认生成入口: 任务总控和工作台主链';

  return [
    '# DAOGE 任务索引',
    '',
    '这份索引只负责跨轮回看和挑任务，不负责单轮判断。想看一轮任务内部情况，进入那一轮工作台首页或任务档案。',
    '',
    '## 1. 当前概况',
    '',
    `- 最近记录轮数: ${runs.length}`,
    `- 整体稳定轮数: ${stableCount}`,
    `- 存在异常轮数: ${issueCount}`,
    `- 最近一轮: ${latest ? latest.taskLabel : '暂无记录'}`,
    ...(liveRun ? [
      `- 当前状态: ${latest.phaseLabel || '执行中'}`,
      `- 当前进度: ${liveRun.progressSummary || '当前正在刷新状态中。'}`,
    ] : []),
    '',
    '## 2. 入口主链协议',
    '',
    `- 当前入口层: ${entryMainlineGuide.title || '入口主链提醒'}`,
    `- 任务总控职责: ${entryMainlineGuide.copy || '任务总控只负责开新任务或继续任务，选定后交给工作台首页。'}`,
    `- 单轮判断归属: ${entryMainlineGuide.principle || '默认先从工作台首页进入，再顺着准备、结果、异常三站推进。'}`,
    `- 实时副驾驶: ${entryMainlineGuide.copilotRelay?.summary || '进入工作台后，按页面推荐回复继续。'}`,
    `- 默认生成模式: ${defaultGenerationProtocol.mode || generationContract.currentMode?.mode || 'mainline-only'}`,
    `- ${generatedSummary}`,
    `- ${hiddenSummary}`,
    `- 生成守卫: ${defaultGenerationProtocol.guardrail?.onDemandRule || generationContract.defaultGenerationGuardrail?.onDemandRule || '提示词预览、素材页、审阅看板、运行概览和补跑页必须按需开启，不作为默认入口。'}`,
    '',
    '## 3. 最近任务',
    '',
    ...(recent.length
      ? recent.map((item) => {
          const status = Number(item.failedCount || 0) > 0
            ? `有 ${item.failedCount} 个失败项`
            : (Number(item.successCount || 0) > 0 ? '整体稳定' : '结果较少');
          return `- ${formatTime(item.generatedAt)} | ${item.taskLabel} | ${status} | 成功 ${item.successCount}/${item.selectedCount || item.successCount || 0} | 输出目录 ${item.outputDir}`;
        })
      : ['- 当前还没有任务记录。']),
    '',
    '## 4. 使用方式',
    '',
    '- 想继续最近一轮：回任务总控或直接打开那一轮工作台首页',
    '- 想看单轮细节：进入那一轮任务档案',
    '- 想比较多轮状态：只在这里横向看，不在这里做单轮判断',
  ];
}

function buildTaskCenterState(indexFile, options = {}) {
  const rootDir = path.dirname(path.resolve(indexFile));
  const runs = mergeLiveRun(loadRuns(indexFile), options.liveRun).map(enrichRunItem);
  const decoratedRuns = runs.map((item, index) => ({
    item,
    index,
    bucket: classifyRun(item, index),
  }));
  const latest = decoratedRuns[0]?.item || null;
  const liveRun = summarizeLiveRun(latest);
  const stableCount = decoratedRuns.filter(({ item }) => Number(item.failedCount || 0) === 0).length;
  const issueCount = decoratedRuns.filter(({ item }) => Number(item.failedCount || 0) > 0 || Number(item.reviewCount || 0) > 0).length;
  const activeCount = decoratedRuns.filter(({ bucket }) => bucket === 'active').length;
  const otherRuns = [
    ...decoratedRuns.filter(({ bucket, item }) => bucket === 'priority' && !isSameRun(item, latest)),
    ...decoratedRuns.filter(({ bucket, item }) => bucket === 'active' && !isSameRun(item, latest)),
    ...decoratedRuns.filter(({ bucket, item }) => bucket === 'stable' && !isSameRun(item, latest)),
  ].map(({ item, bucket }) => ({ ...item, bucket }));
  const latestWorkspace = latest ? resolveRecommendedWorkspacePath(latest.outputDir, 'workspace_home.html', 'workspace').recommendedPath : null;
  const latestRecord = latest ? path.join(latest.outputDir, 'run_record.html') : null;
  const examplesCatalogPath = options.examplesCatalogPath || path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html');
  const recent = runs.slice(0, 100);
  const taskCenterWorkbench = buildTaskCenterWorkbench(latest, latestWorkspace, examplesCatalogPath);
  const entryMainlineGuide = buildTaskCenterMainlineGuide(latest, latestWorkspace, examplesCatalogPath, liveRun);
  const workbenchProtocol = latest?.workbenchProtocol || summarizeUserWorkbenchProtocol({}, {
    outputDir: latest?.outputDir || '',
  });
  const markdownLines = buildTaskCenterMarkdownLines({
    runs,
    recent,
    latest,
    liveRun,
    stableCount,
    issueCount,
    entryMainlineGuide,
  });

  return {
    schemaVersion: 1,
    kind: 'daoge-task-center-state',
    role: 'task-center-derived-state',
    generatedAt: new Date().toISOString(),
    rootDir,
    stateSources: {
      runIndex: path.resolve(indexFile),
      examplesCatalog: examplesCatalogPath,
      unifiedState: resolveUnifiedTaskCenterStatePath(indexFile, options),
      canonicalState: resolveTaskCenterStatePath(indexFile, options),
    },
    runs,
    decoratedRuns,
    latest,
    latestWorkspace,
    latestRecord,
    examplesCatalogPath,
    liveRun,
    currentStatus: liveRun?.currentStatus || null,
    currentStage: liveRun?.currentStage || null,
    currentBatch: liveRun?.currentBatch ?? null,
    completedBatchCount: liveRun?.completedBatchCount ?? null,
    pendingBatchCount: liveRun?.pendingBatchCount ?? null,
    totalBatchCount: liveRun?.totalBatchCount ?? null,
    progressSummary: liveRun?.progressSummary || null,
    updatedAt: liveRun?.updatedAt || new Date().toISOString(),
    runningTask: liveRun?.runningTask || null,
    nextSuggestedAction: liveRun?.nextSuggestedAction || null,
    unifiedStatus: liveRun?.unifiedStatus || null,
    copilotSummary: liveRun?.copilotSummary || null,
    dialogueStatus: liveRun?.dialogueStatus || null,
    runtimeWorkflow: liveRun?.runtimeWorkflow || null,
    runtimeCopilotProtocol: liveRun?.runtimeCopilotProtocol || null,
    liveCopilotDirective: liveRun?.liveCopilotDirective || null,
    workflowDialogue: liveRun?.workflowDialogue || null,
    stableCount,
    issueCount,
    activeCount,
    totalRuns: runs.length,
    otherRuns,
    taskCenterWorkbench,
    entryMainlineGuide,
    workbenchProtocol,
    markdownLines,
  };
}

function normalizeTaskCenterState(snapshot, indexFile, options = {}) {
  const rootDir = path.dirname(path.resolve(indexFile));
  const examplesCatalogPath = options.examplesCatalogPath || snapshot.examplesCatalogPath || path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html');
  const runs = Array.isArray(snapshot.runs) ? snapshot.runs : [];
  const latest = snapshot.latest && typeof snapshot.latest === 'object' ? snapshot.latest : (runs[0] || null);
  const latestWorkspace = snapshot.latestWorkspace || (latest?.outputDir ? resolveRecommendedWorkspacePath(latest.outputDir, 'workspace_home.html', 'workspace').recommendedPath : null);
  const latestRecord = snapshot.latestRecord || (latest?.outputDir ? path.join(latest.outputDir, 'run_record.html') : null);
  const otherRuns = Array.isArray(snapshot.otherRuns) ? snapshot.otherRuns : [];
  const stableCount = Number(snapshot.stableCount ?? runs.filter((item) => Number(item?.failedCount || 0) === 0).length);
  const issueCount = Number(snapshot.issueCount ?? runs.filter((item) => Number(item?.failedCount || 0) > 0 || Number(item?.reviewCount || 0) > 0).length);
  const activeCount = Number(snapshot.activeCount ?? runs.filter((item) => item?.bucket === 'active').length);
  const liveRun = snapshot.liveRun && typeof snapshot.liveRun === 'object'
    ? normalizeLiveRunSnapshot(snapshot.liveRun, latest || snapshot)
    : summarizeLiveRun(latest);
  const normalizedRuntime = normalizeRuntimeProtocolState({
    currentStatus: snapshot.currentStatus || liveRun?.currentStatus || null,
    currentStage: snapshot.currentStage || liveRun?.currentStage || null,
    runningTask: snapshot.runningTask || liveRun?.runningTask || null,
    progressSummary: snapshot.progressSummary || liveRun?.progressSummary || null,
    nextSuggestedAction: snapshot.nextSuggestedAction || liveRun?.nextSuggestedAction || null,
    unifiedStatus: snapshot.unifiedStatus || liveRun?.unifiedStatus || null,
    copilotSummary: snapshot.copilotSummary || liveRun?.copilotSummary || null,
    dialogueStatus: snapshot.dialogueStatus || liveRun?.dialogueStatus || null,
    runtimeWorkflow: snapshot.runtimeWorkflow || liveRun?.runtimeWorkflow || null,
    runtimeCopilotProtocol: snapshot.runtimeCopilotProtocol || liveRun?.runtimeCopilotProtocol || null,
    liveCopilotDirective: snapshot.liveCopilotDirective || liveRun?.liveCopilotDirective || null,
    workflowDialogue: snapshot.workflowDialogue || liveRun?.workflowDialogue || null,
  }, latest || {});
  const workbenchProtocol = snapshot.workbenchProtocol && typeof snapshot.workbenchProtocol === 'object'
    ? snapshot.workbenchProtocol
    : (latest?.workbenchProtocol || summarizeUserWorkbenchProtocol({}, {
      outputDir: latest?.outputDir || '',
    }));
  const taskCenterWorkbench = snapshot.taskCenterWorkbench || buildTaskCenterWorkbench(latest, latestWorkspace, examplesCatalogPath);
  const entryMainlineGuide = snapshot.entryMainlineGuide || buildTaskCenterMainlineGuide(latest, latestWorkspace, examplesCatalogPath, liveRun);
  const shouldRefreshMarkdown = !Array.isArray(snapshot.markdownLines)
    || !snapshot.markdownLines.some((line) => /入口主链协议/.test(String(line || '')));
  const markdownLines = shouldRefreshMarkdown
    ? buildTaskCenterMarkdownLines({
      runs,
      recent: runs.slice(0, 100),
      latest,
      liveRun,
      stableCount,
      issueCount,
      entryMainlineGuide,
    })
    : snapshot.markdownLines;

  return {
    ...snapshot,
    schemaVersion: Number(snapshot.schemaVersion || 1),
    kind: String(snapshot.kind || 'daoge-task-center-state'),
    role: String(snapshot.role || 'task-center-derived-state'),
    generatedAt: String(snapshot.generatedAt || '').trim() || new Date().toISOString(),
    rootDir,
    stateSources: {
      unifiedState: resolveUnifiedTaskCenterStatePath(indexFile, options),
      canonicalState: resolveTaskCenterStatePath(indexFile, options),
      runIndex: path.resolve(indexFile),
      examplesCatalog: examplesCatalogPath,
      ...(snapshot.stateSources && typeof snapshot.stateSources === 'object' ? snapshot.stateSources : {}),
    },
    runs,
    latest,
    latestWorkspace,
    latestRecord,
    examplesCatalogPath,
    liveRun,
    currentStatus: snapshot.currentStatus || liveRun?.currentStatus || null,
    currentStage: snapshot.currentStage || liveRun?.currentStage || null,
    currentBatch: snapshot.currentBatch ?? liveRun?.currentBatch ?? null,
    completedBatchCount: snapshot.completedBatchCount ?? liveRun?.completedBatchCount ?? null,
    pendingBatchCount: snapshot.pendingBatchCount ?? liveRun?.pendingBatchCount ?? null,
    totalBatchCount: snapshot.totalBatchCount ?? liveRun?.totalBatchCount ?? null,
    progressSummary: snapshot.progressSummary || liveRun?.progressSummary || null,
    updatedAt: snapshot.updatedAt || liveRun?.updatedAt || String(snapshot.generatedAt || '').trim() || new Date().toISOString(),
    runningTask: snapshot.runningTask || liveRun?.runningTask || null,
    nextSuggestedAction: snapshot.nextSuggestedAction || liveRun?.nextSuggestedAction || normalizedRuntime.nextSuggestedAction || null,
    workbenchProtocol,
    unifiedStatus: snapshot.unifiedStatus || liveRun?.unifiedStatus || normalizedRuntime.unifiedStatus || null,
    copilotSummary: snapshot.copilotSummary || liveRun?.copilotSummary || normalizedRuntime.copilotSummary || null,
    dialogueStatus: snapshot.dialogueStatus || liveRun?.dialogueStatus || normalizedRuntime.dialogueStatus || null,
    runtimeWorkflow: snapshot.runtimeWorkflow || liveRun?.runtimeWorkflow || normalizedRuntime.runtimeWorkflow || null,
    runtimeCopilotProtocol: snapshot.runtimeCopilotProtocol || liveRun?.runtimeCopilotProtocol || normalizedRuntime.runtimeCopilotProtocol || null,
    liveCopilotDirective: snapshot.liveCopilotDirective || liveRun?.liveCopilotDirective || normalizedRuntime.liveCopilotDirective || null,
    workflowDialogue: snapshot.workflowDialogue || liveRun?.workflowDialogue || normalizedRuntime.workflowDialogue || null,
    stableCount,
    issueCount,
    activeCount,
    totalRuns: Number(snapshot.totalRuns ?? runs.length),
    otherRuns,
    taskCenterWorkbench,
    entryMainlineGuide,
    markdownLines,
  };
}

function loadTaskCenterState(indexFile, options = {}) {
  const unifiedStatePath = resolveUnifiedTaskCenterStatePath(indexFile, options);
  if (fileExists(unifiedStatePath)) {
    const snapshot = readJsonIfExists(unifiedStatePath);
    if (snapshot && typeof snapshot === 'object') {
      return normalizeTaskCenterState(snapshot, indexFile, options);
    }
  }
  const statePath = resolveTaskCenterStatePath(indexFile, options);
  if (fileExists(statePath)) {
    const snapshot = readJsonIfExists(statePath);
    if (snapshot && typeof snapshot === 'object') {
      return normalizeTaskCenterState(snapshot, indexFile, options);
    }
  }
  return buildTaskCenterState(indexFile, options);
}

function renderRunCardModel(item, rootDir, options = {}) {
  const workspace = resolveRecommendedWorkspacePath(item.outputDir, 'workspace_home.html', 'workspace').recommendedPath;
  const compatibilityWorkspace = path.join(item.outputDir, 'workspace_home.html');
  const record = path.join(item.outputDir, 'run_record.html');
  const href = fileExists(workspace)
    ? path.relative(rootDir, workspace)
    : (fileExists(record) ? path.relative(rootDir, record) : null);
  const summary = String(
    item.nextActionReason
    || item.phaseSummary
    || item.assetLayerSummary?.summary
    || '当前任务状态已由统一工作台接管。'
  ).trim();
  return {
    kicker: options.kicker,
    title: `${item.taskLabel} · ${item.phaseLabel || '任务记录'}`,
    copy: `${formatTime(item.latestEventTime || item.generatedAt)} · ${summary}`,
    href,
    cta: href && (fileExists(workspace) || fileExists(compatibilityWorkspace)) ? '继续这轮任务' : '查看任务档案',
    tone: item.phaseTone || 'info',
  };
}

module.exports = {
  buildTaskCenterState,
  buildTaskCenterMainlineGuide,
  buildTaskCenterCopilotRelay,
  buildTaskCenterWorkbench,
  classifyRun,
  enrichRunItem,
  formatArtifactLayerSummary,
  formatTime,
  inferLegacyPhase,
  isSameRun,
  loadTaskCenterState,
  loadRuns,
  renderRunCardModel,
  resolveTaskCenterStatePath,
  resolveUnifiedTaskCenterStatePath,
  resolveRunTaskLabel,
};
