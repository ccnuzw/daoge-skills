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
  buildWorkspaceContextFallback,
  resolveWorkspaceStageContextBarData,
  resolveWorkspaceStageViewValue,
  resolveWorkspaceStageSection,
  resolveWorkspaceStageStateValue,
  resolveWorkspaceStageSessionConsole,
  resolveWorkspaceStageActionStatus,
  resolveWorkspaceStageDialogueStatus,
  resolveWorkspaceStageConfirmationState,
  buildWorkspaceHeroCardsData,
  buildWorkspaceStageGuideFallback,
  buildWorkspaceStageWorkbenchCards,
  buildWorkspaceStageVisibilityFallback,
  renderList,
  renderMetricCard,
  renderKeyValueGrid,
  renderWorkspaceFlowSection,
  renderWorkspaceConfirmationSection,
  renderWorkspaceDialogueStatusSection,
  renderWorkspaceTimelineSection,
  adaptWorkflowCopilot,
  renderWorkspaceAssetStatusSection,
  renderWorkspaceActionStatusSection,
  buildWorkspaceRouteSectionData,
  buildWorkspaceSummarySectionData,
  buildWorkspaceDecisionItems,
  buildWorkspaceWorkbenchSectionData,
  buildWorkspaceStandardWorkbenchCard,
  buildWorkspaceStandardRoutePoint,
  buildWorkspaceRouteFallback,
  buildWorkspaceStageRouteFallback,
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
  renderResolvedWorkspaceDecisionSection,
  renderResolvedWorkspaceSummarySection,
  renderWorkspaceGridSection,
  renderWorkspaceSection,
  renderWorkspaceBodySection,
  renderWorkspaceAdvancedSection,
  buildCommonDeclaredSectionRenderers,
  buildWorkspaceContentSectionPlan,
  resolveWorkspaceStageContentSectionPlan,
  renderWorkspaceDeclaredSections,
  renderWorkspaceSectionLayout,
  renderWorkspacePageShell,
  buildWorkspacePreviewSectionData,
  buildWorkspaceIssuesSectionData,
  buildWorkspaceAdvancedSectionData,
  buildWorkspaceStageDefaultHints,
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
  buildUserFacingAssetOverview,
} = require('./workspace_status_dictionary');
const { getWorkspaceDenseCopy } = require('./workspace_dense_copy');
const { loadWorkbenchState } = require('./workbench_state_shared');
const {
  resolveWorkspaceRouteFile,
  shouldShowStoryboardPage,
} = require('./workspace_storyboard_shared');
const {
  buildResultStatusStack,
  buildResultTaskControlBar,
  buildResultSignalBar,
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
    modeLabel(item.requestMode),
  ].filter(Boolean).slice(0, 2);
  const summary = String(item.scene || item.composition || normalizedSection.itemFallbackSummary || '').trim();
  const compactSummary = summary.length > 46 ? `${summary.slice(0, 46).trim()}…` : summary;

  return `
    <article class="preview-card">
      ${href ? `<a class="image-frame" href="${href}"><img src="${href}" alt="${title}" loading="lazy" /></a>` : '<div class="image-frame"></div>'}
      <h3 class="preview-title">${title}</h3>
      <p class="preview-meta">${compactSummary}</p>
      <div class="preview-link">
        ${href ? `<a href="${href}">${normalizedSection.imageLinkLabel}</a>` : `<span>${normalizedSection.imageMissingText}</span>`}
      </div>
      ${tags.length ? `<ul class="info-list">${tags.map((tag) => `<li>${tag}</li>`).join('')}</ul>` : ''}
    </article>
  `;
}

function distributionList(report, key, emptyText) {
  const items = toArray(report?.distributions?.[key]).slice(0, 6);
  return renderList(items.map((item) => `${item.name}: ${item.count}`), emptyText);
}

function renderIssueCard(outputDir, item, index, typeLabel, sectionCopy = {}) {
  const normalizedSection = buildWorkspaceIssuesSectionData(sectionCopy);
  const title = item.title || item.shotLabel || item.slug || `${typeLabel} ${index + 1}`;
  const issueReason = String(item.error || item.reason || item.scene || item.composition || normalizedSection.fallbackReason || '').trim();
  const compactReason = issueReason.length > 52 ? `${issueReason.slice(0, 52).trim()}…` : issueReason;
  const tags = [
    typeLabel,
    item.slotId ? `槽位 ${item.slotId}` : null,
    modeLabel(item.requestMode),
  ].filter(Boolean).slice(0, 2);

  return `
    <article class="entry-card tone-warn">
      <div class="entry-kicker">${normalizedSection.kicker}</div>
      <h3 class="entry-title">${title}</h3>
      <p class="entry-copy">${compactReason}</p>
      ${tags.length ? `<ul class="info-list">${tags.map((tag) => `<li>${tag}</li>`).join('')}</ul>` : ''}
    </article>
  `;
}

