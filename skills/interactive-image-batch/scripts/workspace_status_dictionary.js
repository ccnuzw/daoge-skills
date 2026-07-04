function buildHomeDecisionSummary(options = {}) {
  if (options.hasFailure) return '当前更适合先收异常，再继续主链。';
  if (options.hasResult) return '当前更适合继续筛图和收口。';
  if (options.hasPrepare) return '当前更适合先确认方向和放行。';
  return '当前更适合先从模板和方向开始。';
}

function buildHomeTaskConclusion(options = {}) {
  if (options.hasFailure) return '当前这轮任务还需要处理异常后再继续。';
  if (options.hasResult) return '当前这轮任务已经稳定，接下来重点应该放在筛图和最终取舍。';
  if (options.hasPrepare) return '当前这轮任务还处在准备阶段，先确认方向和放行条件。';
  return '当前这轮任务还没有正式开始。';
}

function buildHomeCurrentFocus(options = {}) {
  if (options.hasFailure) return '先处理异常，再回工作台继续';
  if (options.hasResult) return '先去结果工作台';
  if (options.hasPrepare) return '先确认方向和放行';
  return '先从模板入口开始';
}

function buildStageRunScaleLabel(selectedCount, batchCount) {
  return `${Number(selectedCount || 0)} 张 / ${Number(batchCount || 0)} 批`;
}

function buildHomeStaticStageCopy(options = {}) {
  const issueCount = Number(options.issueCount || 0);
  return {
    taskSummary: buildHomeTaskConclusion(options),
    consoleStageSummary: '首页负责给出当前主链入口与下一步方向。',
    pressureLabel: issueCount > 0 ? `${issueCount} 项待处理` : '当前平稳',
    pressureSummary: String(options.riskSummary || '').trim() || '当前没有明显异常压力。',
    pressureTone: issueCount > 0 ? 'warn' : 'good',
    runScaleLabel: buildStageRunScaleLabel(options.selectedCount, options.batchCount),
    runScaleSummary: `${Number(options.successCount || 0)} 成功 / ${Number(options.failedCount || 0)} 失败 / ${Number(options.reviewCount || 0)} 待复核`,
  };
}

function buildPrepareStaticStageCopy(prepareSummary = {}) {
  const blockingCount = Array.isArray(prepareSummary?.readiness?.blockingItems)
    ? prepareSummary.readiness.blockingItems.length
    : 0;
  const cautionCount = Array.isArray(prepareSummary?.readiness?.cautionItems)
    ? prepareSummary.readiness.cautionItems.length
    : 0;
  const importedBindingCount = Number(prepareSummary?.importedBindingCount || 0);

  return {
    hasBlocking: blockingCount > 0,
    nextActionLabel: blockingCount > 0 ? '先修正准备层' : '进入结果工作台',
    taskSummary: prepareSummary.mainDirection ? `当前主轴：${prepareSummary.mainDirection}` : '当前正在确认准备层方向与放行条件。',
    consoleStageSummary: '准备层负责确认方向、放行与素材绑定。',
    pressureLabel: blockingCount > 0
      ? `${blockingCount} 项阻塞`
      : (cautionCount > 0 ? `${cautionCount} 项提醒` : '当前平稳'),
    pressureSummary: prepareSummary?.readiness?.blockingItems?.[0]
      || prepareSummary?.readiness?.cautionItems?.[0]
      || '当前准备层没有明显额外压力。',
    pressureTone: blockingCount > 0 ? 'bad' : (cautionCount > 0 ? 'warn' : 'good'),
    runScaleLabel: buildStageRunScaleLabel(prepareSummary.promptCount, prepareSummary.batchCount),
    runScaleSummary: importedBindingCount > 0
      ? `${importedBindingCount} 项素材绑定`
      : '当前没有额外素材绑定',
  };
}

function buildResultStaticStageCopy(resultSummary = {}) {
  const failedCount = Number(resultSummary.failedCount || 0);
  const reviewCount = Number(resultSummary.reviewCount || 0);
  const successCount = Number(resultSummary.successCount || 0);
  const previewCount = Number(resultSummary.previewCount || 0);

  return {
    taskSummary: resultSummary.currentFocus || '当前正在做结果层取舍与分流判断。',
    consoleStageSummary: '结果层负责筛图、取舍，以及决定是否转异常。',
    pressureLabel: failedCount > 0 ? `${failedCount} 项失败` : (reviewCount > 0 ? `${reviewCount} 项待复核` : '当前平稳'),
    pressureSummary: resultSummary.nextStepReason || resultSummary.statusSummary,
    pressureTone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
    runScaleLabel: `${successCount} 成功 / ${failedCount} 失败`,
    runScaleSummary: `${reviewCount} 项待复核 / ${previewCount} 张可预览`,
  };
}

function buildExceptionStaticStageCopy(exceptionSummary = {}) {
  const totalIssueCount = Number(exceptionSummary.totalIssueCount || 0);
  const failedCount = Number(exceptionSummary.failedCount || 0);
  const reviewCount = Number(exceptionSummary.reviewCount || 0);
  const rerunCount = Number(exceptionSummary.rerunCount || 0);
  const pressureTone = String(exceptionSummary.statusTone || '').trim() || (totalIssueCount > 0 ? 'bad' : 'good');

  return {
    taskSummary: exceptionSummary.currentFocus || '当前正在处理异常相关问题。',
    consoleStageSummary: '异常层负责失败项、待复核项和补跑判断。',
    pressureLabel: totalIssueCount > 0 ? `${totalIssueCount} 项待处理` : '当前平稳',
    pressureSummary: exceptionSummary.issueSummary,
    pressureTone,
    runScaleLabel: `${failedCount} 失败 / ${reviewCount} 待复核`,
    runScaleSummary: `${rerunCount} 个补跑候选`,
  };
}

