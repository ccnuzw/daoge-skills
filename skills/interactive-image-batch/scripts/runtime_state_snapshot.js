const path = require('path');
const { readJsonIfExists, writeJson } = require('./script_utils');
const { deriveTaskLabel } = require('./task_label_utils');
const { translatePauseReason } = require('./run_batch_runtime');
const { buildRuntimeUnifiedStateBundle } = require('./unified_status_summary');
const { buildRuntimeConversationCopy } = require('./workspace_status_dictionary');
const { resolveV2WorkspacePage } = require('./workspace_v2_shared');

function stageTypeLabel(stageType) {
  if (stageType === 'sample') return '样本阶段';
  if (stageType === 'production') return '正式阶段';
  return '执行阶段';
}

function resolveStageMeta(outputDir, jobState) {
  const currentStageNumber = Number(jobState?.progress?.currentStage || 0) || null;
  const currentBatchNumber = Number(jobState?.progress?.currentBatch || 0) || null;
  const stagePlan = readJsonIfExists(path.join(outputDir, 'stage_plan.json'));
  const stages = Array.isArray(stagePlan?.stages) ? stagePlan.stages : [];
  const currentStage = stages.find((item) => Number(item?.stageNumber || 0) === currentStageNumber) || null;
  const stageType = currentStage?.type || null;
  return {
    currentStageNumber,
    currentBatchNumber,
    stageType,
    currentStageLabel: currentStageNumber
      ? `${stageTypeLabel(stageType)} ${currentStageNumber}`
      : null,
  };
}

function buildProgressSummary(jobState, stageMeta, manifest = null) {
  const progress = jobState?.progress || {};
  const totalBatches = Number(progress.totalBatches || manifest?.batchCount || 0);
  const completedBatches = Number(progress.completedBatches || 0);
  const success = Number(progress.success || manifest?.success || 0);
  const failed = Number(progress.failed || manifest?.failed || 0);
  const skipped = Number(progress.skipped || manifest?.skipped || 0);
  const completedPrompts = Number(progress.completedPrompts || 0);
  const selectedCount = Number(jobState?.selectedCount || manifest?.selectedCount || 0);
  const nextBatchNumber = stageMeta.currentBatchNumber || Math.min(completedBatches + 1, totalBatches || 1);

  if (jobState?.status === 'planned') {
    return `任务已经排队，待执行 ${totalBatches} 批，共 ${selectedCount} 张。`;
  }
  if (jobState?.status === 'running') {
    return `已完成 ${completedBatches}/${totalBatches} 批，当前执行第 ${nextBatchNumber} 批；成功 ${success}，失败 ${failed}，已处理 ${completedPrompts}/${selectedCount} 张。`;
  }
  if (jobState?.status === 'paused') {
    return `任务已暂停，已完成 ${completedBatches}/${totalBatches} 批；成功 ${success}，失败 ${failed}，跳过 ${skipped}。`;
  }
  if (jobState?.status === 'completed') {
    return `任务已完成，共 ${totalBatches} 批；成功 ${success}，失败 ${failed}，跳过 ${skipped}。`;
  }
  return `当前已完成 ${completedBatches}/${totalBatches} 批。`;
}

function buildRuntimeNarrative(jobState, stageMeta) {
  const status = String(jobState?.status || 'planned').trim() || 'planned';
  const pauseReason = jobState?.pauseReason || null;
  const translatedPauseReason = translatePauseReason(pauseReason);
  const currentStageLabel = stageMeta.currentStageLabel || '当前阶段';
  const currentBatchNumber = stageMeta.currentBatchNumber || null;
  const failed = Number(jobState?.progress?.failed || 0);
  const conversationCopy = buildRuntimeConversationCopy({
    runtimeStatus: status,
    currentBatch: currentBatchNumber,
    failedCount: failed,
    pauseReason: translatedPauseReason,
  });

  if (status === 'running') {
    const headline = currentBatchNumber
      ? `${currentStageLabel} · 第 ${currentBatchNumber} 批正在推进`
      : `${currentStageLabel}正在推进`;
    return {
      phaseLabel: '执行中',
      phaseHeadline: headline,
      phaseSummary: currentBatchNumber
        ? `当前正在执行第 ${currentBatchNumber} 批，建议先等待这一批完成。`
        : '当前任务已经开始执行，建议先等待当前批次结束。',
      phaseTone: 'info',
      nextActionLabel: conversationCopy.nextActionLabel,
      nextActionReason: conversationCopy.actionReason,
    };
  }

  if (status === 'paused') {
    return {
      phaseLabel: '暂停待处理',
      phaseHeadline: '任务已暂停，建议先处理风险',
      phaseSummary: translatedPauseReason,
      phaseTone: 'warn',
      nextActionLabel: conversationCopy.nextActionLabel,
      nextActionReason: conversationCopy.actionReason,
    };
  }

  if (status === 'awaiting_confirmation' || status === 'waiting') {
    return {
      phaseLabel: '等待确认',
      phaseHeadline: '任务正在等待你确认后继续',
      phaseSummary: translatedPauseReason || '当前已经停在需要确认的节点，先确认这一步，再继续最稳。',
      phaseTone: 'warn',
      nextActionLabel: conversationCopy.nextActionLabel,
      nextActionReason: conversationCopy.actionReason,
    };
  }

  if (status === 'completed') {
    return {
      phaseLabel: failed > 0 ? '结果阶段' : '已完成',
      phaseHeadline: failed > 0 ? '结果已生成，但仍有异常需处理' : '任务已完成，可继续回看结果',
      phaseSummary: failed > 0 ? '当前建议先检查失败项，再决定是否补跑。' : '当前结果已生成，可以进入结果工作台继续筛图。',
      phaseTone: failed > 0 ? 'warn' : 'good',
      nextActionLabel: conversationCopy.nextActionLabel,
      nextActionReason: conversationCopy.actionReason,
    };
  }

  return {
    phaseLabel: '准备执行',
    phaseHeadline: '任务已就绪，等待开始执行',
    phaseSummary: '当前可以开始执行，也可以先回看准备层信息。',
    phaseTone: 'info',
    nextActionLabel: conversationCopy.nextActionLabel,
    nextActionReason: conversationCopy.actionReason,
  };
}

