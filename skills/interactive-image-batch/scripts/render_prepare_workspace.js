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
  sumObjectValues,
  getWorkspaceStageChrome,
  getWorkspaceStagePhrases,
  getWorkspaceIdentityCopy,
  resolveWorkspaceShellRuntime,
  resolveWorkspaceStageContextBarData,
  resolveWorkspaceStageViewValue,
  resolveWorkspaceStageSection,
  resolveWorkspaceStageStateValue,
  resolveWorkspaceStageSessionConsole,
  resolveWorkspaceStageActionStatus,
  resolveWorkspaceStageDialogueStatus,
  resolveWorkspaceStageConfirmationState,
  buildWorkspaceDecisionSectionData,
  buildWorkspaceHeroCardsData,
  buildWorkspaceStageGuideFallback,
  buildWorkspaceStageVisibilityFallback,
  buildWorkspaceSummarySectionData,
  buildWorkspaceDecisionItems,
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
  buildTaskControlBarFromUnifiedStatus,
  finalizeTaskControlBar,
  renderWorkspaceStatusStack,
  renderWorkspaceCopilotDeck,
  renderWorkspaceTransitionStatusSection,
  renderWorkspaceSection,
  renderWorkspaceKeyValueSection,
  renderResolvedWorkspaceDecisionSection,
  renderResolvedWorkspaceSummarySection,
  renderWorkspaceGridSection,
  renderWorkspaceBodySection,
  buildCommonDeclaredSectionRenderers,
  buildWorkspaceContentSectionPlan,
  resolveWorkspaceStageContentSectionPlan,
  renderWorkspaceDeclaredSections,
  renderWorkspaceSectionLayout,
  renderWorkspacePageShell,
  buildWorkspaceGuideSectionData,
  buildWorkspaceDirectionSectionData,
  buildWorkspaceReadinessSectionData,
  buildWorkspaceAssetsSectionData,
  buildWorkspaceStageFallbackBundle,
  resolveWorkspaceGuideSectionData,
  resolveWorkspaceDirectionSectionData,
  resolveWorkspaceReadinessSectionData,
  resolveWorkspaceAssetsSectionData,
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
  buildWorkflowTextDefaults,
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
  buildPrepareStatusStack,
  buildPrepareTaskControlBar,
  buildPrepareSignalBar,
} = require('./workspace_status_dictionary');

function buildReadiness(validation) {
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
      detail: '当前不建议直接执行，先把阻塞项收干净。',
      blockingItems,
      cautionItems,
    };
  }
  if (cautionItems.length) {
    return {
      tone: 'warn',
      label: '可以执行，但建议再收一轮',
      detail: '没有硬阻塞，但还有一些值得先微调的风险项。',
      blockingItems,
      cautionItems,
    };
  }
  return {
    tone: 'good',
    label: '可以进入执行',
    detail: '当前准备层已经比较干净，可以进入正式生图。',
    blockingItems,
    cautionItems,
  };
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function resolveAssetPath(outputDir, asset) {
  const rawPath = String(asset?.path || asset?.output || '').trim();
  if (!rawPath) return null;
  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(outputDir, rawPath);
  return fileExists(absolutePath) ? relativeFile(outputDir, absolutePath) : null;
}

function renderPrepareAssetCard(outputDir, asset, index) {
  const title = String(asset?.label || asset?.asset_id || asset?.slot_id || '').trim() || `素材 ${index + 1}`;
  const href = resolveAssetPath(outputDir, asset);
  const tags = [
    String(asset?.asset_type || '').trim() || null,
    String(asset?.slot_id || '').trim() ? `槽位 ${String(asset.slot_id).trim()}` : null,
  ].filter(Boolean);
  return `
    <article class="entry-card">
      <div class="entry-kicker">参考素材</div>
      <h3 class="entry-title">${title}</h3>
      <p class="entry-copy">${String(asset?.notes || asset?.path || '这项素材已进入当前任务约束。').trim()}</p>
      ${href ? `<div class="preview-link"><a href="${href}">打开素材</a></div>` : ''}
      ${tags.length ? `<ul class="info-list">${tags.map((tag) => `<li>${tag}</li>`).join('')}</ul>` : ''}
    </article>
  `;
}

