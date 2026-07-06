const path = require('path');
const {
  ISSUE_TYPES,
  ISSUE_ACTION_IDS,
  ISSUE_GROUP_IDS,
  RESOLUTION_STATES,
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  normalizeEnumValue,
  ensureV2Layout,
  classifyResultAvailability,
} = require('../shared/workspace');

function issueAction(fields = {}) {
  const targetPage = fields.targetPage || null;
  return {
    id: normalizeEnumValue('issue action id', fields.id, ISSUE_ACTION_IDS, 'review'),
    label: normalizeText(fields.label, '确认'),
    intent: normalizeText(fields.intent, 'review_issue'),
    href: fields.href || targetPage,
    targetPage,
    reply: normalizeText(fields.reply, '我来确认'),
    reason: normalizeText(fields.reason, '需要用户确认后继续'),
    enabled: fields.enabled !== false,
    disabledReason: fields.enabled === false ? normalizeText(fields.disabledReason, '当前不可用') : null,
    riskLevel: normalizeText(fields.riskLevel, 'low'),
  };
}

function actionsForIssue(type, result = {}, resolutionState = 'open') {
  const issueType = normalizeEnumValue('issue.type', type, ISSUE_TYPES, 'needs_review');
  const state = normalizeEnumValue('issue.resolutionState', resolutionState, RESOLUTION_STATES, 'open');
  const base = [
    issueAction({
      id: 'review_results',
      label: '回结果页复核',
      intent: 'review_related_result',
      targetPage: 'results.html',
      reply: '回结果页复核',
      reason: '先看图或记录，再决定是否处理。',
      riskLevel: 'low',
    }),
  ];
  if (issueType === 'hard_failure') {
    base.unshift(issueAction({
      id: 'handle_issue',
      label: '处理',
      intent: 'handle_blocking_issue',
      targetPage: 'issues.html',
      reply: '处理这个问题',
      reason: '失败会影响本轮完整性。',
      riskLevel: 'medium',
    }));
    base.push(issueAction({
      id: 'ignore_gap',
      label: '忽略',
      intent: 'ignore_issue',
      targetPage: 'issues.html',
      reply: '这个问题先忽略',
      reason: '如果这张不影响交付，可以标记忽略。',
      riskLevel: 'medium',
    }));
  }
  if (issueType === 'needs_review') {
    base.push(issueAction({
      id: 'mark_resolved',
      label: '确认可用',
      intent: 'resolve_review',
      targetPage: 'results.html',
      reply: '这张确认可用',
      reason: '人工确认后可回到结果筛选。',
      riskLevel: 'low',
    }));
  }
  if (issueType === 'rerun_candidate') {
    base.unshift(issueAction({
      id: 'rerun_candidate',
      label: '补跑候选',
      intent: 'confirm_rerun',
      targetPage: 'issues.html',
      reply: '把这张加入补跑',
      reason: result.rerunReason || '补跑能提高本轮可交付完整度。',
      riskLevel: 'medium',
    }));
  }
  if (state === 'ignored' || issueType === 'ignored') {
    return [
      issueAction({
        id: 'restore_issue',
        label: '重新处理',
        intent: 'restore_ignored_issue',
        targetPage: 'issues.html',
        reply: '恢复这个问题',
        reason: '如果后来发现影响交付，可以恢复处理。',
        riskLevel: 'low',
      }),
    ];
  }
  if (state === 'resolved' || issueType === 'resolved') {
    return [
      issueAction({
        id: 'review_results',
        label: '回结果页复核',
        intent: 'review_related_result',
        targetPage: 'results.html',
        reply: '回结果页复核',
        reason: '问题已处理，可回看结果。',
        riskLevel: 'low',
      }),
    ];
  }
  return base;
}

function issueIsOpen(item) {
  return normalizeEnumValue('issue.resolutionState', item.resolutionState || item.status, RESOLUTION_STATES, 'open') === 'open';
}

function groupForIssueType(type) {
  if (type === 'hard_failure') return 'must_handle';
  if (type === 'rerun_candidate') return 'worth_rerun';
  if (type === 'needs_review') return 'needs_confirmation';
  if (type === 'ignored') return 'can_ignore';
  if (type === 'resolved') return 'resolved';
  return 'needs_confirmation';
}

function textIncludes(value, patterns) {
  const text = String(value || '').toLowerCase();
  return patterns.some((pattern) => pattern.test(text));
}