function buildUserFacingAssetOverview(options = {}) {
  const resultCount = Number(options.resultCount || 0);
  const previewCount = Number(options.previewCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const exceptionCount = Number(options.exceptionCount || 0);
  const referenceCount = Number(options.referenceCount || 0);
  const pendingCount = reviewCount + exceptionCount;
  const readyCount = Math.max(resultCount, previewCount);

  if (pendingCount > 0) {
    return {
      readyCount,
      pendingCount,
      referenceCount,
      pressureLabel: '还有内容要收口',
      summary: resultCount > 0
        ? '已经有一部分结果可以继续看，但还有内容要先收一轮。'
        : '当前先别急着往下走，先把还没收口的内容处理掉。',
    };
  }

  if (readyCount > 0) {
    return {
      readyCount,
      pendingCount,
      referenceCount,
      pressureLabel: '可以继续往下看',
      summary: '这一轮已经有可继续判断的结果，可以顺着主链继续往下走。',
    };
  }

  if (referenceCount > 0) {
    return {
      readyCount,
      pendingCount,
      referenceCount,
      pressureLabel: '素材已经就位',
      summary: '当前主要靠参考素材来约束结果，先围绕素材一致性继续判断。',
    };
  }

  return {
    readyCount,
    pendingCount,
    referenceCount,
    pressureLabel: '等待你确认下一步',
    summary: '当前还没有稳定资产可继续推进。',
  };
}

function buildHomeFlowCompletion(options = {}) {
  return options.hasIssue ? '当前主链未完全收口' : '当前主链可以继续向下';
}

function buildPrepareReadinessDetail(options = {}) {
  const tone = String(options.tone || '').trim();
  if (tone === 'bad') return '当前不建议直接执行，先把阻塞项收干净。';
  if (tone === 'warn') return '没有硬阻塞，但还有一些值得先微调的风险项。';
  return '当前准备层已经比较干净，可以进入正式生图。';
}

function buildPrepareFlowCompletion(options = {}) {
  const tone = String(options.tone || '').trim();
  if (tone === 'bad') return '准备层仍有阻塞项';
  if (tone === 'warn') return '准备层基本完成，但建议再收一轮';
  return '准备层已经可以继续';
}

function buildResultStatusLabel(options = {}) {
  if (options.failedCount > 0) return '先处理异常，再决定是否收口';
  if (options.reviewCount > 0) return '结果大体稳定，但仍有待复核项';
  return '结果层基本稳定，可以继续收口';
}

function buildResultStatusSummary(options = {}) {
  if (options.failedCount > 0) return '建议优先处理异常相关结果。';
  return '可以继续做图片取舍。';
}

function buildResultNextStepReason(options = {}) {
  if (options.failedCount > 0) return '异常集中处理更省心。';
  if (options.hasStoryboard) return '先在结果层完成取舍；只有需要核对镜头衔接时，再按需去分镜整板补充页。';
  return '先在结果层完成取舍；只有想重新总览整轮主链时，再回首页。';
}

function buildResultFlowCompletion(options = {}) {
  if (options.failedCount > 0) return '结果层仍有异常待收口';
  if (options.reviewCount > 0) return '结果层可继续，但仍有待复核项';
  return '结果层可以继续向终局收口';
}

function buildExceptionStatusLabel(options = {}) {
  if (options.totalIssueCount > 0) return '建议先统一处理异常';
  return '当前没有明显异常';
}

function buildExceptionStatusSummary(options = {}) {
  if (options.totalIssueCount > 0) return '建议先把异常收口，再考虑继续扩图。';
  return '当前可以直接回到结果工作台。';
}

function buildExceptionIssueSummary(options = {}) {
  if (options.totalIssueCount > 0) return '当前需要优先处理异常相关结果。';
  return '当前没有明显异常压力。';
}

function buildExceptionFlowCompletion(options = {}) {
  if (options.failedCount > 0) return '异常尚未清空';
  if (options.reviewCount > 0) return '当前主要剩余待复核项';
  if (Number(options.rerunCount || 0) > 0) return '当前只剩补跑价值判断';
  return '异常层当前基本清空';
}

function normalizeRuntimeConversationMode(options = {}) {
  const runtimeStatus = String(options.runtimeStatus || '').trim();
  const failedCount = Number(options.failedCount || 0);

  if (runtimeStatus === 'running') return 'running';
  if (runtimeStatus === 'paused') return 'paused';
  if (runtimeStatus === 'awaiting_confirmation' || runtimeStatus === 'waiting') return 'waiting';
  if (runtimeStatus === 'completed') return failedCount > 0 ? 'completed-failed' : 'completed-clean';
  return 'planned';
}

function buildRuntimeConversationCopy(options = {}) {
  const mode = normalizeRuntimeConversationMode(options);
  const currentBatch = Number(options.currentBatch || 0);
  const pauseReason = String(options.pauseReason || '').trim();

  if (mode === 'running') {
    const actionReason = currentBatch > 0
      ? `当前正在执行第 ${currentBatch} 批，工作台会持续刷新进度，先盯住这一批最省心。`
      : '当前任务正在执行中，工作台会持续刷新进度，先盯住当前进度最省心。';
    return {
      mode,
      nextActionLabel: '打开当前任务',
      recommendedReply: '继续，先盯住当前进度',
      actionReason,
      nextSayItems: [
        '继续，先盯住当前进度',
        currentBatch > 0 ? '这批跑完后提醒我' : '有新进展就提醒我',
        Number(options.failedCount || 0) > 0 ? '如果还有异常，先带我看问题' : '如果这一轮跑完了，直接带我看结果',
      ],
      alternativeSayItems: [
        currentBatch > 0 ? '这批跑完后提醒我' : '有新进展就提醒我',
        Number(options.failedCount || 0) > 0 ? '如果还有异常，先带我看问题' : '如果这一轮跑完了，直接带我看结果',
      ],
    };
  }

  if (mode === 'paused') {
    return {
      mode,
      nextActionLabel: '先处理暂停原因',
      recommendedReply: '继续，我先处理暂停原因',
      actionReason: pauseReason || '当前需要先处理暂停原因，再决定是否继续。',
      nextSayItems: [
        '继续，我先处理暂停原因',
        '继续，带我看现在卡在哪里',
        '继续，处理完后再回主链',
      ],
      alternativeSayItems: [
        '继续，带我看现在卡在哪里',
        '继续，处理完后再回主链',
      ],
    };
  }

  if (mode === 'waiting') {
    return {
      mode,
      nextActionLabel: '先完成当前确认',
      recommendedReply: '继续，我先确认这一步',
      actionReason: pauseReason || '当前任务正在等待确认，先把这一步确认掉，再继续最省心。',
      nextSayItems: [
        '继续，我先确认这一步',
        '继续，带我看还差确认什么',
        '继续，确认完后直接进入下一步',
      ],
      alternativeSayItems: [
        '继续，带我看还差确认什么',
        '继续，确认完后直接进入下一步',
      ],
    };
  }

  if (mode === 'completed-failed') {
    return {
      mode,
      nextActionLabel: '进入异常工作台',
      recommendedReply: '继续，先处理异常',
      actionReason: '当前已经有结果，但仍有异常残留，先收异常再继续会更稳。',
      nextSayItems: [
        '继续，先处理异常',
        '继续，带我看失败项',
        '继续，异常处理完后回主链',
      ],
      alternativeSayItems: [
        '继续，带我看失败项',
        '继续，异常处理完后回主链',
      ],
    };
  }

  if (mode === 'completed-clean') {
    return {
      mode,
      nextActionLabel: '进入结果工作台',
      recommendedReply: '继续，进入结果工作台',
      actionReason: '这一轮已经完成，接下来最自然的动作就是进入结果工作台开始筛图。',
      nextSayItems: [
        '继续，进入结果工作台',
        '继续，我开始筛图',
        '继续，我想看这一轮最终结果',
      ],
      alternativeSayItems: [
        '继续，我开始筛图',
        '继续，我想看这一轮最终结果',
      ],
    };
  }

  return {
    mode: 'planned',
    nextActionLabel: '进入当前任务',
    recommendedReply: '继续，进入工作台首页',
    actionReason: '当前任务已经排队，先回工作台首页确认执行节奏最稳妥。',
    nextSayItems: [
      '继续，进入工作台首页',
      '继续，我先确认后再开跑',
    ],
    alternativeSayItems: [
      '继续，我先确认后再开跑',
    ],
  };
}

function buildRuntimeCopilotRelayCopy(options = {}) {
  const mode = normalizeRuntimeConversationMode(options);
  const nextActionLabel = String(options.nextActionLabel || '').trim();
  const runtimeFocus = String(options.runtimeFocus || '').trim();
  const progressSummary = String(options.progressSummary || '').trim();
  const failedCount = Number(options.failedCount || 0);

  if (mode === 'running') {
    return {
      mode,
      watch: '先看实时进度，不切到其它任务内判断。',
      handoff: '等任务完成、暂停或等待确认后，再交回工作台首页、结果工作台或异常工作台。',
      currentLookValue: '先看实时进度',
      currentLookSummary: runtimeFocus || progressSummary || '任务正在推进，先让实时副驾驶继续接住进度。',
    };
  }

  if (mode === 'paused') {
    return {
      mode,
      watch: '先看暂停原因，把需要人工确认的风险收掉。',
      handoff: '处理完暂停原因后，再回工作台首页继续主链。',
      currentLookValue: '先看暂停原因',
      currentLookSummary: runtimeFocus || progressSummary || '当前暂停原因会影响主链继续，先收掉这一层。',
    };
  }

  if (mode === 'waiting') {
    return {
      mode,
      watch: '先看确认点，明确答复后再继续执行。',
      handoff: '确认完成后，任务会回到运行态或交回对应工作台继续主链。',
      currentLookValue: '先看确认点',
      currentLookSummary: runtimeFocus || progressSummary || '当前停在确认点，不需要在总控层做单轮判断。',
    };
  }

  if (mode === 'completed-failed') {
    return {
      mode,
      watch: `先进入异常工作台，把 ${failedCount || '残留'} 个异常压力收口。`,
      handoff: '异常工作台先接住失败项和补跑判断，处理后再回结果工作台收口。',
      currentLookValue: nextActionLabel || '进入异常工作台',
      currentLookSummary: runtimeFocus || progressSummary || '完成态仍有异常，先收异常比直接筛图更稳。',
    };
  }

  if (mode === 'completed-clean') {
    return {
      mode,
      watch: `先${nextActionLabel || '进入结果工作台'}，把结果筛图和收口接住。`,
      handoff: '完成态由结果工作台接住，不再停留在总控层做单轮判断。',
      currentLookValue: nextActionLabel || '进入结果工作台',
      currentLookSummary: runtimeFocus || progressSummary || '结果已经生成，可以进入结果工作台继续筛图。',
    };
  }

  return {
    mode,
    watch: runtimeFocus || progressSummary || '先选定任务，再进入工作台首页。',
    handoff: '进入单轮任务后，由工作台首页接住下一步。',
    currentLookValue: nextActionLabel || '进入工作台首页',
    currentLookSummary: runtimeFocus || progressSummary || '先回工作台首页确认当前主链位置。',
  };
}

function buildRuntimePressureCopy(options = {}) {
  const runtimeStatus = String(options.runtimeStatus || '').trim();
  const currentBatch = Number(options.currentBatch || 0);
  const progressSummary = String(options.progressSummary || '').trim();
  const runtimeSummaryText = String(options.runtimeSummaryText || '').trim();

  if (runtimeStatus === 'running') {
    return {
      pressureLabel: currentBatch > 0 ? `正在执行第 ${currentBatch} 批` : '当前正在执行',
      pressureSummary: progressSummary || '当前任务正在执行中，工作台会持续刷新。',
      pressureTone: 'info',
    };
  }

  if (runtimeStatus === 'paused') {
    return {
      pressureLabel: '任务已暂停',
      pressureSummary: runtimeSummaryText || '当前需要先处理暂停原因，再决定是否继续。',
      pressureTone: 'warn',
    };
  }

  return {
    pressureLabel: '等待确认',
    pressureSummary: runtimeSummaryText || '当前任务正在等待确认，先处理这一站。',
    pressureTone: 'warn',
  };
}

function buildRuntimeStageSummaryCopy(options = {}) {
  const runtimeStatus = String(options.runtimeStatus || '').trim();
  const stageKey = String(options.stageKey || '').trim();
  const stageCopyMap = {
    prepare: {
      running: '这一页当前转为执行进度承接台，优先告诉你跑到哪一批、是否需要介入。',
      paused: '这一页当前转为暂停处理承接台，优先告诉你为什么停下、接下来先处理什么。',
      waiting: '这一页当前转为确认承接台，优先告诉你还差哪一步确认。',
    },
    home: {
      running: '首页当前转为运行总控台，优先告诉你任务跑到哪一批、是否需要你介入。',
      paused: '首页当前转为暂停总控台，优先告诉你为什么停下、先处理什么。',
      waiting: '首页当前转为确认总控台，优先告诉你还差哪一步确认。',
    },
    result: {
      running: '结果页当前转为运行承接台，先接住执行进度，不急着提前做结果取舍。',
      paused: '结果页当前转为暂停承接台，先处理暂停原因，再回到结果判断。',
      waiting: '结果页当前转为确认承接台，先完成当前确认，再继续结果判断。',
    },
    exception: {
      running: '异常页当前转为运行承接台，先看执行进度，不提前展开问题收口判断。',
      paused: '异常页当前转为暂停承接台，先处理当前阻断，再决定是否回到异常收口。',
      waiting: '异常页当前转为确认承接台，先完成当前确认，再继续异常收口。',
    },
  };
  const modeKey = runtimeStatus === 'running'
    ? 'running'
    : (runtimeStatus === 'paused' ? 'paused' : 'waiting');

  return String(stageCopyMap?.[stageKey]?.[modeKey] || '').trim()
    || '当前页面已经转为承接实时状态的工作台。';
}

function buildRuntimeRunScaleSummary(options = {}) {
  const totalBatchCount = Number(options.totalBatchCount || 0);
  const completedBatchCount = Number(options.completedBatchCount || 0);
  const pendingBatchCount = Number(options.pendingBatchCount || 0);
  const importedBindingCount = Number(options.importedBindingCount || 0);

  if (totalBatchCount > 0) {
    return `已完成 ${completedBatchCount} 批，剩余 ${pendingBatchCount} 批`;
  }
  if (importedBindingCount > 0) {
    return `${importedBindingCount} 项素材绑定`;
  }
  return '当前没有额外素材绑定';
}

function buildRuntimeSignalCopy(options = {}) {
  const runtimeStatus = String(options.runtimeStatus || '').trim();
  const stageKey = String(options.stageKey || '').trim();
  const signalSummaryMap = {
    prepare: {
      running: '准备页当前改为承接执行进度，不再只展示静态放行判断。',
      paused: '准备页当前改为承接暂停处理，不再继续显示开跑前判断。',
      waiting: '准备页当前改为承接确认点，不再继续显示静态准备说明。',
    },
  };
  const modeKey = runtimeStatus === 'running'
    ? 'running'
    : (runtimeStatus === 'paused' ? 'paused' : 'waiting');

  return String(signalSummaryMap?.[stageKey]?.[modeKey] || '').trim();
}

function buildRuntimeStatusSummaryCopy(options = {}) {
  return String(options.runtimeSummaryText || options.progressSummary || '').trim()
    || '当前实时状态已接管这一页。';
}

function buildRuntimeStatusStackSummaryCopy(options = {}) {
  return String(options.runtimeSummaryText || options.progressSummary || '').trim()
    || '当前实时状态已进入主链。';
}

function buildRuntimeDialogueValue(options = {}) {
  return String(
    options.primarySay
    || buildRuntimeConversationCopy(options).recommendedReply
    || options.nextActionLabel
    || '继续当前主链'
  ).trim()
    || '继续当前主链';
}

function buildRuntimeNextActionLabel(options = {}) {
  const explicit = String(options.explicitLabel || '').trim();
  if (explicit) return explicit;
  return buildRuntimeConversationCopy(options).nextActionLabel;
}

function getDefaultActionStatusCopy() {
  return '这里不再让你自己从导航里猜下一步，而是直接告诉你这一步最值得先做什么。';
}

function getTaskCenterLanguage() {
  return {
    taskCountLabel: '当前任务',
    readyCountLabel: '可直接继续',
    issueCountLabel: '需要先看',
    liveActionLabel: '现在先做',
    liveReplyLabel: '回到对话框直接说',
  };
}

function getDefaultTransitionStatusCopy() {
  return '这一块只负责阶段交接，不重复整页状态，只告诉你上一站已经确认了什么、下一站先看什么。';
}

function getDefaultDialogueStatusCopy() {
  return '这一块直接把工作台和对话框接起来，告诉你系统刚接住了什么、现在已经理解了什么、还差你确认什么，以及下一句最适合怎么说。';
}

function getDefaultDialogueTitles() {
  return {
    recentTitle: '系统刚接住',
    understoodTitle: '系统已理解',
    confirmTitle: '还差你确认',
    nextSayTitle: '回到对话框直接说',
  };
}

function getWorkspaceInteractionTemplates(stage) {
  const key = String(stage || '').trim();
  const map = {
    home: {
      action: {
        secondaryPrepareSummary: '想重新确认方向、放行或素材绑定时再回看。',
        secondaryIssueSummary: '如果你已经确定要先处理问题，可以直接转去异常层。',
        noteIssue: '当前存在待处理问题，主链继续前先把异常压力收口更稳。',
        noteClear: '当前没有明显异常压力，按主链继续即可。',
        noteMainline: '首页不是第二套目录，只负责把你送到当前真正该去的地方。',
      },
      dialogue: {
        recentPhaseLabel: '工作台当前已经走到',
        recentActionLabel: '系统刚给出的主动作',
        understoodIssueNone: '待处理问题: 当前没有明显异常',
        nextSayIssue: '继续，先处理异常',
        nextSayClear: '继续，按主链往下走',
        nextSayIssueAlt: '我先把异常收口',
        nextSayClearAlt: '我继续当前主链',
      },
    },
    prepare: {
      action: {
        primaryBlocked: '当前还有会直接影响执行的准备问题，先把这些项处理干净。',
        primaryClear: '准备层已经基本到位，可以按统一主链进入结果工作台。',
        secondaryMaterialSummary: '这轮有参考素材时，建议再确认一次绑定关系和主体稳定。',
        secondaryCautionSummary: '虽然没有硬阻塞，但先收提醒项通常会让后续执行更稳。',
        noteBlocked: '准备层有阻塞时，不建议直接开跑。',
        noteClear: '没有硬阻塞时，主链可以继续。',
        noteBinding: '存在素材约束时，后续比自由生成更需要看绑定稳定。',
        noteNoBinding: '当前更适合优先判断整体方向和风格一致性。',
      },
      transition: {
        nextBlocked: '先不要急着看取舍，先确认这些问题是否已经真的解决。',
        nextClear: '先看结果层是否已经形成稳定可用的第一批图片。',
        nextBinding: '优先看主体是否稳定、绑定关系是否跑偏。',
        nextNoBinding: '优先看整体调性、构图和风格是否对味。',
        nextStable: '如果结果层平稳，就直接进入筛图和收口。',
      },
      dialogue: {
        recentReadinessLabel: '准备层刚确认的放行状态',
        recentBindingYes: '这轮任务带有素材绑定约束',
        recentBindingNo: '这轮任务当前没有素材绑定约束',
        understoodBindingNo: '素材绑定: 当前没有',
        nextSayBlocked: '继续，我先处理准备问题',
        nextSayClear: '继续，进入结果工作台',
        nextSayBinding: '继续，我想再确认素材绑定',
        nextSayNoBinding: '继续，按当前方向开跑',
        nextSayBlockedAlt: '继续，先把阻塞项收掉',
        nextSayClearAlt: '继续，直接开跑',
      },
    },
    result: {
      action: {
        primaryFailed: '先处理失败项，再决定是否继续保留和补跑。',
        primaryClear: '优先把可用结果筛清，再决定是否需要打开分镜整板补充页或复核边界图。',
        secondaryReviewSummary: '边界图、融合图或局部编辑结果建议再人工确认一眼。',
        secondaryStoryboardSummary: '只有当镜头节奏、上下文衔接重要时，再回分镜整板补充页看整体关系。',
        noteFailed: '失败项没有收口前，不建议过早做最终取舍。',
        noteClear: '当前主要精力应放在结果判断，而不是重新找入口。',
        noteReview: '待复核项通常不需要大改，只需要你做最后的人眼判断。',
        noteStable: '当前结果层已经相对稳定。',
      },
      fromPrepare: {
        nextDefault: '先看当前最值得保留的结果。',
        nextBinding: '重点确认主体稳定、边界完整和绑定是否失真。',
        nextNoBinding: '重点确认风格一致性、构图稳定和整体完成度。',
        nextFailed: '如果出现失败项，优先转去异常工作台。',
        nextClear: '如果结果稳定，就继续做筛图和最终收口。',
      },
      toException: {
        nextFailed: '先处理硬失败项，确认哪些问题会直接影响可用结果。',
        nextNoFailed: '如果没有硬失败，就先确认待复核项是否真的需要处理。',
        nextReview: '把边界、融合、主体稳定度这类待复核项一起集中看完。',
        nextNoReview: '如果只剩零散提醒，不要把异常页当成新的主控页。',
        nextNoRerun: '没有明确补跑价值时，优先做判断，不要为了补跑而补跑。',
      },
      dialogue: {
        recentStatusLabel: '结果层刚完成的判断',
        recentFailed: '系统已经判断当前更适合先转异常层',
        recentClear: '系统已经判断当前可以继续筛图收口',
        understoodStable: '当前结果层比较稳定',
        nextSayFailed: '继续，先处理异常',
        nextSayClear: '继续，筛图收口',
        nextSayReview: '继续，我先看待复核项',
        nextSayNoReview: '继续，我先看保留结果',
        nextSayFailedAlt: '继续，我先处理失败项',
        nextSayClearAlt: '继续，做最终取舍',
      },
    },
    exception: {
      action: {
        primaryFailed: '硬失败会直接阻塞主链，先把失败项收清是最划算的动作。',
        primaryClear: '如果主要剩待复核项，回结果工作台结合图片判断会更顺。',
        secondaryReviewSummary: '把边界项和人工判断项在这一轮顺手收掉。',
        secondaryRerunSummary: '只有明确值得补跑时，再进入补跑动作，避免无意义反复生成。',
        secondaryStoryboardSummary: '当问题和镜头顺序、整板节奏有关时，再回分镜整板补充页看上下文。',
        noteFailed: '失败项优先级高于待复核项。',
        noteReviewOnly: '如果只剩待复核项，异常层只是辅助判断区。',
        noteRerun: '补跑应该是有意识的动作，不应该成为默认下一步。',
        noteNoRerun: '没有明确补跑价值时，不建议为了补跑而补跑。',
      },
      fromResult: {
        nextDefault: '先确认待复核项',
        nextFailed: '先把会阻塞主链继续的失败项收掉，再考虑其他细节。',
        nextNoFailed: '如果没有硬失败，就把人工复核项顺手收清。',
        nextNoRerun: '如果没有明确补跑候选，处理完后就可以回结果工作台或回工作台首页。',
      },
      backToMainline: {
        nextConfirm: '后，先确认这些问题是否还会影响最终取舍。',
        nextFailed: '如果还有硬失败残留，先不要急着收口，继续围绕可用结果做判断。',
        nextClear: '如果硬失败已经清空，就把重点放回保留取舍和最终收口。',
        nextStoryboard: '当问题和镜头衔接、整板上下文有关时，再按需回分镜整板补充页复看。',
        nextNoStoryboard: '如果当前判断已经稳定，就继续回工作台首页或结果工作台按推荐动作往下走。',
      },
      dialogue: {
        recentStatusLabel: '异常层刚接住的问题状态',
        recentFailed: '当前仍有硬失败待收口',
        recentReviewOnly: '当前主要剩余人工复核项',
        understoodFailedNone: '失败项: 当前没有硬失败',
        understoodReviewNone: '待复核项: 当前压力较低',
        nextSayFailed: '继续，先处理失败项',
        nextSayClear: '继续，回结果工作台复核',
        nextSayReturn: '继续，处理完后回工作台继续',
        nextSayFailedAlt: '继续，我先处理失败项再回工作台',
        nextSayClearAlt: '继续，我回结果工作台继续判断',
      },
    },
  };
  return map[key] || {};
}

function getActionLanguage(actionKey, options = {}) {
  const hasStoryboard = Boolean(options.hasStoryboard);
  const labels = {
    go_prepare: {
      actionLabel: '进入准备工作台',
      questionLabel: '是否先进入准备工作台',
      replyLabel: '继续，进入准备工作台',
      ctaLabel: '进入准备工作台',
      summaryLabel: '先确认方向、放行和素材绑定',
    },
    go_result: {
      actionLabel: '进入结果工作台',
      questionLabel: '是否直接进入结果工作台',
      replyLabel: '继续，进入结果工作台',
      ctaLabel: '进入结果工作台',
      summaryLabel: '进入结果工作台继续筛图和收口',
    },
    refine_prepare: {
      actionLabel: '先修正准备问题',
      questionLabel: '是否先收一轮准备问题',
      replyLabel: '继续，先处理准备问题',
      ctaLabel: '先处理准备项',
      summaryLabel: '先把准备阻塞项收干净',
    },
    review_result: {
      actionLabel: '继续筛图收口',
      questionLabel: '是否继续做最终取舍',
      replyLabel: '继续，筛图收口',
      ctaLabel: '继续看结果',
      summaryLabel: '继续做结果取舍和最终收口',
    },
    go_exception: {
      actionLabel: '进入异常工作台',
      questionLabel: '是否先进入异常工作台',
      replyLabel: '继续，先处理异常',
      ctaLabel: '进入异常工作台',
      summaryLabel: '先收口异常，再回工作台继续',
    },
    resolve_failed: {
      actionLabel: '先处理失败项',
      questionLabel: '是否先处理失败项',
      replyLabel: '继续，先处理失败项',
      ctaLabel: '先看失败项',
      summaryLabel: '先处理会阻塞主链的失败项',
    },
    review_exception: {
      actionLabel: '回结果工作台复核',
      questionLabel: '是否回结果工作台继续复核',
      replyLabel: '继续，回结果工作台复核',
      ctaLabel: '回结果工作台',
      summaryLabel: '回结果工作台结合图片继续复核',
    },
    go_home: {
      actionLabel: '回工作台首页',
      questionLabel: '是否回工作台首页继续主链',
      replyLabel: '继续，回工作台首页',
      ctaLabel: '回工作台首页',
      summaryLabel: '回工作台首页重新看当前阶段',
    },
    go_storyboard: {
      actionLabel: '进入分镜整板补充页',
      questionLabel: '是否按需进入分镜整板补充页',
      replyLabel: '继续，进入分镜整板补充页',
      ctaLabel: '进入分镜整板补充页',
      summaryLabel: '按需进入分镜整板补充页看上下文',
    },
    return_mainline: {
      actionLabel: hasStoryboard ? '回结果工作台或进入分镜整板补充页' : '回结果工作台',
      questionLabel: hasStoryboard ? '是否回结果工作台或进入分镜整板补充页继续判断' : '是否回结果工作台继续判断',
      replyLabel: hasStoryboard ? '继续，回结果工作台或进入分镜整板补充页' : '继续，回结果工作台',
      ctaLabel: hasStoryboard ? '回结果工作台' : '回结果工作台',
      summaryLabel: hasStoryboard ? '回结果工作台或进入分镜整板补充页继续判断' : '回结果工作台继续判断',
    },
    revisit_prepare: {
      actionLabel: '回看准备工作台',
      questionLabel: '是否回看准备工作台',
      replyLabel: '继续，回看准备工作台',
      ctaLabel: '回看准备工作台',
      summaryLabel: '回看准备层判断',
    },
    view_record: {
      actionLabel: '查看任务档案',
      questionLabel: '是否查看任务档案',
      replyLabel: '继续，查看任务档案',
      ctaLabel: '查看任务档案',
      summaryLabel: '查看完整任务记录',
    },
    go_task_center: {
      actionLabel: '回任务总控',
      questionLabel: '是否回任务总控',
      replyLabel: '继续，回任务总控',
      ctaLabel: '回任务总控',
      summaryLabel: '回总控切换任务',
    },
    view_review_items: {
      actionLabel: '查看待复核项',
      questionLabel: '是否先查看待复核项',
      replyLabel: '继续，查看待复核项',
      ctaLabel: '查看待复核项',
      summaryLabel: '集中看待复核结果',
    },
    view_exception_issues: {
      actionLabel: '查看问题列表',
      questionLabel: '是否先查看问题列表',
      replyLabel: '继续，查看问题列表',
      ctaLabel: '查看问题列表',
      summaryLabel: '集中看异常问题',
    },
    view_material_bindings: {
      actionLabel: '查看素材绑定',
      questionLabel: '是否再看素材绑定',
      replyLabel: '继续，查看素材绑定',
      ctaLabel: '查看素材绑定',
      summaryLabel: '回看素材绑定关系',
    },
    view_cautions: {
      actionLabel: '查看提醒项',
      questionLabel: '是否先看提醒项',
      replyLabel: '继续，查看提醒项',
      ctaLabel: '查看提醒项',
      summaryLabel: '回看准备提醒项',
    },
    view_rerun_candidates: {
      actionLabel: '查看补跑候选',
      questionLabel: '是否先看补跑候选',
      replyLabel: '继续，查看补跑候选',
      ctaLabel: '查看补跑候选',
      summaryLabel: '评估补跑候选',
    },
  };

  return labels[actionKey] || {
    actionLabel: '继续下一步',
    questionLabel: '是否继续下一步',
    replyLabel: '继续下一步',
    ctaLabel: '现在继续',
    summaryLabel: '按当前主链继续',
  };
}

function getStageContinuationCopy(stage, options = {}) {
  const key = String(stage || '').trim();
  const action = String(options.actionKey || '').trim();
  if (action) return getActionLanguage(action, options).replyLabel;
  if (key === 'home') return '继续，按当前主链往下走';
  if (key === 'prepare') return '继续，处理当前准备层';
  if (key === 'result') return '继续，处理当前结果层';
  if (key === 'exception') return '继续，处理当前异常层';
  return '继续下一步';
}

function getStagePrimaryActionLabel(stage, options = {}) {
  const key = String(stage || '').trim();
  const hasBlocking = Boolean(options.hasBlocking);
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  if (key === 'prepare') return hasBlocking ? '先修正准备层' : '进入结果工作台';
  if (key === 'exception') return resolveExceptionDecision({ failedCount, reviewCount, rerunCount }).nextActionLabel;
  return String(options.fallback || '').trim() || '继续下一步';
}

function resolveExceptionDecision(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);

  if (failedCount > 0) {
    const action = getActionLanguage('resolve_failed');
    return {
      category: 'hard-failure',
      label: '硬失败',
      tone: 'bad',
      actionKey: 'resolve_failed',
      nextActionLabel: action.summaryLabel,
      nextActionCta: action.ctaLabel,
      nextActionTarget: 'exception_workspace.html',
      recommendedReply: action.replyLabel,
      currentFocus: '先处理硬失败',
      statusLabel: '必须先处理失败项',
      statusSummary: '失败项会直接阻塞主链继续，先在异常工作台处理清楚。',
      issueSummary: `当前有 ${failedCount} 项硬失败必须先处理。`,
      reason: rerunCount > 0
        ? `先处理 ${failedCount} 项硬失败，再判断 ${rerunCount} 个补跑候选是否值得补。`
        : `先处理 ${failedCount} 项硬失败，再回工作台继续。`,
      pendingItems: [action.questionLabel],
      blockingItems: ['硬失败会直接阻塞主链继续'],
      summary: '异常层当前仍有硬失败待收口',
      canContinue: false,
    };
  }

  if (reviewCount > 0) {
    const action = getActionLanguage('review_exception');
    return {
      category: 'needs-review',
      label: '待复核',
      tone: 'warn',
      actionKey: 'review_exception',
      nextActionLabel: action.summaryLabel,
      nextActionCta: action.ctaLabel,
      nextActionTarget: 'result_workspace.html',
      recommendedReply: action.replyLabel,
      currentFocus: '先回结果工作台复核',
      statusLabel: '建议先复核待确认结果',
      statusSummary: '当前没有硬失败，但仍有待复核项，建议回结果工作台结合图片判断。',
      issueSummary: `当前有 ${reviewCount} 项待复核，先结合图片确认是否可用。`,
      reason: rerunCount > 0
        ? `先回结果工作台复核 ${reviewCount} 项边界结果，再决定 ${rerunCount} 个补跑候选是否值得补。`
        : `先回结果工作台复核 ${reviewCount} 项边界结果，再回主链继续。`,
      pendingItems: ['是否先确认待复核项'],
      blockingItems: [],
      summary: '异常层当前主要剩余待复核项',
      canContinue: true,
    };
  }

  if (rerunCount > 0) {
    const action = getActionLanguage('view_rerun_candidates');
    return {
      category: 'rerun-candidate',
      label: '补跑候选',
      tone: 'info',
      actionKey: 'view_rerun_candidates',
      nextActionLabel: action.summaryLabel,
      nextActionCta: action.ctaLabel,
      nextActionTarget: 'exception_workspace.html',
      recommendedReply: action.replyLabel,
      currentFocus: '按价值决定是否补跑',
      statusLabel: '当前只剩补跑候选',
      statusSummary: '当前没有硬失败和待复核项，只需要判断补跑是否值得。',
      issueSummary: `当前有 ${rerunCount} 个补跑候选，按价值决定是否补跑。`,
      reason: `当前有 ${rerunCount} 个补跑候选；只有确定值得补时才补跑，否则回工作台首页继续主链。`,
      pendingItems: [action.questionLabel],
      blockingItems: [],
      summary: '异常层当前只剩补跑价值判断',
      canContinue: true,
    };
  }

  const action = getActionLanguage('go_home');
  return {
    category: 'clear',
    label: '无异常',
    tone: 'good',
    actionKey: 'go_home',
    nextActionLabel: action.summaryLabel,
    nextActionCta: action.ctaLabel,
    nextActionTarget: 'workspace_home.html',
    recommendedReply: action.replyLabel,
    currentFocus: '回工作台首页继续主链',
    statusLabel: '当前没有明显异常',
    statusSummary: '当前没有硬失败、待复核项或补跑压力，可以回工作台首页继续主链。',
    issueSummary: '当前没有明显异常压力。',
    reason: '当前异常压力已经清空，可以回工作台首页继续主链。',
    pendingItems: [action.questionLabel],
    blockingItems: [],
    summary: '异常层当前压力已经清空',
    canContinue: true,
  };
}

