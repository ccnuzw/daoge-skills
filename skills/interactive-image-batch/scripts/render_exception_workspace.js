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
  toArray,
  getWorkspaceStageChrome,
  getWorkspaceStagePhrases,
  getWorkspaceIdentityCopy,
  resolveWorkspaceShellRuntime,
  getWorkspaceActionCopy,
  resolveWorkspaceStageContextBarData,
  resolveWorkspaceStageViewValue,
  resolveWorkspaceStageSection,
  resolveWorkspaceStageStateValue,
  resolveWorkspaceStageSessionConsole,
  resolveWorkspaceStageActionStatus,
  resolveWorkspaceStageDialogueStatus,
  resolveWorkspaceStageConfirmationState,
  buildWorkspaceHeroCardsData,
  renderMetricCard,
  renderWorkspaceFlowSection,
  renderWorkspaceConfirmationSection,
  renderWorkspaceDialogueStatusSection,
  renderWorkspaceTimelineSection,
  adaptWorkflowCopilot,
  renderWorkspaceAssetStatusSection,
  renderWorkspaceActionStatusSection,
  buildWorkspaceSummarySectionData,
  buildWorkspaceStageGuideFallback,
  buildWorkspaceStageVisibilityFallback,
  buildWorkspaceDecisionItems,
  buildWorkspaceStageFallbackBundle,
  buildWorkspaceDecisionSectionData,
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
  renderWorkspaceTransitionStatusSection,
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
  buildWorkspaceIssuesSectionData,
  resolveWorkspaceGuideSectionData,
  resolveWorkspaceIssuesSectionData,
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
  getStagePrimaryActionLabel,
  buildUserFacingAssetOverview,
} = require('./workspace_status_dictionary');
const { getWorkspaceDenseCopy } = require('./workspace_dense_copy');
const { loadWorkbenchState } = require('./workbench_state_shared');
const {
  resolveWorkspaceRouteFile,
  shouldShowStoryboardPage,
} = require('./workspace_storyboard_shared');
const {
  buildExceptionStatusStack,
  buildExceptionTaskControlBar,
  buildExceptionSignalBar,
} = require('./workspace_status_dictionary');

function modeLabel(mode) {
  if (mode === 'masked-edit') return '局部编辑';
  if (mode === 'prompt-only') return '直接生图';
  return mode || '未标注';
}