function buildRuntimeDialogueStatus(jobState, stageMeta, manifest = null) {
  const progress = jobState?.progress || {};
  const status = String(jobState?.status || 'planned').trim() || 'planned';
  const completedBatches = Number(progress.completedBatches || 0);
  const totalBatches = Number(progress.totalBatches || manifest?.batchCount || 0);
  const currentBatch = Number(stageMeta?.currentBatchNumber || progress.currentBatch || 0);
  const selectedCount = Number(jobState?.selectedCount || manifest?.selectedCount || 0);
  const success = Number(progress.success || manifest?.success || 0);
  const failed = Number(progress.failed || manifest?.failed || 0);
  const pauseReason = translatePauseReason(jobState?.pauseReason || manifest?.pauseReason || null);
  const stageLabel = String(stageMeta?.currentStageLabel || '当前阶段').trim() || '当前阶段';
  const progressSummary = buildProgressSummary(jobState, stageMeta, manifest);
  const conversationCopy = buildRuntimeConversationCopy({
    runtimeStatus: status,
    currentBatch,
    failedCount: failed,
    pauseReason,
  });

  if (status === 'running') {
    const primarySay = conversationCopy.recommendedReply;
    return {
      title: '对话协同',
      copy: '执行进行中时，这里会把当前进展翻成一句可直接回到对话框继续的话。',
      recentItems: [
        `当前阶段: ${stageLabel}`,
        currentBatch > 0 ? `当前批次: 第 ${currentBatch} 批` : '当前批次: 正在推进',
        `任务进度: ${progressSummary}`,
      ],
      understoodItems: [
        `任务规模: 共 ${selectedCount} 张 / ${totalBatches} 批`,
        `当前结果: 成功 ${success}，失败 ${failed}`,
        '系统会继续刷新工作台，你现在不用自己判断跳转。',
      ],
      nextSayItems: conversationCopy.nextSayItems,
      primarySay,
      alternativeSayItems: conversationCopy.alternativeSayItems,
      actionReason: conversationCopy.actionReason,
      summary: progressSummary,
    };
  }

  if (status === 'paused') {
    const primarySay = conversationCopy.recommendedReply;
    return {
      title: '对话协同',
      copy: '任务暂停时，这里只保留你最适合发回对话框的下一句。',
      recentItems: [
        `当前阶段: ${stageLabel}`,
        '任务状态: 已暂停',
        `暂停原因: ${pauseReason}`,
      ],
      understoodItems: [
        `当前结果: 成功 ${success}，失败 ${failed}`,
        '系统已经判断这轮需要先处理风险，再回主链。',
      ],
      nextSayItems: conversationCopy.nextSayItems,
      primarySay,
      alternativeSayItems: conversationCopy.alternativeSayItems,
      actionReason: conversationCopy.actionReason,
      summary: pauseReason,
    };
  }

  if (status === 'awaiting_confirmation' || status === 'waiting') {
    const primarySay = conversationCopy.recommendedReply;
    return {
      title: '对话协同',
      copy: '任务等待确认时，这里只保留最适合回到对话框的下一句。',
      recentItems: [
        `当前阶段: ${stageLabel}`,
        '任务状态: 等待确认',
        `任务进度: ${progressSummary}`,
      ],
      understoodItems: [
        `当前结果: 成功 ${success}，失败 ${failed}`,
        '系统已经把这轮任务停在当前确认点，不需要你自己猜下一跳。',
      ],
      nextSayItems: conversationCopy.nextSayItems,
      primarySay,
      alternativeSayItems: conversationCopy.alternativeSayItems,
      confirmItems: [
        pauseReason || '当前还差一次确认',
      ].filter(Boolean),
      actionReason: conversationCopy.actionReason,
      summary: pauseReason || progressSummary,
    };
  }

  if (status === 'completed') {
    const hasFailed = failed > 0;
    const primarySay = conversationCopy.recommendedReply;
    return {
      title: '对话协同',
      copy: '任务完成后，这里会直接把“下一句怎么说”收成统一入口。',
      recentItems: [
        `当前阶段: ${hasFailed ? '结果阶段' : '已完成'}`,
        `任务进度: ${progressSummary}`,
      ],
      understoodItems: [
        `当前结果: 成功 ${success}，失败 ${failed}`,
        hasFailed ? '系统已经判断先收异常更稳。' : '系统已经判断可以直接进入筛图和收口。',
      ],
      nextSayItems: conversationCopy.nextSayItems,
      primarySay,
      alternativeSayItems: conversationCopy.alternativeSayItems,
      actionReason: conversationCopy.actionReason,
      summary: progressSummary,
    };
  }

  const primarySay = conversationCopy.recommendedReply;
  return {
    title: '对话协同',
    copy: '任务待开始时，这里会把当前准备状态翻成一句直接可说的话。',
    recentItems: [
      `当前阶段: ${stageLabel}`,
      `任务进度: ${progressSummary}`,
    ],
    understoodItems: [
      `任务规模: 共 ${selectedCount} 张 / ${totalBatches} 批`,
      '系统已经接住这轮任务，但还没有正式开始执行。',
    ],
    nextSayItems: [
      ...conversationCopy.nextSayItems,
    ],
    primarySay,
    alternativeSayItems: conversationCopy.alternativeSayItems,
    actionReason: conversationCopy.actionReason,
    summary: progressSummary,
  };
}

