const path = require('path');
const { buildRuntimeConversationCopy } = require('./workspace_status_dictionary');

function cleanText(value, fallback = '') {
  const text = String(value || '').trim();
  return text || fallback;
}

function normalizeTone(status) {
  const tone = cleanText(status).toLowerCase();
  if (['bad', 'warn', 'good', 'info'].includes(tone)) return tone;
  if (tone === 'paused') return 'warn';
  if (tone === 'completed') return 'good';
  return 'info';
}

function normalizeAction(action = {}) {
  if (!action || typeof action !== 'object') return null;
  const label = cleanText(action.label);
  const reason = cleanText(action.reason);
  const target = cleanText(action.target);
  const recommendedReply = cleanText(action.recommendedReply);
  if (!label && !reason && !target && !recommendedReply) return null;
  return {
    label,
    reason,
    target: target || null,
    recommendedReply: recommendedReply || null,
  };
}

function normalizeDialogue(dialogue = {}) {
  if (!dialogue || typeof dialogue !== 'object') return null;
  const primarySay = cleanText(dialogue.primarySay);
  const actionReason = cleanText(dialogue.actionReason || dialogue.summary);
  const summary = cleanText(dialogue.summary);
  const nextSayItems = Array.isArray(dialogue.nextSayItems)
    ? dialogue.nextSayItems.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const alternativeSayItems = Array.isArray(dialogue.alternativeSayItems)
    ? dialogue.alternativeSayItems.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const confirmItems = Array.isArray(dialogue.confirmItems)
    ? dialogue.confirmItems.map((item) => cleanText(item)).filter(Boolean)
    : [];
  if (!primarySay && !actionReason && !summary && !nextSayItems.length && !alternativeSayItems.length && !confirmItems.length) return null;
  return {
    primarySay,
    actionReason,
    summary,
    nextSayItems,
    alternativeSayItems,
    confirmItems,
  };
}

function resolveRecommendedReply(options = {}) {
  return cleanText(
    options.recommendedReply
    || options.dialogue?.primarySay
    || options.dialogue?.nextSayItems?.[0]
    || options.nextAction?.recommendedReply
  );
}

function resolveNextActionSummary(options = {}) {
  return cleanText(
    options.nextActionSummary
    || options.nextAction?.reason
    || options.currentFocus
    || options.progress
    || options.conclusion
  );
}

function resolveCurrentFocus(options = {}) {
  return cleanText(
    options.currentFocus
    || options.nextActionSummary
    || options.nextAction?.reason
    || options.progress
    || options.conclusion
  );
}

function resolveStatusSummary(options = {}) {
  return cleanText(
    options.statusSummary
    || options.progress
    || options.currentFocus
    || options.nextActionSummary
    || options.conclusion
  );
}

function buildPressureState(options = {}) {
  const tone = normalizeTone(options.status);
  const explicitLabel = cleanText(options.pressureLabel);
  const explicitSummary = cleanText(options.pressureSummary);
  if (explicitLabel || explicitSummary) {
    return {
      pressureLabel: explicitLabel || (tone === 'bad' ? '当前有待处理问题' : '当前平稳'),
      pressureSummary: explicitSummary || cleanText(options.currentFocus || options.progress || options.conclusion),
      pressureTone: cleanText(options.pressureTone) || tone,
    };
  }

  const defaultLabelMap = {
    bad: '当前有待处理问题',
    warn: '还有内容建议再确认',
    good: '当前平稳',
    info: '按当前主链继续',
  };
  return {
    pressureLabel: defaultLabelMap[tone] || '按当前主链继续',
    pressureSummary: cleanText(options.currentFocus || options.progress || options.conclusion),
    pressureTone: cleanText(options.pressureTone) || tone,
  };
}

