const fs = require('fs');
const path = require('path');
const { parseArgs, readJson, fileExists } = require('./script_utils');
const {
  renderPortalModeSwitch,
  renderPortalTopLinks,
  renderPortalContextBar,
  renderPortalProgressRail,
  renderPortalRouteCompass,
  renderPortalWorkbench,
} = require('./portal_shared');
const { renderPortalHeadAssets } = require('./portal_ui_shared');
const {
  relativeFile,
  readJsonIfExists,
  getWorkspaceStageChrome,
  getWorkspaceStagePhrases,
  getWorkspaceIdentityCopy,
  resolveWorkspaceShellRuntime,
  buildWorkspaceStageFallbackBundle,
  buildWorkspaceCockpitSummaryData,
  resolveWorkspaceStageContextBarData,
  resolveWorkspaceStageViewValue,
  resolveWorkspaceStageSection,
  resolveWorkspaceStageStateValue,
  resolveWorkspaceStageSessionConsole,
  resolveWorkspaceStageActionStatus,
  resolveWorkspaceStageDialogueStatus,
  resolveWorkspaceStageConfirmationState,
  buildWorkspaceDecisionSectionData,
  buildWorkspaceStageGuideFallback,
  buildWorkspaceStageVisibilityFallback,
  buildWorkspaceHeroCardsData,
  buildWorkspaceSummarySectionData,
  buildWorkspaceDecisionItems,
  buildWorkspaceStandardWorkbenchCard,
  renderMetricCard,
  renderWorkspaceFlowSection,
  renderWorkspaceConfirmationSection,
  renderWorkspaceDialogueStatusSection,
  renderWorkspaceTimelineSection,
  adaptWorkflowCopilot,
  renderWorkspaceAssetStatusSection,
  renderWorkspaceActionStatusSection,
  renderWorkspaceSessionConsoleSection,
  renderWorkspaceCockpitSummarySection,
  buildWorkspaceCollaborationSectionData,
  renderWorkspaceCollaborationSection,
  renderWorkspaceJudgmentPanelSection,
  renderWorkspaceSignalBar,
  renderWorkspaceStageRelaySection,
  renderWorkspaceTaskControlBar,
  buildConfirmationStateFromUnifiedStatus,
  buildCollaborationFromUnifiedStatus,
  buildStageRelayFromUnifiedStatus,
  buildWorkflowContractPageState,
  buildActionStatusFromUnifiedStatus,
  finalizeWorkspaceActionStatus,
  buildDialogueStatusFromUnifiedStatus,
  finalizeCollaborationPromptState,
  buildWorkflowTextDefaults,
  buildTaskControlBarFromUnifiedStatus,
  finalizeTaskControlBar,
  renderWorkspaceStatusStack,
  renderWorkspaceCopilotDeck,
  renderWorkspaceKeyValueSection,
  buildCommonDeclaredSectionRenderers,
  renderResolvedWorkspaceDecisionSection,
  renderResolvedWorkspaceSummarySection,
  renderWorkspaceGridSection,
  buildWorkspaceContentSectionPlan,
  resolveWorkspaceStageContentSectionPlan,
  renderWorkspaceDeclaredSections,
  renderWorkspaceSectionLayout,
  renderWorkspacePageShell,
  buildWorkspaceGuideSectionData,
  buildWorkspacePreviewSectionData,
  resolveWorkspaceGuideSectionData,
  resolveWorkspaceDecisionSectionData,
  resolveWorkspaceStageSummarySection,
  resolveWorkspaceStageRouteSection,
  resolveWorkspaceStageWorkbenchSection,
  buildRenderableWorkbench,
  summarizeArtifactLayer,
  buildWorkspaceFallbackGuide,
  buildWorkspaceFallbackTimeline,
  buildWorkspaceFallbackAssetOverview,
  buildStageWorkspaceFallbackState,
  buildUnifiedWorkflowCockpitSummary,
  buildUnifiedWorkflowJudgment,
  buildUnifiedWorkflowStatusStack,
  buildUnifiedWorkflowDecision,
  buildUnifiedWorkflowConfirmation,
  buildUnifiedWorkflowCollaboration,
  buildUnifiedWorkflowStageRelay,
  resolveUnifiedStageNarrative,
  resolveUnifiedNextAction,
} = require('./workspace_page_shared');
const { deriveTaskLabel } = require('./task_label_utils');
const {
  getStageContinuationCopy,
  buildHomeDecisionSummary,
  buildHomeTaskConclusion,
  buildHomeCurrentFocus,
  buildUserFacingAssetOverview,
} = require('./workspace_status_dictionary');
const { getWorkspaceDenseCopy } = require('./workspace_dense_copy');
const { loadWorkbenchState } = require('./workbench_state_shared');
const {
  resolveWorkspaceRouteFile,
  shouldShowStoryboardPage,
} = require('./workspace_storyboard_shared');
const {
  buildHomeStatusStack,
  buildHomeTaskControlBar,
  buildHomeSignalBar,
} = require('./workspace_status_dictionary');

function modeLabel(mode) {
  if (mode === 'masked-edit') return '局部编辑';
  if (mode === 'prompt-only') return '直接生图';
  return mode || '未标注';
}