function normalizeReplyText(text) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value
    .replace(/进入进入/g, '进入')
    .replace(/继续，进入进入/g, '继续，进入');
}

function buildNextReplyCandidates(recommendedReply, fallbackItems = []) {
  const items = [];
  const pushUnique = (value) => {
    const normalized = normalizeReplyText(value);
    if (!normalized) return;
    if (!items.includes(normalized)) items.push(normalized);
  };

  pushUnique(recommendedReply);
  fallbackItems.forEach((item) => pushUnique(item));
  return items;
}

function buildDialogueReplyFallbacks(stage, options = {}) {
  const interaction = getWorkspaceInteractionTemplates(stage);
  const key = String(stage || '').trim();
  if (key === 'home') {
    const issueCount = Number(options.issueCount || 0);
    const nextActionLabel = String(options.nextActionLabel || '下一步').trim() || '下一步';
    return buildNextReplyCandidates('', [
      `继续，进入${nextActionLabel}`,
      issueCount > 0 ? interaction.dialogue.nextSayIssue : interaction.dialogue.nextSayClear,
      issueCount > 0 ? interaction.dialogue.nextSayIssueAlt : interaction.dialogue.nextSayClearAlt,
    ]);
  }
  if (key === 'prepare') {
    const hasBlocking = Boolean(options.hasBlocking);
    const importedBindingCount = Number(options.importedBindingCount || 0);
    return buildNextReplyCandidates('', [
      hasBlocking ? interaction.dialogue.nextSayBlocked : interaction.dialogue.nextSayClear,
      importedBindingCount > 0 ? interaction.dialogue.nextSayBinding : interaction.dialogue.nextSayNoBinding,
      hasBlocking ? interaction.dialogue.nextSayBlockedAlt : interaction.dialogue.nextSayClearAlt,
    ]);
  }
  if (key === 'result') {
    const failedCount = Number(options.failedCount || 0);
    const reviewCount = Number(options.reviewCount || 0);
    return buildNextReplyCandidates('', [
      failedCount > 0 ? interaction.dialogue.nextSayFailed : interaction.dialogue.nextSayClear,
      reviewCount > 0 ? interaction.dialogue.nextSayReview : interaction.dialogue.nextSayNoReview,
      failedCount > 0 ? interaction.dialogue.nextSayFailedAlt : interaction.dialogue.nextSayClearAlt,
    ]);
  }
  if (key === 'exception') {
    const failedCount = Number(options.failedCount || 0);
    return buildNextReplyCandidates('', [
      failedCount > 0 ? interaction.dialogue.nextSayFailed : interaction.dialogue.nextSayClear,
      interaction.dialogue.nextSayReturn,
      failedCount > 0 ? interaction.dialogue.nextSayFailedAlt : interaction.dialogue.nextSayClearAlt,
    ]);
  }
  return [];
}