function buildUnifiedStatusSummary(options = {}) {
  const stage = cleanText(options.stage);
  const conclusion = cleanText(options.conclusion);
  const rawCurrentFocus = cleanText(options.currentFocus);
  const progress = cleanText(options.progress);
  const status = cleanText(options.status);
  const taskLabel = cleanText(options.taskLabel);
  const nextAction = normalizeAction(options.nextAction);
  const dialogue = normalizeDialogue(options.dialogueStatus);
  const nextActionSummary = resolveNextActionSummary({
    nextActionSummary: options.nextActionSummary,
    nextAction,
    currentFocus: rawCurrentFocus,
    progress,
    conclusion,
  });
  const currentFocus = resolveCurrentFocus({
    currentFocus: rawCurrentFocus,
    nextActionSummary,
    nextAction,
    progress,
    conclusion,
  });
  const recommendedReply = resolveRecommendedReply({
    recommendedReply: options.recommendedReply,
    dialogue,
    nextAction,
  });
  const statusLabel = cleanText(options.statusLabel || conclusion || stage);
  const statusSummary = resolveStatusSummary({
    statusSummary: options.statusSummary,
    progress,
    currentFocus,
    nextActionSummary,
    conclusion,
  });
  const focusSummary = cleanText(
    options.focusSummary
    || currentFocus
    || nextActionSummary
    || progress
    || conclusion
  );
  const progressSummary = cleanText(
    options.progressSummary
    || progress
    || statusSummary
    || currentFocus
    || conclusion
  );
  const pressureState = buildPressureState({
    status,
    conclusion,
    currentFocus,
    progress,
    pressureLabel: options.pressureLabel,
    pressureSummary: options.pressureSummary,
    pressureTone: options.pressureTone,
  });

  return {
    stage: stage || null,
    conclusion: conclusion || null,
    currentFocus: currentFocus || null,
    progress: progress || null,
    status: status || null,
    taskLabel: taskLabel || null,
    statusLabel: statusLabel || null,
    statusSummary: statusSummary || null,
    focusSummary: focusSummary || null,
    progressSummary: progressSummary || null,
    pressureLabel: pressureState.pressureLabel || null,
    pressureSummary: pressureState.pressureSummary || null,
    pressureTone: pressureState.pressureTone || null,
    nextActionSummary: nextActionSummary || null,
    recommendedReply: recommendedReply || null,
    nextAction,
    dialogue,
  };
}

function buildStageUnifiedStatus(options = {}) {
  const baseNextAction = options.nextAction && typeof options.nextAction === 'object'
    ? options.nextAction
    : {
        label: options.nextActionLabel,
        reason: options.nextActionReason,
        target: options.nextActionTarget,
      };
  const recommendedReply = resolveRecommendedReply({
    recommendedReply: options.recommendedReply,
    dialogue: options.dialogueStatus,
    nextAction: baseNextAction,
  });
  const nextSayItems = Array.isArray(options.nextSayItems)
    ? options.nextSayItems.map((item) => cleanText(item)).filter(Boolean)
    : [recommendedReply].filter(Boolean);
  const alternativeSayItems = Array.isArray(options.alternativeSayItems)
    ? options.alternativeSayItems.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const confirmItems = Array.isArray(options.confirmItems)
    ? options.confirmItems.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const dialogueSummary = cleanText(
    options.dialogueSummary
    || options.actionReason
    || options.statusSummary
    || options.progressSummary
    || options.progress
  );
  const nextAction = {
    ...(baseNextAction || {}),
    recommendedReply: cleanText(baseNextAction?.recommendedReply || recommendedReply) || null,
  };

  return buildUnifiedStatusSummary({
    stage: options.stage,
    conclusion: options.conclusion,
    currentFocus: options.currentFocus,
    progress: options.progress,
    status: options.status,
    taskLabel: options.taskLabel,
    statusLabel: options.statusLabel,
    statusSummary: options.statusSummary,
    focusSummary: options.focusSummary,
    progressSummary: options.progressSummary,
    pressureLabel: options.pressureLabel,
    pressureSummary: options.pressureSummary,
    pressureTone: options.pressureTone,
    nextAction,
    nextActionSummary: options.nextActionSummary || options.nextActionReason,
    recommendedReply,
    dialogueStatus: {
      primarySay: recommendedReply,
      actionReason: cleanText(options.actionReason || options.dialogueStatus?.actionReason || dialogueSummary),
      summary: cleanText(options.dialogueStatus?.summary || dialogueSummary),
      nextSayItems,
      alternativeSayItems: Array.isArray(options.dialogueStatus?.alternativeSayItems) && options.dialogueStatus.alternativeSayItems.length
        ? options.dialogueStatus.alternativeSayItems.map((item) => cleanText(item)).filter(Boolean)
        : alternativeSayItems,
      confirmItems: Array.isArray(options.dialogueStatus?.confirmItems) && options.dialogueStatus.confirmItems.length
        ? options.dialogueStatus.confirmItems.map((item) => cleanText(item)).filter(Boolean)
        : confirmItems,
    },
  });
}