function renderResultWorkspaceContentArea(options = {}) {
  const previewSection = options.previewSection || {};
  const issuesSection = options.issuesSection || {};
  const previewCardsHtml = Array.isArray(options.previewCardsHtml) ? options.previewCardsHtml.filter(Boolean).join('') : '';
  const issueCardsHtml = Array.isArray(options.issueCardsHtml) ? options.issueCardsHtml.filter(Boolean).join('') : '';
  return renderWorkspaceDeclaredSections(
    Array.isArray(options.contentSections) && options.contentSections.length
      ? options.contentSections
      : buildWorkspaceContentSectionPlan(
        options.contentSections,
        (options.denseCopy?.contentSectionOrder || ['preview', 'issues', 'guide', 'visibility']).map((key) => ({
          key,
          kind: key === 'preview' ? 'previewGrid' : (key === 'issues' ? 'issuesGrid' : 'keyValue'),
        }))
      ),
    {
      ...buildCommonDeclaredSectionRenderers({
        guide: options.guideSection || {},
        visibility: options.visibilitySection || {},
      }),
      preview: () => renderWorkspaceGridSection({
        title: options.denseCopy?.previewSectionTitle || String(previewSection.title || '').trim(),
        copy: options.denseCopy?.previewSectionCopy || String(previewSection.copy || '').trim(),
        gridClass: 'preview-grid',
        extraClass: 'workspace-primary-panel workspace-primary-focus',
        itemsHtml: previewCardsHtml,
        emptyText: previewSection.emptyText || '当前还没有可展示的成功结果。',
      }),
      issues: () => renderWorkspaceGridSection({
        title: options.denseCopy?.issuesSectionTitle || String(issuesSection.title || '').trim(),
        copy: options.denseCopy?.issuesSectionCopy || String(issuesSection.copy || '').trim(),
        gridClass: 'entry-grid',
        extraClass: 'workspace-primary-panel',
        itemsHtml: issueCardsHtml,
        emptyText: issuesSection.emptyText || '当前没有需要单独处理的问题。',
      }),
    }
  );
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
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'result_workspace.html'));

  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};
  const workspaceAssets = workbenchState.workspaceAssets || {};
  const workspaceTimeline = workbenchState.workspaceTimeline || {};
  const resultPageData = pageState?.pageData?.result || {};
  const pageMetrics = resultPageData?.metrics || {};
  const assetSummary = workspaceAssets?.summary || {};
  const artifactLayer = summarizeArtifactLayer(pageState?.artifactGovernance || {});
  const resultFallbackGuide = buildWorkspaceFallbackGuide('result', artifactLayer);
  const resultView = pageState?.views?.result || {};
  const stateGuides = resultView?.guides || {};
  const workbenchGuide = pageState?.workbenchGuide?.result || null;
  const assetGuide = pageState?.assetVisibilityGuide?.result || null;
  const entryGuide = stateGuides.entryStructure || workbenchGuide?.section || null;
  const visibilityGuide = stateGuides.assetVisibility || assetGuide || null;
  const fallbackEntryGuide = resultFallbackGuide.guide;
  const fallbackAssetGuide = resultFallbackGuide.visibility;
  const guideCards = Array.isArray(workbenchGuide?.cards) && workbenchGuide.cards.length
    ? workbenchGuide.cards
    : [];

  const prepareWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'prepare', path.join(outputDir, 'prepare_workspace.html'));
  const exceptionWorkspacePath = resolveWorkspaceRouteFile(outputDir, pageState, 'exception', path.join(outputDir, 'exception_workspace.html'));
  const runRecordPath = resolveWorkspaceRouteFile(outputDir, pageState, 'record', path.join(outputDir, 'run_record.html'));
  const storyboardPath = resolveWorkspaceRouteFile(outputDir, pageState, 'storyboard', path.join(outputDir, 'storyboard_board.html'));
  const workspaceHomePath = resolveWorkspaceRouteFile(outputDir, pageState, 'home', path.join(outputDir, 'workspace_home.html'));
  const sourceSummary = pageState?.sourceSummary || {};
  const sourceCounts = sourceSummary?.counts || {};
  const sourceAssets = sourceSummary?.assets || {};
  const successCount = Number(pageMetrics.successCount || sourceCounts.success || pageState?.counts?.success || manifest.success || 0);
  const failedCount = Number(pageMetrics.failedCount || sourceCounts.failed || pageState?.counts?.failed || manifest.failed || 0);
  const reviewCount = Number(pageMetrics.reviewCount || sourceCounts.needsReview || pageState?.counts?.needsReview || 0);
  const selectedCount = Number(sourceCounts.selected || pageState?.counts?.selected || manifest.selectedCount || successCount + failedCount || 0);
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount,
    sampleSize: Number(manifest?.sampleSize || 0),
    pauseReason: manifest?.pauseReason || '',
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const resultSummary = pageState?.result || {};
  const resultHero = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'hero', {});
  const resultContext = resultView?.context || {};
  const resultFlow = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'flow', {});
  const resultAssetStatus = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'assetStatus', {});
  const resultActionStatus = resolveWorkspaceStageActionStatus(pageState, 'result', resultView);
  const resultDialogueStatus = resolveWorkspaceStageDialogueStatus(pageState, 'result', resultView);
  const resultCopilot = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'copilot', {});
  const unifiedResultStatus = resultSummary?.unifiedStatus && typeof resultSummary.unifiedStatus === 'object'
    ? resultSummary.unifiedStatus
    : {};
  const runtimeSummary = pageState?.runtimeSummary && typeof pageState.runtimeSummary === 'object'
    ? pageState.runtimeSummary
    : {};
  const runtimeCopilotSummary = runtimeSummary.copilotSummary && typeof runtimeSummary.copilotSummary === 'object'
    ? runtimeSummary.copilotSummary
    : {};
  const resultWorkflowCopilot = pageState?.workflowSessions?.result || resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'workflowCopilot', {});
  const resultWorkflowContract = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'workflowContract', pageState?.workflowContracts?.result || {});
  const resultControlRail = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'controlRail', {});
  const resultSessionConsole = resolveWorkspaceStageSessionConsole(pageState, 'result', resultView);
  const resultConfirmationState = resolveWorkspaceStageConfirmationState(
    pageState,
    'result',
    resultView,
    resultSummary.confirmation || resultPageData.confirmation || resultSummary.confirmationState || pageState?.result?.confirmationState || {}
  );
  const stateResultCockpitSummary = resolveWorkspaceStageStateValue(pageState, 'result', resultPageData, resultSummary, 'cockpitSummary', null);
  const stateResultJudgment = resolveWorkspaceStageStateValue(pageState, 'result', resultPageData, resultSummary, 'judgment', null);
  const stateResultStatusStack = toArray(resultPageData.statusStack).length
    ? resultPageData.statusStack
    : (toArray(resultSummary.statusStack).length ? resultSummary.statusStack : []);
  const stateResultDecision = resolveWorkspaceStageStateValue(pageState, 'result', resultPageData, resultSummary, 'decision', null);
  const stateResultSummarySection = resolveWorkspaceStageStateValue(pageState, 'result', resultPageData, resultSummary, 'summary', null);
  const stateResultCollaboration = resolveWorkspaceStageStateValue(pageState, 'result', resultPageData, resultSummary, 'collaboration', null);
  const resultFallbackState = buildStageWorkspaceFallbackState('result', {
    failedCount,
    reviewCount,
    currentPhaseConclusion: String(unifiedResultStatus.conclusion || pageState?.status?.headline || '').trim(),
    currentPhaseSummary: String(unifiedResultStatus.progress || pageState?.status?.summary || '').trim(),
    currentFocus: String(resultSummary.currentFocus || '').trim(),
    statusLabel: String(resultSummary.statusLabel || '').trim(),
    statusSummary: String(resultSummary.statusSummary || '').trim(),
    statusTone: String(resultSummary.statusTone || '').trim(),
    nextActionLabel: String(resultSummary.nextStepLabel || '').trim(),
    nextActionReason: String(resultSummary.nextStepReason || resultSummary.actionSummary || '').trim(),
    transitionSummary: String(resultSummary.transitionSummary || resultSummary.actionSummary || '').trim(),
    handoffSummary: String(resultSummary.handoffSummary || '').trim(),
    confirmationState: resultConfirmationState,
  });
  const resultActionSummary = String(resultSummary.actionSummary || '').trim()
    || (failedCount > 0 ? '建议先处理异常，再决定是否回工作台。' : '建议先在结果工作台完成筛图与取舍。');
  const stagePhrases = getWorkspaceStagePhrases('result');
  const resultNarrative = resolveUnifiedStageNarrative(unifiedResultStatus, {
    summarySource: resultSummary,
    ...resultFallbackState.narrative,
  });
  const resultCurrentFocus = resultNarrative.currentFocus;
  const resultStageSummary = resultNarrative.stageSummary;
  const resultNextStepLabel = String(resultSummary.nextStepLabel || '').trim();
  const resultNextStepReason = String(resultSummary.nextStepReason || '').trim();
  const resultTransitionSummary = firstNonEmpty(resultNarrative.transitionSummary, resultNextStepReason, resultActionSummary);
  const resultHandoffSummary = firstNonEmpty(resultNarrative.handoffSummary, resultTransitionSummary);
  const resultPrimaryAction = resultSummary.primaryAction && typeof resultSummary.primaryAction === 'object'
    ? resultSummary.primaryAction
    : null;
  const resultSecondaryHints = toArray(resultSummary.secondaryActionHints);
  const resultTaskControlBar = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'taskControlBar', null);
  const resultSignalBar = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'signalBar', null);
  const resultTimeline = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'timeline', null);
  const resultStageRelay = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'stageRelay', null);
  const resolvedResultTimeline = resultTimeline
    || resultPageData?.sections?.timeline
    || buildWorkspaceFallbackTimeline('result', {
      events: Array.isArray(resultPageData?.timelineEvents) && resultPageData.timelineEvents.length
        ? resultPageData.timelineEvents
        : null,
      workspaceTimelineEvents: workspaceTimeline?.events,
    });
  const resolvedResultProgress = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'progress', null);
  const resolvedResultActionStatus = {
    ...buildActionStatusFromUnifiedStatus(unifiedResultStatus, {
      base: resultActionStatus,
      copilotSummary: runtimeCopilotSummary,
      confirmationReply: resultConfirmationState.recommendedReply,
      confirmationSummary: resultConfirmationState.summary,
      dialogueNextSayItems: resultDialogueStatus.nextSayItems,
      nextActionSummary: resultNextStepReason || String(pageState?.nextAction?.reason || '').trim() || String(resultConfirmationState.summary || '').trim(),
      defaultActionReason: stagePhrases.actionReason,
    }),
    primary: resultActionStatus.primary || (resultPrimaryAction ? {
      kicker: '现在先做',
      title: String(resultPrimaryAction.label || '').trim() || nextActionLabel,
      summary: String(resultPrimaryAction.summary || '').trim() || resultActionSummary,
      cta: String(resultPrimaryAction.cta || '').trim() || undefined,
      tone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
    } : null),
    notes: toArray(resultActionStatus.notes).length ? resultActionStatus.notes : resultSecondaryHints,
  };
  const resolvedResultDialogueStatus = buildDialogueStatusFromUnifiedStatus(unifiedResultStatus, {
    base: resultDialogueStatus,
    copilotSummary: runtimeCopilotSummary,
    confirmationReply: resultConfirmationState.recommendedReply,
    confirmationSummary: resultConfirmationState.summary,
    nextActionSummary: resultNextStepReason || String(pageState?.nextAction?.reason || '').trim() || String(resultConfirmationState.summary || '').trim(),
    defaultActionReason: stagePhrases.dialogueActionReason,
  });
  const currentPhaseLabel = String(unifiedResultStatus.stage || pageState?.status?.phase || '').trim() || '结果阶段';
  const currentPhaseSummary = String(unifiedResultStatus.progress || pageState?.status?.summary || '').trim();
  const currentPhaseConclusion = String(unifiedResultStatus.conclusion || pageState?.status?.headline || '').trim();
  const resolvedResultWorkflow = adaptWorkflowCopilot(resultWorkflowCopilot, {
    stageKey: 'result',
    stageLabel: currentPhaseLabel,
    taskControlBar: resultTaskControlBar,
    sessionConsole: resultSessionConsole,
    signalBar: resultSignalBar,
    statusStack: stateResultStatusStack,
    cockpitSummary: stateResultCockpitSummary,
    dialogueStatus: resolvedResultDialogueStatus,
    confirmation: resultConfirmationState,
    timeline: resultTimeline,
    judgment: stateResultJudgment,
    stageRelay: resultStageRelay,
  });
  const resultContractState = buildWorkflowContractPageState(resultWorkflowContract, {
    taskControlBar: resolvedResultWorkflow.taskControlBar,
    dialogueStatus: resolvedResultDialogueStatus,
    confirmation: resultConfirmationState,
    sessionConsole: resolvedResultWorkflow.sessionConsole || resultSessionConsole,
    progressTone: failedCount > 0 ? 'warn' : (reviewCount > 0 ? 'warn' : 'good'),
  });
  const finalizedResultActionStatus = finalizeWorkspaceActionStatus(resolvedResultActionStatus, resolvedResultWorkflow);
  const finalizedResultDialogueStatus = finalizeCollaborationPromptState(resolvedResultDialogueStatus, {
    contractDialogue: resultContractState.dialogueStatus,
    confirmationReply: resultConfirmationState.recommendedReply,
    confirmationSummary: resultConfirmationState.summary,
    defaultActionReason: resolvedResultWorkflow.language.dialogueActionReason,
  });
  const resultTransitionStatus = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'transitionStatus', {});
  const resultHandoffFromPrevious = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'handoffFromPrevious', resultTransitionStatus || {});
  const resultHandoffToNext = resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'handoffToNext', {});
  const resultGuideSection = resolveWorkspaceStageSection(pageState, 'result', resultView, resultPageData, 'guide');
  const resultVisibilitySection = resolveWorkspaceStageSection(pageState, 'result', resultView, resultPageData, 'visibility');
  const resultPreviewSection = resolveWorkspaceStageSection(pageState, 'result', resultView, resultPageData, 'preview');
  const resultIssuesSection = resolveWorkspaceStageSection(pageState, 'result', resultView, resultPageData, 'issues');
  const resultAdvancedSection = resolveWorkspaceStageSection(pageState, 'result', resultView, resultPageData, 'advanced');
  const statusLabel = resultNarrative.statusLabel;
  const statusTone = String(resultSummary.statusTone || pageState?.status?.tone || '').trim()
    || (failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'));
  const statusSummary = resultNarrative.statusSummary || resultStageSummary;
  const chrome = getWorkspaceStageChrome('result');
  const denseCopy = getWorkspaceDenseCopy('result');
  const {
    shell,
    governance,
    layout,
    surfaceRules,
    governedWorkbenchIds,
    optionalSurface,
    modeSwitch,
  } = resolveWorkspaceShellRuntime(pageState, 'result', resultView);
  const actionCopy = getWorkspaceActionCopy();
  const identity = getWorkspaceIdentityCopy();
  const successItems = Array.isArray(resultPageData?.resultItems) && resultPageData.resultItems.length
    ? resultPageData.resultItems
    : readAssetCollection(workspaceAssets, 'result');
  const exceptionItems = Array.isArray(resultPageData?.exceptionItems) && resultPageData.exceptionItems.length
    ? resultPageData.exceptionItems
    : readAssetCollection(workspaceAssets, 'exception');
  const reviewAssets = Array.isArray(resultPageData?.reviewItems) && resultPageData.reviewItems.length
    ? resultPageData.reviewItems
    : readAssetCollection(workspaceAssets, 'review');
  const hasStoryboard = optionalSurface.showStoryboardEntry !== undefined
    ? Boolean(optionalSurface.showStoryboardEntry)
    : shouldShowStoryboardPage({
      outputDir,
      workspaceState: pageState,
      storyboardPath,
      manifest,
      successItems,
      failedItems: exceptionItems,
      reviewItems: reviewAssets,
    });
  const resolvedNextAction = resolveUnifiedNextAction(unifiedResultStatus, {
    secondarySource: pageState?.nextAction,
    label: resultNextStepLabel,
    reason: resultNextStepReason,
    fallbackLabel: failedCount > 0 ? '进入异常工作台' : '回工作台首页',
    fallbackReason: resultActionSummary || currentPhaseSummary || (failedCount > 0 ? '异常集中处理更省心。' : '结果稳定后回主工作台。'),
    fallbackTarget: failedCount > 0 ? 'exception_workspace.html' : 'workspace_home.html',
  });
  const nextActionLabel = resolvedNextAction.label;
  const nextActionReason = resolvedNextAction.reason;
  const visibleNextActionSummary = [runtimeCopilotSummary.nextActionSummary, resultNextStepReason, nextActionReason]
    .map((item) => String(item || '').trim())
    .filter((item, index, list) => item && list.indexOf(item) === index)
    .join(' ');
  const resultTextDefaults = buildWorkflowTextDefaults({
    copilotSummary: runtimeCopilotSummary,
    nextActionSummary: visibleNextActionSummary,
    nextActionReason,
    recommendedReply: runtimeCopilotSummary.recommendedReply || resultConfirmationState.recommendedReply,
    primarySay: runtimeCopilotSummary.recommendedReply || finalizedResultDialogueStatus.primarySay,
    progressSummary: runtimeCopilotSummary.progressSummary || statusSummary || nextActionReason || '',
    statusSummary: runtimeCopilotSummary.conclusion || statusSummary,
    confirmationSummary: resultConfirmationState.summary,
    continuationLabel: '继续，处理当前结果层',
  });
  const stateNextActionPath = resolvedNextAction.target
    ? path.join(outputDir, resolvedNextAction.target)
    : null;
  const normalizedResultGuideSection = resolveWorkspaceGuideSectionData(
    resultGuideSection,
    buildWorkspaceStageGuideFallback('result', {
      entryGuideTitle: resultGuideSection?.title,
      entryGuideItems: resultGuideSection?.items,
      guideCopy: resultGuideSection?.copy,
    })
  );
  const normalizedResultVisibilitySection = resolveWorkspaceGuideSectionData(
    resultVisibilitySection,
    buildWorkspaceStageVisibilityFallback('result', {
      visibilityTitle: resultVisibilitySection?.title,
      visibilityCopy: resultVisibilitySection?.copy,
      visibilityItems: resultVisibilitySection?.items,
    })
  );
  const normalizedResultPreviewSection = buildWorkspacePreviewSectionData(
    resultPreviewSection
  );
  const normalizedResultIssuesSection = resolveWorkspaceIssuesSectionData(
    resultIssuesSection,
    resultIssuesSection
  );
  const normalizedResultAdvancedSection = buildWorkspaceAdvancedSectionData(
    resultAdvancedSection
  );
  const previewItems = Array.isArray(normalizedResultPreviewSection.items) && normalizedResultPreviewSection.items.length
    ? normalizedResultPreviewSection.items.slice(0, 12)
    : readAssetCollection(workspaceAssets, 'preview').slice(0, 12);
  const issuePreviewItems = Array.isArray(normalizedResultIssuesSection.items) && normalizedResultIssuesSection.items.length
    ? normalizedResultIssuesSection.items.slice(0, 6)
    : exceptionItems.slice(0, 3).map((item) => ({ ...item, issueType: '失败项' }))
      .concat(reviewAssets.slice(0, 3).map((item) => ({ ...item, issueType: '待复核' })))
      .slice(0, 6);
  const userFacingAssetOverview = buildWorkspaceFallbackAssetOverview({
    stageKey: 'result',
    resultCount: successCount,
    previewCount: previewItems.length,
    reviewCount,
    exceptionCount: failedCount,
    referenceCount: 0,
    overviewBuilder: buildUserFacingAssetOverview,
  }).overview;
  const resolvedResultStageRelay = buildUnifiedWorkflowStageRelay(
    unifiedResultStatus,
    {
      workflow: resolvedResultWorkflow.stageRelay,
      copilot: resultCopilot?.mainline?.stageRelay,
      view: resultStageRelay,
      fallbackCurrentSummary: firstNonEmpty(
        resultFallbackState.stageRelay.fallbackCurrentSummary,
        resultTransitionSummary,
        resultActionSummary
      ),
      fallbackNextSummary: firstNonEmpty(
        resultFallbackState.stageRelay.fallbackNextSummary,
        resultHandoffSummary,
        resultTransitionSummary
      ),
    }
  );
  const resolvedResultCockpitSummary = buildUnifiedWorkflowCockpitSummary({
    base: stateResultCockpitSummary,
    workflow: resolvedResultWorkflow.cockpitSummary,
    copilot: resultCopilot?.hero?.cockpitSummary,
    view: resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'cockpitSummary', null),
    items: resultFallbackState.cockpitItems,
  });
  const resolvedResultJudgment = buildUnifiedWorkflowJudgment({
    stageConfig: {
      title: resolvedResultWorkflow.language.judgmentTitle,
      copy: resolvedResultWorkflow.language.judgmentCopy,
    },
    base: resultFallbackState.judgmentBase,
    baseState: stateResultJudgment,
    copilot: resultCopilot?.mainline?.judgment,
    workflow: resolvedResultWorkflow.judgment,
    view: resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'judgment', null),
  });
  const resolvedResultDecision = buildUnifiedWorkflowDecision({
    stageConfig: {
      title: chrome.decisionTitle,
      copy: chrome.decisionCopy,
    },
    base: buildWorkspaceDecisionSectionData({
      items: buildWorkspaceDecisionItems({
        reasonValue: resultCurrentFocus,
        riskValue: nextActionReason || (failedCount > 0 ? '失败项会继续打断主链判断。' : (reviewCount > 0 ? '待复核项可能让结果层过早收口。' : '当前主要风险不在结果层，而在你是否还需要回看其他层。')),
        pageValue: resultStageSummary || resolvedResultWorkflow.language.pagePurpose,
      }),
    }),
    state: stateResultDecision,
    view: resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'decision', null),
  });
  const resolvedResultSummary = resolveWorkspaceStageSummarySection(
    pageState,
    'result',
    {
      ...resultView,
      summary: resultView?.summary || stateResultSummarySection || {},
    },
    buildWorkspaceSummarySectionData({
      enabled: layout.showSummaryByDefault,
      title: chrome.summaryTitle,
      copy: chrome.summaryCopy,
      items: [
        { label: '当前阶段', value: unifiedResultStatus.stage || currentPhaseLabel },
        { label: '当前结论', value: unifiedResultStatus.conclusion || statusLabel },
        { label: '结果概况', value: userFacingAssetOverview.summary },
        { label: '当前重点', value: unifiedResultStatus.currentFocus || resultCurrentFocus },
        { label: '下一步', value: unifiedResultStatus.nextAction?.label || nextActionLabel },
        { label: '为什么先做这一步', value: unifiedResultStatus.nextAction?.reason || nextActionReason },
      ],
    })
  );
  const resolvedResultConfirmationState = buildUnifiedWorkflowConfirmation(unifiedResultStatus, {
    fallback: resultContractState.confirmation || resultConfirmationState,
  });
  const resolvedResultTaskControlBar = finalizeTaskControlBar(
    resultContractState.taskControlBar
    || resolvedResultWorkflow.taskControlBar
    || resultCopilot?.hero?.taskControlBar
    || resultControlRail.taskControlBar
    || resultTaskControlBar
    || buildTaskControlBarFromUnifiedStatus(unifiedResultStatus, {
      copilotSummary: runtimeCopilotSummary,
      taskLabel,
      stageLabel: currentPhaseLabel,
      nextActionLabel,
      nextActionSummary: resultTextDefaults.nextActionSummary,
      primarySay: resultTextDefaults.primarySay,
      progressLabel: stagePhrases.progressLabel,
      progressSummary: resultTextDefaults.progressSummary,
      progressTone: statusTone || (failedCount > 0 ? 'warn' : 'good'),
    })
    || buildResultTaskControlBar({
    taskLabel,
    stageLabel: currentPhaseLabel,
    statusLabel,
    statusTone,
    failedCount,
    reviewCount,
    nextActionLabel,
    nextActionSummary: nextActionReason,
  }), {
    preferOptionFields: ['statusSummary', 'nextActionSummary', 'primarySay', 'progressSummary'],
    nextActionLabel,
    primarySay: resultTextDefaults.primarySay,
    progressLabel: stagePhrases.progressLabel,
    progressSummary: resultTextDefaults.progressSummary,
    progressTone: statusTone || (failedCount > 0 ? 'warn' : 'good'),
    nextActionTone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
    nextActionSummary: visibleNextActionSummary,
  });
  const resolvedResultSignalBar = resolvedResultWorkflow.signalBar
    || resultCopilot?.hero?.signalBar
    || resultControlRail.signalBar
    || (Array.isArray(resultSignalBar) ? { items: resultSignalBar } : resultSignalBar)
    || {
      items: buildResultSignalBar({
        stageLabel: currentPhaseLabel,
        statusLabel,
        statusSummary: resultTextDefaults.statusSummary,
        statusTone,
        failedCount,
        nextActionLabel,
        nextActionSummary: resultTextDefaults.nextActionSummary,
        replyLabel: resultTextDefaults.replyLabel || '继续，处理当前结果层',
      }),
    };
  const resolvedResultStatusStack = buildUnifiedWorkflowStatusStack({
    workflow: resolvedResultWorkflow.statusStack,
    copilot: resultCopilot?.mainline?.statusStack,
    controlRail: resultControlRail.statusStack,
    stateItems: stateResultStatusStack,
    fallbackBuilder: () => buildResultStatusStack({
      statusLabel,
      statusSummary: resultTextDefaults.statusSummary,
      statusTone,
      failedCount,
      reviewCount,
      nextActionLabel,
      nextActionSummary: resultTextDefaults.nextActionSummary,
    }),
  });
  const resolvedResultCollaboration = buildUnifiedWorkflowCollaboration(unifiedResultStatus, {
    base: resultContractState.collaboration || stateResultCollaboration,
    workflow: resolvedResultWorkflow.collaboration,
    view: resolveWorkspaceStageViewValue(pageState, 'result', resultView, 'collaboration', null),
    confirmation: resolvedResultConfirmationState,
    timeline: resolvedResultTimeline,
    dialogue: finalizedResultDialogueStatus,
  });
  const nextActionPath = stateNextActionPath && fileExists(stateNextActionPath)
    && path.resolve(stateNextActionPath) !== path.resolve(outputPath)
    ? stateNextActionPath
    : (failedCount > 0
      ? exceptionWorkspacePath
      : workspaceHomePath);
  const normalizedResultSummary = buildWorkspaceSummarySectionData(resolvedResultSummary || {});
  const resultContentSections = renderResultWorkspaceContentArea({
    denseCopy,
    contentSections: resolveWorkspaceStageContentSectionPlan(pageState, 'result', resultView, (denseCopy.contentSectionOrder || ['preview', 'issues', 'guide', 'visibility']).map((key) => ({
      key,
      kind: key === 'preview' ? 'previewGrid' : (key === 'issues' ? 'issuesGrid' : 'keyValue'),
    }))),
    guideSection: normalizedResultGuideSection,
    visibilitySection: normalizedResultVisibilitySection,
    previewSection: normalizedResultPreviewSection,
    issuesSection: normalizedResultIssuesSection,
    previewCardsHtml: previewItems.map((item, index) => renderPreviewCard(outputDir, item, index, normalizedResultPreviewSection)),
    issueCardsHtml: issuePreviewItems.map((item, index) => renderIssueCard(outputDir, item, index, item.issueType, normalizedResultIssuesSection)),
  });
  const fallbackWorkbenchCards = [
    ...buildWorkspaceStageWorkbenchCards('result', {
      denseCopy,
      exceptionValue: failedCount > 0 ? '需要先处理' : (reviewCount > 0 ? '建议再确认' : denseCopy.optionalEntryValue),
      exceptionSummary: failedCount > 0 ? '有失败项时，再到这里集中处理。' : (reviewCount > 0 ? '边界结果还想再确认时，再进入。' : denseCopy.optionalEntrySummary),
      exceptionFile: exceptionWorkspacePath,
      exceptionCta: actionCopy.enterException,
      exceptionTone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'neutral'),
      includeStoryboard: hasStoryboard && path.resolve(nextActionPath) !== path.resolve(storyboardPath),
      storyboardFile: storyboardPath,
      storyboardCta: actionCopy.openStoryboard,
    }),
    ...guideCards,
  ].filter(Boolean).filter((card) => !governedWorkbenchIds || !card.id || governedWorkbenchIds.has(card.id));
  const resolvedResultWorkbench = resolveWorkspaceStageWorkbenchSection(
    pageState,
    'result',
    resultView,
    buildWorkspaceWorkbenchSectionData({
      title: chrome.workbenchTitle,
      copy: chrome.workbenchCopy,
      cards: fallbackWorkbenchCards,
    })
  );
  const resolvedResultRoute = resolveWorkspaceStageRouteSection(
    pageState,
    'result',
    resultView,
    buildWorkspaceStageRouteFallback('result', {
      title: chrome.routeTitle,
      copy: chrome.routeCopy,
      denseCopy,
      currentLabel: statusLabel,
      currentPendingLabel: stagePhrases.routeCurrentPendingLabel,
      previousFile: workspaceHomePath,
      previousCta: actionCopy.returnHome,
      nextLabel: nextActionLabel,
      nextSummary: nextActionReason,
      nextFile: nextActionPath,
      nextCta: failedCount > 0 ? actionCopy.enterException : actionCopy.enterNow,
      extraNextSteps: !failedCount && !reviewCount && fileExists(runRecordPath)
        ? [{ kicker: '辅助说明', label: '任务档案', summary: '想看这轮完整记录时再打开。', file: runRecordPath, cta: actionCopy.viewRecordShort, audience: 'pro' }]
        : [],
    })
  );
  const resultHeroCards = Array.isArray(resultView?.heroCards) ? resultView.heroCards : [];
  const contextBarData = resolveWorkspaceStageContextBarData(pageState, 'result', resultView, buildWorkspaceContextFallback('result', {
    runLabel: taskLabel,
    phaseLabel: currentPhaseLabel,
    flowLabel: identity.flows.result,
    countValues: {
      focus: resultCurrentFocus,
      status: statusLabel,
      next: nextActionLabel,
      pressure: failedCount > 0 ? '还有异常要收口' : (reviewCount > 0 ? '还有边界结果要确认' : '当前平稳'),
    },
    defaultHints: buildWorkspaceStageDefaultHints('result', {
      stageSummary: resultStageSummary,
      densePrimaryHint: denseCopy.contextPrimaryHint,
      currentFocus: resultCurrentFocus,
      nextActionReason: nextActionReason || (failedCount > 0 ? '先处理异常相关结果，再决定是否补跑。' : '先筛出最值得保留的图，再决定是否看整板。'),
    }),
    extraHints: resultContext.hints,
  }));
  const contextBar = renderPortalContextBar(contextBarData);

  const html = renderWorkspacePageShell({
    pageTitle: shell.pageTitle,
    currentPage: shell.currentPage,
    headAssets: renderPortalHeadAssets(),
    cssVars: shell.cssVars,
    topLinks: renderPortalTopLinks(outputDir, { currentPage: shell.currentPage, governance }),
    heroEyebrow: String(resultHero.eyebrow || '').trim() || shell.heroEyebrow,
    heroTitle: String(resultHero.title || '').trim() || shell.heroTitle,
    heroCopy: String(resultHero.intro || '').trim() || shell.heroCopy,
    contextBar,
    copilotDeck: renderWorkspaceCopilotDeck({
      title: resultCopilot?.title || resolvedResultWorkflow.language.deckTitle,
      copy: resultCopilot?.copy || resolvedResultWorkflow.language.deckCopy,
      taskControlBar: renderWorkspaceTaskControlBar(resolvedResultTaskControlBar),
      sessionConsole: renderWorkspaceSessionConsoleSection(resolvedResultWorkflow.sessionConsole || resultCopilot?.hero?.sessionConsole || resultSessionConsole),
      heroMetrics: resultHeroCards.map((card) => renderMetricCard(card.label, card.value, card.tone, card.detail)).join(''),
      cockpitSummary: renderWorkspaceCockpitSummarySection({
        title: resolvedResultWorkflow.language.cockpitTitle,
        copy: resolvedResultWorkflow.language.cockpitCopy,
        ...resolvedResultCockpitSummary,
      }),
      stageSignals: renderWorkspaceSignalBar(resolvedResultSignalBar),
      relayPanel: [
        renderWorkspaceDialogueStatusSection(finalizedResultDialogueStatus),
        renderWorkspaceCollaborationSection(resolvedResultCollaboration),
        renderWorkspaceConfirmationSection({
          title: resolvedResultWorkflow.language.confirmationTitle,
          copy: resolvedResultWorkflow.language.confirmationCopy,
          ...resolvedResultConfirmationState,
        }),
      ].filter(Boolean).join(''),
    }),
    taskControlBar: renderWorkspaceTaskControlBar(resolvedResultTaskControlBar),
    sessionConsole: renderWorkspaceSessionConsoleSection(resolvedResultWorkflow.sessionConsole || resultCopilot?.hero?.sessionConsole || resultSessionConsole),
    heroMetrics: resultHeroCards.map((card) => renderMetricCard(card.label, card.value, card.tone, card.detail)).join(''),
    cockpitSummary: renderWorkspaceCockpitSummarySection({
      title: resolvedResultWorkflow.language.cockpitTitle,
      copy: resolvedResultWorkflow.language.cockpitCopy,
      ...resolvedResultCockpitSummary,
    }),
    stageSignals: renderWorkspaceSignalBar(resolvedResultSignalBar),
    modeSwitch: renderPortalModeSwitch({
      title: modeSwitch.title,
      copy: modeSwitch.copy,
      defaultMode: modeSwitch.defaultMode,
      newcomerLabel: modeSwitch.newcomerLabel,
      proLabel: modeSwitch.proLabel,
    }),
    progressRail: renderPortalProgressRail(outputDir, {
      currentPage: shell.currentPage,
      title: String(resolvedResultProgress?.title || '').trim() || chrome.progressTitle,
      copy: String(resolvedResultProgress?.copy || '').trim() || chrome.progressCopy,
      visibleIds: Array.isArray(resolvedResultProgress?.visibleIds) && resolvedResultProgress.visibleIds.length ? resolvedResultProgress.visibleIds : undefined,
      windowRadius: surfaceRules.progressWindowRadius,
      governance,
    }),
    routeCompass: renderPortalRouteCompass(outputDir, {
      title: resolvedResultRoute.title,
      copy: resolvedResultRoute.copy,
      current: resolvedResultRoute.current,
      previous: resolvedResultRoute.previous,
      nextSteps: resolvedResultRoute.nextSteps,
      maxNextSteps: surfaceRules.routeMaxNextSteps,
    }),
    workbench: renderPortalWorkbench(outputDir, buildRenderableWorkbench({
      section: resolvedResultWorkbench,
      title: chrome.workbenchTitle,
      copy: chrome.workbenchCopy,
      maxCards: surfaceRules.workbenchMaxCards,
    })),
    mainSections: renderWorkspaceSectionLayout('result', {
      flow: renderWorkspaceFlowSection(resultFlow),
      judgment: renderWorkspaceJudgmentPanelSection(resolvedResultJudgment),
      stageRelay: renderWorkspaceStageRelaySection(resolvedResultStageRelay),
      statusStack: renderWorkspaceStatusStack(resolvedResultStatusStack),
      timeline: renderWorkspaceTimelineSection(resolvedResultTimeline),
      assets: renderWorkspaceAssetStatusSection(resultAssetStatus),
      actions: renderWorkspaceActionStatusSection(finalizedResultActionStatus),
      transitions: renderWorkspaceTransitionStatusSection({
        ...resultHandoffToNext,
        copy: firstNonEmpty(resultHandoffToNext.copy, resultTransitionSummary),
      }),
      decision: renderResolvedWorkspaceDecisionSection(resolvedResultDecision, {
        title: chrome.decisionTitle,
        copy: chrome.decisionCopy,
      }),
      summary: renderResolvedWorkspaceSummarySection(normalizedResultSummary, {
        title: chrome.summaryTitle,
        copy: chrome.summaryCopy,
      }, {
        defaultEnabled: false,
      }),
      content: resultContentSections,
      advanced: renderWorkspaceAdvancedSection({
        title: normalizedResultAdvancedSection.title,
        copy: normalizedResultAdvancedSection.copy,
        summary: normalizedResultAdvancedSection.summary,
        body: `<div class="entry-grid" style="margin-top:14px;">
          ${(Array.isArray(normalizedResultAdvancedSection.groups) && normalizedResultAdvancedSection.groups.length
            ? normalizedResultAdvancedSection.groups
            : [
              { title: normalizedResultAdvancedSection.requestModeTitle, items: [] },
              { title: normalizedResultAdvancedSection.styleTitle, items: [] },
              { title: normalizedResultAdvancedSection.slotRoleTitle, items: [] },
            ]).map((group) => `
            <article class="entry-card">
              <div class="entry-kicker">${group.title}</div>
              ${renderList(toArray(group.items), normalizedResultAdvancedSection.emptyText)}
            </article>
          `).join('')}
        </div>`,
      }),
    }, { currentPage: shell.currentPage }),
  });

  fs.writeFileSync(outputPath, html);
}

main();
