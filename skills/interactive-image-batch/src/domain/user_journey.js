const { toArray, normalizeText, summarizeCounts } = require('../shared/workspace');

function action(fields = {}) {
  const targetPage = fields.targetPage || null;
  return {
    id: normalizeText(fields.id, 'continue'),
    label: normalizeText(fields.label, '继续'),
    intent: normalizeText(fields.intent, 'continue'),
    href: fields.href || (targetPage ? targetPage : null),
    targetPage,
    reply: normalizeText(fields.reply, '继续'),
    reason: normalizeText(fields.reason, '这是当前最有价值的下一步'),
    enabled: fields.enabled !== false,
    disabledReason: fields.enabled === false ? normalizeText(fields.disabledReason, '当前不能执行') : null,
    riskLevel: normalizeText(fields.riskLevel, 'low'),
  };
}

function decideStage(runPlan = {}, executionManifest = {}, issueQueue = {}, assetLibrary = {}) {
  const counts = summarizeCounts(executionManifest, issueQueue, assetLibrary);
  const hasExecution = toArray(executionManifest.results).length > 0 || counts.total > 0 || executionManifest.execution?.dryRun;
  const blocking = Number(issueQueue.summary?.blocking || 0);
  const attention = Number(issueQueue.summary?.attention || 0);
  if (!hasExecution) {
    const ready = runPlan.readiness?.canRun !== false;
    return {
      id: 'prepare',
      name: '开跑前确认',
      status: ready ? 'ready' : 'blocked',
    };
  }
  if (blocking > 0) {
    return { id: 'issues', name: '问题处理', status: 'blocked' };
  }
  if (executionManifest.phase === 'record') {
    return { id: 'record', name: '任务记录', status: 'ready' };
  }
  if (attention > 0 || counts.needsReview > 0) {
    return { id: 'results', name: '结果筛选', status: 'attention' };
  }
  return { id: 'results', name: '结果筛选', status: 'ready' };
}

function buildDecision(stage, runPlan = {}, executionManifest = {}, issueQueue = {}, assetLibrary = {}) {
  const counts = summarizeCounts(executionManifest, issueQueue, assetLibrary);
  if (stage.id === 'prepare') {
    return {
      headline: runPlan.readiness?.headline || (stage.status === 'ready' ? '可以开跑' : '先补准备'),
      summary: runPlan.readiness?.summary || '请先确认开跑前准备是否齐全',
      whyNow: stage.status === 'ready'
        ? '准备项已通过检查，现在确认执行范围最省时间。'
        : '还有准备缺口，先补齐能避免无效执行。',
      blockingItems: toArray(runPlan.readiness?.blockingItems),
      attentionItems: toArray(runPlan.readiness?.attentionItems),
    };
  }
  if (Number(issueQueue.summary?.blocking || 0) > 0) {
    return {
      headline: '先处理关键问题',
      summary: `当前有 ${issueQueue.summary.blocking} 个必须处理的问题，建议先收口后再筛图。`,
      whyNow: '关键问题会影响交付完整度，先处理能避免后面反复筛选。',
      blockingItems: toArray(issueQueue.groups?.find?.((item) => item.id === 'must_handle')?.itemIds).map((id) => {
        const issue = toArray(issueQueue.items).find((item) => item.id === id);
        return issue?.title || '必须处理的问题';
      }),
      attentionItems: [`可筛选结果 ${counts.success} 个`, `建议复核 ${counts.needsReview} 个`],
    };
  }
  if (stage.id === 'record') {
    return {
      headline: '可以回看记录',
      summary: `本轮留下 ${counts.total} 个结果记录和 ${counts.rerunCandidates} 个补跑候选。`,
      whyNow: '任务已进入回看阶段，现在确认资产位置和下次接续方式。',
      blockingItems: [],
      attentionItems: [],
    };
  }
  return {
    headline: counts.success > 0 ? '可以筛结果' : '还没有可筛选结果',
    summary: counts.success > 0
      ? `当前有 ${counts.success} 个可筛选结果，${counts.needsReview} 个建议复核，${counts.failed} 个失败。`
      : '本轮还没有生成可筛选结果。',
    whyNow: counts.success > 0
      ? '已有可用结果，先筛出候选比直接补跑更能保留有效产出。'
      : '还没有可用图，先回准备页确认执行范围。',
    blockingItems: [],
    attentionItems: [
      counts.needsReview ? `${counts.needsReview} 个结果建议人工确认` : null,
      counts.rerunCandidates ? `${counts.rerunCandidates} 个结果值得补跑` : null,
    ].filter(Boolean),
  };
}