function buildStageUiUnifiedStatus(options = {}) {
  const stageLabel = cleanText(options.stageLabel);
  const sessionConsole = options.sessionConsole && typeof options.sessionConsole === 'object'
    ? options.sessionConsole
    : null;
  const taskControlBar = options.taskControlBar && typeof options.taskControlBar === 'object'
    ? options.taskControlBar
    : null;
  const dialogueStatus = options.dialogueStatus && typeof options.dialogueStatus === 'object'
    ? options.dialogueStatus
    : null;
  const confirmation = options.confirmation && typeof options.confirmation === 'object'
    ? options.confirmation
    : null;
  const nextAction = options.nextAction && typeof options.nextAction === 'object'
    ? options.nextAction
    : {};
  const runtimeNextAction = options.runtimeNextAction && typeof options.runtimeNextAction === 'object'
    ? options.runtimeNextAction
    : {};
  const runtimeOverrides = options.runtimeOverrides && typeof options.runtimeOverrides === 'object'
    ? options.runtimeOverrides
    : {};
  const sessionItems = Array.isArray(sessionConsole?.items) ? sessionConsole.items : [];
  const taskItem = sessionItems[0] || {};
  const stageItem = sessionItems[1] || {};
  const statusItem = sessionItems[2] || {};
  const pressureItem = sessionItems[3] || {};

  return buildStageUnifiedStatus({
    stage: cleanText(runtimeOverrides.stage || stageLabel || stageItem.value),
    conclusion: cleanText(runtimeOverrides.conclusion || statusItem.value || taskItem.value),
    currentFocus: cleanText(runtimeOverrides.currentFocus || runtimeNextAction.reason || nextAction.reason),
    progress: cleanText(runtimeOverrides.progress || statusItem.summary || confirmation?.summary),
    status: cleanText(runtimeOverrides.status || statusItem.tone, 'info'),
    taskLabel: cleanText(runtimeOverrides.taskLabel || taskControlBar?.taskLabel || taskItem.value),
    statusLabel: cleanText(runtimeOverrides.statusLabel || taskControlBar?.statusLabel || statusItem.value),
    statusSummary: cleanText(runtimeOverrides.statusSummary || taskControlBar?.statusSummary || statusItem.summary || confirmation?.summary),
    pressureLabel: cleanText(runtimeOverrides.pressureLabel || taskControlBar?.pressureLabel),
    pressureSummary: cleanText(runtimeOverrides.pressureSummary || taskControlBar?.pressureSummary || pressureItem.summary),
    pressureTone: cleanText(runtimeOverrides.pressureTone || taskControlBar?.pressureTone || pressureItem.tone),
    progressSummary: cleanText(runtimeOverrides.progressSummary || taskControlBar?.progressSummary || statusItem.summary || confirmation?.summary),
    nextActionLabel: cleanText(runtimeNextAction.label || nextAction.label || taskControlBar?.nextActionLabel),
    nextActionReason: cleanText(runtimeNextAction.reason || nextAction.reason || taskControlBar?.nextActionSummary),
    nextActionTarget: runtimeNextAction.target || nextAction.target || null,
    recommendedReply: cleanText(dialogueStatus?.primarySay || confirmation?.recommendedReply),
    actionReason: cleanText(dialogueStatus?.actionReason || confirmation?.summary),
    dialogueSummary: cleanText(dialogueStatus?.summary || confirmation?.summary),
    nextSayItems: Array.isArray(dialogueStatus?.nextSayItems) && dialogueStatus.nextSayItems.length
      ? dialogueStatus.nextSayItems
      : [confirmation?.recommendedReply].filter(Boolean),
    alternativeSayItems: Array.isArray(dialogueStatus?.alternativeSayItems)
      ? dialogueStatus.alternativeSayItems
      : [pressureItem.summary].filter(Boolean),
    confirmItems: dialogueStatus?.confirmItems || confirmation?.pendingItems,
  });
}

function buildRuntimeUnifiedStateBundle(options = {}) {
  const outputDir = cleanText(options.outputDir);
  const status = cleanText(options.currentStatus, 'planned');
  const stageLabel = cleanText(options.stageLabel);
  const headline = cleanText(options.headline);
  const summary = cleanText(options.summary);
  const tone = cleanText(options.tone, 'info');
  const taskLabel = cleanText(options.taskLabel);
  const progressSummary = cleanText(options.progressSummary);
  const nextActionTarget = cleanText(options.nextActionTarget)
    || (outputDir ? `${outputDir.replace(/\/$/, '')}/workspace_home.html` : '');
  const nextAction = {
    label: cleanText(options.nextActionLabel),
    reason: cleanText(options.nextActionReason),
    target: nextActionTarget || null,
  };
  const dialogueStatus = options.dialogueStatus && typeof options.dialogueStatus === 'object'
    ? options.dialogueStatus
    : {};
  const workflowDialogue = {
    primarySay: cleanText(dialogueStatus.primarySay),
    actionReason: cleanText(dialogueStatus.actionReason),
    summary: cleanText(dialogueStatus.summary || progressSummary),
    nextSayItems: Array.isArray(dialogueStatus.nextSayItems) ? dialogueStatus.nextSayItems : [],
    alternativeSayItems: Array.isArray(dialogueStatus.alternativeSayItems) ? dialogueStatus.alternativeSayItems : [],
    recentItems: Array.isArray(dialogueStatus.recentItems) ? dialogueStatus.recentItems : [],
    understoodItems: Array.isArray(dialogueStatus.understoodItems) ? dialogueStatus.understoodItems : [],
  };
  const runtimeWorkflow = {
    currentStatus: status,
    stageLabel,
    headline,
    summary,
    tone,
    taskLabel,
    progressSummary,
    nextAction,
    dialogue: workflowDialogue,
  };
  const unifiedStatus = buildStageUnifiedStatus({
    stage: stageLabel,
    conclusion: headline,
    currentFocus: nextAction.reason,
    progress: progressSummary,
    status,
    taskLabel,
    nextAction,
    nextActionSummary: nextAction.reason,
    recommendedReply: workflowDialogue.primarySay,
    dialogueStatus: workflowDialogue,
  });
  const copilotSummary = buildCopilotSummary({
    unifiedStatus,
    dialogueStatus: workflowDialogue,
    nextAction,
    stageLabel,
    status,
    progressSummary,
    conclusion: headline,
  });
  const runtimeCopilotProtocol = buildRuntimeCopilotProtocol({
    status,
    stageLabel,
    taskLabel,
    progressSummary,
    nextAction,
    dialogueStatus: workflowDialogue,
    copilotSummary,
    failedCount: Number(options.failedCount || 0),
  });

  return {
    nextSuggestedAction: nextAction,
    workflowDialogue,
    runtimeWorkflow,
    unifiedStatus,
    copilotSummary,
    runtimeCopilotProtocol,
  };
}