function renderPreviewCard(outputDir, item, index, sectionCopy = {}) {
  const normalizedSection = buildWorkspacePreviewSectionData(sectionCopy);
  const href = item.output && fileExists(item.output) ? relativeFile(outputDir, item.output) : null;
  const title = item.title || item.shotLabel || item.slug || `结果 ${index + 1}`;
  const tags = [
    item.slotId ? `槽位 ${item.slotId}` : null,
    item.styleFamily || null,
    modeLabel(item.requestMode),
  ].filter(Boolean);

  return `
    <article class="preview-card">
      ${href ? `<a class="image-frame" href="${href}"><img src="${href}" alt="${title}" loading="lazy" /></a>` : '<div class="image-frame"></div>'}
      <h3 class="preview-title">${title}</h3>
      <p class="preview-meta">${item.scene || item.composition || normalizedSection.itemFallbackSummary}</p>
      <div class="preview-link">
        ${href ? `<a href="${href}">${normalizedSection.imageLinkLabel}</a>` : `<span>${normalizedSection.imageMissingText}</span>`}
      </div>
      ${tags.length ? `<ul class="info-list">${tags.map((tag) => `<li>${tag}</li>`).join('')}</ul>` : ''}
    </article>
  `;
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args['manifest-file'] ? path.resolve(args['manifest-file']) : null;
  const manifest = manifestPath && fileExists(manifestPath) ? readJson(manifestPath) : null;
  const outputDir = path.resolve(
    manifest?.outputDir ||
    args['output-dir'] ||
    (manifestPath ? path.dirname(manifestPath) : process.cwd())
  );
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'workspace_home.html'));

  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};
  const workspaceAssets = workbenchState.workspaceAssets || {};
  const workspaceTimeline = workbenchState.workspaceTimeline || {};
  const homePageData = pageState?.pageData?.home || {};
  const pageMetrics = homePageData?.metrics || {};
  const artifactLayer = summarizeArtifactLayer(pageState?.artifactGovernance || {});
  const homeFallbackGuide = buildWorkspaceFallbackGuide('home', artifactLayer);
  const workbenchGuide = pageState?.workbenchGuide?.home || null;
  const homeView = pageState?.views?.home || {};
  const entryBridge = pageState?.entryBridge && typeof pageState.entryBridge === 'object'
    ? pageState.entryBridge
    : null;
  const stateGuides = homeView?.guides || {};
  const guideCards = Array.isArray(workbenchGuide?.cards) && workbenchGuide.cards.length
    ? workbenchGuide.cards
    : [];
  const preparePath = path.join(outputDir, 'prepare_workspace.html');
  const resultPath = path.join(outputDir, 'result_workspace.html');
  const exceptionPath = path.join(outputDir, 'exception_workspace.html');
  const runRecordPath = path.join(outputDir, 'run_record.html');
  const storyboardPath = resolveWorkspaceRouteFile(outputDir, pageState, 'storyboard', path.join(outputDir, 'storyboard_board.html'));
  const taskCenterPath = path.join(path.dirname(outputDir), 'task_center.html');
  const examplesCatalogPath = path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html');
  const identity = getWorkspaceIdentityCopy();
  const specialWorkflowProtocol = pageState?.specialWorkflowProtocol && typeof pageState.specialWorkflowProtocol === 'object'
    ? pageState.specialWorkflowProtocol
    : {};

  const hasPrepare = fileExists(preparePath);
  const hasResult = fileExists(resultPath);
  const hasException = fileExists(exceptionPath);
  const hasRunRecord = fileExists(runRecordPath);
  const canonicalResultItems = readAssetCollection(workspaceAssets, 'result');
  const canonicalExceptionItems = readAssetCollection(workspaceAssets, 'exception');
  const canonicalReviewItems = readAssetCollection(workspaceAssets, 'review');
  const canonicalPreviewItems = readAssetCollection(workspaceAssets, 'preview');
  const hasStoryboard = shouldShowStoryboardPage({
    outputDir,
    workspaceState: pageState,
    storyboardPath,
    manifest,
    successItems: canonicalResultItems,
    failedItems: canonicalExceptionItems,
    reviewItems: canonicalReviewItems,
  });
  const hasTaskCenter = fileExists(taskCenterPath);
  const specialWorkflowCards = [
    specialWorkflowProtocol?.hostNative?.officialMainline ? {
      label: 'host-native 正式模式',
      value: specialWorkflowProtocol.hostNative.active ? '当前启用' : '本轮未启用',
      summary: specialWorkflowProtocol.hostNative.active
        ? (specialWorkflowProtocol.hostNative.defaultMainlineBehavior || specialWorkflowProtocol.hostNative.responsibility)
        : '宿主原生图像工具保留为正式运行模式之一，但本轮仍按当前工作流推进。',
      tone: specialWorkflowProtocol.hostNative.active ? 'good' : 'neutral',
      hideLinkIfMissing: true,
    } : null,
    specialWorkflowProtocol?.storyboard?.officialSubsystem ? {
      label: 'storyboard 专用子系统',
      value: specialWorkflowProtocol.storyboard.active ? '当前启用' : '按需启用',
      summary: specialWorkflowProtocol.storyboard.active
        ? `保留 ${specialWorkflowProtocol.storyboard.structureContract?.contentSlots || '分镜'} 个 content slot / layout / reference / mask 语义，不压平成普通批量图。`
        : specialWorkflowProtocol.storyboard.defaultMainlineBehavior,
      tone: specialWorkflowProtocol.storyboard.active ? 'info' : 'neutral',
      file: specialWorkflowProtocol.storyboard.active && specialWorkflowProtocol.storyboard.primarySurface ? specialWorkflowProtocol.storyboard.primarySurface : null,
      cta: '进入分镜整板补充页',
      hideLinkIfMissing: true,
    } : null,
    specialWorkflowProtocol?.localEditRerun?.officialProfessionalPath ? {
      label: 'local-edit / rerun 专业路径',
      value: specialWorkflowProtocol.localEditRerun.active ? '当前需要关注' : '异常时再启用',
      summary: specialWorkflowProtocol.localEditRerun.active
        ? (specialWorkflowProtocol.localEditRerun.defaultMainlineBehavior || specialWorkflowProtocol.localEditRerun.responsibility)
        : '局部修订和补跑只在异常页或分镜局部修订里处理，不抬成普通用户第一主链。',
      tone: specialWorkflowProtocol.localEditRerun.active ? 'warn' : 'neutral',
      file: specialWorkflowProtocol.localEditRerun.active ? (specialWorkflowProtocol.localEditRerun.routeContract?.rerunSurface || specialWorkflowProtocol.localEditRerun.routeContract?.exceptionSurface) : null,
      cta: '进入专业处理',
      hideLinkIfMissing: true,
    } : null,
  ].filter(Boolean);
  const fallbackAssetGuide = {
    ...homeFallbackGuide.visibility,
    items: [
      { label: '先看', value: '当前阶段、结果入口、异常压力' },
      { label: '按需再看', value: hasPrepare ? '准备工作台、任务档案' : '任务档案' },
      { label: '先不用看', value: '底层记录、辅助页面、内部细分页' },
    ],
  };
  const sourceSummary = pageState?.sourceSummary || {};
  const sourceCounts = sourceSummary?.counts || {};
  const sourceAssets = sourceSummary?.assets || {};
  const promptCount = Number(pageMetrics.promptCount || sourceCounts.selected || pageState?.counts?.selected || manifest?.selectedCount || 0);
  const successCount = Number(pageMetrics.successCount || sourceCounts.success || pageState?.counts?.success || manifest?.success || 0);
  const failedCount = Number(pageMetrics.failedCount || sourceCounts.failed || pageState?.counts?.failed || manifest?.failed || 0);
  const reviewCount = Number(pageMetrics.reviewCount || sourceCounts.needsReview || pageState?.counts?.needsReview || 0);
  const batchCount = Number(pageMetrics.batchCount || sourceCounts.batches || pageState?.counts?.batches || manifest?.batchCount || 0);
  const issueCount = failedCount + reviewCount;
  const topRequestMode = String(homePageData?.topRequestMode || sourceSummary?.distributions?.topRequestMode || '未记录').trim() || '未记录';
  const topStyleFamily = String(homePageData?.topStyleFamily || sourceSummary?.distributions?.topStyleFamily || '未记录').trim() || '未记录';
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount: promptCount,
    sampleSize: Number(manifest?.sampleSize || 0),
    pauseReason: manifest?.pauseReason || '',
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const homePageSections = homePageData?.sections || {};
  const previewItems = Array.isArray(homePageSections?.preview?.items) && homePageSections.preview.items.length
    ? homePageSections.preview.items.slice(0, 4)
    : canonicalPreviewItems.slice(0, 4);
  const assetSummary = workspaceAssets?.summary || {};
  const unifiedStatus = pageState?.unifiedStatus && typeof pageState.unifiedStatus === 'object'
    ? pageState.unifiedStatus
    : {};
  const runtimeSummary = pageState?.runtimeSummary && typeof pageState.runtimeSummary === 'object'
    ? pageState.runtimeSummary
    : {};
  const liveCopilotDirective = runtimeSummary.liveCopilotDirective && typeof runtimeSummary.liveCopilotDirective === 'object'
    ? runtimeSummary.liveCopilotDirective
    : (pageState?.liveCopilotDirective && typeof pageState.liveCopilotDirective === 'object'
      ? pageState.liveCopilotDirective
      : {});
  const runtimeCopilotSummary = runtimeSummary.copilotSummary && typeof runtimeSummary.copilotSummary === 'object'
    ? {
      ...runtimeSummary.copilotSummary,
      nextActionLabel: liveCopilotDirective.nextActionLabel || liveCopilotDirective.nextAction?.label || runtimeSummary.copilotSummary.nextActionLabel,
      nextActionSummary: liveCopilotDirective.nextActionSummary || liveCopilotDirective.nextAction?.reason || runtimeSummary.copilotSummary.nextActionSummary,
      recommendedReply: liveCopilotDirective.recommendedReply || liveCopilotDirective.primarySay || runtimeSummary.copilotSummary.recommendedReply,
      progressSummary: liveCopilotDirective.progressSummary || runtimeSummary.copilotSummary.progressSummary,
      conclusion: liveCopilotDirective.statusSummary || runtimeSummary.copilotSummary.conclusion,
    }
    : {};
  const taskConclusion = buildHomeTaskConclusion({
    hasFailure: issueCount > 0,
    hasResult,
    hasPrepare,
  });
  const shouldRouteToException = issueCount > 0 && hasException;
  const fallbackHomeStage = hasResult ? '结果阶段' : hasPrepare || promptCount > 0 ? '准备阶段' : '待开始';
  const currentStage = String(unifiedStatus.stage || pageState?.status?.phase || '').trim() || fallbackHomeStage;
  const currentStageSummary = String(unifiedStatus.progress || pageState?.status?.summary || '').trim();
  const currentStageConclusion = String(unifiedStatus.conclusion || pageState?.status?.headline || '').trim();
  const resolvedNextAction = shouldRouteToException
    ? {
      label: '进入异常工作台',
      reason: String(pageState?.risk?.summary || pageState?.status?.summary || '').trim()
        || '这一轮还有问题没有收口，先统一处理失败项和待复核项更稳。',
      target: 'exception_workspace.html',
    }
    : resolveUnifiedNextAction(unifiedStatus, {
      secondarySource: pageState?.nextAction,
      fallbackLabel: hasResult ? '进入结果工作台' : hasPrepare ? '进入准备工作台' : '先看入口页',
      fallbackReason: currentStageSummary || (hasResult ? '本轮已经进入统一结果判断，先看结果工作台。' : hasPrepare ? '先确认方向、放行和素材。' : '先从入口页开始选任务方向。'),
      fallbackTarget: hasResult ? 'result_workspace.html' : hasPrepare ? 'prepare_workspace.html' : path.basename(examplesCatalogPath),
    });
  const nextTargetPath = resolvedNextAction.target
    ? (path.isAbsolute(resolvedNextAction.target)
      ? resolvedNextAction.target
      : path.join(outputDir, resolvedNextAction.target))
    : (hasResult ? resultPath : hasPrepare ? preparePath : examplesCatalogPath);
  const nextHref = relativeFile(outputDir, nextTargetPath);
  const nextTitle = resolvedNextAction.label;
  const nextCopy = resolvedNextAction.reason;
  const issueLabel = pageState?.risk?.summary
    ? String(pageState.risk.summary).trim()
    : (issueCount > 0 ? `有 ${issueCount} 个待处理问题` : '当前没有明显异常');
  const issueTone = String(pageState?.status?.tone || '').trim() === 'bad'
    ? 'bad'
    : (issueCount > 0 ? 'bad' : 'good');
  const chrome = getWorkspaceStageChrome('home');
  const denseCopy = getWorkspaceDenseCopy('home');
  const {
    shell,
    governance,
    layout,
    surfaceRules,
    governedWorkbenchIds,
    modeSwitch,
  } = resolveWorkspaceShellRuntime(pageState, 'home', homeView);
  const decisionSummary = buildHomeDecisionSummary({
    hasFailure: issueCount > 0,
    hasResult,
    hasPrepare,
  });
  const currentFocus = buildHomeCurrentFocus({
    hasFailure: issueCount > 0,
    hasResult,
    hasPrepare,
  });
  const assetOverviewState = buildWorkspaceFallbackAssetOverview({
    stageKey: 'home',
    sourceAssets,
    assetSummary,
    metrics: {
      successCount,
      failedCount,
      reviewCount,
    },
    overviewBuilder: buildUserFacingAssetOverview,
  });
  const userFacingAssetOverview = assetOverviewState.overview;
  const homeFallbackState = buildStageWorkspaceFallbackState('home', {
    issueCount,
    hasResult,
    currentPhaseConclusion: currentStageConclusion,
    currentPhaseSummary: currentStageSummary,
    currentFocus,
    statusLabel: currentStage,
    statusSummary: decisionSummary,
    statusTone: issueCount > 0 ? 'warn' : 'good',
    nextActionLabel: nextTitle,
    nextActionReason: nextCopy,
    stageSummary: taskConclusion,
    transitionSummary: nextCopy,
    handoffSummary: nextCopy,
    issueSummary: issueLabel,
    pressureLabel: userFacingAssetOverview.pressureLabel,
    pressureSummary: userFacingAssetOverview.summary || issueLabel,
    pressureTone: issueCount > 0 ? 'bad' : 'good',
    confirmationState: resolveWorkspaceStageConfirmationState(pageState, 'home', homeView, homePageData?.confirmation || pageState?.confirmationState || {}),
  });
  const homeNarrative = resolveUnifiedStageNarrative(unifiedStatus, {
    ...homeFallbackState.narrative,
  });
  const homeHero = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'hero', {});
  const stagePhrases = getWorkspaceStagePhrases('home');
  const homeContext = homeView?.context || {};
  const homeFlow = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'flow', {});
  const homeAssetStatus = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'assetStatus', {});
  const homeActionStatus = resolveWorkspaceStageActionStatus(pageState, 'home', homeView);
  const homeDialogueStatus = resolveWorkspaceStageDialogueStatus(pageState, 'home', homeView);
  const homeControlRail = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'controlRail', {});
  const homeCopilot = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'copilot', {});
  const homeWorkflowCopilot = pageState?.workflowSessions?.home || resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'workflowCopilot', {});
  const homeWorkflowContract = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'workflowContract', pageState?.workflowContracts?.home || {});
  const homeSessionConsole = resolveWorkspaceStageSessionConsole(pageState, 'home', homeView);
  const homeConfirmationState = resolveWorkspaceStageConfirmationState(pageState, 'home', homeView, homePageData?.confirmation || pageState?.confirmationState || {});
  const homeTaskControlBar = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'taskControlBar', null);
  const homeSignalBar = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'signalBar', null);
  const homeStatusStack = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'statusStack', []);
  const stateHomeCockpitSummary = resolveWorkspaceStageStateValue(pageState, 'home', homePageData, {}, 'cockpitSummary', null);
  const stateHomeJudgment = resolveWorkspaceStageStateValue(pageState, 'home', homePageData, {}, 'judgment', null);
  const stateHomeDecision = resolveWorkspaceStageStateValue(pageState, 'home', homePageData, {}, 'decision', null);
  const stateHomeCollaboration = resolveWorkspaceStageStateValue(pageState, 'home', homePageData, {}, 'collaboration', null);
  const homeCockpitSummary = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'cockpitSummary', null);
  const homeTimeline = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'timeline', null);
  const homeJudgment = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'judgment', null);
  const homeStageRelay = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'stageRelay', null);
  const resolvedHomeCockpitSummary = buildUnifiedWorkflowCockpitSummary({
    base: stateHomeCockpitSummary,
    workflow: null,
    copilot: homeCopilot?.hero?.cockpitSummary,
    view: homeCockpitSummary,
    items: homeFallbackState.cockpitItems,
  });
  const resolvedHomeConfirmationState = buildConfirmationStateFromUnifiedStatus(unifiedStatus, homeConfirmationState);
  const resolvedHomeTimeline = homeTimeline
    || homePageData?.sections?.timeline
    || buildWorkspaceFallbackTimeline('home', {
      workspaceTimelineEvents: workspaceTimeline?.events,
    });
  const resolvedHomeProgress = resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'progress', null);
  const resolvedHomeActionStatus = buildActionStatusFromUnifiedStatus(unifiedStatus, {
    base: homeActionStatus,
    copilotSummary: runtimeCopilotSummary,
    confirmationReply: liveCopilotDirective.recommendedReply || homeConfirmationState.recommendedReply,
    confirmationSummary: homeConfirmationState.summary,
    dialogueNextSayItems: homeDialogueStatus.nextSayItems,
    nextActionSummary: liveCopilotDirective.nextActionSummary || nextCopy || String(homeConfirmationState.summary || '').trim(),
    defaultActionReason: stagePhrases.actionReason,
  });
  const resolvedHomeDialogueStatus = buildDialogueStatusFromUnifiedStatus(unifiedStatus, {
    base: homeDialogueStatus,
    copilotSummary: runtimeCopilotSummary,
    confirmationReply: liveCopilotDirective.recommendedReply || homeConfirmationState.recommendedReply,
    confirmationSummary: homeConfirmationState.summary,
    nextActionSummary: liveCopilotDirective.nextActionSummary || nextCopy || String(homeConfirmationState.summary || '').trim(),
    defaultActionReason: stagePhrases.dialogueActionReason,
  });
  const resolvedHomeWorkflow = adaptWorkflowCopilot(homeWorkflowCopilot, {
    stageKey: 'home',
    stageLabel: currentStage,
    taskControlBar: homeTaskControlBar,
    sessionConsole: homeSessionConsole,
    signalBar: homeSignalBar,
    statusStack: homeStatusStack,
    cockpitSummary: stateHomeCockpitSummary || homeCockpitSummary,
    dialogueStatus: resolvedHomeDialogueStatus,
    confirmation: resolvedHomeConfirmationState,
    timeline: homeTimeline,
    judgment: stateHomeJudgment || homeJudgment,
    stageRelay: homeStageRelay,
  });
  const homeContractState = buildWorkflowContractPageState(homeWorkflowContract, {
    taskControlBar: resolvedHomeWorkflow.taskControlBar,
    dialogueStatus: resolvedHomeDialogueStatus,
    confirmation: resolvedHomeConfirmationState,
    sessionConsole: resolvedHomeWorkflow.sessionConsole || homeSessionConsole,
    progressTone: issueCount > 0 ? 'warn' : 'good',
  });
  const finalizedHomeActionStatus = finalizeWorkspaceActionStatus(resolvedHomeActionStatus, resolvedHomeWorkflow);
  const finalizedHomeDialogueStatus = finalizeCollaborationPromptState(resolvedHomeDialogueStatus, {
    contractDialogue: homeContractState.dialogueStatus,
    confirmationReply: resolvedHomeConfirmationState.recommendedReply,
    confirmationSummary: resolvedHomeConfirmationState.summary,
    defaultActionReason: resolvedHomeWorkflow.language.dialogueActionReason,
  });
  const homeRecommendedReply = String(
    liveCopilotDirective.recommendedReply
    || liveCopilotDirective.primarySay
    || runtimeCopilotSummary.recommendedReply
    || resolvedHomeConfirmationState.recommendedReply
    || (Array.isArray(homeDialogueStatus.nextSayItems) ? homeDialogueStatus.nextSayItems[0] : '')
    || finalizedHomeDialogueStatus.primarySay
    || ''
  ).trim();
  const homeTextDefaults = buildWorkflowTextDefaults({
    copilotSummary: runtimeCopilotSummary,
    nextActionSummary: liveCopilotDirective.nextActionSummary || runtimeCopilotSummary.nextActionSummary || nextCopy,
    recommendedReply: homeRecommendedReply,
    primarySay: homeRecommendedReply,
    progressSummary: runtimeCopilotSummary.progressSummary || unifiedStatus.progress || decisionSummary || nextCopy || '',
    statusSummary: liveCopilotDirective.statusSummary || runtimeCopilotSummary.conclusion || homeNarrative.statusSummary || decisionSummary || nextCopy || '',
    confirmationSummary: resolvedHomeConfirmationState.summary,
    issueSummary: issueCount > 0 ? issueLabel : '',
    continuationLabel: getStageContinuationCopy('home'),
  });
  const resolvedHomeDecision = buildUnifiedWorkflowDecision({
    stageConfig: {
      title: chrome.decisionTitle,
      copy: chrome.decisionCopy,
    },
    base: buildWorkspaceDecisionSectionData({
      items: buildWorkspaceDecisionItems({
        reasonValue: decisionSummary,
        riskValue: issueCount > 0 ? issueLabel : '当前主链没有明显阻塞，主要风险来自你是否还想改方向。',
        pageValue: resolvedHomeWorkflow.language.pagePurpose,
      }),
    }),
    state: stateHomeDecision,
    view: resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'decision', null),
  });
  const resolvedHomeSummary = resolveWorkspaceStageSummarySection(
    pageState,
    'home',
    {
      ...homeView,
      summary: homeView?.summary || homePageData?.summary || {},
    },
    buildWorkspaceSummarySectionData({
      enabled: layout.showSummaryByDefault,
      title: chrome.summaryTitle,
      copy: chrome.summaryCopy,
      items: [
        { label: '当前阶段', value: unifiedStatus.stage || currentStage },
        { label: '当前结论', value: homeNarrative.statusLabel || taskConclusion },
        { label: '结果概况', value: userFacingAssetOverview.summary },
        { label: '当前重点', value: homeNarrative.currentFocus || currentFocus },
        { label: '下一步', value: liveCopilotDirective.nextActionLabel || liveCopilotDirective.nextAction?.label || unifiedStatus.nextAction?.label || nextTitle },
        { label: '为什么先做这一步', value: liveCopilotDirective.nextActionSummary || liveCopilotDirective.nextAction?.reason || unifiedStatus.nextAction?.reason || nextCopy },
        { label: '默认入口', value: artifactLayer.defaultEntryLabel },
      ],
    })
  );
  const resolvedHomeTaskControlBar = finalizeTaskControlBar(
    homeContractState.taskControlBar
    || resolvedHomeWorkflow.taskControlBar
    || homeCopilot?.hero?.taskControlBar
    || homeControlRail.taskControlBar
    || homeTaskControlBar
    || buildTaskControlBarFromUnifiedStatus(unifiedStatus, {
      copilotSummary: runtimeCopilotSummary,
      taskLabel,
      stageLabel: currentStage,
      nextActionLabel: nextTitle,
      nextActionSummary: nextCopy,
      primarySay: homeDialogueStatus.primarySay || homeConfirmationState.recommendedReply || '',
      progressSummary: decisionSummary || nextCopy || '',
    })
    || buildHomeTaskControlBar({
    taskLabel,
    stageLabel: currentStage,
    issueCount,
    hasResult,
    nextActionLabel: nextTitle,
    nextActionSummary: nextCopy,
  }), {
    preferOptionFields: ['statusSummary', 'nextActionSummary', 'primarySay', 'progressSummary'],
    taskLabel,
    stageLabel: currentStage,
    statusLabel: homeNarrative.statusLabel || taskConclusion || currentStage,
    statusSummary: homeTextDefaults.statusSummary,
    statusTone: issueCount > 0 ? 'warn' : 'good',
    pressureLabel: userFacingAssetOverview.pressureLabel,
    pressureSummary: userFacingAssetOverview.summary || issueLabel || '',
    pressureTone: issueCount > 0 ? 'bad' : 'good',
    nextActionLabel: nextTitle,
    nextActionSummary: homeTextDefaults.nextActionSummary,
    nextActionTone: issueCount > 0 ? 'warn' : 'good',
    primarySay: homeTextDefaults.primarySay,
    forcePrimarySay: homeTextDefaults.primarySay,
    progressLabel: stagePhrases.progressLabel,
    progressSummary: homeTextDefaults.progressSummary,
    progressTone: issueCount > 0 ? 'warn' : 'good',
  });
  const resolvedHomeSignalBar = resolvedHomeWorkflow.signalBar
    || homeCopilot?.hero?.signalBar
    || homeControlRail.signalBar
    || (Array.isArray(homeSignalBar) ? { items: homeSignalBar } : homeSignalBar)
    || {
      items: buildHomeSignalBar({
        stageLabel: currentStage,
        issueCount,
        hasResult,
        statusSummary: issueCount > 0 ? issueLabel : homeTextDefaults.statusSummary,
        nextActionLabel: nextTitle,
        nextActionSummary: homeTextDefaults.nextActionSummary,
        replyLabel: homeTextDefaults.replyLabel,
      }),
    };
  const resolvedHomeStatusStack = buildUnifiedWorkflowStatusStack({
    workflow: resolvedHomeWorkflow.statusStack,
    copilot: homeCopilot?.mainline?.statusStack,
    controlRail: homeControlRail.statusStack,
    stateItems: homePageData?.statusStack || homeStatusStack,
    fallbackBuilder: () => buildHomeStatusStack({
      issueCount,
      hasResult,
      hasBlocking: resolvedHomeConfirmationState.hasBlocking,
      canContinue: resolvedHomeConfirmationState.canContinue,
      summary: resolvedHomeConfirmationState.summary,
      nextActionLabel: nextTitle,
      nextActionSummary: homeTextDefaults.nextActionSummary,
    }),
  });
  const resolvedHomeCollaboration = buildUnifiedWorkflowCollaboration(unifiedStatus, {
    base: homeContractState.collaboration || stateHomeCollaboration,
    workflow: resolvedHomeWorkflow.collaboration,
    view: resolveWorkspaceStageViewValue(pageState, 'home', homeView, 'collaboration', null),
    confirmation: homeContractState.confirmation || resolvedHomeConfirmationState,
    timeline: resolvedHomeTimeline,
    dialogue: finalizedHomeDialogueStatus,
  });
  const entryGuide = stateGuides.entryStructure || workbenchGuide?.section || null;
  const visibilityGuide = stateGuides.assetVisibility || pageState?.assetVisibilityGuide?.home || null;
  const homeGuideSection = resolveWorkspaceStageSection(pageState, 'home', homeView, homePageData, 'guide');
  const homeVisibilitySection = resolveWorkspaceStageSection(pageState, 'home', homeView, homePageData, 'visibility');
  const homePreviewSection = resolveWorkspaceStageSection(pageState, 'home', homeView, homePageData, 'preview');
  const normalizedHomeGuideSection = resolveWorkspaceGuideSectionData(homeGuideSection, buildWorkspaceStageGuideFallback('home', {
    entryGuideTitle: entryGuide?.title,
    entryGuideItems: entryGuide?.items,
    guideCopy: homeFallbackGuide.guide.copy,
    defaultEntryLabel: artifactLayer.defaultEntryLabel,
  }));
  const normalizedHomeVisibilitySection = resolveWorkspaceGuideSectionData(homeVisibilitySection, buildWorkspaceStageVisibilityFallback('home', {
    visibilityTitle: visibilityGuide?.title || fallbackAssetGuide.title,
    visibilityCopy: visibilityGuide?.copy || fallbackAssetGuide.copy,
    visibilityItems: Array.isArray(visibilityGuide?.items) && visibilityGuide.items.length ? visibilityGuide.items : fallbackAssetGuide.items,
  }));
  const normalizedHomePreviewSection = buildWorkspacePreviewSectionData(
    homePreviewSection
  );
  const homeHeroCards = Array.isArray(homeView?.heroCards) ? homeView.heroCards : [];
  const normalizedHomeSummary = buildWorkspaceSummarySectionData(resolvedHomeSummary || {});
  const previewEnabled = normalizedHomePreviewSection.enabled !== false;
  const homeContentSections = renderWorkspaceDeclaredSections(
    resolveWorkspaceStageContentSectionPlan(
      pageState,
      'home',
      homeView,
      denseCopy.contentSectionOrder.map((key) => ({
        key,
        kind: key === 'preview' ? 'previewGrid' : 'keyValue',
        enabled: key === 'preview' ? previewEnabled : true,
      }))
    ),
    {
      ...buildCommonDeclaredSectionRenderers({
        guide: normalizedHomeGuideSection,
        visibility: normalizedHomeVisibilitySection,
      }),
      preview: () => previewEnabled ? renderWorkspaceGridSection({
        title: normalizedHomePreviewSection.title,
        copy: normalizedHomePreviewSection.copy,
        gridClass: 'preview-grid',
        itemsHtml: previewItems.map((item, index) => renderPreviewCard(outputDir, item, index, normalizedHomePreviewSection)),
        emptyText: normalizedHomePreviewSection.emptyText,
      }) : '',
    }
  );
  const homeExtraWorkbenchCards = [
    shouldRouteToException
      ? (hasResult
        ? { id: 'result-workspace', label: '结果工作台', value: '处理完再回看', summary: '问题收口后，再回结果工作台做保留、复核和最终取舍。', file: resultPath, cta: '回结果工作台', tone: 'info' }
        : null)
      : (hasPrepare
        ? buildWorkspaceStandardWorkbenchCard({
          stage: 'home',
          denseCopy,
          source: {
            id: 'prepare-workspace',
            label: '准备工作台',
            value: hasResult ? denseCopy.optionalEntryValue : '当前可用',
            summary: '需要回看方向、放行或素材时再进入。',
            file: preparePath,
            cta: '进入准备工作台',
            tone: 'info',
          },
        })
        : null),
    !shouldRouteToException && hasRunRecord
      ? buildWorkspaceStandardWorkbenchCard({
        stage: 'home',
        denseCopy,
        type: 'record',
        source: {
          id: 'run-record',
          label: '任务档案',
          file: runRecordPath,
          cta: '查看任务档案',
        },
      })
      : null,
    !shouldRouteToException && !hasPrepare && !hasRunRecord && hasTaskCenter
      ? { id: 'task-center', label: '任务总控', value: '切换任务', summary: '只有想换一轮任务时，再从这里回入口层。', file: taskCenterPath, cta: '回任务总控', tone: 'neutral' }
      : null,
    ...guideCards,
  ].filter(Boolean);
  const homeFallbackBundle = buildWorkspaceStageFallbackBundle('home', {
    denseCopy,
    runLabel: taskLabel,
    phaseLabel: `${currentStage} · 当前任务`,
    entryFlowLabel: String(entryBridge?.context?.flowLabel || '').trim(),
    contextItems: homeContext.items,
    countValues: {
      focus: currentFocus,
      stage: currentStage,
      next: nextTitle,
      pressure: issueCount > 0 ? '还有内容要收口' : '当前平稳',
    },
    hasResult,
    entryTitle: entryBridge?.selectedEntry?.title,
    extraHints: homeContext.hints,
    routeTitle: chrome.routeTitle,
    routeCopy: chrome.routeCopy,
    currentLabel: decisionSummary,
    nextLabel: nextTitle,
    nextSummary: nextCopy,
    nextHref,
    nextCta: '现在进入',
    workbenchTitle: chrome.workbenchTitle,
    workbenchCopy: chrome.workbenchCopy,
    extraWorkbenchCards: homeExtraWorkbenchCards,
  });
  const fallbackWorkbenchCards = homeFallbackBundle.workbench.cards
    .filter((card) => !governedWorkbenchIds || !card.id || governedWorkbenchIds.has(card.id));
  const resolvedHomeWorkbench = resolveWorkspaceStageWorkbenchSection(
    pageState,
    'home',
    homeView,
    { ...homeFallbackBundle.workbench, cards: fallbackWorkbenchCards }
  );
  const resolvedHomeRoute = resolveWorkspaceStageRouteSection(
    pageState,
    'home',
    homeView,
    homeFallbackBundle.route
  );
  const specialWorkflowSection = specialWorkflowCards.length ? renderPortalWorkbench(outputDir, {
    title: '特殊工作流定位',
    copy: specialWorkflowProtocol.positioning || '这些能力是正式工作流，但默认不扩成新的普通用户主链。',
    cards: specialWorkflowCards,
    maxCards: 3,
  }) : '';

  const contextBarData = resolveWorkspaceStageContextBarData(pageState, 'home', homeView, homeFallbackBundle.context);
  const contextBar = renderPortalContextBar(contextBarData);
  const html = renderWorkspacePageShell({
    pageTitle: shell.pageTitle,
    currentPage: shell.currentPage,
    headAssets: renderPortalHeadAssets(),
    cssVars: shell.cssVars,
    topLinks: renderPortalTopLinks(outputDir, {
      currentPage: shell.currentPage,
      governance,
      extraLinks: [],
    }),
    heroEyebrow: String(homeHero.eyebrow || '').trim() || shell.heroEyebrow,
    heroTitle: String(homeHero.title || '').trim() || shell.heroTitle,
    heroCopy: String(homeHero.intro || '').trim() || shell.heroCopy,
    contextBar,
    copilotDeck: renderWorkspaceCopilotDeck({
      title: homeCopilot?.title || resolvedHomeWorkflow.language.deckTitle,
      copy: homeCopilot?.copy || resolvedHomeWorkflow.language.deckCopy,
      taskControlBar: renderWorkspaceTaskControlBar(resolvedHomeTaskControlBar),
      sessionConsole: renderWorkspaceSessionConsoleSection(resolvedHomeWorkflow.sessionConsole || homeCopilot?.hero?.sessionConsole || homeSessionConsole),
      heroMetrics: homeHeroCards.map((card) => renderMetricCard(card.label, card.value, card.tone, card.detail, { audience: card.audience || 'all' })).join(''),
      cockpitSummary: renderWorkspaceCockpitSummarySection({
        title: resolvedHomeWorkflow.language.cockpitTitle,
        copy: resolvedHomeWorkflow.language.cockpitCopy,
        ...(resolvedHomeWorkflow.cockpitSummary || homeCopilot?.hero?.cockpitSummary || resolvedHomeCockpitSummary),
      }),
      stageSignals: renderWorkspaceSignalBar(resolvedHomeSignalBar),
    }),
    taskControlBar: renderWorkspaceTaskControlBar(resolvedHomeTaskControlBar),
    sessionConsole: renderWorkspaceSessionConsoleSection(resolvedHomeWorkflow.sessionConsole || homeCopilot?.hero?.sessionConsole || homeSessionConsole),
    heroMetrics: homeHeroCards.map((card) => renderMetricCard(card.label, card.value, card.tone, card.detail, { audience: card.audience || 'all' })).join(''),
    cockpitSummary: renderWorkspaceCockpitSummarySection({
      title: resolvedHomeWorkflow.language.cockpitTitle,
      copy: resolvedHomeWorkflow.language.cockpitCopy,
      ...(resolvedHomeWorkflow.cockpitSummary || homeCopilot?.hero?.cockpitSummary || resolvedHomeCockpitSummary),
    }),
    stageSignals: renderWorkspaceSignalBar(resolvedHomeSignalBar),
    relayPanel: [
      renderWorkspaceDialogueStatusSection(finalizedHomeDialogueStatus),
      renderWorkspaceCollaborationSection(resolvedHomeCollaboration),
      renderWorkspaceConfirmationSection({
        title: resolvedHomeWorkflow.language.confirmationTitle,
        copy: resolvedHomeWorkflow.language.confirmationCopy,
        ...resolvedHomeConfirmationState,
      }),
    ].filter(Boolean).join(''),
    modeSwitch: renderPortalModeSwitch({
      title: modeSwitch.title,
      copy: modeSwitch.copy,
      defaultMode: modeSwitch.defaultMode,
      newcomerLabel: modeSwitch.newcomerLabel,
      proLabel: modeSwitch.proLabel,
    }),
    progressRail: renderPortalProgressRail(outputDir, {
      currentPage: shell.currentPage,
      title: String(resolvedHomeProgress?.title || '').trim() || chrome.progressTitle,
      copy: String(resolvedHomeProgress?.copy || '').trim() || chrome.progressCopy,
      visibleIds: Array.isArray(resolvedHomeProgress?.visibleIds) && resolvedHomeProgress.visibleIds.length ? resolvedHomeProgress.visibleIds : undefined,
      windowRadius: surfaceRules.progressWindowRadius,
      governance,
    }),
    routeCompass: renderPortalRouteCompass(outputDir, {
      title: resolvedHomeRoute.title,
      copy: resolvedHomeRoute.copy,
      current: resolvedHomeRoute.current,
      previous: resolvedHomeRoute.previous,
      nextSteps: resolvedHomeRoute.nextSteps,
      maxNextSteps: surfaceRules.routeMaxNextSteps,
    }),
    workbench: renderPortalWorkbench(outputDir, buildRenderableWorkbench({
      section: resolvedHomeWorkbench,
      title: chrome.workbenchTitle,
      copy: chrome.workbenchCopy,
      maxCards: surfaceRules.workbenchMaxCards,
    })),
    mainSections: renderWorkspaceSectionLayout('home', {
      flow: renderWorkspaceFlowSection({ ...homeFlow, mode: 'compact' }),
      judgment: renderWorkspaceJudgmentPanelSection(buildUnifiedWorkflowJudgment({
        stageConfig: {
          title: resolvedHomeWorkflow.language.judgmentTitle,
          copy: resolvedHomeWorkflow.language.judgmentCopy,
        },
        base: {
          ...homeFallbackState.judgmentBase,
          statusLabel: homeNarrative.statusLabel || currentStage,
          statusSummary: homeNarrative.statusSummary || decisionSummary,
          statusTone: issueCount > 0 ? 'warn' : 'good',
          actionLabel: nextTitle,
          actionSummary: nextCopy,
          replyLabel: resolvedHomeConfirmationState.recommendedReply || homeFallbackState.judgmentBase.replyLabel || '继续，按当前主链往下走',
        },
        workflow: resolvedHomeWorkflow.judgment,
        copilot: homeCopilot?.mainline?.judgment,
        view: homeJudgment,
      })),
      stageRelay: renderWorkspaceStageRelaySection(buildUnifiedWorkflowStageRelay(unifiedStatus, {
        workflow: resolvedHomeWorkflow.stageRelay,
        copilot: homeCopilot?.mainline?.stageRelay,
        view: homeStageRelay,
        fallbackCurrentSummary: homeFallbackState.stageRelay.fallbackCurrentSummary || homeNarrative.transitionSummary || nextCopy,
        fallbackNextSummary: homeFallbackState.stageRelay.fallbackNextSummary || homeNarrative.handoffSummary || nextCopy,
      })),
      statusStack: renderWorkspaceStatusStack(resolvedHomeStatusStack),
      timeline: renderWorkspaceTimelineSection(resolvedHomeTimeline),
      assets: [
        renderWorkspaceAssetStatusSection(homeAssetStatus),
        specialWorkflowSection,
      ],
      actions: renderWorkspaceActionStatusSection(finalizedHomeActionStatus),
      specialWorkflow: specialWorkflowSection,
      decision: renderResolvedWorkspaceDecisionSection(resolvedHomeDecision, {
        title: chrome.decisionTitle,
        copy: chrome.decisionCopy,
      }),
      summary: renderResolvedWorkspaceSummarySection(normalizedHomeSummary, {
        title: chrome.summaryTitle,
        copy: chrome.summaryCopy,
      }, {
        defaultEnabled: false,
      }),
      content: homeContentSections,
    }, { currentPage: shell.currentPage }),
  });

  fs.writeFileSync(outputPath, html);
}

main();