function renderPrepareWorkspaceContentArea(options = {}) {
  const denseCopy = options.denseCopy || {};
  const directionSection = options.directionSection || {};
  const directionItems = Array.isArray(options.directionItems) ? options.directionItems : [];
  const readinessSection = options.readinessSection || {};
  const assetsSection = options.assetsSection || {};
  const assetCardsHtml = Array.isArray(options.assetCardsHtml) ? options.assetCardsHtml.filter(Boolean).join('') : '';
  const guideSection = options.guideSection || {};
  const visibilitySection = options.visibilitySection || {};

  const executionCheckBody = [
    `<div class="entry-grid">
      <article class="entry-card">
        <div class="entry-kicker">${readinessSection.blockingTitle || '阻塞清单'}</div>
        ${renderList(readinessSection.blockingItems, readinessSection.blockingEmptyText || '当前没有硬阻塞')}
      </article>
      <article class="entry-card">
        <div class="entry-kicker">${readinessSection.cautionTitle || '提醒清单'}</div>
        ${renderList(readinessSection.cautionItems, readinessSection.cautionEmptyText || '当前没有明显提醒项')}
      </article>
    </div>`,
    Array.isArray(assetsSection.items) && assetsSection.items.length ? renderKeyValueGrid(assetsSection.items) : '',
    assetCardsHtml ? `
      <div class="entry-grid" style="margin-top:14px;">
        ${assetCardsHtml}
      </div>
    ` : '',
  ].filter(Boolean).join('');
  return renderWorkspaceDeclaredSections(
    Array.isArray(options.contentSections) && options.contentSections.length
      ? options.contentSections
      : buildWorkspaceContentSectionPlan(
        options.contentSections,
        (options.denseCopy?.contentSectionOrder || ['direction', 'readiness', 'assets', 'guide', 'visibility']).map((key) => ({
          key,
          kind: key === 'readiness' ? 'prepareReadiness' : (key === 'assets' ? 'prepareAssets' : 'keyValue'),
          enabled: key === 'direction'
            ? directionItems.length > 0
            : key === 'assets'
              ? (Array.isArray(assetsSection.items) && assetsSection.items.length > 0) || Boolean(assetCardsHtml)
              : true,
        }))
      ),
    {
      ...buildCommonDeclaredSectionRenderers({
        guide: guideSection,
        visibility: visibilitySection,
      }),
      direction: () => renderWorkspaceKeyValueSection({
        title: denseCopy.directionSectionTitle || String(directionSection.title || '').trim(),
        copy: denseCopy.directionSectionCopy || String(directionSection.copy || '').trim(),
        extraClasses: ['workspace-primary-panel'],
        items: directionItems,
      }),
      readiness: () => renderWorkspaceBodySection({
        title: denseCopy.readinessSectionTitle || String(readinessSection.title || '').trim(),
        copy: denseCopy.readinessSectionCopy || String(readinessSection.copy || '').trim(),
        extraClasses: ['workspace-primary-panel', 'workspace-primary-focus'],
        body: executionCheckBody,
      }),
      assets: () => renderWorkspaceBodySection({
        title: denseCopy.assetsSectionTitle || String(assetsSection.title || '').trim(),
        copy: denseCopy.assetsSectionCopy || String(assetsSection.copy || '').trim(),
        extraClasses: ['workspace-primary-panel'],
        body: [
          Array.isArray(assetsSection.items) && assetsSection.items.length ? renderKeyValueGrid(assetsSection.items) : '',
          assetCardsHtml ? `<div class="entry-grid">${assetCardsHtml}</div>` : '',
        ].filter(Boolean).join('') || '<div class="empty-state">当前没有需要额外说明的素材约束。</div>',
      }),
    }
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args['manifest-file'] ? path.resolve(args['manifest-file']) : null;
  const manifest = manifestPath && fileExists(manifestPath) ? readJson(manifestPath) : null;
  const outputDir = path.resolve(
    manifest?.outputDir ||
    args['output-dir'] ||
    (manifestPath ? path.dirname(manifestPath) : (args['task-spec'] ? path.dirname(path.resolve(args['task-spec'])) : process.cwd()))
  );
  const outputPath = path.resolve(args['output-file'] || path.join(outputDir, 'prepare_workspace.html'));

  const workbenchState = loadWorkbenchState(outputDir);
  const pageState = workbenchState.pageState || workbenchState.workspaceState || {};
  const workspaceAssets = workbenchState.workspaceAssets || {};
  const workspaceTimeline = workbenchState.workspaceTimeline || {};
  const preparePageData = pageState?.pageData?.prepare || {};
  const pageMetrics = preparePageData?.metrics || {};
  const assetSummary = workspaceAssets?.summary || {};
  const artifactLayer = summarizeArtifactLayer(pageState?.artifactGovernance || {});
  const prepareFallbackGuide = buildWorkspaceFallbackGuide('prepare', artifactLayer);
  const workbenchGuide = pageState?.workbenchGuide?.prepare || null;
  const assetGuide = pageState?.assetVisibilityGuide?.prepare || null;
  const prepareView = pageState?.views?.prepare || {};
  const stateGuides = prepareView?.guides || {};
  const entryGuide = stateGuides.entryStructure || workbenchGuide?.section || null;
  const visibilityGuide = stateGuides.assetVisibility || assetGuide || null;
  const fallbackEntryGuide = prepareFallbackGuide.guide;
  const fallbackAssetGuide = prepareFallbackGuide.visibility;
  const guideCards = Array.isArray(workbenchGuide?.cards) && workbenchGuide.cards.length
    ? workbenchGuide.cards
    : [];
  const identity = getWorkspaceIdentityCopy();
  const statePrepare = pageState?.prepare || {};
  const unifiedPrepareStatus = statePrepare?.unifiedStatus && typeof statePrepare.unifiedStatus === 'object'
    ? statePrepare.unifiedStatus
    : {};
  const runtimeSummary = pageState?.runtimeSummary && typeof pageState.runtimeSummary === 'object'
    ? pageState.runtimeSummary
    : {};
  const runtimeCopilotSummary = runtimeSummary.copilotSummary && typeof runtimeSummary.copilotSummary === 'object'
    ? runtimeSummary.copilotSummary
    : {};
  const runtimeWorkflow = pageState?.runtimeWorkflow && typeof pageState.runtimeWorkflow === 'object'
    ? pageState.runtimeWorkflow
    : null;
  const runtimeStatus = String(runtimeSummary.currentStatus || runtimeWorkflow?.currentStatus || '').trim();
  const runtimeActive = ['running', 'paused', 'awaiting_confirmation', 'waiting'].includes(runtimeStatus);
  const readiness = statePrepare.readiness || preparePageData?.readiness || buildReadiness({});
  const hasBlocking = readiness.blockingItems.length > 0;
  const currentPhaseLabel = String(pageState?.status?.phase || '').trim() || '准备阶段';
  const stagePhrases = getWorkspaceStagePhrases('prepare');
  const currentTone = String(pageState?.status?.tone || '').trim() || readiness.tone;
  const currentSummary = String(pageState?.status?.summary || '').trim() || readiness.detail;
  const prepareConfirmationState = resolveWorkspaceStageConfirmationState(
    pageState,
    'prepare',
    prepareView,
    statePrepare.confirmation || preparePageData.confirmation || statePrepare.confirmationState || pageState?.prepare?.confirmationState || {}
  );
  const statePrepareCockpitSummary = resolveWorkspaceStageStateValue(pageState, 'prepare', preparePageData, statePrepare, 'cockpitSummary', null);
  const statePrepareJudgment = resolveWorkspaceStageStateValue(pageState, 'prepare', preparePageData, statePrepare, 'judgment', null);
  const statePrepareStatusStack = toArray(preparePageData.statusStack).length
    ? preparePageData.statusStack
    : (toArray(statePrepare.statusStack).length ? statePrepare.statusStack : []);
  const statePrepareDecision = resolveWorkspaceStageStateValue(pageState, 'prepare', preparePageData, statePrepare, 'decision', null);
  const statePrepareSummarySection = resolveWorkspaceStageStateValue(pageState, 'prepare', preparePageData, statePrepare, 'summary', null);
  const statePrepareCollaboration = resolveWorkspaceStageStateValue(pageState, 'prepare', preparePageData, statePrepare, 'collaboration', null);
  const importedBindingCount = Number(preparePageData.importedBindingCount || statePrepare.importedBindingCount || 0)
    || Number(pageMetrics.referenceCount || assetSummary.referenceCount || 0);
  const prepareFallbackState = buildStageWorkspaceFallbackState('prepare', {
    hasBlocking,
    importedBindingCount,
    currentPhaseConclusion: readiness.label,
    currentPhaseSummary: currentSummary,
    currentFocus: String(statePrepare.currentFocus || '').trim(),
    statusLabel: readiness.label,
    statusSummary: readiness.detail,
    statusTone: readiness.tone,
    nextActionLabel: String(statePrepare.nextStepLabel || '').trim(),
    nextActionReason: String(statePrepare.nextStepReason || prepareConfirmationState.summary || currentSummary || '').trim(),
    transitionSummary: currentSummary,
    handoffSummary: String(statePrepare.handoffSummary || '').trim(),
    confirmationState: prepareConfirmationState,
  });
  const prepareNarrative = resolveUnifiedStageNarrative(unifiedPrepareStatus, {
    summarySource: statePrepare,
    ...prepareFallbackState.narrative,
  });
  const prepareCurrentFocus = prepareNarrative.currentFocus;
  const prepareStageSummary = prepareNarrative.stageSummary;
  const prepareActionSummary = firstNonEmpty(statePrepare.nextStepReason, prepareConfirmationState.summary, currentSummary);
  const prepareTransitionSummary = firstNonEmpty(prepareNarrative.transitionSummary, prepareActionSummary, currentSummary);
  const prepareHandoffSummary = firstNonEmpty(prepareNarrative.handoffSummary, prepareTransitionSummary);
  const preparePrimaryAction = statePrepare.primaryAction && typeof statePrepare.primaryAction === 'object'
    ? statePrepare.primaryAction
    : null;
  const prepareSecondaryHints = toArray(statePrepare.secondaryActionHints);
  const primaryActionLabel = getStagePrimaryActionLabel('prepare', { hasBlocking });
  const resolvedNextAction = resolveUnifiedNextAction(unifiedPrepareStatus, {
    label: String(statePrepare.nextStepLabel || '').trim(),
    reason: prepareActionSummary || currentSummary,
    fallbackLabel: primaryActionLabel,
    fallbackReason: prepareActionSummary || currentSummary,
    fallbackTarget: 'result_workspace.html',
  });
  const nextActionLabel = resolvedNextAction.label;
  const nextActionReason = resolvedNextAction.reason;
  const draftPromptCount = Number(pageMetrics.promptCount || statePrepare.promptCount || pageState?.counts?.selected || 0);
  const taskLabel = deriveTaskLabel({
    taskLabel: String(pageState?.taskLabel || '').trim(),
    selectedCount: draftPromptCount,
    sampleSize: 0,
    pauseReason: '',
    resumeManifest: null,
  }, outputDir);
  const prepareHero = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'hero', {});
  const prepareContext = prepareView?.context || {};
  const prepareFlow = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'flow', {});
  const prepareAssetStatus = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'assetStatus', {});
  const prepareActionStatus = resolveWorkspaceStageActionStatus(pageState, 'prepare', prepareView);
  const prepareDialogueStatus = resolveWorkspaceStageDialogueStatus(pageState, 'prepare', prepareView);
  const prepareCopilot = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'copilot', {});
  const prepareWorkflowCopilot = pageState?.workflowSessions?.prepare || resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'workflowCopilot', {});
  const prepareWorkflowContract = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'workflowContract', pageState?.workflowContracts?.prepare || {});
  const prepareControlRail = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'controlRail', {});
  const prepareSessionConsole = resolveWorkspaceStageSessionConsole(pageState, 'prepare', prepareView);
  const prepareTaskControlBar = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'taskControlBar', null);
  const prepareSignalBar = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'signalBar', null);
  const prepareTimeline = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'timeline', null);
  const prepareStageRelay = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'stageRelay', null);
  const resolvedPrepareTimeline = prepareTimeline
    || preparePageData?.sections?.timeline
    || buildWorkspaceFallbackTimeline('prepare', {
      events: Array.isArray(preparePageData?.timelineEvents) && preparePageData.timelineEvents.length
        ? preparePageData.timelineEvents
        : null,
      workspaceTimelineEvents: workspaceTimeline?.events,
    });
  const resolvedPrepareProgress = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'progress', null);
  const resolvedPrepareActionStatus = {
    ...buildActionStatusFromUnifiedStatus(unifiedPrepareStatus, {
      base: prepareActionStatus,
      copilotSummary: runtimeCopilotSummary,
      confirmationReply: prepareConfirmationState.recommendedReply,
      confirmationSummary: prepareConfirmationState.summary,
      dialogueNextSayItems: prepareDialogueStatus.nextSayItems,
      nextActionSummary: prepareActionSummary || currentSummary,
      defaultActionReason: currentSummary,
    }),
    primary: prepareActionStatus.primary || (preparePrimaryAction ? {
      kicker: '现在先做',
      title: String(preparePrimaryAction.label || '').trim() || primaryActionLabel,
      summary: String(preparePrimaryAction.summary || '').trim() || prepareActionSummary,
      cta: String(preparePrimaryAction.cta || '').trim() || undefined,
      tone: hasBlocking ? 'bad' : (readiness.tone === 'warn' ? 'warn' : 'good'),
    } : null),
    notes: toArray(prepareActionStatus.notes).length ? prepareActionStatus.notes : prepareSecondaryHints,
  };
  const resolvedPrepareDialogueStatus = buildDialogueStatusFromUnifiedStatus(unifiedPrepareStatus, {
    base: prepareDialogueStatus,
    copilotSummary: runtimeCopilotSummary,
    confirmationReply: prepareConfirmationState.recommendedReply,
    confirmationSummary: prepareConfirmationState.summary,
    nextActionSummary: prepareActionSummary,
    defaultActionReason: stagePhrases.dialogueActionReason,
  });
  const resolvedPrepareWorkflow = adaptWorkflowCopilot(prepareWorkflowCopilot, {
    stageKey: 'prepare',
    stageLabel: currentPhaseLabel,
    taskControlBar: prepareTaskControlBar,
    sessionConsole: prepareSessionConsole,
    signalBar: prepareSignalBar,
    statusStack: statePrepareStatusStack,
    cockpitSummary: statePrepareCockpitSummary,
    dialogueStatus: resolvedPrepareDialogueStatus,
    confirmation: prepareConfirmationState,
    timeline: prepareTimeline,
    judgment: statePrepareJudgment,
    stageRelay: prepareStageRelay,
  });
  const prepareContractState = buildWorkflowContractPageState(prepareWorkflowContract, {
    taskControlBar: resolvedPrepareWorkflow.taskControlBar,
    dialogueStatus: resolvedPrepareDialogueStatus,
    confirmation: prepareConfirmationState,
    sessionConsole: resolvedPrepareWorkflow.sessionConsole || prepareSessionConsole,
    progressTone: readiness.tone || (hasBlocking ? 'warn' : 'good'),
  });
  const runtimePrepareDialogueStatus = runtimeActive
    ? finalizeCollaborationPromptState({
      ...resolvedPrepareDialogueStatus,
      title: String(runtimeSummary.dialogueStatus?.title || resolvedPrepareDialogueStatus.title || '对话协同').trim(),
      copy: String(runtimeSummary.dialogueStatus?.copy || resolvedPrepareDialogueStatus.copy || '').trim(),
      recentItems: Array.isArray(runtimeSummary.dialogueStatus?.recentItems) && runtimeSummary.dialogueStatus.recentItems.length
        ? runtimeSummary.dialogueStatus.recentItems
        : resolvedPrepareDialogueStatus.recentItems,
      nextSayItems: Array.isArray(runtimeSummary.dialogueStatus?.nextSayItems) && runtimeSummary.dialogueStatus.nextSayItems.length
        ? runtimeSummary.dialogueStatus.nextSayItems
        : resolvedPrepareDialogueStatus.nextSayItems,
      alternativeSayItems: Array.isArray(runtimeSummary.dialogueStatus?.alternativeSayItems) && runtimeSummary.dialogueStatus.alternativeSayItems.length
        ? runtimeSummary.dialogueStatus.alternativeSayItems
        : resolvedPrepareDialogueStatus.alternativeSayItems,
      confirmItems: Array.isArray(runtimeSummary.dialogueStatus?.confirmItems) && runtimeSummary.dialogueStatus.confirmItems.length
        ? runtimeSummary.dialogueStatus.confirmItems
        : resolvedPrepareDialogueStatus.confirmItems,
      primarySay: String(runtimeSummary.dialogueStatus?.primarySay || resolvedPrepareDialogueStatus.primarySay || '').trim(),
      summary: String(runtimeSummary.dialogueStatus?.summary || resolvedPrepareDialogueStatus.summary || runtimeSummary.phaseSummary || '').trim(),
      actionReason: String(runtimeSummary.dialogueStatus?.actionReason || resolvedPrepareDialogueStatus.actionReason || runtimeSummary.phaseSummary || '').trim(),
    }, {
      contractDialogue: prepareContractState.dialogueStatus,
      confirmationReply: runtimeSummary.dialogueStatus?.primarySay || prepareConfirmationState.recommendedReply,
      confirmationSummary: runtimeSummary.phaseSummary || prepareConfirmationState.summary,
      defaultActionReason: String(runtimeSummary.dialogueStatus?.actionReason || runtimeSummary.phaseSummary || '').trim(),
    })
    : null;
  const finalizedPrepareActionStatus = finalizeWorkspaceActionStatus(resolvedPrepareActionStatus, resolvedPrepareWorkflow);
  const finalizedPrepareDialogueStatus = runtimePrepareDialogueStatus || finalizeCollaborationPromptState(resolvedPrepareDialogueStatus, {
    contractDialogue: prepareContractState.dialogueStatus,
    confirmationReply: prepareConfirmationState.recommendedReply,
    confirmationSummary: prepareConfirmationState.summary,
    defaultActionReason: resolvedPrepareWorkflow.language.dialogueActionReason,
  });
  const prepareTextDefaults = buildWorkflowTextDefaults({
    copilotSummary: runtimeCopilotSummary,
    nextActionSummary: runtimeCopilotSummary.nextActionSummary || nextActionReason,
    nextActionReason,
    recommendedReply: runtimeCopilotSummary.recommendedReply || prepareConfirmationState.recommendedReply,
    primarySay: runtimeCopilotSummary.recommendedReply || finalizedPrepareDialogueStatus.primarySay,
    progressSummary: runtimeCopilotSummary.progressSummary || (runtimeActive
      ? String(runtimeWorkflow?.progressSummary || runtimeSummary.phaseSummary || '').trim() || readiness.detail || prepareActionSummary || currentSummary || ''
      : readiness.detail || prepareActionSummary || currentSummary || ''),
    statusSummary: runtimeCopilotSummary.conclusion || readiness.detail || prepareActionSummary || currentSummary || '',
    confirmationSummary: prepareConfirmationState.summary,
    issueSummary: hasBlocking ? readiness.detail : '',
    continuationLabel: getStageContinuationCopy('prepare'),
  });
  const resolvedPrepareTaskControlBar = finalizeTaskControlBar(
    prepareContractState.taskControlBar
    || resolvedPrepareWorkflow.taskControlBar
    || prepareCopilot?.hero?.taskControlBar
    || prepareControlRail.taskControlBar
    || prepareTaskControlBar
    || buildTaskControlBarFromUnifiedStatus(unifiedPrepareStatus, {
      copilotSummary: runtimeCopilotSummary,
      taskLabel,
      stageLabel: currentPhaseLabel,
      nextActionLabel,
      nextActionSummary: prepareTextDefaults.nextActionSummary,
      primarySay: prepareTextDefaults.primarySay,
      progressLabel: stagePhrases.progressLabel,
      progressSummary: prepareTextDefaults.progressSummary,
      progressTone: readiness.tone || (hasBlocking ? 'warn' : 'good'),
    })
    || buildPrepareTaskControlBar({
    taskLabel,
    stageLabel: currentPhaseLabel,
    readinessLabel: readiness.label,
    readinessTone: readiness.tone,
    blockingCount: readiness.blockingItems.length,
    nextActionLabel,
    nextActionSummary: prepareTextDefaults.nextActionSummary,
  }), {
    preferOptionFields: ['statusSummary', 'nextActionSummary', 'primarySay', 'progressSummary'],
    primarySay: prepareTextDefaults.primarySay,
    progressLabel: runtimeActive
      ? String(runtimeWorkflow?.headline || runtimeSummary.phaseLabel || '执行状态').trim() || '执行状态'
      : '放行判断',
    progressSummary: prepareTextDefaults.progressSummary,
    progressTone: runtimeActive
      ? String(runtimeWorkflow?.tone || pageState?.status?.tone || '').trim() || 'info'
      : readiness.tone || (hasBlocking ? 'warn' : 'good'),
  });
  const resolvedPrepareSignalBar = resolvedPrepareWorkflow.signalBar
    || prepareCopilot?.hero?.signalBar
    || prepareControlRail.signalBar
    || (Array.isArray(prepareSignalBar) ? { items: prepareSignalBar } : prepareSignalBar)
    || {
      items: buildPrepareSignalBar({
        stageLabel: currentPhaseLabel,
        readinessLabel: readiness.label,
        readinessDetail: readiness.detail,
        readinessTone: readiness.tone,
        hasBlocking,
        nextActionLabel,
        nextActionSummary: prepareTextDefaults.nextActionSummary,
        replyLabel: prepareTextDefaults.replyLabel,
      }),
    };
  const resolvedPrepareStatusStack = buildUnifiedWorkflowStatusStack({
    workflow: resolvedPrepareWorkflow.statusStack,
    copilot: prepareCopilot?.mainline?.statusStack,
    controlRail: prepareControlRail.statusStack,
    stateItems: statePrepareStatusStack,
    fallbackBuilder: () => buildPrepareStatusStack({
      readinessLabel: readiness.label,
      readinessDetail: readiness.detail,
      readinessTone: readiness.tone,
      hasBlocking,
      nextActionLabel,
      nextActionSummary: prepareTextDefaults.nextActionSummary,
    }),
  });
  const resolvedPrepareCollaboration = buildUnifiedWorkflowCollaboration(unifiedPrepareStatus, {
    base: prepareContractState.collaboration || statePrepareCollaboration,
    workflow: resolvedPrepareWorkflow.collaboration,
    view: resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'collaboration', null),
    confirmation: prepareContractState.confirmation || prepareConfirmationState,
    timeline: resolvedPrepareTimeline,
    dialogue: finalizedPrepareDialogueStatus,
  });
  const prepareTransitionStatus = resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'transitionStatus', {});
  const prepareGuideSection = resolveWorkspaceStageSection(pageState, 'prepare', prepareView, preparePageData, 'guide');
  const prepareVisibilitySection = resolveWorkspaceStageSection(pageState, 'prepare', prepareView, preparePageData, 'visibility');
  const prepareDirectionSection = resolveWorkspaceStageSection(pageState, 'prepare', prepareView, preparePageData, 'direction');
  const prepareReadinessSection = resolveWorkspaceStageSection(pageState, 'prepare', prepareView, preparePageData, 'readiness');
  const prepareAssetsSection = resolveWorkspaceStageSection(pageState, 'prepare', prepareView, preparePageData, 'assets');
  const workspaceHomePath = path.join(outputDir, 'workspace_home.html');
  const resultWorkspacePath = path.join(outputDir, 'result_workspace.html');
  const templateName = String(
    preparePageData.templateName ||
    statePrepare.templateName ||
    ''
  ).trim() || '未检测';
  const mainDirection = String(
    preparePageData.mainDirection ||
    statePrepare.mainDirection ||
    '未提供'
  ).trim() || '未提供';
  const styleDirection = String(
    preparePageData.styleDirection ||
    statePrepare.styleDirection ||
    '未指定'
  ).trim() || '未指定';
  const sceneDirection = String(
    preparePageData.sceneDirection ||
    statePrepare.sceneDirection ||
    '未指定'
  ).trim() || '未指定';
  const promptCount = Number(pageMetrics.promptCount || statePrepare.promptCount || pageState?.counts?.selected || 0);
  const batchCount = Number(pageMetrics.batchCount || statePrepare.batchCount || pageState?.counts?.batches || 0);
  const assetCount = Number(preparePageData.assetCount || statePrepare.assetCount || 0)
    || Number(pageMetrics.referenceCount || assetSummary.referenceCount || importedBindingCount || 0);
  const userFacingAssetOverview = buildWorkspaceFallbackAssetOverview({
    stageKey: 'prepare',
    referenceCount: assetCount,
    reviewCount: readiness.cautionItems.length,
    exceptionCount: readiness.blockingItems.length,
    overviewBuilder: buildUserFacingAssetOverview,
  }).overview;
  const normalizedPrepareGuideSection = resolveWorkspaceGuideSectionData(
    prepareGuideSection,
    buildWorkspaceStageGuideFallback('prepare', {
      entryGuideTitle: entryGuide?.title || fallbackEntryGuide?.title,
      entryGuideItems: entryGuide?.items || fallbackEntryGuide?.items,
      guideCopy: entryGuide?.copy || fallbackEntryGuide?.copy,
    })
  );
  const normalizedPrepareVisibilitySection = resolveWorkspaceGuideSectionData(
    prepareVisibilitySection,
    buildWorkspaceStageVisibilityFallback('prepare', {
      visibilityTitle: visibilityGuide?.title || fallbackAssetGuide?.title,
      visibilityCopy: visibilityGuide?.copy || fallbackAssetGuide?.copy,
      visibilityItems: visibilityGuide?.items || fallbackAssetGuide?.items,
    })
  );
  const normalizedPrepareDirectionSection = resolveWorkspaceDirectionSectionData(
    prepareDirectionSection
  );
  const normalizedPrepareReadinessSection = resolveWorkspaceReadinessSectionData(
    prepareReadinessSection,
    {
    blockingItems: readiness.blockingItems,
    cautionItems: readiness.cautionItems,
  });
  const normalizedPrepareAssetsSection = resolveWorkspaceAssetsSectionData(
    prepareAssetsSection,
    prepareAssetsSection
  );
  const resolvedPrepareCockpitSummary = buildUnifiedWorkflowCockpitSummary({
    base: statePrepareCockpitSummary,
    workflow: resolvedPrepareWorkflow.cockpitSummary,
    copilot: prepareCopilot?.hero?.cockpitSummary,
    view: resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'cockpitSummary', null),
    items: prepareFallbackState.cockpitItems,
  });
  const resolvedPrepareJudgment = buildUnifiedWorkflowJudgment({
    stageConfig: {
      title: resolvedPrepareWorkflow.language.judgmentTitle,
      copy: resolvedPrepareWorkflow.language.judgmentCopy,
    },
    base: {
      ...prepareFallbackState.judgmentBase,
      statusLabel: readiness.label,
      statusSummary: prepareTextDefaults.statusSummary,
      statusTone: readiness.tone,
      actionLabel: String(preparePrimaryAction?.label || '').trim() || prepareFallbackState.judgmentBase.actionLabel || primaryActionLabel,
      actionSummary: prepareActionSummary || currentSummary,
      replyLabel: prepareTextDefaults.replyLabel,
    },
    baseState: statePrepareJudgment,
    copilot: prepareCopilot?.mainline?.judgment,
    workflow: resolvedPrepareWorkflow.judgment,
    view: resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'judgment', null),
  });
  const resolvedPrepareConfirmationState = buildUnifiedWorkflowConfirmation(unifiedPrepareStatus, {
    fallback: prepareContractState.confirmation || prepareConfirmationState,
    page: preparePageData.confirmation,
    state: statePrepare.confirmation,
    view: prepareView?.confirmation,
  });
  const chrome = getWorkspaceStageChrome('prepare');
  const denseCopy = getWorkspaceDenseCopy('prepare');
  const {
    shell,
    governance,
    layout,
    surfaceRules,
    governedWorkbenchIds,
    modeSwitch,
  } = resolveWorkspaceShellRuntime(pageState, 'prepare', prepareView);
  const resolvedPrepareDecision = buildUnifiedWorkflowDecision({
    stageConfig: {
      title: chrome.decisionTitle,
      copy: chrome.decisionCopy,
    },
    base: buildWorkspaceDecisionSectionData({
      items: buildWorkspaceDecisionItems({
        reasonValue: prepareCurrentFocus,
        riskValue: prepareTransitionSummary || (hasBlocking ? '当前阻塞项会直接影响执行稳定性。' : (readiness.cautionItems?.[0] || '当前主要是细节风险，不是硬阻塞。')),
        pageValue: prepareStageSummary || resolvedPrepareWorkflow.language.pagePurpose,
      }),
    }),
    state: statePrepareDecision,
    view: resolveWorkspaceStageViewValue(pageState, 'prepare', prepareView, 'decision', null),
  });
  const resolvedPrepareSummary = resolveWorkspaceStageSummarySection(
    pageState,
    'prepare',
    {
      ...prepareView,
      summary: prepareView?.summary || statePrepareSummarySection || {},
    },
    buildWorkspaceSummarySectionData({
      enabled: layout.showSummaryByDefault,
      title: chrome.summaryTitle,
      copy: chrome.summaryCopy,
      items: [
        { label: '当前阶段', value: unifiedPrepareStatus.stage || currentPhaseLabel },
        { label: '当前结论', value: unifiedPrepareStatus.conclusion || readiness.label },
        { label: '结果概况', value: userFacingAssetOverview.summary },
        { label: '当前重点', value: unifiedPrepareStatus.currentFocus || prepareCurrentFocus },
        { label: '下一步', value: nextActionLabel },
        { label: '为什么先做这一步', value: nextActionReason },
      ],
    })
  );
  const normalizedPrepareSummary = buildWorkspaceSummarySectionData(resolvedPrepareSummary || {});
  const prepareContentSections = renderPrepareWorkspaceContentArea({
    denseCopy,
    contentSections: resolveWorkspaceStageContentSectionPlan(pageState, 'prepare', prepareView, denseCopy.contentSectionOrder.map((key) => ({
      key,
      kind: key === 'readiness' ? 'prepareReadiness' : (key === 'assets' ? 'prepareAssets' : 'keyValue'),
      enabled: key === 'direction'
        ? normalizedPrepareDirectionSection.items.length > 0
        : key === 'assets'
          ? (Array.isArray(normalizedPrepareAssetsSection.items) && normalizedPrepareAssetsSection.items.length > 0)
            || (Array.isArray(normalizedPrepareAssetsSection.assetItems) && normalizedPrepareAssetsSection.assetItems.length > 0)
          : true,
    }))),
    guideSection: normalizedPrepareGuideSection,
    visibilitySection: normalizedPrepareVisibilitySection,
    directionSection: normalizedPrepareDirectionSection,
    directionItems: normalizedPrepareDirectionSection.items,
    readinessSection: normalizedPrepareReadinessSection,
    assetsSection: normalizedPrepareAssetsSection,
    assetCardsHtml: Array.isArray(normalizedPrepareAssetsSection.assetItems) && normalizedPrepareAssetsSection.assetItems.length
      ? normalizedPrepareAssetsSection.assetItems.slice(0, 6).map((item, index) => renderPrepareAssetCard(outputDir, item, index))
      : [],
  });
  const prepareFallbackBundle = buildWorkspaceStageFallbackBundle('prepare', {
    denseCopy,
    runLabel: taskLabel,
    phaseLabel: currentPhaseLabel,
    flowLabel: identity.flows.prepare,
    contextItems: prepareContext.items,
    countValues: {
      focus: prepareCurrentFocus,
      status: readiness.label,
      assets: importedBindingCount > 0 ? '这一轮已带入素材约束' : '这一轮没有素材约束',
      pressure: readiness.blockingItems.length + readiness.cautionItems.length > 0 ? '还有内容要确认' : '当前平稳',
    },
    stageSummary: prepareStageSummary,
    currentFocus: prepareCurrentFocus || currentSummary,
    resultAvailable: fileExists(resultWorkspacePath),
    resultFile: resultWorkspacePath,
    homeFile: workspaceHomePath,
    focusValue: readiness.label,
    focusSummary: readiness.detail,
    focusTone: readiness.tone,
    routeTitle: chrome.routeTitle,
    routeCopy: chrome.routeCopy,
    currentLabel: readiness.label,
    currentSummary: readiness.detail,
    previousFile: workspaceHomePath,
    nextLabel: nextActionLabel,
    nextSummary: nextActionReason || '正式执行完成后，用统一结果页做筛图、收口和下一步判断。',
    nextFile: resultWorkspacePath,
    nextCta: '进入结果工作台',
    nextPendingLabel: '执行完成后生成',
    workbenchTitle: chrome.workbenchTitle,
    workbenchCopy: chrome.workbenchCopy,
    extraWorkbenchCards: guideCards,
  });
  const fallbackWorkbenchCards = prepareFallbackBundle.workbench.cards
    .filter((card) => !governedWorkbenchIds || !card.id || governedWorkbenchIds.has(card.id));
  const resolvedPrepareWorkbench = resolveWorkspaceStageWorkbenchSection(
    pageState,
    'prepare',
    prepareView,
    { ...prepareFallbackBundle.workbench, cards: fallbackWorkbenchCards }
  );
  const resolvedPrepareRoute = resolveWorkspaceStageRouteSection(
    pageState,
    'prepare',
    prepareView,
    prepareFallbackBundle.route
  );

  const prepareHeroCards = Array.isArray(prepareView?.heroCards) ? prepareView.heroCards : [];
  const contextBarData = resolveWorkspaceStageContextBarData(pageState, 'prepare', prepareView, prepareFallbackBundle.context);
  const contextBar = renderPortalContextBar(contextBarData);

  const html = renderWorkspacePageShell({
    pageTitle: shell.pageTitle,
    currentPage: shell.currentPage,
    headAssets: renderPortalHeadAssets(),
    cssVars: shell.cssVars,
    topLinks: renderPortalTopLinks(outputDir, { currentPage: shell.currentPage, governance }),
    heroEyebrow: String(prepareHero.eyebrow || '').trim() || shell.heroEyebrow,
    heroTitle: String(prepareHero.title || '').trim() || shell.heroTitle,
    heroCopy: String(prepareHero.intro || '').trim() || shell.heroCopy,
    contextBar,
    copilotDeck: renderWorkspaceCopilotDeck({
      title: prepareCopilot?.title || resolvedPrepareWorkflow.language.deckTitle,
      copy: prepareCopilot?.copy || resolvedPrepareWorkflow.language.deckCopy,
      taskControlBar: renderWorkspaceTaskControlBar(resolvedPrepareTaskControlBar),
      sessionConsole: renderWorkspaceSessionConsoleSection(resolvedPrepareWorkflow.sessionConsole || prepareCopilot?.hero?.sessionConsole || prepareSessionConsole),
      heroMetrics: prepareHeroCards.map((card) => renderMetricCard(card.label, card.value, card.tone, card.detail, { audience: card.audience || 'all' })).join(''),
      cockpitSummary: renderWorkspaceCockpitSummarySection({
        title: resolvedPrepareWorkflow.language.cockpitTitle,
        copy: resolvedPrepareWorkflow.language.cockpitCopy,
        ...resolvedPrepareCockpitSummary,
      }),
      stageSignals: renderWorkspaceSignalBar(resolvedPrepareSignalBar),
      relayPanel: [
        renderWorkspaceDialogueStatusSection(finalizedPrepareDialogueStatus),
        renderWorkspaceCollaborationSection(resolvedPrepareCollaboration),
        renderWorkspaceConfirmationSection({
          title: resolvedPrepareWorkflow.language.confirmationTitle,
          copy: resolvedPrepareWorkflow.language.confirmationCopy,
          ...resolvedPrepareConfirmationState,
        }),
      ].filter(Boolean).join(''),
    }),
    taskControlBar: renderWorkspaceTaskControlBar(resolvedPrepareTaskControlBar),
    sessionConsole: renderWorkspaceSessionConsoleSection(resolvedPrepareWorkflow.sessionConsole || prepareCopilot?.hero?.sessionConsole || prepareSessionConsole),
    heroMetrics: prepareHeroCards.map((card) => renderMetricCard(card.label, card.value, card.tone, card.detail, { audience: card.audience || 'all' })).join(''),
    cockpitSummary: renderWorkspaceCockpitSummarySection({
      title: resolvedPrepareWorkflow.language.cockpitTitle,
      copy: resolvedPrepareWorkflow.language.cockpitCopy,
      ...resolvedPrepareCockpitSummary,
    }),
    stageSignals: renderWorkspaceSignalBar(resolvedPrepareSignalBar),
    modeSwitch: renderPortalModeSwitch({
      title: modeSwitch.title,
      copy: modeSwitch.copy,
      defaultMode: modeSwitch.defaultMode,
      newcomerLabel: modeSwitch.newcomerLabel,
      proLabel: modeSwitch.proLabel,
    }),
    progressRail: renderPortalProgressRail(outputDir, {
      currentPage: shell.currentPage,
      title: String(resolvedPrepareProgress?.title || '').trim() || chrome.progressTitle,
      copy: String(resolvedPrepareProgress?.copy || '').trim() || chrome.progressCopy,
      visibleIds: Array.isArray(resolvedPrepareProgress?.visibleIds) && resolvedPrepareProgress.visibleIds.length ? resolvedPrepareProgress.visibleIds : undefined,
      windowRadius: surfaceRules.progressWindowRadius,
      governance,
    }),
    routeCompass: renderPortalRouteCompass(outputDir, {
      ...resolvedPrepareRoute,
      maxNextSteps: surfaceRules.routeMaxNextSteps,
    }),
    workbench: renderPortalWorkbench(outputDir, buildRenderableWorkbench({
      section: resolvedPrepareWorkbench,
      maxCards: surfaceRules.workbenchMaxCards,
    })),
    mainSections: renderWorkspaceSectionLayout('prepare', {
      flow: renderWorkspaceFlowSection({ ...prepareFlow, mode: 'compact' }),
      judgment: renderWorkspaceJudgmentPanelSection(resolvedPrepareJudgment),
      stageRelay: renderWorkspaceStageRelaySection(buildUnifiedWorkflowStageRelay(
        unifiedPrepareStatus,
        {
          workflow: resolvedPrepareWorkflow.stageRelay,
          copilot: prepareCopilot?.mainline?.stageRelay,
          view: prepareStageRelay,
          fallbackCurrentSummary: firstNonEmpty(
            prepareFallbackState.stageRelay.fallbackCurrentSummary,
            prepareTransitionSummary,
            prepareActionSummary
          ),
          fallbackNextSummary: firstNonEmpty(
            prepareFallbackState.stageRelay.fallbackNextSummary,
            prepareHandoffSummary,
            prepareTransitionSummary
          ),
        }
      )),
      statusStack: renderWorkspaceStatusStack(resolvedPrepareStatusStack),
      timeline: renderWorkspaceTimelineSection(resolvedPrepareTimeline),
      assets: renderWorkspaceAssetStatusSection(prepareAssetStatus),
      actions: renderWorkspaceActionStatusSection(finalizedPrepareActionStatus),
      transitions: renderWorkspaceTransitionStatusSection({
        ...prepareTransitionStatus,
        copy: firstNonEmpty(prepareTransitionStatus.copy, prepareTransitionSummary),
      }),
      decision: renderResolvedWorkspaceDecisionSection(resolvedPrepareDecision, {
        title: chrome.decisionTitle,
        copy: chrome.decisionCopy,
      }),
      summary: renderResolvedWorkspaceSummarySection(normalizedPrepareSummary, {
        title: chrome.summaryTitle,
        copy: chrome.summaryCopy,
      }, {
        defaultEnabled: false,
      }),
      content: prepareContentSections,
    }, { currentPage: shell.currentPage }),
  });

  fs.writeFileSync(outputPath, html);
}

main();