function buildRuntimeCopilotProtocol(options = {}) {
  const status = cleanText(options.status || options.currentStatus, 'planned');
  const stageLabel = cleanText(options.stageLabel || options.stage, '当前阶段');
  const taskLabel = cleanText(options.taskLabel, '未命名任务');
  const progressSummary = cleanText(options.progressSummary);
  const nextAction = options.nextAction && typeof options.nextAction === 'object' ? options.nextAction : {};
  const dialogueStatus = options.dialogueStatus && typeof options.dialogueStatus === 'object' ? options.dialogueStatus : {};
  const copilotSummary = options.copilotSummary && typeof options.copilotSummary === 'object' ? options.copilotSummary : {};
  const primarySay = cleanText(dialogueStatus.primarySay || copilotSummary.recommendedReply);
  const actionReason = cleanText(dialogueStatus.actionReason || copilotSummary.nextActionSummary || nextAction.reason || progressSummary);
  const nextActionLabel = cleanText(nextAction.label || copilotSummary.nextActionLabel);
  const statusConfig = {
    running: {
      cadenceLabel: '运行中',
      userFocus: '先看进度，不需要切换页面做判断。',
      pageFocus: '工作台持续刷新当前批次、成功失败数和下一步建议。',
      dialogueFocus: primarySay || '继续，先盯住当前进度',
      handoffRule: '运行中由工作台承担观察，Codex 对话只需要继续接收进度或等待当前批次结束。',
    },
    paused: {
      cadenceLabel: '暂停待处理',
      userFocus: '先处理暂停原因，再回到主链继续。',
      pageFocus: '优先看异常工作台或当前阻塞说明。',
      dialogueFocus: primarySay || '继续，先处理暂停原因',
      handoffRule: '暂停态先把风险收掉，再决定继续执行、补跑或回结果层。',
    },
    awaiting_confirmation: {
      cadenceLabel: '等待确认',
      userFocus: '先完成当前确认点，再让任务继续。',
      pageFocus: '优先看当前确认项和准备/结果交接说明。',
      dialogueFocus: primarySay || '继续，我先确认这一步',
      handoffRule: '等待确认时，对话框负责给出明确确认，工作台负责解释确认点和下一站。',
    },
    waiting: {
      cadenceLabel: '等待确认',
      userFocus: '先完成当前确认点，再让任务继续。',
      pageFocus: '优先看当前确认项和准备/结果交接说明。',
      dialogueFocus: primarySay || '继续，我先确认这一步',
      handoffRule: '等待确认时，对话框负责给出明确确认，工作台负责解释确认点和下一站。',
    },
    completed: {
      cadenceLabel: '已完成',
      userFocus: Number(options.failedCount || 0) > 0 ? '先处理异常，再回结果层收口。' : '先进入结果工作台筛图和收口。',
      pageFocus: Number(options.failedCount || 0) > 0 ? '优先看异常工作台，再回结果工作台。' : '优先看结果工作台。',
      dialogueFocus: primarySay || (Number(options.failedCount || 0) > 0 ? '继续，先处理异常' : '继续，进入结果工作台'),
      handoffRule: '完成态由结果工作台接住筛选、复核和收口；如有失败项，先交给异常工作台。',
    },
    planned: {
      cadenceLabel: '待开始',
      userFocus: '先确认准备信息，再决定是否开始执行。',
      pageFocus: '优先看准备工作台的放行判断。',
      dialogueFocus: primarySay || '继续，进入准备工作台',
      handoffRule: '待开始时先由准备工作台确认方向、批次和素材绑定，再进入执行。',
    },
  };
  const config = statusConfig[status] || statusConfig.planned;
  return {
    version: 1,
    status,
    stageLabel,
    taskLabel,
    cadenceLabel: config.cadenceLabel,
    userFocus: config.userFocus,
    pageFocus: config.pageFocus,
    dialogueFocus: config.dialogueFocus,
    handoffRule: config.handoffRule,
    progressSummary,
    nextActionLabel,
    nextActionReason: actionReason,
    primarySay: config.dialogueFocus,
  };
}

