const path = require('path');
const {
  parseArgs,
  readJson,
  readJsonIfExists,
  writeJson,
  fileExists,
} = require('./script_utils');
const {
  buildCanonicalWorkbenchAssets,
  buildWorkbenchStateSnapshot,
  normalizeWorkbenchAssets,
  resolveUnifiedWorkbenchStatePath,
} = require('./workbench_state_shared');
const { deriveTaskLabel } = require('./task_label_utils');
const { buildRuntimeStateSnapshot } = require('./runtime_state_snapshot');
const { buildUnifiedStatusSummary, buildStageUnifiedStatus, buildStageUiUnifiedStatus } = require('./unified_status_summary');
const { getWorkspaceDenseCopy } = require('./workspace_dense_copy');
const {
  getLegacyPageEntries,
} = require('./workspace_page_registry');
const {
  inferStoryboardSpecialization,
  shouldShowStoryboardPage,
} = require('./workspace_storyboard_shared');
const {
  buildGovernanceSnapshot,
  buildGovernanceSnapshotMap,
} = require('./workbench_governance');
const {
  buildTaskCenterEntryProtocol,
  resolveEntryMainlineProtocol,
} = require('./entry_state_shared');
const {
  getWorkspacePageShellConfig,
  buildWorkspaceAdvancedSectionData,
  buildWorkspaceAssetsSectionData,
  buildWorkspaceDirectionSectionData,
  buildWorkspaceGuideSectionData,
  buildWorkspaceIssuesSectionData,
  buildWorkspacePreviewSectionData,
  buildWorkspaceReadinessSectionData,
  buildWorkspaceCollaborationSectionData,
  buildWorkspaceDecisionSectionData,
  buildWorkspaceDecisionItems,
  buildWorkspaceRouteSectionData,
  buildWorkspaceSummarySectionData,
  buildWorkspaceWorkbenchSectionData,
  buildWorkspaceContentSectionPlan,
} = require('./workspace_page_shared');
const { summarizeOptionalPageEmission } = require('./default_generation_contract');
const { resolveProfile, buildDisplayDistributions } = require('./template_display_profile');
const {
  buildHomeDecisionSummary,
  buildHomeTaskConclusion,
  buildHomeCurrentFocus,
  buildHomeStaticStageCopy,
  buildHomeFlowCompletion,
  buildStageRunScaleLabel,
  buildPrepareReadinessDetail,
  buildPrepareStaticStageCopy,
  buildPrepareFlowCompletion,
  buildResultStatusLabel,
  buildResultStatusSummary,
  buildResultNextStepReason,
  buildResultStaticStageCopy,
  buildResultFlowCompletion,
  buildExceptionStatusLabel,
  buildExceptionStatusSummary,
  buildExceptionIssueSummary,
  buildExceptionStaticStageCopy,
  buildExceptionFlowCompletion,
  buildRuntimePressureCopy,
  buildRuntimeStageSummaryCopy,
  buildRuntimeRunScaleSummary,
  buildRuntimeSignalCopy,
  buildRuntimeStatusSummaryCopy,
  buildRuntimeStatusStackSummaryCopy,
  buildRuntimeDialogueValue,
  buildRuntimeNextActionLabel,
  getDefaultActionStatusCopy,
  getDefaultTransitionStatusCopy,
  getDefaultDialogueStatusCopy,
  getDefaultDialogueTitles,
  getWorkspaceInteractionTemplates,
  getActionLanguage,
  buildNextReplyCandidates,
  buildDialogueReplyFallbacks,
  buildPrepareTransitionNextFocusItems,
  buildResultToExceptionNextFocusItems,
  buildExceptionFromResultNextFocusItems,
  buildExceptionBackToMainlineConfirmedItems,
  buildHomeConfirmationPlan,
  buildPrepareConfirmationPlan,
  buildResultConfirmationPlan,
  buildExceptionConfirmationPlan,
  buildHomeFlowPlan,
  buildPrepareFlowPlan,
  buildResultFlowPlan,
  buildExceptionFlowPlan,
  buildHomeCardPlan,
  buildPrepareCardPlan,
  buildResultCardPlan,
  buildExceptionCardPlan,
  buildHomeRoutePlan,
  buildPrepareRoutePlan,
  buildResultRoutePlan,
  buildExceptionRoutePlan,
  buildHomeWorkbenchPlan,
  buildPrepareWorkbenchPlan,
  buildResultWorkbenchPlan,
  buildExceptionWorkbenchPlan,
  buildHomeStatusStack,
  buildPrepareStatusStack,
  buildResultStatusStack,
  buildExceptionStatusStack,
  buildHomeTaskControlBar,
  buildPrepareTaskControlBar,
  buildResultTaskControlBar,
  buildExceptionTaskControlBar,
  buildHomeSignalBar,
  buildPrepareSignalBar,
  buildResultSignalBar,
  buildExceptionSignalBar,
  buildConfirmationSummary,
  getStageContinuationCopy,
  getStagePrimaryActionLabel,
} = require('./workspace_status_dictionary');
const {
  getWorkspaceStageChrome,
  getWorkspaceIdentityCopy,
} = require('./workspace_page_shared');

function topName(items, fallback = '未提供') {
  const first = toArray(items)[0];
  return String(first?.name || '').trim() || fallback;
}

function findDistribution(distributions, key) {
  return toArray(distributions).find((item) => item.key === key)?.counts || [];
}

function humanModeLabel(mode) {
  if (mode === 'prepare-only') return '准备阶段';
  if (mode === 'storyboard-board') return '分镜整板阶段';
  if (!mode) return '未检测';
  return String(mode);
}

function normalizeText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function countImportedBindings(bindings) {
  if (!bindings) return 0;
  if (Array.isArray(bindings)) return bindings.length;
  if (Array.isArray(bindings.bindings)) return bindings.bindings.length;
  if (Array.isArray(bindings.items)) return bindings.items.length;
  return 0;
}

function inferOptionalPageMode(outputDir) {
  const hasPrepareDetails = [
    path.join(outputDir, 'prompt_preview.html'),
    path.join(outputDir, 'preflight_board.html'),
    path.join(outputDir, 'assets_board.html'),
  ].some((filePath) => fileExists(filePath));
  const hasResultDetails = [
    path.join(outputDir, 'review_board.html'),
    path.join(outputDir, 'completion_board.html'),
    path.join(outputDir, 'run_overview.html'),
    path.join(outputDir, 'rerun_board.html'),
  ].some((filePath) => fileExists(filePath));
  const hasLegacyPages = [
    path.join(outputDir, 'result_hub.html'),
    path.join(outputDir, 'daoge_portal.html'),
  ].some((filePath) => fileExists(filePath));

  if (hasPrepareDetails && hasResultDetails && hasLegacyPages) return 'all';
  if (hasPrepareDetails && !hasResultDetails && !hasLegacyPages) return 'prepare-details';
  if (!hasPrepareDetails && hasResultDetails && !hasLegacyPages) return 'result-details';
  if (!hasPrepareDetails && !hasResultDetails && hasLegacyPages) return 'legacy';
  if (hasPrepareDetails && hasResultDetails) return 'all';
  if (hasPrepareDetails) return 'prepare-details';
  if (hasResultDetails) return 'result-details';
  if (hasLegacyPages) return 'legacy';
  return 'mainline-only';
}

function resolveOptionalPageMode(outputDir, manifest = {}) {
  const explicitMode = String(
    manifest.optionalPageMode
    || manifest.optional_page_mode
    || ''
  ).trim().toLowerCase();
  if (explicitMode) return explicitMode;
  return inferOptionalPageMode(outputDir);
}

function loadEntryStateSnapshot(outputDir) {
  const candidates = [
    path.join(outputDir, 'entry_state.json'),
    path.join(path.dirname(outputDir), 'entry_state.json'),
  ];
  return candidates
    .map((filePath) => readJsonIfExists(filePath))
    .find((item) => item && typeof item === 'object') || null;
}

function buildEntryBridge(entryState, routes = {}) {
  if (!entryState || typeof entryState !== 'object') return null;
  const selectedExample = entryState.selectedExample && typeof entryState.selectedExample === 'object'
    ? entryState.selectedExample
    : {};
  const entryContext = entryState.entryContext && typeof entryState.entryContext === 'object'
    ? entryState.entryContext
    : {};
  const workbench = entryState.entryWorkbench && typeof entryState.entryWorkbench === 'object'
    ? entryState.entryWorkbench
    : {};
  const route = workbench.route && typeof workbench.route === 'object'
    ? workbench.route
    : {};
  const routeCurrent = route.current && typeof route.current === 'object'
    ? route.current
    : null;
  const routeNext = route.next && typeof route.next === 'object'
    ? route.next
    : null;
  const mainlineProtocol = resolveEntryMainlineProtocol(entryState, { currentLayer: '工作台首页' });
  const nextTarget = normalizeText(
    routeNext?.file
      || routeNext?.target
      || entryState?.recommendedNextStep?.target,
    routes.prepare || ''
  );
  return {
    entryMode: normalizeText(entryState.entryMode, 'example'),
    taskCategory: normalizeText(entryState.taskCategory, '尚未选择'),
    starterIntent: normalizeText(entryState.starterIntent, '尚未选择'),
    selectedEntry: {
      id: normalizeText(selectedExample.id),
      title: normalizeText(
        routeCurrent?.label || workbench?.selectedEntry?.title || selectedExample.name,
        '当前还没有选中的入口'
      ),
      summary: normalizeText(
        routeCurrent?.summary || workbench?.selectedEntry?.summary || selectedExample.description,
        '先按任务意图开始，或者从推荐起步里挑一个最像你需求的入口。'
      ),
    },
    context: {
      runLabel: normalizeText(entryContext.runLabel, normalizeText(selectedExample.name, '当前还没有选中的入口')),
      phaseLabel: normalizeText(entryContext.phaseLabel, '入口层'),
      flowLabel: normalizeText(entryContext.flowLabel, mainlineProtocol.sequenceLabel || '中文模板展示板 -> 任务总控 -> 工作台首页 -> 准备工作台'),
      counts: Array.isArray(entryContext.counts) ? entryContext.counts : [],
      hints: Array.isArray(entryContext.hints) ? entryContext.hints : [],
    },
    mainlineProtocol,
    route: {
      title: normalizeText(route.title, '从入口层继续'),
      copy: normalizeText(route.copy, '入口层只负责选任务和选起步入口，确认后就直接进入准备工作台。'),
      current: routeCurrent ? {
        kicker: normalizeText(routeCurrent.kicker, '当前入口'),
        label: normalizeText(routeCurrent.label, normalizeText(selectedExample.name, '当前还没有选中的入口')),
        summary: normalizeText(routeCurrent.summary, normalizeText(selectedExample.description, '当前入口已经选定，可以继续进入准备工作台。')),
      } : null,
      next: {
        kicker: normalizeText(routeNext?.kicker, '建议下一步'),
        label: normalizeText(routeNext?.label || entryState?.recommendedNextStep?.label, '进入准备工作台'),
        summary: normalizeText(routeNext?.reason || routeNext?.summary || entryState?.recommendedNextStep?.reason, '先确认方向、放行和素材绑定，再决定是否继续。'),
        file: nextTarget,
        cta: normalizeText(routeNext?.cta, '继续下一步'),
        pendingLabel: normalizeText(routeNext?.pendingLabel, '当前还没有生成下一页'),
      },
    },
    workbench: workbench.workbench && typeof workbench.workbench === 'object'
      ? workbench.workbench
      : null,
  };
}

function sumObjectValues(record) {
  return Object.values(record || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function buildPrepareReadiness(validation) {
  const qualityGates = validation?.qualityGates || {};
  const errors = toArray(validation?.errors);
  const warnings = toArray(validation?.warnings);
  const blockingItems = [];
  const cautionItems = [];
  const missingCount = sumObjectValues(validation?.missing || {});
  const templateMissingCount = sumObjectValues(qualityGates.templateMissing || {});
  const duplicatePromptCount = Number(validation?.duplicatePromptCount || 0);
  const slugCollisionCount = toArray(validation?.slugCollisions).length;
  const sizeIssueCount = toArray(qualityGates.sizeIssues).length;
  const shortPromptCount = toArray(qualityGates.shortPrompts).length;
  const nearDuplicateCount = toArray(qualityGates.nearDuplicatePairs).length;

  if (!validation || !validation.ok) blockingItems.push('提示词校验还没有完全通过');
  if (errors.length) blockingItems.push(`还有 ${errors.length} 条明确错误`);
  if (missingCount > 0) blockingItems.push(`还有 ${missingCount} 个核心字段缺失`);
  if (templateMissingCount > 0) blockingItems.push(`还有 ${templateMissingCount} 个模板必填项缺失`);
  if (sizeIssueCount > 0) blockingItems.push(`还有 ${sizeIssueCount} 个尺寸问题待处理`);
  if (duplicatePromptCount > 0) blockingItems.push(`发现 ${duplicatePromptCount} 条重复提示词`);
  if (slugCollisionCount > 0) blockingItems.push(`发现 ${slugCollisionCount} 个命名冲突`);

  if (warnings.length) cautionItems.push(`当前有 ${warnings.length} 条提醒`);
  if (shortPromptCount > 0) cautionItems.push(`有 ${shortPromptCount} 条提示词偏短`);
  if (nearDuplicateCount > 0) cautionItems.push(`发现 ${nearDuplicateCount} 组近重复提示词`);

  if (blockingItems.length) {
    return {
      tone: 'bad',
      label: '先修正再开跑',
      detail: buildPrepareReadinessDetail({ tone: 'bad' }),
      blockingItems,
      cautionItems,
    };
  }
  if (cautionItems.length) {
    return {
      tone: 'warn',
      label: '可以执行，但建议再收一轮',
      detail: buildPrepareReadinessDetail({ tone: 'warn' }),
      blockingItems,
      cautionItems,
    };
  }
  return {
    tone: 'good',
    label: '可以进入执行',
    detail: buildPrepareReadinessDetail({ tone: 'good' }),
    blockingItems,
    cautionItems,
  };
}

function summarizePrepareState(outputDir, taskSpec, modeDetection, prompts, validation, batchPlan, workspaceState, workspaceAssets, referenceBindings, referenceAnalysis, options = {}) {
  const promptItems = toArray(prompts);
  const displayProfile = promptItems.length ? resolveProfile(promptItems) : null;
  const distributions = displayProfile ? buildDisplayDistributions(promptItems, displayProfile) : [];
  const readiness = buildPrepareReadiness(validation);
  const referenceAssets = readReferenceAssets(workspaceAssets);
  const importedBindingCount = referenceAssets.length
    ? referenceAssets.length
    : countImportedBindings(referenceBindings);
  const assetCount = Number(
    referenceAnalysis?.referenceCount ||
    referenceAnalysis?.assetCount ||
    referenceAssets.length ||
    toArray(referenceAnalysis?.references).length ||
    importedBindingCount ||
    0
  );
  const templateName = String(
    taskSpec.output_mode ||
    modeDetection?.detected_template?.display_name ||
    modeDetection?.detected_template?.name ||
    modeDetection?.detected_template?.id ||
    ''
  ).trim() || '未检测';
  const mainDirection = displayProfile ? topName(findDistribution(distributions, displayProfile.summaryFields[0]?.key), '未提供') : '未提供';
  const styleDirection = topName(findDistribution(distributions, 'style_family'), '未指定');
  const sceneDirection = topName(findDistribution(distributions, 'scene'), '未指定');
  const promptCount = Number(workspaceState?.counts?.selected || promptItems.length || 0);
  const batchCount = Number(workspaceState?.counts?.batches || toArray(batchPlan).length || 0);
  const prepareAction = readiness.tone === 'bad'
    ? buildActionLanguage('refine_prepare')
    : buildActionLanguage('go_result');
  const currentFocus = importedBindingCount > 0
    ? '先确认素材绑定和主体稳定'
    : '先确认方向和放行判断';
  const nextStepReason = readiness.tone === 'bad'
    ? '当前还有准备阻塞项，先把问题收干净，再继续进入结果工作台。'
    : (readiness.tone === 'warn'
      ? (importedBindingCount > 0
        ? '当前没有硬阻塞，建议带着素材绑定约束再收一轮提醒项，然后进入结果工作台。'
        : '当前没有硬阻塞，建议先收一轮提醒项，再进入结果工作台。')
      : (importedBindingCount > 0
        ? '当前准备层已经可放行，带着素材绑定约束进入结果工作台继续主链。'
        : '当前准备层已经可放行，可以直接进入结果工作台继续主链。'));
  const prepareConfirmationPlan = buildPrepareConfirmationPlan({
    tone: readiness.tone,
    importedBindingCount,
    blockingItems: toArray(readiness.blockingItems),
    actionKey: readiness.tone === 'bad' ? 'refine_prepare' : 'go_result',
  });
  const primaryAction = buildActionLanguage(readiness.tone === 'bad' ? 'refine_prepare' : 'go_result');
  const secondaryActionHints = [
    importedBindingCount > 0 ? '先确认素材绑定约束是否完整带入。' : '',
    readiness.tone === 'warn' ? '提醒项仍建议收一轮，但不再阻塞主链。' : '',
    readiness.tone === 'bad' ? '先把阻塞项清干净，再谈进入结果层。' : '',
  ].filter(Boolean);
  const transitionSummary = readiness.tone === 'bad'
    ? '准备层还没有完成交接，结果层不应提前接手判断。'
    : (importedBindingCount > 0
      ? '准备层已经带着素材绑定约束完成交接，可以进入结果层。'
      : '准备层已经完成放行交接，可以进入结果层。');
  const handoffSummary = importedBindingCount > 0
    ? `准备层会把 ${importedBindingCount} 项素材绑定约束一并交给结果层。`
    : '准备层交给结果层的重点是方向、放行结论和当前提醒项。';
  const actionLabel = prepareAction.actionLabel;
  const actionReason = nextStepReason;
  const cockpitSummary = buildPrepareCockpitSummary({
    readiness,
    currentFocus,
    nextStepReason,
  });
  const judgment = buildPrepareJudgmentPanel({
    readiness,
    currentFocus,
    nextStepLabel: actionLabel,
    nextStepReason,
    importedBindingCount,
    confirmationState: buildConfirmationState({
      currentIntent: '确认准备条件后继续执行',
      stageLabel: '准备阶段',
      stageTone: readiness.tone === 'bad' ? 'bad' : (readiness.tone === 'warn' ? 'warn' : 'good'),
      confirmedItems: [
        `模板类型: ${templateName}`,
        `任务主轴: ${mainDirection}`,
      ],
      pendingItems: prepareConfirmationPlan.pendingItems,
      blockingItems: prepareConfirmationPlan.blockingItems,
      recommendedReply: prepareConfirmationPlan.recommendedReply,
      recentEvent: options.timelinePrepareEvent,
      canContinue: readiness.tone !== 'bad',
      summary: prepareConfirmationPlan.summary,
    }),
  });
  const statusStack = buildPrepareStatusStack({
    readinessLabel: readiness.label,
    readinessDetail: readiness.detail,
    readinessTone: readiness.tone,
    hasBlocking: toArray(readiness.blockingItems).length > 0,
    nextActionLabel: actionLabel,
    nextActionSummary: actionReason,
  });
  const confirmationState = buildConfirmationState({
    currentIntent: '确认准备条件后继续执行',
    stageLabel: '准备阶段',
    stageTone: readiness.tone === 'bad' ? 'bad' : (readiness.tone === 'warn' ? 'warn' : 'good'),
    confirmedItems: [
      `模板类型: ${templateName}`,
      `任务主轴: ${mainDirection}`,
    ],
    pendingItems: prepareConfirmationPlan.pendingItems,
    blockingItems: prepareConfirmationPlan.blockingItems,
    recommendedReply: prepareConfirmationPlan.recommendedReply,
    recentEvent: options.timelinePrepareEvent,
    canContinue: readiness.tone !== 'bad',
    summary: prepareConfirmationPlan.summary,
  });

  return {
    templateName,
    modeLabel: humanModeLabel(modeDetection?.detected_mode),
    mainDirection,
    styleDirection,
    sceneDirection,
    promptCount,
    batchCount,
    importedBindingCount,
    assetCount,
    currentFocus,
    nextStepLabel: prepareAction.actionLabel,
    nextStepReason,
    primaryActionKey: readiness.tone === 'bad' ? 'refine_prepare' : 'go_result',
    primaryAction: {
      key: readiness.tone === 'bad' ? 'refine_prepare' : 'go_result',
      label: prepareAction.actionLabel,
      cta: primaryAction.ctaLabel,
      summary: nextStepReason,
    },
    secondaryActionHints,
    transitionSummary,
    handoffSummary,
    stageSummary: importedBindingCount > 0
      ? '准备层负责方向、放行和素材绑定确认。'
      : '准备层负责方向和放行确认。',
    readiness,
    cockpitSummary,
    judgment,
    statusStack,
    confirmationState,
    unifiedStatus: buildStageUnifiedStatus({
      stage: '准备阶段',
      conclusion: readiness.label,
      currentFocus,
      progress: readiness.detail,
      status: readiness.tone,
      taskLabel: workspaceState?.taskLabel,
      nextActionLabel: prepareAction.actionLabel,
      nextActionReason: nextStepReason,
      nextActionTarget: readiness.tone === 'bad' ? 'prepare_workspace.html' : 'result_workspace.html',
      recommendedReply: prepareConfirmationPlan.recommendedReply,
      actionReason: prepareConfirmationPlan.summary,
      dialogueSummary: prepareConfirmationPlan.summary,
      alternativeSayItems: secondaryActionHints,
      confirmItems: prepareConfirmationPlan.pendingItems,
    }),
  };
}

function summarizeResultState(manifest, workspaceState, workspaceAssets, reviewItems, operationsReport, options = {}) {
  const hasStoryboard = Boolean(options.hasStoryboard);
  const successCount = Number(workspaceState?.counts?.success || manifest?.success || 0);
  const failedCount = Number(workspaceState?.counts?.failed || manifest?.failed || 0);
  const reviewCount = Number(workspaceState?.counts?.needsReview || toArray(reviewItems).length || 0);
  const runtimeStatus = String(workspaceState?.runtimeSummary?.currentStatus || '').trim();
  const hasCompletedExecution = runtimeStatus === 'completed'
    || Boolean(manifest?.hostNative)
    || successCount > 0
    || failedCount > 0
    || reviewCount > 0;
  const resultAction = failedCount > 0
    ? buildActionLanguage('go_exception')
    : buildActionLanguage('review_result');
  const resultNextAction = failedCount > 0
    ? buildActionLanguage('go_exception')
    : buildActionLanguage('go_home');
  const currentFocus = hasCompletedExecution
    ? (failedCount > 0 ? '先看异常与可用性' : '先看保留取舍')
    : '当前还没有正式结果，先确认执行节奏';
  const nextStepReason = hasCompletedExecution
    ? buildResultNextStepReason({ failedCount, hasStoryboard })
    : '当前还没有可筛看的图片结果，建议先回工作台首页确认执行节奏；如需补看方向，再回准备工作台。';
  const resultConfirmationPlan = hasCompletedExecution
    ? buildResultConfirmationPlan({
      failedCount,
      reviewCount,
      actionKey: failedCount > 0 ? 'go_exception' : 'review_result',
    })
    : {
      pendingItems: ['是否先回工作台首页确认执行节奏'],
      blockingItems: ['当前还没有正式结果'],
      recommendedReply: buildActionLanguage('go_home').replyLabel,
      summary: '结果层尚未生成可判断内容',
    };
  const secondaryActionHints = hasCompletedExecution
    ? [
      reviewCount > 0 ? `当前还有 ${reviewCount} 项待复核，适合边筛边确认。` : '',
      hasStoryboard ? '如果需要确认镜头衔接，再按需进入分镜整板页。' : '',
      failedCount > 0 ? '失败项会继续打断主链，建议优先分流到异常层。' : '',
    ].filter(Boolean)
    : [
      '真正的筛图与取舍，会在执行完成后回到这里进行。',
      '如果只是想补看方向与素材约束，可以先回准备工作台。',
    ];
  const transitionSummary = hasCompletedExecution
    ? (failedCount > 0
      ? '结果层已经判断出当前更适合先进入异常层处理问题。'
      : '结果层当前以筛图和收口为主，不需要再拆成多条结果支线。')
    : '结果层页面已经预留，但要等执行完成后才会承接真正的筛图和收口。';
  const handoffSummary = hasCompletedExecution
    ? (failedCount > 0
      ? `结果层会把 ${failedCount} 项失败和 ${reviewCount} 项待复核带给异常层。`
      : (reviewCount > 0
        ? `结果层会把 ${reviewCount} 项待复核结果继续带着收口判断。`
        : '结果层当前没有明显异常压力，可以把结论交回工作台。'))
    : '当前先不要在结果层做取舍，等执行完成后再回这里继续。';
  const resultStatusLabel = hasCompletedExecution
    ? (String(workspaceState?.status?.headline || '').trim()
      || buildResultStatusLabel({ failedCount, reviewCount }))
    : '结果尚未生成，先等待执行';
  const resultStatusTone = hasCompletedExecution
    ? (String(workspaceState?.status?.tone || '').trim()
      || (failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good')))
    : 'info';
  const resultStatusSummary = hasCompletedExecution
    ? (String(workspaceState?.status?.summary || '').trim()
      || buildResultStatusSummary({ failedCount, reviewCount }))
    : '当前还没有可筛看的图片结果，先回工作台首页确认执行节奏，或按需回准备工作台复核方向。';
  const confirmationState = buildConfirmationState({
    currentIntent: hasCompletedExecution
      ? (failedCount > 0 ? '先处理异常后再继续收口' : '继续筛图并做最终取舍')
      : '先等待执行完成，再回结果层做取舍',
    stageLabel: '结果阶段',
    stageTone: hasCompletedExecution
      ? (failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'))
      : 'info',
    confirmedItems: [
      `当前状态: ${resultStatusLabel}`,
      `成功结果: ${successCount} 项`,
    ],
    pendingItems: resultConfirmationPlan.pendingItems,
    blockingItems: resultConfirmationPlan.blockingItems,
    recommendedReply: resultConfirmationPlan.recommendedReply,
    recentEvent: hasCompletedExecution ? options.timelineResultEvent : (options.timelinePrepareEvent || null),
    canContinue: hasCompletedExecution ? failedCount === 0 : false,
    summary: resultConfirmationPlan.summary,
  });
  const cockpitSummary = buildResultCockpitSummary({
    statusLabel: resultStatusLabel,
    statusTone: resultStatusTone,
    statusSummary: resultStatusSummary,
    currentFocus,
    nextStepReason,
    failedCount,
    reviewCount,
  });
  const judgment = buildResultJudgmentPanel({
    statusLabel: resultStatusLabel,
    statusTone: resultStatusTone,
    statusSummary: resultStatusSummary,
    currentFocus,
    nextStepLabel: resultNextAction.actionLabel,
    nextStepReason,
    failedCount,
    reviewCount,
    confirmationState,
  });
  const statusStack = buildResultStatusStack({
    statusLabel: resultStatusLabel,
    statusSummary: resultStatusSummary,
    statusTone: resultStatusTone,
    failedCount,
    reviewCount,
    nextActionLabel: resultNextAction.actionLabel,
    nextActionSummary: nextStepReason,
  });

  return {
    statusLabel: resultStatusLabel,
    statusTone: resultStatusTone,
    statusSummary: resultStatusSummary,
    currentFocus,
    stageSummary: failedCount > 0
      ? '结果层负责筛图、取舍和异常分流。'
      : '结果层负责筛图、取舍和最终收口。',
    nextStepLabel: resultNextAction.actionLabel,
    nextStepReason,
    primaryActionKey: failedCount > 0 ? 'go_exception' : 'review_result',
    actionSummary: resultAction.summaryLabel,
    primaryAction: {
      key: failedCount > 0 ? 'go_exception' : 'review_result',
      label: resultAction.actionLabel,
      cta: resultAction.ctaLabel,
      summary: nextStepReason,
    },
    secondaryActionHints,
    transitionSummary,
    handoffSummary,
    previewCount: readPreviewAssets(workspaceAssets).length,
    issueCount: failedCount + reviewCount,
    topRequestMode: operationsReport?.distributions?.requestMode?.[0]?.name || '未记录',
    topStyleFamily: operationsReport?.distributions?.styleFamily?.[0]?.name || '未记录',
    successCount,
    failedCount,
    reviewCount,
    cockpitSummary,
    judgment,
    statusStack,
    confirmationState,
    unifiedStatus: buildStageUnifiedStatus({
      stage: '结果阶段',
      conclusion: resultStatusLabel,
      currentFocus,
      progress: resultStatusSummary,
      status: hasCompletedExecution ? (failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good')) : 'info',
      taskLabel: workspaceState?.taskLabel,
      nextActionLabel: resultNextAction.actionLabel,
      nextActionReason: nextStepReason,
      nextActionTarget: failedCount > 0 ? 'exception_workspace.html' : 'workspace_home.html',
      recommendedReply: resultConfirmationPlan.recommendedReply,
      actionReason: resultConfirmationPlan.summary,
      dialogueSummary: resultConfirmationPlan.summary,
      alternativeSayItems: secondaryActionHints,
      confirmItems: resultConfirmationPlan.pendingItems,
    }),
  };
}

function summarizeExceptionState(manifest, workspaceState, rerunCandidates, options = {}) {
  const failedCount = Number(workspaceState?.counts?.failed || manifest?.failed || 0);
  const reviewCount = Number(workspaceState?.counts?.needsReview || 0);
  const rerunCount = Array.isArray(rerunCandidates) ? rerunCandidates.length : 0;
  const totalIssueCount = failedCount + reviewCount;
  const hasStoryboard = Boolean(options.hasStoryboard);
  const exceptionAction = failedCount > 0
    ? buildActionLanguage('resolve_failed')
    : buildActionLanguage('review_exception');
  const exceptionNextAction = buildActionLanguage('go_home');
  const currentFocus = failedCount > 0 ? '先处理失败项' : (reviewCount > 0 ? '先确认待复核项' : '当前没有明显异常');
  const nextStepReason = failedCount > 0
    ? '先把失败项和补跑判断收口，再回工作台继续。'
    : (reviewCount > 0
      ? '先把待复核项确认清楚，再决定是否回结果工作台继续。'
      : '当前异常压力较低，可以回工作台继续。');
  const exceptionConfirmationPlan = buildExceptionConfirmationPlan({
    failedCount,
    reviewCount,
    actionKey: failedCount > 0 ? 'resolve_failed' : 'review_exception',
  });
  const secondaryActionHints = [
    reviewCount > 0 ? `当前还有 ${reviewCount} 项待复核，需要人工确认边界结果。` : '',
    rerunCount > 0 ? `当前已有 ${rerunCount} 个补跑候选，可在异常层集中判断。` : '',
    failedCount > 0 ? '硬失败会直接阻塞工作台继续判断，优先级最高。' : '',
  ].filter(Boolean);
  const transitionSummary = failedCount > 0
    ? '异常层当前主要承担问题收口，不应把未处理的失败项直接送回工作台。'
    : '异常层已经更接近收口判断，处理完即可回工作台或回结果工作台复核。';
  const handoffSummary = failedCount > 0
    ? `异常层会先接住 ${failedCount} 项失败，再决定是否带着 ${rerunCount} 个补跑候选回到工作台。`
    : (reviewCount > 0
      ? `异常层会先确认 ${reviewCount} 项待复核，再把结论送回工作台。`
      : '异常层当前压力较低，可以把判断交回工作台继续。');
  const confirmationState = buildConfirmationState({
    currentIntent: failedCount > 0 ? '先收口异常问题' : '回工作台继续判断',
    stageLabel: '异常阶段',
    stageTone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
    confirmedItems: [
      failedCount > 0 ? `失败项: ${failedCount} 项` : '失败项: 当前没有硬失败',
      reviewCount > 0 ? `待复核项: ${reviewCount} 项` : '待复核项: 当前压力较低',
    ],
    pendingItems: exceptionConfirmationPlan.pendingItems,
    blockingItems: exceptionConfirmationPlan.blockingItems,
    recommendedReply: exceptionConfirmationPlan.recommendedReply,
    recentEvent: options.timelinePausedEvent || options.timelineResultEvent,
    canContinue: failedCount === 0,
    summary: exceptionConfirmationPlan.summary,
  });
  const statusLabel = String(workspaceState?.status?.headline || '').trim()
    || buildExceptionStatusLabel({ totalIssueCount });
  const statusTone = String(workspaceState?.status?.tone || '').trim()
    || (totalIssueCount > 0 ? 'bad' : 'good');
  const statusSummary = String(workspaceState?.status?.summary || '').trim()
    || buildExceptionStatusSummary({ totalIssueCount });
  const issueSummary = String(workspaceState?.risk?.summary || '').trim()
    || buildExceptionIssueSummary({ totalIssueCount });
  const cockpitSummary = buildExceptionCockpitSummary({
    statusLabel,
    statusTone,
    statusSummary,
    currentFocus,
    nextStepReason,
    issueSummary,
    failedCount,
    reviewCount,
  });
  const judgment = buildExceptionJudgmentPanel({
    statusLabel,
    statusTone,
    statusSummary,
    issueSummary,
    currentFocus,
    nextStepLabel: exceptionNextAction.summaryLabel,
    nextStepReason,
    failedCount,
    reviewCount,
    confirmationState,
  });
  const statusStack = buildExceptionStatusStack({
    statusLabel,
    statusSummary,
    statusTone,
    totalIssueCount,
    failedCount,
    issueSummary,
    nextActionLabel: exceptionNextAction.summaryLabel,
    nextActionSummary: nextStepReason,
  });

  return {
    statusLabel,
    statusTone,
    statusSummary,
    issueSummary,
    totalIssueCount,
    rerunCount,
    currentFocus,
    stageSummary: failedCount > 0
      ? '异常层负责失败项、待复核项和补跑判断。'
      : '异常层负责异常确认与回工作台交接。',
    actionSummary: exceptionAction.summaryLabel,
    nextStepReason,
    primaryActionKey: failedCount > 0 ? 'resolve_failed' : 'review_exception',
    nextStepLabel: exceptionNextAction.summaryLabel,
    primaryAction: {
      key: failedCount > 0 ? 'resolve_failed' : 'review_exception',
      label: exceptionAction.actionLabel,
      cta: exceptionAction.ctaLabel,
      summary: nextStepReason || String(workspaceState?.risk?.summary || '').trim(),
    },
    secondaryActionHints,
    transitionSummary,
    handoffSummary,
    failedCount,
    reviewCount,
    cockpitSummary,
    judgment,
    statusStack,
    confirmationState,
    unifiedStatus: buildStageUnifiedStatus({
      stage: '异常阶段',
      conclusion: statusLabel,
      currentFocus,
      progress: statusSummary,
      status: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
      taskLabel: workspaceState?.taskLabel,
      nextActionLabel: exceptionNextAction.summaryLabel,
      nextActionReason: nextStepReason,
      nextActionTarget: 'workspace_home.html',
      recommendedReply: exceptionConfirmationPlan.recommendedReply,
      actionReason: exceptionConfirmationPlan.summary,
      dialogueSummary: exceptionConfirmationPlan.summary,
      alternativeSayItems: secondaryActionHints,
      confirmItems: exceptionConfirmationPlan.pendingItems,
    }),
  };
}

function buildAssetStatus(options = {}) {
  const items = toArray(options.items).filter((item) => item && item.label);
  const readyItems = items.filter((item) => String(item.tone || '').trim() === 'good').length;
  const pendingItems = items.filter((item) => ['warn', 'bad'].includes(String(item.tone || '').trim())).length;
  return {
    title: String(options.title || '').trim() || '资产状态',
    copy: String(options.copy || '').trim() || '这里不展示程序资产名，只告诉你当前有哪些内容已经能直接用，哪些还需要再确认。',
    readyLabel: String(options.readyLabel || '').trim() || '已可直接使用',
    readySummary: String(options.readySummary || '').trim() || `${readyItems} 类资产已经可以直接使用`,
    pendingLabel: String(options.pendingLabel || '').trim() || '仍待确认',
    pendingSummary: String(options.pendingSummary || '').trim() || (pendingItems > 0 ? `${pendingItems} 类资产还需要继续确认` : '当前没有明显待确认资产'),
    items,
  };
}

function buildActionStatus(options = {}) {
  return {
    title: String(options.title || '').trim() || '行动建议',
    copy: String(options.copy || '').trim() || getDefaultActionStatusCopy(),
    primary: options.primary || null,
    secondary: toArray(options.secondary),
    notes: toArray(options.notes),
    recommendedReply: String(options.recommendedReply || '').trim(),
    actionReason: String(options.actionReason || '').trim(),
  };
}

function buildWorkflowActionState(options = {}) {
  const actionStatus = options.actionStatus && typeof options.actionStatus === 'object'
    ? options.actionStatus
    : {};
  const confirmation = options.confirmation && typeof options.confirmation === 'object'
    ? options.confirmation
    : {};
  const dialogueStatus = options.dialogueStatus && typeof options.dialogueStatus === 'object'
    ? options.dialogueStatus
    : {};
  const primary = actionStatus.primary && typeof actionStatus.primary === 'object'
    ? { ...actionStatus.primary }
    : null;
  const recommendedReply = String(
    options.recommendedReply
    || actionStatus.recommendedReply
    || confirmation.recommendedReply
    || dialogueStatus.primarySay
    || ''
  ).trim();
  const actionReason = String(
    options.actionReason
    || actionStatus.actionReason
    || dialogueStatus.actionReason
    || confirmation.summary
    || ''
  ).trim();
  const label = String(
    options.label
    || primary?.title
    || ''
  ).trim();
  const summary = String(
    options.summary
    || primary?.summary
    || actionReason
    || ''
  ).trim();

  return {
    label,
    summary,
    recommendedReply,
    actionReason,
    primary,
    secondary: toArray(actionStatus.secondary),
    notes: toArray(actionStatus.notes),
  };
}

function buildTransitionStatus(options = {}) {
  return {
    title: String(options.title || '').trim() || '阶段交接',
    copy: String(options.copy || '').trim() || getDefaultTransitionStatusCopy(),
    confirmedTitle: String(options.confirmedTitle || '').trim() || '已经确认',
    nextFocusTitle: String(options.nextFocusTitle || '').trim() || '下一页先看',
    confirmedItems: toArray(options.confirmedItems),
    nextFocusItems: toArray(options.nextFocusItems),
  };
}

function buildStageRelay(options = {}) {
  return {
    title: String(options.title || '').trim() || '阶段接力',
    copy: String(options.copy || '').trim() || '这里只回答三件事：从哪来、现在做什么、做完去哪。',
    previousTitle: String(options.previousTitle || '').trim() || '上一站交来',
    previousLabel: String(options.previousLabel || '').trim() || '当前没有上一站交接',
    previousSummary: String(options.previousSummary || '').trim() || '这一站就是当前主链起点。',
    previousItems: toArray(options.previousItems),
    currentTitle: String(options.currentTitle || '').trim() || '这一站负责',
    currentLabel: String(options.currentLabel || '').trim() || '继续当前主链',
    currentSummary: String(options.currentSummary || '').trim() || '先按这一站的主判断继续。',
    currentItems: toArray(options.currentItems),
    nextTitle: String(options.nextTitle || '').trim() || '完成后送去',
    nextLabel: String(options.nextLabel || '').trim() || '继续当前主链',
    nextSummary: String(options.nextSummary || '').trim() || '完成这一站后，按主链继续下一步。',
    nextItems: toArray(options.nextItems),
  };
}

function buildCockpitSummary(options = {}) {
  return {
    title: String(options.title || '').trim() || '驾驶舱摘要',
    copy: String(options.copy || '').trim() || '这里只保留当前局面、当前重点和阻塞情况，避免和上方动作区重复。',
    items: toArray(options.items).filter((item) => item && item.label && item.value),
  };
}

function buildTimelineSection(options = {}) {
  return {
    title: String(options.title || '').trim() || '阶段时间线',
    copy: String(options.copy || '').trim() || '这里只回放最近发生的阶段变化。',
    events: toArray(options.events),
  };
}

function buildProgressSection(options = {}) {
  return {
    title: String(options.title || '').trim() || '当前任务主链',
    copy: String(options.copy || '').trim() || '你现在只需要知道自己走到哪一站，以及下一步该去哪里。',
    visibleIds: toArray(options.visibleIds).map((item) => String(item || '').trim()).filter(Boolean),
  };
}

function getDefaultProgressVisibleIds() {
  return ['workspace-home', 'prepare-workspace', 'result-workspace', 'exception-workspace'];
}

function buildDialogueStatus(options = {}) {
  const titles = getDefaultDialogueTitles();
  return {
    title: String(options.title || '').trim() || '对话协同',
    copy: String(options.copy || '').trim() || getDefaultDialogueStatusCopy(),
    recentTitle: String(options.recentTitle || '').trim() || titles.recentTitle,
    understoodTitle: String(options.understoodTitle || '').trim() || titles.understoodTitle,
    confirmTitle: String(options.confirmTitle || '').trim() || titles.confirmTitle,
    nextSayTitle: String(options.nextSayTitle || '').trim() || titles.nextSayTitle,
    recentItems: toArray(options.recentItems),
    understoodItems: toArray(options.understoodItems),
    confirmItems: toArray(options.confirmItems),
    nextSayItems: toArray(options.nextSayItems),
    primarySay: String(options.primarySay || '').trim(),
    actionReason: String(options.actionReason || '').trim(),
    summary: String(options.summary || '').trim(),
    alternativeSayItems: toArray(options.alternativeSayItems),
  };
}

function buildDialogueRelay(stage, options = {}) {
  const key = String(stage || '').trim();
  const map = {
    home: '把首页判断翻成可直接继续的一句话。',
    prepare: '把准备结论翻成可直接继续的一句话。',
    result: '把结果判断翻成可直接继续的一句话。',
    exception: '把异常判断翻成可直接继续的一句话。',
  };
  return {
    title: '对话接力',
    copy: map[key] || '这里把当前工作台判断翻成统一中文接力语言。',
    statusLine: String(options.statusLine || '').trim() || 'DAOGE 状态：已就绪',
    digestItems: toArray(options.digestItems).filter(Boolean).slice(0, 3),
    directReplies: toArray(options.directReplies).filter(Boolean).slice(0, 4),
  };
}

function buildStageCadence(options = {}) {
  const summary = String(options.summary || '').trim();
  const recommendedReply = String(options.recommendedReply || '').trim();
  const primarySay = String(options.primarySay || recommendedReply).trim();
  const directReplies = buildRelayItems(
    [primarySay, recommendedReply],
    options.directReplies || [],
    4,
  );
  const digestItems = buildRelayItems(
    options.digestItems || [],
    summary ? [summary] : [],
    3,
  );
  return {
    recommendedReply,
    primarySay,
    directReplies,
    digestItems,
    summary,
  };
}

function buildStageCadenceSummary(options = {}) {
  const cadence = buildStageCadence(options);
  return {
    recommendedReply: cadence.recommendedReply,
    primarySay: cadence.primarySay,
    replyReason: String(options.replyReason || cadence.summary || '').trim(),
    digestItems: cadence.digestItems,
    directReplies: cadence.directReplies,
    summary: cadence.summary,
  };
}

function buildWorkflowReplyState(options = {}) {
  const confirmation = options.confirmation && typeof options.confirmation === 'object'
    ? options.confirmation
    : {};
  const dialogueStatus = options.dialogueStatus && typeof options.dialogueStatus === 'object'
    ? options.dialogueStatus
    : {};
  const cadence = confirmation?.cadence && typeof confirmation.cadence === 'object'
    ? confirmation.cadence
    : {};
  const recommendedReply = String(
    options.recommendedReply
    || dialogueStatus.primarySay
    || confirmation.recommendedReply
    || cadence.recommendedReply
    || ''
  ).trim();
  const primarySay = String(
    options.primarySay
    || dialogueStatus.primarySay
    || recommendedReply
  ).trim();
  const alternativeSayItems = buildRelayItems(
    options.alternativeSayItems || dialogueStatus.alternativeSayItems || [],
    [],
    3,
  ).filter((item) => item !== primarySay);
  const replyReason = String(
    options.replyReason
    || dialogueStatus.actionReason
    || confirmation.summary
    || cadence.summary
    || ''
  ).trim();
  const directReplies = buildRelayItems(
    [primarySay, recommendedReply],
    options.directReplies || dialogueStatus.nextSayItems || cadence.directReplies || [],
    4,
  );

  return {
    recommendedReply,
    primarySay,
    alternativeSayItems,
    replyReason,
    directReplies,
  };
}

function buildRelayItems(primaryItems = [], fallbackItems = [], limit = 3) {
  const items = [];
  [...toArray(primaryItems), ...toArray(fallbackItems)].forEach((item) => {
    const value = String(item || '').trim();
    if (!value) return;
    if (!items.includes(value)) items.push(value);
  });
  return items.slice(0, limit);
}

function buildHomeStageRelay(workspaceState, nextAction, options = {}) {
  const status = workspaceState?.status || {};
  const confirmationState = workspaceState?.confirmationState || {};
  const route = options.route || {};
  const issueCount = Number(workspaceState?.counts?.failed || 0) + Number(workspaceState?.counts?.needsReview || 0);
  const nextStep = toArray(route.nextSteps)[0] || {};
  const cadence = buildStageCadence({
    recommendedReply: confirmationState.recommendedReply,
    summary: confirmationState.summary || nextAction?.reason,
    directReplies: [
      issueCount > 0 ? '继续，先处理异常' : '继续，按主链往下走',
    ],
    digestItems: [
      String(status.headline || '').trim(),
      String(workspaceState?.risk?.summary || '').trim(),
    ],
  });
  return buildStageRelay({
    previousLabel: '首页作为当前主链起点',
    previousSummary: '这一站负责把你送到当前真正该去的地方，不再让你从一堆页面里自己猜。',
    previousItems: buildRelayItems([
      String(status.phase || '').trim() ? `当前阶段：${String(status.phase).trim()}` : '',
      issueCount > 0 ? `当前还有 ${issueCount} 项待处理问题` : '当前没有明显异常压力',
    ]),
    currentLabel: String(nextAction?.label || '继续当前主链').trim() || '继续当前主链',
    currentSummary: String(nextAction?.reason || confirmationState.summary || '').trim() || '先按首页主判断继续。',
    currentItems: buildRelayItems([
      String(status.headline || '').trim(),
      String(workspaceState?.risk?.summary || '').trim(),
      '首页只负责判断当前主链入口，不负责展开所有旧页面。',
    ]),
    nextLabel: String(nextStep.label || nextAction?.label || '继续当前主链').trim() || '继续当前主链',
    nextSummary: String(nextStep.summary || nextAction?.reason || '').trim() || '完成首页判断后，按推荐入口继续。',
    nextItems: buildRelayItems([
      String(nextStep.summary || '').trim(),
      cadence.primarySay ? `回到对话框可直接说：${cadence.primarySay}` : '',
    ]),
  });
}

function buildPrepareStageRelay(prepareSummary, options = {}) {
  const readiness = prepareSummary?.readiness || {};
  const confirmationState = prepareSummary?.confirmationState || {};
  const handoffFromPrevious = options.handoffFromPrevious || {};
  const handoffToNext = options.handoffToNext || {};
  const route = options.route || {};
  const nextStep = toArray(route.nextSteps)[0] || {};
  const blockingCount = toArray(readiness.blockingItems).length;
  const cadence = buildStageCadence({
    recommendedReply: confirmationState.recommendedReply,
    summary: prepareSummary?.nextStepReason || confirmationState.summary || readiness.detail,
    directReplies: [
      blockingCount > 0 ? '继续，我先处理准备问题' : '继续，进入结果工作台',
    ],
    digestItems: [
      `放行状态：${String(readiness.label || '未提供').trim() || '未提供'}`,
      Number(prepareSummary?.importedBindingCount || 0) > 0 ? `素材绑定：${Number(prepareSummary.importedBindingCount || 0)} 项` : '当前没有额外素材绑定',
    ],
  });
  return buildStageRelay({
    previousTitle: String(handoffFromPrevious.confirmedTitle || '').trim() || '上一站交来',
    previousLabel: String(handoffFromPrevious.title || '').trim() || '首页已把任务送到准备层',
    previousSummary: String(handoffFromPrevious.copy || '').trim() || '上一站已经决定现在应该先确认方向、放行和素材绑定，再进入执行后的结果判断。',
    previousItems: buildRelayItems(
      handoffFromPrevious.confirmedItems,
      [
        route.previous?.label ? `来自：${route.previous.label}` : '',
        String(route.previous?.summary || '').trim(),
      ],
    ),
    currentTitle: String(handoffFromPrevious.nextFocusTitle || '').trim() || '这一站负责',
    currentLabel: blockingCount > 0 ? '先修正准备层' : '准备放行，等待进入结果层',
    currentSummary: String(prepareSummary?.nextStepReason || confirmationState.summary || readiness.detail || '').trim() || '这一站只负责准备确认，不再拆成多张旧准备页。',
    currentItems: buildRelayItems([
      `放行状态：${String(readiness.label || '未提供').trim() || '未提供'}`,
      String(prepareSummary?.mainDirection || '').trim() ? `任务方向：${String(prepareSummary.mainDirection).trim()}` : '',
      Number(prepareSummary?.importedBindingCount || 0) > 0 ? `素材绑定：${Number(prepareSummary.importedBindingCount || 0)} 项` : '当前没有额外素材绑定',
    ]),
    nextTitle: String(handoffToNext.nextFocusTitle || '').trim() || '完成后送去',
    nextLabel: String(handoffToNext.title || nextStep.label || '结果工作台').trim() || '结果工作台',
    nextSummary: String(handoffToNext.copy || nextStep.summary || '').trim() || '完成准备确认后，就进入统一结果工作台。',
    nextItems: buildRelayItems(
      [
        String(handoffToNext.confirmedTitle || '').trim(),
        ...toArray(handoffToNext.confirmedItems),
        ...toArray(handoffToNext.nextFocusItems),
      ],
      [
        cadence.primarySay ? `回到对话框可直接说：${cadence.primarySay}` : '',
      ],
    ),
  });
}

function buildResultStageRelay(resultSummary, options = {}) {
  const confirmationState = resultSummary?.confirmationState || {};
  const handoffFromPrevious = options.handoffFromPrevious || {};
  const handoffToNext = options.handoffToNext || {};
  const route = options.route || {};
  const nextStep = toArray(route.nextSteps)[0] || {};
  const cadence = buildStageCadence({
    recommendedReply: confirmationState.recommendedReply,
    summary: resultSummary?.nextStepReason || confirmationState.summary || resultSummary?.statusSummary,
    directReplies: [
      Number(resultSummary?.failedCount || 0) > 0 ? '继续，先处理异常' : '继续，筛图收口',
    ],
    digestItems: [
      String(resultSummary?.currentFocus || '').trim(),
      `结果概况：${Number(resultSummary?.successCount || 0)} 成功 / ${Number(resultSummary?.failedCount || 0)} 失败 / ${Number(resultSummary?.reviewCount || 0)} 待复核`,
    ],
  });
  return buildStageRelay({
    previousTitle: String(handoffFromPrevious.confirmedTitle || '').trim() || '上一站交来',
    previousLabel: String(handoffFromPrevious.title || '').trim() || '准备层已把结果入口交到这里',
    previousSummary: String(handoffFromPrevious.copy || '').trim() || '上一站已经确认方向和放行条件，现在只需要围绕结果判断、取舍和异常分流继续。',
    previousItems: buildRelayItems(
      handoffFromPrevious.confirmedItems,
      [
        route.previous?.label ? `上一站入口：${route.previous.label}` : '',
      ],
    ),
    currentTitle: String(handoffFromPrevious.nextFocusTitle || '').trim() || '这一站负责',
    currentLabel: String(resultSummary?.nextStepLabel || '继续结果层').trim() || '继续结果层',
    currentSummary: String(resultSummary?.statusSummary || resultSummary?.nextStepReason || '').trim() || '这一站负责看图、取舍和决定是否转异常。',
    currentItems: buildRelayItems(
      handoffFromPrevious.nextFocusItems,
      [
        String(resultSummary?.currentFocus || '').trim() ? `当前重点：${String(resultSummary.currentFocus).trim()}` : '',
        `结果概况：${Number(resultSummary?.successCount || 0)} 成功 / ${Number(resultSummary?.failedCount || 0)} 失败 / ${Number(resultSummary?.reviewCount || 0)} 待复核`,
        Number(resultSummary?.failedCount || 0) > 0 ? '当前建议先处理失败项，再决定最终取舍。' : '当前可继续筛图和收口。',
      ],
    ),
    nextTitle: String(handoffToNext.confirmedTitle || '').trim() || '完成后送去',
    nextLabel: String(handoffToNext.title || nextStep.label || resultSummary?.nextStepLabel || '继续下一步').trim() || '继续下一步',
    nextSummary: String(handoffToNext.copy || nextStep.summary || resultSummary?.nextStepReason || '').trim() || '完成这一站判断后，再决定是否进入异常层或继续收口。',
    nextItems: buildRelayItems(
      [
        String(handoffToNext.nextFocusTitle || '').trim(),
        ...toArray(handoffToNext.confirmedItems),
        ...toArray(handoffToNext.nextFocusItems),
      ],
      [
        cadence.primarySay ? `回到对话框可直接说：${cadence.primarySay}` : '',
      ],
    ),
  });
}

function buildExceptionStageRelay(exceptionSummary, options = {}) {
  const confirmationState = exceptionSummary?.confirmationState || {};
  const handoffFromPrevious = options.handoffFromPrevious || {};
  const handoffToNext = options.handoffToNext || {};
  const route = options.route || {};
  const nextStep = toArray(route.nextSteps)[0] || {};
  const cadence = buildStageCadence({
    recommendedReply: confirmationState.recommendedReply,
    summary: exceptionSummary?.nextStepReason || confirmationState.summary || exceptionSummary?.issueSummary,
    directReplies: [
      Number(exceptionSummary?.failedCount || 0) > 0 ? '继续，先处理失败项' : '继续，回结果工作台复核',
    ],
    digestItems: [
      String(exceptionSummary?.currentFocus || '').trim(),
      `问题概况：${Number(exceptionSummary?.failedCount || 0)} 失败 / ${Number(exceptionSummary?.reviewCount || 0)} 待复核 / ${Number(exceptionSummary?.rerunCount || 0)} 补跑候选`,
    ],
  });
  return buildStageRelay({
    previousTitle: String(handoffFromPrevious.confirmedTitle || '').trim() || '上一站交来',
    previousLabel: String(handoffFromPrevious.title || '').trim() || '结果层已把问题收进异常层',
    previousSummary: String(handoffFromPrevious.copy || '').trim() || '上一站已经判断当前更适合先处理问题，再决定如何回工作台继续。',
    previousItems: buildRelayItems(
      handoffFromPrevious.confirmedItems,
      [
        route.previous?.label ? `来自：${route.previous.label}` : '',
      ],
    ),
    currentTitle: String(handoffFromPrevious.nextFocusTitle || '').trim() || '这一站负责',
    currentLabel: String(exceptionSummary?.nextStepLabel || '继续异常层').trim() || '继续异常层',
    currentSummary: String(exceptionSummary?.issueSummary || exceptionSummary?.nextStepReason || '').trim() || '这一站只负责把失败项、待复核项和补跑判断收清。',
    currentItems: buildRelayItems(
      handoffFromPrevious.nextFocusItems,
      [
        `问题概况：${Number(exceptionSummary?.failedCount || 0)} 失败 / ${Number(exceptionSummary?.reviewCount || 0)} 待复核 / ${Number(exceptionSummary?.rerunCount || 0)} 补跑候选`,
        String(exceptionSummary?.currentFocus || '').trim() ? `当前重点：${String(exceptionSummary.currentFocus).trim()}` : '',
        Number(exceptionSummary?.failedCount || 0) > 0 ? '硬失败会直接阻塞工作台继续判断，优先级最高。' : '当前主要剩余人工复核与是否补跑的判断。',
      ],
    ),
    nextTitle: String(handoffToNext.confirmedTitle || '').trim() || '完成后送去',
    nextLabel: String(handoffToNext.title || nextStep.label || '回工作台继续').trim() || '回工作台继续',
    nextSummary: String(handoffToNext.copy || nextStep.summary || exceptionSummary?.nextStepReason || '').trim() || '这一站收口后，再回结果工作台或工作台首页继续判断。',
    nextItems: buildRelayItems(
      [
        String(handoffToNext.nextFocusTitle || '').trim(),
        ...toArray(handoffToNext.confirmedItems),
        ...toArray(handoffToNext.nextFocusItems),
      ],
      [
        cadence.primarySay ? `回到对话框可直接说：${cadence.primarySay}` : '',
      ],
    ),
  });
}

function buildJudgmentPanel(options = {}) {
  return {
    title: String(options.title || '主控判断').trim() || '主控判断',
    copy: String(options.copy || '').trim() || '这里只解释为什么现在这样判断、继续前还差什么，以及回到对话框时的唯一主回复。',
    statusLabel: String(options.statusLabel || '当前判断').trim() || '当前判断',
    statusSummary: String(options.statusSummary || '').trim() || '当前没有额外说明。',
    statusTone: String(options.statusTone || 'info').trim() || 'info',
    actionLabel: String(options.actionLabel || '继续当前主链').trim() || '继续当前主链',
    actionSummary: String(options.actionSummary || '').trim() || '按推荐动作继续即可。',
    replyLabel: String(options.replyLabel || '继续当前主链').trim() || '继续当前主链',
    confirmItems: toArray(options.confirmItems).filter(Boolean),
    noteItems: toArray(options.noteItems).filter(Boolean),
    relay: options.relay || null,
  };
}

function normalizeList(items) {
  return toArray(items)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
}

function buildTimelineEventSnapshot(event, fallback = {}) {
  if (!event && !fallback.title && !fallback.summary && !fallback.type && !fallback.time) return null;
  return {
    type: String(event?.type || fallback.type || '').trim() || 'unknown',
    title: String(event?.title || fallback.title || '').trim() || '最近没有新的阶段事件',
    summary: String(event?.summary || fallback.summary || '').trim() || '当前还没有可同步的最新阶段变化。',
    time: event?.time || fallback.time || null,
  };
}

function buildActionLanguage(actionKey, options = {}) {
  return getActionLanguage(actionKey, options);
}

function resolvePrimaryActionLanguage(nextAction, options = {}) {
  const target = String(nextAction?.target || '').trim();
  if (target === 'prepare_workspace.html') return buildActionLanguage('go_prepare', options);
  if (target === 'result_workspace.html') return buildActionLanguage('go_result', options);
  if (target === 'exception_workspace.html') return buildActionLanguage('go_exception', options);
  if (target === 'workspace_home.html') return buildActionLanguage('go_home', options);
  if (target === 'storyboard_board.html') return buildActionLanguage('go_storyboard', options);
  return buildActionLanguage('go_result', options);
}

function getWorkspaceLanguageSystem(stage) {
  const key = String(stage || '').trim();
  const chrome = getWorkspaceStageChrome(key);
  const shared = {
    flowTitle: '当前流程状态',
    decisionTitle: '当前判断',
    dialogueTitle: '对话协同',
    actionTitle: '行动建议',
    routeTitle: chrome.routeTitle || '先做这一步',
    workbenchTitle: chrome.workbenchTitle || '按需再看',
  };
  const map = {
    home: {
      decisionCopy: chrome.decisionCopy || '这一块只解释为什么首页会给出这样的主判断。',
      flowCopy: '先看当前阶段，再按主动作继续。',
      routeCopy: chrome.routeCopy || '先按这一轮当前唯一值得先做的一步继续，不要在首页自己分支判断。',
      workbenchCopy: chrome.workbenchCopy || '主动作已经在前面给出；这里只保留一个真正按需入口。',
    },
    prepare: {
      decisionCopy: chrome.decisionCopy || '这一块只解释为什么当前能放行、不能放行，或为什么还要再收一轮。',
      flowCopy: '先看是否放行，再决定继续还是修正。',
      routeCopy: chrome.routeCopy || '先按准备层当前最值得做的一步继续，不需要再自己判断该打开哪一张旧准备页。',
      workbenchCopy: chrome.workbenchCopy || '主动作已经在前面给出，这里只保留少量按需入口。',
      transitionTitle: '进入结果页前，你已经确认了什么',
      transitionConfirmedTitle: '准备页已经确认',
      transitionNextFocusTitle: '进入结果页先看',
    },
    result: {
      decisionCopy: chrome.decisionCopy || '这一块只解释为什么当前该保留、复核，还是先去处理异常。',
      flowCopy: '先看结果是否稳定，再决定收口还是转异常。',
      routeCopy: chrome.routeCopy || '先按结果层当前最值得做的一步继续，不要在多个结果相关页面之间自己来回判断。',
      workbenchCopy: chrome.workbenchCopy || '主动作已经在前面给出，这里只保留少量按需入口。',
      fromPrepareTitle: '从准备页进入结果页后，这一页先看什么',
      fromPrepareConfirmedTitle: '准备页已经交接',
      fromPrepareNextFocusTitle: '结果页现在先看',
      toExceptionTitle: '从结果页转入异常页前，这一页已经帮你初判了什么',
      toExceptionConfirmedTitle: '结果页已经初判',
      toExceptionNextFocusTitle: '进入异常页先处理',
    },
    exception: {
      decisionCopy: chrome.decisionCopy || '这一块只解释为什么这些问题会影响主链，以及为什么当前先处理这一类问题。',
      flowCopy: '先看哪些问题会卡主链，再决定回流还是补跑。',
      routeCopy: chrome.routeCopy || '先按异常层当前最值得做的一步继续，不把按需页面变成第二个主控页。',
      workbenchCopy: chrome.workbenchCopy || '主动作已经在前面给出，这里只保留一个按需入口。',
      fromResultTitle: '从结果页进入异常页后，先处理哪一类问题',
      fromResultConfirmedTitle: '结果页已经交接',
      fromResultNextFocusTitle: '异常页现在先做',
      backToMainlineTitle: '异常处理完后，回工作台前先确认什么',
      backToMainlineConfirmedTitle: '异常页已经帮你收口',
      backToMainlineNextFocusTitle: '回工作台后先看',
    },
  };
  return {
    ...shared,
    ...(map[key] || map.home),
  };
}

function getWorkspaceFieldLabels(stage) {
  const key = String(stage || '').trim();
  const shared = {
    currentStatus: '当前状态',
    currentFocus: '当前重点',
    nextAction: '推荐下一步',
  };
  const map = {
    home: {
      currentStage: '当前阶段',
      issuePressure: '异常压力',
      runScale: '本轮规模',
      currentConclusion: '当前结论',
      resultOverview: '结果概况',
      requestMode: '主要请求方式',
      styleDirection: '主要风格方向',
    },
    prepare: {
      readiness: '放行状态',
      currentFocus: '当前重点',
      nextAction: '推荐下一步',
      currentConclusion: '当前结论',
      templateType: '模板类型',
      currentMode: '当前模式',
      taskDirection: '任务主轴',
      styleDirection: '风格主轴',
      assetBinding: '素材绑定',
    },
    result: {
      resultOverview: '结果概况',
      requestMode: '请求方式',
      styleDirection: '主要风格方向',
      previewCount: '可预览图片',
    },
    exception: {
      issueOverview: '问题概况',
      issuePressure: '异常压力',
      failedCount: '失败项',
      reviewCount: '待复核',
      rerunCount: '补跑候选',
    },
  };
  return {
    ...shared,
    ...(map[key] || map.home),
  };
}

function getWorkspaceCopyTemplates(stage) {
  const key = String(stage || '').trim();
  const map = {
    home: {
      heroIntro: '这是当前任务的驾驶台。先看阶段、主动作和异常压力。',
      flowCompletionGood: '当前主链可以继续向下',
      flowCompletionWarn: '当前主链未完全收口',
      summaryCopy: '这里保留任务层面的补充信息，方便你在首页继续看整体判断。',
      assetCopy: '首页只回答一件事：这轮任务已经沉淀了什么，接下来可以直接用什么。',
      previewCopy: '这里先给你一个缩略速览，帮助你在首页先看整体方向。',
      previewEmptyText: '当前还没有可展示的成功结果。',
      previewFallback: '这一张可以继续做保留、复核或淘汰判断。',
    },
    prepare: {
      heroIntro: '这是准备驾驶台。这里集中确认方向、放行和素材绑定，再决定是否进入结果层。',
      flowCompletionBad: '准备层仍有阻塞项',
      flowCompletionWarn: '准备层基本完成，但建议再收一轮',
      flowCompletionGood: '准备层已经可以继续',
      summaryCopy: '这里保留准备层的任务信息，不再把程序字段和内部产物名直接堆给人看。',
      assetCopy: '准备层重点不是看文件名，而是看哪些准备资产已经到位，哪些还会影响放行。',
      directionCopy: '这里只保留人需要看的方向信息。',
      readinessCopy: '先判断能不能继续。',
      assetsCopy: '只有存在绑定约束时，这里才需要重点看。',
    },
    result: {
      heroIntro: '这是结果驾驶台。先看图、做取舍，再决定是否转异常或继续收口。',
      flowCompletionBad: '结果层仍有异常待收口',
      flowCompletionWarn: '结果层可继续，但仍有待复核项',
      flowCompletionGood: '结果层可以继续向终局收口',
      summaryCopy: '这里保留结果层的补充信息，方便你继续看全局分布和风险概况。',
      assetCopy: '结果层先帮你分清哪些图已经可用，哪些仍待复核，哪些需要转去异常处理。',
      previewCopy: '这里先看图，再做取舍。',
      previewEmptyText: '当前还没有可展示的成功结果。',
      previewFallback: '这一张可在审阅板里继续做保留、复核或淘汰判断。',
      issuesCopy: '只有真正需要关注的问题才会出现在这里，避免你再去翻散乱记录。',
      issuesEmptyText: '当前没有需要单独处理的失败项或待复核项。',
      issuesFallback: '建议回异常工作台统一处理。',
      advancedCopy: '这些信息只用于补充理解。',
      advancedEmptyText: '当前没有可展示的分布。',
    },
    exception: {
      heroIntro: '这是条件驾驶台。只有当前结果真的出现问题时才需要进入；进入后先把失败项和待复核项收掉，再回到主链继续。',
      flowCompletionBad: '异常尚未清空',
      flowCompletionWarn: '当前主要剩余待复核项',
      flowCompletionGood: '异常层当前基本清空',
      summaryCopy: '这里保留异常层的补充判断，避免把程序字段直接讲给人看。',
      assetCopy: '这里只保留和问题处理有关的资产状态。',
      issuesCopy: '这里只展示需要处理的问题对象。',
      issuesEmptyText: '当前没有明显异常，这一页可以先不使用。',
      failedFallbackSummary: '这一项在执行时没有稳定完成。',
      reviewFallbackSummary: '这一项建议人工再看一眼，确认边界、融合和主体稳定度。',
    },
  };
  return map[key] || {};
}

function buildConfirmationState(options = {}) {
  const confirmedItems = normalizeList(options.confirmedItems);
  const pendingItems = normalizeList(options.pendingItems);
  const blockingItems = normalizeList(options.blockingItems);
  const recentEvent = buildTimelineEventSnapshot(options.recentEvent, options.recentEventFallback || {});
  const hasBlocking = blockingItems.length > 0;
  const cadence = buildStageCadenceSummary({
    recommendedReply: options.recommendedReply,
    replyReason: options.summary,
    summary: options.summary,
  });
  return {
    currentIntent: String(options.currentIntent || '').trim() || '继续当前主链',
    confirmedItems,
    pendingItems,
    blockingItems,
    recommendedReply: String(cadence.primarySay || '').trim() || '继续下一步',
    recentEvent,
    stageLabel: String(options.stageLabel || '').trim() || '未标注阶段',
    stageTone: String(options.stageTone || '').trim() || 'info',
    canContinue: Boolean(options.canContinue ?? !hasBlocking),
    hasBlocking,
    confirmedCount: confirmedItems.length,
    pendingCount: pendingItems.length,
    blockingCount: blockingItems.length,
    summary: buildConfirmationSummary({
      summary: options.summary,
      blockingCount: blockingItems.length,
      pendingCount: pendingItems.length,
    }),
    cadence,
  };
}

function appendUniqueItems(baseItems, extraItems, limit = 4) {
  const result = [];
  normalizeList(baseItems).forEach((item) => {
    if (!result.includes(item)) result.push(item);
  });
  normalizeList(extraItems).forEach((item) => {
    if (!result.includes(item)) result.push(item);
  });
  return result.slice(0, limit);
}

function buildRecentDialogueItems(confirmationState, fallbackItems) {
  const recentEvent = confirmationState?.recentEvent || null;
  const eventItems = recentEvent
    ? [
      `最近阶段变化: ${recentEvent.title}`,
      recentEvent.summary,
    ]
    : [];
  return appendUniqueItems(eventItems, fallbackItems, 4);
}

function buildUnderstoodDialogueItems(confirmationState, fallbackItems) {
  const intentItem = String(confirmationState?.currentIntent || '').trim()
    ? [`当前目标: ${String(confirmationState.currentIntent).trim()}`]
    : [];
  const confirmedItems = normalizeList(confirmationState?.confirmedItems).map((item) => `已接住: ${item}`);
  return appendUniqueItems(intentItem.concat(confirmedItems), fallbackItems, 5);
}

function buildConfirmDialogueItems(confirmationState, fallbackItems) {
  return appendUniqueItems(
    normalizeList(confirmationState?.pendingItems),
    normalizeList(confirmationState?.blockingItems).concat(fallbackItems),
    5,
  );
}

function buildNextReplyDialogueItems(confirmationState, fallbackItems) {
  const recommendedReply = String(confirmationState?.recommendedReply || '').trim();
  return appendUniqueItems(
    buildNextReplyCandidates(recommendedReply, fallbackItems),
    [],
    4,
  );
}

function getWorkspacePanelLanguage(stage) {
  const key = String(stage || '').trim();
  const shared = {
    routeTitle: '先做这一步',
    workbenchTitle: '按需再看',
  };
  const map = {
    home: {
      routeCopy: '这里只保留当前最值得继续的一步，避免你在多个页面之间自己猜路线。',
      workbenchCopy: '主动作已经在上面的行动建议里，这里只保留少量补充跳转。',
      actionCopy: '首页只做动作分流，不让你在多个入口之间自己做选择题。',
      transitionCopy: '首页不承担阶段交接，这一块只在后续工作台里承担承接与回流。',
    },
    prepare: {
      routeCopy: '这里只保留准备层当前最值得继续的一步，不需要再自己判断该打开哪一张旧准备页。',
      workbenchCopy: '主动作已经在上面的行动建议里，这里只保留准备层少量补充跳转。',
      actionCopy: '准备层先决定是继续放行，还是先收一轮，不再拆成散乱准备页。',
      transitionCopy: '这一块只负责把准备层已经确认的条件交给下一站，不重复讲整页判断。',
    },
    result: {
      routeCopy: '这里只保留结果层当前最值得继续的一步，不要在多个结果相关页面之间自己来回判断。',
      workbenchCopy: '主动作已经在上面的行动建议里，这里只保留结果层少量补充跳转。',
      actionCopy: '结果层不再让你在多个结果页面里自己猜路线，而是直接告诉你此刻最值钱的动作。',
      transitionCopy: '这一块只负责承接上一站、交给下一站，不重复讲结果页的整轮状态。',
    },
    exception: {
      routeCopy: '这里只保留异常层当前最值得先做的一步，不把按需页面做成新的路线中心。',
      workbenchCopy: '主动作已经在上面的行动建议里，这里只保留一个按需入口。',
      actionCopy: '异常层只保留真正和问题处理有关的动作，不再让你跳来跳去自己判断优先级。',
      transitionCopy: '这一块只负责把问题从上一站接住，再把处理后的判断送回工作台。',
    },
  };
  return {
    ...shared,
    ...(map[key] || map.home),
  };
}

function buildViewControlRail(options = {}) {
  const taskControlBar = options.taskControlBar && typeof options.taskControlBar === 'object'
    ? options.taskControlBar
    : null;
  const recommendedReply = String(
    options.recommendedReply
    || options.confirmation?.recommendedReply
    || options.actionStatus?.recommendedReply
    || options.dialogueStatus?.primarySay
    || ''
  ).trim();

  return {
    snapshot: {
      taskLabel: String(options.taskLabel || taskControlBar?.taskLabel || '').trim(),
      stageLabel: String(options.stageLabel || taskControlBar?.stageLabel || '').trim(),
      statusLabel: String(options.statusLabel || taskControlBar?.statusLabel || '').trim(),
      pressureLabel: String(options.pressureLabel || taskControlBar?.pressureLabel || '').trim(),
      nextActionLabel: String(options.nextActionLabel || taskControlBar?.nextActionLabel || '').trim(),
      nextActionSummary: String(options.nextActionSummary || taskControlBar?.nextActionSummary || '').trim(),
      recommendedReply,
    },
    taskControlBar,
    signalBar: {
      title: String(options.signalTitle || '').trim() || '阶段信号',
      copy: String(options.signalCopy || '').trim() || '这里用同一套流程信号告诉你当前在什么阶段、现在是什么状态、下一步该怎么继续。',
      items: toArray(options.signalBar),
    },
    statusStack: {
      title: String(options.statusTitle || '').trim() || '工作流状态栈',
      copy: String(options.statusCopy || '').trim() || '这里把当前阶段最关键的流程状态收成一套固定语言，避免不同区块各说各话。',
      items: toArray(options.statusStack),
    },
  };
}

function buildWorkspaceSessionConsole(options = {}) {
  const taskLabel = String(options.taskLabel || '').trim();
  const stageLabel = String(options.stageLabel || '').trim();
  const statusLabel = String(options.statusLabel || '').trim();
  const pressureLabel = String(options.pressureLabel || '').trim();
  const runScaleLabel = String(options.runScaleLabel || '').trim();
  const title = String(options.title || '').trim() || '任务会话快照';
  const copy = String(options.copy || '').trim()
    || '无论你从哪一页进入，这里都先用同一套会话语言告诉你：当前是什么任务、走到哪一步、整体状态是否平稳。';

  const items = [
    taskLabel ? { label: '当前任务', value: taskLabel, summary: String(options.taskSummary || '').trim(), tone: 'info' } : null,
    stageLabel ? { label: '当前阶段', value: stageLabel, summary: String(options.stageSummary || '').trim(), tone: 'neutral' } : null,
    statusLabel ? { label: '当前状态', value: statusLabel, summary: String(options.statusSummary || '').trim(), tone: String(options.statusTone || 'neutral').trim() || 'neutral' } : null,
    pressureLabel ? { label: '当前压力', value: pressureLabel, summary: String(options.pressureSummary || '').trim(), tone: String(options.pressureTone || 'neutral').trim() || 'neutral' } : null,
    runScaleLabel ? { label: '本轮规模', value: runScaleLabel, summary: String(options.runScaleSummary || '').trim(), tone: 'neutral' } : null,
  ].filter(Boolean);

  return items.length ? { title, copy, items } : null;
}

function cloneViewDisplay(display) {
  if (!display || typeof display !== 'object') return null;
  return {
    ...display,
    order: Array.isArray(display.order) ? display.order.slice() : [],
    defaultOpenSections: toArray(display.defaultOpenSections),
    contentOpenSections: toArray(display.contentOpenSections),
    supportOpenSections: toArray(display.supportOpenSections),
    advancedOpenSections: toArray(display.advancedOpenSections),
    sectionRegistry: Object.fromEntries(
      Object.entries(display.sectionRegistry || {}).map(([key, spec]) => [
        key,
        {
          ...spec,
        },
      ])
    ),
    sectionGroups: Object.fromEntries(
      Object.entries(display.sectionGroups || {}).map(([key, group]) => [
        key,
        {
          ...group,
          sectionKeys: toArray(group?.sectionKeys),
          extraClasses: Array.isArray(group?.extraClasses) ? group.extraClasses.slice() : [],
        },
      ])
    ),
    modeSwitch: display.modeSwitch ? { ...display.modeSwitch } : null,
    surfaceRules: display.surfaceRules ? { ...display.surfaceRules } : null,
  };
}

function attachViewDisplay(view, display, stage) {
  if (!view || typeof view !== 'object') return view;
  const clonedDisplay = cloneViewDisplay(display);
  if (!clonedDisplay) return view;
  return {
    ...view,
    display: {
      ...clonedDisplay,
      stage: String(stage || '').trim() || null,
    },
  };
}

function buildViewCopilot(options = {}) {
  const snapshot = options.snapshot && typeof options.snapshot === 'object'
    ? { ...options.snapshot }
    : {};
  const reply = buildWorkflowReplyState({
    recommendedReply: options.recommendedReply || snapshot.recommendedReply,
    primarySay: options.primarySay,
    alternativeSayItems: options.dialogueStatus?.alternativeSayItems,
    replyReason: options.replyReason,
    directReplies: options.dialogueStatus?.nextSayItems,
    dialogueStatus: options.dialogueStatus,
    confirmation: options.confirmation,
  });
  const recommendedReply = String(reply.recommendedReply || snapshot.recommendedReply || '').trim();
  const stageLabel = String(options.stageLabel || snapshot.stageLabel || '').trim();
  const taskLabel = String(options.taskLabel || snapshot.taskLabel || '').trim();
  const statusLabel = String(options.statusLabel || snapshot.statusLabel || '').trim();
  const pressureLabel = String(options.pressureLabel || snapshot.pressureLabel || '').trim();
  const action = buildWorkflowActionState({
    label: options.nextActionLabel || snapshot.nextActionLabel,
    summary: options.nextActionSummary || snapshot.nextActionSummary,
    recommendedReply: reply.recommendedReply,
    actionReason: options.replyReason,
    actionStatus: options.actionStatus,
    dialogueStatus: options.dialogueStatus,
    confirmation: options.confirmation,
  });
  const nextActionLabel = String(action.label || snapshot.nextActionLabel || '').trim();
  const nextActionSummary = String(action.summary || snapshot.nextActionSummary || '').trim();
  const focusSummary = String(
    options.focusSummary
    || options.judgment?.statusSummary
    || options.cockpitSummary?.items?.[0]?.summary
    || options.confirmation?.summary
    || nextActionSummary
    || ''
  ).trim();
  const heroCards = toArray(options.cockpitSummary?.items)
    .map((item) => item && item.label && item.value ? {
      label: item.label,
      value: item.value,
      tone: item.tone || 'neutral',
      detail: item.summary || '',
    } : null)
    .filter(Boolean);

  return {
    title: String(options.title || '').trim() || '会话副驾驶',
    copy: String(options.copy || '').trim() || '这里把任务会话、当前判断、下一步和对话接力收成同一套副驾驶入口。',
    snapshot: {
      taskLabel,
      stageLabel,
      statusLabel,
      pressureLabel,
      nextActionLabel,
      nextActionSummary,
      recommendedReply: reply.primarySay,
    },
    hero: {
      taskControlBar: options.taskControlBar || null,
      sessionConsole: options.sessionConsole || null,
      signalBar: options.signalBar || null,
      cockpitSummary: options.cockpitSummary || null,
      heroCards,
    },
    mainline: {
      judgment: options.judgment || null,
      stageRelay: options.stageRelay || null,
      statusStack: options.statusStack || [],
      dialogueStatus: options.dialogueStatus || null,
      confirmation: options.confirmation || null,
    },
    reply: {
      recommendedReply: reply.recommendedReply,
      primarySay: reply.primarySay,
      reason: reply.replyReason,
      alternativeSayItems: reply.alternativeSayItems,
      directReplies: reply.directReplies,
    },
    action,
    summary: {
      taskLabel,
      stageLabel,
      statusLabel,
      pressureLabel,
      nextActionLabel,
      focusSummary,
    },
  };
}

function buildViewCopilotFromWorkflowSession(session, options = {}) {
  const source = session && typeof session === 'object' ? session : {};
  const protocol = source.protocol && typeof source.protocol === 'object' ? source.protocol : {};
  const stageUi = protocol.stageUi && typeof protocol.stageUi === 'object' ? protocol.stageUi : {};
  const unifiedStatus = protocol.unifiedStatus && typeof protocol.unifiedStatus === 'object' ? protocol.unifiedStatus : {};
  const snapshot = source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : {};
  const action = source.action && typeof source.action === 'object' ? source.action : {};
  const reply = source.reply && typeof source.reply === 'object' ? source.reply : {};
  const relay = source.relay && typeof source.relay === 'object' ? source.relay : {};
  const consoleState = source.console && typeof source.console === 'object' ? source.console : {};
  const summary = source.summary && typeof source.summary === 'object' ? source.summary : {};
  const unifiedAction = unifiedStatus.nextAction && typeof unifiedStatus.nextAction === 'object' ? unifiedStatus.nextAction : {};
  const unifiedDialogue = unifiedStatus.dialogue && typeof unifiedStatus.dialogue === 'object' ? unifiedStatus.dialogue : {};
  const stageUiControlBar = stageUi.taskControlBar && typeof stageUi.taskControlBar === 'object' ? stageUi.taskControlBar : {};
  const stageUiSessionConsole = stageUi.sessionConsole && typeof stageUi.sessionConsole === 'object' ? stageUi.sessionConsole : {};
  const stageUiSignalBar = Array.isArray(stageUi.signalBar) ? stageUi.signalBar : toArray(stageUi.signalBar);
  const stageUiStatusStack = Array.isArray(stageUi.statusStack) ? stageUi.statusStack : toArray(stageUi.statusStack);
  const workflowTitle = String(options.title || '').trim() || '会话副驾驶';
  const workflowCopy = String(options.copy || '').trim() || '这里把任务会话、当前判断、下一步和对话接力收成同一套副驾驶入口。';
  return {
    title: workflowTitle,
    copy: workflowCopy,
    snapshot: {
      taskLabel: String(unifiedStatus.taskLabel || stageUiControlBar.taskLabel || snapshot.taskLabel || '').trim(),
      stageLabel: String(unifiedStatus.stage || snapshot.stageLabel || '').trim(),
      statusLabel: String(unifiedStatus.conclusion || snapshot.statusLabel || '').trim(),
      pressureLabel: String(stageUiControlBar.pressureLabel || snapshot.pressureLabel || '').trim(),
      nextActionLabel: String(unifiedAction.label || action.label || stageUiControlBar.nextActionLabel || snapshot.nextActionLabel || '').trim(),
      nextActionSummary: String(unifiedAction.reason || action.summary || stageUiControlBar.nextActionSummary || snapshot.nextActionSummary || '').trim(),
      recommendedReply: String(unifiedDialogue.primarySay || reply.primarySay || reply.recommendedReply || snapshot.recommendedReply || '').trim(),
    },
    hero: {
      taskControlBar: stageUiControlBar || consoleState.taskControlBar || null,
      sessionConsole: stageUiSessionConsole || consoleState.sessionConsole || null,
      signalBar: stageUiSignalBar.length
        ? { title: '阶段信号', copy: '这里用统一信号说明当前阶段、状态、压力和下一步。', items: stageUiSignalBar }
        : (Array.isArray(consoleState.signalBar)
          ? { title: '阶段信号', copy: '这里用统一信号说明当前阶段、状态、压力和下一步。', items: consoleState.signalBar }
          : (consoleState.signalBar || null)),
      cockpitSummary: consoleState.cockpitSummary || null,
      heroCards: toArray(options.heroCards).length
        ? toArray(options.heroCards)
        : toArray(consoleState.cockpitSummary?.items).map((item) => item && item.label && item.value ? {
          label: item.label,
          value: item.value,
          tone: item.tone || 'neutral',
          detail: item.summary || '',
        } : null).filter(Boolean),
    },
    mainline: {
      judgment: relay.judgment || null,
      stageRelay: relay.stageRelay || null,
      statusStack: stageUiStatusStack.length ? stageUiStatusStack : toArray(consoleState.statusStack),
      dialogueStatus: relay.dialogueStatus || null,
      confirmation: options.confirmation || null,
    },
    reply: {
      recommendedReply: String(reply.recommendedReply || unifiedDialogue.primarySay || '').trim(),
      primarySay: String(unifiedDialogue.primarySay || reply.primarySay || '').trim(),
      reason: String(reply.replyReason || unifiedDialogue.actionReason || reply.reason || '').trim(),
      alternativeSayItems: toArray(reply.alternativeSayItems).length ? toArray(reply.alternativeSayItems) : toArray(unifiedDialogue.alternativeSayItems),
      directReplies: toArray(reply.directReplies).length ? toArray(reply.directReplies) : toArray(unifiedDialogue.nextSayItems),
    },
    action: {
      label: String(unifiedAction.label || action.label || '').trim(),
      summary: String(unifiedAction.reason || action.summary || '').trim(),
      recommendedReply: String(action.recommendedReply || unifiedDialogue.primarySay || reply.recommendedReply || '').trim(),
      actionReason: String(action.actionReason || unifiedDialogue.actionReason || reply.replyReason || '').trim(),
      primary: action.primary || null,
      secondary: toArray(action.secondary),
      notes: toArray(action.notes),
    },
    summary: {
      taskLabel: String(summary.taskLabel || unifiedStatus.taskLabel || snapshot.taskLabel || '').trim(),
      stageLabel: String(summary.stageLabel || unifiedStatus.stage || snapshot.stageLabel || '').trim(),
      statusLabel: String(summary.statusLabel || unifiedStatus.conclusion || snapshot.statusLabel || '').trim(),
      pressureLabel: String(summary.pressureLabel || stageUiControlBar.pressureLabel || snapshot.pressureLabel || '').trim(),
      nextActionLabel: String(summary.nextActionLabel || unifiedAction.label || action.label || snapshot.nextActionLabel || '').trim(),
      focusSummary: String(summary.focusSummary || unifiedAction.reason || action.summary || snapshot.nextActionSummary || '').trim(),
    },
  };
}

function buildWorkflowCopilot(options = {}) {
  const stageKey = String(options.stageKey || '').trim() || 'unknown';
  const stageUi = options.stageUi && typeof options.stageUi === 'object' ? options.stageUi : {};
  const unifiedStatus = options.unifiedStatus && typeof options.unifiedStatus === 'object' ? options.unifiedStatus : {};
  const stageUiControlBar = stageUi.taskControlBar && typeof stageUi.taskControlBar === 'object'
    ? stageUi.taskControlBar
    : {};
  const taskLabel = String(options.taskLabel || unifiedStatus.taskLabel || stageUiControlBar.taskLabel || '').trim();
  const stageLabel = String(options.stageLabel || unifiedStatus.stage || stageUiControlBar.stageLabel || '').trim();
  const statusLabel = String(options.statusLabel || unifiedStatus.conclusion || stageUiControlBar.statusLabel || '').trim();
  const pressureLabel = String(options.pressureLabel || stageUiControlBar.pressureLabel || '').trim();
  const nextActionLabel = String(
    options.nextActionLabel
    || unifiedStatus?.nextAction?.label
    || stageUiControlBar.nextActionLabel
    || ''
  ).trim();
  const nextActionSummary = String(
    options.nextActionSummary
    || unifiedStatus?.nextAction?.reason
    || stageUiControlBar.nextActionSummary
    || ''
  ).trim();
  const confirmation = options.confirmation || {};
  const recentEvent = confirmation?.recentEvent || null;
  const intent = String(confirmation?.currentIntent || '').trim();
  const cadence = confirmation?.cadence || {};
  const reply = buildWorkflowReplyState({
    recommendedReply: options.recommendedReply || unifiedStatus?.dialogue?.primarySay,
    primarySay: options.primarySay,
    alternativeSayItems: options.dialogueStatus?.alternativeSayItems || unifiedStatus?.dialogue?.alternativeSayItems,
    replyReason: options.replyReason || unifiedStatus?.dialogue?.actionReason,
    directReplies: options.dialogueStatus?.nextSayItems || unifiedStatus?.dialogue?.nextSayItems,
    dialogueStatus: options.dialogueStatus,
    confirmation,
  });
  const action = buildWorkflowActionState({
    label: options.nextActionLabel,
    summary: options.nextActionSummary,
    recommendedReply: reply.recommendedReply,
    actionReason: options.replyReason || unifiedStatus?.dialogue?.actionReason,
    actionStatus: options.actionStatus,
    dialogueStatus: options.dialogueStatus,
    confirmation,
  });
  const coordination = buildWorkspaceCollaborationSectionData({
    confirmation,
    timeline: options.timeline || {},
    dialogue: options.dialogueStatus || {},
    primarySay: reply.primarySay,
    replyReason: reply.replyReason,
    alternativeSayItems: reply.alternativeSayItems,
  });

  return {
    stageKey,
    protocol: {
      stageUi: stageUi || null,
      unifiedStatus: unifiedStatus || null,
    },
    snapshot: {
      taskLabel,
      stageLabel,
      statusLabel,
      pressureLabel,
      nextActionLabel: action.label || nextActionLabel,
      nextActionSummary: action.summary || nextActionSummary,
    },
    action,
    rhythm: {
      intent,
      recommendedReply: reply.recommendedReply,
      primarySay: reply.primarySay,
      alternativeSayItems: reply.alternativeSayItems,
      replyReason: reply.replyReason,
      digestItems: toArray(cadence.digestItems),
      directReplies: reply.directReplies.length ? reply.directReplies : toArray(cadence.directReplies),
      summary: String(cadence.summary || confirmation?.summary || '').trim(),
    },
    reply,
    coordination,
    checkpoints: {
      confirmedItems: toArray(confirmation?.confirmedItems),
      pendingItems: toArray(confirmation?.pendingItems),
      blockingItems: toArray(confirmation?.blockingItems),
      canContinue: Boolean(confirmation?.canContinue),
      hasBlocking: Boolean(confirmation?.hasBlocking),
      summary: String(confirmation?.summary || '').trim(),
    },
    relay: {
      judgment: options.judgment || null,
      stageRelay: options.stageRelay || null,
      dialogueStatus: options.dialogueStatus || null,
      recentEvent,
    },
    console: {
      sessionConsole: options.sessionConsole || null,
      taskControlBar: options.taskControlBar || null,
      signalBar: options.signalBar || null,
      statusStack: toArray(options.statusStack),
      cockpitSummary: options.cockpitSummary || null,
    },
  };
}

function buildWorkflowSessionRegistry(sessions = {}) {
  return {
    home: sessions.home || null,
    prepare: sessions.prepare || null,
    result: sessions.result || null,
    exception: sessions.exception || null,
  };
}

function buildTaskSessionSnapshotRegistry(workflowSessions = {}) {
  const stages = ['home', 'prepare', 'result', 'exception'];
  return Object.fromEntries(stages.map((stageKey) => {
    const session = workflowSessions?.[stageKey] && typeof workflowSessions[stageKey] === 'object'
      ? workflowSessions[stageKey]
      : {};
    const consoleState = session.console && typeof session.console === 'object'
      ? session.console
      : {};
    const sessionConsole = consoleState.sessionConsole && typeof consoleState.sessionConsole === 'object'
      ? consoleState.sessionConsole
      : null;
    return [stageKey, sessionConsole ? { ...sessionConsole, stageKey } : { stageKey, title: '任务会话快照', items: [] }];
  }));
}

function buildWorkflowProtocolRegistry(workflowSessions = {}) {
  const stages = ['home', 'prepare', 'result', 'exception'];
  return Object.fromEntries(stages.map((stageKey) => {
    const session = workflowSessions?.[stageKey] && typeof workflowSessions[stageKey] === 'object'
      ? workflowSessions[stageKey]
      : {};
    const protocol = session.protocol && typeof session.protocol === 'object'
      ? session.protocol
      : {};
    return [stageKey, {
      stageKey,
      stageUi: protocol.stageUi || null,
      unifiedStatus: protocol.unifiedStatus || null,
    }];
  }));
}

function buildWorkflowCopilotRegistry(workflowSessions = {}) {
  const stages = ['home', 'prepare', 'result', 'exception'];
  return Object.fromEntries(stages.map((stageKey) => {
    const session = workflowSessions?.[stageKey] && typeof workflowSessions[stageKey] === 'object'
      ? workflowSessions[stageKey]
      : {};
    return [stageKey, {
      stageKey,
      sessionSource: `workflowSessions.${stageKey}`,
      protocolSource: `workflowProtocolRegistry.${stageKey}`,
      contractSource: `workflowContracts.${stageKey}`,
      hasSession: Boolean(Object.keys(session).length),
    }];
  }));
}

function buildWorkflowStageContract(stageKey, session) {
  const source = session && typeof session === 'object' ? session : {};
  const protocol = source.protocol && typeof source.protocol === 'object' ? source.protocol : {};
  const stageUi = protocol.stageUi && typeof protocol.stageUi === 'object' ? protocol.stageUi : {};
  const unifiedStatus = protocol.unifiedStatus && typeof protocol.unifiedStatus === 'object' ? protocol.unifiedStatus : {};
  const snapshot = source.snapshot && typeof source.snapshot === 'object' ? source.snapshot : {};
  const action = source.action && typeof source.action === 'object' ? source.action : {};
  const rhythm = source.rhythm && typeof source.rhythm === 'object' ? source.rhythm : {};
  const reply = source.reply && typeof source.reply === 'object' ? source.reply : {};
  const coordination = source.coordination && typeof source.coordination === 'object' ? source.coordination : {};
  const checkpoints = source.checkpoints && typeof source.checkpoints === 'object' ? source.checkpoints : {};
  const relay = source.relay && typeof source.relay === 'object' ? source.relay : {};
  const consoleState = source.console && typeof source.console === 'object' ? source.console : {};
  const unifiedAction = unifiedStatus.nextAction && typeof unifiedStatus.nextAction === 'object' ? unifiedStatus.nextAction : {};
  const unifiedDialogue = unifiedStatus.dialogue && typeof unifiedStatus.dialogue === 'object' ? unifiedStatus.dialogue : {};
  const stageUiControlBar = stageUi.taskControlBar && typeof stageUi.taskControlBar === 'object' ? stageUi.taskControlBar : {};
  const stageUiSessionConsole = stageUi.sessionConsole && typeof stageUi.sessionConsole === 'object' ? stageUi.sessionConsole : {};
  const stageUiSignalBar = Array.isArray(stageUi.signalBar) ? stageUi.signalBar : toArray(stageUi.signalBar);
  const stageUiStatusStack = Array.isArray(stageUi.statusStack) ? stageUi.statusStack : toArray(stageUi.statusStack);

  return {
    stageKey: String(stageKey || '').trim() || 'unknown',
    snapshot: {
      taskLabel: String(unifiedStatus.taskLabel || stageUiControlBar.taskLabel || snapshot.taskLabel || '').trim(),
      stageLabel: String(unifiedStatus.stage || snapshot.stageLabel || '').trim(),
      statusLabel: String(unifiedStatus.conclusion || snapshot.statusLabel || '').trim(),
      pressureLabel: String(stageUiControlBar.pressureLabel || snapshot.pressureLabel || '').trim(),
      nextActionLabel: String(unifiedAction.label || action.label || stageUiControlBar.nextActionLabel || snapshot.nextActionLabel || '').trim(),
      nextActionSummary: String(unifiedAction.reason || action.summary || stageUiControlBar.nextActionSummary || snapshot.nextActionSummary || '').trim(),
    },
    currentJudgment: {
      statusLabel: String(relay.judgment?.statusLabel || unifiedStatus.conclusion || snapshot.statusLabel || '').trim(),
      statusSummary: String(relay.judgment?.statusSummary || unifiedStatus.progress || coordination.confirmSummary || checkpoints.summary || '').trim(),
      actionLabel: String(relay.judgment?.actionLabel || unifiedAction.label || action.label || '').trim(),
      actionSummary: String(relay.judgment?.actionSummary || unifiedAction.reason || action.summary || '').trim(),
      noteItems: normalizeList(relay.judgment?.noteItems),
      confirmItems: normalizeList(relay.judgment?.confirmItems || checkpoints.pendingItems),
    },
    nextAction: {
      label: String(unifiedAction.label || action.label || '').trim(),
      summary: String(unifiedAction.reason || action.summary || '').trim(),
      reason: String(action.actionReason || unifiedDialogue.actionReason || reply.replyReason || checkpoints.summary || '').trim(),
      recommendedReply: String(action.recommendedReply || unifiedDialogue.primarySay || reply.recommendedReply || '').trim(),
      notes: normalizeList(action.notes),
    },
    actionReplyBridge: {
      actionLabel: String(unifiedAction.label || action.label || '').trim(),
      actionReason: String(unifiedAction.reason || action.summary || '').trim(),
      reply: String(action.recommendedReply || unifiedDialogue.primarySay || reply.recommendedReply || '').trim(),
      replyReason: String(reply.replyReason || unifiedDialogue.actionReason || rhythm.replyReason || checkpoints.summary || '').trim(),
      confirmationSummary: String(checkpoints.summary || coordination.confirmSummary || '').trim(),
      confirmItems: normalizeList(checkpoints.pendingItems || unifiedDialogue.confirmItems),
    },
    dialogue: {
      primarySay: String(unifiedDialogue.primarySay || reply.primarySay || rhythm.primarySay || '').trim(),
      recommendedReply: String(reply.recommendedReply || unifiedDialogue.primarySay || rhythm.recommendedReply || '').trim(),
      replyReason: String(reply.replyReason || unifiedDialogue.actionReason || rhythm.replyReason || '').trim(),
      directReplies: normalizeList(reply.directReplies || unifiedDialogue.nextSayItems || rhythm.directReplies),
      alternativeSayItems: normalizeList(reply.alternativeSayItems || unifiedDialogue.alternativeSayItems || rhythm.alternativeSayItems),
      digestItems: normalizeList(rhythm.digestItems),
      summary: String(unifiedDialogue.summary || rhythm.summary || coordination.confirmSummary || checkpoints.summary || '').trim(),
    },
    confirmation: {
      stageLabel: String(unifiedStatus.stage || snapshot.stageLabel || '').trim(),
      summary: String(checkpoints.summary || coordination.confirmSummary || '').trim(),
      pendingItems: normalizeList(checkpoints.pendingItems),
      blockingItems: normalizeList(checkpoints.blockingItems),
      confirmedItems: normalizeList(checkpoints.confirmedItems),
      canContinue: Boolean(checkpoints.canContinue),
      hasBlocking: Boolean(checkpoints.hasBlocking),
    },
    relay: {
      previous: relay.stageRelay?.previousLabel || '',
      current: relay.stageRelay?.currentLabel || '',
      next: relay.stageRelay?.nextLabel || '',
      currentSummary: relay.stageRelay?.currentSummary || '',
      nextSummary: relay.stageRelay?.nextSummary || '',
    },
    recent: {
      title: String(relay.recentEvent?.title || '').trim(),
      summary: String(relay.recentEvent?.summary || '').trim(),
    },
    console: {
      sessionTitle: String(stageUiSessionConsole.title || consoleState.sessionConsole?.title || '').trim(),
      signalCount: stageUiSignalBar.length || toArray(consoleState.signalBar).length,
      statusCount: stageUiStatusStack.length || toArray(consoleState.statusStack).length,
    },
  };
}

function buildWorkflowContractRegistry(workflowSessions = {}) {
  return {
    home: buildWorkflowStageContract('home', workflowSessions.home),
    prepare: buildWorkflowStageContract('prepare', workflowSessions.prepare),
    result: buildWorkflowStageContract('result', workflowSessions.result),
    exception: buildWorkflowStageContract('exception', workflowSessions.exception),
  };
}

function buildHomeView(options = {}) {
  const identity = getWorkspaceIdentityCopy();
  const panelLanguage = getWorkspacePanelLanguage('home');
  const language = getWorkspaceLanguageSystem('home');
  const labels = getWorkspaceFieldLabels('home');
  const copy = getWorkspaceCopyTemplates('home');
  const currentStage = String(options.currentStage || '').trim() || '待开始';
  const nextTitle = String(options.nextTitle || '').trim() || '未提供';
  const nextCopy = String(options.nextCopy || '').trim() || '按推荐下一步继续。';
  const issueLabel = String(options.issueLabel || '').trim() || '当前没有明显异常';
  const decisionSummary = String(options.decisionSummary || '').trim() || '当前更适合继续主链。';
  const taskConclusion = String(options.taskConclusion || '').trim() || '当前任务还没有正式开始。';
  const promptCount = Number(options.promptCount || 0);
  const batchCount = Number(options.batchCount || 0);
  const successCount = Number(options.successCount || 0);
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const topRequestMode = String(options.topRequestMode || '').trim() || '未记录';
  const topStyleFamily = String(options.topStyleFamily || '').trim() || '未记录';
  const flow = {
    title: String(options.flowTitle || '').trim() || language.flowTitle,
    copy: String(options.flowCopy || '').trim() || language.flowCopy,
    status: String(options.flowStatus || currentStage).trim() || currentStage,
    readiness: String(options.flowReadiness || nextTitle).trim() || nextTitle,
    focus: String(options.flowFocus || decisionSummary).trim() || decisionSummary,
    actionLabel: String(options.flowActionLabel || nextTitle).trim() || nextTitle,
    actionSummary: String(options.flowActionSummary || '').trim() || String(options.nextCopy || '').trim() || '按推荐下一步继续。',
    completion: String(options.flowCompletion || '').trim() || copy.flowCompletionGood || '主链可继续',
    blockers: toArray(options.flowBlockers),
    availableActions: toArray(options.flowAvailableActions),
  };
  const defaultCockpitSummary = buildCockpitSummary({
    title: '驾驶舱摘要',
    copy: '这里只解释首页当前局面、当前重点和阻塞情况，不重复上方动作建议。',
    items: [
      {
        label: '当前局面',
        value: currentStage,
        summary: decisionSummary,
        tone: failedCount + reviewCount > 0 ? 'warn' : 'info',
      },
      {
        label: '当前重点',
        value: failedCount + reviewCount > 0 ? '先处理异常，再回工作台继续' : '确认当前工作台方向',
        summary: nextCopy,
        tone: 'good',
      },
      {
        label: '阻塞情况',
        value: failedCount + reviewCount > 0 ? `${failedCount + reviewCount} 项待处理` : '当前可继续',
        summary: issueLabel,
        tone: failedCount + reviewCount > 0 ? 'bad' : 'good',
      },
    ],
  });
  const defaultDecision = buildWorkspaceDecisionSectionData({
    items: buildWorkspaceDecisionItems({
      reasonValue: decisionSummary,
      riskValue: issueLabel,
      pageValue: '首页只负责给出当前主链入口与下一步方向。',
    }),
  });
  const defaultSummary = buildWorkspaceSummarySectionData({
    enabled: Boolean(options.summaryEnabled),
    title: '任务摘要',
    copy: copy.summaryCopy,
    items: [
      { label: labels.runScale, value: `${promptCount} 张 / ${batchCount} 批` },
      { label: labels.currentConclusion, value: taskConclusion },
      { label: labels.resultOverview, value: `${successCount} 成功 / ${failedCount} 失败 / ${reviewCount} 待复核` },
      { label: labels.requestMode, value: topRequestMode },
      { label: labels.styleDirection, value: topStyleFamily },
    ],
  });

  return {
    hero: {
      eyebrow: String(options.eyebrow || '').trim() || '主链总控',
      title: String(options.title || '').trim() || 'DAOGE 工作台首页',
      intro: String(options.intro || '').trim() || copy.heroIntro,
    },
    context: {
      runLabel: String(options.runLabel || '').trim(),
      phaseLabel: currentStage,
      flowLabel: String(options.flowLabel || '').trim() || identity.flows.home,
      counts: toArray(options.contextCounts),
      hints: toArray(options.contextHints),
    },
    heroCards: toArray(options.heroCards),
    taskControlBar: options.taskControlBar || null,
    signalBar: options.signalBar || null,
    statusStack: toArray(options.statusStack),
    sessionConsole: options.sessionConsole || null,
    controlRail: options.controlRail || buildViewControlRail({
      taskLabel: String(options.runLabel || '').trim(),
      stageLabel: currentStage,
      nextActionLabel: nextTitle,
      nextActionSummary: String(options.nextCopy || '').trim() || flow.actionSummary,
      recommendedReply: options.confirmation?.recommendedReply || options.actionStatus?.recommendedReply || options.dialogueStatus?.primarySay,
      taskControlBar: options.taskControlBar || null,
      signalBar: options.signalBar || null,
      statusStack: options.statusStack || [],
      confirmation: options.confirmation || null,
      actionStatus: options.actionStatus || null,
      dialogueStatus: options.dialogueStatus || null,
    }),
    cockpitSummary: options.cockpitSummary || defaultCockpitSummary,
    confirmation: options.confirmation || null,
    timeline: options.timeline || null,
    progress: options.progress || null,
    judgment: options.judgment || null,
    collaboration: options.collaboration || null,
    decision: options.decision || defaultDecision,
    summary: options.summary || defaultSummary,
    route: buildWorkspaceRouteSectionData({
      source: options.route,
      title: language.routeTitle,
      copy: String(options.routeCopy || '').trim() || language.routeCopy,
      current: options.routeCurrent || null,
      previous: options.routePrevious || null,
      nextSteps: toArray(options.routeNextSteps),
    }),
    workbench: buildWorkspaceWorkbenchSectionData({
      source: options.workbench,
      title: language.workbenchTitle,
      copy: String(options.workbenchCopy || '').trim() || language.workbenchCopy,
      cards: toArray(options.workbenchCards),
    }),
    guides: {
      entryStructure: options.entryGuide || null,
      assetVisibility: options.assetGuide || null,
    },
    assetStatus: options.assetStatus || buildAssetStatus(),
    actionStatus: options.actionStatus || buildActionStatus(),
    dialogueStatus: options.dialogueStatus || buildDialogueStatus(),
    stageRelay: options.stageRelay || null,
    copilot: options.copilot || null,
    workflowCopilot: options.workflowCopilot || null,
    workflowContract: options.workflowContract || null,
    contentSections: buildWorkspaceContentSectionPlan(options.contentSections, [
      { key: 'preview', kind: 'previewGrid', enabled: Boolean(options.previewEnabled) },
      { key: 'guide', kind: 'keyValue' },
      { key: 'visibility', kind: 'keyValue' },
    ]),
    flow,
    sections: {
      guide: buildWorkspaceGuideSectionData({
        title: options.guideTitle,
        copy: String(options.guideCopy || '').trim() || copy.guideCopy,
        items: toArray(options.guideItems),
      }),
      visibility: buildWorkspaceGuideSectionData({
        title: options.visibilityTitle,
        copy: String(options.visibilityCopy || '').trim() || copy.visibilityCopy,
        items: toArray(options.visibilityItems),
      }),
      preview: buildWorkspacePreviewSectionData({
        enabled: Boolean(options.previewEnabled),
        title: options.previewTitle,
        copy: String(options.previewCopy || '').trim() || copy.previewCopy,
        emptyText: String(options.previewEmptyText || '').trim() || copy.previewEmptyText,
        itemFallbackSummary: String(options.previewItemFallbackSummary || '').trim() || copy.previewFallback,
        imageLinkLabel: options.previewImageLinkLabel,
        imageMissingText: options.previewImageMissingText,
      }),
    },
  };
}

function buildPrepareView(prepareSummary, options = {}) {
  const identity = getWorkspaceIdentityCopy();
  const panelLanguage = getWorkspacePanelLanguage('prepare');
  const language = getWorkspaceLanguageSystem('prepare');
  const labels = getWorkspaceFieldLabels('prepare');
  const copy = getWorkspaceCopyTemplates('prepare');
  const statePrepare = prepareSummary || {};
  const readiness = statePrepare.readiness || {};
  const importedBindingCount = Number(statePrepare.importedBindingCount || 0);
  const runtimeStatus = String(options.runtimeStatus || '').trim();
  const runtimeActive = ['running', 'paused', 'awaiting_confirmation', 'waiting'].includes(runtimeStatus);
  const runtimePhaseLabel = String(options.phaseLabel || identity.stages.prepare).trim() || identity.stages.prepare;
  const runtimeEyebrow = String(options.eyebrow || '').trim() || (runtimeActive ? runtimePhaseLabel : '执行前确认');
  const runtimeIntro = String(options.intro || '').trim() || (runtimeActive
    ? (String(statePrepare.stageSummary || '').trim() || copy.heroIntro)
    : copy.heroIntro);
  const runtimeSummaryTitle = runtimeActive ? `${runtimePhaseLabel}摘要` : '准备摘要';
  const runtimeSummaryStage = String(options.phaseLabel || '').trim() || '准备阶段';
  const runtimeStageOverview = String(statePrepare.stageSummary || '').trim()
    || (runtimeActive ? '当前这页正在承接实时执行状态。' : '当前正在确认方向、放行和素材绑定。');
  const flow = {
    title: String(options.flowTitle || '').trim() || language.flowTitle,
    copy: String(options.flowCopy || '').trim() || language.flowCopy,
    status: String(options.flowStatus || readiness.label || '未提供').trim() || '未提供',
    readiness: String(options.flowReadiness || readiness.detail || '未提供').trim() || '未提供',
    focus: String(options.flowFocus || statePrepare.currentFocus || (importedBindingCount > 0 ? '先确认素材绑定和主体稳定' : '先确认方向和放行判断')).trim() || '未提供',
    actionLabel: String(options.flowActionLabel || statePrepare.nextStepLabel || '结果工作台').trim() || '结果工作台',
    actionSummary: String(options.flowActionSummary || statePrepare.nextStepReason || '确认完准备条件后，再进入结果工作台继续主链。').trim() || '确认完准备条件后，再进入结果工作台继续主链。',
    completion: String(options.flowCompletion || '').trim() || (readiness.tone === 'bad' ? copy.flowCompletionBad : (readiness.tone === 'warn' ? copy.flowCompletionWarn : copy.flowCompletionGood)),
    blockers: toArray(options.flowBlockers).length ? toArray(options.flowBlockers) : toArray(readiness.blockingItems),
    availableActions: toArray(options.flowAvailableActions),
  };
  return {
    hero: {
      eyebrow: runtimeEyebrow,
      title: String(options.title || '').trim() || 'DAOGE 准备工作台',
      intro: runtimeIntro,
    },
    context: {
      runLabel: String(options.runLabel || '').trim(),
      phaseLabel: runtimePhaseLabel,
      flowLabel: String(options.flowLabel || '').trim() || identity.flows.prepare,
      counts: toArray(options.contextCounts),
      hints: toArray(options.contextHints),
    },
    heroCards: toArray(options.heroCards),
    taskControlBar: options.taskControlBar || null,
    signalBar: options.signalBar || null,
    statusStack: toArray(options.statusStack),
    sessionConsole: options.sessionConsole || null,
    controlRail: options.controlRail || buildViewControlRail({
      taskLabel: String(options.runLabel || '').trim(),
      stageLabel: String(options.phaseLabel || identity.stages.prepare).trim() || identity.stages.prepare,
      statusLabel: String(readiness.label || '').trim(),
      pressureLabel: toArray(readiness.blockingItems).length > 0 ? `${toArray(readiness.blockingItems).length} 项阻塞` : '当前平稳',
      nextActionLabel: flow.actionLabel,
      nextActionSummary: flow.actionSummary,
      recommendedReply: options.confirmation?.recommendedReply || options.actionStatus?.recommendedReply || options.dialogueStatus?.primarySay,
      taskControlBar: options.taskControlBar || null,
      signalBar: options.signalBar || null,
      statusStack: options.statusStack || [],
      confirmation: options.confirmation || null,
      actionStatus: options.actionStatus || null,
      dialogueStatus: options.dialogueStatus || null,
    }),
    cockpitSummary: options.cockpitSummary || buildPrepareCockpitSummary(statePrepare),
    confirmation: options.confirmation || null,
    timeline: options.timeline || null,
    progress: options.progress || null,
    judgment: options.judgment || buildPrepareJudgmentPanel(statePrepare),
    decision: {
      title: language.decisionTitle,
      copy: language.decisionCopy,
      items: [
        { label: labels.readiness, value: String(options.flowStatus || readiness.label || '未提供').trim() || '未提供' },
        { label: labels.currentFocus, value: String(statePrepare.currentFocus || '').trim() || (importedBindingCount > 0 ? '先确认素材绑定和主体稳定' : '先确认方向和放行判断') },
        { label: labels.nextAction, value: String(statePrepare.nextStepLabel || '').trim() || identity.pages.result },
        { label: labels.currentConclusion, value: String(options.flowReadiness || readiness.detail || '未提供').trim() || '未提供' },
      ],
    },
    summary: {
      title: runtimeSummaryTitle,
      copy: copy.summaryCopy,
      items: [
        { label: '当前阶段', value: runtimeSummaryStage },
        { label: '当前结论', value: String(options.flowStatus || readiness.label || '未提供').trim() || '未提供' },
        { label: '结果概况', value: runtimeStageOverview },
        { label: '当前重点', value: String(statePrepare.currentFocus || '').trim() || (importedBindingCount > 0 ? '先确认素材绑定和主体稳定' : '先确认方向和放行判断') },
        { label: '下一步', value: String(statePrepare.nextStepLabel || '').trim() || '进入结果工作台' },
        { label: '为什么先做这一步', value: String(statePrepare.nextStepReason || options.flowReadiness || readiness.detail || '先把准备条件收清，再进入结果工作台。').trim() || '先把准备条件收清，再进入结果工作台。' },
      ],
    },
    route: buildWorkspaceRouteSectionData({
      source: options.route,
      title: language.routeTitle,
      copy: language.routeCopy,
      current: options.routeCurrent || null,
      previous: options.previous || null,
      nextSteps: toArray(options.nextSteps),
    }),
    workbench: buildWorkspaceWorkbenchSectionData({
      source: options.workbench,
      title: language.workbenchTitle,
      copy: language.workbenchCopy,
      cards: toArray(options.workbenchCards),
    }),
    guides: {
      entryStructure: options.entryGuide || null,
      assetVisibility: options.assetGuide || null,
    },
    assetStatus: options.assetStatus || buildAssetStatus(),
    actionStatus: options.actionStatus || buildActionStatus(),
    dialogueStatus: options.dialogueStatus || buildDialogueStatus(),
    transitionStatus: options.transitionStatus || buildTransitionStatus(),
    stageRelay: options.stageRelay || null,
    copilot: options.copilot || null,
    workflowCopilot: options.workflowCopilot || null,
    workflowContract: options.workflowContract || null,
    contentSections: buildWorkspaceContentSectionPlan(options.contentSections, [
      { key: 'direction', kind: 'keyValue' },
      { key: 'readiness', kind: 'readinessGrid' },
      { key: 'assets', kind: 'keyValue' },
      { key: 'guide', kind: 'keyValue' },
      { key: 'visibility', kind: 'keyValue' },
    ]),
    flow,
    sections: {
      guide: buildWorkspaceGuideSectionData({
        title: options.guideTitle,
        copy: String(options.guideCopy || '').trim() || copy.guideCopy,
        items: toArray(options.guideItems),
      }),
      visibility: buildWorkspaceGuideSectionData({
        title: options.visibilityTitle,
        copy: String(options.visibilityCopy || '').trim() || copy.visibilityCopy,
        items: toArray(options.visibilityItems),
      }),
      direction: buildWorkspaceDirectionSectionData({
        title: options.directionTitle,
        copy: String(options.directionCopy || '').trim() || copy.directionCopy,
        items: toArray(options.directionItems),
      }),
      readiness: buildWorkspaceReadinessSectionData({
        title: options.readinessTitle,
        copy: String(options.readinessCopy || '').trim() || copy.readinessCopy,
        blockingTitle: options.blockingTitle,
        cautionTitle: options.cautionTitle,
        blockingItems: toArray(options.readinessBlockingItems),
        cautionItems: toArray(options.readinessCautionItems),
        blockingEmptyText: options.readinessBlockingEmptyText,
        cautionEmptyText: options.readinessCautionEmptyText,
      }),
      assets: buildWorkspaceAssetsSectionData({
        title: options.assetsTitle,
        copy: String(options.assetsCopy || '').trim() || copy.assetsCopy,
        items: toArray(options.assetsItems),
      }),
    },
  };
}

function getUserAssetLayer(workspaceAssets) {
  return workspaceAssets?.layers?.userFacing || {};
}

function getUserAssetGroup(workspaceAssets, key) {
  const groups = toArray(getUserAssetLayer(workspaceAssets)?.groups);
  return groups.find((item) => item && item.key === key) || null;
}

function getUserAssetItems(workspaceAssets, key) {
  const canonicalItems = readAssetCollection(workspaceAssets, key);
  if (canonicalItems.length) return canonicalItems;
  const items = getUserAssetLayer(workspaceAssets)?.items || {};
  return toArray(items?.[key]);
}

function buildHomeAssetStatus(workspaceState, workspaceAssets, options = {}) {
  const copy = getWorkspaceCopyTemplates('home');
  const counts = workspaceState?.counts || {};
  const previewCount = Number(getUserAssetGroup(workspaceAssets, 'preview')?.count ?? getUserAssetItems(workspaceAssets, 'preview').length ?? 0);
  const resultCount = Number(getUserAssetGroup(workspaceAssets, 'result')?.count ?? getUserAssetItems(workspaceAssets, 'result').length ?? counts.success ?? 0);
  const reviewCount = Number(getUserAssetGroup(workspaceAssets, 'review')?.count ?? getUserAssetItems(workspaceAssets, 'review').length ?? counts.needsReview ?? 0);
  const failedCount = Number(getUserAssetGroup(workspaceAssets, 'exception')?.count ?? getUserAssetItems(workspaceAssets, 'exception').length ?? counts.failed ?? 0);
  const issueCount = failedCount + reviewCount;
  const referenceCount = Number(getUserAssetGroup(workspaceAssets, 'reference')?.count ?? getUserAssetItems(workspaceAssets, 'reference').length ?? 0);
  const userFacingCount = Number(workspaceAssets?.summary?.userFacingCount || 0);
  return buildAssetStatus({
    title: '资产状态',
    copy: userFacingCount > 0
      ? `首页先看这 ${userFacingCount} 项用户资产里，哪些已经能继续推进，哪些还会卡主链。`
      : copy.assetCopy,
    readySummary: resultCount > 0 || previewCount > 0
      ? `当前已有 ${Math.max(resultCount, previewCount)} 项结果可继续查看`
      : '当前还没有稳定结果资产',
    pendingSummary: issueCount > 0
      ? `${issueCount} 项结果仍待确认或处理`
      : '当前主要资产已经比较稳定',
    items: [
      {
        label: '预览图',
        value: previewCount > 0 ? `${previewCount} 张可直接查看` : '当前还没有',
        summary: previewCount > 0 ? '可以直接进入结果工作台继续筛图。' : '执行完成后会先在这里形成缩略预览。',
        tone: previewCount > 0 ? 'good' : 'neutral',
      },
      {
        label: '可直接使用结果',
        value: resultCount > 0 ? `${resultCount} 项` : '当前还没有',
        summary: resultCount > 0 ? '这些结果已经能进入保留、取舍和收口环节。' : '当前还没有沉淀出稳定可用结果。',
        tone: resultCount > 0 ? 'good' : 'neutral',
      },
      {
        label: '待确认结果',
        value: issueCount > 0 ? `${issueCount} 项` : '当前没有',
        summary: issueCount > 0 ? '建议先看异常工作台，把失败项和待复核项收清。' : '当前没有明显需要额外确认的结果。',
        tone: issueCount > 0 ? 'warn' : 'good',
      },
      {
        label: '参考素材',
        value: referenceCount > 0 ? `${referenceCount} 项已引入` : '当前没有',
        summary: referenceCount > 0 ? '后续判断时要多关注绑定关系和主体稳定。' : '这一轮更偏自由生成路线。',
        tone: referenceCount > 0 ? 'info' : 'neutral',
      },
    ],
  });
}

function buildPrepareAssetStatus(prepareSummary, workspaceAssets) {
  const copy = getWorkspaceCopyTemplates('prepare');
  const importedBindingCount = Number(prepareSummary?.importedBindingCount || 0);
  const referenceCount = Number(getUserAssetGroup(workspaceAssets, 'reference')?.count ?? getUserAssetItems(workspaceAssets, 'reference').length ?? 0);
  const assetCount = Number(prepareSummary?.assetCount || referenceCount || 0);
  const readiness = prepareSummary?.readiness || {};
  const blockingCount = toArray(readiness.blockingItems).length;
  const cautionCount = toArray(readiness.cautionItems).length;
  return buildAssetStatus({
    title: '资产状态',
    copy: referenceCount > 0
      ? `准备层只看真正会影响放行的 ${referenceCount} 项参考资产和素材绑定。`
      : copy.assetCopy,
    readySummary: importedBindingCount > 0
      ? `已有 ${importedBindingCount} 项绑定素材可直接进入准备判断`
      : '当前没有素材约束，可直接按任务方向判断',
    pendingSummary: blockingCount + cautionCount > 0
      ? `${blockingCount + cautionCount} 项准备风险仍待确认`
      : '当前准备资产已经比较干净',
    items: [
      {
        label: '任务方向',
        value: String(prepareSummary?.mainDirection || '').trim() || '未提供',
        summary: '这是当前准备层最核心的方向锚点。',
        tone: 'good',
      },
      {
        label: '素材绑定',
        value: importedBindingCount > 0 ? `${importedBindingCount} 项已绑定` : '当前没有',
        summary: importedBindingCount > 0 ? '存在参考图或绑定约束，后续要更关注稳定性。' : '没有素材约束时，可以优先关注风格和构图方向。',
        tone: importedBindingCount > 0 ? 'good' : 'neutral',
      },
      {
        label: '参考资产',
        value: assetCount > 0 ? `${assetCount} 项` : '当前没有',
        summary: assetCount > 0 ? '这些资产会影响准备层的方向确认和后续执行。' : '当前没有额外参考资产需要纳入判断。',
        tone: assetCount > 0 ? 'info' : 'neutral',
      },
      {
        label: '待确认准备项',
        value: blockingCount + cautionCount > 0 ? `${blockingCount + cautionCount} 项` : '当前没有',
        summary: blockingCount > 0 ? '存在会直接影响放行的准备风险。' : (cautionCount > 0 ? '建议再收一轮，让执行更稳。' : '当前准备层没有明显待确认项。'),
        tone: blockingCount > 0 ? 'bad' : (cautionCount > 0 ? 'warn' : 'good'),
      },
    ],
  });
}

function buildResultAssetStatus(workspaceState, workspaceAssets) {
  const copy = getWorkspaceCopyTemplates('result');
  const counts = workspaceState?.counts || {};
  const previewCount = Number(getUserAssetGroup(workspaceAssets, 'preview')?.count ?? getUserAssetItems(workspaceAssets, 'preview').length ?? 0);
  const resultCount = Number(getUserAssetGroup(workspaceAssets, 'result')?.count ?? getUserAssetItems(workspaceAssets, 'result').length ?? counts.success ?? 0);
  const reviewCount = Number(getUserAssetGroup(workspaceAssets, 'review')?.count ?? getUserAssetItems(workspaceAssets, 'review').length ?? counts.needsReview ?? 0);
  const failedCount = Number(getUserAssetGroup(workspaceAssets, 'exception')?.count ?? getUserAssetItems(workspaceAssets, 'exception').length ?? counts.failed ?? 0);
  return buildAssetStatus({
    title: '资产状态',
    copy: (previewCount + resultCount + reviewCount + failedCount) > 0
      ? `结果层先把 ${resultCount} 项可用结果、${reviewCount} 项待复核和 ${failedCount} 项异常结果拆开给你看。`
      : copy.assetCopy,
    readySummary: resultCount > 0
      ? `${resultCount} 项结果已经进入可筛选状态`
      : '当前还没有进入稳定结果阶段',
    pendingSummary: failedCount + reviewCount > 0
      ? `${failedCount + reviewCount} 项结果仍待处理`
      : '当前结果层资产已经比较稳定',
    items: [
      {
        label: '可直接使用结果',
        value: resultCount > 0 ? `${resultCount} 项` : '当前还没有',
        summary: resultCount > 0 ? '可以直接进入保留、淘汰和最终收口。' : '当前还没有沉淀出可直接用的结果。',
        tone: resultCount > 0 ? 'good' : 'neutral',
      },
      {
        label: '预览图',
        value: previewCount > 0 ? `${previewCount} 张` : '当前没有',
        summary: previewCount > 0 ? '这些缩略预览适合先做第一轮快速筛选。' : '如果没有预览图，就先看结果是否已完成生成。',
        tone: previewCount > 0 ? 'good' : 'neutral',
      },
      {
        label: '待复核结果',
        value: reviewCount > 0 ? `${reviewCount} 项` : '当前没有',
        summary: reviewCount > 0 ? '建议人工再看一眼边界、构图和主体稳定。' : '当前没有明显边界结果。',
        tone: reviewCount > 0 ? 'warn' : 'good',
      },
      {
        label: '异常结果',
        value: failedCount > 0 ? `${failedCount} 项` : '当前没有',
        summary: failedCount > 0 ? '这些结果建议转到异常工作台统一处理。' : '当前没有硬失败结果。',
        tone: failedCount > 0 ? 'bad' : 'good',
      },
    ],
  });
}

function buildExceptionAssetStatus(workspaceState, workspaceAssets, rerunCandidates) {
  const copy = getWorkspaceCopyTemplates('exception');
  const counts = workspaceState?.counts || {};
  const failedCount = Number(getUserAssetGroup(workspaceAssets, 'exception')?.count ?? getUserAssetItems(workspaceAssets, 'exception').length ?? counts.failed ?? 0);
  const reviewCount = Number(getUserAssetGroup(workspaceAssets, 'review')?.count ?? getUserAssetItems(workspaceAssets, 'review').length ?? counts.needsReview ?? 0);
  const rerunCount = Array.isArray(rerunCandidates) ? rerunCandidates.length : 0;
  const resultCount = Number(getUserAssetGroup(workspaceAssets, 'result')?.count ?? getUserAssetItems(workspaceAssets, 'result').length ?? 0);
  return buildAssetStatus({
    title: '资产状态',
    copy: failedCount + reviewCount + rerunCount > 0
      ? `异常层只保留 ${failedCount + reviewCount + rerunCount} 项真的会影响主链继续的问题资产。`
      : copy.assetCopy,
    readySummary: resultCount > 0
      ? `仍有 ${resultCount} 项正常结果可回结果工作台继续判断`
      : '当前主要精力应放在异常处理',
    pendingSummary: failedCount + reviewCount + rerunCount > 0
      ? `${failedCount + reviewCount + rerunCount} 项异常相关资产仍待处理`
      : '当前异常相关资产已经基本清空',
    items: [
      {
        label: '失败结果',
        value: failedCount > 0 ? `${failedCount} 项` : '当前没有',
        summary: failedCount > 0 ? '这些结果会直接影响主链继续。' : '当前没有硬失败结果。',
        tone: failedCount > 0 ? 'bad' : 'good',
      },
      {
        label: '待复核结果',
        value: reviewCount > 0 ? `${reviewCount} 项` : '当前没有',
        summary: reviewCount > 0 ? '这类结果通常需要人工做最后判断。' : '当前没有额外复核压力。',
        tone: reviewCount > 0 ? 'warn' : 'good',
      },
      {
        label: '补跑候选',
        value: rerunCount > 0 ? `${rerunCount} 项` : '当前没有',
        summary: rerunCount > 0 ? '只有确定真的要补跑时，再进入补跑动作。' : '当前无需额外补跑。',
        tone: rerunCount > 0 ? 'info' : 'neutral',
      },
      {
        label: '可回收的正常结果',
        value: resultCount > 0 ? `${resultCount} 项` : '当前很少',
        summary: resultCount > 0 ? '异常处理时也别忘了，主链里仍有正常结果可继续判断。' : '这轮当前主要是问题收口，不是结果筛选。',
        tone: resultCount > 0 ? 'good' : 'neutral',
      },
    ],
  });
}

function buildHomeActionStatus(workspaceState, routes, options = {}) {
  const panelLanguage = getWorkspacePanelLanguage('home');
  const interaction = getWorkspaceInteractionTemplates('home');
  const issueCount = Number(workspaceState?.counts?.failed || 0) + Number(workspaceState?.counts?.needsReview || 0);
  const nextAction = workspaceState?.nextAction || {};
  const primaryAction = resolvePrimaryActionLanguage(nextAction);
  const revisitPrepareAction = buildActionLanguage('revisit_prepare');
  const issueAction = buildActionLanguage('view_exception_issues');
  return buildActionStatus({
    title: '行动建议',
    copy: panelLanguage.actionCopy,
    primary: {
      kicker: '现在先做',
      title: primaryAction.actionLabel,
      summary: String(nextAction.reason || '').trim() || '先按主链继续当前最合适的下一步。',
      file: nextAction.target ? path.join(options.outputDir || '', nextAction.target) : routes.prepare,
      cta: primaryAction.ctaLabel,
      tone: issueCount > 0 ? 'warn' : 'good',
    },
    secondary: [
      fileExists(routes.prepare) ? {
        kicker: '辅助动作',
        title: revisitPrepareAction.actionLabel,
        summary: interaction.action.secondaryPrepareSummary,
        file: routes.prepare,
        cta: revisitPrepareAction.ctaLabel,
        tone: 'info',
      } : null,
      issueCount > 0 && fileExists(routes.exception) ? {
        kicker: '辅助动作',
        title: issueAction.actionLabel,
        summary: interaction.action.secondaryIssueSummary,
        file: routes.exception,
        cta: issueAction.ctaLabel,
        tone: 'warn',
      } : null,
    ].filter(Boolean),
    notes: [
      issueCount > 0 ? interaction.action.noteIssue : interaction.action.noteMainline,
    ],
    recommendedReply: String(workspaceState?.confirmationState?.recommendedReply || '').trim(),
    actionReason: String(nextAction.reason || workspaceState?.confirmationState?.summary || '').trim()
      || '当前直接按推荐动作继续即可。',
  });
}

function buildPrepareActionStatus(prepareSummary, routes) {
  const panelLanguage = getWorkspacePanelLanguage('prepare');
  const interaction = getWorkspaceInteractionTemplates('prepare');
  const readiness = prepareSummary?.readiness || {};
  const importedBindingCount = Number(prepareSummary?.importedBindingCount || 0);
  const hasBlocking = toArray(readiness.blockingItems).length > 0;
  const hasCaution = toArray(readiness.cautionItems).length > 0;
  const primaryAction = hasBlocking ? buildActionLanguage('refine_prepare') : buildActionLanguage('go_result');
  const materialAction = buildActionLanguage('view_material_bindings');
  const cautionAction = buildActionLanguage('view_cautions');
  return buildActionStatus({
    title: '行动建议',
    copy: panelLanguage.actionCopy,
    primary: {
      kicker: '现在先做',
      title: String(prepareSummary?.nextStepLabel || '').trim() || primaryAction.actionLabel,
      summary: hasBlocking
        ? interaction.action.primaryBlocked
        : interaction.action.primaryClear,
      file: hasBlocking ? routes.prepare : routes.result,
      cta: primaryAction.ctaLabel,
      tone: hasBlocking ? 'bad' : 'good',
    },
    secondary: [
      importedBindingCount > 0 ? {
        kicker: '辅助动作',
        title: materialAction.actionLabel,
        summary: interaction.action.secondaryMaterialSummary,
        file: routes.prepare,
        cta: materialAction.ctaLabel,
        tone: 'warn',
      } : null,
      hasCaution ? {
        kicker: '辅助动作',
        title: cautionAction.actionLabel,
        summary: interaction.action.secondaryCautionSummary,
        file: routes.prepare,
        cta: cautionAction.ctaLabel,
        tone: 'info',
      } : null,
    ].filter(Boolean),
    notes: [
      hasBlocking
        ? interaction.action.noteBlocked
        : (importedBindingCount > 0 ? interaction.action.noteBinding : interaction.action.noteClear),
    ],
    recommendedReply: String(prepareSummary?.confirmationState?.recommendedReply || '').trim(),
    actionReason: String(
      prepareSummary?.nextStepReason
      || prepareSummary?.confirmationState?.summary
      || readiness.detail
      || ''
    ).trim() || '当前可以先按准备层推荐动作继续。',
  });
}

function buildResultActionStatus(workspaceState, routes, options = {}) {
  const panelLanguage = getWorkspacePanelLanguage('result');
  const interaction = getWorkspaceInteractionTemplates('result');
  const resultSummary = options.resultSummary || workspaceState?.result || {};
  const failedCount = Number(workspaceState?.counts?.failed || 0);
  const reviewCount = Number(workspaceState?.counts?.needsReview || 0);
  const hasStoryboard = Boolean(options.hasStoryboard);
  const primaryAction = failedCount > 0 ? buildActionLanguage('go_exception') : buildActionLanguage('review_result');
  const reviewAction = buildActionLanguage('view_review_items');
  const storyboardAction = buildActionLanguage('go_storyboard');
  return buildActionStatus({
    title: '行动建议',
    copy: panelLanguage.actionCopy,
    primary: {
      kicker: '现在先做',
      title: primaryAction.actionLabel,
      summary: failedCount > 0
        ? interaction.action.primaryFailed
        : interaction.action.primaryClear,
      file: failedCount > 0 ? routes.exception : routes.result,
      cta: primaryAction.ctaLabel,
      tone: failedCount > 0 ? 'bad' : 'good',
    },
    secondary: [
      reviewCount > 0 ? {
        kicker: '辅助动作',
        title: reviewAction.actionLabel,
        summary: interaction.action.secondaryReviewSummary,
        file: routes.exception,
        cta: reviewAction.ctaLabel,
        tone: 'warn',
      } : null,
      hasStoryboard && routes.storyboard ? {
        kicker: '辅助动作',
        title: storyboardAction.actionLabel,
        summary: interaction.action.secondaryStoryboardSummary,
        file: routes.storyboard,
        cta: storyboardAction.ctaLabel,
        tone: 'info',
      } : null,
    ].filter(Boolean),
    notes: [
      failedCount > 0
        ? interaction.action.noteFailed
        : (reviewCount > 0 ? interaction.action.noteReview : interaction.action.noteStable),
    ],
    recommendedReply: String(resultSummary?.confirmationState?.recommendedReply || '').trim(),
    actionReason: String(
      workspaceState?.nextAction?.reason
      || resultSummary?.nextStepReason
      || resultSummary?.confirmationState?.summary
      || ''
    ).trim() || '当前建议先按结果层推荐动作继续。',
  });
}

function buildExceptionActionStatus(workspaceState, routes, rerunCandidates, options = {}) {
  const panelLanguage = getWorkspacePanelLanguage('exception');
  const interaction = getWorkspaceInteractionTemplates('exception');
  const exceptionSummary = options.exceptionSummary || workspaceState?.exception || {};
  const failedCount = Number(workspaceState?.counts?.failed || 0);
  const reviewCount = Number(workspaceState?.counts?.needsReview || 0);
  const rerunCount = Array.isArray(rerunCandidates) ? rerunCandidates.length : 0;
  const hasStoryboard = Boolean(options.hasStoryboard);
  const primaryAction = failedCount > 0 ? buildActionLanguage('resolve_failed') : buildActionLanguage('review_exception');
  const reviewAction = buildActionLanguage('view_review_items');
  const rerunAction = buildActionLanguage('view_rerun_candidates');
  const storyboardAction = buildActionLanguage('go_storyboard');
  return buildActionStatus({
    title: '行动建议',
    copy: panelLanguage.actionCopy,
    primary: {
      kicker: '现在先做',
      title: primaryAction.actionLabel,
      summary: failedCount > 0
        ? interaction.action.primaryFailed
        : interaction.action.primaryClear,
      file: failedCount > 0 ? routes.exception : routes.result,
      cta: primaryAction.ctaLabel,
      tone: failedCount > 0 ? 'bad' : 'good',
    },
    secondary: [
      reviewCount > 0 ? {
        kicker: '辅助动作',
        title: reviewAction.actionLabel,
        summary: interaction.action.secondaryReviewSummary,
        file: routes.exception,
        cta: reviewAction.ctaLabel,
        tone: 'warn',
      } : null,
      rerunCount > 0 ? {
        kicker: '辅助动作',
        title: rerunAction.actionLabel,
        summary: interaction.action.secondaryRerunSummary,
        file: routes.exception,
        cta: rerunAction.ctaLabel,
        tone: 'info',
      } : null,
      hasStoryboard && routes.storyboard ? {
        kicker: '辅助动作',
        title: storyboardAction.actionLabel,
        summary: interaction.action.secondaryStoryboardSummary,
        file: routes.storyboard,
        cta: storyboardAction.ctaLabel,
        tone: 'info',
      } : null,
    ].filter(Boolean),
    notes: [
      failedCount > 0
        ? interaction.action.noteFailed
        : (rerunCount > 0 ? interaction.action.noteRerun : interaction.action.noteReviewOnly),
    ],
    recommendedReply: String(exceptionSummary?.confirmationState?.recommendedReply || '').trim(),
    actionReason: String(
      exceptionSummary?.nextStepReason
      || exceptionSummary?.confirmationState?.summary
      || exceptionSummary?.issueSummary
      || ''
    ).trim() || '当前建议先按异常层推荐动作继续。',
  });
}

function buildPrepareToResultTransitionStatus(prepareSummary) {
  const panelLanguage = getWorkspacePanelLanguage('prepare');
  const language = getWorkspaceLanguageSystem('prepare');
  const readiness = prepareSummary?.readiness || {};
  const importedBindingCount = Number(prepareSummary?.importedBindingCount || 0);
  const blockingCount = toArray(readiness.blockingItems).length;
  const cautionCount = toArray(readiness.cautionItems).length;
  return buildTransitionStatus({
    title: language.transitionTitle,
    copy: panelLanguage.transitionCopy,
    confirmedTitle: language.transitionConfirmedTitle,
    nextFocusTitle: language.transitionNextFocusTitle,
    confirmedItems: [
      `放行状态: ${String(readiness.label || '未提供').trim() || '未提供'}`,
      `任务方向: ${String(prepareSummary?.mainDirection || '未提供').trim() || '未提供'}`,
      `风格主轴: ${String(prepareSummary?.styleDirection || '未指定').trim() || '未指定'}`,
      importedBindingCount > 0 ? `素材绑定: 已确认 ${importedBindingCount} 项约束` : '素材绑定: 当前没有额外素材约束',
      blockingCount > 0 ? `阻塞项: 仍有 ${blockingCount} 项需要先处理` : '阻塞项: 当前没有硬阻塞',
    ],
    nextFocusItems: buildPrepareTransitionNextFocusItems({ blockingCount, importedBindingCount, cautionCount }),
  });
}

function buildResultFromPrepareTransitionStatus(prepareSummary, resultSummary) {
  const panelLanguage = getWorkspacePanelLanguage('result');
  const language = getWorkspaceLanguageSystem('result');
  const interaction = getWorkspaceInteractionTemplates('result');
  const importedBindingCount = Number(prepareSummary?.importedBindingCount || 0);
  return buildTransitionStatus({
    title: language.fromPrepareTitle,
    copy: panelLanguage.transitionCopy,
    confirmedTitle: language.fromPrepareConfirmedTitle,
    nextFocusTitle: language.fromPrepareNextFocusTitle,
    confirmedItems: [
      `准备结论: ${String(prepareSummary?.readiness?.detail || '未提供').trim() || '未提供'}`,
      `任务主轴: ${String(prepareSummary?.mainDirection || '未提供').trim() || '未提供'}`,
      `风格主轴: ${String(prepareSummary?.styleDirection || '未指定').trim() || '未指定'}`,
      importedBindingCount > 0 ? `素材约束: 已带入 ${importedBindingCount} 项绑定关系` : '素材约束: 当前没有额外绑定条件',
    ],
    nextFocusItems: [
      String(resultSummary?.currentFocus || '').trim() || interaction.fromPrepare.nextDefault,
      importedBindingCount > 0 ? interaction.fromPrepare.nextBinding : interaction.fromPrepare.nextNoBinding,
      Number(resultSummary?.failedCount || 0) > 0 ? interaction.fromPrepare.nextFailed : interaction.fromPrepare.nextClear,
    ],
  });
}

function buildResultToExceptionTransitionStatus(resultSummary, exceptionSummary) {
  const panelLanguage = getWorkspacePanelLanguage('result');
  const language = getWorkspaceLanguageSystem('result');
  const failedCount = Number(resultSummary?.failedCount || 0);
  const reviewCount = Number(resultSummary?.reviewCount || 0);
  const rerunCount = Number(exceptionSummary?.rerunCount || 0);
  return buildTransitionStatus({
    title: language.toExceptionTitle,
    copy: panelLanguage.transitionCopy,
    confirmedTitle: language.toExceptionConfirmedTitle,
    nextFocusTitle: language.toExceptionNextFocusTitle,
    confirmedItems: [
      failedCount > 0 ? `失败项: 当前发现 ${failedCount} 项需要优先处理` : '失败项: 当前没有硬失败',
      reviewCount > 0 ? `待复核项: 当前有 ${reviewCount} 项建议再确认` : '待复核项: 当前没有额外复核压力',
      String(resultSummary?.currentFocus || '').trim() || '当前结果页已经给出本轮重点判断',
      String(resultSummary?.nextStepReason || '').trim() || '当前建议只在确实有问题时再转入异常页',
    ],
    nextFocusItems: buildResultToExceptionNextFocusItems({ failedCount, reviewCount, rerunCount }),
  });
}

function buildExceptionFromResultTransitionStatus(resultSummary, exceptionSummary) {
  const panelLanguage = getWorkspacePanelLanguage('exception');
  const language = getWorkspaceLanguageSystem('exception');
  const failedCount = Number(exceptionSummary?.failedCount || resultSummary?.failedCount || 0);
  const reviewCount = Number(exceptionSummary?.reviewCount || resultSummary?.reviewCount || 0);
  const rerunCount = Number(exceptionSummary?.rerunCount || 0);
  return buildTransitionStatus({
    title: language.fromResultTitle,
    copy: panelLanguage.transitionCopy,
    confirmedTitle: language.fromResultConfirmedTitle,
    nextFocusTitle: language.fromResultNextFocusTitle,
    confirmedItems: [
      `结果页判断: ${String(resultSummary?.statusLabel || '未提供').trim() || '未提供'}`,
      failedCount > 0 ? `失败项: 已带入 ${failedCount} 项` : '失败项: 当前没有硬失败',
      reviewCount > 0 ? `待复核项: 已带入 ${reviewCount} 项` : '待复核项: 当前没有额外待复核项',
      String(resultSummary?.nextStepReason || '').trim() || '结果页已经说明为什么现在更适合先处理异常',
    ],
    nextFocusItems: buildExceptionFromResultNextFocusItems({
      currentFocus: exceptionSummary?.currentFocus,
      failedCount,
      rerunCount,
    }),
  });
}

function buildExceptionBackToMainlineTransitionStatus(exceptionSummary, resultSummary, options = {}) {
  const panelLanguage = getWorkspacePanelLanguage('exception');
  const language = getWorkspaceLanguageSystem('exception');
  const interaction = getWorkspaceInteractionTemplates('exception');
  const failedCount = Number(exceptionSummary?.failedCount || 0);
  const reviewCount = Number(exceptionSummary?.reviewCount || 0);
  const rerunCount = Number(exceptionSummary?.rerunCount || 0);
  const returnLabel = String(options.returnLabel || '').trim() || '回结果工作台';
  const hasStoryboard = Boolean(options.hasStoryboard);
  return buildTransitionStatus({
    title: language.backToMainlineTitle,
    copy: panelLanguage.transitionCopy,
    confirmedTitle: language.backToMainlineConfirmedTitle,
    nextFocusTitle: language.backToMainlineNextFocusTitle,
    confirmedItems: buildExceptionBackToMainlineConfirmedItems({
      failedCount,
      reviewCount,
      rerunCount,
      summaryText: String(exceptionSummary?.issueSummary || resultSummary?.statusSummary || '').trim(),
    }),
    nextFocusItems: [
      `${returnLabel}${interaction.backToMainline.nextConfirm}`,
      failedCount > 0 ? interaction.backToMainline.nextFailed : interaction.backToMainline.nextClear,
      hasStoryboard ? interaction.backToMainline.nextStoryboard : interaction.backToMainline.nextNoStoryboard,
    ],
  });
}

function buildHomeDialogueStatus(workspaceState, nextAction) {
  const interaction = getWorkspaceInteractionTemplates('home');
  const issueCount = Number(workspaceState?.counts?.failed || 0) + Number(workspaceState?.counts?.needsReview || 0);
  const confirmationState = workspaceState?.confirmationState || {};
  const nextActionLabel = String(nextAction?.label || '未提供').trim() || '未提供';
  const fallbackReplies = buildDialogueReplyFallbacks('home', {
    issueCount,
    nextActionLabel,
  });
  const nextSayItems = buildNextReplyDialogueItems(confirmationState, fallbackReplies);
  const cadence = buildStageCadenceSummary({
    recommendedReply: confirmationState.recommendedReply,
    primarySay: confirmationState.recommendedReply || nextSayItems[0] || '',
    replyReason: nextAction?.reason || confirmationState.summary,
    directReplies: nextSayItems,
    digestItems: [
      `${interaction.dialogue.recentPhaseLabel}: ${String(workspaceState?.status?.phase || '未提供').trim() || '未提供'}`,
      `${interaction.dialogue.recentActionLabel}: ${nextActionLabel}`,
    ],
    summary: confirmationState.summary,
  });
  return buildDialogueStatus({
    nextSayTitle: '回到对话框直接说',
    recentItems: buildRecentDialogueItems(confirmationState, [
      `${interaction.dialogue.recentPhaseLabel}: ${String(workspaceState?.status?.phase || '未提供').trim() || '未提供'}`,
      `${interaction.dialogue.recentActionLabel}: ${nextActionLabel}`,
    ]),
    understoodItems: buildUnderstoodDialogueItems(confirmationState, [
      `当前阶段: ${String(workspaceState?.status?.phase || '未提供').trim() || '未提供'}`,
      `推荐下一步: ${nextActionLabel}`,
      issueCount > 0 ? `待处理问题: ${issueCount} 项` : interaction.dialogue.understoodIssueNone,
    ]),
    nextSayItems: cadence.directReplies,
    primarySay: cadence.primarySay,
    actionReason: String(cadence.replyReason || '').trim()
      || '当前建议先按主链继续，不需要再自己判断要切去哪一页。',
    summary: String(confirmationState.summary || '').trim(),
  });
}

function buildHomeCockpitSummary(workspaceState, options = {}) {
  const status = workspaceState?.status || {};
  const risk = workspaceState?.risk || {};
  const nextAction = options.nextAction || workspaceState?.nextAction || {};
  const issueCount = Number(workspaceState?.counts?.failed || 0) + Number(workspaceState?.counts?.needsReview || 0);
  const hasResult = Boolean(options.hasResult);
  const hasPrepare = Boolean(options.hasPrepare);
  const currentFocus = String(nextAction.reason || '').trim() || '按当前主链继续即可，不需要自己判断要切去哪一页。';
  return buildCockpitSummary({
    title: '驾驶舱摘要',
    copy: '这里只解释首页当前局面、当前重点和阻塞情况，不重复上方动作建议。',
    items: [
      {
        label: '当前局面',
        value: String(status.phase || '未提供').trim() || '未提供',
        summary: buildHomeDecisionSummary({
          hasFailure: Number(workspaceState?.counts?.failed || 0) > 0,
          hasResult,
          hasPrepare,
        }),
        tone: issueCount > 0 ? 'warn' : 'info',
      },
      {
        label: '当前重点',
        value: issueCount > 0 ? '先处理异常，再回工作台继续' : '确认当前工作台方向',
        summary: currentFocus,
        tone: 'good',
      },
      {
        label: '阻塞情况',
        value: issueCount > 0 ? `${issueCount} 项待处理` : '当前可继续',
        summary: String(risk.summary || '').trim() || '当前没有明显异常压力。',
        tone: issueCount > 0 ? 'bad' : 'good',
      },
    ],
  });
}

function buildHomeJudgmentPanel(workspaceState, nextAction) {
  const confirmationState = workspaceState?.confirmationState || {};
  const issueCount = Number(workspaceState?.counts?.failed || 0) + Number(workspaceState?.counts?.needsReview || 0);
  const nextReply = String(confirmationState.recommendedReply || getStageContinuationCopy('home')).trim() || getStageContinuationCopy('home');
  return buildJudgmentPanel({
    title: '主控判断',
    statusLabel: String(workspaceState?.status?.headline || workspaceState?.status?.phase || '当前主链判断').trim() || '当前主链判断',
    statusSummary: String(workspaceState?.risk?.summary || confirmationState.summary || nextAction?.reason || '').trim() || '当前可以按主链继续。',
    statusTone: issueCount > 0 ? 'warn' : 'good',
    actionLabel: String(nextAction?.label || '继续当前主链').trim() || '继续当前主链',
    actionSummary: String(nextAction?.reason || confirmationState.summary || '').trim() || '当前直接按推荐动作继续即可。',
    replyLabel: nextReply,
    confirmItems: confirmationState.pendingItems,
    noteItems: [
      issueCount > 0 ? `当前还有 ${issueCount} 项待处理问题` : '当前没有明显异常压力',
      '首页只负责把你送到当前真正该去的地方',
    ],
  });
}

function buildTimelineEventsSnapshot(events = []) {
  return toArray(events)
    .map((event) => {
      const snapshot = buildTimelineEventSnapshot(event);
      return snapshot?.title ? snapshot : null;
    })
    .filter(Boolean);
}

function buildPrepareCockpitSummary(prepareSummary) {
  const readiness = prepareSummary?.readiness || {};
  const blockingCount = toArray(readiness.blockingItems).length;
  const nextFocusSummary = String(
    prepareSummary?.nextStepReason
    || readiness.detail
    || ''
  ).trim() || '先按准备层当前判断继续。';
  return buildCockpitSummary({
    title: '驾驶舱摘要',
    copy: '这里只解释准备层当前结论、当前重点和阻塞情况，不重复上方动作建议。',
    items: [
      {
        label: '当前局面',
        value: String(readiness.label || '未提供').trim() || '未提供',
        summary: String(readiness.detail || '未提供').trim() || '未提供',
        tone: readiness.tone || 'info',
      },
      {
        label: '当前重点',
        value: String(prepareSummary?.currentFocus || '').trim() || (blockingCount > 0 ? '先补齐开跑条件' : '确认后即可放行'),
        summary: nextFocusSummary,
        tone: blockingCount > 0 ? 'warn' : 'good',
      },
      {
        label: '阻塞情况',
        value: blockingCount > 0 ? `${blockingCount} 项阻塞` : '当前可放行',
        summary: String(readiness.detail || '未提供').trim() || '未提供',
        tone: blockingCount > 0 ? 'bad' : 'good',
      },
    ],
  });
}

function buildPrepareJudgmentPanel(prepareSummary) {
  const readiness = prepareSummary?.readiness || {};
  const confirmationState = prepareSummary?.confirmationState || {};
  const importedBindingCount = Number(prepareSummary?.importedBindingCount || 0);
  const blockingCount = toArray(readiness.blockingItems).length;
  return buildStageReviewJudgmentPanel({
    stageKey: 'prepare',
    stageLabel: '准备层',
    confirmationState,
    statusLabel: String(readiness.label || '准备层判断').trim() || '准备层判断',
    statusSummary: String(readiness.detail || confirmationState.summary || '').trim() || '先按准备层当前判断继续。',
    statusTone: readiness.tone || (blockingCount > 0 ? 'bad' : 'good'),
    actionLabel: String(prepareSummary?.nextStepLabel || '').trim() || getStagePrimaryActionLabel('prepare', { hasBlocking: blockingCount > 0 }),
    actionSummary: String(prepareSummary?.nextStepReason || confirmationState.summary || readiness.detail || '').trim() || '确认完准备条件后再继续。',
    noteItems: [
      importedBindingCount > 0 ? `当前有 ${importedBindingCount} 项素材绑定约束` : '当前没有素材绑定约束',
      blockingCount > 0 ? `还有 ${blockingCount} 项阻塞需要先处理` : '当前没有硬阻塞',
    ],
  });
}

function buildStageReviewCockpitSummary(options = {}) {
  const tone = String(options.statusTone || '').trim() || 'info';
  const pressureTone = String(options.pressureTone || '').trim() || tone;
  return buildCockpitSummary({
    title: '驾驶舱摘要',
    copy: String(options.copy || '').trim() || '这里只解释当前结论、当前重点和阻塞情况，不重复上方动作建议。',
    items: [
      {
        label: '当前局面',
        value: String(options.statusLabel || '未提供').trim() || '未提供',
        summary: String(options.statusSummary || '未提供').trim() || '未提供',
        tone,
      },
      {
        label: '当前重点',
        value: String(options.focusValue || '').trim() || '先按当前判断继续',
        summary: String(options.focusSummary || '').trim() || '先按当前判断继续。',
        tone: String(options.focusTone || '').trim() || tone,
      },
      {
        label: '阻塞情况',
        value: String(options.pressureValue || '').trim() || '当前可继续',
        summary: String(options.pressureSummary || '').trim() || '当前没有额外阻塞说明。',
        tone: pressureTone,
      },
    ],
  });
}

function buildStageSessionConsoleSummary(options = {}) {
  return buildWorkspaceSessionConsole({
    taskLabel: options.taskLabel,
    taskSummary: String(options.taskSummary || '').trim() || '当前正在沿主链继续。',
    stageLabel: String(options.stageLabel || '').trim() || '当前阶段',
    stageSummary: String(options.stageSummary || '').trim() || '当前页面负责承接这一站的主链判断。',
    statusLabel: String(options.statusLabel || '').trim() || '当前状态',
    statusSummary: String(options.statusSummary || '').trim() || '当前没有额外状态说明。',
    statusTone: String(options.statusTone || '').trim() || 'neutral',
    pressureLabel: String(options.pressureLabel || '').trim() || '当前平稳',
    pressureSummary: String(options.pressureSummary || '').trim() || '当前没有明显额外压力。',
    pressureTone: String(options.pressureTone || '').trim() || 'good',
    runScaleLabel: String(options.runScaleLabel || '').trim() || '',
    runScaleSummary: String(options.runScaleSummary || '').trim() || '',
  });
}

function buildRuntimePrepareOverrides(prepareSummary, runtimeSummary, options = {}) {
  const runtime = runtimeSummary && typeof runtimeSummary === 'object' ? runtimeSummary : null;
  const runtimeStatus = String(runtime?.currentStatus || '').trim();
  if (!runtime || !['running', 'paused', 'awaiting_confirmation', 'waiting'].includes(runtimeStatus)) {
    return null;
  }

  const readiness = prepareSummary?.readiness || {};
  const runtimeWorkflow = runtime?.runtimeWorkflow && typeof runtime.runtimeWorkflow === 'object'
    ? runtime.runtimeWorkflow
    : null;
  const dialogueStatus = runtime?.workflowDialogue && typeof runtime.workflowDialogue === 'object'
    ? runtime.workflowDialogue
    : (runtime?.dialogueStatus && typeof runtime.dialogueStatus === 'object' ? runtime.dialogueStatus : null);
  const runtimePhaseLabel = String(runtime?.phaseLabel || runtimeWorkflow?.stageLabel || options.stageLabel || '执行中').trim() || '执行中';
  const runtimeHeadline = String(runtime?.phaseHeadline || runtimeWorkflow?.headline || '').trim();
  const runtimeSummaryText = String(runtime?.phaseSummary || runtimeWorkflow?.summary || runtime?.progressSummary || '').trim();
  const runtimeTone = String(runtime?.phaseTone || runtimeWorkflow?.tone || 'info').trim() || 'info';
  const progressSummary = String(runtime?.progressSummary || runtimeWorkflow?.progressSummary || runtimeSummaryText).trim();
  const currentBatch = Number(runtime?.currentBatch || 0);
  const pendingBatchCount = Number(runtime?.pendingBatchCount || 0);
  const completedBatchCount = Number(runtime?.completedBatchCount || 0);
  const totalBatchCount = Number(runtime?.totalBatchCount || prepareSummary?.batchCount || 0);
  const nextActionLabel = buildRuntimeNextActionLabel({
    explicitLabel: String(runtime?.nextActionLabel || runtime?.nextSuggestedAction?.label || '').trim(),
    runtimeStatus,
  });
  const nextActionSummary = String(runtime?.nextActionReason || runtime?.nextSuggestedAction?.reason || runtimeSummaryText).trim() || runtimeSummaryText;
  const pressureCopy = buildRuntimePressureCopy({
    runtimeStatus,
    currentBatch,
    progressSummary,
    runtimeSummaryText,
  });
  const pressureLabel = pressureCopy.pressureLabel;
  const pressureSummary = pressureCopy.pressureSummary;
  const pressureTone = pressureCopy.pressureTone;
  const runScaleSummary = buildRuntimeRunScaleSummary({
    totalBatchCount,
    completedBatchCount,
    pendingBatchCount,
    importedBindingCount: prepareSummary?.importedBindingCount,
  });

  return {
    runtimeActive: true,
    stageLabel: runtimePhaseLabel,
    stageSummary: buildRuntimeStageSummaryCopy({
      stageKey: 'prepare',
      runtimeStatus,
    }),
    statusLabel: String(runtime?.phaseLabel || runtimeHeadline || readiness.label || '执行中').trim() || '执行中',
    statusSummary: String(runtimeSummaryText || readiness.detail || '').trim() || '当前有新的实时状态需要优先接住。',
    statusTone: runtimeTone,
    pressureLabel,
    pressureSummary,
    pressureTone,
    nextActionLabel,
    nextActionSummary,
    taskSummary: runtimeHeadline || runtimeSummaryText || '当前任务正在沿主链继续推进。',
    runScaleLabel: totalBatchCount > 0
      ? `${Number(prepareSummary?.promptCount || 0)} 张 / ${totalBatchCount} 批`
      : `${Number(prepareSummary?.promptCount || 0)} 张 / ${Number(prepareSummary?.batchCount || 0)} 批`,
    runScaleSummary,
    signalBar: [
      {
        label: '当前阶段',
        value: runtimePhaseLabel,
        summary: buildRuntimeSignalCopy({
          stageKey: 'prepare',
          runtimeStatus,
        }),
        tone: 'info',
      },
      {
        label: '当前状态',
        value: String(runtime?.phaseLabel || runtimeHeadline || '执行中').trim() || '执行中',
        summary: buildRuntimeStatusSummaryCopy({
          runtimeSummaryText,
          progressSummary,
        }),
        tone: runtimeTone,
      },
      {
        label: '当前压力',
        value: pressureLabel,
        summary: pressureSummary,
        tone: pressureTone,
      },
    ],
    statusStack: [
      {
        label: '执行信号',
        value: String(runtime?.phaseLabel || runtimeHeadline || '执行中').trim() || '执行中',
        summary: buildRuntimeStatusStackSummaryCopy({
          runtimeSummaryText,
          progressSummary,
        }),
        tone: runtimeTone,
      },
      {
        label: '对话信号',
        value: buildRuntimeDialogueValue({
          primarySay: dialogueStatus?.primarySay,
          nextActionLabel,
        }),
        summary: String(dialogueStatus?.actionReason || nextActionSummary || pressureSummary).trim() || pressureSummary,
        tone: runtimeStatus === 'paused' ? 'warn' : 'good',
      },
    ],
    taskControlBar: {
      taskLabel: String(options.taskLabel || '未提供').trim() || '未提供',
      stageLabel: runtimePhaseLabel,
      statusLabel: String(runtime?.phaseLabel || runtimeHeadline || '执行中').trim() || '执行中',
      statusTone: runtimeTone,
      pressureLabel,
      pressureTone,
      nextActionLabel,
      nextActionSummary,
      nextActionTone: runtimeStatus === 'paused' ? 'warn' : 'good',
    },
    unifiedStatus: buildStageUnifiedStatus({
      stage: runtimePhaseLabel,
      conclusion: runtimeHeadline || String(runtime?.phaseLabel || '执行中').trim() || '执行中',
      currentFocus: nextActionSummary || pressureSummary,
      progress: progressSummary || runtimeSummaryText,
      status: runtimeTone,
      taskLabel: String(options.taskLabel || '').trim(),
      nextActionLabel,
      nextActionReason: nextActionSummary,
      nextActionTarget: String(runtime?.nextSuggestedAction?.target || '').trim() || 'workspace_home.html',
      recommendedReply: String(dialogueStatus?.primarySay || '').trim(),
      actionReason: String(dialogueStatus?.actionReason || nextActionSummary).trim(),
      dialogueSummary: String(dialogueStatus?.summary || progressSummary || runtimeSummaryText).trim(),
      alternativeSayItems: Array.isArray(dialogueStatus?.alternativeSayItems) ? dialogueStatus.alternativeSayItems : [],
      confirmItems: Array.isArray(dialogueStatus?.confirmItems) ? dialogueStatus.confirmItems : [],
      dialogueStatus,
    }),
  };
}

function buildRuntimeStageOverrides(stageKey, stageState, runtimeSummary, options = {}) {
  const runtime = runtimeSummary && typeof runtimeSummary === 'object' ? runtimeSummary : null;
  const runtimeStatus = String(runtime?.currentStatus || '').trim();
  if (!runtime || !['running', 'paused', 'awaiting_confirmation', 'waiting'].includes(runtimeStatus)) {
    return null;
  }

  const runtimeWorkflow = runtime?.runtimeWorkflow && typeof runtime.runtimeWorkflow === 'object'
    ? runtime.runtimeWorkflow
    : null;
  const dialogueStatus = runtime?.workflowDialogue && typeof runtime.workflowDialogue === 'object'
    ? runtime.workflowDialogue
    : (runtime?.dialogueStatus && typeof runtime.dialogueStatus === 'object' ? runtime.dialogueStatus : null);
  const runtimePhaseLabel = String(runtime?.phaseLabel || runtimeWorkflow?.stageLabel || options.stageLabel || '执行中').trim() || '执行中';
  const runtimeHeadline = String(runtime?.phaseHeadline || runtimeWorkflow?.headline || '').trim();
  const runtimeSummaryText = String(runtime?.phaseSummary || runtimeWorkflow?.summary || runtime?.progressSummary || '').trim();
  const runtimeTone = String(runtime?.phaseTone || runtimeWorkflow?.tone || 'info').trim() || 'info';
  const progressSummary = String(runtime?.progressSummary || runtimeWorkflow?.progressSummary || runtimeSummaryText).trim();
  const currentBatch = Number(runtime?.currentBatch || 0);
  const pendingBatchCount = Number(runtime?.pendingBatchCount || 0);
  const completedBatchCount = Number(runtime?.completedBatchCount || 0);
  const totalBatchCount = Number(runtime?.totalBatchCount || 0);
  const nextActionTargetRaw = String(runtime?.nextSuggestedAction?.target || '').trim();
  const nextActionTarget = nextActionTargetRaw
    ? path.basename(nextActionTargetRaw)
    : (String(options.defaultTarget || 'workspace_home.html').trim() || 'workspace_home.html');
  const nextActionLabel = buildRuntimeNextActionLabel({
    explicitLabel: String(runtime?.nextActionLabel || runtime?.nextSuggestedAction?.label || '').trim(),
    runtimeStatus,
  });
  const nextActionSummary = String(
    runtime?.nextActionReason
    || runtime?.nextSuggestedAction?.reason
    || runtimeSummaryText
    || progressSummary
  ).trim() || runtimeSummaryText;
  const selectedCount = Number(
    options.promptCount
    || stageState?.promptCount
    || stageState?.selectedCount
    || stageState?.counts?.selected
    || 0
  );
  const stageSummary = buildRuntimeStageSummaryCopy({
    stageKey,
    runtimeStatus,
  });
  const pressureCopy = buildRuntimePressureCopy({
    runtimeStatus,
    currentBatch,
    progressSummary,
    runtimeSummaryText,
  });
  const pressureLabel = pressureCopy.pressureLabel;
  const pressureSummary = pressureCopy.pressureSummary;
  const pressureTone = pressureCopy.pressureTone;

  const currentFocus = String(options.currentFocus || nextActionSummary || pressureSummary).trim() || pressureSummary;
  const taskSummary = String(options.taskSummary || runtimeHeadline || currentFocus || '当前任务正在沿主链继续推进。').trim() || '当前任务正在沿主链继续推进。';
  const runScaleLabel = String(
    options.runScaleLabel
    || (totalBatchCount > 0 ? `${selectedCount} 张 / ${totalBatchCount} 批` : '')
  ).trim();
  const runScaleSummary = String(
    options.runScaleSummary
    || buildRuntimeRunScaleSummary({
      totalBatchCount,
      completedBatchCount,
      pendingBatchCount,
    })
  ).trim();

  return {
    runtimeActive: true,
    currentFocus,
    stageLabel: runtimePhaseLabel,
    stageSummary,
    statusLabel: String(runtime?.phaseLabel || runtimeHeadline || '执行中').trim() || '执行中',
    statusSummary: buildRuntimeStatusSummaryCopy({
      runtimeSummaryText,
      progressSummary,
    }),
    statusTone: runtimeTone,
    pressureLabel,
    pressureSummary,
    pressureTone,
    nextActionLabel,
    nextActionSummary,
    nextActionTarget,
    taskSummary,
    runScaleLabel,
    runScaleSummary,
    signalBar: [
      {
        label: '当前阶段',
        value: runtimePhaseLabel,
        summary: stageSummary,
        tone: 'info',
      },
      {
        label: '当前状态',
        value: String(runtime?.phaseLabel || runtimeHeadline || '执行中').trim() || '执行中',
        summary: buildRuntimeStatusSummaryCopy({
          runtimeSummaryText,
          progressSummary,
        }),
        tone: runtimeTone,
      },
      {
        label: '当前压力',
        value: pressureLabel,
        summary: pressureSummary,
        tone: pressureTone,
      },
    ],
    statusStack: [
      {
        label: '执行信号',
        value: String(runtime?.phaseLabel || runtimeHeadline || '执行中').trim() || '执行中',
        summary: buildRuntimeStatusStackSummaryCopy({
          runtimeSummaryText,
          progressSummary,
        }),
        tone: runtimeTone,
      },
      {
        label: '对话信号',
        value: buildRuntimeDialogueValue({
          primarySay: dialogueStatus?.primarySay,
          nextActionLabel,
        }),
        summary: String(dialogueStatus?.actionReason || nextActionSummary || pressureSummary).trim() || pressureSummary,
        tone: runtimeStatus === 'running' ? 'good' : 'warn',
      },
    ],
    taskControlBar: {
      taskLabel: String(options.taskLabel || '未提供').trim() || '未提供',
      stageLabel: runtimePhaseLabel,
      statusLabel: String(runtime?.phaseLabel || runtimeHeadline || '执行中').trim() || '执行中',
      statusTone: runtimeTone,
      pressureLabel,
      pressureTone,
      nextActionLabel,
      nextActionSummary,
      nextActionTone: runtimeStatus === 'running' ? 'good' : 'warn',
    },
    unifiedStatus: buildStageUnifiedStatus({
      stage: runtimePhaseLabel,
      conclusion: runtimeHeadline || String(runtime?.phaseLabel || '执行中').trim() || '执行中',
      currentFocus,
      progress: progressSummary || runtimeSummaryText,
      status: runtimeTone,
      taskLabel: String(options.taskLabel || '').trim(),
      nextActionLabel,
      nextActionReason: nextActionSummary,
      nextActionTarget,
      recommendedReply: String(dialogueStatus?.primarySay || '').trim(),
      actionReason: String(dialogueStatus?.actionReason || nextActionSummary).trim(),
      dialogueSummary: String(dialogueStatus?.summary || progressSummary || runtimeSummaryText).trim(),
      alternativeSayItems: Array.isArray(dialogueStatus?.alternativeSayItems) ? dialogueStatus.alternativeSayItems : [],
      confirmItems: Array.isArray(dialogueStatus?.confirmItems) ? dialogueStatus.confirmItems : [],
      dialogueStatus,
    }),
  };
}

function buildPrepareStageUiState(taskLabel, stageLabel, prepareSummary, options = {}) {
  const runtimeOverride = buildRuntimePrepareOverrides(prepareSummary, options.runtimeSummary, {
    taskLabel,
    stageLabel,
  });
  if (runtimeOverride) {
    return buildRuntimeStageUiState(taskLabel, runtimeOverride);
  }

  const stageCopy = buildPrepareStaticStageCopy(prepareSummary);
  const hasBlocking = stageCopy.hasBlocking;
  const nextActionLabel = stageCopy.nextActionLabel;
  const nextActionSummary = prepareSummary.nextStepReason || prepareSummary.confirmationState?.summary || prepareSummary.readiness.detail;
  return buildStaticStageUiState({
    taskLabel,
    taskSummary: stageCopy.taskSummary,
    consoleStageLabel: '准备阶段',
    consoleStageSummary: stageCopy.consoleStageSummary,
    consoleStatusLabel: prepareSummary.readiness.label,
    consoleStatusSummary: prepareSummary.readiness.detail,
    consoleStatusTone: prepareSummary.readiness.tone,
    pressureLabel: stageCopy.pressureLabel,
    pressureSummary: stageCopy.pressureSummary,
    pressureTone: stageCopy.pressureTone,
    nextActionLabel,
    nextActionSummary,
    runScaleLabel: stageCopy.runScaleLabel,
    runScaleSummary: stageCopy.runScaleSummary,
    taskControlBar: buildPrepareTaskControlBar({
      taskLabel,
      stageLabel,
      readinessLabel: prepareSummary.readiness.label,
      readinessTone: prepareSummary.readiness.tone,
      blockingCount: prepareSummary.readiness.blockingItems.length,
      nextActionLabel,
      nextActionSummary,
    }),
    signalBar: buildPrepareSignalBar({
      stageLabel,
      readinessLabel: prepareSummary.readiness.label,
      readinessDetail: prepareSummary.readiness.detail,
      readinessTone: prepareSummary.readiness.tone,
      hasBlocking,
      nextActionLabel,
      nextActionSummary,
      replyLabel: prepareSummary.confirmationState?.recommendedReply,
    }),
    statusStack: buildPrepareStatusStack({
      readinessLabel: prepareSummary.readiness.label,
      readinessDetail: prepareSummary.readiness.detail,
      readinessTone: prepareSummary.readiness.tone,
      hasBlocking,
      nextActionLabel,
      nextActionSummary,
    }),
  });
}

function applyRuntimeOverrideToStageSummary(stageSummary, runtimeOverride, options = {}) {
  if (!stageSummary || typeof stageSummary !== 'object' || !runtimeOverride?.unifiedStatus) {
    return stageSummary;
  }

  const resolvedStageSummary = stageSummary;
  resolvedStageSummary.currentFocus = runtimeOverride.currentFocus || runtimeOverride.nextActionSummary || resolvedStageSummary.currentFocus;
  resolvedStageSummary.nextStepLabel = runtimeOverride.nextActionLabel || resolvedStageSummary.nextStepLabel;
  resolvedStageSummary.nextStepReason = runtimeOverride.nextActionSummary || resolvedStageSummary.nextStepReason;
  resolvedStageSummary.stageSummary = runtimeOverride.stageSummary || resolvedStageSummary.stageSummary;
  resolvedStageSummary.statusLabel = runtimeOverride.statusLabel || resolvedStageSummary.statusLabel;
  resolvedStageSummary.statusSummary = runtimeOverride.statusSummary || resolvedStageSummary.statusSummary;
  resolvedStageSummary.statusTone = runtimeOverride.statusTone || resolvedStageSummary.statusTone;

  if (resolvedStageSummary.confirmationState && typeof resolvedStageSummary.confirmationState === 'object') {
    resolvedStageSummary.confirmationState = {
      ...resolvedStageSummary.confirmationState,
      stageLabel: runtimeOverride.stageLabel || resolvedStageSummary.confirmationState.stageLabel,
      stageTone: runtimeOverride.statusTone || resolvedStageSummary.confirmationState.stageTone,
      recommendedReply: options.dialoguePrimarySay || resolvedStageSummary.confirmationState.recommendedReply,
      summary: options.dialogueSummary || runtimeOverride.statusSummary || resolvedStageSummary.confirmationState.summary,
    };
  }

  resolvedStageSummary.unifiedStatus = runtimeOverride.unifiedStatus;
  return resolvedStageSummary;
}

function buildRuntimeStageUiState(taskLabel, runtimeOverride) {
  if (!runtimeOverride) return null;
  return {
    pressureLabel: runtimeOverride.pressureLabel,
    nextActionLabel: runtimeOverride.nextActionLabel,
    nextActionSummary: runtimeOverride.nextActionSummary,
    sessionConsole: buildStageSessionConsoleSummary({
      taskLabel,
      taskSummary: runtimeOverride.taskSummary,
      stageLabel: runtimeOverride.stageLabel,
      stageSummary: runtimeOverride.stageSummary,
      statusLabel: runtimeOverride.statusLabel,
      statusSummary: runtimeOverride.statusSummary,
      statusTone: runtimeOverride.statusTone,
      pressureLabel: runtimeOverride.pressureLabel,
      pressureSummary: runtimeOverride.pressureSummary,
      pressureTone: runtimeOverride.pressureTone,
      runScaleLabel: runtimeOverride.runScaleLabel,
      runScaleSummary: runtimeOverride.runScaleSummary,
    }),
    taskControlBar: runtimeOverride.taskControlBar,
    signalBar: runtimeOverride.signalBar,
    statusStack: runtimeOverride.statusStack,
    runtimeOverride,
  };
}

function buildStaticStageUiState(options = {}) {
  return {
    pressureLabel: options.pressureLabel,
    nextActionLabel: options.nextActionLabel,
    nextActionSummary: options.nextActionSummary,
    sessionConsole: buildStageSessionConsoleSummary({
      taskLabel: options.taskLabel,
      taskSummary: options.taskSummary,
      stageLabel: options.consoleStageLabel,
      stageSummary: options.consoleStageSummary,
      statusLabel: options.consoleStatusLabel,
      statusSummary: options.consoleStatusSummary,
      statusTone: options.consoleStatusTone,
      pressureLabel: options.pressureLabel,
      pressureSummary: options.pressureSummary,
      pressureTone: options.pressureTone,
      runScaleLabel: options.runScaleLabel,
      runScaleSummary: options.runScaleSummary,
    }),
    taskControlBar: options.taskControlBar,
    signalBar: options.signalBar,
    statusStack: options.statusStack,
  };
}

function buildHomeStageUiState(taskLabel, stageLabel, workspaceState, options = {}) {
  const issueCount = Number(workspaceState?.counts?.failed || 0) + Number(workspaceState?.counts?.needsReview || 0);
  const hasResult = Boolean(options.hasResult);
  const hasPrepare = Boolean(options.hasPrepare);
  const hasFailure = Boolean(options.hasFailure);
  const runtimeOverride = options.runtimeOverride || buildRuntimeStageOverrides('home', workspaceState, options.runtimeSummary, {
    taskLabel,
    stageLabel,
    taskSummary: buildHomeTaskConclusion({ hasFailure, hasResult, hasPrepare }),
    runScaleLabel: `${Number(workspaceState?.counts?.selected || 0)} 张 / ${Number(workspaceState?.counts?.batches || 0)} 批`,
    runScaleSummary: `${Number(workspaceState?.counts?.success || 0)} 成功 / ${Number(workspaceState?.counts?.failed || 0)} 失败 / ${Number(workspaceState?.counts?.needsReview || 0)} 待复核`,
    defaultTarget: String(options.nextActionTarget || 'workspace_home.html').trim() || 'workspace_home.html',
  });
  if (runtimeOverride) {
    return buildRuntimeStageUiState(taskLabel, runtimeOverride);
  }
  const stageCopy = buildHomeStaticStageCopy({
    hasFailure,
    hasResult,
    hasPrepare,
    issueCount,
    riskSummary: workspaceState.risk?.summary,
    selectedCount: Number(workspaceState?.counts?.selected || 0),
    batchCount: Number(workspaceState?.counts?.batches || 0),
    successCount: Number(workspaceState?.counts?.success || 0),
    failedCount: Number(workspaceState?.counts?.failed || 0),
    reviewCount: Number(workspaceState?.counts?.needsReview || 0),
  });
  const nextActionLabel = String(options.nextActionLabel || '').trim() || '继续当前主链';
  const nextActionSummary = String(options.nextActionSummary || '').trim() || '按推荐下一步继续。';
  return buildStaticStageUiState({
    taskLabel,
    taskSummary: stageCopy.taskSummary,
    consoleStageLabel: stageLabel,
    consoleStageSummary: stageCopy.consoleStageSummary,
    consoleStatusLabel: buildHomeDecisionSummary({ hasFailure, hasResult, hasPrepare }),
    consoleStatusSummary: workspaceState.confirmationState?.summary || workspaceState.risk?.summary || '',
    consoleStatusTone: workspaceState.confirmationState?.hasBlocking ? 'warn' : 'good',
    pressureLabel: stageCopy.pressureLabel,
    pressureSummary: stageCopy.pressureSummary,
    pressureTone: stageCopy.pressureTone,
    nextActionLabel,
    nextActionSummary,
    runScaleLabel: stageCopy.runScaleLabel,
    runScaleSummary: stageCopy.runScaleSummary,
    taskControlBar: buildHomeTaskControlBar({
      taskLabel,
      stageLabel,
      issueCount,
      hasResult,
      nextActionLabel,
      nextActionSummary,
    }),
    signalBar: buildHomeSignalBar({
      stageLabel,
      issueCount,
      hasResult,
      statusSummary: workspaceState.risk?.summary || buildHomeDecisionSummary({ hasFailure, hasResult, hasPrepare }),
      nextActionLabel,
      nextActionSummary,
      replyLabel: workspaceState.confirmationState?.recommendedReply,
    }),
    statusStack: buildHomeStatusStack({
      issueCount,
      hasResult,
      hasBlocking: Boolean(workspaceState.confirmationState?.hasBlocking),
      canContinue: workspaceState.confirmationState?.canContinue,
      summary: workspaceState.confirmationState?.summary,
      nextActionLabel,
      nextActionSummary,
    }),
  });
}

function buildResultStageUiState(taskLabel, stageLabel, resultSummary, options = {}) {
  const runtimeOverride = options.runtimeOverride || buildRuntimeStageOverrides('result', resultSummary, options.runtimeSummary, {
    taskLabel,
    stageLabel,
    taskSummary: resultSummary.currentFocus || '当前正在做结果层取舍与分流判断。',
    runScaleLabel: `${resultSummary.successCount} 成功 / ${resultSummary.failedCount} 失败`,
    runScaleSummary: `${resultSummary.reviewCount} 项待复核 / ${resultSummary.previewCount} 张可预览`,
    defaultTarget: resultSummary.failedCount > 0 ? 'exception_workspace.html' : 'result_workspace.html',
  });
  if (runtimeOverride) {
    return buildRuntimeStageUiState(taskLabel, runtimeOverride);
  }
  const stageCopy = buildResultStaticStageCopy(resultSummary);
  const nextActionLabel = resultSummary.nextStepLabel;
  const nextActionSummary = resultSummary.nextStepReason;
  return buildStaticStageUiState({
    taskLabel,
    taskSummary: stageCopy.taskSummary,
    consoleStageLabel: '结果阶段',
    consoleStageSummary: stageCopy.consoleStageSummary,
    consoleStatusLabel: resultSummary.statusLabel,
    consoleStatusSummary: resultSummary.statusSummary,
    consoleStatusTone: resultSummary.statusTone,
    pressureLabel: stageCopy.pressureLabel,
    pressureSummary: stageCopy.pressureSummary,
    pressureTone: stageCopy.pressureTone,
    nextActionLabel,
    nextActionSummary,
    runScaleLabel: stageCopy.runScaleLabel,
    runScaleSummary: stageCopy.runScaleSummary,
    taskControlBar: buildResultTaskControlBar({
      taskLabel,
      stageLabel,
      statusLabel: resultSummary.statusLabel,
      statusTone: resultSummary.statusTone,
      failedCount: resultSummary.failedCount,
      reviewCount: resultSummary.reviewCount,
      nextActionLabel,
      nextActionSummary,
    }),
    signalBar: buildResultSignalBar({
      stageLabel,
      statusLabel: resultSummary.statusLabel,
      statusSummary: resultSummary.statusSummary,
      statusTone: resultSummary.statusTone,
      failedCount: resultSummary.failedCount,
      nextActionLabel,
      nextActionSummary,
      replyLabel: resultSummary.confirmationState?.recommendedReply,
    }),
    statusStack: buildResultStatusStack({
      statusLabel: resultSummary.statusLabel,
      statusSummary: resultSummary.statusSummary,
      statusTone: resultSummary.statusTone,
      failedCount: resultSummary.failedCount,
      reviewCount: resultSummary.reviewCount,
      nextActionLabel,
      nextActionSummary,
    }),
  });
}

function buildExceptionStageUiState(taskLabel, stageLabel, exceptionSummary, options = {}) {
  const runtimeOverride = options.runtimeOverride || buildRuntimeStageOverrides('exception', exceptionSummary, options.runtimeSummary, {
    taskLabel,
    stageLabel,
    taskSummary: exceptionSummary.currentFocus || '当前正在处理异常相关问题。',
    runScaleLabel: `${exceptionSummary.failedCount} 失败 / ${exceptionSummary.reviewCount} 待复核`,
    runScaleSummary: `${exceptionSummary.rerunCount} 个补跑候选`,
    defaultTarget: 'workspace_home.html',
  });
  if (runtimeOverride) {
    return buildRuntimeStageUiState(taskLabel, runtimeOverride);
  }
  const stageCopy = buildExceptionStaticStageCopy(exceptionSummary);
  const nextActionLabel = exceptionSummary.nextStepLabel;
  const nextActionSummary = exceptionSummary.nextStepReason || exceptionSummary.issueSummary;
  return buildStaticStageUiState({
    taskLabel,
    taskSummary: stageCopy.taskSummary,
    consoleStageLabel: '异常阶段',
    consoleStageSummary: stageCopy.consoleStageSummary,
    consoleStatusLabel: exceptionSummary.statusLabel,
    consoleStatusSummary: exceptionSummary.statusSummary,
    consoleStatusTone: exceptionSummary.statusTone,
    pressureLabel: stageCopy.pressureLabel,
    pressureSummary: stageCopy.pressureSummary,
    pressureTone: stageCopy.pressureTone,
    nextActionLabel,
    nextActionSummary,
    runScaleLabel: stageCopy.runScaleLabel,
    runScaleSummary: stageCopy.runScaleSummary,
    taskControlBar: buildExceptionTaskControlBar({
      taskLabel,
      stageLabel,
      statusLabel: exceptionSummary.statusLabel,
      statusTone: exceptionSummary.statusTone,
      totalIssueCount: exceptionSummary.failedCount + exceptionSummary.reviewCount,
      failedCount: exceptionSummary.failedCount,
      nextActionLabel,
      nextActionSummary,
    }),
    signalBar: buildExceptionSignalBar({
      stageLabel,
      statusLabel: exceptionSummary.statusLabel,
      statusSummary: exceptionSummary.statusSummary,
      statusTone: exceptionSummary.statusTone,
      failedCount: exceptionSummary.failedCount,
      nextActionLabel,
      nextActionSummary,
      replyLabel: exceptionSummary.confirmationState?.recommendedReply,
    }),
    statusStack: buildExceptionStatusStack({
      statusLabel: exceptionSummary.statusLabel,
      statusSummary: exceptionSummary.statusSummary,
      statusTone: exceptionSummary.statusTone,
      totalIssueCount: exceptionSummary.failedCount + exceptionSummary.reviewCount,
      failedCount: exceptionSummary.failedCount,
      nextActionLabel,
      nextActionSummary,
    }),
  });
}

function buildUnifiedStatusFromStageUi(options = {}) {
  return buildStageUiUnifiedStatus(options);
}

function buildStageReviewDialogueStatus(options = {}) {
  const interaction = getWorkspaceInteractionTemplates(options.stageKey);
  const confirmationState = options.confirmationState || {};
  const fallbackReplies = buildDialogueReplyFallbacks(options.stageKey, options.fallbackReplyOptions || {});
  const nextSayItems = buildNextReplyDialogueItems(confirmationState, fallbackReplies);
  const cadence = buildStageCadenceSummary({
    recommendedReply: confirmationState.recommendedReply,
    primarySay: confirmationState.recommendedReply || nextSayItems[0] || '',
    replyReason: options.replyReason,
    directReplies: nextSayItems,
    summary: options.summary,
  });
  return buildDialogueStatus({
    nextSayTitle: '回到对话框直接说',
    recentItems: buildRecentDialogueItems(confirmationState, options.recentFallbackItems || []),
    understoodItems: buildUnderstoodDialogueItems(confirmationState, options.understoodFallbackItems || []),
    nextSayItems: cadence.directReplies,
    primarySay: cadence.primarySay,
    actionReason: String(cadence.replyReason || '').trim() || String(options.defaultActionReason || '').trim(),
    summary: String(confirmationState.summary || options.summary || '').trim(),
  });
}

function buildStageReviewJudgmentPanel(options = {}) {
  const confirmationState = options.confirmationState || {};
  const nextReply = String(confirmationState.recommendedReply || getStageContinuationCopy(options.stageKey)).trim()
    || getStageContinuationCopy(options.stageKey);
  return buildJudgmentPanel({
    title: '主控判断',
    statusLabel: String(options.statusLabel || '').trim() || `${options.stageLabel || '当前'}判断`,
    statusSummary: String(options.statusSummary || '').trim() || `先按${options.stageLabel || '当前'}判断继续。`,
    statusTone: String(options.statusTone || '').trim() || 'good',
    actionLabel: String(options.actionLabel || '').trim() || `继续${options.stageLabel || '当前阶段'}`,
    actionSummary: String(options.actionSummary || '').trim() || '当前建议按推荐动作继续。',
    replyLabel: nextReply,
    confirmItems: confirmationState.pendingItems,
    noteItems: Array.isArray(options.noteItems) ? options.noteItems : [],
  });
}

function buildResultCockpitSummary(resultSummary) {
  const failedCount = Number(resultSummary?.failedCount || 0);
  const reviewCount = Number(resultSummary?.reviewCount || 0);
  return buildStageReviewCockpitSummary({
    copy: '这里只解释结果层当前结论、当前重点和阻塞情况，不重复上方动作建议。',
    statusLabel: String(resultSummary?.statusLabel || '未提供').trim() || '未提供',
    statusSummary: String(resultSummary?.statusSummary || '未提供').trim() || '未提供',
    statusTone: String(resultSummary?.statusTone || '').trim() || 'info',
    focusValue: String(resultSummary?.currentFocus || '').trim() || (failedCount > 0 ? '先处理失败项' : '筛出最值得保留的图片'),
    focusSummary: String(resultSummary?.nextStepReason || '').trim() || '先按结果层当前判断继续。',
    focusTone: failedCount > 0 ? 'warn' : 'good',
    pressureValue: failedCount > 0 ? `${failedCount} 项失败` : (reviewCount > 0 ? `${reviewCount} 项待复核` : '当前可继续收口'),
    pressureSummary: failedCount > 0
      ? '建议先处理失败项，再决定是否继续收口。'
      : (reviewCount > 0 ? '当前还有边界项值得再看一眼。' : '当前结果层已经比较稳定。'),
    pressureTone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
  });
}

function buildResultJudgmentPanel(resultSummary) {
  const confirmationState = resultSummary?.confirmationState || {};
  const failedCount = Number(resultSummary?.failedCount || 0);
  const reviewCount = Number(resultSummary?.reviewCount || 0);
  return buildStageReviewJudgmentPanel({
    stageKey: 'result',
    stageLabel: '结果层',
    confirmationState,
    statusLabel: String(resultSummary?.statusLabel || '结果层判断').trim() || '结果层判断',
    statusSummary: String(resultSummary?.statusSummary || '').trim() || '先按结果层当前判断继续。',
    statusTone: String(resultSummary?.statusTone || '').trim() || (failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good')),
    actionLabel: String(resultSummary?.nextStepLabel || '继续结果层').trim() || '继续结果层',
    actionSummary: String(resultSummary?.nextStepReason || confirmationState.summary || '').trim() || '当前建议先按结果层推荐动作继续。',
    noteItems: [
      failedCount > 0 ? `当前仍有 ${failedCount} 项失败结果` : '当前没有硬失败',
      reviewCount > 0 ? `当前仍有 ${reviewCount} 项待复核` : '当前复核压力较低',
    ],
  });
}

function buildExceptionCockpitSummary(exceptionSummary) {
  const failedCount = Number(exceptionSummary?.failedCount || 0);
  const reviewCount = Number(exceptionSummary?.reviewCount || 0);
  const totalIssueCount = failedCount + reviewCount;
  return buildStageReviewCockpitSummary({
    copy: '这里只解释异常层当前结论、当前重点和阻塞情况，不重复上方动作建议。',
    statusLabel: String(exceptionSummary?.statusLabel || '未提供').trim() || '未提供',
    statusSummary: String(exceptionSummary?.statusSummary || '未提供').trim() || '未提供',
    statusTone: String(exceptionSummary?.statusTone || '').trim() || 'info',
    focusValue: String(exceptionSummary?.currentFocus || '').trim() || (failedCount > 0 ? '先处理失败项' : (reviewCount > 0 ? '先确认待复核项' : '可回工作台')),
    focusSummary: String(exceptionSummary?.nextStepReason || exceptionSummary?.issueSummary || '').trim() || '先按异常层当前判断继续。',
    focusTone: failedCount > 0 ? 'bad' : 'good',
    pressureValue: totalIssueCount > 0 ? `${totalIssueCount} 项问题待处理` : '当前可回工作台',
    pressureSummary: String(exceptionSummary?.issueSummary || '当前没有明显异常压力。').trim() || '当前没有明显异常压力。',
    pressureTone: totalIssueCount > 0 ? 'bad' : 'good',
  });
}

function buildExceptionJudgmentPanel(exceptionSummary) {
  const confirmationState = exceptionSummary?.confirmationState || {};
  const failedCount = Number(exceptionSummary?.failedCount || 0);
  const reviewCount = Number(exceptionSummary?.reviewCount || 0);
  const totalIssueCount = failedCount + reviewCount;
  const primaryActionLabel = getStagePrimaryActionLabel('exception', { failedCount });
  return buildStageReviewJudgmentPanel({
    stageKey: 'exception',
    stageLabel: '异常层',
    confirmationState,
    statusLabel: String(exceptionSummary?.statusLabel || '异常层判断').trim() || '异常层判断',
    statusSummary: String(exceptionSummary?.issueSummary || exceptionSummary?.statusSummary || '').trim() || '先按异常层当前判断继续。',
    statusTone: String(exceptionSummary?.statusTone || '').trim() || (totalIssueCount > 0 ? 'bad' : 'good'),
    actionLabel: String(exceptionSummary?.nextStepLabel || primaryActionLabel).trim() || '继续异常层',
    actionSummary: String(exceptionSummary?.nextStepReason || confirmationState.summary || exceptionSummary?.issueSummary || '').trim() || '当前建议先把异常收口。',
    noteItems: [
      failedCount > 0 ? `当前仍有 ${failedCount} 项失败项` : '当前没有硬失败',
      reviewCount > 0 ? `当前仍有 ${reviewCount} 项待复核` : '当前复核压力较低',
    ],
  });
}

function buildPrepareDialogueStatus(prepareSummary) {
  const interaction = getWorkspaceInteractionTemplates('prepare');
  const readiness = prepareSummary?.readiness || {};
  const hasBlocking = toArray(readiness.blockingItems).length > 0;
  const confirmationState = prepareSummary?.confirmationState || {};
  const importedBindingCount = Number(prepareSummary?.importedBindingCount || 0);
  return buildStageReviewDialogueStatus({
    stageKey: 'prepare',
    confirmationState,
    fallbackReplyOptions: {
      hasBlocking,
      importedBindingCount,
    },
    replyReason: prepareSummary?.nextStepReason || confirmationState.summary || readiness.detail,
    summary: confirmationState.summary || readiness.detail,
    recentFallbackItems: [
      `${interaction.dialogue.recentReadinessLabel}: ${String(readiness.label || '未提供').trim() || '未提供'}`,
      importedBindingCount > 0 ? interaction.dialogue.recentBindingYes : interaction.dialogue.recentBindingNo,
    ],
    understoodFallbackItems: [
      `放行状态: ${String(readiness.label || '未提供').trim() || '未提供'}`,
      `任务主轴: ${String(prepareSummary?.mainDirection || '未提供').trim() || '未提供'}`,
      importedBindingCount > 0 ? `素材绑定: ${importedBindingCount} 项` : getWorkspaceInteractionTemplates('prepare').dialogue.understoodBindingNo,
    ],
    defaultActionReason: '当前建议先完成准备层最后确认，再顺着主链进入结果工作台。',
  });
}

function buildResultDialogueStatus(resultSummary) {
  const interaction = getWorkspaceInteractionTemplates('result');
  const failedCount = Number(resultSummary?.failedCount || 0);
  const reviewCount = Number(resultSummary?.reviewCount || 0);
  const confirmationState = resultSummary?.confirmationState || {};
  return buildStageReviewDialogueStatus({
    stageKey: 'result',
    confirmationState,
    fallbackReplyOptions: {
      failedCount,
      reviewCount,
    },
    replyReason: resultSummary?.nextStepReason || confirmationState.summary || resultSummary?.statusSummary,
    summary: confirmationState.summary || resultSummary?.statusSummary,
    recentFallbackItems: [
      `${interaction.dialogue.recentStatusLabel}: ${String(resultSummary?.statusLabel || '未提供').trim() || '未提供'}`,
      failedCount > 0 ? interaction.dialogue.recentFailed : interaction.dialogue.recentClear,
    ],
    understoodFallbackItems: [
      `当前状态: ${String(resultSummary?.statusLabel || '未提供').trim() || '未提供'}`,
      `当前重点: ${String(resultSummary?.currentFocus || '未提供').trim() || '未提供'}`,
      failedCount > 0 ? `失败项: ${failedCount} 项` : (reviewCount > 0 ? `待复核项: ${reviewCount} 项` : getWorkspaceInteractionTemplates('result').dialogue.understoodStable),
    ],
    defaultActionReason: '当前建议先按推荐动作继续收口，不需要在结果页里自己判断下一跳。',
  });
}

function buildExceptionDialogueStatus(exceptionSummary) {
  const interaction = getWorkspaceInteractionTemplates('exception');
  const failedCount = Number(exceptionSummary?.failedCount || 0);
  const reviewCount = Number(exceptionSummary?.reviewCount || 0);
  const confirmationState = exceptionSummary?.confirmationState || {};
  return buildStageReviewDialogueStatus({
    stageKey: 'exception',
    confirmationState,
    fallbackReplyOptions: {
      failedCount,
    },
    replyReason: exceptionSummary?.nextStepReason || confirmationState.summary || exceptionSummary?.issueSummary,
    summary: confirmationState.summary || exceptionSummary?.issueSummary,
    recentFallbackItems: [
      `${interaction.dialogue.recentStatusLabel}: ${String(exceptionSummary?.statusLabel || '未提供').trim() || '未提供'}`,
      failedCount > 0 ? interaction.dialogue.recentFailed : interaction.dialogue.recentReviewOnly,
    ],
    understoodFallbackItems: [
      `当前状态: ${String(exceptionSummary?.statusLabel || '未提供').trim() || '未提供'}`,
      failedCount > 0 ? `失败项: ${failedCount} 项` : getWorkspaceInteractionTemplates('exception').dialogue.understoodFailedNone,
      reviewCount > 0 ? `待复核项: ${reviewCount} 项` : getWorkspaceInteractionTemplates('exception').dialogue.understoodReviewNone,
    ],
    defaultActionReason: '当前建议先把异常相关问题收掉，再考虑回到主链继续。',
  });
}

function buildRuntimeAwareDialogueStatus(baseDialogueStatus, runtimeSummary) {
  const base = baseDialogueStatus && typeof baseDialogueStatus === 'object'
    ? baseDialogueStatus
    : buildDialogueStatus();
  const runtimeDialogue = runtimeSummary?.workflowDialogue && typeof runtimeSummary.workflowDialogue === 'object'
    ? runtimeSummary.workflowDialogue
    : (runtimeSummary?.dialogueStatus && typeof runtimeSummary.dialogueStatus === 'object'
      ? runtimeSummary.dialogueStatus
      : null);
  const runtimeStatus = String(runtimeSummary?.currentStatus || '').trim();
  if (!runtimeDialogue || !runtimeStatus) return base;

  const currentBatch = Number(runtimeSummary?.currentBatch || 0);
  const progressSummary = String(runtimeSummary?.progressSummary || '').trim();
  const recentItems = buildRelayItems(
    runtimeDialogue.recentItems || [],
    progressSummary ? [`当前进展: ${progressSummary}`] : [],
    4,
  );
  const understoodItems = buildRelayItems(
    runtimeDialogue.understoodItems || [],
    [],
    4,
  );
  const nextSayItems = buildRelayItems(
    runtimeDialogue.nextSayItems || [],
    base.nextSayItems || [],
    4,
  );
  const primarySay = String(runtimeDialogue.primarySay || nextSayItems[0] || base.primarySay || '').trim();
  const alternativeSayItems = buildRelayItems(
    runtimeDialogue.alternativeSayItems || [],
    nextSayItems.slice(primarySay ? 1 : 0),
    3,
  ).filter((item) => item !== primarySay);

  return buildDialogueStatus({
    ...base,
    ...runtimeDialogue,
    copy: String(runtimeDialogue.copy || base.copy || '').trim()
      || getDefaultDialogueStatusCopy(),
    recentItems,
    understoodItems,
    nextSayItems,
    primarySay,
    alternativeSayItems,
    actionReason: String(runtimeDialogue.actionReason || base.actionReason || '').trim()
      || (currentBatch > 0 ? `当前正在执行第 ${currentBatch} 批，先盯住进度最省心。` : ''),
    summary: String(runtimeDialogue.summary || base.summary || progressSummary || '').trim(),
  });
}

function buildResultView(resultSummary, options = {}) {
  const identity = getWorkspaceIdentityCopy();
  const panelLanguage = getWorkspacePanelLanguage('result');
  const language = getWorkspaceLanguageSystem('result');
  const labels = getWorkspaceFieldLabels('result');
  const copy = getWorkspaceCopyTemplates('result');
  const stateResult = resultSummary || {};
  const handoffFromPrevious = options.handoffFromPrevious || options.transitionStatus || buildTransitionStatus();
  const handoffToNext = options.handoffToNext || buildTransitionStatus();
  const resolvedDialogueStatus = options.dialogueStatus || buildDialogueStatus();
  const resolvedConfirmation = options.confirmation || null;
  const resolvedTimeline = options.timeline || null;
  const flow = {
    title: String(options.flowTitle || '').trim() || language.flowTitle,
    copy: String(options.flowCopy || '').trim() || language.flowCopy,
    status: String(options.flowStatus || stateResult.statusLabel || '未提供').trim() || '未提供',
    readiness: String(options.flowReadiness || stateResult.statusSummary || '未提供').trim() || '未提供',
    focus: String(options.flowFocus || stateResult.currentFocus || '未提供').trim() || '未提供',
    actionLabel: String(options.flowActionLabel || stateResult.nextStepLabel || '未提供').trim() || '未提供',
    actionSummary: String(options.flowActionSummary || stateResult.nextStepReason || '未提供').trim() || '未提供',
    completion: String(options.flowCompletion || '').trim() || (Number(stateResult.failedCount || 0) > 0 ? copy.flowCompletionBad : (Number(stateResult.reviewCount || 0) > 0 ? copy.flowCompletionWarn : copy.flowCompletionGood)),
    blockers: toArray(options.flowBlockers),
    availableActions: toArray(options.flowAvailableActions),
  };
  return {
    hero: {
      eyebrow: String(options.eyebrow || '').trim() || '结果判断台',
      title: String(options.title || '').trim() || 'DAOGE 结果工作台',
      intro: String(options.intro || '').trim() || copy.heroIntro,
    },
    context: {
      runLabel: String(options.runLabel || '').trim(),
      phaseLabel: String(options.phaseLabel || identity.stages.result).trim() || identity.stages.result,
      flowLabel: String(options.flowLabel || '').trim() || identity.flows.result,
      counts: toArray(options.contextCounts),
      hints: toArray(options.contextHints),
    },
    heroCards: toArray(options.heroCards),
    taskControlBar: options.taskControlBar || null,
    signalBar: options.signalBar || null,
    statusStack: toArray(options.statusStack),
    sessionConsole: options.sessionConsole || null,
    controlRail: options.controlRail || buildViewControlRail({
      taskLabel: String(options.runLabel || '').trim(),
      stageLabel: String(options.phaseLabel || identity.stages.result).trim() || identity.stages.result,
      statusLabel: String(stateResult.statusLabel || '').trim(),
      pressureLabel: Number(stateResult.failedCount || 0) > 0
        ? `${Number(stateResult.failedCount || 0)} 项失败`
        : (Number(stateResult.reviewCount || 0) > 0 ? `${Number(stateResult.reviewCount || 0)} 项待复核` : '当前平稳'),
      nextActionLabel: flow.actionLabel,
      nextActionSummary: flow.actionSummary,
      recommendedReply: resolvedConfirmation?.recommendedReply || options.actionStatus?.recommendedReply || resolvedDialogueStatus?.primarySay,
      taskControlBar: options.taskControlBar || null,
      signalBar: options.signalBar || null,
      statusStack: options.statusStack || [],
      confirmation: resolvedConfirmation,
      actionStatus: options.actionStatus || null,
      dialogueStatus: resolvedDialogueStatus || null,
    }),
    cockpitSummary: options.cockpitSummary || buildResultCockpitSummary(stateResult),
    confirmation: resolvedConfirmation,
    timeline: resolvedTimeline,
    progress: options.progress || null,
    judgment: options.judgment || buildResultJudgmentPanel(stateResult),
    decision: buildWorkspaceDecisionSectionData({
      source: options.decision,
      title: language.decisionTitle,
      copy: language.decisionCopy,
      items: [
        { label: labels.currentStatus, value: String(stateResult.statusLabel || '未提供').trim() || '未提供' },
        { label: labels.currentFocus, value: String(stateResult.currentFocus || '未提供').trim() || '未提供' },
        { label: labels.nextAction, value: String(stateResult.nextStepLabel || '未提供').trim() || '未提供' },
        { label: labels.resultOverview, value: `${Number(stateResult.successCount || 0)} 成功 / ${Number(stateResult.failedCount || 0)} 失败 / ${Number(stateResult.reviewCount || 0)} 待复核` },
      ],
    }),
    summary: buildWorkspaceSummarySectionData({
      source: options.summary,
      enabled: options.summaryEnabled,
      title: '结果摘要',
      copy: copy.summaryCopy,
      items: [
        { label: '当前阶段', value: '结果阶段' },
        { label: '当前结论', value: String(stateResult.statusLabel || '未提供').trim() || '未提供' },
        { label: '结果概况', value: `${Number(stateResult.successCount || 0)} 成功 / ${Number(stateResult.failedCount || 0)} 失败 / ${Number(stateResult.reviewCount || 0)} 待复核` },
        { label: '当前重点', value: String(stateResult.currentFocus || '未提供').trim() || '未提供' },
        { label: '下一步', value: String(stateResult.nextStepLabel || '未提供').trim() || '未提供' },
        { label: '为什么先做这一步', value: String(stateResult.nextStepReason || stateResult.statusSummary || '按推荐下一步继续。').trim() || '按推荐下一步继续。' },
      ],
    }),
    route: buildWorkspaceRouteSectionData({
      source: options.route,
      title: language.routeTitle,
      copy: language.routeCopy,
      current: options.routeCurrent || null,
      previous: options.previous || null,
      nextSteps: toArray(options.nextSteps),
    }),
    workbench: buildWorkspaceWorkbenchSectionData({
      source: options.workbench,
      title: language.workbenchTitle,
      copy: language.workbenchCopy,
      cards: toArray(options.workbenchCards),
    }),
    guides: {
      entryStructure: options.entryGuide || null,
      assetVisibility: options.assetGuide || null,
    },
    assetStatus: options.assetStatus || buildAssetStatus(),
    actionStatus: options.actionStatus || buildActionStatus(),
    dialogueStatus: resolvedDialogueStatus,
    collaboration: options.collaboration || buildWorkspaceCollaborationSectionData({
      confirmation: resolvedConfirmation,
      timeline: resolvedTimeline,
      dialogue: resolvedDialogueStatus,
    }),
    stageRelay: options.stageRelay || buildResultStageRelay(stateResult, {
      handoffFromPrevious,
      handoffToNext,
      route: {
        previous: options.previous || null,
        nextSteps: toArray(options.nextSteps),
      },
    }),
    transitionStatus: handoffFromPrevious,
    handoffFromPrevious,
    handoffToNext,
    copilot: options.copilot || null,
    workflowCopilot: options.workflowCopilot || null,
    workflowContract: options.workflowContract || null,
    contentSections: buildWorkspaceContentSectionPlan(options.contentSections, [
      { key: 'preview', kind: 'previewGrid' },
      { key: 'issues', kind: 'issuesGrid' },
      { key: 'guide', kind: 'keyValue' },
      { key: 'visibility', kind: 'keyValue' },
    ]),
    flow,
    sections: {
      guide: buildWorkspaceGuideSectionData({
        title: options.guideTitle,
        copy: String(options.guideCopy || '').trim() || copy.guideCopy,
        items: toArray(options.guideItems),
      }),
      visibility: buildWorkspaceGuideSectionData({
        title: options.visibilityTitle,
        copy: String(options.visibilityCopy || '').trim() || copy.visibilityCopy,
        items: toArray(options.visibilityItems),
      }),
      preview: buildWorkspacePreviewSectionData({
        title: options.previewTitle,
        copy: String(options.previewCopy || '').trim() || copy.previewCopy,
        emptyText: String(options.previewEmptyText || '').trim() || copy.previewEmptyText,
        itemFallbackSummary: String(options.previewItemFallbackSummary || '').trim() || copy.previewFallback,
        imageLinkLabel: options.previewImageLinkLabel,
        imageMissingText: options.previewImageMissingText,
      }),
      issues: buildWorkspaceIssuesSectionData({
        title: options.issuesTitle,
        copy: String(options.issuesCopy || '').trim() || copy.issuesCopy,
        emptyText: String(options.issuesEmptyText || '').trim() || copy.issuesEmptyText,
        kicker: options.issuesKicker,
        fallbackReason: String(options.issuesFallbackReason || '').trim() || copy.issuesFallback,
      }),
      advanced: buildWorkspaceAdvancedSectionData({
        title: options.advancedTitle,
        copy: String(options.advancedCopy || '').trim() || copy.advancedCopy,
        summary: options.advancedSummary,
        requestModeTitle: options.advancedRequestModeTitle,
        styleTitle: options.advancedStyleTitle,
        slotRoleTitle: options.advancedSlotRoleTitle,
        emptyText: String(options.advancedEmptyText || '').trim() || copy.advancedEmptyText,
      }),
    },
  };
}

function buildExceptionView(exceptionSummary, options = {}) {
  const identity = getWorkspaceIdentityCopy();
  const panelLanguage = getWorkspacePanelLanguage('exception');
  const language = getWorkspaceLanguageSystem('exception');
  const labels = getWorkspaceFieldLabels('exception');
  const copy = getWorkspaceCopyTemplates('exception');
  const stateException = exceptionSummary || {};
  const handoffFromPrevious = options.handoffFromPrevious || options.transitionStatus || buildTransitionStatus();
  const handoffToNext = options.handoffToNext || buildTransitionStatus();
  const resolvedDialogueStatus = options.dialogueStatus || buildDialogueStatus();
  const resolvedConfirmation = options.confirmation || null;
  const resolvedTimeline = options.timeline || null;
  const flow = {
    title: String(options.flowTitle || '').trim() || language.flowTitle,
    copy: String(options.flowCopy || '').trim() || language.flowCopy,
    status: String(options.flowStatus || stateException.statusLabel || '未提供').trim() || '未提供',
    readiness: String(options.flowReadiness || stateException.statusSummary || '未提供').trim() || '未提供',
    focus: String(options.flowFocus || stateException.currentFocus || '未提供').trim() || '未提供',
    actionLabel: String(options.flowActionLabel || stateException.nextStepLabel || '未提供').trim() || '未提供',
    actionSummary: String(options.flowActionSummary || stateException.issueSummary || '未提供').trim() || '未提供',
    completion: String(options.flowCompletion || '').trim() || (Number(stateException.failedCount || 0) > 0 ? copy.flowCompletionBad : (Number(stateException.reviewCount || 0) > 0 ? copy.flowCompletionWarn : copy.flowCompletionGood)),
    blockers: toArray(options.flowBlockers),
    availableActions: toArray(options.flowAvailableActions),
  };
  return {
    hero: {
      eyebrow: String(options.eyebrow || '').trim() || '异常处理台',
      title: String(options.title || '').trim() || 'DAOGE 异常工作台',
      intro: String(options.intro || '').trim() || copy.heroIntro,
    },
    context: {
      runLabel: String(options.runLabel || '').trim(),
      phaseLabel: String(options.phaseLabel || identity.stages.exception).trim() || identity.stages.exception,
      flowLabel: String(options.flowLabel || '').trim() || identity.flows.exception,
      counts: toArray(options.contextCounts),
      hints: toArray(options.contextHints),
    },
    heroCards: toArray(options.heroCards),
    taskControlBar: options.taskControlBar || null,
    signalBar: options.signalBar || null,
    statusStack: toArray(options.statusStack),
    sessionConsole: options.sessionConsole || null,
    controlRail: options.controlRail || buildViewControlRail({
      taskLabel: String(options.runLabel || '').trim(),
      stageLabel: String(options.phaseLabel || identity.stages.exception).trim() || identity.stages.exception,
      statusLabel: String(stateException.statusLabel || '').trim(),
      pressureLabel: Number(stateException.failedCount || 0) + Number(stateException.reviewCount || 0) > 0
        ? `${Number(stateException.failedCount || 0) + Number(stateException.reviewCount || 0)} 项问题待处理`
        : '当前平稳',
      nextActionLabel: flow.actionLabel,
      nextActionSummary: flow.actionSummary,
      recommendedReply: resolvedConfirmation?.recommendedReply || options.actionStatus?.recommendedReply || resolvedDialogueStatus?.primarySay,
      taskControlBar: options.taskControlBar || null,
      signalBar: options.signalBar || null,
      statusStack: options.statusStack || [],
      confirmation: resolvedConfirmation,
      actionStatus: options.actionStatus || null,
      dialogueStatus: resolvedDialogueStatus || null,
    }),
    cockpitSummary: options.cockpitSummary || buildExceptionCockpitSummary(stateException),
    confirmation: resolvedConfirmation,
    timeline: resolvedTimeline,
    progress: options.progress || null,
    judgment: options.judgment || buildExceptionJudgmentPanel(stateException),
    decision: buildWorkspaceDecisionSectionData({
      source: options.decision,
      title: language.decisionTitle,
      copy: language.decisionCopy,
      items: [
        { label: labels.currentStatus, value: String(stateException.statusLabel || '未提供').trim() || '未提供' },
        { label: labels.currentFocus, value: String(stateException.currentFocus || '未提供').trim() || '未提供' },
        { label: labels.nextAction, value: String(stateException.nextStepLabel || '未提供').trim() || '未提供' },
        { label: labels.issueOverview, value: `${Number(stateException.failedCount || 0)} 失败 / ${Number(stateException.reviewCount || 0)} 待复核 / ${Number(stateException.rerunCount || 0)} 补跑候选` },
      ],
    }),
    summary: buildWorkspaceSummarySectionData({
      source: options.summary,
      enabled: options.summaryEnabled,
      title: '异常摘要',
      copy: copy.summaryCopy,
      items: [
        { label: '当前阶段', value: '异常阶段' },
        { label: '当前结论', value: String(stateException.statusLabel || '未提供').trim() || '未提供' },
        { label: '结果概况', value: `${Number(stateException.failedCount || 0)} 失败 / ${Number(stateException.reviewCount || 0)} 待复核 / ${Number(stateException.rerunCount || 0)} 补跑候选` },
        { label: '当前重点', value: String(stateException.currentFocus || '未提供').trim() || '未提供' },
        { label: '下一步', value: String(stateException.nextStepLabel || '未提供').trim() || '未提供' },
        { label: '为什么先做这一步', value: String(stateException.nextStepReason || stateException.issueSummary || '按推荐下一步继续。').trim() || '按推荐下一步继续。' },
      ],
    }),
    route: buildWorkspaceRouteSectionData({
      source: options.route,
      title: language.routeTitle,
      copy: language.routeCopy,
      current: options.routeCurrent || null,
      previous: options.previous || null,
      nextSteps: toArray(options.nextSteps),
    }),
    workbench: buildWorkspaceWorkbenchSectionData({
      source: options.workbench,
      title: language.workbenchTitle,
      copy: language.workbenchCopy,
      cards: toArray(options.workbenchCards),
    }),
    guides: {
      entryStructure: options.entryGuide || null,
      assetVisibility: options.assetGuide || null,
    },
    assetStatus: options.assetStatus || buildAssetStatus(),
    actionStatus: options.actionStatus || buildActionStatus(),
    dialogueStatus: resolvedDialogueStatus,
    collaboration: options.collaboration || buildWorkspaceCollaborationSectionData({
      confirmation: resolvedConfirmation,
      timeline: resolvedTimeline,
      dialogue: resolvedDialogueStatus,
    }),
    stageRelay: options.stageRelay || buildExceptionStageRelay(stateException, {
      handoffFromPrevious,
      handoffToNext,
      route: {
        previous: options.previous || null,
        nextSteps: toArray(options.nextSteps),
      },
    }),
    transitionStatus: handoffFromPrevious,
    handoffFromPrevious,
    handoffToNext,
    copilot: options.copilot || null,
    workflowCopilot: options.workflowCopilot || null,
    workflowContract: options.workflowContract || null,
    contentSections: buildWorkspaceContentSectionPlan(options.contentSections, [
      { key: 'issues', kind: 'issuesGrid' },
      { key: 'guide', kind: 'keyValue' },
      { key: 'visibility', kind: 'keyValue' },
    ]),
    flow,
    sections: {
      guide: buildWorkspaceGuideSectionData({
        title: options.guideTitle,
        copy: String(options.guideCopy || '').trim() || copy.guideCopy,
        items: toArray(options.guideItems),
      }),
      visibility: buildWorkspaceGuideSectionData({
        title: options.visibilityTitle,
        copy: String(options.visibilityCopy || '').trim() || copy.visibilityCopy,
        items: toArray(options.visibilityItems),
      }),
      issues: buildWorkspaceIssuesSectionData({
        title: options.issuesTitle || '问题列表',
        copy: String(options.issuesCopy || '').trim() || copy.issuesCopy,
        emptyText: String(options.issuesEmptyText || '').trim() || copy.issuesEmptyText,
        failedFallbackSummary: String(options.failedFallbackSummary || '').trim() || copy.failedFallbackSummary,
        reviewFallbackSummary: String(options.reviewFallbackSummary || '').trim() || copy.reviewFallbackSummary,
      }),
    },
  };
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.bindings)) return value.bindings;
  return [];
}

function inferWorkflowKind(manifest, taskSpec, modeDetection) {
  if (manifest?.hostNative || manifest?.runtimeMode === 'host-native-image-tool') return 'host-native';
  if (taskSpec?.storyboard_plan?.enabled || String(modeDetection?.detected_mode || '').includes('storyboard')) return 'storyboard';
  if (manifest?.resumeManifest) return 'local-edit';
  return 'standard';
}

function inferStatus(manifest, outputDir, options = {}) {
  const failedCount = Number(manifest?.failed || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const selectedCount = Number(manifest?.selectedCount || manifest?.promptCount || 0);
  const runtimeMode = String(manifest?.runtimeMode || '').trim();
  const runtimeSummary = options.runtimeSummary && typeof options.runtimeSummary === 'object'
    ? options.runtimeSummary
    : null;
  const runtimeStatus = String(runtimeSummary?.currentStatus || options.jobStatus || '').trim();
  const progress = options.jobProgress && typeof options.jobProgress === 'object'
    ? options.jobProgress
    : {};
  const hasResults = fileExists(path.join(outputDir, 'result_workspace.html'));
  const hasPrepare = fileExists(path.join(outputDir, 'prepare_workspace.html'));
  const hasCompletedExecution = runtimeStatus === 'completed'
    || Boolean(manifest?.hostNative)
    || failedCount > 0
    || Number(manifest?.success || 0) > 0;

  if (runtimeMode === 'prepare-only') {
    return {
      phase: '准备阶段',
      tone: 'info',
      headline: '准备层已生成，先确认方向与放行',
      summary: '建议先进入准备工作台，确认模板方向、提示词预览和素材绑定。',
    };
  }
  if (runtimeStatus === 'running') {
    const completedBatches = Number(runtimeSummary?.completedBatchCount ?? progress.completedBatches ?? 0);
    const totalBatches = Number(runtimeSummary?.totalBatchCount ?? progress.totalBatches ?? 0);
    const currentBatch = Number(runtimeSummary?.currentBatch ?? progress.currentBatch ?? 0);
    return {
      phase: String(runtimeSummary?.phaseLabel || '执行中').trim() || '执行中',
      tone: String(runtimeSummary?.phaseTone || 'info').trim() || 'info',
      headline: String(
        runtimeSummary?.phaseHeadline
        || (currentBatch > 0 ? `当前正在执行第 ${currentBatch} 批` : '当前任务正在执行中')
      ).trim() || '当前任务正在执行中',
      summary: String(
        runtimeSummary?.phaseSummary
        || (totalBatches > 0
          ? `当前已完成 ${completedBatches}/${totalBatches} 批，建议先等待这一批结束后再做下一步判断。`
          : '当前任务正在执行中，建议先等待当前批次结束。')
      ).trim() || '当前任务正在执行中，建议先等待当前批次结束。',
    };
  }
  if (runtimeStatus === 'planned') {
    return {
      phase: String(runtimeSummary?.phaseLabel || '待执行').trim() || '待执行',
      tone: String(runtimeSummary?.phaseTone || 'info').trim() || 'info',
      headline: String(runtimeSummary?.phaseHeadline || '任务已经排队，等待开始执行').trim() || '任务已经排队，等待开始执行',
      summary: String(runtimeSummary?.phaseSummary || '当前批次计划已经生成，可以先回工作台首页确认执行节奏。').trim() || '当前批次计划已经生成，可以先回工作台首页确认执行节奏。',
    };
  }
  if (runtimeStatus === 'awaiting_confirmation' || runtimeStatus === 'waiting') {
    return {
      phase: String(runtimeSummary?.phaseLabel || '等待确认').trim() || '等待确认',
      tone: String(runtimeSummary?.phaseTone || 'warn').trim() || 'warn',
      headline: String(runtimeSummary?.phaseHeadline || '任务正在等待你确认后继续').trim() || '任务正在等待你确认后继续',
      summary: String(runtimeSummary?.phaseSummary || '当前已经停在需要确认的节点，先确认这一步，再继续最稳。').trim() || '当前已经停在需要确认的节点，先确认这一步，再继续最稳。',
    };
  }
  if (runtimeStatus === 'paused' || manifest?.paused) {
    return {
      phase: '异常阶段',
      tone: String(runtimeSummary?.phaseTone || 'warn').trim() || 'warn',
      headline: String(runtimeSummary?.phaseHeadline || '本轮已暂停，建议先处理风险').trim() || '本轮已暂停，建议先处理风险',
      summary: String(runtimeSummary?.phaseSummary || manifest.pauseReason || '建议先检查暂停原因，再决定是否继续。').trim() || '建议先检查暂停原因，再决定是否继续。',
    };
  }
  if (runtimeStatus === 'completed' && runtimeSummary) {
    return {
      phase: String(runtimeSummary.phaseLabel || (failedCount > 0 ? '结果阶段' : '已完成')).trim() || '已完成',
      tone: String(runtimeSummary.phaseTone || (failedCount > 0 ? 'warn' : 'good')).trim() || 'good',
      headline: String(runtimeSummary.phaseHeadline || (failedCount > 0 ? '结果已生成，但仍有异常需处理' : '任务已完成，可继续回看结果')).trim() || '任务已完成，可继续回看结果',
      summary: String(runtimeSummary.phaseSummary || (failedCount > 0 ? '当前建议先检查失败项，再决定是否补跑。' : '当前结果已生成，可以进入结果工作台继续筛图。')).trim() || '当前结果已生成，可以进入结果工作台继续筛图。',
    };
  }
  if (failedCount > 0) {
    return {
      phase: '异常阶段',
      tone: 'bad',
      headline: '当前存在异常，建议先统一处理',
      summary: '建议先进入异常工作台，把失败项收口后再继续。',
    };
  }
  if (reviewCount > 0) {
    return {
      phase: '结果阶段',
      tone: 'warn',
      headline: '结果整体稳定，但仍有待复核项',
      summary: '建议先看待复核项，再决定是否继续扩图或收口。',
    };
  }
  if (hasResults && hasCompletedExecution) {
    return {
      phase: '结果阶段',
      tone: 'good',
      headline: '结果整体稳定，可以继续收口',
      summary: '建议先进入结果工作台筛图，再决定是否回整板或进入下一轮。',
    };
  }
  if (selectedCount > 0 && hasCompletedExecution) {
    return {
      phase: '结果阶段',
      tone: 'good',
      headline: '结果层已经就绪，可以继续收口',
      summary: '建议先进入结果工作台筛图，再决定是否回整板或进入下一轮。',
    };
  }
  if (hasPrepare) {
    return {
      phase: '准备阶段',
      tone: 'info',
      headline: '准备层已生成，先确认方向与放行',
      summary: '建议先进入准备工作台，确认模板方向、提示词预览和素材绑定。',
    };
  }
  return {
    phase: '待开始',
    tone: 'info',
    headline: '当前任务尚未进入主链',
    summary: '建议先从模板入口或任务中心开始。',
  };
}

function inferNextAction(manifest, outputDir, options = {}) {
  const failedCount = Number(manifest?.failed || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const runtimeMode = String(manifest?.runtimeMode || '').trim();
  const runtimeSummary = options.runtimeSummary && typeof options.runtimeSummary === 'object'
    ? options.runtimeSummary
    : null;
  const runtimeStatus = String(runtimeSummary?.currentStatus || options.jobStatus || '').trim();
  const progress = options.jobProgress && typeof options.jobProgress === 'object'
    ? options.jobProgress
    : {};
  const hasCompletedExecution = runtimeStatus === 'completed'
    || Boolean(manifest?.hostNative)
    || failedCount > 0
    || Number(manifest?.success || 0) > 0;
  if (runtimeStatus === 'running') {
    const runtimeTarget = String(runtimeSummary?.nextSuggestedAction?.target || '').trim();
    return {
      label: String(runtimeSummary?.nextSuggestedAction?.label || '查看当前执行进度').trim() || '查看当前执行进度',
      reason: String(
        runtimeSummary?.nextSuggestedAction?.reason
        || (Number(runtimeSummary?.currentBatch ?? progress.currentBatch ?? 0) > 0
          ? `当前正在执行第 ${Number(runtimeSummary?.currentBatch ?? progress.currentBatch ?? 0)} 批，工作台会持续刷新。`
          : '当前任务正在执行中，工作台会持续刷新。')
      ).trim() || '当前任务正在执行中，工作台会持续刷新。',
      target: runtimeTarget ? path.basename(runtimeTarget) : 'workspace_home.html',
    };
  }
  if (runtimeStatus === 'planned') {
    const runtimeTarget = String(runtimeSummary?.nextSuggestedAction?.target || '').trim();
    return {
      label: String(runtimeSummary?.nextSuggestedAction?.label || '进入工作台首页').trim() || '进入工作台首页',
      reason: String(runtimeSummary?.nextSuggestedAction?.reason || '当前任务已经排队，先回工作台首页确认执行节奏。').trim() || '当前任务已经排队，先回工作台首页确认执行节奏。',
      target: runtimeTarget ? path.basename(runtimeTarget) : 'workspace_home.html',
    };
  }
  if (runtimeStatus === 'paused') {
    const runtimeTarget = String(runtimeSummary?.nextSuggestedAction?.target || '').trim();
    return {
      label: String(runtimeSummary?.nextSuggestedAction?.label || '先处理暂停原因').trim() || '先处理暂停原因',
      reason: String(runtimeSummary?.nextSuggestedAction?.reason || runtimeSummary?.phaseSummary || manifest.pauseReason || '当前任务已经暂停，先处理暂停原因最稳。').trim() || '当前任务已经暂停，先处理暂停原因最稳。',
      target: runtimeTarget ? path.basename(runtimeTarget) : 'workspace_home.html',
    };
  }
  if (runtimeStatus === 'awaiting_confirmation' || runtimeStatus === 'waiting') {
    const runtimeTarget = String(runtimeSummary?.nextSuggestedAction?.target || '').trim();
    return {
      label: String(runtimeSummary?.nextSuggestedAction?.label || '先完成当前确认').trim() || '先完成当前确认',
      reason: String(runtimeSummary?.nextSuggestedAction?.reason || runtimeSummary?.phaseSummary || '当前任务正在等待确认，先把这一步处理掉最稳。').trim() || '当前任务正在等待确认，先把这一步处理掉最稳。',
      target: runtimeTarget ? path.basename(runtimeTarget) : 'workspace_home.html',
    };
  }
  if (failedCount > 0) {
    return {
      label: '进入异常工作台',
      reason: '当前存在失败项，先统一处理异常最省心。',
      target: 'exception_workspace.html',
    };
  }
  if (reviewCount > 0) {
    return {
      label: '进入结果工作台',
      reason: '当前主要是人工复核问题，先回结果工作台继续细看。',
      target: 'result_workspace.html',
    };
  }
  if (fileExists(path.join(outputDir, 'result_workspace.html')) && hasCompletedExecution) {
    return {
      label: '进入结果工作台',
      reason: '当前已经具备统一结果入口，最适合继续筛图和收口。',
      target: 'result_workspace.html',
    };
  }
  if (runtimeMode !== 'prepare-only' && Number(manifest?.selectedCount || manifest?.promptCount || 0) > 0 && hasCompletedExecution) {
    return {
      label: '进入结果工作台',
      reason: '当前已经具备统一结果入口，最适合继续筛图和收口。',
      target: 'result_workspace.html',
    };
  }
  return {
    label: '进入准备工作台',
    reason: '当前更适合先确认方向、放行和素材绑定。',
    target: 'prepare_workspace.html',
  };
}

function buildUserAssetRecord(item, category, fallbackTitle) {
  const title = String(item?.title || item?.slug || item?.slotId || fallbackTitle || '未命名资产').trim() || '未命名资产';
  const summary = String(
    item?.reason
    || item?.error
    || item?.scene
    || item?.composition
    || item?.notes
    || ''
  ).trim();
  return {
    title,
    category,
    slotId: item?.slotId || null,
    requestMode: item?.requestMode || null,
    output: item?.output || item?.path || null,
    summary,
  };
}

function buildSystemAssetRecord(id, label, filePath, purpose) {
  return {
    id,
    label,
    path: filePath,
    purpose,
    exists: fileExists(filePath),
    visibility: 'system-only',
  };
}

function buildDirectoryAssetRecord(id, label, filePath, options = {}) {
  return {
    id,
    label,
    path: filePath,
    role: String(options.role || '').trim() || 'support',
    summary: String(options.summary || '').trim() || '',
    defaultVisible: options.defaultVisible === true,
    exists: fileExists(filePath),
  };
}

function buildAssetCollections({
  previewImages = [],
  resultAssets = [],
  reviewAssets = [],
  exceptionItems = [],
  referenceAssets = [],
  keyFiles = {},
  directoryProtocol = null,
} = {}) {
  return {
    userFacing: {
      preview: previewImages,
      result: resultAssets,
      review: reviewAssets,
      exception: exceptionItems,
      reference: referenceAssets,
    },
    system: {
      keyFiles,
      directoryProtocol,
    },
  };
}

function readAssetCollection(workspaceAssets = {}, collectionKey) {
  const collections = workspaceAssets?.assetCollections && typeof workspaceAssets.assetCollections === 'object'
    ? workspaceAssets.assetCollections
    : {};
  const userFacing = collections.userFacing && typeof collections.userFacing === 'object'
    ? collections.userFacing
    : {};
  const items = userFacing[collectionKey];
  return Array.isArray(items) ? items : [];
}

function readReferenceAssets(workspaceAssets = {}) {
  return readAssetCollection(workspaceAssets, 'reference');
}

function readPreviewAssets(workspaceAssets = {}) {
  return readAssetCollection(workspaceAssets, 'preview');
}

function buildUserWorkbenchProtocol(outputDir, options = {}) {
  const directoryProtocol = options.directoryProtocol && typeof options.directoryProtocol === 'object'
    ? options.directoryProtocol
    : {};
  const stateTopology = options.stateTopology && typeof options.stateTopology === 'object'
    ? options.stateTopology
    : {};
  const userFacingSurface = directoryProtocol.surfaces && typeof directoryProtocol.surfaces === 'object'
    ? (directoryProtocol.surfaces.userFacing || {})
    : {};
  const userFacingItems = Array.isArray(userFacingSurface.items) ? userFacingSurface.items : [];
  const defaultVisibleEntries = userFacingItems.filter((item) => item && item.defaultVisible);
  const fallbackMainlineFiles = [
    path.join(outputDir, 'workspace_home.html'),
    path.join(outputDir, 'prepare_workspace.html'),
    path.join(outputDir, 'result_workspace.html'),
    path.join(outputDir, 'exception_workspace.html'),
  ];
  const fallbackMainlineLabels = ['工作台首页', '准备工作台', '结果工作台', '异常工作台'];
  const defaultVisibleFiles = defaultVisibleEntries.length
    ? defaultVisibleEntries.map((item) => item.path).filter(Boolean)
    : fallbackMainlineFiles;
  const defaultVisibleLabels = defaultVisibleEntries.length
    ? defaultVisibleEntries.map((item) => item.label).filter(Boolean)
    : fallbackMainlineLabels;
  const supportEntry = userFacingItems.find((item) => item && item.role === 'support') || null;
  const defaultEntry = userFacingItems.find((item) => item && item.role === 'default-entry') || null;
  const taskCenterUnifiedState = stateTopology.taskCenterUnifiedState || path.join(path.dirname(outputDir), 'task_center_live_state.json');
  const taskCenterEntryProtocol = buildTaskCenterEntryProtocol({ source: taskCenterUnifiedState });

  return {
    version: 1,
    defaultEntryLabel: defaultEntry?.label || '工作台首页',
    defaultEntryPath: defaultEntry?.path || path.join(outputDir, 'workspace_home.html'),
    mainlineSequence: fallbackMainlineFiles,
    supportEntryLabel: supportEntry?.label || '任务档案页',
    supportEntryPath: supportEntry?.path || path.join(outputDir, 'run_record.html'),
    defaultVisibleFiles,
    defaultVisibleLabels,
    stateSources: {
      primaryRuntimeSource: stateTopology.preferredRuntimeSource || path.join(outputDir, 'workspace_live_state.json'),
      canonicalState: stateTopology.canonicalState || path.join(outputDir, 'workspace_state.json'),
      runtimeState: stateTopology.runtimeState || path.join(outputDir, 'runtime_state.json'),
      assetsState: stateTopology.assetsState || path.join(outputDir, 'workspace_assets.json'),
      timelineState: stateTopology.timelineState || path.join(outputDir, 'workspace_timeline.json'),
      compatibilitySnapshot: stateTopology.compatibilitySnapshot || path.join(outputDir, 'workbench_state.json'),
      taskCenterUnifiedState,
    },
    taskCenterEntryProtocol,
    userRule: '普通用户默认先看工作台首页，再按准备、结果、异常顺着主链继续；任务档案只在按需回看时打开；底层记录文件默认不用直接看。',
    runtimeRule: '工作台会优先使用 workspace_live_state.json 作为主实时状态源；workspace_state.json 负责统一状态模型；runtime_state.json 只负责运行期进度；workspace_assets.json 和 workspace_timeline.json 分别承接资产分层与阶段时间线；workbench_state.json 只保留兼容旧读取作用。',
    taskCenterCopy: '默认先从工作台首页进入，再顺着准备、结果、异常三站推进；任务档案只作为按需补充入口。',
    stateSourceSummary: '任务内优先读取主实时状态源，再由统一状态模型、运行状态、资产状态和时间线状态补全；跨任务切换、入口主链提醒和运行态副驾驶交接再交给任务总控实时状态源处理。',
    summary: `默认先看${defaultVisibleLabels.join('、') || '工作台主链页面'}；任务档案按需打开；workspace_live_state.json 是主实时状态源，workspace_state.json 是统一状态模型，workbench_state.json 只保留兼容快照角色，普通用户不用直接看这些文件名。`,
  };
}

function buildUnifiedAssetLayers(outputDir, options = {}) {
  const previewImages = toArray(options.previewImages);
  const resultAssets = toArray(options.resultAssets);
  const reviewAssets = toArray(options.reviewAssets);
  const exceptionItems = toArray(options.exceptionItems);
  const referenceAssets = toArray(options.referenceAssets);
  const keyFiles = options.keyFiles || {};
  const liveStateFiles = [
    buildSystemAssetRecord('workspace-live-state', 'workspace_live_state.json', path.join(outputDir, 'workspace_live_state.json'), '工作台主实时状态源'),
    buildSystemAssetRecord('runtime-state', 'runtime_state.json', path.join(outputDir, 'runtime_state.json'), '运行阶段实时状态源'),
    buildSystemAssetRecord('workspace-state', 'workspace_state.json', path.join(outputDir, 'workspace_state.json'), '工作台统一状态模型'),
    buildSystemAssetRecord('workspace-assets', 'workspace_assets.json', path.join(outputDir, 'workspace_assets.json'), '用户资产与可见性分层缓存'),
    buildSystemAssetRecord('workspace-timeline', 'workspace_timeline.json', path.join(outputDir, 'workspace_timeline.json'), '阶段时间线源'),
  ];
  const snapshotFiles = [
    buildSystemAssetRecord('workbench-state', 'workbench_state.json', path.join(outputDir, 'workbench_state.json'), '兼容旧读取方式的页面快照'),
  ];
  const executionFiles = [
    buildSystemAssetRecord('manifest', 'manifest.json', keyFiles.manifest || path.join(outputDir, 'manifest.json'), '执行清单与输出索引'),
    buildSystemAssetRecord('job-state', 'job_state.json', keyFiles.jobState || path.join(outputDir, 'job_state.json'), '续跑与进度状态'),
  ];
  const diagnosticFiles = [
    keyFiles.promptPreview
      ? buildSystemAssetRecord('prompt-preview', path.basename(keyFiles.promptPreview), keyFiles.promptPreview, '按需回看提示词预览')
      : null,
  ].filter(Boolean);

  const userFacingGroups = [
    {
      key: 'preview',
      label: '预览图',
      count: previewImages.length,
      summary: '适合先做第一轮快速筛图。',
    },
    {
      key: 'result',
      label: '可直接使用结果',
      count: resultAssets.length,
      summary: '已经进入保留、取舍和收口判断。',
    },
    {
      key: 'review',
      label: '待复核结果',
      count: reviewAssets.length,
      summary: '建议人工再确认边界、构图和主体稳定。',
    },
    {
      key: 'exception',
      label: '失败结果',
      count: exceptionItems.length,
      summary: '会直接影响主链继续，需要优先处理。',
    },
    {
      key: 'reference',
      label: '参考素材',
      count: referenceAssets.length,
      summary: '会影响方向判断和后续执行稳定性。',
    },
  ];
  const workbenchStateGroups = [
    {
      key: 'live-state',
      label: '实时状态底盘',
      count: liveStateFiles.length,
      summary: '这是工作台真正应该优先消费的统一状态来源，后续页面都应尽量从这一层读。',
    },
    {
      key: 'page-snapshot',
      label: '兼容快照',
      count: snapshotFiles.length,
      summary: '这组文件只负责兼容旧读取方式，目标是逐步退居说明层。',
    },
    {
      key: 'execution',
      label: '执行记录',
      count: executionFiles.length,
      summary: '用于恢复执行、追踪批次和输出结果。',
    },
    {
      key: 'diagnostic',
      label: '补充记录',
      count: diagnosticFiles.length,
      summary: '只有需要复盘或排查时才查看。',
    },
  ];
  const workbenchStateAssets = {
    title: '工作台状态资产',
    totalCount: liveStateFiles.length + snapshotFiles.length + executionFiles.length,
    groups: workbenchStateGroups.filter((group) => ['live-state', 'page-snapshot', 'execution'].includes(group.key)),
    items: {
      liveState: liveStateFiles,
      pageSnapshot: snapshotFiles,
      execution: executionFiles,
    },
  };
  const diagnosticFacingAssets = {
    title: '诊断归档资产',
    totalCount: diagnosticFiles.length,
    groups: workbenchStateGroups.filter((group) => group.key === 'diagnostic'),
    items: {
      diagnostic: diagnosticFiles,
    },
  };
  const systemFacingGroups = workbenchStateGroups;
  const directorySurfaceConfig = {
    userFacing: {
      title: '用户直看文件',
      description: '这一层只保留普通用户会直接打开的页面文件，默认优先感知主链和少量补充入口。',
      items: [
        buildDirectoryAssetRecord('workspace-home-file', '工作台首页', path.join(outputDir, 'workspace_home.html'), { role: 'default-entry', summary: '当前任务的默认主入口。', defaultVisible: true }),
        buildDirectoryAssetRecord('prepare-workspace-file', '准备工作台', path.join(outputDir, 'prepare_workspace.html'), { role: 'mainline', summary: '负责准备、放行和素材判断。', defaultVisible: true }),
        buildDirectoryAssetRecord('result-workspace-file', '结果工作台', path.join(outputDir, 'result_workspace.html'), { role: 'mainline', summary: '负责结果筛看、取舍和收口判断。', defaultVisible: true }),
        buildDirectoryAssetRecord('exception-workspace-file', '异常工作台', path.join(outputDir, 'exception_workspace.html'), { role: 'conditional-mainline', summary: '只在出现异常或待复核时进入。', defaultVisible: true }),
        buildDirectoryAssetRecord('run-record-html-file', '任务档案页', path.join(outputDir, 'run_record.html'), { role: 'support', summary: '保留为唯一工作台补充入口。', defaultVisible: false }),
        buildDirectoryAssetRecord('storyboard-board-file', '分镜整板页', path.join(outputDir, 'storyboard_board.html'), { role: 'conditional', summary: '只有分镜任务才需要按需打开。', defaultVisible: false }),
        buildDirectoryAssetRecord('prompt-preview-html-file', '提示词预览页', path.join(outputDir, 'prompt_preview.html'), { role: 'advanced', summary: '属于准备层深看页。', defaultVisible: false }),
        buildDirectoryAssetRecord('preflight-board-file', '预检页', path.join(outputDir, 'preflight_board.html'), { role: 'advanced', summary: '属于准备层深看页。', defaultVisible: false }),
        buildDirectoryAssetRecord('assets-board-file', '素材页', path.join(outputDir, 'assets_board.html'), { role: 'advanced', summary: '属于准备层深看页。', defaultVisible: false }),
        buildDirectoryAssetRecord('review-board-file', '审阅看板', path.join(outputDir, 'review_board.html'), { role: 'advanced', summary: '属于结果层深看页。', defaultVisible: false }),
        buildDirectoryAssetRecord('completion-board-file', '完成摘要页', path.join(outputDir, 'completion_board.html'), { role: 'advanced', summary: '属于结果层深看页。', defaultVisible: false }),
        buildDirectoryAssetRecord('run-overview-file', '运行概览页', path.join(outputDir, 'run_overview.html'), { role: 'advanced', summary: '属于结果层深看页。', defaultVisible: false }),
        buildDirectoryAssetRecord('rerun-board-file', '补跑页', path.join(outputDir, 'rerun_board.html'), { role: 'advanced', summary: '属于异常层深看页。', defaultVisible: false }),
        buildDirectoryAssetRecord('result-hub-file', '旧结果说明页', path.join(outputDir, 'result_hub.html'), { role: 'maintenance', summary: '只保留维护观察意义。', defaultVisible: false }),
        buildDirectoryAssetRecord('portal-home-file', '旧门户页', path.join(outputDir, 'daoge_portal.html'), { role: 'maintenance', summary: '只保留维护观察意义。', defaultVisible: false }),
      ],
    },
    filesystem: {
      title: '文件落盘入口',
      description: '这一层只服务本地目录阅读，不再算作工作台补充入口。',
      items: [
        buildDirectoryAssetRecord('readme-file', '入口说明', path.join(outputDir, 'README.md'), { role: 'filesystem-entry', summary: '用于在文件夹里快速找到主入口。', defaultVisible: false }),
      ],
    },
    archive: {
      title: '归档文件',
      description: '这一层只在显式归档或回看时有意义，不属于工作台默认阅读层。',
      items: [
        buildDirectoryAssetRecord('run-record-markdown-file', '任务档案 Markdown', path.join(outputDir, 'run_record.md'), { role: 'archive', summary: '归档版任务档案。', defaultVisible: false }),
        buildDirectoryAssetRecord('completion-report-file', '完成报告文字版', path.join(outputDir, 'daoge_completion_report.md'), { role: 'archive', summary: '归档版完成收口报告。', defaultVisible: false }),
        buildDirectoryAssetRecord('contact-sheet-index-file', '联系表索引', path.join(outputDir, 'contact_sheet_index.md'), { role: 'archive', summary: '只在归档导出时按需使用。', defaultVisible: false }),
      ],
    },
    internal: {
      title: '内部状态文件',
      description: '这一层服务状态底盘、恢复执行和诊断归档，默认不面向普通用户。',
      items: [
        buildDirectoryAssetRecord('workspace-live-state-file', 'workspace_live_state.json', path.join(outputDir, 'workspace_live_state.json'), { role: 'live-state', summary: '工作台主实时状态源。', defaultVisible: false }),
        buildDirectoryAssetRecord('runtime-state-file', 'runtime_state.json', path.join(outputDir, 'runtime_state.json'), { role: 'runtime-state', summary: '运行阶段实时状态源。', defaultVisible: false }),
        buildDirectoryAssetRecord('workspace-state-file', 'workspace_state.json', path.join(outputDir, 'workspace_state.json'), { role: 'state-model', summary: '工作台统一状态模型。', defaultVisible: false }),
        buildDirectoryAssetRecord('workspace-assets-file', 'workspace_assets.json', path.join(outputDir, 'workspace_assets.json'), { role: 'asset-model', summary: '资产分层与集合快照。', defaultVisible: false }),
        buildDirectoryAssetRecord('workspace-timeline-file', 'workspace_timeline.json', path.join(outputDir, 'workspace_timeline.json'), { role: 'timeline-model', summary: '阶段时间线源。', defaultVisible: false }),
        buildDirectoryAssetRecord('workbench-state-file', 'workbench_state.json', path.join(outputDir, 'workbench_state.json'), { role: 'compatibility-snapshot', summary: '兼容旧读取方式的快照。', defaultVisible: false }),
        buildDirectoryAssetRecord('manifest-file', 'manifest.json', keyFiles.manifest || path.join(outputDir, 'manifest.json'), { role: 'execution-manifest', summary: '执行清单与输出索引。', defaultVisible: false }),
        buildDirectoryAssetRecord('job-state-file', 'job_state.json', keyFiles.jobState || path.join(outputDir, 'job_state.json'), { role: 'execution-state', summary: '续跑与执行状态。', defaultVisible: false }),
        buildDirectoryAssetRecord('batch-plan-file', 'batch_plan.json', path.join(outputDir, 'batch_plan.json'), { role: 'execution-plan', summary: '批次执行计划。', defaultVisible: false }),
        buildDirectoryAssetRecord('stage-plan-file', 'stage_plan.json', path.join(outputDir, 'stage_plan.json'), { role: 'execution-plan', summary: '阶段执行计划。', defaultVisible: false }),
        buildDirectoryAssetRecord('checkpoint-file', 'checkpoint.json', path.join(outputDir, 'checkpoint.json'), { role: 'execution-checkpoint', summary: '续跑检查点。', defaultVisible: false }),
        buildDirectoryAssetRecord('operations-report-json-file', 'operations_report.json', path.join(outputDir, 'operations_report.json'), { role: 'diagnostic-summary', summary: '运行复盘 JSON。', defaultVisible: false }),
        buildDirectoryAssetRecord('operations-report-markdown-file', 'operations_report.md', path.join(outputDir, 'operations_report.md'), { role: 'diagnostic-summary', summary: '运行复盘 Markdown。', defaultVisible: false }),
        buildDirectoryAssetRecord('prompt-preview-markdown-file', 'prompt_preview.md', path.join(outputDir, 'prompt_preview.md'), { role: 'prepare-companion', summary: '提示词预览 Markdown。', defaultVisible: false }),
        buildDirectoryAssetRecord('selection-board-markdown-file', 'selection_board.md', path.join(outputDir, 'selection_board.md'), { role: 'diagnostic-companion', summary: '结果挑选与补救说明。', defaultVisible: false }),
        buildDirectoryAssetRecord('success-json-file', 'success.json', path.join(outputDir, 'success.json'), { role: 'execution-result', summary: '成功结果清单。', defaultVisible: false }),
        buildDirectoryAssetRecord('failed-json-file', 'failed.json', path.join(outputDir, 'failed.json'), { role: 'execution-result', summary: '失败结果清单。', defaultVisible: false }),
        buildDirectoryAssetRecord('skipped-json-file', 'skipped.json', path.join(outputDir, 'skipped.json'), { role: 'execution-result', summary: '跳过结果清单。', defaultVisible: false }),
        buildDirectoryAssetRecord('needs-review-json-file', 'needs_review.json', path.join(outputDir, 'needs_review.json'), { role: 'execution-result', summary: '待复核结果清单。', defaultVisible: false }),
        buildDirectoryAssetRecord('rerun-candidates-json-file', 'rerun_candidates.json', path.join(outputDir, 'rerun_candidates.json'), { role: 'execution-result', summary: '补跑候选清单。', defaultVisible: false }),
        buildDirectoryAssetRecord('prompts-generated-file', 'prompts.generated.json', path.join(outputDir, 'prompts.generated.json'), { role: 'prompt-bundle', summary: '本轮实际执行提示词。', defaultVisible: false }),
      ],
    },
  };
  const directorySurfaces = Object.fromEntries(
    Object.entries(directorySurfaceConfig).map(([key, config]) => {
      const items = toArray(config.items).filter((item) => item.exists);
      return [key, {
        title: config.title,
        description: config.description,
        count: items.length,
        items,
      }];
    })
  );
  const defaultVisibleFiles = directorySurfaces.userFacing.items
    .filter((item) => item.defaultVisible)
    .map((item) => item.path);
  const onDemandFiles = directorySurfaces.userFacing.items
    .filter((item) => !item.defaultVisible)
    .map((item) => item.path);
  const outputDirectoryProtocol = {
    version: 1,
    defaultSurface: 'user-facing',
    principle: '输出目录只把主链工作台和少量补充入口留在用户直看层；README 退回文件落盘层，归档文件和内部状态文件统一后退。',
    defaultVisibleCount: defaultVisibleFiles.length,
    defaultVisibleFiles,
    onDemandFiles,
    archiveDefaultVisible: false,
    internalDefaultVisible: false,
    surfaces: directorySurfaces,
    summary: `当前输出目录默认只让用户先看 ${defaultVisibleFiles.length} 个主链文件，其它文件按文件落盘、归档或内部状态层后退。`,
  };
  const stateTopology = {
    preferredRuntimeSource: path.join(outputDir, 'workspace_live_state.json'),
    canonicalState: path.join(outputDir, 'workspace_state.json'),
    runtimeState: path.join(outputDir, 'runtime_state.json'),
    assetsState: path.join(outputDir, 'workspace_assets.json'),
    timelineState: path.join(outputDir, 'workspace_timeline.json'),
    compatibilitySnapshot: path.join(outputDir, 'workbench_state.json'),
    taskCenterUnifiedState: path.join(path.dirname(outputDir), 'task_center_live_state.json'),
    diagnosticArchiveDefaultVisible: false,
    taskCenterEntryProtocol: buildTaskCenterEntryProtocol({
      source: path.join(path.dirname(outputDir), 'task_center_live_state.json'),
    }),
    summary: 'workspace_live_state.json 是主实时状态源，workspace_state.json 是统一状态模型，runtime_state.json / workspace_assets.json / workspace_timeline.json 分别承接运行、资产和时间线信息，workbench_state.json 退为兼容快照，task_center_live_state.json 负责跨任务总控实时状态、入口主链提醒和运行态副驾驶交接。',
  };
  const userWorkbenchProtocol = buildUserWorkbenchProtocol(outputDir, {
    directoryProtocol: outputDirectoryProtocol,
    stateTopology,
  });

  return {
    defaultLayer: 'user-facing',
    principle: '普通用户默认只看可继续判断和处理的用户资产；工作台状态底盘和诊断归档统一后退，避免让人直接面对内部文件。',
    stateTopology,
    directoryProtocol: outputDirectoryProtocol,
    userWorkbenchProtocol,
    userFacing: {
      title: '用户资产',
      totalCount: userFacingGroups.reduce((sum, item) => sum + Number(item.count || 0), 0),
      groups: userFacingGroups,
      items: {
        preview: previewImages.map((item, index) => buildUserAssetRecord(item, 'preview', `预览图 ${index + 1}`)),
        result: resultAssets.map((item, index) => buildUserAssetRecord(item, 'result', `结果 ${index + 1}`)),
        review: reviewAssets.map((item, index) => buildUserAssetRecord(item, 'review', `待复核 ${index + 1}`)),
        exception: exceptionItems.map((item, index) => buildUserAssetRecord(item, 'exception', `失败项 ${index + 1}`)),
        reference: referenceAssets.map((item, index) => buildUserAssetRecord(item, 'reference', `参考素材 ${index + 1}`)),
      },
    },
    workbenchState: workbenchStateAssets,
    diagnosticFacing: diagnosticFacingAssets,
    systemFacing: {
      title: '系统资产',
      totalCount: workbenchStateAssets.totalCount + diagnosticFacingAssets.totalCount,
      groups: systemFacingGroups,
      items: {
        state: liveStateFiles,
        snapshot: snapshotFiles,
        execution: executionFiles,
        diagnostic: diagnosticFiles,
      },
    },
  };
}

function buildUserAssetOverview(assetLayers = {}) {
  const userFacing = assetLayers && typeof assetLayers === 'object' ? (assetLayers.userFacing || {}) : {};
  const groups = Array.isArray(userFacing.groups) ? userFacing.groups : [];
  const getCount = (key) => Number(groups.find((item) => item && item.key === key)?.count || 0);
  const resultCount = getCount('result');
  const previewCount = getCount('preview');
  const reviewCount = getCount('review');
  const exceptionCount = getCount('exception');
  const referenceCount = getCount('reference');
  const readyCount = Math.max(resultCount, previewCount);
  const pendingCount = reviewCount + exceptionCount;

  return {
    readyCount,
    pendingCount,
    referenceCount,
    summary: pendingCount > 0
      ? '已经有一部分结果可以继续看，但还有内容要先收一轮'
      : (readyCount > 0
        ? '这一轮已经有可继续判断的结果，可以顺着主链继续往下走'
        : (referenceCount > 0 ? '当前主要靠参考素材来约束结果，先围绕素材一致性继续判断' : '当前还没有稳定资产可继续推进')),
  };
}

function summarizeAssets(outputDir, options = {}) {
  const successItems = toArray(options.successItems);
  const failedItems = toArray(options.failedItems);
  const reviewItems = toArray(options.reviewItems);
  const referenceBindings = options.referenceBindings || null;
  const previewImages = successItems
    .filter((item) => item && item.output)
    .slice(0, 12)
    .map((item) => ({
      title: item.title || item.slug || '未命名结果',
      output: item.output,
      slotId: item.slotId || null,
      requestMode: item.requestMode || null,
    }));

  const referenceAssets = referenceBindings ? toArray(referenceBindings.reference_assets || referenceBindings.assets || []).slice(0, 20) : [];
  const resultAssets = successItems.slice(0, 20);
  const reviewAssets = reviewItems.slice(0, 20);
  const exceptionItems = failedItems.slice(0, 20);
  const keyFiles = {
    manifest: path.join(outputDir, 'manifest.json'),
    jobState: path.join(outputDir, 'job_state.json'),
    promptPreview: fileExists(path.join(outputDir, 'prompt_preview.md')) ? path.join(outputDir, 'prompt_preview.md') : null,
  };
  const layers = buildUnifiedAssetLayers(outputDir, {
    previewImages,
    referenceAssets,
    resultAssets,
    reviewAssets,
    exceptionItems,
    keyFiles,
  });
  const assetCollections = buildAssetCollections({
    previewImages,
    referenceAssets,
    resultAssets,
    reviewAssets,
    exceptionItems,
    keyFiles,
    directoryProtocol: layers.directoryProtocol || null,
  });
  return normalizeWorkbenchAssets({
    summary: {
      previewCount: previewImages.length,
      resultCount: resultAssets.length,
      reviewCount: reviewAssets.length,
      exceptionCount: exceptionItems.length,
      referenceCount: referenceAssets.length,
      userFacingCount: Number(layers.userFacing.totalCount || 0),
      workbenchStateCount: Number(layers.workbenchState?.totalCount || 0),
      diagnosticCount: Number(layers.diagnosticFacing?.totalCount || 0),
      systemCount: Number(layers.systemFacing.totalCount || 0),
      outputDirectoryUserFacingCount: Number(layers.directoryProtocol?.surfaces?.userFacing?.count || 0),
      outputDirectoryFilesystemCount: Number(layers.directoryProtocol?.surfaces?.filesystem?.count || 0),
      outputDirectoryArchiveCount: Number(layers.directoryProtocol?.surfaces?.archive?.count || 0),
      outputDirectoryInternalCount: Number(layers.directoryProtocol?.surfaces?.internal?.count || 0),
    },
    groups: {
      ready: [
        { key: 'preview', label: '预览图', count: previewImages.length },
        { key: 'result', label: '可直接使用结果', count: resultAssets.length },
      ],
      pending: [
        { key: 'review', label: '待复核结果', count: reviewAssets.length },
        { key: 'exception', label: '失败结果', count: exceptionItems.length },
      ],
      references: [
        { key: 'reference', label: '参考素材', count: referenceAssets.length },
      ],
    },
    layers,
    assetCollections,
    keyFiles,
  });
}

function buildWorkspacePageData(options = {}) {
  const manifest = options.manifest || {};
  const sourceSummary = options.sourceSummary || {};
  const workspaceAssets = options.workspaceAssets || {};
  const workspaceState = options.workspaceState || {};
  const workbenchGuide = options.workbenchGuide || {};
  const assetVisibilityGuide = options.assetVisibilityGuide || {};
  const prepareSummary = options.prepareSummary || {};
  const resultSummary = options.resultSummary || {};
  const exceptionSummary = options.exceptionSummary || {};
  const operationsReport = options.operationsReport || {};
  const rerunCandidates = toArray(options.rerunCandidates);
  const timelineEvents = toArray(options.timelineEventsSnapshot);
  const assetSummary = workspaceAssets.summary || {};
  const sourceCounts = sourceSummary.counts || {};
  const sourceAssets = sourceSummary.assets || {};
  const distributions = sourceSummary.distributions || {};
  const previewAssetItems = readAssetCollection(workspaceAssets, 'preview').slice(0, 12);
  const resultAssetItems = readAssetCollection(workspaceAssets, 'result').slice(0, 12);
  const reviewAssetItems = readAssetCollection(workspaceAssets, 'review').slice(0, 12);
  const exceptionAssetItems = readAssetCollection(workspaceAssets, 'exception').slice(0, 12);
  const referenceAssetItems = readAssetCollection(workspaceAssets, 'reference').slice(0, 12);
  const issuePreviewSeedItems = exceptionAssetItems.slice(0, 3).map((item) => ({ ...item, issueType: '失败项' }))
    .concat(reviewAssetItems.slice(0, 3).map((item) => ({ ...item, issueType: '待复核' })))
    .slice(0, 6);
  const taskMetrics = {
    promptCount: Number(sourceCounts.selected || workspaceState?.counts?.selected || manifest.selectedCount || manifest.promptCount || 0),
    successCount: Number(sourceCounts.success || workspaceState?.counts?.success || manifest.success || 0),
    failedCount: Number(sourceCounts.failed || workspaceState?.counts?.failed || manifest.failed || 0),
    reviewCount: Number(sourceCounts.needsReview || workspaceState?.counts?.needsReview || 0),
    batchCount: Number(sourceCounts.batches || workspaceState?.counts?.batches || manifest.batchCount || 0),
    previewCount: Number(sourceAssets.previewCount ?? assetSummary.previewCount ?? previewAssetItems.length ?? 0),
    resultCount: Number(sourceAssets.resultCount ?? assetSummary.resultCount ?? resultAssetItems.length ?? 0),
    exceptionCount: Number(sourceAssets.exceptionCount ?? assetSummary.exceptionCount ?? exceptionAssetItems.length ?? 0),
    reviewAssetCount: Number(sourceAssets.reviewCount ?? assetSummary.reviewCount ?? reviewAssetItems.length ?? 0),
    referenceCount: Number(sourceAssets.referenceCount ?? assetSummary.referenceCount ?? 0),
    rerunCount: Number(exceptionSummary.rerunCount || rerunCandidates.length || 0),
  };
  const prepareAssetsSection = buildWorkspaceAssetsSectionData({
    title: '素材绑定',
    copy: '这里只保留用户真正需要确认的素材约束，不直接暴露内部绑定文件和程序结构。',
    items: [
      { label: '当前状态', value: Number(prepareSummary.importedBindingCount || 0) > 0 ? `已绑定 ${Number(prepareSummary.importedBindingCount || 0)} 项素材` : '当前没有绑定素材' },
      { label: '素材判断', value: Number(prepareSummary.importedBindingCount || 0) > 0 ? '这是带约束的任务' : '这是自由度更高的任务' },
      { label: '参考资产数', value: Number(prepareSummary.assetCount || referenceAssetItems.length || 0) },
    ],
    assetItems: referenceAssetItems,
  });
  const prepareTimelineSection = buildTimelineSection({
    title: '阶段时间线',
    copy: '这里回放准备层刚刚确认了哪些阶段变化，帮助你判断现在该不该直接开跑。',
    events: timelineEvents,
  });
  const resultPreviewSection = buildWorkspacePreviewSectionData({
    title: '图片速览',
    copy: '这里把图片面放大，方便你继续筛图和取舍。',
    emptyText: '当前还没有可展示的成功结果。',
    itemFallbackSummary: '这一张可在审阅板里继续做保留、复核或淘汰判断。',
    imageLinkLabel: '查看原图',
    imageMissingText: '本轮未生成预览图',
    items: previewAssetItems,
  });
  const resultIssuesSection = buildWorkspaceIssuesSectionData({
    title: '异常摘要',
    copy: '只有真正需要关注的问题才会出现在这里，避免你再去翻散乱记录。',
    emptyText: '当前没有需要单独处理的失败项或待复核项。',
    kicker: '需要关注',
    fallbackReason: '建议回异常工作台统一处理。',
    items: issuePreviewSeedItems,
  });
  const resultAdvancedSection = buildWorkspaceAdvancedSectionData({
    title: '补充理解',
    copy: '这些分布信息只用于补充判断，不再默认抢占主视线。',
    summary: '查看结果分布',
    requestModeTitle: '出图方式分布',
    styleTitle: '风格方向分布',
    slotRoleTitle: '镜头角色分布',
    emptyText: '当前没有可展示的结果分布',
    groups: [
      {
        title: '出图方式分布',
        items: toArray(operationsReport?.distributions?.requestMode).slice(0, 6).map((item) => `${item.name}: ${item.count}`),
      },
      {
        title: '风格方向分布',
        items: toArray(operationsReport?.distributions?.styleFamily).slice(0, 6).map((item) => `${item.name}: ${item.count}`),
      },
      {
        title: '镜头角色分布',
        items: toArray(operationsReport?.distributions?.slotRole).slice(0, 6).map((item) => `${item.name}: ${item.count}`),
      },
    ],
  });
  const resultTimelineSection = buildTimelineSection({
    title: '阶段时间线',
    copy: '这里按顺序回放这轮结果层刚刚发生了什么，帮助你快速接上当前筛图与收口判断。',
    events: timelineEvents,
  });
  const exceptionIssuesItems = exceptionAssetItems.slice(0, 8).map((item) => ({ ...item, issueTone: 'bad', issueType: '失败项' }))
    .concat(reviewAssetItems.slice(0, 8).map((item) => ({ ...item, issueTone: 'warn', issueType: '待复核' })))
    .slice(0, 16);
  const exceptionIssuesSection = buildWorkspaceIssuesSectionData({
    title: '问题列表',
    copy: '这里只保留真正会影响主链继续的问题，帮助你先把需要处理的对象收清楚。',
    emptyText: '当前没有明显异常，这一页可以先不使用。',
    failedFallbackSummary: '这一项在执行时没有稳定完成。',
    reviewFallbackSummary: '这一项建议人工再看一眼，确认边界、融合和主体稳定度。',
    items: exceptionIssuesItems,
  });
  const exceptionRerunSection = buildWorkspaceGuideSectionData({
    title: '补跑候选',
    copy: '这里只列出已经进入补跑判断范围的对象，帮助你决定是否真的需要再跑一轮。',
    items: rerunCandidates.slice(0, 8).map((item) => ({
      label: item.title || item.slug || item.slotId || '补跑候选',
      value: item.error || item.reason || item.requestMode || '建议进一步确认',
    })),
  });
  const exceptionTimelineSection = buildTimelineSection({
    title: '阶段时间线',
    copy: '这里回放异常层刚刚接住了哪些问题、工作台是怎么走到这里的，帮助你顺着问题收口再回工作台。',
    events: timelineEvents,
  });
  const prepareSections = {
    guide: buildWorkspaceGuideSectionData(
      workbenchGuide.prepare?.section || {}
    ),
    visibility: buildWorkspaceGuideSectionData(
      assetVisibilityGuide.prepare || {}
    ),
    direction: buildWorkspaceDirectionSectionData({
      title: '任务方向',
      copy: '这里保留普通用户真正需要看的方向信息，不直接把程序字段和内部产物名堆出来。',
      items: [
        { label: '模板类型', value: String(prepareSummary.templateName || '未检测').trim() || '未检测' },
        { label: '当前模式', value: String(prepareSummary.modeLabel || '未检测').trim() || '未检测' },
        { label: '任务主轴', value: String(prepareSummary.mainDirection || '未提供').trim() || '未提供' },
        { label: '风格方向', value: String(prepareSummary.styleDirection || '未指定').trim() || '未指定' },
        { label: '场景方向', value: String(prepareSummary.sceneDirection || '未指定').trim() || '未指定' },
      ],
    }),
    readiness: buildWorkspaceReadinessSectionData({
      title: '执行判断',
      copy: '先判断能不能开跑，再决定是直接继续还是先收一轮。',
      blockingItems: toArray(prepareSummary.readiness?.blockingItems),
      cautionItems: toArray(prepareSummary.readiness?.cautionItems),
    }),
    assets: prepareAssetsSection,
    timeline: prepareTimelineSection,
  };
  const resultSections = {
    guide: buildWorkspaceGuideSectionData(
      workbenchGuide.result?.section || {}
    ),
    visibility: buildWorkspaceGuideSectionData(
      assetVisibilityGuide.result || {}
    ),
    preview: resultPreviewSection,
    issues: resultIssuesSection,
    advanced: resultAdvancedSection,
    timeline: resultTimelineSection,
  };
  const exceptionSections = {
    guide: buildWorkspaceGuideSectionData(
      workbenchGuide.exception?.section || {}
    ),
    visibility: buildWorkspaceGuideSectionData(
      assetVisibilityGuide.exception || {}
    ),
    issues: exceptionIssuesSection,
    rerun: exceptionRerunSection,
    timeline: exceptionTimelineSection,
  };
  const referenceItems = toArray(prepareSections.assets?.assetItems).slice(0, 12);
  const homePreviewItems = previewAssetItems.slice(0, 4);
  const homeTimelineSection = buildTimelineSection({
    title: '阶段时间线',
    copy: '这里按顺序回放这轮任务刚刚发生了什么，帮助你快速接上当前主链。',
    events: timelineEvents.slice(0, 12),
  });
  const homeSections = {
    guide: buildWorkspaceGuideSectionData(
      workbenchGuide.home?.section || {}
    ),
    visibility: buildWorkspaceGuideSectionData(
      assetVisibilityGuide.home || {}
    ),
    preview: buildWorkspacePreviewSectionData({
      enabled: false,
      title: '图片速览',
      copy: '首页只做主链判断，图片速览默认让位给结果工作台。',
      emptyText: '当前还没有可展示的成功结果。',
      itemFallbackSummary: '如需继续筛图，请进入结果工作台查看完整速览。',
      imageLinkLabel: '查看原图',
      imageMissingText: '本轮未生成预览图',
      items: homePreviewItems,
    }),
    timeline: homeTimelineSection,
  };
  const previewItems = toArray(resultSections.preview?.items).slice(0, 12);
  const issuePreviewItems = toArray(resultSections.issues?.items).slice(0, 6);

  return {
    prepare: {
      metrics: taskMetrics,
      templateName: String(prepareSummary.templateName || '').trim() || '未检测',
      modeLabel: String(prepareSummary.modeLabel || '').trim() || '未检测',
      mainDirection: String(prepareSummary.mainDirection || '').trim() || '未提供',
      styleDirection: String(prepareSummary.styleDirection || '').trim() || '未指定',
      sceneDirection: String(prepareSummary.sceneDirection || '').trim() || '未指定',
      assetCount: Number(prepareSummary.assetCount || 0),
      importedBindingCount: Number(prepareSummary.importedBindingCount || 0),
      currentFocus: String(prepareSummary.currentFocus || '').trim() || '',
      nextStepLabel: String(prepareSummary.nextStepLabel || '').trim() || '',
      nextStepReason: String(prepareSummary.nextStepReason || '').trim() || '',
      primaryActionKey: String(prepareSummary.primaryActionKey || '').trim() || '',
      primaryAction: prepareSummary.primaryAction || null,
      secondaryActionHints: toArray(prepareSummary.secondaryActionHints),
      transitionSummary: String(prepareSummary.transitionSummary || '').trim() || '',
      handoffSummary: String(prepareSummary.handoffSummary || '').trim() || '',
      stageSummary: String(prepareSummary.stageSummary || '').trim() || '',
      cockpitSummary: prepareSummary.cockpitSummary || null,
      judgment: prepareSummary.judgment || null,
      statusStack: toArray(prepareSummary.statusStack),
      decision: prepareSummary.decision || null,
      summary: prepareSummary.summary || null,
      collaboration: prepareSummary.collaboration || null,
      confirmation: prepareSummary.confirmationState || null,
      readiness: prepareSummary.readiness || null,
      referenceItems,
      sections: prepareSections,
      timelineEvents,
    },
    home: {
      metrics: taskMetrics,
      currentFocus: String(workspaceState?.nextAction?.reason || '').trim() || '',
      nextStepLabel: String(workspaceState?.nextAction?.label || '').trim() || '',
      nextStepReason: String(workspaceState?.nextAction?.reason || workspaceState?.confirmationState?.summary || '').trim() || '',
      primaryActionKey: String(workspaceState?.nextAction?.target || '').trim() || '',
      primaryAction: workspaceState?.nextAction ? {
        key: String(workspaceState.nextAction.target || '').trim() || '',
        label: String(workspaceState.nextAction.label || '').trim() || '',
        cta: String(resolvePrimaryActionLanguage(workspaceState.nextAction).ctaLabel || '').trim() || '',
        summary: String(workspaceState.nextAction.reason || workspaceState?.confirmationState?.summary || '').trim() || '',
      } : null,
      stageSummary: String(workspaceState?.status?.phase || '').trim() || '',
      issueSummary: String(workspaceState?.risk?.summary || '').trim() || '',
      topRequestMode: String(distributions.topRequestMode || operationsReport?.distributions?.requestMode?.[0]?.name || '未记录').trim() || '未记录',
      topStyleFamily: String(distributions.topStyleFamily || operationsReport?.distributions?.styleFamily?.[0]?.name || '未记录').trim() || '未记录',
      previewItems: homePreviewItems,
      cockpitSummary: null,
      judgment: null,
      statusStack: [],
      decision: null,
      summary: null,
      collaboration: null,
      confirmation: workspaceState?.confirmationState || null,
      sections: homeSections,
      timelineEvents: timelineEvents.slice(0, 12),
    },
    result: {
      metrics: taskMetrics,
      currentFocus: String(resultSummary.currentFocus || '').trim() || '',
      nextStepLabel: String(resultSummary.nextStepLabel || '').trim() || '',
      nextStepReason: String(resultSummary.nextStepReason || '').trim() || '',
      primaryActionKey: String(resultSummary.primaryActionKey || '').trim() || '',
      primaryAction: resultSummary.primaryAction || null,
      secondaryActionHints: toArray(resultSummary.secondaryActionHints),
      transitionSummary: String(resultSummary.transitionSummary || '').trim() || '',
      handoffSummary: String(resultSummary.handoffSummary || '').trim() || '',
      actionSummary: String(resultSummary.actionSummary || '').trim() || '',
      stageSummary: String(resultSummary.stageSummary || '').trim() || '',
      cockpitSummary: resultSummary.cockpitSummary || null,
      judgment: resultSummary.judgment || null,
      statusStack: toArray(resultSummary.statusStack),
      decision: resultSummary.decision || null,
      summary: resultSummary.summary || null,
      collaboration: resultSummary.collaboration || null,
      confirmation: resultSummary.confirmationState || null,
      topRequestMode: String(resultSummary.topRequestMode || distributions.topRequestMode || '未记录').trim() || '未记录',
      topStyleFamily: String(resultSummary.topStyleFamily || distributions.topStyleFamily || '未记录').trim() || '未记录',
      previewItems,
      resultItems: resultAssetItems,
      reviewItems: reviewAssetItems,
      exceptionItems: exceptionAssetItems,
      issuePreviewItems,
      sections: resultSections,
      timelineEvents,
    },
    exception: {
      metrics: taskMetrics,
      currentFocus: String(exceptionSummary.currentFocus || '').trim() || '',
      nextStepLabel: String(exceptionSummary.nextStepLabel || '').trim() || '',
      nextStepReason: String(exceptionSummary.nextStepReason || '').trim() || '',
      primaryActionKey: String(exceptionSummary.primaryActionKey || '').trim() || '',
      primaryAction: exceptionSummary.primaryAction || null,
      secondaryActionHints: toArray(exceptionSummary.secondaryActionHints),
      transitionSummary: String(exceptionSummary.transitionSummary || '').trim() || '',
      handoffSummary: String(exceptionSummary.handoffSummary || '').trim() || '',
      actionSummary: String(exceptionSummary.actionSummary || '').trim() || '',
      stageSummary: String(exceptionSummary.stageSummary || '').trim() || '',
      issueSummary: String(exceptionSummary.issueSummary || '').trim() || '',
      cockpitSummary: exceptionSummary.cockpitSummary || null,
      judgment: exceptionSummary.judgment || null,
      statusStack: toArray(exceptionSummary.statusStack),
      decision: exceptionSummary.decision || null,
      summary: exceptionSummary.summary || null,
      collaboration: exceptionSummary.collaboration || null,
      confirmation: exceptionSummary.confirmationState || null,
      exceptionItems: exceptionAssetItems,
      reviewItems: reviewAssetItems,
      sections: exceptionSections,
      timelineEvents,
    },
  };
}

function summarizeArtifactGovernance(outputDir, options = {}) {
  const hasStoryboard = Boolean(options.hasStoryboard);
  const taskCenterPath = path.join(path.dirname(outputDir), 'task_center.html');
  const workspaceHomePath = path.join(outputDir, 'workspace_home.html');
  const prepareWorkspacePath = path.join(outputDir, 'prepare_workspace.html');
  const resultWorkspacePath = path.join(outputDir, 'result_workspace.html');
  const exceptionWorkspacePath = path.join(outputDir, 'exception_workspace.html');
  const runRecordHtmlPath = path.join(outputDir, 'run_record.html');
  const runRecordMarkdownPath = path.join(outputDir, 'run_record.md');
  const readmePath = path.join(outputDir, 'README.md');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const workspaceStatePath = path.join(outputDir, 'workspace_state.json');
  const workspaceAssetsPath = path.join(outputDir, 'workspace_assets.json');
  const workspaceTimelinePath = path.join(outputDir, 'workspace_timeline.json');
  const operationsReportJsonPath = path.join(outputDir, 'operations_report.json');
  const completionReportPath = path.join(outputDir, 'daoge_completion_report.md');
  const selectionBoardPath = path.join(outputDir, 'selection_board.md');
  const promptPreviewMarkdownPath = path.join(outputDir, 'prompt_preview.md');
  const promptPreviewHtmlPath = path.join(outputDir, 'prompt_preview.html');
  const preflightBoardPath = path.join(outputDir, 'preflight_board.html');
  const assetsBoardPath = path.join(outputDir, 'assets_board.html');
  const storyboardBoardPath = path.join(outputDir, 'storyboard_board.html');
  const reviewBoardPath = path.join(outputDir, 'review_board.html');
  const completionBoardPath = path.join(outputDir, 'completion_board.html');
  const runOverviewPath = path.join(outputDir, 'run_overview.html');
  const rerunBoardPath = path.join(outputDir, 'rerun_board.html');
  const resultHubPath = path.join(outputDir, 'result_hub.html');
  const portalHomePath = path.join(outputDir, 'daoge_portal.html');

  const userEntry = [
    { id: 'task-center', label: '任务总控', path: taskCenterPath, audience: 'all', role: 'cross-run-entry', exists: fileExists(taskCenterPath) },
    { id: 'workspace-home', label: '工作台首页', path: workspaceHomePath, audience: 'all', role: 'default-entry', exists: fileExists(workspaceHomePath) },
    { id: 'prepare-workspace', label: '准备工作台', path: prepareWorkspacePath, audience: 'all', role: 'mainline', exists: fileExists(prepareWorkspacePath) },
    { id: 'result-workspace', label: '结果工作台', path: resultWorkspacePath, audience: 'all', role: 'mainline', exists: fileExists(resultWorkspacePath) },
    { id: 'exception-workspace', label: '异常工作台', path: exceptionWorkspacePath, audience: 'all', role: 'conditional-mainline', exists: fileExists(exceptionWorkspacePath) },
  ];

  const workspaceSupport = [
    { id: 'run-record-html', label: '任务档案页', path: runRecordHtmlPath, audience: 'all', role: 'supporting-record', exists: fileExists(runRecordHtmlPath) },
  ];

  const filesystemSupport = [
    { id: 'readme', label: '入口说明', path: readmePath, audience: 'all', role: 'filesystem-entry', exists: fileExists(readmePath) },
  ];

  const archiveSupport = [
    { id: 'completion-report', label: '完成报告文字版', path: completionReportPath, audience: 'advanced', role: 'supporting-report', exists: fileExists(completionReportPath) },
  ];

  const conditionalPages = [
    { id: 'storyboard-board', label: '分镜整板页', path: storyboardBoardPath, audience: 'advanced', role: 'conditional-support', exists: hasStoryboard && fileExists(storyboardBoardPath) },
  ];

  const advancedPages = [
    { id: 'prompt-preview-html', label: '提示词预览页', path: promptPreviewHtmlPath, audience: 'advanced', role: 'prepare-detail', exists: fileExists(promptPreviewHtmlPath) },
    { id: 'preflight-board', label: '预检页', path: preflightBoardPath, audience: 'advanced', role: 'prepare-detail', exists: fileExists(preflightBoardPath) },
    { id: 'assets-board', label: '素材页', path: assetsBoardPath, audience: 'advanced', role: 'prepare-detail', exists: fileExists(assetsBoardPath) },
    { id: 'review-board', label: '审阅看板', path: reviewBoardPath, audience: 'advanced', role: 'result-detail', exists: fileExists(reviewBoardPath) },
    { id: 'completion-board', label: '完成摘要页', path: completionBoardPath, audience: 'advanced', role: 'result-detail', exists: fileExists(completionBoardPath) },
    { id: 'run-overview', label: '运行概览页', path: runOverviewPath, audience: 'advanced', role: 'result-detail', exists: fileExists(runOverviewPath) },
    { id: 'rerun-board', label: '补跑页', path: rerunBoardPath, audience: 'advanced', role: 'exception-detail', exists: fileExists(rerunBoardPath) },
  ];

  const legacyPages = [
    { id: 'result-hub', label: '旧结果说明页', path: resultHubPath, audience: 'advanced', role: 'legacy-result-entry', exists: fileExists(resultHubPath) },
    { id: 'portal-home', label: '旧门户页', path: portalHomePath, audience: 'advanced', role: 'legacy-home-entry', exists: fileExists(portalHomePath) },
  ];

  const internalAssets = [
    { id: 'manifest', label: 'manifest.json', path: manifestPath, role: 'runtime-record', exists: fileExists(manifestPath) },
    { id: 'workspace-state', label: 'workspace_state.json', path: workspaceStatePath, role: 'view-model', exists: fileExists(workspaceStatePath) },
    { id: 'workspace-assets', label: 'workspace_assets.json', path: workspaceAssetsPath, role: 'asset-cache', exists: fileExists(workspaceAssetsPath) },
    { id: 'workspace-timeline', label: 'workspace_timeline.json', path: workspaceTimelinePath, role: 'timeline-cache', exists: fileExists(workspaceTimelinePath) },
    { id: 'operations-report-json', label: 'operations_report.json', path: operationsReportJsonPath, role: 'diagnostic-summary', exists: fileExists(operationsReportJsonPath) },
    { id: 'run-record-markdown', label: 'run_record.md', path: runRecordMarkdownPath, role: 'archival-companion', exists: fileExists(runRecordMarkdownPath) },
    { id: 'prompt-preview-markdown', label: 'prompt_preview.md', path: promptPreviewMarkdownPath, role: 'prepare-companion', exists: fileExists(promptPreviewMarkdownPath) },
    { id: 'selection-board-markdown', label: 'selection_board.md', path: selectionBoardPath, role: 'maintenance-companion', exists: fileExists(selectionBoardPath) },
  ];

  const groupedAssets = {
    mainlineRequired: [
      'manifest',
      'workspace-state',
      'workspace-assets',
      'workspace-timeline',
    ],
    supportVisible: [
      'run-record-html',
    ],
    filesystemVisible: [
      'readme',
    ],
    archiveVisible: [
      'completion-report',
    ],
    advancedVisible: [
      'prompt-preview-html',
      'preflight-board',
      'assets-board',
      'review-board',
      'completion-board',
      'run-overview',
      'rerun-board',
      'storyboard-board',
    ],
    legacyVisible: [
      'result-hub',
      'portal-home',
    ],
    diagnosticInternal: [
      'operations-report-json',
      'run-record-markdown',
      'prompt-preview-markdown',
      'selection-board-markdown',
    ],
  };

  const artifactStrategy = {
    defaultGenerationMode: 'mainline-minimal',
    targetMode: 'workspace-first',
    principle: '默认只保留主链工作台和少量必要补充，进阶页面、旧入口说明和诊断归档统一后退到按需层；普通用户默认不感知内部文件。',
    groups: {
      mainlineRequired: {
        label: '主链必需',
        generation: 'always',
        audience: 'system-and-mainline',
        description: '主链四页和任务总控继续依赖这组底盘资产，当前必须默认生成。',
      },
      supportVisible: {
        label: '按需补充',
        generation: 'mainline-plus-core-support',
        audience: 'supporting-entry',
        description: '只保留真正会被普通用户按需打开的工作台补充入口，默认不再扩张为第二套导航。',
      },
      filesystemVisible: {
        label: '文件落盘入口',
        generation: 'always-for-filesystem',
        audience: 'filesystem-user',
        description: '这组文件只是为了让本地目录仍然有清晰入口，不应再算作工作台补充层。',
      },
      archiveVisible: {
        label: '归档补充',
        generation: 'disabled-by-default',
        audience: 'archive-user',
        description: '这组产物只在显式归档时生成，属于回看归档，不属于工作台默认补充层。',
      },
      advancedVisible: {
        label: '进阶页面',
        generation: 'on-demand-target',
        audience: 'advanced-user',
        description: '这组页面只服务进阶查看、复检和专项场景，目标是逐步收成按需打开，而不是默认展示。',
      },
      legacyVisible: {
        label: '旧入口说明',
        generation: 'retire-first',
        audience: 'maintenance-only',
        description: '旧门户和旧结果说明页只保留给维护观察，不再属于个人工作台正式链路。',
      },
      diagnosticInternal: {
        label: '诊断归档',
        generation: 'eligible-on-demand',
        audience: 'diagnostic-only',
        description: '这组文件主要服务诊断、归档和脚本互操作，已经具备未来降级为按需生成的条件。',
      },
    },
    runtimeToggles: {
      diagnosticMarkdown: {
        default: false,
        description: 'selection_board.md 与 operations_report.md 默认不生成；仅在显式诊断或维护模式下按需生成。',
        targets: ['selection-board-markdown', 'operations-report-markdown'],
      },
      archiveMarkdown: {
        default: false,
        description: 'run_record.md、contact_sheet_index.md 与 daoge_completion_report.md 默认不生成；仅在显式归档模式下按需生成。',
        targets: ['run-record-markdown', 'contact-sheet-index-markdown', 'completion-report'],
      },
    },
  };

  const assetLifecycle = [
    ...userEntry.map((item) => ({
      id: item.id,
      label: item.label,
      path: item.path,
      role: item.role,
      exists: item.exists,
      visibility: 'user-visible',
      generation: item.role === 'cross-run-entry' || item.role === 'default-entry' || item.role === 'mainline' || item.role === 'conditional-mainline'
        ? 'always'
        : 'always-for-now',
      group: item.role === 'cross-run-entry' || item.role === 'default-entry' || item.role === 'mainline' || item.role === 'conditional-mainline'
        ? 'mainlineRequired'
        : 'supportVisible',
      futureMode: 'keep',
    })),
    ...workspaceSupport.map((item) => ({
      ...item,
      visibility: 'user-visible',
      generation: 'mainline-plus-core-support',
      group: 'supportVisible',
      futureMode: 'keep',
    })),
    ...filesystemSupport.map((item) => ({
      ...item,
      visibility: 'filesystem-visible',
      generation: 'always-for-filesystem',
      group: 'filesystemVisible',
      futureMode: 'keep',
    })),
    ...archiveSupport.map((item) => ({
      ...item,
      visibility: 'archive-visible',
      generation: 'disabled-by-default',
      group: 'archiveVisible',
      futureMode: 'on-demand-archive',
    })),
    ...conditionalPages.map((item) => ({
      ...item,
      visibility: 'conditional-visible',
      generation: item.id === 'storyboard-board' ? 'conditional' : 'on-demand-target',
      group: 'advancedVisible',
      futureMode: 'conditional-keep',
    })),
    ...advancedPages.map((item) => ({
      ...item,
      visibility: 'advanced-visible',
      generation: 'on-demand-target',
      group: 'advancedVisible',
      futureMode: 'eligible-on-demand',
    })),
    ...legacyPages.map((item) => ({
      ...item,
      visibility: 'legacy-visible',
      generation: 'retire-first',
      group: 'legacyVisible',
      futureMode: 'retire-when-safe',
    })),
    ...internalAssets.map((item) => ({
      ...item,
      visibility: 'internal',
      generation: groupedAssets.mainlineRequired.includes(item.id)
        ? 'always'
        : (['selection-board-markdown'].includes(item.id) ? 'disabled-by-default' : 'eligible-on-demand'),
      group: groupedAssets.mainlineRequired.includes(item.id) ? 'mainlineRequired' : 'diagnosticInternal',
      futureMode: groupedAssets.mainlineRequired.includes(item.id)
        ? 'keep'
        : (['selection-board-markdown'].includes(item.id) ? 'on-demand-diagnostic' : 'eligible-on-demand'),
    })),
    {
      id: 'operations-report-markdown',
      label: 'operations_report.md',
      path: path.join(outputDir, 'operations_report.md'),
      role: 'diagnostic-summary-markdown',
      exists: fileExists(path.join(outputDir, 'operations_report.md')),
      visibility: 'internal',
      generation: 'disabled-by-default',
      group: 'diagnosticInternal',
      futureMode: 'on-demand-diagnostic',
    },
  ];

  const reductionCandidates = assetLifecycle
    .filter((item) => ['eligible-on-demand', 'retire-when-safe', 'keep-or-on-demand', 'on-demand-archive'].includes(item.futureMode))
    .map((item) => ({
      id: item.id,
      label: item.label,
      path: item.path,
      exists: item.exists,
      futureMode: item.futureMode,
      generation: item.generation,
      reason: item.group === 'diagnosticInternal'
        ? '主链页面已经逐步转向统一状态底盘，这类诊断或归档文件后续可考虑改成按需生成。'
        : item.group === 'advancedVisible'
          ? '属于进阶页面，目标是继续压到按需打开，而不是默认陪跑。'
          : item.group === 'archiveVisible'
            ? '属于归档补充产物，应该继续保留按需生成，而不是算进工作台默认补充层。'
            : '属于旧入口说明、文件落盘入口或补充入口，后续应继续围绕单一主链减少默认暴露。',
    }));

  const visibleToUser = userEntry
    .concat(workspaceSupport, filesystemSupport, archiveSupport, conditionalPages, advancedPages, legacyPages)
    .filter((item) => item.exists);
  const internalOnly = internalAssets.filter((item) => item.exists);
  const mainlineEntries = userEntry.filter((item) => item.role === 'mainline' || item.role === 'default-entry' || item.role === 'conditional-mainline');
  const crossRunEntries = userEntry.filter((item) => item.role === 'cross-run-entry');
  const visibleMainlineCount = mainlineEntries.filter((item) => item.exists).length;
  const visibleCrossRunCount = crossRunEntries.filter((item) => item.exists).length;
  const visibleSupportCount = workspaceSupport.filter((item) => item.exists).length;
  const visibleFilesystemCount = filesystemSupport.filter((item) => item.exists).length;
  const visibleArchiveCount = archiveSupport.filter((item) => item.exists).length;
  const visibleConditionalCount = conditionalPages.filter((item) => item.exists).length;
  const visibleAdvancedCount = advancedPages.filter((item) => item.exists).length;
  const visibleLegacyCount = legacyPages.filter((item) => item.exists).length;
  const totalOptionalCount = visibleConditionalCount + visibleAdvancedCount;
  const buildLayerSnapshot = (key, config = {}) => {
    const items = Array.isArray(config.items) ? config.items : [];
    const visibleItems = items.filter((item) => item.exists);
    return {
      key,
      title: config.title,
      audience: config.audience,
      attention: config.attention,
      defaultVisible: Boolean(config.defaultVisible),
      generation: config.generation,
      count: visibleItems.length,
      entryIds: visibleItems.map((item) => item.id),
      description: config.description,
      hiddenByDefaultReason: config.hiddenByDefaultReason || '',
    };
  };
  const artifactLayerProtocol = {
    version: 1,
    defaultUserJourney: ['task-center', 'workspace-home', 'prepare-workspace', 'result-workspace', 'exception-workspace'],
    defaultVisibleLayers: ['mainline', 'support'],
    onDemandLayers: ['conditional', 'advanced'],
    maintenanceLayers: ['legacy'],
    internalLayers: ['internal'],
    userFacingRule: '普通用户默认只理解主链层和少量补充入口。深看页、旧说明页和内部资产统一后退，只在明确需要时再出现。',
    layers: {
      mainline: buildLayerSnapshot('mainline', {
        title: '主链层',
        audience: 'all',
        attention: 'default',
        defaultVisible: true,
        generation: 'always',
        items: userEntry.filter((item) => ['cross-run-entry', 'default-entry', 'mainline', 'conditional-mainline'].includes(item.role)),
        description: '普通用户默认只需要理解任务总控和工作台主链。',
      }),
      support: buildLayerSnapshot('support', {
        title: '补充层',
        audience: 'all',
        attention: 'on-demand',
        defaultVisible: true,
        generation: 'mainline-plus-core-support',
        items: workspaceSupport,
        description: '只保留少量真正可能被普通用户按需打开的补充入口。',
        hiddenByDefaultReason: '补充层存在，但不应扩展成第二套导航。',
      }),
      conditional: buildLayerSnapshot('conditional', {
        title: '条件页层',
        audience: 'advanced',
        attention: 'conditional',
        defaultVisible: false,
        generation: 'conditional',
        items: conditionalPages,
        description: '只有出现对应结构化场景时才有意义的补充页面。',
        hiddenByDefaultReason: '这层页面只在特定任务形态下有价值，不应自然挤进主链注意力。',
      }),
      advanced: buildLayerSnapshot('advanced', {
        title: '进阶页层',
        audience: 'advanced',
        attention: 'on-demand',
        defaultVisible: false,
        generation: 'on-demand-target',
        items: advancedPages,
        description: '面向深看、复检和专项回看，目标是进一步向按需生成收拢。',
        hiddenByDefaultReason: '这些页面保留能力，但默认不应陪跑主流程。',
      }),
      legacy: buildLayerSnapshot('legacy', {
        title: '旧说明层',
        audience: 'maintenance',
        attention: 'retired',
        defaultVisible: false,
        generation: 'retire-first',
        items: legacyPages,
        description: '旧门户和旧结果说明只保留维护观察意义。',
        hiddenByDefaultReason: '这层已经不属于个人工作台正式链路，应继续后退。',
      }),
      internal: buildLayerSnapshot('internal', {
        title: '内部资产层',
        audience: 'diagnostic',
        attention: 'internal',
        defaultVisible: false,
        generation: 'eligible-on-demand',
        items: internalAssets.concat([
          {
            id: 'operations-report-markdown',
            label: 'operations_report.md',
            path: path.join(outputDir, 'operations_report.md'),
            role: 'diagnostic-summary-markdown',
            exists: fileExists(path.join(outputDir, 'operations_report.md')),
          },
        ]),
        description: '主要服务运行状态、诊断归档和脚本互操作，不属于普通用户阅读层。',
        hiddenByDefaultReason: '内部层默认不面向人展开，只有诊断和维护时才需要。',
      }),
    },
    currentMode: {
      optionalPageMode: 'mainline-only',
      defaultAction: '继续顺着任务总控和四站工作台推进；如果要深看，再按层打开补充页。',
      deepDiveEntry: '优先通过补充层和进阶层按需进入，不再从首页堆叠所有入口。',
    },
  };

  return {
    summary: {
      defaultEntryLabel: '工作台首页',
      defaultEntryPath: workspaceHomePath,
      userVisibleCount: visibleToUser.length,
      crossRunCount: visibleCrossRunCount,
      mainlineCount: visibleMainlineCount,
      supportCount: visibleSupportCount,
      conditionalCount: visibleConditionalCount,
      advancedCount: visibleAdvancedCount,
      legacyCount: visibleLegacyCount,
      internalCount: internalOnly.length,
      principle: '普通用户默认只走任务总控和四站工作台。任务档案保留为唯一工作台补充入口，README 与完成报告退回文件落盘或归档层，其它深看页和旧说明页统一后退。',
      reducibleCount: reductionCandidates.length,
      defaultVisibleLayerCount: artifactLayerProtocol.defaultVisibleLayers.length,
      optionalVisibleCount: totalOptionalCount,
      filesystemCount: visibleFilesystemCount,
      archiveCount: visibleArchiveCount,
    },
    userEntry,
    workspaceSupport,
    filesystemSupport,
    archiveSupport,
    conditionalPages,
    advancedPages,
    optionalPages: advancedPages,
    legacyPages,
    internalOnly,
    groupedAssets,
    artifactStrategy,
    artifactLayerProtocol,
    assetLifecycle,
    reductionCandidates,
  };
}

function buildWorkbenchGuide(stage, artifactGovernance = {}, optionalPageMode = summarizeOptionalPageEmission({ optionalPageMode: 'mainline-only' })) {
  const denseCopy = getWorkspaceDenseCopy(stage);
  const summary = artifactGovernance.summary || {};
  const workspaceSupport = Array.isArray(artifactGovernance.workspaceSupport)
    ? artifactGovernance.workspaceSupport.filter((item) => item.exists)
    : [];
  const conditionalPages = Array.isArray(artifactGovernance.conditionalPages)
    ? artifactGovernance.conditionalPages.filter((item) => item.exists)
    : [];
  const advancedPages = Array.isArray(artifactGovernance.advancedPages)
    ? artifactGovernance.advancedPages.filter((item) => item.exists)
    : [];
  const legacyPages = Array.isArray(artifactGovernance.legacyPages)
    ? artifactGovernance.legacyPages.filter((item) => item.exists)
    : [];
  const defaultEntryLabel = String(summary.defaultEntryLabel || '工作台首页').trim() || '工作台首页';
  const principle = String(summary.principle || '').trim()
    || '普通用户默认只走任务总控和四站工作台。任务档案保留为唯一工作台补充入口，其它深看页和旧说明页统一后退，不再形成第二套导航。';
  const mainlineCount = Number(summary.mainlineCount || 0);
  const supportCount = Number(summary.supportCount || workspaceSupport.length || 0);
  const conditionalCount = Number(summary.conditionalCount || conditionalPages.length || 0);
  const advancedCount = Number(summary.advancedCount || advancedPages.length || 0);
  const legacyCount = Number(summary.legacyCount || legacyPages.length || 0);
  const stageCopyMap = {
    home: '工作台首页负责总览当前阶段、下一步和异常压力。',
    prepare: '准备工作台只负责方向、放行和素材判断。',
    result: '结果工作台只负责看图、取舍和下一步判断。',
    exception: '异常工作台只是按需页面，只有出现问题时才需要进入。',
  };
  const supportSummaryMap = {
    home: '默认只保留任务档案，条件型补充页只在确实需要时出现。',
    prepare: '默认只留任务档案回看，主判断继续留在当前页。',
    result: '默认只留任务档案，分镜整板等条件页不再算常规补充入口。',
    exception: '默认不扩张补充入口，主判断继续留在当前页。',
  };
  const advancedSummaryMap = {
    home: '深看再开，不抢主链注意力。',
    prepare: '需要深挖时再开，默认后退。',
    result: '需要深挖时再开，不必来回切换。',
    exception: '保留复检入口，默认不回头翻找。',
  };
  const legacySummaryMap = {
    home: '仅供维护观察，不推荐进入。',
    prepare: '不再承担导航，只保留维护意义。',
    result: '不再承担主控，只保留维护意义。',
    exception: '不再承担处理入口，只保留维护意义。',
  };

  return {
    section: {
      title: denseCopy.guideSectionTitle,
      copy: `${denseCopy.guideSectionCopy} ${optionalPageMode.copy} ${optionalPageMode.whyThisMode}`,
      items: [
        { label: '主入口', value: defaultEntryLabel },
        { label: '主链', value: `${mainlineCount} 站连续工作台` },
        { label: '补充入口', value: supportCount > 0 ? '默认只保留任务档案' : '默认不额外展开' },
        { label: '已后退页面', value: `${conditionalCount + advancedCount + legacyCount} 个深看页 / 旧说明页` },
        { label: '当前细页模式', value: optionalPageMode.label },
        { label: '现在怎么用', value: optionalPageMode.currentFocus },
        { label: '如果想深看', value: optionalPageMode.deepDiveSuggestion },
      ],
    },
    cards: [
      {
        label: '细页模式',
        value: optionalPageMode.label,
        summary: optionalPageMode.recommendedAction,
        tone: 'neutral',
        hideLinkIfMissing: true,
      },
      supportCount > 0 ? {
        label: '补充入口层',
        value: '默认只保留任务档案',
        summary: supportSummaryMap[stage] || supportSummaryMap.home,
        tone: 'neutral',
        hideLinkIfMissing: true,
      } : null,
      (conditionalCount > 0 || advancedCount > 0) ? {
        label: '深看页面层',
        value: `${conditionalCount + advancedCount} 个页面`,
        summary: advancedSummaryMap[stage] || advancedSummaryMap.home,
        tone: 'neutral',
        hideLinkIfMissing: true,
      } : null,
      legacyCount > 0 ? {
        label: '旧说明页层',
        value: `${legacyCount} 个入口`,
        summary: legacySummaryMap[stage] || legacySummaryMap.home,
        tone: 'neutral',
        hideLinkIfMissing: true,
      } : null,
    ].filter(Boolean),
  };
}

function buildWorkbenchGuideMap(artifactGovernance = {}, optionalPageMode = summarizeOptionalPageEmission({ optionalPageMode: 'mainline-only' })) {
  return {
    home: buildWorkbenchGuide('home', artifactGovernance, optionalPageMode),
    prepare: buildWorkbenchGuide('prepare', artifactGovernance, optionalPageMode),
    result: buildWorkbenchGuide('result', artifactGovernance, optionalPageMode),
    exception: buildWorkbenchGuide('exception', artifactGovernance, optionalPageMode),
  };
}

function buildAssetVisibilityGuide(stage, options = {}) {
  const denseCopy = getWorkspaceDenseCopy(stage);
  const hasPrepare = Boolean(options.hasPrepare);
  const hasStoryboard = Boolean(options.hasStoryboard);
  const optionalPageMode = options.optionalPageMode && typeof options.optionalPageMode === 'object'
    ? options.optionalPageMode
    : summarizeOptionalPageEmission({ optionalPageMode: 'mainline-only' });
  const map = {
    home: {
      title: denseCopy.visibilitySectionTitle,
      copy: denseCopy.visibilitySectionCopy,
      now: '当前阶段、结果入口、异常压力',
      optional: hasPrepare ? '任务档案、准备工作台（只在需要回看准备判断时）' : '任务档案',
      hidden: 'JSON、Markdown、内部细分页',
    },
    prepare: {
      title: denseCopy.visibilitySectionTitle,
      copy: denseCopy.visibilitySectionCopy,
      now: '任务方向、放行判断、素材绑定',
      optional: '工作台首页、任务档案',
      hidden: 'task_spec、prompts、validation 等内部产物',
    },
    result: {
      title: denseCopy.visibilitySectionTitle,
      copy: denseCopy.visibilitySectionCopy,
      now: '可直接使用结果、预览图、待复核与异常结果',
      optional: hasStoryboard ? '任务档案、分镜整板页' : '任务档案、异常工作台',
      hidden: 'operations_report、success.json、failed.json 等内部记录',
    },
    exception: {
      title: denseCopy.visibilitySectionTitle,
      copy: denseCopy.visibilitySectionCopy,
      now: '失败结果、待复核结果、补跑候选',
      optional: hasStoryboard ? '结果工作台、分镜整板页' : '结果工作台、工作台首页',
      hidden: '准备细分页、内部 JSON / Markdown 记录',
    },
  };
  const current = map[stage] || map.home;
  return {
    title: current.title,
    copy: `${current.copy} ${optionalPageMode.copy} ${optionalPageMode.whyThisMode}`,
    items: [
      { label: '先看', value: current.now },
      { label: '按需再看', value: current.optional },
      { label: '先不用看', value: current.hidden },
      { label: '当前细页模式', value: optionalPageMode.label },
      { label: '现在怎么用', value: optionalPageMode.currentFocus },
      { label: '如果想深看', value: optionalPageMode.deepDiveSuggestion },
    ],
  };
}

function buildAssetVisibilityGuideMap(options = {}) {
  return {
    home: buildAssetVisibilityGuide('home', options),
    prepare: buildAssetVisibilityGuide('prepare', options),
    result: buildAssetVisibilityGuide('result', options),
    exception: buildAssetVisibilityGuide('exception', options),
  };
}

function buildGovernanceStagePlan() {
  return {
    currentStage: '资产分层与状态源统一',
    goal: '把默认主链、按需补充、进阶页面和诊断归档统一交给状态层治理，逐步收成单一工作台产品。',
    currentFocus: [
      '四张主链页继续共享同一套工作台语言和阅读密度规则',
      '默认生成策略收束到主链优先，补充入口和进阶页面统一后退',
      '页面层继续减重，状态层继续接管人话说明和资产治理规则',
    ],
    nextMilestones: [
      {
        label: '主链状态驱动化收口',
        summary: '继续把四张主链页剩余的人话逻辑和 fallback 下沉到状态层，减少页面分散判断。',
      },
      {
        label: '产物减法正式化',
        summary: '继续收紧进阶页面、旧入口说明和诊断归档的默认生成与默认暴露策略。',
      },
      {
        label: '实时工作台产品化',
        summary: '把对话协同、阶段接力和资产沉淀进一步打通成完整的个人工作流工作台。',
      },
    ],
  };
}

function summarizeTimeline(manifest, jobState, outputDir) {
  const events = [];
  const createdAt = jobState?.createdAt || manifest?.generatedAt || null;
  const runtimeMode = String(manifest?.runtimeMode || '').trim();
  const jobStatus = String(jobState?.status || '').trim();
  const hasCompletedExecution = jobStatus === 'completed'
    || Boolean(manifest?.hostNative)
    || Number(manifest?.success || 0) > 0
    || Number(manifest?.failed || 0) > 0;
  const hasPrepareStage = runtimeMode === 'prepare-only'
    || fileExists(path.join(outputDir, 'prepare_workspace.html'))
    || fileExists(path.join(outputDir, 'task_spec.normalized.json'))
    || fileExists(path.join(outputDir, 'prompt_validation_report.json'))
    || fileExists(path.join(outputDir, 'batch_plan.json'));
  const hasResultStage = runtimeMode !== 'prepare-only' && (
    Boolean(manifest?.hostNative)
    || Number(manifest?.success || 0) > 0
    || Number(manifest?.failed || 0) > 0
    || (fileExists(path.join(outputDir, 'result_workspace.html')) && hasCompletedExecution)
  );
  if (hasPrepareStage) {
    events.push({
      type: 'prepare_completed',
      title: '准备阶段已生成',
      summary: '准备工作台已经可用，可以确认方向、放行与素材绑定。',
      time: createdAt,
    });
  }
  if (jobStatus === 'planned') {
    events.push({
      type: 'execution_queued',
      title: '执行计划已排队',
      summary: '批次计划已经生成，等待正式开始执行。',
      time: jobState?.updatedAt || createdAt,
    });
  }
  if (jobStatus === 'running') {
    const completedBatches = Number(jobState?.progress?.completedBatches || 0);
    const totalBatches = Number(jobState?.progress?.totalBatches || 0);
    const currentBatch = Number(jobState?.progress?.currentBatch || 0);
    events.push({
      type: 'execution_running',
      title: currentBatch > 0 ? `正在执行第 ${currentBatch} 批` : '任务正在执行中',
      summary: totalBatches > 0
        ? `当前已完成 ${completedBatches}/${totalBatches} 批，工作台会持续刷新进度。`
        : '当前任务正在执行中，工作台会持续刷新进度。',
      time: jobState?.updatedAt || createdAt,
    });
  }
  if (hasResultStage) {
    events.push({
      type: manifest?.hostNative ? 'host_native_results_ingested' : 'execution_completed',
      title: manifest?.hostNative ? '宿主结果已回填' : '执行阶段已完成',
      summary: '结果工作台已经可用，可以继续筛图和收口。',
      time: manifest?.generatedAt || createdAt,
    });
  }
  if (manifest?.paused) {
    events.push({
      type: 'paused',
      title: '任务已暂停',
      summary: manifest.pauseReason || '请先处理风险后再决定是否继续。',
      time: manifest?.generatedAt || createdAt,
    });
  }
  const latestEvent = events[events.length - 1] || null;
  return {
    summary: {
      eventCount: events.length,
      latestTitle: String(latestEvent?.title || '').trim() || '当前没有阶段事件',
      latestSummary: String(latestEvent?.summary || '').trim() || '当前还没有新的阶段变化。',
    },
    events,
  };
}

function buildWorkspaceSourceSummary(options = {}) {
  const manifest = options.manifest || {};
  const workspaceAssets = options.workspaceAssets || {};
  const workspaceTimeline = options.workspaceTimeline || {};
  const successItems = toArray(options.successItems);
  const failedItems = toArray(options.failedItems);
  const reviewItems = toArray(options.reviewItems);
  const prompts = toArray(options.prompts);
  const batchPlan = toArray(options.batchPlan);
  const assetSummary = workspaceAssets.summary || {};
  const timelineSummary = workspaceTimeline.summary || {};
  const recentEvent = toArray(workspaceTimeline.events).slice(-1)[0] || null;

  return {
    counts: {
      selected: Number(manifest.selectedCount || manifest.promptCount || prompts.length || 0),
      success: Number(manifest.success || successItems.length || 0),
      failed: Number(manifest.failed || failedItems.length || 0),
      needsReview: Number(reviewItems.length || 0),
      batches: Number(manifest.batchCount || batchPlan.length || 0),
      stages: Number(manifest.stageCount || 0),
    },
    assets: {
      previewCount: Number(assetSummary.previewCount || 0),
      resultCount: Number(assetSummary.resultCount || 0),
      reviewCount: Number(assetSummary.reviewCount || 0),
      exceptionCount: Number(assetSummary.exceptionCount || 0),
      referenceCount: Number(assetSummary.referenceCount || 0),
      userFacingCount: Number(assetSummary.userFacingCount || 0),
      workbenchStateCount: Number(assetSummary.workbenchStateCount || 0),
      diagnosticCount: Number(assetSummary.diagnosticCount || 0),
      systemCount: Number(assetSummary.systemCount || 0),
    },
    assetLayers: workspaceAssets.layers || {},
    timeline: {
      eventCount: Number(timelineSummary.eventCount || 0),
      latestTitle: String(timelineSummary.latestTitle || '').trim() || '当前没有阶段事件',
      latestSummary: String(timelineSummary.latestSummary || '').trim() || '当前还没有新的阶段变化。',
      recentEvent: recentEvent
        ? {
          type: String(recentEvent.type || '').trim() || 'unknown',
          title: String(recentEvent.title || '').trim() || '当前没有阶段事件',
          summary: String(recentEvent.summary || '').trim() || '当前还没有新的阶段变化。',
          time: recentEvent.time || null,
        }
        : null,
    },
    distributions: {
      topRequestMode: String(options.topRequestMode || '').trim() || '未记录',
      topStyleFamily: String(options.topStyleFamily || '').trim() || '未记录',
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(args['output-dir'] || process.cwd());
  const taskCenterPath = path.join(path.dirname(outputDir), 'task_center.html');
  const manifestPath = path.resolve(args['manifest-file'] || path.join(outputDir, 'manifest.json'));
  const workspaceStateFile = path.resolve(args['workspace-state-file'] || path.join(outputDir, 'workspace_state.json'));
  const workspaceAssetsFile = path.resolve(args['workspace-assets-file'] || path.join(outputDir, 'workspace_assets.json'));
  const workspaceTimelineFile = path.resolve(args['workspace-timeline-file'] || path.join(outputDir, 'workspace_timeline.json'));
  const workbenchStateFile = path.resolve(args['workbench-state-file'] || path.join(outputDir, 'workbench_state.json'));
  const unifiedWorkbenchStateFile = path.resolve(args['unified-workbench-state-file'] || resolveUnifiedWorkbenchStatePath(outputDir));

  const manifest = readJson(manifestPath);
  const taskSpec = readJsonIfExists(path.join(outputDir, 'task_spec.normalized.json')) || {};
  const modeDetection = readJsonIfExists(path.join(outputDir, 'daoge_mode_detection.json')) || {};
  const successItems = readJsonIfExists(path.join(outputDir, 'success.json')) || [];
  const failedItems = readJsonIfExists(path.join(outputDir, 'failed.json')) || [];
  const reviewItems = readJsonIfExists(path.join(outputDir, 'needs_review.json')) || [];
  const jobState = readJsonIfExists(path.join(outputDir, 'job_state.json')) || null;
  const referenceBindings = readJsonIfExists(path.join(outputDir, 'reference_bindings.imported.json')) || null;
  const validation = readJsonIfExists(path.join(outputDir, 'prompt_validation_report.json')) || {};
  const prompts = readJsonIfExists(path.join(outputDir, 'prompts.generated.json')) || [];
  const batchPlan = readJsonIfExists(path.join(outputDir, 'batch_plan.json')) || [];
  const referenceAnalysis = readJsonIfExists(path.join(outputDir, 'reference_asset_analysis.json')) || {};
  const operationsReport = readJsonIfExists(path.join(outputDir, 'operations_report.json')) || {};
  const rerunCandidates = readJsonIfExists(path.join(outputDir, 'rerun_candidates.json')) || [];
  const entryState = loadEntryStateSnapshot(outputDir);

  const storyboardSpecialization = inferStoryboardSpecialization({
    outputDir,
    taskSpec,
    modeDetection,
    manifest,
    successItems,
    failedItems,
    reviewItems,
  });
  const runtimeSnapshot = buildRuntimeStateSnapshot(outputDir, { jobState, manifest }) || null;
  const status = inferStatus(manifest, outputDir, {
    reviewCount: reviewItems.length,
    runtimeSummary: runtimeSnapshot,
    jobStatus: jobState?.status || '',
    jobProgress: jobState?.progress || {},
  });
  const nextAction = inferNextAction(manifest, outputDir, {
    reviewCount: reviewItems.length,
    runtimeSummary: runtimeSnapshot,
    jobStatus: jobState?.status || '',
    jobProgress: jobState?.progress || {},
  });
  const routes = {
    catalog: path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html'),
    taskCenter: path.join(path.dirname(outputDir), 'task_center.html'),
    home: path.join(outputDir, 'workspace_home.html'),
    prepare: path.join(outputDir, 'prepare_workspace.html'),
    result: path.join(outputDir, 'result_workspace.html'),
    exception: path.join(outputDir, 'exception_workspace.html'),
    record: path.join(outputDir, 'run_record.html'),
    storyboard: fileExists(path.join(outputDir, 'storyboard_board.html')) ? path.join(outputDir, 'storyboard_board.html') : null,
  };
  const entryBridge = buildEntryBridge(entryState, routes);
  const workspaceAssets = summarizeAssets(outputDir, {
    successItems,
    failedItems,
    reviewItems,
    referenceBindings,
  });
  const persistedWorkspaceAssets = buildCanonicalWorkbenchAssets(workspaceAssets);
  const workspaceTimeline = summarizeTimeline(manifest, jobState, outputDir);
  const topRequestMode = operationsReport?.distributions?.requestMode?.[0]?.name || '未记录';
  const topStyleFamily = operationsReport?.distributions?.styleFamily?.[0]?.name || '未记录';
  const sourceSummary = buildWorkspaceSourceSummary({
    manifest,
    workspaceAssets: persistedWorkspaceAssets,
    workspaceTimeline,
    successItems,
    failedItems,
    reviewItems,
    prompts,
    batchPlan,
    topRequestMode,
    topStyleFamily,
  });
  if (runtimeSnapshot) {
    sourceSummary.runtime = {
      currentStatus: runtimeSnapshot.currentStatus,
      currentStage: runtimeSnapshot.currentStage,
      currentBatch: runtimeSnapshot.currentBatch,
      completedBatchCount: runtimeSnapshot.completedBatchCount,
      pendingBatchCount: runtimeSnapshot.pendingBatchCount,
      totalBatchCount: runtimeSnapshot.totalBatchCount,
      progressSummary: runtimeSnapshot.progressSummary,
      updatedAt: runtimeSnapshot.updatedAt,
    };
  }
  const timelineEvents = Array.isArray(workspaceTimeline?.events) ? workspaceTimeline.events : [];
  const userAssetOverview = buildUserAssetOverview(workspaceAssets.layers);
  const timelineEventsSnapshot = buildTimelineEventsSnapshot(timelineEvents);
  const timelinePrepareEvent = timelineEvents.find((event) => event.type === 'prepare_completed') || null;
  const timelineResultEvent = timelineEvents.find((event) => ['execution_completed', 'host_native_results_ingested'].includes(String(event?.type || '').trim())) || null;
  const timelinePausedEvent = timelineEvents.find((event) => event.type === 'paused') || null;
  const hasStoryboard = shouldShowStoryboardPage({
    outputDir,
    workspaceState: { specialization: { storyboard: storyboardSpecialization } },
    storyboardPath: routes.storyboard,
    taskSpec,
    modeDetection,
    manifest,
    successItems,
    failedItems,
    reviewItems,
  });
  const optionalPageMode = summarizeOptionalPageEmission({
    optionalPageMode: resolveOptionalPageMode(outputDir, manifest),
  });
  const artifactGovernance = {
    ...summarizeArtifactGovernance(outputDir, { hasStoryboard }),
    defaultGenerationContract: optionalPageMode.generationContract || {},
  };
  const governanceSnapshot = buildGovernanceSnapshot(outputDir, {
    hasStoryboard,
    currentMode: String(manifest.runtimeMode || '').trim(),
    currentPage: 'workspace_home.html',
    optionalPageMode: optionalPageMode.mode,
    artifactLayerProtocol: artifactGovernance.artifactLayerProtocol || {},
    issueCount: Number(manifest.failed || 0) + reviewItems.length,
    reviewCount: reviewItems.length,
    hasPrepare: fileExists(routes.prepare),
    hasResult: fileExists(routes.result),
    hasRunRecord: fileExists(routes.record),
    hasTaskCenter: fileExists(taskCenterPath),
    homeRouteToException: Number(manifest.failed || 0) > 0 || reviewItems.length > 0,
  });
  const workbenchGuide = buildWorkbenchGuideMap(artifactGovernance, optionalPageMode);
  const assetVisibilityGuide = buildAssetVisibilityGuideMap({
    hasPrepare: fileExists(routes.prepare),
    hasStoryboard,
    optionalPageMode,
  });
  const governanceByPage = buildGovernanceSnapshotMap(outputDir, {
    hasStoryboard,
    currentMode: String(manifest.runtimeMode || '').trim(),
    optionalPageMode: optionalPageMode.mode,
    artifactLayerProtocol: artifactGovernance.artifactLayerProtocol || {},
    issueCount: Number(manifest.failed || 0) + reviewItems.length,
    reviewCount: reviewItems.length,
    hasPrepare: fileExists(routes.prepare),
    hasResult: fileExists(routes.result),
    hasRunRecord: fileExists(routes.record),
    hasTaskCenter: fileExists(taskCenterPath),
    homeRouteToException: Number(manifest.failed || 0) > 0 || reviewItems.length > 0,
  });
  const hasCompletedExecution = String(jobState?.status || '').trim() === 'completed'
    || Boolean(manifest?.hostNative)
    || Number(manifest.failed || 0) > 0
    || Number(manifest.success || successItems.length || 0) > 0;
  const homeHasIssue = Number(manifest.failed || 0) > 0 || reviewItems.length > 0;
  const homeActionLanguage = Number(manifest.failed || 0) > 0
    ? buildActionLanguage('go_exception')
    : ((fileExists(path.join(outputDir, 'result_workspace.html')) && hasCompletedExecution)
      ? buildActionLanguage('go_result')
      : buildActionLanguage('go_prepare'));
  const homeConfirmationPlan = buildHomeConfirmationPlan({
    hasFailure: Number(manifest.failed || 0) > 0,
    hasResultWorkspace: fileExists(path.join(outputDir, 'result_workspace.html')) && hasCompletedExecution,
    actionKey: Number(manifest.failed || 0) > 0
      ? 'go_exception'
      : ((fileExists(path.join(outputDir, 'result_workspace.html')) && hasCompletedExecution) ? 'go_result' : 'go_prepare'),
  });
  const homeFlowPlan = buildHomeFlowPlan({
    hasIssue: homeHasIssue,
    hasResult: fileExists(routes.result) && hasCompletedExecution,
    prepareAvailable: fileExists(routes.prepare),
    currentStage: status.phase,
    nextActionLabel: nextAction.label,
    nextActionReason: nextAction.reason,
    riskSummary: Number(manifest.failed || 0) > 0
      ? '当前存在失败项，建议先处理异常。'
      : (reviewItems.length > 0 ? '当前存在待复核项，建议进一步人工确认。' : '当前没有明显异常压力。'),
    primaryActionKey: Number(manifest.failed || 0) > 0
      ? 'go_exception'
      : ((fileExists(routes.result) && hasCompletedExecution) ? 'go_result' : 'go_prepare'),
  });

  const workspaceState = {
    version: 1,
    runId: path.basename(outputDir),
    taskLabel: deriveTaskLabel({
      taskLabel: String(taskSpec.content_brief || path.basename(outputDir)).trim(),
      selectedCount: Number(manifest.selectedCount || manifest.promptCount || 0),
      sampleSize: Number(manifest.sampleSize || 0),
      pauseReason: manifest.pauseReason || '',
      resumeManifest: manifest.resumeManifest || null,
    }, outputDir),
    mode: String(manifest.runtimeMode || '').trim() === 'prepare-only'
      ? 'prepare'
      : (Number(manifest.failed || 0) > 0
        ? 'exception'
        : (Number(manifest.success || successItems.length || 0) > 0 || Number(manifest.selectedCount || manifest.promptCount || 0) > 0 || reviewItems.length > 0
          ? 'result'
          : (fileExists(path.join(outputDir, 'prepare_workspace.html')) ? 'prepare' : 'entry'))),
    runtimeMode: manifest.runtimeMode || (manifest.hostNative ? 'host-native-image-tool' : 'local-batch-runner'),
    workflowKind: inferWorkflowKind(manifest, taskSpec, modeDetection),
    runtimeSummary: runtimeSnapshot,
    runtimeWorkflow: runtimeSnapshot?.runtimeWorkflow && typeof runtimeSnapshot.runtimeWorkflow === 'object'
      ? runtimeSnapshot.runtimeWorkflow
      : undefined,
    entryState,
    entryBridge,
    status,
    counts: {
      selected: sourceSummary.counts.selected,
      success: sourceSummary.counts.success,
      failed: sourceSummary.counts.failed,
      needsReview: sourceSummary.counts.needsReview,
      batches: sourceSummary.counts.batches,
      stages: sourceSummary.counts.stages,
    },
    sourceSummary,
    assetLayers: workspaceAssets.layers || {},
    nextAction,
    risk: {
      hasIssue: Number(manifest.failed || 0) > 0 || reviewItems.length > 0,
      summary: Number(manifest.failed || 0) > 0
        ? '当前存在失败项，建议先处理异常。'
        : (reviewItems.length > 0 ? '当前存在待复核项，建议进一步人工确认。' : '当前没有明显异常压力。'),
    },
    confirmationState: buildConfirmationState({
      currentIntent: Number(manifest.failed || 0) > 0
        ? '先处理异常后再继续主链'
        : ((fileExists(path.join(outputDir, 'result_workspace.html')) && hasCompletedExecution) ? '继续结果收口' : '先确认准备条件'),
      stageLabel: status.phase,
      stageTone: status.tone,
      confirmedItems: [
        `当前阶段: ${status.phase}`,
        `推荐下一步: ${nextAction.label}`,
      ],
      pendingItems: homeConfirmationPlan.pendingItems,
      blockingItems: homeConfirmationPlan.blockingItems,
      recommendedReply: homeConfirmationPlan.recommendedReply,
      recentEvent: timelinePausedEvent || timelineResultEvent || timelinePrepareEvent || sourceSummary.timeline.recentEvent,
      canContinue: Number(manifest.failed || 0) <= 0,
      summary: homeConfirmationPlan.summary,
    }),
    routes,
    pageGroups: {
      entry: governanceSnapshot.entry,
      mainline: governanceSnapshot.mainline,
      support: governanceSnapshot.support,
      conditional: governanceSnapshot.conditional,
      advanced: governanceSnapshot.advanced,
      legacy: governanceSnapshot.legacy,
      defaultVisible: governanceSnapshot.defaultVisible,
      defaultGenerated: governanceSnapshot.defaultGenerated,
      defaultGeneratedMainline: governanceSnapshot.defaultGeneratedMainline,
      defaultGeneratedSupport: governanceSnapshot.defaultGeneratedSupport,
    },
    governance: governanceSnapshot,
    governanceByPage,
    artifactGovernance,
    optionalPageMode,
    workbenchGuide,
    assetVisibilityGuide,
    panels: governanceSnapshot.visibility,
    specialization: {
      storyboard: {
        enabled: storyboardSpecialization.enabled,
        slotCount: storyboardSpecialization.slotCount,
        hasReferenceBindings: Boolean(referenceBindings),
        hasMaskedEditSlots: successItems.concat(failedItems).some((item) => item.requestMode === 'masked-edit'),
      },
    },
    updatedAt: new Date().toISOString(),
  };
  const prepareSummary = summarizePrepareState(
    outputDir,
    taskSpec,
    modeDetection,
    prompts,
    validation,
    batchPlan,
    {
      counts: {
        selected: Number(manifest.selectedCount || manifest.promptCount || 0),
        batches: Number(manifest.batchCount || 0),
      },
    },
    workspaceAssets,
    referenceBindings,
    referenceAnalysis,
    { timelinePrepareEvent },
  );
  const resultSummary = summarizeResultState(
    manifest,
    {
      status,
      counts: {
        success: Number(manifest.success || successItems.length || 0),
        failed: Number(manifest.failed || failedItems.length || 0),
        needsReview: Number(reviewItems.length || 0),
      },
    },
    workspaceAssets,
    reviewItems,
    operationsReport,
    { hasStoryboard, timelineResultEvent },
  );
  const exceptionSummary = summarizeExceptionState(
    manifest,
    {
      status,
      counts: {
        failed: Number(manifest.failed || failedItems.length || 0),
        needsReview: Number(reviewItems.length || 0),
      },
      risk: {
        summary: Number(manifest.failed || 0) > 0
          ? '当前存在失败项，建议先处理异常。'
          : (reviewItems.length > 0 ? '当前存在待复核项，建议进一步人工确认。' : '当前没有明显异常压力。'),
      },
    },
    rerunCandidates,
    { hasStoryboard, timelinePausedEvent, timelineResultEvent },
  );
  const pageData = buildWorkspacePageData({
    manifest,
    sourceSummary,
    workspaceAssets,
    workspaceState,
    workbenchGuide,
    assetVisibilityGuide,
    prepareSummary,
    resultSummary,
    exceptionSummary,
    operationsReport,
    rerunCandidates,
    timelineEventsSnapshot,
  });
  const prepareFlowPlan = buildPrepareFlowPlan({
    tone: prepareSummary?.readiness?.tone,
    importedBindingCount: Number(prepareSummary?.importedBindingCount || 0),
    blockingItems: toArray(prepareSummary?.readiness?.blockingItems),
    readinessLabel: prepareSummary?.readiness?.label,
    readinessDetail: prepareSummary?.readiness?.detail,
  });
  const resultFlowPlan = buildResultFlowPlan({
    failedCount: Number(manifest.failed || 0),
    reviewCount: reviewItems.length,
    hasStoryboard,
    nextActionLabel: nextAction.label,
    nextStepReason: nextAction.reason,
    currentFocus: resultSummary?.currentFocus,
    statusLabel: resultSummary?.statusLabel,
    statusSummary: resultSummary?.statusSummary,
  });
  const exceptionFlowPlan = buildExceptionFlowPlan({
    failedCount: Number(manifest.failed || 0),
    reviewCount: reviewItems.length,
    rerunCount: Number(exceptionSummary?.rerunCount || 0),
    hasStoryboard,
    nextStepLabel: exceptionSummary?.nextStepLabel,
    issueSummary: exceptionSummary?.issueSummary,
    currentFocus: exceptionSummary?.currentFocus,
    statusLabel: exceptionSummary?.statusLabel,
    statusSummary: exceptionSummary?.statusSummary,
  });
  const homeCardPlan = buildHomeCardPlan({
    hasResult: fileExists(routes.result),
    issueCount: workspaceState.counts.failed + workspaceState.counts.needsReview,
    statusTone: status.tone,
    nextActionLabel: nextAction.label,
    nextActionReason: nextAction.reason,
    riskSummary: workspaceState.risk?.summary || '当前没有明显异常',
    phase: status.phase,
  });
  const prepareCardPlan = buildPrepareCardPlan({
    readinessLabel: prepareSummary.readiness?.label,
    readinessDetail: prepareSummary.readiness?.detail,
    readinessTone: prepareSummary.readiness?.tone,
    templateName: prepareSummary.templateName,
    modeLabel: prepareSummary.modeLabel,
    mainDirection: prepareSummary.mainDirection,
    styleDirection: prepareSummary.styleDirection,
    importedBindingCount: prepareSummary.importedBindingCount,
  });
  const resultCardPlan = buildResultCardPlan({
    failedCount: workspaceState.counts.failed,
    statusLabel: resultSummary.statusLabel,
    statusTone: resultSummary.statusTone,
    statusSummary: resultSummary.statusSummary,
    currentFocus: resultSummary.currentFocus,
    nextActionLabel: nextAction.label,
    nextActionReason: nextAction.reason,
  });
  const exceptionCardPlan = buildExceptionCardPlan({
    failedCount: workspaceState.counts.failed,
    reviewCount: workspaceState.counts.needsReview,
    issueSummary: exceptionSummary.issueSummary,
    statusLabel: exceptionSummary.statusLabel,
    statusTone: exceptionSummary.statusTone,
    statusSummary: exceptionSummary.statusSummary,
  });
  const hasPrepare = fileExists(routes.prepare);
  const hasResult = fileExists(routes.result);
  const hasException = fileExists(routes.exception);
  const hasTaskCenter = fileExists(routes.taskCenter);
  const hasRunRecord = fileExists(routes.record);
  const homeFlowLabel = entryBridge?.context?.flowLabel
    ? entryBridge.context.flowLabel
    : homeCardPlan.flowLabel;
  const homeContextHints = entryBridge?.selectedEntry?.title
    ? [
      `当前这轮任务来自入口“${entryBridge.selectedEntry.title}”，首页会继续沿用这次入口判断。`,
      entryBridge?.mainlineProtocol?.handoffRule || '',
      entryBridge?.route?.next?.summary || nextAction.reason,
    ].filter(Boolean)
    : homeCardPlan.contextHints;
  const homeRoutePlan = buildHomeRoutePlan({
    currentLabel: buildHomeDecisionSummary({
      hasFailure: Number(manifest.failed || 0) > 0,
      hasResult: fileExists(routes.result),
      hasPrepare: fileExists(routes.prepare),
    }),
    currentSummary: buildHomeTaskConclusion({
      hasFailure: Number(manifest.failed || 0) > 0,
      hasResult: fileExists(routes.result),
      hasPrepare: fileExists(routes.prepare),
    }),
    nextActionLabel: nextAction.label,
    nextActionReason: nextAction.reason,
    ctaLabel: resolvePrimaryActionLanguage(nextAction).ctaLabel,
    file: path.join(outputDir, nextAction.target),
  });
  const prepareRoutePlan = buildPrepareRoutePlan({
    currentLabel: prepareSummary.readiness?.label,
    currentSummary: prepareSummary.readiness?.detail,
    homeFile: routes.home,
    resultFile: routes.result,
    previousCta: buildActionLanguage('go_home').ctaLabel,
    nextLabel: prepareSummary.readiness?.tone === 'bad' ? '先修正准备层' : '结果工作台',
    nextSummary: prepareSummary.readiness?.tone === 'bad'
      ? '当前还有准备阻塞项，先留在准备层把问题收干净，再继续往下走。'
      : '正式执行完成后，用统一结果页做筛图、收口和下一步判断。',
    nextFile: prepareSummary.readiness?.tone === 'bad' ? routes.prepare : routes.result,
    nextCta: (prepareSummary.readiness?.tone === 'bad' ? buildActionLanguage('refine_prepare') : buildActionLanguage('go_result')).ctaLabel,
    nextPendingLabel: prepareSummary.readiness?.tone === 'bad' ? '当前就先处理这一站' : '执行完成后生成',
  });
  const resultRoutePlan = buildResultRoutePlan({
    failedCount: workspaceState.counts.failed,
    currentLabel: resultSummary.statusLabel,
    currentSummary: resultSummary.statusSummary,
    homeFile: routes.home,
    previousCta: buildActionLanguage('go_home').ctaLabel,
    nextActionLabel: nextAction.label,
    nextActionReason: nextAction.reason,
    file: path.join(outputDir, nextAction.target),
    nextCta: (workspaceState.counts.failed > 0
      ? buildActionLanguage('go_exception')
      : resolvePrimaryActionLanguage({ target: nextAction.target }, { hasStoryboard })).ctaLabel,
  });
  const exceptionRoutePlan = buildExceptionRoutePlan({
    hasStoryboard,
    currentLabel: exceptionSummary.statusLabel,
    currentSummary: exceptionSummary.issueSummary || exceptionSummary.statusSummary,
    resultFile: routes.result,
    previousCta: buildActionLanguage('review_exception').ctaLabel,
    file: hasStoryboard ? routes.storyboard : routes.home,
    nextCta: (hasStoryboard ? buildActionLanguage('go_storyboard') : buildActionLanguage('go_home')).ctaLabel,
  });
  const homeWorkbenchCards = buildHomeWorkbenchPlan({
    hasPrepare,
    hasResult,
    hasTaskCenter,
    hasRunRecord,
    primaryTarget: nextAction.target,
    recordFile: routes.record,
    taskCenterFile: routes.taskCenter,
  });
  const prepareWorkbenchCards = buildPrepareWorkbenchPlan({
    hasTaskCenter,
    taskCenterFile: routes.taskCenter,
  });
  const resultWorkbenchCards = buildResultWorkbenchPlan({
    reviewCount: workspaceState.counts.needsReview,
    hasRunRecord,
    hasHome: fileExists(routes.home),
    primaryTarget: nextAction.target,
    recordFile: routes.record,
  });
  const exceptionWorkbenchCards = buildExceptionWorkbenchPlan({
    totalIssueCount: workspaceState.counts.failed + workspaceState.counts.needsReview,
    hasHome: fileExists(routes.home),
  });
  const homeEntryGuide = workbenchGuide?.home?.section || null;
  const prepareEntryGuide = workbenchGuide?.prepare?.section || null;
  const resultEntryGuide = workbenchGuide?.result?.section || null;
  const exceptionEntryGuide = workbenchGuide?.exception?.section || null;
  const homeAssetGuide = assetVisibilityGuide?.home || null;
  const prepareAssetGuide = assetVisibilityGuide?.prepare || null;
  const resultAssetGuide = assetVisibilityGuide?.result || null;
  const exceptionAssetGuide = assetVisibilityGuide?.exception || null;
  const homeAssetStatus = buildHomeAssetStatus(workspaceState, workspaceAssets, { hasResult, hasPrepare, hasException });
  const prepareAssetStatus = buildPrepareAssetStatus(prepareSummary, workspaceAssets);
  const resultAssetStatus = buildResultAssetStatus(workspaceState, workspaceAssets);
  const exceptionAssetStatus = buildExceptionAssetStatus(workspaceState, workspaceAssets, rerunCandidates);
  const homeActionStatus = buildHomeActionStatus(workspaceState, routes, { outputDir });
  const prepareActionStatus = buildPrepareActionStatus(prepareSummary, routes);
  const resultActionStatus = buildResultActionStatus(workspaceState, routes, { hasStoryboard, resultSummary });
  const exceptionActionStatus = buildExceptionActionStatus(workspaceState, routes, rerunCandidates, { hasStoryboard, exceptionSummary });
  const homeDialogueStatus = buildRuntimeAwareDialogueStatus(
    buildHomeDialogueStatus(workspaceState, nextAction),
    runtimeSnapshot
  );
  const prepareDialogueStatus = buildRuntimeAwareDialogueStatus(
    buildPrepareDialogueStatus(prepareSummary),
    runtimeSnapshot
  );
  const resultDialogueStatus = buildRuntimeAwareDialogueStatus(
    buildResultDialogueStatus(resultSummary),
    runtimeSnapshot
  );
  const exceptionDialogueStatus = buildRuntimeAwareDialogueStatus(
    buildExceptionDialogueStatus(exceptionSummary),
    runtimeSnapshot
  );
  let homeStageUi = buildHomeStageUiState(workspaceState.taskLabel, status.phase, workspaceState, {
    hasFailure: Number(manifest.failed || 0) > 0,
    hasResult,
    hasPrepare,
    nextActionLabel: nextAction.label,
    nextActionSummary: nextAction.reason,
    nextActionTarget: nextAction.target,
    runtimeSummary: runtimeSnapshot,
  });
  let resultRuntimeOverride = buildRuntimeStageOverrides('result', resultSummary, runtimeSnapshot, {
    taskLabel: workspaceState.taskLabel,
    stageLabel: status.phase,
    taskSummary: resultSummary.currentFocus || '当前正在做结果层取舍与分流判断。',
    runScaleLabel: `${resultSummary.successCount} 成功 / ${resultSummary.failedCount} 失败`,
    runScaleSummary: `${resultSummary.reviewCount} 项待复核 / ${resultSummary.previewCount} 张可预览`,
    currentFocus: resultSummary.currentFocus,
    defaultTarget: resultSummary.failedCount > 0 ? 'exception_workspace.html' : 'result_workspace.html',
  });
  let exceptionRuntimeOverride = buildRuntimeStageOverrides('exception', exceptionSummary, runtimeSnapshot, {
    taskLabel: workspaceState.taskLabel,
    stageLabel: status.phase,
    taskSummary: exceptionSummary.currentFocus || '当前正在处理异常相关问题。',
    runScaleLabel: `${exceptionSummary.failedCount} 失败 / ${exceptionSummary.reviewCount} 待复核`,
    runScaleSummary: `${exceptionSummary.rerunCount} 个补跑候选`,
    currentFocus: exceptionSummary.currentFocus,
    defaultTarget: 'workspace_home.html',
  });
  const homeCockpitSummary = buildHomeCockpitSummary(workspaceState, {
    nextAction,
    hasResult,
    hasPrepare,
  });
  const runtimeWorkflow = runtimeSnapshot?.runtimeWorkflow && typeof runtimeSnapshot.runtimeWorkflow === 'object'
    ? runtimeSnapshot.runtimeWorkflow
    : null;
  const homeRuntimePhaseLabel = homeStageUi.runtimeOverride?.stageLabel || status.phase;
  const homeRuntimeStatusLabel = homeStageUi.runtimeOverride?.statusLabel || buildHomeDecisionSummary({
    hasFailure: Number(manifest.failed || 0) > 0,
    hasResult,
    hasPrepare,
  });
  const homeRuntimeSummary = homeStageUi.runtimeOverride?.statusSummary || workspaceState.confirmationState?.summary || workspaceState.risk?.summary || '';
  const homeJudgment = buildHomeJudgmentPanel(workspaceState, nextAction);
  const homeStatusStack = buildHomeStatusStack({
    issueCount: workspaceState.counts.failed + workspaceState.counts.needsReview,
    hasResult,
    hasBlocking: homeConfirmationPlan.blockingItems.length > 0,
    canContinue: workspaceState.confirmationState?.canContinue,
    summary: workspaceState.confirmationState?.summary,
    nextActionLabel: nextAction.label,
    nextActionSummary: nextAction.reason,
  });
  const homeDecision = buildWorkspaceDecisionSectionData({
    items: buildWorkspaceDecisionItems({
      reasonValue: homeRuntimeStatusLabel,
      riskValue: homeStageUi.runtimeOverride?.pressureSummary || workspaceState.risk?.summary || '当前没有明显异常压力。',
      pageValue: homeStageUi.runtimeOverride?.stageSummary || '首页只负责给出当前主链入口与下一步方向。',
    }),
  });
  const homeSummary = buildWorkspaceSummarySectionData({
    enabled: false,
    title: '任务摘要',
    copy: getWorkspaceCopyTemplates('home').summaryCopy,
    items: [
      { label: '当前阶段', value: homeRuntimePhaseLabel },
      { label: getWorkspaceFieldLabels('home').currentConclusion, value: homeRuntimeStatusLabel },
      { label: getWorkspaceFieldLabels('home').resultOverview, value: userAssetOverview.summary },
      { label: '当前重点', value: homeStageUi.runtimeOverride?.currentFocus || buildHomeCurrentFocus({
        hasFailure: Number(manifest.failed || 0) > 0,
        hasResult,
        hasPrepare,
      }) },
      { label: '下一步', value: homeStageUi.nextActionLabel || nextAction.label },
      { label: '为什么先做这一步', value: homeStageUi.nextActionSummary || homeRuntimeSummary || nextAction.reason },
    ],
  });
  const homeCollaboration = buildWorkspaceCollaborationSectionData({
    confirmation: workspaceState.confirmationState,
    timeline: {
      copy: '这里按顺序回放这轮任务刚刚发生了什么，帮助你快速接上当前主链。',
      events: timelineEventsSnapshot,
    },
    dialogue: homeDialogueStatus,
    primarySay: homeDialogueStatus.primarySay,
    replyReason: homeDialogueStatus.actionReason,
  });
  prepareSummary.decision = buildWorkspaceDecisionSectionData({
    items: buildWorkspaceDecisionItems({
      reasonValue: prepareSummary.currentFocus,
      riskValue: prepareSummary.transitionSummary || (prepareSummary.readiness?.blockingItems?.[0] || prepareSummary.readiness?.cautionItems?.[0] || '当前主要是细节风险，不是硬阻塞。'),
      pageValue: prepareSummary.stageSummary,
    }),
  });
  prepareSummary.summary = buildWorkspaceSummarySectionData({
    enabled: true,
    title: '准备摘要',
    copy: getWorkspaceCopyTemplates('prepare').summaryCopy,
    items: [
      { label: '当前阶段', value: '准备阶段' },
      { label: '当前结论', value: prepareSummary.readiness.label },
      { label: '结果概况', value: prepareSummary.stageSummary || '当前正在确认方向、放行和素材绑定。' },
      { label: '当前重点', value: prepareSummary.currentFocus },
      { label: '下一步', value: prepareSummary.readiness.tone === 'bad' ? '先修正准备层' : '进入结果工作台' },
      { label: '为什么先做这一步', value: prepareSummary.nextStepReason || prepareSummary.readiness.detail },
    ],
  });
  prepareSummary.collaboration = buildWorkspaceCollaborationSectionData({
    confirmation: prepareSummary.confirmationState,
    timeline: {
      copy: '这里回放准备层刚刚确认了哪些阶段变化，帮助你判断现在该不该直接开跑。',
      events: timelineEventsSnapshot,
    },
    dialogue: prepareDialogueStatus,
    primarySay: prepareDialogueStatus.primarySay,
    replyReason: prepareDialogueStatus.actionReason,
  });
  resultSummary.decision = buildWorkspaceDecisionSectionData({
    items: buildWorkspaceDecisionItems({
      reasonValue: resultSummary.currentFocus,
      riskValue: resultSummary.nextStepReason || (resultSummary.failedCount > 0 ? '失败项会继续打断主链判断。' : (resultSummary.reviewCount > 0 ? '待复核项可能让结果层过早收口。' : '当前主要风险不在结果层，而在你是否还需要回看其他层。')),
      pageValue: resultSummary.stageSummary,
    }),
  });
  resultSummary.summary = buildWorkspaceSummarySectionData({
    enabled: false,
    title: '结果摘要',
    copy: getWorkspaceCopyTemplates('result').summaryCopy,
    items: [
      { label: '当前阶段', value: resultRuntimeOverride?.stageLabel || '结果阶段' },
      { label: '当前结论', value: resultSummary.statusLabel },
      { label: '结果概况', value: userAssetOverview.summary },
      { label: '当前重点', value: resultSummary.currentFocus },
      { label: '下一步', value: resultSummary.nextStepLabel },
      { label: '为什么先做这一步', value: resultSummary.nextStepReason },
    ],
  });
  resultSummary.collaboration = buildWorkspaceCollaborationSectionData({
    confirmation: resultSummary.confirmationState,
    timeline: {
      copy: '这里按顺序回放这轮结果层刚刚发生了什么，帮助你快速接上当前筛图与收口判断。',
      events: timelineEventsSnapshot,
    },
    dialogue: resultDialogueStatus,
    primarySay: resultDialogueStatus.primarySay,
    replyReason: resultDialogueStatus.actionReason,
  });
  exceptionSummary.decision = buildWorkspaceDecisionSectionData({
    items: buildWorkspaceDecisionItems({
      reasonValue: exceptionSummary.currentFocus,
      riskValue: exceptionSummary.nextStepReason || (exceptionSummary.totalIssueCount > 0 ? '这些问题会继续卡住工作台后续判断，或影响结果稳定度。' : '当前主要风险不在异常层，而在是否还需要回结果工作台复核。'),
      pageValue: exceptionSummary.stageSummary,
    }),
  });
  exceptionSummary.summary = buildWorkspaceSummarySectionData({
    enabled: false,
    title: '异常摘要',
    copy: getWorkspaceCopyTemplates('exception').summaryCopy,
    items: [
      { label: '当前阶段', value: exceptionRuntimeOverride?.stageLabel || '异常阶段' },
      { label: '当前结论', value: exceptionSummary.statusLabel },
      { label: '结果概况', value: userAssetOverview.summary },
      { label: '当前重点', value: exceptionSummary.currentFocus },
      { label: '下一步', value: exceptionSummary.nextStepLabel },
      { label: '为什么先做这一步', value: exceptionSummary.nextStepReason || exceptionSummary.issueSummary },
    ],
  });
  exceptionSummary.collaboration = buildWorkspaceCollaborationSectionData({
    confirmation: exceptionSummary.confirmationState,
    timeline: {
      copy: '这里回放异常层刚刚接住了哪些问题、工作台是怎么走到这里的，帮助你顺着问题收口再回工作台。',
      events: timelineEventsSnapshot,
    },
    dialogue: exceptionDialogueStatus,
    primarySay: exceptionDialogueStatus.primarySay,
    replyReason: exceptionDialogueStatus.actionReason,
  });
  pageData.prepare.decision = prepareSummary.decision;
  pageData.prepare.summary = prepareSummary.summary;
  pageData.prepare.collaboration = prepareSummary.collaboration;
  pageData.prepare.confirmation = prepareSummary.confirmationState;
  pageData.home.cockpitSummary = homeCockpitSummary;
  pageData.home.judgment = homeJudgment;
  pageData.home.statusStack = homeStatusStack;
  pageData.home.decision = homeDecision;
  pageData.home.summary = homeSummary;
  pageData.home.collaboration = homeCollaboration;
  pageData.home.confirmation = workspaceState.confirmationState;
  pageData.result.decision = resultSummary.decision;
  pageData.result.summary = resultSummary.summary;
  pageData.result.collaboration = resultSummary.collaboration;
  pageData.result.confirmation = resultSummary.confirmationState;
  pageData.exception.decision = exceptionSummary.decision;
  pageData.exception.summary = exceptionSummary.summary;
  pageData.exception.collaboration = exceptionSummary.collaboration;
  pageData.exception.confirmation = exceptionSummary.confirmationState;
  const homePrimaryAction = resolvePrimaryActionLanguage(nextAction);
  const preparePrimaryAction = prepareSummary.readiness?.tone === 'bad'
    ? buildActionLanguage('refine_prepare')
    : buildActionLanguage('go_result');
  const resultPrimaryAction = workspaceState.counts.failed > 0
    ? buildActionLanguage('go_exception')
    : resolvePrimaryActionLanguage({ target: nextAction.target }, { hasStoryboard });
  const exceptionPrimaryAction = hasStoryboard ? buildActionLanguage('go_storyboard') : buildActionLanguage('go_home');
  const homeReturnAction = buildActionLanguage('go_home');
  const resultReturnAction = buildActionLanguage('go_home');
  const exceptionReturnAction = buildActionLanguage('review_exception');
  const prepareTransitionStatus = buildPrepareToResultTransitionStatus(prepareSummary);
  const resultTransitionStatus = buildResultFromPrepareTransitionStatus(prepareSummary, resultSummary);
  const resultToExceptionTransitionStatus = buildResultToExceptionTransitionStatus(resultSummary, exceptionSummary);
  const exceptionTransitionStatus = buildExceptionFromResultTransitionStatus(resultSummary, exceptionSummary);
  const exceptionBackToMainlineTransitionStatus = buildExceptionBackToMainlineTransitionStatus(exceptionSummary, resultSummary, {
    returnLabel: hasStoryboard ? '回结果工作台或整板页' : '回结果工作台',
    hasStoryboard,
  });
  homeStageUi = buildHomeStageUiState(workspaceState.taskLabel, status.phase, workspaceState, {
    hasFailure: Number(manifest.failed || 0) > 0,
    hasResult,
    hasPrepare,
    nextActionLabel: nextAction.label,
    nextActionSummary: nextAction.reason,
    nextActionTarget: nextAction.target,
    runtimeSummary: runtimeSnapshot,
  });
  const prepareRuntimeOverride = buildRuntimePrepareOverrides(prepareSummary, runtimeSnapshot, {
    taskLabel: workspaceState.taskLabel,
    stageLabel: status.phase,
  });
  applyRuntimeOverrideToStageSummary(prepareSummary, prepareRuntimeOverride, {
    dialoguePrimarySay: prepareDialogueStatus?.primarySay,
    dialogueSummary: prepareDialogueStatus?.summary,
  });
  const prepareStageUi = buildPrepareStageUiState(workspaceState.taskLabel, status.phase, prepareSummary, {
    runtimeSummary: runtimeSnapshot,
  });
  resultRuntimeOverride = buildRuntimeStageOverrides('result', resultSummary, runtimeSnapshot, {
    taskLabel: workspaceState.taskLabel,
    stageLabel: status.phase,
    taskSummary: resultSummary.currentFocus || '当前正在做结果层取舍与分流判断。',
    runScaleLabel: `${resultSummary.successCount} 成功 / ${resultSummary.failedCount} 失败`,
    runScaleSummary: `${resultSummary.reviewCount} 项待复核 / ${resultSummary.previewCount} 张可预览`,
    currentFocus: resultSummary.currentFocus,
    defaultTarget: resultSummary.failedCount > 0 ? 'exception_workspace.html' : 'result_workspace.html',
  });
  applyRuntimeOverrideToStageSummary(resultSummary, resultRuntimeOverride, {
    dialoguePrimarySay: resultDialogueStatus?.primarySay,
    dialogueSummary: resultDialogueStatus?.summary,
  });
  exceptionRuntimeOverride = buildRuntimeStageOverrides('exception', exceptionSummary, runtimeSnapshot, {
    taskLabel: workspaceState.taskLabel,
    stageLabel: status.phase,
    taskSummary: exceptionSummary.currentFocus || '当前正在处理异常相关问题。',
    runScaleLabel: `${exceptionSummary.failedCount} 失败 / ${exceptionSummary.reviewCount} 待复核`,
    runScaleSummary: `${exceptionSummary.rerunCount} 个补跑候选`,
    currentFocus: exceptionSummary.currentFocus,
    defaultTarget: 'workspace_home.html',
  });
  applyRuntimeOverrideToStageSummary(exceptionSummary, exceptionRuntimeOverride, {
    dialoguePrimarySay: exceptionDialogueStatus?.primarySay,
    dialogueSummary: exceptionDialogueStatus?.summary,
  });
  const resultStageUi = buildResultStageUiState(workspaceState.taskLabel, status.phase, resultSummary, {
    runtimeSummary: runtimeSnapshot,
    runtimeOverride: resultRuntimeOverride,
  });
  const exceptionStageUi = buildExceptionStageUiState(workspaceState.taskLabel, status.phase, exceptionSummary, {
    runtimeSummary: runtimeSnapshot,
    runtimeOverride: exceptionRuntimeOverride,
  });
  const homeSessionConsole = homeStageUi.sessionConsole;
  const prepareSessionConsole = prepareStageUi.sessionConsole;
  const resultSessionConsole = resultStageUi.sessionConsole;
  const exceptionSessionConsole = exceptionStageUi.sessionConsole;

  workspaceState.prepare = prepareSummary;
  workspaceState.result = resultSummary;
  workspaceState.exception = exceptionSummary;
  workspaceState.unifiedStatus = buildUnifiedStatusFromStageUi({
    stageLabel: status.phase,
    sessionConsole: homeStageUi.sessionConsole,
    taskControlBar: homeStageUi.taskControlBar,
    dialogueStatus: homeDialogueStatus,
    confirmation: workspaceState.confirmationState,
    nextAction,
    runtimeNextAction: runtimeWorkflow?.nextAction,
    runtimeOverrides: {
      stage: String(runtimeWorkflow?.stageLabel || status.phase || '').trim() || status.phase,
      conclusion: String(runtimeWorkflow?.headline || status.headline || '').trim()
        || buildHomeTaskConclusion({
          hasFailure: Number(manifest.failed || 0) > 0,
          hasResult: fileExists(routes.result),
          hasPrepare: fileExists(routes.prepare),
        }),
      currentFocus: String(runtimeWorkflow?.nextAction?.reason || nextAction.reason || '').trim() || buildHomeCurrentFocus({
        hasFailure: Number(manifest.failed || 0) > 0,
        hasResult: fileExists(routes.result),
        hasPrepare: fileExists(routes.prepare),
      }),
      progress: String(runtimeWorkflow?.progressSummary || status.summary || '').trim() || workspaceState.confirmationState?.summary || '',
      status: String(runtimeWorkflow?.tone || status.tone || '').trim() || 'info',
      taskLabel: workspaceState.taskLabel,
    },
  });
  workspaceState.pageData = pageData;
  workspaceState.stagePlan = buildGovernanceStagePlan();
  const homeWorkflowCopilotState = buildWorkflowCopilot({
    stageKey: 'home',
    stageUi: homeStageUi,
    unifiedStatus: workspaceState.unifiedStatus,
    taskLabel: workspaceState.taskLabel,
    stageLabel: homeStageUi.runtimeOverride?.stageLabel || status.phase,
    statusLabel: buildHomeDecisionSummary({
      hasFailure: Number(manifest.failed || 0) > 0,
      hasResult: fileExists(routes.result),
      hasPrepare: fileExists(routes.prepare),
    }),
    pressureLabel: homeStageUi.pressureLabel,
    nextActionLabel: homeStageUi.nextActionLabel,
    nextActionSummary: homeStageUi.nextActionSummary,
    taskControlBar: homeStageUi.taskControlBar,
    sessionConsole: homeSessionConsole,
    signalBar: homeStageUi.signalBar,
    cockpitSummary: homeCockpitSummary,
    actionStatus: homeActionStatus,
    judgment: homeJudgment,
    stageRelay: buildHomeStageRelay(workspaceState, nextAction, {
      route: {
        nextSteps: homeRoutePlan.nextSteps,
      },
    }),
    statusStack: homeStageUi.statusStack,
    dialogueStatus: homeDialogueStatus,
    confirmation: workspaceState.confirmationState,
    replyReason: homeDialogueStatus?.actionReason || workspaceState.confirmationState?.summary,
  });
  const prepareWorkflowCopilotState = buildWorkflowCopilot({
    stageKey: 'prepare',
    stageUi: prepareStageUi,
    unifiedStatus: prepareSummary.unifiedStatus,
    taskLabel: workspaceState.taskLabel,
    stageLabel: prepareRuntimeOverride?.stageLabel || '准备阶段',
    statusLabel: prepareRuntimeOverride?.statusLabel || prepareSummary.readiness.label,
    pressureLabel: prepareStageUi.pressureLabel,
    nextActionLabel: prepareStageUi.nextActionLabel,
    nextActionSummary: prepareStageUi.nextActionSummary,
    taskControlBar: prepareStageUi.taskControlBar,
    sessionConsole: prepareSessionConsole,
    signalBar: prepareStageUi.signalBar,
    cockpitSummary: buildPrepareCockpitSummary(prepareSummary),
    actionStatus: prepareActionStatus,
    judgment: buildPrepareJudgmentPanel(prepareSummary),
    stageRelay: buildPrepareStageRelay(prepareSummary, {
      handoffFromPrevious: prepareTransitionStatus,
      handoffToNext: prepareTransitionStatus,
      route: {
        previous: prepareRoutePlan.previous,
        nextSteps: prepareRoutePlan.nextSteps,
      },
    }),
    statusStack: prepareStageUi.statusStack,
    dialogueStatus: prepareDialogueStatus,
    confirmation: prepareSummary.confirmationState,
    replyReason: prepareDialogueStatus?.actionReason || prepareSummary.confirmationState?.summary,
  });
  const resultWorkflowCopilotState = buildWorkflowCopilot({
    stageKey: 'result',
    stageUi: resultStageUi,
    unifiedStatus: resultSummary.unifiedStatus,
    taskLabel: workspaceState.taskLabel,
    stageLabel: resultRuntimeOverride?.stageLabel || '结果阶段',
    statusLabel: resultRuntimeOverride?.statusLabel || resultSummary.statusLabel,
    pressureLabel: resultStageUi.pressureLabel,
    nextActionLabel: resultStageUi.nextActionLabel,
    nextActionSummary: resultStageUi.nextActionSummary,
    taskControlBar: resultStageUi.taskControlBar,
    sessionConsole: resultSessionConsole,
    signalBar: resultStageUi.signalBar,
    cockpitSummary: buildResultCockpitSummary(resultSummary),
    actionStatus: resultActionStatus,
    judgment: buildResultJudgmentPanel(resultSummary),
    stageRelay: buildResultStageRelay(resultSummary, {
      handoffFromPrevious: resultTransitionStatus,
      handoffToNext: resultToExceptionTransitionStatus,
      route: {
        previous: resultRoutePlan.previous,
        nextSteps: resultRoutePlan.nextSteps,
      },
    }),
    statusStack: resultStageUi.statusStack,
    dialogueStatus: resultDialogueStatus,
    confirmation: resultSummary.confirmationState,
    replyReason: resultDialogueStatus?.actionReason || resultSummary.confirmationState?.summary,
  });
  const exceptionWorkflowCopilotState = buildWorkflowCopilot({
    stageKey: 'exception',
    stageUi: exceptionStageUi,
    unifiedStatus: exceptionSummary.unifiedStatus,
    taskLabel: workspaceState.taskLabel,
    stageLabel: exceptionRuntimeOverride?.stageLabel || '异常阶段',
    statusLabel: exceptionRuntimeOverride?.statusLabel || exceptionSummary.statusLabel,
    pressureLabel: exceptionStageUi.pressureLabel,
    nextActionLabel: exceptionStageUi.nextActionLabel,
    nextActionSummary: exceptionStageUi.nextActionSummary,
    taskControlBar: exceptionStageUi.taskControlBar,
    sessionConsole: exceptionSessionConsole,
    signalBar: exceptionStageUi.signalBar,
    cockpitSummary: buildExceptionCockpitSummary(exceptionSummary),
    actionStatus: exceptionActionStatus,
    judgment: buildExceptionJudgmentPanel(exceptionSummary),
    stageRelay: buildExceptionStageRelay(exceptionSummary, {
      handoffFromPrevious: exceptionTransitionStatus,
      handoffToNext: exceptionBackToMainlineTransitionStatus,
      route: {
        previous: exceptionRoutePlan.previous,
        nextSteps: exceptionRoutePlan.nextSteps,
      },
    }),
    statusStack: exceptionStageUi.statusStack,
    dialogueStatus: exceptionDialogueStatus,
    confirmation: exceptionSummary.confirmationState,
    replyReason: exceptionDialogueStatus?.actionReason || exceptionSummary.confirmationState?.summary,
  });
  workspaceState.workflowSessions = buildWorkflowSessionRegistry({
    home: homeWorkflowCopilotState,
    prepare: prepareWorkflowCopilotState,
    result: resultWorkflowCopilotState,
    exception: exceptionWorkflowCopilotState,
  });
  workspaceState.taskSessionSnapshots = buildTaskSessionSnapshotRegistry(workspaceState.workflowSessions);
  workspaceState.workflowProtocolRegistry = buildWorkflowProtocolRegistry(workspaceState.workflowSessions);
  workspaceState.workflowCopilotRegistry = buildWorkflowCopilotRegistry(workspaceState.workflowSessions);
  workspaceState.workflowContracts = buildWorkflowContractRegistry(workspaceState.workflowSessions);

  const baseViews = {
    home: buildHomeView({
      eyebrow: '主链总控',
      title: 'DAOGE 工作台首页',
      intro: '这是当前任务默认先看页。先看现在在哪、下一步去哪、要不要处理异常。',
      routeCopy: getWorkspaceStageChrome('home').routeCopy,
      workbenchCopy: getWorkspaceStageChrome('home').workbenchCopy,
      runLabel: workspaceState.taskLabel,
      currentStage: status.phase,
      flowLabel: homeFlowLabel,
      contextItems: [
        { label: '当前任务', value: workspaceState.taskLabel, audience: 'all' },
        { label: '当前阶段', value: status.phase, audience: 'all' },
        { label: '流程位置', value: homeCardPlan.contextFlowLabel, audience: 'pro' },
      ],
      contextCounts: [
        { label: '提示词', value: workspaceState.counts.selected, audience: 'pro' },
        { label: '批次', value: workspaceState.counts.batches, audience: 'pro' },
        { label: '成功', value: workspaceState.counts.success, audience: 'pro' },
        { label: '待处理', value: workspaceState.counts.failed + workspaceState.counts.needsReview, audience: 'newcomer' },
      ],
      contextHints: toArray(homeContextHints).map((hint, index) => (
        typeof hint === 'string'
          ? { text: hint, audience: index === 0 ? 'all' : 'pro' }
          : hint
      )),
      heroCards: homeCardPlan.heroCards,
      sessionConsole: homeSessionConsole,
      taskControlBar: homeStageUi.taskControlBar,
      signalBar: homeStageUi.signalBar,
      cockpitSummary: homeCockpitSummary,
      judgment: homeJudgment,
      stageRelay: buildHomeStageRelay(workspaceState, nextAction, {
        route: {
          nextSteps: homeRoutePlan.nextSteps,
        },
      }),
      confirmation: workspaceState.confirmationState,
      timeline: buildTimelineSection({
        title: '阶段时间线',
        copy: '这里按顺序回放这轮任务刚刚发生了什么，帮助你快速接上当前主链。',
        events: timelineEventsSnapshot,
      }),
      progress: buildProgressSection({
        title: getWorkspaceStageChrome('home').progressTitle,
        copy: getWorkspaceStageChrome('home').progressCopy,
        visibleIds: getDefaultProgressVisibleIds(),
      }),
      statusStack: homeStageUi.statusStack,
      flowStatus: homeFlowPlan.status,
      flowReadiness: homeFlowPlan.readiness,
      flowFocus: homeFlowPlan.focus,
      flowActionLabel: homeFlowPlan.actionLabel,
      flowActionSummary: homeFlowPlan.actionSummary,
      flowCompletion: homeFlowPlan.completion,
      flowBlockers: homeFlowPlan.blockers,
      flowAvailableActions: homeFlowPlan.availableActions,
      nextTitle: nextAction.label,
      issueLabel: workspaceState.risk?.summary || '',
      decisionSummary: buildHomeDecisionSummary({
        hasFailure: Number(manifest.failed || 0) > 0,
        hasResult: fileExists(routes.result),
        hasPrepare: fileExists(routes.prepare),
      }),
      taskConclusion: buildHomeTaskConclusion({
        hasFailure: Number(manifest.failed || 0) > 0,
        hasResult: fileExists(routes.result),
        hasPrepare: fileExists(routes.prepare),
      }),
      promptCount: workspaceState.counts.selected,
      batchCount: workspaceState.counts.batches,
      successCount: workspaceState.counts.success,
      failedCount: workspaceState.counts.failed,
      reviewCount: workspaceState.counts.needsReview,
      topRequestMode: sourceSummary.distributions.topRequestMode,
      topStyleFamily: sourceSummary.distributions.topStyleFamily,
      routeCurrent: homeRoutePlan.current,
      routePrevious: homeRoutePlan.previous,
      routeNextSteps: homeRoutePlan.nextSteps,
      workbenchCards: homeWorkbenchCards,
      entryGuide: homeEntryGuide,
      assetGuide: homeAssetGuide,
      guideTitle: homeEntryGuide?.title,
      guideCopy: homeEntryGuide?.copy,
      guideItems: homeEntryGuide?.items,
      visibilityTitle: homeAssetGuide?.title,
      visibilityCopy: homeAssetGuide?.copy,
      visibilityItems: homeAssetGuide?.items,
      previewEnabled: false,
      previewTitle: '图片速览',
      previewCopy: '首页默认先用主判断和主动作继续；如果这一轮已经出了图，这里可以补一眼看整体方向。',
      previewEmptyText: '当前还没有可展示的成功结果。',
      previewItemFallbackSummary: '这一张可以继续做保留、复核或淘汰判断。',
      previewImageLinkLabel: '查看原图',
      previewImageMissingText: '本轮未生成预览图',
      assetStatus: homeAssetStatus,
      actionStatus: homeActionStatus,
      dialogueStatus: homeDialogueStatus,
      workflowCopilot: homeWorkflowCopilotState,
      workflowContract: workspaceState.workflowContracts.home,
      copilot: buildViewCopilotFromWorkflowSession(homeWorkflowCopilotState, {
        confirmation: workspaceState.confirmationState,
      }),
      decision: homeDecision,
      summary: homeSummary,
      collaboration: homeCollaboration,
      summaryEnabled: false,
    }),
    prepare: buildPrepareView(prepareSummary, {
      eyebrow: prepareRuntimeOverride?.runtimeActive ? prepareRuntimeOverride.stageLabel : '执行前确认',
      title: 'DAOGE 准备工作台',
      intro: prepareRuntimeOverride?.runtimeActive
        ? (prepareRuntimeOverride.stageSummary || '当前这页已经切到实时状态承接视图，优先告诉你执行进度、暂停原因或确认点。')
        : '准备层现在只保留一页。你可以在这里同时确认任务方向、放行判断和素材绑定，不用再来回跳 Prompt 预览、预检页和素材页才能弄清当前是否能开跑。',
      runLabel: workspaceState.taskLabel,
      phaseLabel: status.phase,
      flowLabel: prepareCardPlan.flowLabel,
      runtimeStatus: runtimeSnapshot?.currentStatus,
      contextItems: [
        { label: '当前任务', value: workspaceState.taskLabel, audience: 'all' },
        { label: '当前阶段', value: prepareRuntimeOverride?.stageLabel || '准备阶段', audience: 'all' },
        { label: '流程位置', value: prepareRuntimeOverride?.runtimeActive ? '首页 -> 实时状态 -> 结果' : '首页 -> 准备 -> 结果', audience: 'pro' },
      ],
      contextCounts: [
        { label: '提示词', value: prepareSummary.promptCount, audience: 'pro' },
        { label: '批次', value: prepareSummary.batchCount, audience: 'pro' },
        { label: '素材绑定', value: prepareSummary.importedBindingCount, audience: 'pro' },
        { label: '提醒项', value: prepareSummary.readiness.blockingItems.length + prepareSummary.readiness.cautionItems.length, audience: 'pro' },
      ],
      contextHints: prepareRuntimeOverride?.runtimeActive
        ? [
          prepareRuntimeOverride.statusSummary || '当前实时状态已接管这一页。',
          prepareRuntimeOverride.nextActionSummary || '当前建议先盯住进度或先处理当前确认点。',
        ]
        : prepareCardPlan.contextHints,
      heroCards: prepareCardPlan.heroCards,
      sessionConsole: prepareSessionConsole,
      taskControlBar: prepareStageUi.taskControlBar,
      signalBar: prepareStageUi.signalBar,
      cockpitSummary: buildPrepareCockpitSummary(prepareSummary),
      judgment: buildPrepareJudgmentPanel(prepareSummary),
      stageRelay: buildPrepareStageRelay(prepareSummary, {
        handoffFromPrevious: prepareTransitionStatus,
        handoffToNext: prepareTransitionStatus,
        route: {
          previous: prepareRoutePlan.previous,
          nextSteps: prepareRoutePlan.nextSteps,
        },
      }),
      confirmation: prepareSummary.confirmationState,
      timeline: buildTimelineSection({
        title: '阶段时间线',
        copy: '这里回放准备层刚刚确认了哪些阶段变化，帮助你判断现在该不该直接开跑。',
        events: timelineEventsSnapshot,
      }),
      progress: buildProgressSection({
        title: getWorkspaceStageChrome('prepare').progressTitle,
        copy: getWorkspaceStageChrome('prepare').progressCopy,
        visibleIds: getDefaultProgressVisibleIds(),
      }),
      statusStack: prepareStageUi.statusStack,
      flowStatus: prepareRuntimeOverride?.statusLabel || prepareFlowPlan.status,
      flowReadiness: prepareRuntimeOverride?.statusSummary || prepareFlowPlan.readiness,
      flowFocus: prepareRuntimeOverride?.nextActionSummary || prepareFlowPlan.focus,
      flowActionLabel: prepareRuntimeOverride?.nextActionLabel || prepareFlowPlan.actionLabel,
      flowActionSummary: prepareRuntimeOverride?.nextActionSummary || prepareFlowPlan.actionSummary,
      flowCompletion: prepareRuntimeOverride?.pressureSummary || prepareFlowPlan.completion,
      flowBlockers: prepareRuntimeOverride?.runtimeActive ? [] : prepareFlowPlan.blockers,
      flowAvailableActions: prepareRuntimeOverride?.runtimeActive
        ? [prepareRuntimeOverride.nextActionLabel, '回到对话框继续', '等待当前状态刷新'].filter(Boolean)
        : prepareFlowPlan.availableActions,
      directionTitle: '任务方向',
      directionCopy: '这里保留普通用户真正需要看的方向信息，不直接把程序字段和内部产物名堆出来。',
      directionItems: [
        { label: '任务主轴', value: prepareSummary.mainDirection || '未提供' },
        { label: '风格主轴', value: prepareSummary.styleDirection || '未指定' },
        { label: '场景主轴', value: prepareSummary.sceneDirection || '未指定' },
        { label: '总提示词数', value: prepareSummary.promptCount || 0 },
        { label: '批次数量', value: prepareSummary.batchCount || 0 },
        { label: '参考资产数', value: prepareSummary.assetCount || 0 },
      ],
      readinessTitle: '执行判断',
      readinessCopy: '先判断能不能开跑，再决定是直接继续还是先收一轮。',
      blockingTitle: '阻塞清单',
      cautionTitle: '提醒清单',
      readinessBlockingItems: prepareSummary.readiness.blockingItems,
      readinessCautionItems: prepareSummary.readiness.cautionItems,
      readinessBlockingEmptyText: '当前没有硬阻塞',
      readinessCautionEmptyText: '当前没有明显提醒项',
      assetsTitle: '素材绑定',
      assetsCopy: '只有存在参考图、遮罩图或槽位绑定时，这部分才需要重点看。',
      assetsItems: [
        { label: '当前状态', value: prepareSummary.importedBindingCount > 0 ? `已绑定 ${prepareSummary.importedBindingCount} 项素材` : '当前没有绑定素材' },
        { label: '素材判断', value: prepareSummary.importedBindingCount > 0 ? '这是带约束的任务' : '这是自由度更高的任务' },
        { label: '参考资产数', value: prepareSummary.assetCount || 0 },
        { label: '后续关注点', value: prepareSummary.importedBindingCount > 0 ? '更关注主体稳定、边界完整和绑定是否跑偏。' : '更优先关注整体调性、构图和风格一致性。' },
      ],
      routeCurrent: prepareRoutePlan.current,
      previous: prepareRoutePlan.previous,
      nextSteps: prepareRoutePlan.nextSteps,
      workbenchCards: prepareWorkbenchCards,
      entryGuide: prepareEntryGuide,
      assetGuide: prepareAssetGuide,
      guideTitle: prepareEntryGuide?.title,
      guideCopy: prepareEntryGuide?.copy,
      guideItems: prepareEntryGuide?.items,
      visibilityTitle: prepareAssetGuide?.title,
      visibilityCopy: prepareAssetGuide?.copy,
      visibilityItems: prepareAssetGuide?.items,
      assetStatus: prepareAssetStatus,
      actionStatus: prepareActionStatus,
      dialogueStatus: prepareDialogueStatus,
      transitionStatus: prepareTransitionStatus,
      workflowCopilot: prepareWorkflowCopilotState,
      workflowContract: workspaceState.workflowContracts.prepare,
      copilot: buildViewCopilotFromWorkflowSession(prepareWorkflowCopilotState, {
        confirmation: prepareSummary.confirmationState,
      }),
    }),
    result: buildResultView(resultSummary, {
      eyebrow: '结果判断台',
      title: 'DAOGE 结果工作台',
      intro: '这里是当前任务的结果层。你只需要做三件事：细看图片、确认保留取舍、决定是否转去异常处理或整板复看。',
      runLabel: workspaceState.taskLabel,
      phaseLabel: status.phase,
      flowLabel: resultCardPlan.flowLabel,
      contextCounts: [
        { label: '成功', value: workspaceState.counts.success },
        { label: '失败', value: workspaceState.counts.failed },
        { label: '待复核', value: workspaceState.counts.needsReview },
      ],
      contextHints: resultCardPlan.contextHints,
      heroCards: resultCardPlan.heroCards,
      sessionConsole: resultSessionConsole,
      taskControlBar: resultStageUi.taskControlBar,
      signalBar: resultStageUi.signalBar,
      cockpitSummary: buildResultCockpitSummary(resultSummary),
      judgment: buildResultJudgmentPanel(resultSummary),
      stageRelay: buildResultStageRelay(resultSummary, {
        handoffFromPrevious: resultTransitionStatus,
        handoffToNext: resultToExceptionTransitionStatus,
        route: {
          previous: resultRoutePlan.previous,
          nextSteps: resultRoutePlan.nextSteps,
        },
      }),
      confirmation: resultSummary.confirmationState,
      timeline: buildTimelineSection({
        title: '阶段时间线',
        copy: '这里按顺序回放这轮结果层刚刚发生了什么，帮助你快速接上当前筛图与收口判断。',
        events: timelineEventsSnapshot,
      }),
      progress: buildProgressSection({
        title: getWorkspaceStageChrome('result').progressTitle,
        copy: getWorkspaceStageChrome('result').progressCopy,
        visibleIds: getDefaultProgressVisibleIds(),
      }),
      statusStack: resultStageUi.statusStack,
      flowStatus: resultFlowPlan.status,
      flowReadiness: resultFlowPlan.readiness,
      flowFocus: resultFlowPlan.focus,
      flowActionLabel: resultFlowPlan.actionLabel,
      flowActionSummary: resultFlowPlan.actionSummary,
      flowCompletion: resultFlowPlan.completion,
      flowBlockers: resultFlowPlan.blockers,
      flowAvailableActions: resultFlowPlan.availableActions,
      previewTitle: '图片速览',
      previewCopy: '这里把图片面放大，方便你继续筛图和取舍。',
      previewEmptyText: '当前还没有可展示的成功结果。',
      previewItemFallbackSummary: '这一张可在审阅板里继续做保留、复核或淘汰判断。',
      previewImageLinkLabel: '查看原图',
      previewImageMissingText: '本轮未生成预览图',
      issuesTitle: '异常摘要',
      issuesCopy: '只有真正需要关注的问题才会出现在这里，避免你再去翻散乱记录。',
      issuesEmptyText: '当前没有需要单独处理的失败项或待复核项。',
      issuesKicker: '需要关注',
      issuesFallbackReason: '建议回异常工作台统一处理。',
      advancedTitle: '高级信息',
      advancedCopy: '这些信息主要用于补充理解，不再默认占据主视觉。',
      advancedSummary: '展开查看结构分布',
      advancedRequestModeTitle: '请求方式分布',
      advancedStyleTitle: '风格分布',
      advancedSlotRoleTitle: '槽位角色分布',
      advancedEmptyText: '当前没有可展示的分布',
      guideTitle: resultEntryGuide?.title,
      guideCopy: resultEntryGuide?.copy,
      guideItems: resultEntryGuide?.items,
      visibilityTitle: resultAssetGuide?.title,
      visibilityCopy: resultAssetGuide?.copy,
      visibilityItems: resultAssetGuide?.items,
      routeCurrent: resultRoutePlan.current,
      previous: resultRoutePlan.previous,
      nextSteps: resultRoutePlan.nextSteps,
      workbenchCards: resultWorkbenchCards,
      entryGuide: resultEntryGuide,
      assetGuide: resultAssetGuide,
      assetStatus: resultAssetStatus,
      actionStatus: resultActionStatus,
      dialogueStatus: resultDialogueStatus,
      workflowCopilot: resultWorkflowCopilotState,
      workflowContract: workspaceState.workflowContracts.result,
      summaryEnabled: false,
      transitionStatus: resultTransitionStatus,
      handoffFromPrevious: resultTransitionStatus,
      handoffToNext: resultToExceptionTransitionStatus,
      copilot: buildViewCopilotFromWorkflowSession(resultWorkflowCopilotState, {
        confirmation: resultSummary.confirmationState,
      }),
    }),
    exception: buildExceptionView(exceptionSummary, {
      eyebrow: '异常处理台',
      title: 'DAOGE 异常工作台',
      intro: '这一页只在需要时出现。它把失败项、待复核项和补跑建议收进同一个地方，避免你在结果层多页之间来回找问题。',
      runLabel: workspaceState.taskLabel,
      phaseLabel: status.phase,
      flowLabel: exceptionCardPlan.flowLabel,
      contextCounts: [
        { label: '失败项', value: workspaceState.counts.failed },
        { label: '待复核', value: workspaceState.counts.needsReview },
        { label: '补跑候选', value: exceptionSummary.rerunCount },
      ],
      contextHints: exceptionCardPlan.contextHints,
      heroCards: exceptionCardPlan.heroCards,
      sessionConsole: exceptionSessionConsole,
      taskControlBar: exceptionStageUi.taskControlBar,
      signalBar: exceptionStageUi.signalBar,
      cockpitSummary: buildExceptionCockpitSummary(exceptionSummary),
      judgment: buildExceptionJudgmentPanel(exceptionSummary),
      stageRelay: buildExceptionStageRelay(exceptionSummary, {
        handoffFromPrevious: exceptionTransitionStatus,
        handoffToNext: exceptionBackToMainlineTransitionStatus,
        route: {
          previous: exceptionRoutePlan.previous,
          nextSteps: exceptionRoutePlan.nextSteps,
        },
      }),
      confirmation: exceptionSummary.confirmationState,
      timeline: buildTimelineSection({
        title: '阶段时间线',
        copy: '这里回放异常层刚刚接住了哪些问题、工作台是怎么走到这里的，帮助你顺着问题收口再回工作台。',
        events: timelineEventsSnapshot,
      }),
      progress: buildProgressSection({
        title: getWorkspaceStageChrome('exception').progressTitle,
        copy: getWorkspaceStageChrome('exception').progressCopy,
        visibleIds: getDefaultProgressVisibleIds(),
      }),
      statusStack: exceptionStageUi.statusStack,
      flowStatus: exceptionFlowPlan.status,
      flowReadiness: exceptionFlowPlan.readiness,
      flowFocus: exceptionFlowPlan.focus,
      flowActionLabel: exceptionFlowPlan.actionLabel,
      flowActionSummary: exceptionFlowPlan.actionSummary,
      flowCompletion: exceptionFlowPlan.completion,
      flowBlockers: exceptionFlowPlan.blockers,
      flowAvailableActions: exceptionFlowPlan.availableActions,
      issuesTitle: '问题列表',
      issuesCopy: '这里只保留真正会影响主链继续的问题，帮助你先把需要处理的对象收清楚。',
      issuesEmptyText: '当前没有明显异常，这一页可以先不使用。',
      failedFallbackSummary: '这一项在执行时没有稳定完成。',
      reviewFallbackSummary: '这一项建议人工再看一眼，确认边界、融合和主体稳定度。',
      guideTitle: exceptionEntryGuide?.title,
      guideCopy: exceptionEntryGuide?.copy,
      guideItems: exceptionEntryGuide?.items,
      visibilityTitle: exceptionAssetGuide?.title,
      visibilityCopy: exceptionAssetGuide?.copy,
      visibilityItems: exceptionAssetGuide?.items,
      routeCurrent: exceptionRoutePlan.current,
      previous: exceptionRoutePlan.previous,
      nextSteps: exceptionRoutePlan.nextSteps,
      workbenchCards: exceptionWorkbenchCards,
      entryGuide: exceptionEntryGuide,
      assetGuide: exceptionAssetGuide,
      assetStatus: exceptionAssetStatus,
      actionStatus: exceptionActionStatus,
      dialogueStatus: exceptionDialogueStatus,
      workflowCopilot: exceptionWorkflowCopilotState,
      workflowContract: workspaceState.workflowContracts.exception,
      summaryEnabled: false,
      transitionStatus: exceptionTransitionStatus,
      handoffFromPrevious: exceptionTransitionStatus,
      handoffToNext: exceptionBackToMainlineTransitionStatus,
      copilot: buildViewCopilotFromWorkflowSession(exceptionWorkflowCopilotState, {
        confirmation: exceptionSummary.confirmationState,
      }),
    }),
  };
  workspaceState.views = {
    home: attachViewDisplay(
      baseViews.home,
      governanceByPage?.[getWorkspacePageShellConfig('home').currentPage]?.display,
      'home'
    ),
    prepare: attachViewDisplay(
      baseViews.prepare,
      governanceByPage?.[getWorkspacePageShellConfig('prepare').currentPage]?.display,
      'prepare'
    ),
    result: attachViewDisplay(
      baseViews.result,
      governanceByPage?.[getWorkspacePageShellConfig('result').currentPage]?.display,
      'result'
    ),
    exception: attachViewDisplay(
      baseViews.exception,
      governanceByPage?.[getWorkspacePageShellConfig('exception').currentPage]?.display,
      'exception'
    ),
  };

  writeJson(workspaceStateFile, workspaceState);
  writeJson(workspaceAssetsFile, persistedWorkspaceAssets);
  writeJson(workspaceTimelineFile, workspaceTimeline);
  const compatibilityWorkbenchSnapshot = buildWorkbenchStateSnapshot(outputDir, {
    workspaceState,
    workspaceAssets: persistedWorkspaceAssets,
    workspaceTimeline,
    runtimeState: runtimeSnapshot,
    snapshotRole: 'derived-page-snapshot',
    outputFile: workbenchStateFile,
  });
  const unifiedWorkbenchSnapshot = buildWorkbenchStateSnapshot(outputDir, {
    workspaceState,
    workspaceAssets: persistedWorkspaceAssets,
    workspaceTimeline,
    runtimeState: runtimeSnapshot,
    snapshotRole: 'live-workbench-state',
    outputFile: unifiedWorkbenchStateFile,
  });
  writeJson(workbenchStateFile, compatibilityWorkbenchSnapshot);
  writeJson(unifiedWorkbenchStateFile, unifiedWorkbenchSnapshot);
  console.log(JSON.stringify({
    workspaceStateFile,
    workspaceAssetsFile,
    workspaceTimelineFile,
    workbenchStateFile,
    unifiedWorkbenchStateFile,
    mode: workspaceState.mode,
    runtimeMode: workspaceState.runtimeMode,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(String(error.message || error));
  process.exit(1);
}