function classifyIssueReason(result = {}, availability = {}) {
  const message = [
    result.error,
    result.reason,
    result.rerunReason,
    availability.missingOutput ? 'missing output' : '',
  ].filter(Boolean).join(' ');
  if (textIncludes(message, [/素材/, /参考图/, /遮罩/, /material/, /reference file not found/, /missing reference/])) {
    return {
      reason: 'missing_material',
      title: '缺少素材，不能直接补跑',
      userMessage: '这张需要的参考图、遮罩或输入素材不可用，直接补跑还会失败。',
      userAction: '先补齐素材，再重新执行这一张',
      rerunnable: false,
      rerunReason: '先补齐素材后再执行',
      safeToIgnore: false,
    };
  }
  if (result.rerunnable === false) {
    return {
      reason: normalizeText(result.reason, 'not_rerunnable'),
      title: '这一张需要先处理原因',
      userMessage: result.error || '当前失败原因不能靠直接补跑解决。',
      userAction: result.rerunReason || '先处理失败原因，再决定是否重新执行',
      rerunnable: false,
      rerunReason: result.rerunReason || '当前不能直接补跑',
      safeToIgnore: false,
    };
  }
  if (availability.missingOutput || result.missingOutput) {
    return {
      reason: 'missing_output',
      title: '这一张结果文件缺失',
      userMessage: '结果记录存在，但图片文件不可用；本轮少一张可查看图片。',
      userAction: '补跑这一张，或重新导入图片后刷新任务页',
      rerunnable: true,
      rerunReason: result.rerunReason || '结果文件缺失',
      safeToIgnore: true,
    };
  }
  if (textIncludes(message, [/timeout/, /timed out/, /abort/, /deadline/, /超时/])) {
    return {
      reason: 'provider_timeout',
      title: '生成服务超时',
      userMessage: '生成请求已发出，但服务在限定时间内没有返回图片。',
      userAction: '可以只补跑这张；如果多次超时，再降低并发或延长超时',
      rerunnable: true,
      rerunReason: result.rerunReason || '生成服务超时',
      safeToIgnore: true,
    };
  }
  if (textIncludes(message, [/http\s*\d+/, /fetch failed/, /non-json response/, /missing image payload/, /api/, /接口/, /服务/])) {
    return {
      reason: 'provider_api_error',
      title: '生成服务返回失败',
      userMessage: '生成服务返回错误或没有返回图片，本轮少一张可筛选结果。',
      userAction: '可以只补跑这张；如果反复失败，再检查服务配置',
      rerunnable: true,
      rerunReason: result.rerunReason || '生成服务失败',
      safeToIgnore: true,
    };
  }
  return {
    reason: 'generation_failed',
    title: '这一张没有生成成功',
    userMessage: result.error || '本轮少一张可筛选结果；如果这是关键画面，交付会有缺口。',
    userAction: result.worthRerun ? '可以只补跑这张' : '先确认是否必须保留这一张',
    rerunnable: Boolean(result.worthRerun || result.rerunReason),
    rerunReason: result.rerunReason || (result.worthRerun ? '关键结果失败' : '没有明确补跑原因'),
    safeToIgnore: true,
  };
}

function issueFromResult(result, type, index) {
  const issueType = normalizeEnumValue('issue.type', type, ISSUE_TYPES, 'needs_review');
  const resolutionState = issueType === 'ignored' ? 'ignored' : (issueType === 'resolved' ? 'resolved' : 'open');
  const reasonInfo = classifyIssueReason(result, {
    missingOutput: Boolean(result.missingOutput),
  });
  const group = groupForIssueType(issueType);
  const base = {
    id: `issue_${String(index).padStart(3, '0')}`,
    type: issueType,
    group,
    status: 'open',
    resolutionState,
    relatedAssetIds: [result.id].filter(Boolean),
    sourceResultId: result.id || null,
    sourcePromptIndex: result.index ?? null,
    targetPage: issueType === 'needs_review' ? 'results.html' : 'issues.html',
    href: issueType === 'needs_review' ? 'results.html' : 'issues.html',
  };
  if (issueType === 'hard_failure') {
    return {
      ...base,
      severity: 'blocking',
      title: reasonInfo.title,
      userTitle: reasonInfo.title,
      impact: reasonInfo.userMessage,
      userImpact: reasonInfo.userMessage,
      userMessage: reasonInfo.userMessage,
      userAction: reasonInfo.userAction,
      reason: reasonInfo.reason,
      recommendedAction: reasonInfo.userAction,
      availableActions: actionsForIssue(type, result, resolutionState),
      blocking: true,
      worthRerun: reasonInfo.rerunnable,
      rerunnable: reasonInfo.rerunnable,
      rerunReason: reasonInfo.rerunReason,
      safeToIgnore: reasonInfo.safeToIgnore,
      userNextStep: reasonInfo.userAction,
    };
  }
  if (issueType === 'needs_review') {
    return {
      ...base,
      severity: 'attention',
      title: '这一张需要人工看一眼',
      userTitle: '这一张需要人工看一眼',
      impact: '可能能用，但需要确认主体和画面是否稳定',
      userImpact: '它不阻塞任务，但可能影响最终质量。',
      userMessage: '它不阻塞任务，但可能影响最终质量。',
      userAction: '回结果页放大确认主体、构图和文字区域',
      reason: 'needs_review',
      recommendedAction: '回结果页复核',
      availableActions: actionsForIssue(type, result, resolutionState),
      blocking: false,
      worthRerun: false,
      rerunnable: false,
      rerunReason: '人工复核不是失败，不需要直接补跑',
      safeToIgnore: true,
      userNextStep: '回结果页筛选',
    };
  }
  return {
    ...base,
    type: 'rerun_candidate',
    group: groupForIssueType('rerun_candidate'),
    severity: 'attention',
    title: '这一张值得补跑',
    userTitle: '这一张值得补跑',
    impact: result.rerunReason || '补跑后本轮结果会更完整',
    userImpact: result.rerunReason || '补跑有明确用户价值，可能提高交付完整度。',
    userMessage: result.rerunReason || '补跑有明确用户价值，可能提高交付完整度。',
    userAction: '确认后只补跑这一张',
    reason: reasonInfo.reason,
    recommendedAction: '只补这一张',
    availableActions: actionsForIssue('rerun_candidate', result, resolutionState),
    blocking: false,
    worthRerun: true,
    rerunnable: true,
    rerunReason: result.rerunReason || reasonInfo.rerunReason || '值得补跑',
    safeToIgnore: true,
    userNextStep: '确认后只补这一张',
  };
}