function buildLiveRunStateBundle(options = {}) {
  const runtimeSummary = options.runtimeSummary && typeof options.runtimeSummary === 'object'
    ? options.runtimeSummary
    : {};
  const fallback = options.fallback && typeof options.fallback === 'object'
    ? options.fallback
    : {};
  const outputDir = cleanText(runtimeSummary.outputDir || fallback.outputDir);
  const nextSuggestedAction = runtimeSummary.nextSuggestedAction && typeof runtimeSummary.nextSuggestedAction === 'object'
    ? runtimeSummary.nextSuggestedAction
    : {
        label: cleanText(fallback.nextActionLabel, '进入当前任务'),
        reason: cleanText(fallback.nextActionReason || fallback.phaseSummary),
        target: outputDir ? path.join(outputDir, 'workspace_home.html') : null,
      };
  const unifiedStatus = runtimeSummary.unifiedStatus && typeof runtimeSummary.unifiedStatus === 'object'
    ? runtimeSummary.unifiedStatus
    : buildStageUnifiedStatus({
      stage: cleanText(runtimeSummary.currentStage || fallback.phaseLabel),
      conclusion: cleanText(fallback.phaseHeadline || fallback.phaseSummary),
      currentFocus: cleanText(fallback.nextActionReason || fallback.phaseSummary),
      progress: cleanText(runtimeSummary.progressSummary || fallback.phaseSummary),
      status: cleanText(runtimeSummary.currentStatus),
      taskLabel: cleanText(runtimeSummary.taskLabel || fallback.taskLabel),
      nextAction: nextSuggestedAction,
      nextActionSummary: cleanText(fallback.nextActionReason || fallback.phaseSummary),
      recommendedReply: cleanText(runtimeSummary.dialogueStatus?.primarySay || fallback.pageState?.runtimeSummary?.dialogueStatus?.primarySay),
      dialogueStatus: runtimeSummary.dialogueStatus || fallback.pageState?.runtimeSummary?.dialogueStatus || null,
    });
  const copilotSummary = runtimeSummary.copilotSummary && typeof runtimeSummary.copilotSummary === 'object'
    ? runtimeSummary.copilotSummary
    : buildCopilotSummary({
      unifiedStatus,
      dialogueStatus: runtimeSummary.dialogueStatus || fallback.pageState?.runtimeSummary?.dialogueStatus || null,
      nextAction: nextSuggestedAction,
      stageLabel: cleanText(runtimeSummary.currentStage || fallback.phaseLabel),
      status: cleanText(runtimeSummary.currentStatus),
      progressSummary: cleanText(runtimeSummary.progressSummary || fallback.phaseSummary),
      conclusion: cleanText(fallback.phaseHeadline || fallback.phaseSummary),
    });
  const runtimeCopilotProtocol = runtimeSummary.runtimeCopilotProtocol && typeof runtimeSummary.runtimeCopilotProtocol === 'object'
    ? runtimeSummary.runtimeCopilotProtocol
    : buildRuntimeCopilotProtocol({
      status: cleanText(runtimeSummary.currentStatus),
      stageLabel: cleanText(runtimeSummary.currentStage || fallback.phaseLabel),
      taskLabel: cleanText(runtimeSummary.taskLabel || fallback.taskLabel),
      progressSummary: cleanText(runtimeSummary.progressSummary || fallback.phaseSummary),
      nextAction: nextSuggestedAction,
      dialogueStatus: runtimeSummary.dialogueStatus || fallback.pageState?.runtimeSummary?.dialogueStatus || null,
      copilotSummary,
      failedCount: Number(runtimeSummary.failedCount ?? fallback.failedCount ?? fallback.failed ?? 0),
    });

  return {
    nextSuggestedAction,
    unifiedStatus,
    progressSummary: cleanText(runtimeSummary.progressSummary || fallback.phaseSummary),
    runningTask: cleanText(runtimeSummary.runningTask || fallback.taskLabel, '未命名任务'),
    copilotSummary,
    runtimeCopilotProtocol,
  };
}