function buildRuntimeWorkflowState(options = {}) {
  const nextAction = options.nextAction && typeof options.nextAction === 'object'
    ? options.nextAction
    : {};
  const dialogue = options.dialogue && typeof options.dialogue === 'object'
    ? options.dialogue
    : {};
  return {
    currentStatus: String(options.currentStatus || '').trim() || 'planned',
    stageLabel: String(options.stageLabel || '').trim(),
    headline: String(options.headline || '').trim(),
    summary: String(options.summary || '').trim(),
    tone: String(options.tone || '').trim() || 'info',
    taskLabel: String(options.taskLabel || '').trim(),
    progressSummary: String(options.progressSummary || '').trim(),
    nextAction: {
      label: String(nextAction.label || '').trim(),
      reason: String(nextAction.reason || '').trim(),
      target: String(nextAction.target || '').trim() || null,
    },
    dialogue: {
      primarySay: String(dialogue.primarySay || '').trim(),
      actionReason: String(dialogue.actionReason || '').trim(),
      summary: String(dialogue.summary || '').trim(),
      nextSayItems: Array.isArray(dialogue.nextSayItems) ? dialogue.nextSayItems : [],
      alternativeSayItems: Array.isArray(dialogue.alternativeSayItems) ? dialogue.alternativeSayItems : [],
      recentItems: Array.isArray(dialogue.recentItems) ? dialogue.recentItems : [],
      understoodItems: Array.isArray(dialogue.understoodItems) ? dialogue.understoodItems : [],
    },
  };
}

function resolveRuntimeSurfacePath(outputDir, pageId) {
  if (!outputDir) return null;
  return resolveV2WorkspacePage(outputDir, pageId);
}

function resolveRuntimeNextActionTarget(outputDir, jobState, manifest = {}) {
  const status = String(jobState?.status || 'planned').trim() || 'planned';
  const failedCount = Number(jobState?.progress?.failed || manifest?.failed || 0);
  if (status === 'paused') return resolveRuntimeSurfacePath(outputDir, 'issues');
  if (status === 'completed') {
    return resolveRuntimeSurfacePath(
      outputDir,
      failedCount > 0 ? 'issues' : 'results'
    );
  }
  return resolveRuntimeSurfacePath(outputDir, 'index');
}