function renderIssueCard(item, tone, fallbackTitle, sectionCopy = {}) {
  const normalizedSection = buildWorkspaceIssuesSectionData(sectionCopy);
  const title = item.title || item.shotLabel || item.slotId || fallbackTitle;
  const summary = tone === 'bad'
    ? (item.error || normalizedSection.failedFallbackSummary)
    : (item.reason || normalizedSection.reviewFallbackSummary);
  const compactSummary = String(summary || '').trim().length > 52
    ? `${String(summary || '').trim().slice(0, 52).trim()}…`
    : String(summary || '').trim();
  const tags = [
    item.slotId ? `槽位 ${item.slotId}` : null,
    modeLabel(item.requestMode),
    tone === 'bad' ? '失败' : '待复核',
  ].filter(Boolean).slice(0, 2);
  return `
    <article class="issue-card">
      <h3 class="issue-title">${title}</h3>
      <p class="issue-copy">${compactSummary}</p>
      <ul class="info-list">${tags.map((tag) => `<li>${tag}</li>`).join('')}</ul>
    </article>
  `;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function mergeUniqueHints(...groups) {
  const seen = new Set();
  return groups.flatMap((group) => toArray(group))
    .map((item) => String(item || '').trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
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
  if (!args['manifest-file']) throw new Error('Missing required flag: --manifest-file');

  const manifestPath = path.resolve(args['manifest-file']);
  const manifest = readJson(manifestPath);
  const outputDir = path.resolve(manifest.outputDir || path.dirname(manifestPath));
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'exception_workspace.html'));

  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};
  const workspaceAssets = workbenchState.workspaceAssets || {};
  const workspaceTimeline = workbenchState.workspaceTimeline || {};
  const exceptionPageData = pageState?.pageData?.exception || {};
  const pageMetrics = exceptionPageData?.metrics || {};
  const assetSummary = workspaceAssets?.summary || {};
  const artifactLayer = summarizeArtifactLayer(pageState?.artifactGovernance || {});
  const exceptionFallbackGuide = buildWorkspaceFallbackGuide('exception', artifactLayer);
  const workbenchGuide = pageState?.workbenchGuide?.exception || null;
  const assetGuide = pageState?.assetVisibilityGuide?.exception || null;
  const exceptionView = pageState?.views?.exception || {};
  const stateGuides = exceptionView?.guides || {};
  const entryGuide = stateGuides.entryStructure || workbenchGuide?.section || null;
  const visibilityGuide = stateGuides.assetVisibility || assetGuide || null;
  const fallbackEntryGuide = exceptionFallbackGuide.guide;
  const fallbackAssetGuide = exceptionFallbackGuide.visibility;
  const guideCards = Array.isArray(workbenchGuide?.cards) && workbenchGuide.cards.length
    ? workbenchGuide.cards
    : [];
  const denseCopy = getWorkspaceDenseCopy('exception');
  const {
    shell,
    governance: governanceForShell,
    layout,
    surfaceRules,
    governedWorkbenchIds,
    optionalSurface,
    modeSwitch,
  } = resolveWorkspaceShellRuntime(pageState, 'exception', exceptionView);

  const workspaceHomePath = resolveWorkspaceRouteFile(outputDir, pageState, 'home', path.join(outputDir, 'workspace_home.html'));
  const resultWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'result', path.join(outputDir, 'result_workspace.html'));
  const storyboardPath = resolveWorkspaceRouteFile(outputDir, pageState, 'storyboard', path.join(outputDir, 'storyboard_board.html'));

  const exceptionItems = Array.isArray(exceptionPageData?.exceptionItems) && exceptionPageData.exceptionItems.length
    ? exceptionPageData.exceptionItems
    : readAssetCollection(workspaceAssets, 'exception');
  const reviewAssets = Array.isArray(exceptionPageData?.reviewItems) && exceptionPageData.reviewItems.length
    ? exceptionPageData.reviewItems
    : readAssetCollection(workspaceAssets, 'review');
  const hasStoryboard = optionalSurface.showStoryboardEntry !== undefined
    ? Boolean(optionalSurface.showStoryboardEntry)
    : shouldShowStoryboardPage({
      outputDir,
      workspaceState: pageState,
      storyboardPath,
      manifest,
      failedItems: exceptionItems,
      reviewItems: reviewAssets,
    });
  const sourceSummary = pageState?.sourceSummary || {};
  const sourceCounts = sourceSummary?.counts || {};
  const sourceAssets = sourceSummary?.assets || {};
  const exceptionSummary = pageState?.exception || {};
  const failedCount = Number(pageMetrics.failedCount || sourceCounts.failed || pageState?.counts?.failed || sourceAssets.exceptionCount || assetSummary.exceptionCount || exceptionItems.length || 0);
  const reviewCount = Number(pageMetrics.reviewCount || sourceCounts.needsReview || pageState?.counts?.needsReview || sourceAssets.reviewCount || assetSummary.reviewCount || reviewAssets.length || 0);
  const rerunCount = Number(pageMetrics.rerunCount || exceptionSummary?.rerunCount || 0);
  const totalIssueCount = failedCount + reviewCount;
  const selectedCount = Number(sourceCounts.selected || pageState?.counts?.selected || manifest.selectedCount || failedCount + reviewCount || 0);
  const exceptionHero = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'hero', {});
  const exceptionContext = exceptionView?.context || {};
  const exceptionFlow = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'flow', {});
  const exceptionAssetStatus = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'assetStatus', {});
  const exceptionActionStatus = resolveWorkspaceStageActionStatus(pageState, 'exception', exceptionView);
  const exceptionDialogueStatus = resolveWorkspaceStageDialogueStatus(pageState, 'exception', exceptionView);
  const exceptionCopilot = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'copilot', {});
  const unifiedExceptionStatus = exceptionSummary?.unifiedStatus && typeof exceptionSummary.unifiedStatus === 'object'
    ? exceptionSummary.unifiedStatus
    : {};
  const runtimeSummary = pageState?.runtimeSummary && typeof pageState.runtimeSummary === 'object'
    ? pageState.runtimeSummary
    : {};
  const runtimeCopilotSummary = runtimeSummary.copilotSummary && typeof runtimeSummary.copilotSummary === 'object'
    ? runtimeSummary.copilotSummary
    : {};
  const exceptionWorkflowCopilot = pageState?.workflowSessions?.exception || resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'workflowCopilot', {});
  const exceptionWorkflowContract = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'workflowContract', pageState?.workflowContracts?.exception || {});
  const exceptionControlRail = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'controlRail', {});
  const exceptionSessionConsole = resolveWorkspaceStageSessionConsole(pageState, 'exception', exceptionView);
  const exceptionConfirmationState = resolveWorkspaceStageConfirmationState(
    pageState,
    'exception',
    exceptionView,
    exceptionSummary.confirmation || exceptionPageData.confirmation || exceptionSummary.confirmationState || pageState?.exception?.confirmationState || {}
  );
  const stateExceptionCockpitSummary = resolveWorkspaceStageStateValue(pageState, 'exception', exceptionPageData, exceptionSummary, 'cockpitSummary', null);
  const stateExceptionJudgment = resolveWorkspaceStageStateValue(pageState, 'exception', exceptionPageData, exceptionSummary, 'judgment', null);
  const stateExceptionStatusStack = toArray(exceptionPageData.statusStack).length
    ? exceptionPageData.statusStack
    : (toArray(exceptionSummary.statusStack).length ? exceptionSummary.statusStack : []);
  const stateExceptionDecision = resolveWorkspaceStageStateValue(pageState, 'exception', exceptionPageData, exceptionSummary, 'decision', null);
  const stateExceptionSummarySection = resolveWorkspaceStageStateValue(pageState, 'exception', exceptionPageData, exceptionSummary, 'summary', null);
  const stateExceptionCollaboration = resolveWorkspaceStageStateValue(pageState, 'exception', exceptionPageData, exceptionSummary, 'collaboration', null);
  const exceptionFallbackState = buildStageWorkspaceFallbackState('exception', {
    failedCount,
    reviewCount,
    totalIssueCount,
    currentPhaseConclusion: String(unifiedExceptionStatus.conclusion || pageState?.status?.headline || '').trim(),
    currentPhaseSummary: String(unifiedExceptionStatus.progress || pageState?.status?.summary || '').trim(),
    currentFocus: String(exceptionSummary.currentFocus || '').trim(),
    statusLabel: String(exceptionSummary.statusLabel || '').trim(),
    statusSummary: String(exceptionSummary.statusSummary || '').trim(),
    statusTone: String(exceptionSummary.statusTone || '').trim(),
    nextActionLabel: String(exceptionSummary.nextStepLabel || '').trim(),
    nextActionReason: String(exceptionSummary.nextStepReason || exceptionSummary.actionSummary || '').trim(),
    transitionSummary: String(exceptionSummary.transitionSummary || exceptionSummary.actionSummary || '').trim(),
    handoffSummary: String(exceptionSummary.handoffSummary || '').trim(),
    issueSummary: String(exceptionSummary.issueSummary || '').trim(),
    confirmationState: exceptionConfirmationState,
  });
  const exceptionActionSummary = String(exceptionSummary.actionSummary || '').trim()
    || (failedCount > 0 ? '建议先处理失败项，再决定是否补跑。' : '建议先确认这些问题是否还会影响工作台后续判断。');
  const stagePhrases = getWorkspaceStagePhrases('exception');
  const exceptionNarrative = resolveUnifiedStageNarrative(unifiedExceptionStatus, {
    summarySource: exceptionSummary,
    ...exceptionFallbackState.narrative,
  });
  const exceptionCurrentFocus = exceptionNarrative.currentFocus;
  const exceptionStageSummary = exceptionNarrative.stageSummary;
  const exceptionNextStepLabel = String(exceptionSummary.nextStepLabel || '').trim();
  const exceptionNextStepReason = String(exceptionSummary.nextStepReason || '').trim();
  const issueSummary = exceptionNarrative.issueSummary;
  const exceptionTransitionSummary = firstNonEmpty(exceptionNarrative.transitionSummary, exceptionNextStepReason, exceptionActionSummary, issueSummary);
  const exceptionHandoffSummary = firstNonEmpty(exceptionNarrative.handoffSummary, exceptionTransitionSummary);
  const exceptionPrimaryAction = exceptionSummary.primaryAction && typeof exceptionSummary.primaryAction === 'object'
    ? exceptionSummary.primaryAction
    : null;
  const exceptionSecondaryHints = toArray(exceptionSummary.secondaryActionHints);
  const resolvedNextAction = resolveUnifiedNextAction(unifiedExceptionStatus, {
    label: exceptionNextStepLabel,
    reason: exceptionNextStepReason,
    fallbackLabel: getStagePrimaryActionLabel('exception', { failedCount }),
    fallbackReason: exceptionActionSummary || String(unifiedExceptionStatus.progress || pageState?.status?.summary || '').trim() || issueSummary,
    fallbackTarget: 'workspace_home.html',
  });
  const nextActionLabel = resolvedNextAction.label;
  const nextActionReason = resolvedNextAction.reason;
  const visibleNextActionSummary = [runtimeCopilotSummary.nextActionSummary, exceptionNextStepReason, nextActionReason]
    .map((item) => String(item || '').trim())
    .filter((item, index, list) => item && list.indexOf(item) === index)
    .join(' ');
  const nextActionPath = resolvedNextAction.target
    ? path.join(outputDir, resolvedNextAction.target)
    : workspaceHomePath;
  const exceptionTaskControlBar = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'taskControlBar', null);
  const exceptionSignalBar = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'signalBar', null);
  const exceptionTimeline = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'timeline', null);
  const exceptionStageRelay = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'stageRelay', null);
  const resolvedExceptionTimeline = exceptionTimeline
    || exceptionPageData?.sections?.timeline
    || buildWorkspaceFallbackTimeline('exception', {
      events: Array.isArray(exceptionPageData?.timelineEvents) && exceptionPageData.timelineEvents.length
        ? exceptionPageData.timelineEvents
        : null,
      workspaceTimelineEvents: workspaceTimeline?.events,
    });
  const resolvedExceptionProgress = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'progress', null);
  const resolvedExceptionActionStatus = {
    ...buildActionStatusFromUnifiedStatus(unifiedExceptionStatus, {
      base: exceptionActionStatus,
      copilotSummary: runtimeCopilotSummary,
      confirmationReply: exceptionConfirmationState.recommendedReply,
      confirmationSummary: exceptionConfirmationState.summary,
      dialogueNextSayItems: exceptionDialogueStatus.nextSayItems,
      nextActionSummary: nextActionReason || String(exceptionConfirmationState.summary || '').trim(),
      defaultActionReason: stagePhrases.actionReason,
    }),
    primary: exceptionActionStatus.primary || (exceptionPrimaryAction ? {
      kicker: '现在先做',
      title: String(exceptionPrimaryAction.label || '').trim() || nextActionLabel,
      summary: String(exceptionPrimaryAction.summary || '').trim() || nextActionReason,
      cta: String(exceptionPrimaryAction.cta || '').trim() || undefined,
      tone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
    } : null),
    notes: toArray(exceptionActionStatus.notes).length ? exceptionActionStatus.notes : exceptionSecondaryHints,
  };
  const resolvedExceptionDialogueStatus = buildDialogueStatusFromUnifiedStatus(unifiedExceptionStatus, {
    base: exceptionDialogueStatus,
    copilotSummary: runtimeCopilotSummary,
    confirmationReply: exceptionConfirmationState.recommendedReply,
    confirmationSummary: exceptionConfirmationState.summary,
    nextActionSummary: nextActionReason || String(exceptionConfirmationState.summary || '').trim(),
    defaultActionReason: stagePhrases.dialogueActionReason,
  });
  const currentPhaseLabel = String(unifiedExceptionStatus.stage || pageState?.status?.phase || '').trim() || '异常阶段';
  const currentPhaseSummary = String(unifiedExceptionStatus.progress || pageState?.status?.summary || '').trim();
  const currentPhaseConclusion = String(unifiedExceptionStatus.conclusion || pageState?.status?.headline || '').trim();
  const resolvedExceptionWorkflow = adaptWorkflowCopilot(exceptionWorkflowCopilot, {
    stageKey: 'exception',
    stageLabel: currentPhaseLabel,
    taskControlBar: exceptionTaskControlBar,
    sessionConsole: exceptionSessionConsole,
    signalBar: exceptionSignalBar,
    statusStack: stateExceptionStatusStack,
    cockpitSummary: stateExceptionCockpitSummary,
    dialogueStatus: resolvedExceptionDialogueStatus,
    confirmation: exceptionConfirmationState,
    timeline: exceptionTimeline,
    judgment: stateExceptionJudgment,
    stageRelay: exceptionStageRelay,
  });
  const exceptionContractState = buildWorkflowContractPageState(exceptionWorkflowContract, {
    taskControlBar: resolvedExceptionWorkflow.taskControlBar,
    dialogueStatus: resolvedExceptionDialogueStatus,
    confirmation: exceptionConfirmationState,
    sessionConsole: resolvedExceptionWorkflow.sessionConsole || exceptionSessionConsole,
    progressTone: totalIssueCount > 0 ? 'warn' : 'good',
  });
  const finalizedExceptionActionStatus = finalizeWorkspaceActionStatus(resolvedExceptionActionStatus, resolvedExceptionWorkflow);
  const finalizedExceptionDialogueStatus = finalizeCollaborationPromptState(resolvedExceptionDialogueStatus, {
    contractDialogue: exceptionContractState.dialogueStatus,
    confirmationReply: exceptionConfirmationState.recommendedReply,
    confirmationSummary: exceptionConfirmationState.summary,
    defaultActionReason: resolvedExceptionWorkflow.language.dialogueActionReason,
  });
  const exceptionTransitionStatus = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'transitionStatus', {});
  const exceptionHandoffFromPrevious = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'handoffFromPrevious', exceptionTransitionStatus || {});
  const exceptionHandoffToNext = resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'handoffToNext', {});
  const resolvedExceptionStageRelay = buildUnifiedWorkflowStageRelay(
    unifiedExceptionStatus,
    {
      workflow: resolvedExceptionWorkflow.stageRelay,
      copilot: exceptionCopilot?.mainline?.stageRelay,
      view: exceptionStageRelay,
      fallbackCurrentSummary: firstNonEmpty(
        exceptionFallbackState.stageRelay.fallbackCurrentSummary,
        exceptionTransitionSummary,
        issueSummary
      ),
      fallbackNextSummary: firstNonEmpty(
        exceptionFallbackState.stageRelay.fallbackNextSummary,
        exceptionHandoffSummary,
        exceptionTransitionSummary
      ),
    }
  );
  const exceptionGuideSection = resolveWorkspaceStageSection(pageState, 'exception', exceptionView, exceptionPageData, 'guide');
  const exceptionVisibilitySection = resolveWorkspaceStageSection(pageState, 'exception', exceptionView, exceptionPageData, 'visibility');
  const exceptionIssuesSection = resolveWorkspaceStageSection(pageState, 'exception', exceptionView, exceptionPageData, 'issues');
  const exceptionRerunSection = resolveWorkspaceStageSection(pageState, 'exception', exceptionView, exceptionPageData, 'rerun');
  const normalizedExceptionGuideSection = resolveWorkspaceGuideSectionData(
    exceptionGuideSection,
    buildWorkspaceStageGuideFallback('exception', {
      entryGuideTitle: entryGuide?.title || fallbackEntryGuide?.title,
      entryGuideItems: entryGuide?.items || fallbackEntryGuide?.items,
      guideCopy: entryGuide?.copy || fallbackEntryGuide?.copy,
    })
  );
  const normalizedExceptionVisibilitySection = resolveWorkspaceGuideSectionData(
    exceptionVisibilitySection,
    buildWorkspaceStageVisibilityFallback('exception', {
      visibilityTitle: visibilityGuide?.title || fallbackAssetGuide?.title,
      visibilityCopy: visibilityGuide?.copy || fallbackAssetGuide?.copy,
      visibilityItems: visibilityGuide?.items || fallbackAssetGuide?.items,
    })
  );
  const normalizedExceptionIssuesSection = resolveWorkspaceIssuesSectionData(
    exceptionIssuesSection,
    exceptionIssuesSection
  );
  const displayIssueItems = Array.isArray(normalizedExceptionIssuesSection.items) && normalizedExceptionIssuesSection.items.length
    ? normalizedExceptionIssuesSection.items.slice(0, 16)
    : [
      ...exceptionItems.slice(0, 8).map((item) => ({ ...item, issueTone: 'bad', issueType: '失败项' })),
      ...reviewAssets.slice(0, 8).map((item) => ({ ...item, issueTone: 'warn', issueType: '待复核' })),
    ].slice(0, 16);
  const statusLabel = exceptionNarrative.statusLabel;
  const statusTone = String(exceptionSummary.statusTone || pageState?.status?.tone || '').trim()
    || (totalIssueCount > 0 ? 'bad' : 'good');
  const statusSummary = exceptionNarrative.statusSummary || exceptionStageSummary;
  const exceptionTextDefaults = buildWorkflowTextDefaults({
    copilotSummary: runtimeCopilotSummary,
    nextActionSummary: visibleNextActionSummary || String(exceptionConfirmationState.summary || '').trim() || issueSummary,
    nextActionReason,
    recommendedReply: runtimeCopilotSummary.recommendedReply || exceptionConfirmationState.recommendedReply,
    primarySay: runtimeCopilotSummary.recommendedReply || finalizedExceptionDialogueStatus.primarySay,
    progressSummary: runtimeCopilotSummary.progressSummary || statusSummary || nextActionReason || issueSummary || '',
    statusSummary: runtimeCopilotSummary.conclusion || statusSummary,
    confirmationSummary: exceptionConfirmationState.summary,
    issueSummary,
    continuationLabel: getStageContinuationCopy('exception'),
  });
  const userFacingAssetOverview = buildWorkspaceFallbackAssetOverview({
    stageKey: 'exception',
    reviewCount,
    exceptionCount: failedCount,
    overviewBuilder: buildUserFacingAssetOverview,
  }).overview;
  const chrome = getWorkspaceStageChrome('exception');
  const actionCopy = getWorkspaceActionCopy();
  const identity = getWorkspaceIdentityCopy();
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount,
    sampleSize: Number(manifest?.sampleSize || 0),
    pauseReason: manifest?.pauseReason || '',
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const resolvedExceptionCockpitSummary = buildUnifiedWorkflowCockpitSummary({
    base: stateExceptionCockpitSummary,
    workflow: resolvedExceptionWorkflow.cockpitSummary,
    copilot: exceptionCopilot?.hero?.cockpitSummary,
    view: resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'cockpitSummary', null),
    items: exceptionFallbackState.cockpitItems,
  });
  const resolvedExceptionJudgment = buildUnifiedWorkflowJudgment({
    stageConfig: {
      title: resolvedExceptionWorkflow.language.judgmentTitle,
      copy: resolvedExceptionWorkflow.language.judgmentCopy,
    },
    base: exceptionFallbackState.judgmentBase,
    baseState: stateExceptionJudgment,
    copilot: exceptionCopilot?.mainline?.judgment,
    workflow: resolvedExceptionWorkflow.judgment,
    view: resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'judgment', null),
  });
  const resolvedExceptionDecision = buildUnifiedWorkflowDecision({
    stageConfig: {
      title: chrome.decisionTitle,
      copy: chrome.decisionCopy,
    },
    base: buildWorkspaceDecisionSectionData({
      items: buildWorkspaceDecisionItems({
        reasonValue: exceptionCurrentFocus,
        riskValue: nextActionReason || (totalIssueCount > 0 ? '这些问题会继续卡住工作台后续判断，或影响结果稳定度。' : '当前主要风险不在异常层，而在是否还需要回结果工作台复核。'),
        pageValue: exceptionStageSummary || resolvedExceptionWorkflow.language.pagePurpose,
      }),
    }),
    state: stateExceptionDecision,
    view: resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'decision', null),
  });
  const resolvedExceptionSummary = resolveWorkspaceStageSummarySection(
    pageState,
    'exception',
    {
      ...exceptionView,
      summary: exceptionView?.summary || stateExceptionSummarySection || {},
    },
    buildWorkspaceSummarySectionData({
      enabled: layout.showSummaryByDefault,
      title: chrome.summaryTitle,
      copy: chrome.summaryCopy,
      items: [
        { label: '当前阶段', value: unifiedExceptionStatus.stage || currentPhaseLabel },
        { label: '当前结论', value: unifiedExceptionStatus.conclusion || statusLabel },
        { label: '结果概况', value: userFacingAssetOverview.summary },
        { label: '当前重点', value: unifiedExceptionStatus.currentFocus || exceptionCurrentFocus },
        { label: '下一步', value: unifiedExceptionStatus.nextAction?.label || nextActionLabel },
        { label: '为什么先做这一步', value: unifiedExceptionStatus.nextAction?.reason || nextActionReason || issueSummary },
      ],
    })
  );
  const resolvedExceptionConfirmationState = buildUnifiedWorkflowConfirmation(unifiedExceptionStatus, {
    fallback: exceptionContractState.confirmation || exceptionConfirmationState,
  });
  const resolvedExceptionTaskControlBar = finalizeTaskControlBar(
    exceptionContractState.taskControlBar
    || resolvedExceptionWorkflow.taskControlBar
    || exceptionCopilot?.hero?.taskControlBar
    || exceptionControlRail.taskControlBar
    || exceptionTaskControlBar
    || buildTaskControlBarFromUnifiedStatus(unifiedExceptionStatus, {
      copilotSummary: runtimeCopilotSummary,
      taskLabel,
      stageLabel: currentPhaseLabel,
      nextActionLabel,
      nextActionSummary: exceptionTextDefaults.nextActionSummary,
      primarySay: exceptionTextDefaults.primarySay,
      progressLabel: stagePhrases.progressLabel,
      progressSummary: exceptionTextDefaults.progressSummary,
      progressTone: statusTone || (totalIssueCount > 0 ? 'warn' : 'good'),
    })
    || buildExceptionTaskControlBar({
    taskLabel,
    stageLabel: currentPhaseLabel,
    statusLabel,
    statusTone,
    totalIssueCount,
    failedCount,
    nextActionLabel,
    nextActionSummary: nextActionReason || String(exceptionConfirmationState.summary || '').trim() || issueSummary,
  }), {
    preferOptionFields: ['statusSummary', 'nextActionLabel', 'nextActionSummary', 'progressLabel', 'progressSummary'],
    nextActionLabel,
    forcePrimarySay: '',
    progressLabel: stagePhrases.progressLabel,
    progressSummary: exceptionTextDefaults.progressSummary,
    progressTone: statusTone || (totalIssueCount > 0 ? 'warn' : 'good'),
    nextActionTone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
    nextActionSummary: visibleNextActionSummary,
  });
  const resolvedExceptionSignalBar = resolvedExceptionWorkflow.signalBar
    || exceptionCopilot?.hero?.signalBar
    || exceptionControlRail.signalBar
    || (Array.isArray(exceptionSignalBar) ? { items: exceptionSignalBar } : exceptionSignalBar)
    || {
      items: buildExceptionSignalBar({
        stageLabel: currentPhaseLabel,
        statusLabel,
        statusSummary: exceptionTextDefaults.statusSummary,
        statusTone,
        failedCount,
        nextActionLabel,
        nextActionSummary: exceptionTextDefaults.nextActionSummary,
        replyLabel: exceptionTextDefaults.replyLabel,
      }),
    };
  const resolvedExceptionStatusStack = buildUnifiedWorkflowStatusStack({
    workflow: resolvedExceptionWorkflow.statusStack,
    copilot: exceptionCopilot?.mainline?.statusStack,
    controlRail: exceptionControlRail.statusStack,
    stateItems: stateExceptionStatusStack,
    fallbackBuilder: () => buildExceptionStatusStack({
      statusLabel,
      statusSummary: exceptionTextDefaults.statusSummary,
      statusTone,
      totalIssueCount,
      failedCount,
      issueSummary,
      nextActionLabel,
      nextActionSummary: exceptionTextDefaults.nextActionSummary,
    }),
  });
  const resolvedExceptionCollaboration = buildUnifiedWorkflowCollaboration(unifiedExceptionStatus, {
    base: exceptionContractState.collaboration || stateExceptionCollaboration,
    workflow: resolvedExceptionWorkflow.collaboration,
    view: resolveWorkspaceStageViewValue(pageState, 'exception', exceptionView, 'collaboration', null),
    confirmation: resolvedExceptionConfirmationState,
    timeline: resolvedExceptionTimeline,
    dialogue: finalizedExceptionDialogueStatus,
  });
  const normalizedExceptionSummary = buildWorkspaceSummarySectionData(resolvedExceptionSummary || {});
  const exceptionContentSections = renderWorkspaceDeclaredSections(
    resolveWorkspaceStageContentSectionPlan(
      pageState,
      'exception',
      exceptionView,
      denseCopy.contentSectionOrder.map((key) => ({
        key,
        kind: key === 'issues' ? 'issuesGrid' : 'keyValue',
        enabled: key === 'rerun' ? Array.isArray(exceptionRerunSection.items) && exceptionRerunSection.items.length > 0 : true,
      }))
    ),
    {
      ...buildCommonDeclaredSectionRenderers({
        guide: normalizedExceptionGuideSection,
        visibility: normalizedExceptionVisibilitySection,
      }),
      issues: () => renderWorkspaceGridSection({
        title: normalizedExceptionIssuesSection.title,
        copy: normalizedExceptionIssuesSection.copy,
        gridClass: 'issue-grid',
        extraClass: 'workspace-primary-panel workspace-primary-focus',
        itemsHtml: displayIssueItems.map((item, index) => renderIssueCard(
          item,
          item.issueTone || (item.issueType === '待复核' ? 'warn' : 'bad'),
          `${item.issueType || '问题项'} ${index + 1}`,
          normalizedExceptionIssuesSection
        )),
        emptyText: normalizedExceptionIssuesSection.emptyText,
      }),
      rerun: () => renderWorkspaceKeyValueSection({
        title: denseCopy.rerunSectionTitle || String(exceptionRerunSection.title || '').trim(),
        copy: denseCopy.rerunSectionCopy || String(exceptionRerunSection.copy || '').trim(),
        extraClasses: ['workspace-primary-panel'],
        items: Array.isArray(exceptionRerunSection.items) ? exceptionRerunSection.items : [],
      }),
    }
  );
  const exceptionFallbackBundle = buildWorkspaceStageFallbackBundle('exception', {
    denseCopy,
    runLabel: taskLabel,
    phaseLabel: currentPhaseLabel,
    flowLabel: identity.flows.exception,
    countValues: {
      focus: exceptionCurrentFocus,
      status: statusLabel,
      next: nextActionLabel,
      pressure: totalIssueCount > 0 ? '还有问题待处理' : '当前平稳',
    },
    hasIssue: totalIssueCount > 0,
    stageSummary: exceptionStageSummary,
    currentFocus: exceptionCurrentFocus,
    nextActionReason: nextActionReason || '问题判断清楚后，就回主链继续，不把这页当默认入口。',
    extraHints: exceptionContext.hints,
    resultValue: totalIssueCount > 0 ? '回去复核' : '回工作台继续',
    resultSummary: '问题判断完后，再回结果工作台继续取舍。',
    resultFile: resultWorkspacePath,
    resultCta: actionCopy.returnResult,
    includeStoryboard: hasStoryboard && path.resolve(workspaceHomePath) !== path.resolve(storyboardPath),
    storyboardFile: storyboardPath,
    storyboardCta: actionCopy.openStoryboard,
    routeTitle: chrome.routeTitle,
    routeCopy: chrome.routeCopy,
    currentLabel: statusLabel,
    previousFile: resultWorkspacePath,
    previousCta: actionCopy.returnResult,
    nextLabel: nextActionLabel || '工作台首页',
    nextSummary: nextActionReason || '如果问题已经判断清楚，就回工作台首页继续，不把按需页面当成默认下一步。',
    nextFile: nextActionPath,
    nextCta: path.resolve(nextActionPath) === path.resolve(workspaceHomePath)
      ? actionCopy.returnHome
      : actionCopy.enterNow,
    workbenchTitle: chrome.workbenchTitle,
    workbenchCopy: chrome.workbenchCopy,
    extraWorkbenchCards: guideCards,
  });
  const fallbackWorkbenchCards = exceptionFallbackBundle.workbench.cards
    .filter(Boolean)
    .filter((card) => !governedWorkbenchIds || !card.id || governedWorkbenchIds.has(card.id));
  const resolvedExceptionWorkbench = resolveWorkspaceStageWorkbenchSection(
    pageState,
    'exception',
    exceptionView,
    { ...exceptionFallbackBundle.workbench, cards: fallbackWorkbenchCards }
  );
  const resolvedExceptionRoute = resolveWorkspaceStageRouteSection(
    pageState,
    'exception',
    exceptionView,
    exceptionFallbackBundle.route
  );

  const exceptionHeroCards = Array.isArray(exceptionView?.heroCards) ? exceptionView.heroCards : [];
  const contextBarData = resolveWorkspaceStageContextBarData(pageState, 'exception', exceptionView, exceptionFallbackBundle.context);
  const contextBar = renderPortalContextBar(contextBarData);

  const html = renderWorkspacePageShell({
    pageTitle: shell.pageTitle,
    currentPage: shell.currentPage,
    headAssets: renderPortalHeadAssets(),
    cssVars: shell.cssVars,
    topLinks: renderPortalTopLinks(outputDir, { currentPage: shell.currentPage, governance: governanceForShell }),
    heroEyebrow: String(exceptionHero.eyebrow || '').trim() || shell.heroEyebrow,
    heroTitle: String(exceptionHero.title || '').trim() || shell.heroTitle,
    heroCopy: String(exceptionHero.intro || '').trim() || shell.heroCopy,
    contextBar,
    copilotDeck: renderWorkspaceCopilotDeck({
      title: exceptionCopilot?.title || resolvedExceptionWorkflow.language.deckTitle,
      copy: exceptionCopilot?.copy || resolvedExceptionWorkflow.language.deckCopy,
      taskControlBar: renderWorkspaceTaskControlBar(resolvedExceptionTaskControlBar),
      sessionConsole: renderWorkspaceSessionConsoleSection(resolvedExceptionWorkflow.sessionConsole || exceptionCopilot?.hero?.sessionConsole || exceptionSessionConsole),
      heroMetrics: exceptionHeroCards.map((card) => renderMetricCard(card.label, card.value, card.tone, card.detail)).join(''),
      cockpitSummary: renderWorkspaceCockpitSummarySection({
        title: resolvedExceptionWorkflow.language.cockpitTitle,
        copy: resolvedExceptionWorkflow.language.cockpitCopy,
        ...resolvedExceptionCockpitSummary,
      }),
      stageSignals: renderWorkspaceSignalBar(resolvedExceptionSignalBar),
      relayPanel: [
        renderWorkspaceDialogueStatusSection({
          ...finalizedExceptionDialogueStatus,
          showCopyButton: false,
        }),
        renderWorkspaceCollaborationSection(resolvedExceptionCollaboration),
        renderWorkspaceConfirmationSection({
          title: resolvedExceptionWorkflow.language.confirmationTitle,
          copy: resolvedExceptionWorkflow.language.confirmationCopy,
          ...resolvedExceptionConfirmationState,
        }),
      ].filter(Boolean).join(''),
    }),
    taskControlBar: renderWorkspaceTaskControlBar(resolvedExceptionTaskControlBar),
    sessionConsole: renderWorkspaceSessionConsoleSection(resolvedExceptionWorkflow.sessionConsole || exceptionCopilot?.hero?.sessionConsole || exceptionSessionConsole),
    heroMetrics: exceptionHeroCards.map((card) => renderMetricCard(card.label, card.value, card.tone, card.detail)).join(''),
    cockpitSummary: renderWorkspaceCockpitSummarySection({
      title: resolvedExceptionWorkflow.language.cockpitTitle,
      copy: resolvedExceptionWorkflow.language.cockpitCopy,
      ...resolvedExceptionCockpitSummary,
    }),
    stageSignals: renderWorkspaceSignalBar(resolvedExceptionSignalBar),
    modeSwitch: renderPortalModeSwitch({
      title: modeSwitch.title,
      copy: modeSwitch.copy,
      defaultMode: modeSwitch.defaultMode,
      newcomerLabel: modeSwitch.newcomerLabel,
      proLabel: modeSwitch.proLabel,
    }),
    progressRail: renderPortalProgressRail(outputDir, {
      currentPage: shell.currentPage,
      title: String(resolvedExceptionProgress?.title || '').trim() || chrome.progressTitle,
      copy: String(resolvedExceptionProgress?.copy || '').trim() || chrome.progressCopy,
      visibleIds: Array.isArray(resolvedExceptionProgress?.visibleIds) && resolvedExceptionProgress.visibleIds.length ? resolvedExceptionProgress.visibleIds : undefined,
      windowRadius: surfaceRules.progressWindowRadius,
      governance: governanceForShell,
    }),
    routeCompass: renderPortalRouteCompass(outputDir, {
      title: resolvedExceptionRoute.title,
      copy: resolvedExceptionRoute.copy,
      current: resolvedExceptionRoute.current,
      previous: resolvedExceptionRoute.previous,
      nextSteps: resolvedExceptionRoute.nextSteps,
      maxNextSteps: surfaceRules.routeMaxNextSteps,
    }),
    workbench: renderPortalWorkbench(outputDir, buildRenderableWorkbench({
      section: resolvedExceptionWorkbench,
      title: chrome.workbenchTitle,
      copy: chrome.workbenchCopy,
      maxCards: surfaceRules.workbenchMaxCards,
    })),
    mainSections: renderWorkspaceSectionLayout('exception', {
      flow: renderWorkspaceFlowSection(exceptionFlow),
      judgment: renderWorkspaceJudgmentPanelSection(resolvedExceptionJudgment),
      stageRelay: renderWorkspaceStageRelaySection(resolvedExceptionStageRelay),
      statusStack: renderWorkspaceStatusStack(resolvedExceptionStatusStack),
      timeline: renderWorkspaceTimelineSection(resolvedExceptionTimeline),
      assets: renderWorkspaceAssetStatusSection(exceptionAssetStatus),
      actions: renderWorkspaceActionStatusSection(finalizedExceptionActionStatus),
      transitions: renderWorkspaceTransitionStatusSection({
        ...exceptionHandoffToNext,
        copy: firstNonEmpty(exceptionHandoffToNext.copy, exceptionTransitionSummary),
      }),
      decision: renderResolvedWorkspaceDecisionSection(resolvedExceptionDecision, {
        title: chrome.decisionTitle,
        copy: chrome.decisionCopy,
      }),
      summary: renderResolvedWorkspaceSummarySection(normalizedExceptionSummary, {
        title: chrome.summaryTitle,
        copy: chrome.summaryCopy,
      }, {
        defaultEnabled: false,
      }),
      content: exceptionContentSections,
    }, { currentPage: shell.currentPage }),
  });

  fs.writeFileSync(outputPath, html);
}

main();