function buildCopilotSummary(options = {}) {
  const unifiedStatus = options.unifiedStatus && typeof options.unifiedStatus === 'object'
    ? options.unifiedStatus
    : null;
  const dialogueStatus = options.dialogueStatus && typeof options.dialogueStatus === 'object'
    ? options.dialogueStatus
    : null;
  const nextAction = options.nextAction && typeof options.nextAction === 'object'
    ? options.nextAction
    : (unifiedStatus?.nextAction && typeof unifiedStatus.nextAction === 'object' ? unifiedStatus.nextAction : {});
  const runtimeConversation = buildRuntimeConversationCopy({
    runtimeStatus: cleanText(options.status || unifiedStatus?.status),
    failedCount: Number(options.failedCount ?? unifiedStatus?.failedCount ?? unifiedStatus?.counts?.failed ?? 0),
    currentBatch: Number(options.currentBatch ?? unifiedStatus?.currentBatch ?? 0),
    pauseReason: cleanText(options.pauseReason || unifiedStatus?.pauseReason),
  });
  const recommendedReply = cleanText(
    options.recommendedReply
    || unifiedStatus?.recommendedReply
    || dialogueStatus?.primarySay
    || nextAction?.recommendedReply
    || runtimeConversation.recommendedReply
  );
  const nextActionLabel = cleanText(nextAction?.label);
  const nextActionSummary = resolveNextActionSummary({
    nextActionSummary: options.nextActionSummary,
    currentFocus: unifiedStatus?.currentFocus || unifiedStatus?.focusSummary,
    progress: options.progressSummary || unifiedStatus?.progressSummary,
    conclusion: unifiedStatus?.conclusion || unifiedStatus?.statusLabel,
    nextAction: {
      reason: cleanText(
        unifiedStatus?.nextActionSummary
        || nextAction?.reason
      ),
    },
  });
  const confirmationSummary = cleanText(
    options.confirmationSummary
    || dialogueStatus?.actionReason
    || dialogueStatus?.summary
    || unifiedStatus?.statusSummary
    || runtimeConversation.actionReason
    || options.progressSummary
  );
  const stageLabel = cleanText(options.stageLabel || unifiedStatus?.stage);
  const status = cleanText(options.status || unifiedStatus?.status);
  const progressSummary = cleanText(options.progressSummary || unifiedStatus?.progressSummary || unifiedStatus?.statusSummary);
  const conclusion = cleanText(options.conclusion || unifiedStatus?.conclusion || unifiedStatus?.statusLabel);
  const confirmItems = Array.isArray(dialogueStatus?.confirmItems)
    ? dialogueStatus.confirmItems.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const nextSayItems = Array.isArray(dialogueStatus?.nextSayItems)
    ? dialogueStatus.nextSayItems.map((item) => cleanText(item)).filter(Boolean)
    : (Array.isArray(runtimeConversation.nextSayItems) ? runtimeConversation.nextSayItems : []);

  return {
    stageLabel: stageLabel || null,
    status: status || null,
    conclusion: conclusion || null,
    progressSummary: progressSummary || null,
    nextActionLabel: nextActionLabel || null,
    nextActionSummary: nextActionSummary || null,
    recommendedReply: recommendedReply || null,
    confirmationSummary: confirmationSummary || null,
    confirmItems,
    nextSayItems,
  };
}