function inferWorthRerun(result, executionManifest, availability = {}) {
  const reasonInfo = classifyIssueReason(result, availability);
  if (!reasonInfo.rerunnable) return '';
  if (reasonInfo.reason === 'provider_timeout' || reasonInfo.reason === 'provider_api_error' || reasonInfo.reason === 'missing_output') {
    return reasonInfo.rerunReason;
  }
  if (result.worthRerun) return result.rerunReason || '关键结果失败';
  const total = Number(executionManifest.counts?.total || 0);
  const success = Number(executionManifest.counts?.success || 0);
  if (result.rerunReason) return result.rerunReason;
  if (result.userLabel || result.shotLabel) return '关键镜头失败';
  if (total > 0 && success === 0) return '可交付不足';
  if (total > 0 && success < Math.max(1, Math.ceil(total * 0.5))) return '用户要求数量不足';
  return '';
}

function buildIssueQueue(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const executionManifest = readJsonIfExists(options.executionManifestFile || path.join(outputDir, 'internal', 'execution_manifest.json')) || {};
  const results = toArray(executionManifest.results);
  const items = [];
  let counter = 1;

  results.forEach((item) => {
    const availability = classifyResultAvailability(outputDir, item);
    if (availability.failed) {
      const rerunReason = inferWorthRerun(item, executionManifest, availability);
      const enriched = {
        ...item,
        worthRerun: Boolean(rerunReason),
        rerunReason,
      };
      items.push(issueFromResult(enriched, 'hard_failure', counter));
      counter += 1;
      if (rerunReason) {
        items.push(issueFromResult(enriched, 'rerun_candidate', counter));
        counter += 1;
      }
      return;
    }

    if (availability.missingOutput) {
      const enriched = {
        ...item,
        missingOutput: true,
        worthRerun: true,
        rerunReason: item.rerunReason || '结果文件缺失',
      };
      items.push(issueFromResult(enriched, 'hard_failure', counter));
      counter += 1;
      items.push(issueFromResult(enriched, 'rerun_candidate', counter));
      counter += 1;
      return;
    }

    if (availability.needsReview) {
      items.push(issueFromResult(item, 'needs_review', counter));
      counter += 1;
    }
  });

  toArray(options.extraItems).forEach((item) => {
    const type = normalizeEnumValue('issue.type', ISSUE_TYPES.includes(item.type) ? item.type : 'needs_review', ISSUE_TYPES, 'needs_review');
    const resolutionState = normalizeEnumValue('issue.resolutionState', item.resolutionState || item.status, RESOLUTION_STATES, type === 'ignored' ? 'ignored' : (type === 'resolved' ? 'resolved' : 'open'));
    items.push({
      id: normalizeText(item.id, `issue_${String(counter).padStart(3, '0')}`),
      type,
      group: normalizeText(item.group, groupForIssueType(type)),
      severity: normalizeText(item.severity, type === 'hard_failure' ? 'blocking' : 'attention'),
      title: normalizeText(item.title, '需要确认的问题'),
      userTitle: normalizeText(item.userTitle || item.title, '需要确认的问题'),
      impact: normalizeText(item.impact, '可能影响本轮判断'),
      userImpact: normalizeText(item.userImpact || item.impact, '可能影响本轮判断'),
      userMessage: normalizeText(item.userMessage || item.userImpact || item.impact, '可能影响本轮判断'),
      userAction: normalizeText(item.userAction || item.recommendedAction, '建议确认'),
      reason: normalizeText(item.reason, type === 'hard_failure' ? 'generation_failed' : type),
      recommendedAction: normalizeText(item.recommendedAction, '建议确认'),
      availableActions: toArray(item.availableActions).length ? toArray(item.availableActions).map(issueAction) : actionsForIssue(type, item, resolutionState),
      status: resolutionState,
      resolutionState,
      relatedAssetIds: toArray(item.relatedAssetIds),
      blocking: Boolean(item.blocking ?? type === 'hard_failure'),
      worthRerun: Boolean(item.worthRerun ?? type === 'rerun_candidate'),
      rerunnable: Boolean(item.rerunnable ?? item.worthRerun ?? type === 'rerun_candidate'),
      rerunReason: normalizeText(item.rerunReason, item.worthRerun || type === 'rerun_candidate' ? '值得补跑' : '不需要补跑'),
      safeToIgnore: Boolean(item.safeToIgnore ?? type !== 'hard_failure'),
      sourceResultId: item.sourceResultId || null,
      sourcePromptIndex: item.sourcePromptIndex ?? null,
      targetPage: item.targetPage || (type === 'needs_review' ? 'results.html' : 'issues.html'),
      href: item.href || item.targetPage || (type === 'needs_review' ? 'results.html' : 'issues.html'),
      userNextStep: normalizeText(item.userNextStep, type === 'hard_failure' ? '进入问题页处理' : '回结果页确认'),
    });
    counter += 1;
  });

  const issueQueue = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    supportedTypes: ISSUE_TYPES,
    supportedResolutionStates: RESOLUTION_STATES,
    supportedActionIds: ISSUE_ACTION_IDS,
    supportedGroupIds: ISSUE_GROUP_IDS,
    summary: {
      blocking: items.filter((item) => item.blocking && issueIsOpen(item)).length,
      attention: items.filter((item) => !item.blocking && issueIsOpen(item) && item.type !== 'rerun_candidate').length,
      rerunCandidates: items.filter((item) => item.type === 'rerun_candidate' && issueIsOpen(item)).length,
      ignored: items.filter((item) => item.resolutionState === 'ignored' || item.status === 'ignored' || item.type === 'ignored').length,
      resolved: items.filter((item) => item.resolutionState === 'resolved' || item.status === 'resolved' || item.type === 'resolved').length,
    },
    groups: [
      { id: normalizeEnumValue('issue group id', 'must_handle', ISSUE_GROUP_IDS, 'must_handle'), title: '必须处理', itemIds: items.filter((item) => item.blocking && issueIsOpen(item)).map((item) => item.id) },
      { id: normalizeEnumValue('issue group id', 'needs_confirmation', ISSUE_GROUP_IDS, 'needs_confirmation'), title: '建议确认', itemIds: items.filter((item) => item.severity === 'attention' && item.type !== 'rerun_candidate' && issueIsOpen(item)).map((item) => item.id) },
      { id: normalizeEnumValue('issue group id', 'worth_rerun', ISSUE_GROUP_IDS, 'worth_rerun'), title: '值得补跑', itemIds: items.filter((item) => item.type === 'rerun_candidate' && issueIsOpen(item)).map((item) => item.id) },
      { id: normalizeEnumValue('issue group id', 'can_ignore', ISSUE_GROUP_IDS, 'can_ignore'), title: '已忽略', itemIds: items.filter((item) => item.resolutionState === 'ignored' || item.status === 'ignored' || item.type === 'ignored').map((item) => item.id) },
      { id: normalizeEnumValue('issue group id', 'resolved', ISSUE_GROUP_IDS, 'resolved'), title: '已处理', itemIds: items.filter((item) => item.resolutionState === 'resolved' || item.status === 'resolved' || item.type === 'resolved').map((item) => item.id) },
    ],
    items,
  };

  const outputFile = options.outputFile || path.join(outputDir, 'internal', 'issue_queue.json');
  writeJson(outputFile, issueQueue);
  return issueQueue;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args['output-dir'] || process.cwd();
  const issueQueue = buildIssueQueue({
    outputDir,
    outputFile: args['output-file'],
    executionManifestFile: args['execution-manifest'],
  });
  console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir), issues: issueQueue.items.length }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { buildIssueQueue, issueFromResult };