function decidePrimaryAction(stage, runPlan = {}, executionManifest = {}, issueQueue = {}, assetLibrary = {}) {
  const counts = summarizeCounts(executionManifest, issueQueue, assetLibrary);
  if (stage.id === 'prepare') {
    if (runPlan.readiness?.canRun === false) {
      return action({
        id: 'fix_prepare',
        label: '先补准备',
        intent: 'resolve_prepare_blockers',
        targetPage: 'prepare.html',
        reply: '先补齐准备项',
        reason: '还有开跑前必须处理的准备项。',
        riskLevel: 'medium',
      });
    }
    return action({
      id: 'confirm_run',
      label: '确认开跑',
      intent: 'confirm_execution',
      targetPage: 'results.html',
      reply: '继续，开始执行',
      reason: '准备项已经齐全，现在确认执行范围。',
      riskLevel: 'medium',
    });
  }
  if (Number(issueQueue.summary?.blocking || 0) > 0) {
    return action({
      id: 'resolve_issues',
      label: '先处理问题',
      intent: 'resolve_blocking_issues',
      targetPage: 'issues.html',
      reply: '先处理这些问题',
      reason: '当前有必须处理的问题，会影响交付完整度。',
      riskLevel: 'medium',
    });
  }
  if (stage.id === 'record') {
    return action({
      id: 'open_record',
      label: '看任务记录',
      intent: 'review_run_record',
      targetPage: 'record.html',
      reply: '打开任务记录',
      reason: '本轮已经进入归档回看。',
      riskLevel: 'low',
    });
  }
  if (counts.success < 1 && counts.needsReview < 1) {
    return action({
      id: 'review_prepare',
      label: '回准备页确认',
      intent: 'review_prepare_scope',
      targetPage: 'prepare.html',
      reply: '回准备页确认范围',
      reason: '当前还没有可筛选结果。',
      riskLevel: 'low',
    });
  }
  return action({
    id: 'review_results',
    label: '先筛结果',
    intent: counts.needsReview > 0 ? 'review_results_with_attention' : 'review_ready_results',
    targetPage: 'results.html',
    reply: '先让我筛结果',
    reason: counts.needsReview > 0
      ? '已有可用结果，同时有少量内容建议复核。'
      : '当前结果可以进入筛选。',
    riskLevel: 'low',
  });
}

function decideSecondaryActions(stage, primaryAction, runPlan = {}, executionManifest = {}, issueQueue = {}, assetLibrary = {}) {
  const counts = summarizeCounts(executionManifest, issueQueue, assetLibrary);
  const candidates = [];
  if (stage.id !== 'prepare') {
    candidates.push(action({
      id: 'open_prepare',
      label: '看准备',
      intent: 'review_prepare',
      targetPage: 'prepare.html',
      reply: '先让我看准备',
      reason: '可回看提示词数量、素材和执行规模。',
      riskLevel: 'low',
    }));
  }
  if (stage.id !== 'results' && counts.success > 0) {
    candidates.push(action({
      id: 'open_results',
      label: '看结果',
      intent: 'review_results',
      targetPage: 'results.html',
      reply: '先让我看可筛选结果',
      reason: '已有可筛选结果，可先确认候选。',
      riskLevel: 'low',
    }));
  }
  if (stage.id !== 'issues' && (Number(issueQueue.summary?.blocking || 0) > 0 || Number(issueQueue.summary?.attention || 0) > 0 || Number(issueQueue.summary?.rerunCandidates || 0) > 0)) {
    candidates.push(action({
      id: 'open_issues',
      label: '看问题',
      intent: 'review_issues',
      targetPage: 'issues.html',
      reply: '先让我看问题',
      reason: '有问题或补跑候选需要确认。',
      riskLevel: 'medium',
    }));
  }
  candidates.push(action({
    id: 'open_record',
    label: '看记录',
    intent: 'review_record',
    targetPage: 'record.html',
    reply: '打开任务记录',
    reason: '可查看本轮做了什么和资产位置。',
    riskLevel: 'low',
  }));
  return candidates.filter((item) => item.id !== primaryAction.id).slice(0, 3);
}

function buildReplySuggestions(primaryAction, secondaryActions = []) {
  return [primaryAction, ...secondaryActions]
    .map((item) => item.reply)
    .filter(Boolean)
    .slice(0, 4);
}

function decideNextBestStep(stage, primaryAction, decision) {
  return {
    actionId: primaryAction.id,
    label: primaryAction.label,
    page: primaryAction.targetPage || primaryAction.href,
    reply: primaryAction.reply,
    reason: decision.whyNow || primaryAction.reason,
  };
}

function buildUserJourneyDecision(runPlan = {}, executionManifest = {}, issueQueue = {}, assetLibrary = {}) {
  const stage = decideStage(runPlan, executionManifest, issueQueue, assetLibrary);
  const primaryAction = decidePrimaryAction(stage, runPlan, executionManifest, issueQueue, assetLibrary);
  const secondaryActions = decideSecondaryActions(stage, primaryAction, runPlan, executionManifest, issueQueue, assetLibrary);
  const decision = buildDecision(stage, runPlan, executionManifest, issueQueue, assetLibrary);
  const replySuggestions = buildReplySuggestions(primaryAction, secondaryActions);
  const nextBestStep = decideNextBestStep(stage, primaryAction, decision);
  return {
    stage,
    primaryAction,
    secondaryActions,
    replySuggestions,
    decision,
    nextBestStep,
  };
}

module.exports = {
  action,
  buildDecision,
  buildReplySuggestions,
  buildUserJourneyDecision,
  decideNextBestStep,
  decidePrimaryAction,
  decideSecondaryActions,
  decideStage,
};