function normalizeRuntimeProtocolState(runtimeState = {}, fallback = {}) {
  const primary = runtimeState && typeof runtimeState === 'object' ? runtimeState : {};
  const secondary = fallback && typeof fallback === 'object' ? fallback : {};
  const primaryWorkflow = primary.runtimeWorkflow && typeof primary.runtimeWorkflow === 'object'
    ? primary.runtimeWorkflow
    : {};
  const fallbackWorkflow = secondary.runtimeWorkflow && typeof secondary.runtimeWorkflow === 'object'
    ? secondary.runtimeWorkflow
    : {};
  const workflow = Object.keys(primaryWorkflow).length ? primaryWorkflow : fallbackWorkflow;
  const primaryUnifiedStatus = primary.unifiedStatus && typeof primary.unifiedStatus === 'object'
    ? primary.unifiedStatus
    : null;
  const fallbackUnifiedStatus = secondary.unifiedStatus && typeof secondary.unifiedStatus === 'object'
    ? secondary.unifiedStatus
    : null;
  const unifiedStatusSource = primaryUnifiedStatus || fallbackUnifiedStatus;
  const workflowDialogueSource = (
    primary.workflowDialogue && typeof primary.workflowDialogue === 'object'
      ? primary.workflowDialogue
      : (secondary.workflowDialogue && typeof secondary.workflowDialogue === 'object'
        ? secondary.workflowDialogue
        : (workflow.dialogue && typeof workflow.dialogue === 'object' ? workflow.dialogue : {}))
  );
  const dialogueStatusSource = (
    primary.dialogueStatus && typeof primary.dialogueStatus === 'object'
      ? primary.dialogueStatus
      : (secondary.dialogueStatus && typeof secondary.dialogueStatus === 'object'
        ? secondary.dialogueStatus
        : workflowDialogueSource)
  );
  const nextSuggestedAction = normalizeAction(
    primary.nextSuggestedAction
    || secondary.nextSuggestedAction
    || workflow.nextAction
    || unifiedStatusSource?.nextAction
    || {
      label: primary.nextActionLabel || secondary.nextActionLabel,
      reason: primary.nextActionReason || secondary.nextActionReason,
      target: primary.nextActionTarget || secondary.nextActionTarget,
    }
  );
  const dialogueStatus = normalizeDialogue(dialogueStatusSource);
  const currentStatus = cleanText(
    primary.currentStatus
    || workflow.currentStatus
    || unifiedStatusSource?.status
    || secondary.currentStatus
  );
  const currentStage = cleanText(
    primary.currentStage
    || primary.phaseLabel
    || workflow.stageLabel
    || unifiedStatusSource?.stage
    || secondary.currentStage
    || secondary.phaseLabel
  );
  const phaseLabel = cleanText(
    primary.phaseLabel
    || workflow.stageLabel
    || unifiedStatusSource?.stage
    || secondary.phaseLabel
    || secondary.currentStage
  );
  const phaseHeadline = cleanText(
    primary.phaseHeadline
    || workflow.headline
    || unifiedStatusSource?.conclusion
    || unifiedStatusSource?.statusLabel
    || secondary.phaseHeadline
  );
  const progressSummary = cleanText(
    primary.progressSummary
    || workflow.progressSummary
    || unifiedStatusSource?.progressSummary
    || unifiedStatusSource?.statusSummary
    || secondary.progressSummary
    || primary.phaseSummary
    || secondary.phaseSummary
  );
  const phaseSummary = cleanText(
    primary.phaseSummary
    || workflow.summary
    || unifiedStatusSource?.statusSummary
    || progressSummary
    || secondary.phaseSummary
  );
  const phaseTone = cleanText(
    primary.phaseTone
    || workflow.tone
    || secondary.phaseTone
    || (currentStatus === 'paused' ? 'warn' : (currentStatus === 'completed' ? 'good' : 'info'))
  );
  const taskLabel = cleanText(
    primary.taskLabel
    || workflow.taskLabel
    || unifiedStatusSource?.taskLabel
    || primary.runningTask
    || secondary.taskLabel
    || secondary.runningTask,
    '未命名任务'
  );
  const runningTask = cleanText(primary.runningTask || secondary.runningTask || taskLabel, '未命名任务');
  const failedCount = Number(primary.failedCount ?? secondary.failedCount ?? secondary.failed ?? 0);
  const successCount = Number(primary.successCount ?? secondary.successCount ?? secondary.success ?? 0);
  const skippedCount = Number(primary.skippedCount ?? secondary.skippedCount ?? secondary.skipped ?? 0);
  const resolvedUnifiedStatus = unifiedStatusSource || buildStageUnifiedStatus({
    stage: phaseLabel || currentStage,
    conclusion: phaseHeadline || phaseSummary,
    currentFocus: cleanText(
      nextSuggestedAction?.reason
      || unifiedStatusSource?.focusSummary
      || unifiedStatusSource?.currentFocus
      || phaseSummary
    ),
    progress: progressSummary || phaseSummary,
    status: currentStatus,
    taskLabel,
    nextAction: nextSuggestedAction,
    nextActionSummary: cleanText(nextSuggestedAction?.reason || phaseSummary),
    recommendedReply: cleanText(dialogueStatus?.primarySay),
    dialogueStatus,
  });
  const workflowDialogue = {
    primarySay: cleanText(dialogueStatus?.primarySay),
    actionReason: cleanText(dialogueStatus?.actionReason),
    summary: cleanText(dialogueStatus?.summary || progressSummary),
    nextSayItems: Array.isArray(dialogueStatus?.nextSayItems) ? dialogueStatus.nextSayItems : [],
    alternativeSayItems: Array.isArray(dialogueStatus?.alternativeSayItems) ? dialogueStatus.alternativeSayItems : [],
    recentItems: Array.isArray(dialogueStatusSource?.recentItems) ? dialogueStatusSource.recentItems : [],
    understoodItems: Array.isArray(dialogueStatusSource?.understoodItems) ? dialogueStatusSource.understoodItems : [],
  };
  const runtimeWorkflow = Object.keys(workflow).length ? {
    currentStatus: cleanText(workflow.currentStatus || currentStatus, 'planned'),
    stageLabel: cleanText(workflow.stageLabel || phaseLabel || currentStage),
    headline: cleanText(workflow.headline || phaseHeadline),
    summary: cleanText(workflow.summary || phaseSummary),
    tone: cleanText(workflow.tone || phaseTone, 'info'),
    taskLabel: cleanText(workflow.taskLabel || taskLabel),
    progressSummary: cleanText(workflow.progressSummary || progressSummary),
    nextAction: normalizeAction(workflow.nextAction || nextSuggestedAction) || nextSuggestedAction || { label: '', reason: '', target: null },
    dialogue: {
      primarySay: cleanText(workflow.dialogue?.primarySay || workflowDialogue.primarySay),
      actionReason: cleanText(workflow.dialogue?.actionReason || workflowDialogue.actionReason),
      summary: cleanText(workflow.dialogue?.summary || workflowDialogue.summary),
      nextSayItems: Array.isArray(workflow.dialogue?.nextSayItems) ? workflow.dialogue.nextSayItems : workflowDialogue.nextSayItems,
      alternativeSayItems: Array.isArray(workflow.dialogue?.alternativeSayItems) ? workflow.dialogue.alternativeSayItems : workflowDialogue.alternativeSayItems,
      recentItems: Array.isArray(workflow.dialogue?.recentItems) ? workflow.dialogue.recentItems : workflowDialogue.recentItems,
      understoodItems: Array.isArray(workflow.dialogue?.understoodItems) ? workflow.dialogue.understoodItems : workflowDialogue.understoodItems,
    },
  } : {
    currentStatus: currentStatus || 'planned',
    stageLabel: phaseLabel || currentStage,
    headline: phaseHeadline,
    summary: phaseSummary,
    tone: phaseTone || 'info',
    taskLabel,
    progressSummary,
    nextAction: nextSuggestedAction || { label: '', reason: '', target: null },
    dialogue: workflowDialogue,
  };
  const copilotSummary = primary.copilotSummary && typeof primary.copilotSummary === 'object'
    ? primary.copilotSummary
    : buildCopilotSummary({
      unifiedStatus: resolvedUnifiedStatus,
      dialogueStatus,
      nextAction: nextSuggestedAction,
      stageLabel: phaseLabel || currentStage,
      status: currentStatus,
      progressSummary,
      conclusion: phaseHeadline || phaseSummary,
    });
  const runtimeCopilotProtocol = primary.runtimeCopilotProtocol && typeof primary.runtimeCopilotProtocol === 'object'
    ? primary.runtimeCopilotProtocol
    : buildRuntimeCopilotProtocol({
      status: currentStatus,
      stageLabel: phaseLabel || currentStage,
      taskLabel,
      progressSummary,
      nextAction: nextSuggestedAction,
      dialogueStatus,
      copilotSummary,
      failedCount,
    });

  return {
    outputDir: cleanText(primary.outputDir || secondary.outputDir) || null,
    taskLabel,
    currentStatus: currentStatus || null,
    currentStage: currentStage || null,
    currentBatch: primary.currentBatch ?? secondary.currentBatch ?? null,
    completedBatchCount: Number(primary.completedBatchCount ?? secondary.completedBatchCount ?? 0),
    pendingBatchCount: Number(primary.pendingBatchCount ?? secondary.pendingBatchCount ?? 0),
    totalBatchCount: Number(primary.totalBatchCount ?? secondary.totalBatchCount ?? 0),
    failedCount,
    successCount,
    skippedCount,
    progressSummary,
    updatedAt: primary.updatedAt || secondary.updatedAt || primary.generatedAt || secondary.generatedAt || null,
    runningTask,
    nextSuggestedAction,
    phaseLabel: phaseLabel || null,
    phaseHeadline: phaseHeadline || null,
    phaseSummary: phaseSummary || null,
    phaseTone: phaseTone || null,
    nextActionLabel: cleanText(nextSuggestedAction?.label) || null,
    nextActionReason: cleanText(nextSuggestedAction?.reason) || null,
    runtimeWorkflow,
    workflowDialogue,
    dialogueStatus,
    unifiedStatus: resolvedUnifiedStatus,
    copilotSummary,
    runtimeCopilotProtocol,
    sourceFiles: primary.sourceFiles || secondary.sourceFiles || {},
  };
}

module.exports = {
  buildCopilotSummary,
  buildLiveRunStateBundle,
  buildRuntimeCopilotProtocol,
  normalizeRuntimeProtocolState,
  buildRuntimeUnifiedStateBundle,
  buildStageUnifiedStatus,
  buildStageUiUnifiedStatus,
  buildUnifiedStatusSummary,
};