function buildPrepareTransitionNextFocusItems(options = {}) {
  const interaction = getWorkspaceInteractionTemplates('prepare');
  const blockingCount = Number(options.blockingCount || 0);
  const importedBindingCount = Number(options.importedBindingCount || 0);
  const cautionCount = Number(options.cautionCount || 0);
  return [
    blockingCount > 0 ? interaction.transition.nextBlocked : interaction.transition.nextClear,
    importedBindingCount > 0 ? interaction.transition.nextBinding : interaction.transition.nextNoBinding,
    cautionCount > 0 ? `记得顺手留意 ${cautionCount} 条提醒项在结果中有没有暴露出来。` : interaction.transition.nextStable,
  ];
}

function buildResultToExceptionNextFocusItems(options = {}) {
  const interaction = getWorkspaceInteractionTemplates('result');
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  return [
    failedCount > 0 ? interaction.toException.nextFailed : interaction.toException.nextNoFailed,
    reviewCount > 0 ? interaction.toException.nextReview : interaction.toException.nextNoReview,
    rerunCount > 0 ? `当前还有 ${rerunCount} 个补跑候选，但只在明确值得补跑时再动。` : interaction.toException.nextNoRerun,
  ];
}

function buildExceptionFromResultNextFocusItems(options = {}) {
  const interaction = getWorkspaceInteractionTemplates('exception');
  const currentFocus = String(options.currentFocus || '').trim();
  const failedCount = Number(options.failedCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  return [
    currentFocus || (failedCount > 0 ? '先处理失败项' : interaction.fromResult.nextDefault),
    failedCount > 0 ? interaction.fromResult.nextFailed : interaction.fromResult.nextNoFailed,
    rerunCount > 0 ? `补跑候选共 ${rerunCount} 项，确认值得补跑后再继续。` : interaction.fromResult.nextNoRerun,
  ];
}

function buildExceptionBackToMainlineConfirmedItems(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  const summaryText = String(options.summaryText || '').trim()
    || '当前问题已经被集中收口，接下来可以回工作台继续判断';
  return [
    failedCount > 0 ? `失败项: 当前仍有 ${failedCount} 项需要继续盯住` : '失败项: 当前已经没有硬失败',
    reviewCount > 0 ? `待复核项: 当前仍有 ${reviewCount} 项建议回工作台后再看一眼` : '待复核项: 当前复核压力较低',
    rerunCount > 0 ? `补跑候选: 当前还有 ${rerunCount} 项待决定` : '补跑候选: 当前没有明确补跑压力',
    summaryText,
  ];
}

function buildHomeConfirmationPlan(options = {}) {
  const hasFailure = Boolean(options.hasFailure);
  const hasResultWorkspace = Boolean(options.hasResultWorkspace);
  const action = getActionLanguage(String(options.actionKey || '').trim() || (hasFailure ? 'go_exception' : (hasResultWorkspace ? 'go_result' : 'go_prepare')));
  return {
    pendingItems: [action.questionLabel],
    blockingItems: hasFailure ? ['异常问题还没有收口'] : [],
    recommendedReply: action.replyLabel,
    summary: hasFailure
      ? '首页判断当前应先收口异常'
      : (hasResultWorkspace ? '首页判断当前可以继续结果主链' : '首页判断当前应先确认准备条件'),
  };
}

function buildPrepareConfirmationPlan(options = {}) {
  const tone = String(options.tone || '').trim();
  const importedBindingCount = Number(options.importedBindingCount || 0);
  const blockingItems = Array.isArray(options.blockingItems) ? options.blockingItems : [];
  const action = getActionLanguage(String(options.actionKey || '').trim() || (tone === 'bad' ? 'refine_prepare' : 'go_result'));
  return {
    pendingItems: tone === 'good'
      ? [action.questionLabel]
      : (importedBindingCount > 0 ? ['是否还要再确认素材绑定'] : [action.questionLabel]),
    blockingItems,
    recommendedReply: action.replyLabel,
    summary: tone === 'bad'
      ? '准备层还有阻塞项，需要先收干净'
      : (tone === 'warn' ? '准备层可以继续，但建议再收一轮' : '准备层已经基本可以继续'),
  };
}

function buildResultConfirmationPlan(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const action = getActionLanguage(String(options.actionKey || '').trim() || (failedCount > 0 ? 'go_exception' : 'review_result'));
  return {
    pendingItems: failedCount > 0
      ? [action.questionLabel]
      : (reviewCount > 0 ? ['是否先确认待复核项'] : [action.questionLabel]),
    blockingItems: failedCount > 0 ? ['失败项还没有收口'] : [],
    recommendedReply: action.replyLabel,
    summary: failedCount > 0
      ? '结果层仍然被失败项阻塞'
      : (reviewCount > 0 ? '结果层当前主要剩余待复核项' : '结果层已经比较稳定，可以继续收口'),
  };
}

function buildExceptionConfirmationPlan(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  const decision = resolveExceptionDecision({ failedCount, reviewCount, rerunCount });
  return {
    pendingItems: decision.pendingItems,
    blockingItems: decision.blockingItems,
    recommendedReply: decision.recommendedReply,
    summary: decision.summary,
  };
}

function buildHomeFlowPlan(options = {}) {
  const hasIssue = Boolean(options.hasIssue);
  const prepareAvailable = Boolean(options.prepareAvailable);
  const nextActionLabel = String(options.nextActionLabel || '下一步').trim() || '下一步';
  const nextActionReason = String(options.nextActionReason || '').trim() || '按推荐下一步继续。';
  const riskSummary = String(options.riskSummary || '').trim() || '当前存在待处理问题';
  const primaryAction = getActionLanguage(String(options.primaryActionKey || '').trim() || 'go_result');

  return {
    completion: buildHomeFlowCompletion({ hasIssue }),
    focus: String(options.focus || '').trim() || buildHomeDecisionSummary({
      hasFailure: hasIssue,
      hasResult: Boolean(options.hasResult),
      hasPrepare: prepareAvailable,
    }),
    actionLabel: nextActionLabel,
    actionSummary: nextActionReason,
    blockers: hasIssue ? [riskSummary] : [],
    availableActions: [
      nextActionLabel,
      prepareAvailable ? getActionLanguage('revisit_prepare').actionLabel : null,
      hasIssue ? getActionLanguage('go_exception').actionLabel : null,
    ].filter(Boolean),
    readiness: String(options.readiness || '').trim() || nextActionLabel,
    status: String(options.status || '').trim() || String(options.currentStage || '待开始').trim() || '待开始',
    recommendedAction: primaryAction.actionLabel,
  };
}

function buildPrepareFlowPlan(options = {}) {
  const tone = String(options.tone || '').trim();
  const importedBindingCount = Number(options.importedBindingCount || 0);
  const blockingItems = Array.isArray(options.blockingItems) ? options.blockingItems : [];
  const resultAction = getActionLanguage('go_result');

  return {
    completion: buildPrepareFlowCompletion({ tone }),
    focus: importedBindingCount > 0 ? '先确认素材绑定和主体稳定' : '先确认方向和放行判断',
    actionLabel: resultAction.actionLabel,
    actionSummary: '确认完准备条件后，再进入结果工作台继续主链。',
    blockers: blockingItems,
    availableActions: [
      '查看放行判断',
      importedBindingCount > 0 ? getActionLanguage('view_material_bindings').actionLabel : '确认任务方向',
      resultAction.actionLabel,
    ].filter(Boolean),
    readiness: String(options.readiness || '').trim() || String(options.readinessDetail || '未提供').trim() || '未提供',
    status: String(options.status || '').trim() || String(options.readinessLabel || '未提供').trim() || '未提供',
  };
}

function buildResultFlowPlan(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const hasStoryboard = Boolean(options.hasStoryboard);
  const nextActionLabel = String(options.nextActionLabel || '未提供').trim() || '未提供';
  const nextStepReason = String(options.nextStepReason || '未提供').trim() || '未提供';
  const currentFocus = String(options.currentFocus || '').trim() || (failedCount > 0 ? '先看异常与可用性' : '先看保留取舍');

  return {
    completion: buildResultFlowCompletion({ failedCount, reviewCount }),
    focus: currentFocus,
    actionLabel: nextActionLabel,
    actionSummary: nextStepReason,
    blockers: failedCount > 0 ? ['当前存在失败项，建议先进入异常工作台。'] : [],
    availableActions: [
      nextActionLabel,
      failedCount > 0 ? getActionLanguage('go_exception').actionLabel : null,
      hasStoryboard ? getActionLanguage('go_storyboard').actionLabel : null,
    ].filter(Boolean),
    readiness: String(options.readiness || '').trim() || String(options.statusSummary || '未提供').trim() || '未提供',
    status: String(options.status || '').trim() || String(options.statusLabel || '未提供').trim() || '未提供',
  };
}

function buildExceptionFlowPlan(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  const decision = resolveExceptionDecision({ failedCount, reviewCount, rerunCount });
  const hasStoryboard = Boolean(options.hasStoryboard);
  const nextStepLabel = String(options.nextStepLabel || decision.nextActionLabel || '未提供').trim() || '未提供';
  const issueSummary = String(options.issueSummary || decision.issueSummary || '未提供').trim() || '未提供';
  const currentFocus = String(options.currentFocus || '').trim() || decision.currentFocus;

  return {
    completion: buildExceptionFlowCompletion({ failedCount, reviewCount, rerunCount }),
    focus: currentFocus,
    actionLabel: nextStepLabel,
    actionSummary: String(options.nextActionReason || decision.reason || issueSummary).trim(),
    blockers: decision.blockingItems,
    availableActions: [
      decision.nextActionLabel,
      rerunCount > 0 ? getActionLanguage('view_rerun_candidates').actionLabel : null,
      hasStoryboard ? getActionLanguage('go_storyboard').actionLabel : null,
    ].filter(Boolean),
    readiness: String(options.readiness || '').trim() || String(options.statusSummary || decision.statusSummary || '未提供').trim() || '未提供',
    status: String(options.status || '').trim() || String(options.statusLabel || decision.statusLabel || '未提供').trim() || '未提供',
  };
}

function buildHomeCardPlan(options = {}) {
  const hasResult = Boolean(options.hasResult);
  const issueCount = Number(options.issueCount || 0);
  const statusTone = String(options.statusTone || '').trim();
  const nextActionLabel = String(options.nextActionLabel || '未提供').trim() || '未提供';
  const nextActionReason = String(options.nextActionReason || '按推荐下一步继续。').trim() || '按推荐下一步继续。';
  const riskSummary = String(options.riskSummary || '当前没有明显异常').trim() || '当前没有明显异常';

  return {
    flowLabel: hasResult ? '主控首页 -> 准备确认 -> 结果判断 -> 异常处理' : '主控首页 -> 准备确认 -> 结果判断',
    contextFlowLabel: hasResult ? '首页 -> 准备 -> 结果 -> 异常' : '首页 -> 准备 -> 结果',
    contextHints: [
      { text: hasResult ? '先按推荐下一步继续。' : '先进入准备工作台。', audience: 'all' },
      { text: '不需要再自己翻补充页判断下一步。', audience: 'pro' },
    ],
    heroCards: [
      { label: '当前阶段', value: String(options.phase || '未提供').trim() || '未提供', tone: 'info', detail: hasResult ? '已具备统一结果入口' : '先确认准备层', audience: 'all' },
      { label: '推荐下一步', value: nextActionLabel, tone: 'good', detail: nextActionReason, audience: 'all' },
      {
        label: '异常压力',
        value: riskSummary,
        tone: statusTone === 'bad' ? 'bad' : (issueCount > 0 ? 'bad' : 'good'),
        detail: issueCount > 0 ? '建议进入异常工作台' : '当前可按主链继续',
        audience: 'all',
      },
    ],
  };
}

function buildPrepareCardPlan(options = {}) {
  const importedBindingCount = Number(options.importedBindingCount || 0);
  const styleDirection = String(options.styleDirection || '').trim();
  const readinessTone = String(options.readinessTone || '').trim() || 'info';
  return {
    flowLabel: '工作台首页 -> 准备工作台 -> 结果工作台',
    contextHints: [
      { text: String(options.readinessDetail || '未提供').trim() || '未提供', audience: 'all' },
      { text: '方向、放行和素材已收在同一页。', audience: 'pro' },
    ],
    heroCards: [
      {
        label: '放行状态',
        value: String(options.readinessLabel || '未提供').trim() || '未提供',
        tone: readinessTone,
        detail: String(options.readinessDetail || '未提供').trim() || '未提供',
        audience: 'all',
      },
      {
        label: '当前任务类型',
        value: String(options.templateName || '未检测').trim() || '未检测',
        tone: 'info',
        detail: `模式：${String(options.modeLabel || '未检测').trim() || '未检测'}`,
        audience: 'all',
      },
      {
        label: '主方向',
        value: String(options.mainDirection || '未提供').trim() || '未提供',
        tone: 'good',
        detail: styleDirection && styleDirection !== '未指定' ? `风格主轴：${styleDirection}` : '先看任务方向是否对味',
        audience: 'all',
      },
      {
        label: '素材绑定',
        value: importedBindingCount > 0 ? `${importedBindingCount} 项` : '未绑定',
        tone: importedBindingCount > 0 ? 'warn' : (readinessTone === 'bad' ? 'warn' : 'neutral'),
        detail: importedBindingCount > 0 ? '存在参考素材约束' : '当前是纯提示词路线',
        audience: 'pro',
      },
    ],
  };
}

function buildResultCardPlan(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  return {
    flowLabel: '工作台首页 -> 结果工作台 -> 异常处理 / 整板复看',
    contextHints: [
      '这一页只负责看图和取舍，不再重复首页总控。',
      String(options.nextActionReason || '').trim() || (failedCount > 0 ? '先看异常相关结果，再决定要不要补跑。' : '先筛出最值得保留的图，再决定是否看整板。'),
    ],
    heroCards: [
      {
        label: '当前状态',
        value: String(options.statusLabel || '未提供').trim() || '未提供',
        tone: String(options.statusTone || '').trim() || 'info',
        detail: String(options.statusSummary || '未提供').trim() || '未提供',
      },
      {
        label: '当前重点',
        value: String(options.currentFocus || '').trim() || (failedCount > 0 ? '先看异常与可用性' : '先看保留取舍'),
        tone: failedCount > 0 ? 'bad' : 'info',
        detail: failedCount > 0 ? '先确认哪些问题会影响最终可用。' : '先圈出最值得保留的图。',
      },
      {
        label: '推荐下一步',
        value: String(options.nextActionLabel || '未提供').trim() || '未提供',
        tone: failedCount > 0 ? 'warn' : 'good',
        detail: String(options.nextActionReason || '按推荐下一步继续。').trim() || '按推荐下一步继续。',
      },
    ],
  };
}

function buildExceptionCardPlan(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  const decision = resolveExceptionDecision({ failedCount, reviewCount, rerunCount });
  const issueSummary = String(options.issueSummary || decision.issueSummary).trim() || '当前没有明显异常压力';
  return {
    flowLabel: '工作台首页 -> 结果工作台 -> 异常工作台',
    contextHints: [
      failedCount + reviewCount + rerunCount > 0 ? '把异常集中处理，比在多个结果页之间来回切换更稳。' : '当前这页只是按需页面，平时可以不进入。',
      issueSummary,
    ],
    heroCards: [
      {
        label: '当前状态',
        value: String(options.statusLabel || '未提供').trim() || '未提供',
        tone: String(options.statusTone || '').trim() || 'info',
        detail: String(options.statusSummary || '未提供').trim() || '未提供',
      },
      {
        label: '失败项',
        value: failedCount > 0 ? failedCount : '无',
        tone: failedCount > 0 ? 'bad' : 'good',
        detail: failedCount > 0 ? '优先缩小失败范围' : '当前没有硬失败',
      },
      {
        label: decision.category === 'rerun-candidate' ? '补跑候选' : '待复核',
        value: decision.category === 'rerun-candidate' ? rerunCount : (reviewCount > 0 ? reviewCount : '无'),
        tone: decision.category === 'rerun-candidate' ? 'info' : (reviewCount > 0 ? 'warn' : 'good'),
        detail: decision.category === 'rerun-candidate'
          ? '按价值决定是否补跑'
          : (reviewCount > 0 ? '建议回结果工作台结合图片判断' : '当前复核压力较小'),
      },
    ],
  };
}

function buildHomeRoutePlan(options = {}) {
  const currentLabel = String(options.currentLabel || '当前更适合继续主链').trim() || '当前更适合继续主链';
  const currentSummary = String(options.currentSummary || '这里直接告诉你现在最值得先做什么。').trim() || '这里直接告诉你现在最值得先做什么。';
  const nextActionLabel = String(options.nextActionLabel || '未提供').trim() || '未提供';
  const nextActionReason = String(options.nextActionReason || '按推荐下一步继续。').trim() || '按推荐下一步继续。';
  const ctaLabel = String(options.ctaLabel || '现在继续').trim() || '现在继续';
  const file = String(options.file || '').trim();
  return {
    current: {
      kicker: '当前判断',
      label: currentLabel,
      summary: currentSummary,
      pendingLabel: '当前已经在这一站完成判断',
    },
    nextSteps: file ? [
      { kicker: '推荐下一步', label: nextActionLabel, summary: nextActionReason, file, cta: ctaLabel },
    ] : [],
  };
}

function buildPrepareRoutePlan(options = {}) {
  const currentLabel = String(options.currentLabel || '准备层当前已完成判断').trim() || '准备层当前已完成判断';
  const currentSummary = String(options.currentSummary || '这里先确认能不能继续，不再拆成多张准备页让你自己判断。').trim() || '这里先确认能不能继续，不再拆成多张准备页让你自己判断。';
  const previousCta = String(options.previousCta || '回工作台首页').trim() || '回工作台首页';
  const nextCta = String(options.nextCta || '进入结果工作台').trim() || '进入结果工作台';
  const nextLabel = String(options.nextLabel || '结果工作台').trim() || '结果工作台';
  const nextSummary = String(options.nextSummary || '正式执行完成后，用统一结果页做筛图、收口和下一步判断。').trim() || '正式执行完成后，用统一结果页做筛图、收口和下一步判断。';
  const nextFile = String(options.nextFile || options.resultFile || '').trim() || 'result_workspace.html';
  const nextPendingLabel = String(options.nextPendingLabel || '执行完成后生成').trim() || '执行完成后生成';
  return {
    current: {
      kicker: '当前判断',
      label: currentLabel,
      summary: currentSummary,
      pendingLabel: '准备层当前判断已显示在这里',
    },
    previous: {
      label: '工作台首页',
      summary: '回到总控页重新看当前阶段与主链入口。',
      file: String(options.homeFile || '').trim() || 'workspace_home.html',
      cta: previousCta,
    },
    nextSteps: [
      {
        kicker: '推荐下一步',
        label: nextLabel,
        summary: nextSummary,
        file: nextFile,
        cta: nextCta,
        pendingLabel: nextPendingLabel,
      },
    ],
  };
}

function buildResultRoutePlan(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const currentLabel = String(options.currentLabel || '结果层当前已完成判断').trim() || '结果层当前已完成判断';
  const currentSummary = String(options.currentSummary || '这里先告诉你现在该先看异常还是先做取舍。').trim() || '这里先告诉你现在该先看异常还是先做取舍。';
  return {
    current: {
      kicker: '当前判断',
      label: currentLabel,
      summary: currentSummary,
      pendingLabel: '结果层当前判断已显示在这里',
    },
    previous: {
      label: '工作台首页',
      summary: '只有想重新总览当前阶段和整轮主链时，再回首页。',
      file: String(options.homeFile || '').trim() || 'workspace_home.html',
      cta: String(options.previousCta || '回工作台首页').trim() || '回工作台首页',
    },
    nextSteps: [
      {
        kicker: failedCount > 0 ? '建议先处理' : '建议下一步',
        label: String(options.nextActionLabel || '未提供').trim() || '未提供',
        summary: String(options.nextActionReason || '按推荐下一步继续。').trim() || '按推荐下一步继续。',
        file: String(options.file || '').trim() || 'result_workspace.html',
        cta: String(options.nextCta || '继续看结果').trim() || '继续看结果',
      },
    ],
  };
}

function buildExceptionRoutePlan(options = {}) {
  const hasStoryboard = Boolean(options.hasStoryboard);
  const storyboardFile = String(options.storyboardFile || '').trim();
  const decision = resolveExceptionDecision({
    failedCount: options.failedCount,
    reviewCount: options.reviewCount,
    rerunCount: options.rerunCount,
  });
  const currentLabel = String(options.currentLabel || '异常层当前已完成判断').trim() || '异常层当前已完成判断';
  const currentSummary = String(options.currentSummary || '这里先把问题收清，再决定回工作台还是继续看上下文。').trim() || '这里先把问题收清，再决定回工作台还是继续看上下文。';
  const nextActionLabel = String(options.nextActionLabel || decision.nextActionLabel || '').trim();
  const nextActionReason = String(options.nextActionReason || decision.reason || '').trim();
  return {
    current: {
      kicker: '当前判断',
      label: currentLabel,
      summary: currentSummary,
      pendingLabel: '异常层当前判断已显示在这里',
    },
    previous: {
      label: '结果工作台',
      summary: '回到统一结果页，重新看本轮是否已经足够稳定。',
      file: String(options.resultFile || '').trim() || 'result_workspace.html',
      cta: String(options.previousCta || '回结果工作台').trim() || '回结果工作台',
    },
    nextSteps: [
      {
        kicker: '推荐下一步',
        label: nextActionLabel || decision.nextActionLabel,
        summary: nextActionReason || decision.reason,
        file: String(options.file || '').trim() || decision.nextActionTarget || (hasStoryboard ? 'storyboard_board.html' : 'workspace_home.html'),
        cta: String(options.nextCta || decision.nextActionCta || '现在继续').trim() || '现在继续',
      },
      hasStoryboard && storyboardFile ? {
        kicker: '按需再看',
        label: getActionLanguage('go_storyboard').actionLabel,
        summary: '分镜相关问题需要看镜头上下文时，再回整板页辅助判断。',
        file: storyboardFile,
        cta: getActionLanguage('go_storyboard').ctaLabel,
      } : null,
    ].filter(Boolean),
  };
}

function buildHomeWorkbenchPlan(options = {}) {
  const cards = [];
  if (options.hasRunRecord) {
    const action = getActionLanguage('view_record');
    cards.push({ label: '任务档案', value: '补充说明', summary: '需要完整人话记录时再打开。', file: options.recordFile, cta: action.ctaLabel, tone: 'neutral', audience: 'pro' });
  }
  return cards;
}

function buildPrepareWorkbenchPlan(options = {}) {
  const cards = [];
  cards.push({ label: '工作台首页', value: '回主链', summary: '只有想重新看当前阶段和主链入口时，再回这里。', href: 'workspace_home.html', cta: getActionLanguage('go_home').ctaLabel, tone: 'info', audience: 'all' });
  return cards;
}

function buildResultWorkbenchPlan(options = {}) {
  const cards = [];
  if (String(options.primaryTarget || '').trim() !== 'exception_workspace.html' && Number(options.reviewCount || 0) > 0) {
    cards.push({ label: '异常工作台', value: `${Number(options.reviewCount || 0)} 项待复核`, summary: '如果你想集中看边界结果，可以从这里转去异常层。', href: 'exception_workspace.html', cta: getActionLanguage('view_review_items').ctaLabel, tone: 'warn', audience: 'all' });
  }
  if (!cards.length && options.hasRunRecord) {
    cards.push({ label: '任务档案', value: '补充说明', summary: '需要完整人话记录时再打开。', file: options.recordFile, cta: getActionLanguage('view_record').ctaLabel, tone: 'neutral', audience: 'pro' });
  }
  return cards;
}

function buildExceptionWorkbenchPlan(options = {}) {
  const cards = [];
  if (Number(options.totalIssueCount || 0) > 0 && Number(options.totalIssueCount || 0) <= 3) {
    cards.push({ label: '结果工作台', value: '回去复核', summary: '只有当你想结合图片重新判断这些问题时，再回结果工作台。', href: 'result_workspace.html', cta: getActionLanguage('review_exception').ctaLabel, tone: 'good', audience: 'all' });
  }
  return cards;
}

function buildHomeStatusStack(options = {}) {
  const issueCount = Number(options.issueCount || 0);
  const hasResult = Boolean(options.hasResult);
  return [
    {
      label: '主链信号',
      value: issueCount > 0 ? '待处理问题' : (hasResult ? '可继续收口' : '等待进入下一站'),
      summary: issueCount > 0 ? '当前主链上还有待处理问题。' : '当前主链可以继续往下走。',
      tone: issueCount > 0 ? 'bad' : 'good',
    },
    {
      label: '确认信号',
      value: options.hasBlocking ? '有阻塞' : (options.canContinue ? '可继续' : '待确认'),
      summary: String(options.summary || '').trim() || '这里同步当前首页确认态。',
      tone: options.hasBlocking ? 'bad' : (options.canContinue ? 'good' : 'warn'),
    },
  ];
}

function buildPrepareStatusStack(options = {}) {
  const hasBlocking = Boolean(options.hasBlocking);
  return [
    {
      label: '放行信号',
      value: String(options.readinessLabel || '未提供').trim() || '未提供',
      summary: String(options.readinessDetail || '未提供').trim() || '未提供',
      tone: String(options.readinessTone || '').trim() || 'info',
    },
    {
      label: '阻塞信号',
      value: hasBlocking ? '有阻塞' : '当前可继续',
      summary: hasBlocking ? '先把阻塞项收干净，再决定是否进入结果层。' : '当前准备层已经具备继续条件。',
      tone: hasBlocking ? 'bad' : 'good',
    },
  ];
}

function buildResultStatusStack(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  return [
    {
      label: '结果信号',
      value: String(options.statusLabel || '未提供').trim() || '未提供',
      summary: String(options.statusSummary || '未提供').trim() || '未提供',
      tone: String(options.statusTone || '').trim() || 'info',
    },
    {
      label: '压力信号',
      value: failedCount > 0 ? '有失败项' : (reviewCount > 0 ? '待复核' : '当前平稳'),
      summary: failedCount > 0 ? '失败项会直接影响后续收口。' : (reviewCount > 0 ? '待复核项建议再人工确认一眼。' : '当前结果层可以继续向终局收口。'),
      tone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
    },
  ];
}

function buildExceptionStatusStack(options = {}) {
  const totalIssueCount = Number(options.totalIssueCount || 0);
  const decision = resolveExceptionDecision({
    failedCount: options.failedCount,
    reviewCount: options.reviewCount,
    rerunCount: options.rerunCount,
  });
  return [
    {
      label: '异常信号',
      value: String(options.statusLabel || '未提供').trim() || '未提供',
      summary: String(options.statusSummary || '未提供').trim() || '未提供',
      tone: String(options.statusTone || '').trim() || 'info',
    },
    {
      label: '压力信号',
      value: totalIssueCount > 0 ? `${totalIssueCount} 项待处理` : decision.label,
      summary: String(options.issueSummary || decision.issueSummary || '当前没有明显异常压力。').trim() || '当前没有明显异常压力。',
      tone: decision.tone,
    },
  ];
}

function buildHomeTaskControlBar(options = {}) {
  const issueCount = Number(options.issueCount || 0);
  const hasResult = Boolean(options.hasResult);
  return {
    taskLabel: String(options.taskLabel || '未提供').trim() || '未提供',
    stageLabel: String(options.stageLabel || '未提供').trim() || '未提供',
    statusLabel: issueCount > 0 ? '主链待处理' : (hasResult ? '主链可继续' : '等待进入下一站'),
    statusTone: issueCount > 0 ? 'warn' : 'good',
    pressureLabel: issueCount > 0 ? `${issueCount} 项待处理` : '当前平稳',
    pressureTone: issueCount > 0 ? 'bad' : 'good',
    nextActionLabel: String(options.nextActionLabel || '未提供').trim() || '未提供',
    nextActionSummary: String(options.nextActionSummary || '按推荐下一步继续。').trim() || '按推荐下一步继续。',
    nextActionTone: 'good',
  };
}

function buildPrepareTaskControlBar(options = {}) {
  const blockingCount = Number(options.blockingCount || 0);
  const hasBlocking = blockingCount > 0;
  return {
    taskLabel: String(options.taskLabel || '未提供').trim() || '未提供',
    stageLabel: String(options.stageLabel || '未提供').trim() || '未提供',
    statusLabel: String(options.readinessLabel || '未提供').trim() || '未提供',
    statusTone: String(options.readinessTone || '').trim() || 'info',
    pressureLabel: hasBlocking ? '还有准备问题待处理' : '当前可继续',
    pressureTone: hasBlocking ? 'bad' : 'good',
    nextActionLabel: String(options.nextActionLabel || '未提供').trim() || '未提供',
    nextActionSummary: String(options.nextActionSummary || '按推荐下一步继续。').trim() || '按推荐下一步继续。',
    nextActionTone: hasBlocking ? 'warn' : 'good',
  };
}

function buildResultTaskControlBar(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  return {
    taskLabel: String(options.taskLabel || '未提供').trim() || '未提供',
    stageLabel: String(options.stageLabel || '未提供').trim() || '未提供',
    statusLabel: String(options.statusLabel || '未提供').trim() || '未提供',
    statusTone: String(options.statusTone || '').trim() || 'info',
    pressureLabel: failedCount > 0 ? '还有失败项待处理' : (reviewCount > 0 ? '还有边界结果待确认' : '当前平稳'),
    pressureTone: failedCount > 0 ? 'bad' : (reviewCount > 0 ? 'warn' : 'good'),
    nextActionLabel: String(options.nextActionLabel || '未提供').trim() || '未提供',
    nextActionSummary: String(options.nextActionSummary || '按推荐下一步继续。').trim() || '按推荐下一步继续。',
    nextActionTone: failedCount > 0 ? 'warn' : 'good',
  };
}

function buildExceptionTaskControlBar(options = {}) {
  const totalIssueCount = Number(options.totalIssueCount || 0);
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  const decision = resolveExceptionDecision({ failedCount, reviewCount, rerunCount });
  return {
    taskLabel: String(options.taskLabel || '未提供').trim() || '未提供',
    stageLabel: String(options.stageLabel || '未提供').trim() || '未提供',
    statusLabel: String(options.statusLabel || '未提供').trim() || '未提供',
    statusTone: String(options.statusTone || '').trim() || 'info',
    pressureLabel: totalIssueCount > 0
      ? (decision.category === 'rerun-candidate' ? '还有补跑候选待决定' : '还有问题待处理')
      : '当前平稳',
    pressureTone: totalIssueCount > 0 ? decision.tone : 'good',
    nextActionLabel: String(options.nextActionLabel || decision.nextActionLabel).trim() || '未提供',
    nextActionSummary: String(options.nextActionSummary || decision.reason).trim() || '按推荐下一步继续。',
    nextActionTone: decision.tone,
  };
}

function buildHomeSignalBar(options = {}) {
  const issueCount = Number(options.issueCount || 0);
  const hasResult = Boolean(options.hasResult);
  return [
    { label: '当前阶段', value: String(options.stageLabel || '未提供').trim() || '未提供', summary: '你现在处在这条主链的哪一站。', tone: 'info' },
    { label: '当前状态', value: issueCount > 0 ? '待处理问题' : (hasResult ? '可继续收口' : '等待进入下一站'), summary: String(options.statusSummary || '按当前主链继续。').trim() || '按当前主链继续。', tone: issueCount > 0 ? 'bad' : 'good' },
    { label: '当前压力', value: issueCount > 0 ? `${issueCount} 项待处理` : '当前平稳', summary: issueCount > 0 ? '建议先把异常压力收口。' : '当前可以顺着主链继续。', tone: issueCount > 0 ? 'warn' : 'good' },
  ];
}

function buildPrepareSignalBar(options = {}) {
  const hasBlocking = Boolean(options.hasBlocking);
  return [
    { label: '当前阶段', value: String(options.stageLabel || '未提供').trim() || '未提供', summary: '这一步主要负责方向、放行和素材判断。', tone: 'info' },
    { label: '放行状态', value: String(options.readinessLabel || '未提供').trim() || '未提供', summary: String(options.readinessDetail || '未提供').trim() || '未提供', tone: String(options.readinessTone || '').trim() || 'info' },
    { label: '当前压力', value: hasBlocking ? '仍有阻塞' : '当前平稳', summary: hasBlocking ? '先把阻塞项收干净，再决定是否继续。' : '当前可以继续进入下一站。', tone: hasBlocking ? 'warn' : 'good' },
  ];
}

function buildResultSignalBar(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  return [
    { label: '当前阶段', value: String(options.stageLabel || '未提供').trim() || '未提供', summary: '这一步主要负责筛图、取舍和收口。', tone: 'info' },
    { label: '当前状态', value: String(options.statusLabel || '未提供').trim() || '未提供', summary: String(options.statusSummary || '未提供').trim() || '未提供', tone: String(options.statusTone || '').trim() || 'info' },
    { label: '当前压力', value: failedCount > 0 ? `${failedCount} 项失败` : (reviewCount > 0 ? `${reviewCount} 项待复核` : '当前平稳'), summary: failedCount > 0 ? '建议先收口失败项。' : (reviewCount > 0 ? '仍有待复核项值得再看一眼。' : '当前结果层已经比较稳定。'), tone: failedCount > 0 ? 'warn' : (reviewCount > 0 ? 'warn' : 'good') },
  ];
}

function buildExceptionSignalBar(options = {}) {
  const failedCount = Number(options.failedCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const rerunCount = Number(options.rerunCount || 0);
  const totalIssueCount = Number(options.totalIssueCount || 0);
  const decision = resolveExceptionDecision({ failedCount, reviewCount, rerunCount });
  return [
    { label: '当前阶段', value: String(options.stageLabel || '未提供').trim() || '未提供', summary: '这一步只在需要处理问题时进入。', tone: 'info' },
    { label: '当前状态', value: String(options.statusLabel || '未提供').trim() || '未提供', summary: String(options.statusSummary || '未提供').trim() || '未提供', tone: String(options.statusTone || '').trim() || 'info' },
    { label: '当前压力', value: totalIssueCount > 0 ? `${totalIssueCount} 项待处理` : decision.label, summary: decision.issueSummary, tone: decision.tone },
  ];
}

function buildConfirmationSummary(options = {}) {
  const explicitSummary = String(options.summary || '').trim();
  if (explicitSummary) return explicitSummary;

  const blockingCount = Number(options.blockingCount || 0);
  const pendingCount = Number(options.pendingCount || 0);

  if (blockingCount > 0) return `当前有 ${blockingCount} 项阻塞确认`;
  if (pendingCount > 0) return `当前有 ${pendingCount} 项待确认`;
  return '当前没有额外确认压力';
}

module.exports = {
  buildHomeDecisionSummary,
  buildHomeTaskConclusion,
  buildHomeCurrentFocus,
  buildHomeStaticStageCopy,
  buildHomeFlowCompletion,
  buildUserFacingAssetOverview,
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
  buildRuntimeConversationCopy,
  buildRuntimeCopilotRelayCopy,
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
  getTaskCenterLanguage,
  getStageContinuationCopy,
  getStagePrimaryActionLabel,
  resolveExceptionDecision,
};