function buildRuntimeStateSnapshot(outputDir, options = {}) {
  const jobStatePath = path.join(outputDir, 'job_state.json');
  const checkpointPath = path.join(outputDir, 'checkpoint.json');
  const manifestPath = path.join(outputDir, 'manifest.json');
  const jobState = options.jobState || readJsonIfExists(jobStatePath);
  if (!jobState || typeof jobState !== 'object') return null;
  const checkpoint = options.checkpoint || readJsonIfExists(checkpointPath);
  const manifest = options.manifest || readJsonIfExists(manifestPath) || {};
  const stageMeta = resolveStageMeta(outputDir, jobState);
  const progress = jobState.progress || {};
  const completedBatchCount = Number(progress.completedBatches || 0);
  const totalBatches = Number(progress.totalBatches || manifest?.batchCount || 0);
  const pendingBatchCount = Math.max(totalBatches - completedBatchCount, 0);
  const progressSummary = buildProgressSummary(jobState, stageMeta, manifest);
  const narrative = buildRuntimeNarrative(jobState, stageMeta);
  const dialogueStatus = buildRuntimeDialogueStatus(jobState, stageMeta, manifest);
  const taskLabel = deriveTaskLabel({
    taskLabel: options.taskLabel || manifest?.taskLabel || '',
    selectedCount: Number(jobState.selectedCount || manifest?.selectedCount || 0),
    sampleSize: Number(jobState.sampleSize || manifest?.sampleSize || 0),
    pauseReason: jobState.pauseReason || manifest?.pauseReason || null,
    resumeManifest: manifest?.resumeManifest || null,
  }, outputDir);
  const runtimeBundle = buildRuntimeUnifiedStateBundle({
    outputDir,
    currentStatus: String(jobState.status || 'planned'),
    stageLabel: narrative.phaseLabel,
    headline: narrative.phaseHeadline,
    summary: narrative.phaseSummary,
    tone: narrative.phaseTone,
    taskLabel,
    progressSummary,
    nextActionLabel: narrative.nextActionLabel,
    nextActionReason: narrative.nextActionReason,
    nextActionTarget: resolveRuntimeNextActionTarget(outputDir, jobState, manifest),
    dialogueStatus,
    failedCount: Number(progress.failed || manifest?.failed || 0),
  });

  return {
    outputDir,
    generatedAt: String(jobState.createdAt || manifest?.generatedAt || new Date().toISOString()),
    updatedAt: String(jobState.updatedAt || checkpoint?.writtenAt || new Date().toISOString()),
    taskLabel,
    currentStatus: String(jobState.status || 'planned'),
    currentStage: stageMeta.currentStageLabel,
    currentBatch: stageMeta.currentBatchNumber,
    completedBatchCount,
    pendingBatchCount,
    totalBatchCount: totalBatches,
    progressSummary,
    runningTask: taskLabel,
    nextSuggestedAction: runtimeBundle.nextSuggestedAction,
    phaseLabel: narrative.phaseLabel,
    phaseHeadline: narrative.phaseHeadline,
    phaseSummary: narrative.phaseSummary,
    phaseTone: narrative.phaseTone,
    nextActionLabel: narrative.nextActionLabel,
    nextActionReason: narrative.nextActionReason,
    runtimeWorkflow: runtimeBundle.runtimeWorkflow,
    unifiedStatus: runtimeBundle.unifiedStatus,
    copilotSummary: runtimeBundle.copilotSummary,
    runtimeCopilotProtocol: runtimeBundle.runtimeCopilotProtocol,
    liveCopilotDirective: runtimeBundle.liveCopilotDirective,
    workflowDialogue: runtimeBundle.workflowDialogue,
    dialogueStatus,
    successCount: Number(progress.success || manifest?.success || 0),
    failedCount: Number(progress.failed || manifest?.failed || 0),
    skippedCount: Number(progress.skipped || manifest?.skipped || 0),
    reviewCount: 0,
    selectedCount: Number(jobState.selectedCount || manifest?.selectedCount || 0),
    pauseReason: jobState.pauseReason || manifest?.pauseReason || null,
    sourceFiles: {
      jobState: jobStatePath,
      checkpoint: checkpointPath,
      manifest: manifestPath,
    },
  };
}

function runtimeStateFilePath(outputDir) {
  return path.join(path.resolve(outputDir), 'runtime_state.json');
}

function writeRuntimeStateSnapshot(outputDir, options = {}) {
  const snapshot = buildRuntimeStateSnapshot(outputDir, options);
  if (!snapshot) return null;
  const outputFile = runtimeStateFilePath(outputDir);
  writeJson(outputFile, {
    schemaVersion: 1,
    kind: 'daoge-runtime-state',
    role: 'shared-runtime-snapshot',
    stateSources: snapshot.sourceFiles,
    ...snapshot,
  });
  return {
    outputFile,
    snapshot,
  };
}

module.exports = {
  buildRuntimeDialogueStatus,
  buildRuntimeWorkflowState,
  buildRuntimeStateSnapshot,
  buildProgressSummary,
  buildRuntimeNarrative,
  resolveStageMeta,
  runtimeStateFilePath,
  writeRuntimeStateSnapshot,
};
