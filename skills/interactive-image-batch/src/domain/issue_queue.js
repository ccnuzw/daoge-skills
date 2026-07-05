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

function issueFromResult(result, type, index) {
  const issueType = normalizeEnumValue('issue.type', type, ISSUE_TYPES, 'needs_review');
  const resolutionState = issueType === 'ignored' ? 'ignored' : (issueType === 'resolved' ? 'resolved' : 'open');
  const base = {
    id: `issue_${String(index).padStart(3, '0')}`,
    type: issueType,
    status: 'open',
    resolutionState,
    relatedAssetIds: [result.id].filter(Boolean),
  };
  if (issueType === 'hard_failure') {
    return {
      ...base,
      severity: 'blocking',
      title: result.missingOutput ? '这一张结果文件缺失' : '这一张没有生成成功',
      impact: result.missingOutput ? '结果记录存在，但图片文件不可用' : (result.error || '会影响本轮完整性'),
      userImpact: result.missingOutput ? '本轮少一张可查看图片；需要补跑、重新导入或接受缺口。' : '本轮少一张可筛选结果；如果这是关键画面，交付会缺口。',
      recommendedAction: result.worthRerun ? '先确认失败原因，再决定是否补跑' : '先确认是否必须保留这一张',
      availableActions: actionsForIssue(type, result, resolutionState),
      blocking: true,
      worthRerun: Boolean(result.worthRerun),
      userNextStep: result.worthRerun ? '进入问题页确认补跑范围' : '进入问题页确认是否接受缺口',
    };
  }
  if (issueType === 'needs_review') {
    return {
      ...base,
      severity: 'attention',
      title: '这一张需要人工看一眼',
      impact: '可能能用，但需要确认主体和画面是否稳定',
      userImpact: '它不阻塞任务，但可能影响最终质量。',
      recommendedAction: '回结果页复核',
      availableActions: actionsForIssue(type, result, resolutionState),
      blocking: false,
      worthRerun: false,
      userNextStep: '回结果页筛选',
    };
  }
  return {
    ...base,
    type: 'rerun_candidate',
    severity: 'attention',
    title: '这一张值得补跑',
    impact: result.rerunReason || '补跑后本轮结果会更完整',
    userImpact: result.rerunReason || '补跑有明确用户价值，可能提高交付完整度。',
    recommendedAction: '只补这一张',
    availableActions: actionsForIssue('rerun_candidate', result, resolutionState),
    blocking: false,
    worthRerun: true,
    userNextStep: '确认后只补这一张',
  };
}

function inferWorthRerun(result, executionManifest) {
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
      const rerunReason = inferWorthRerun(item, executionManifest);
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
      severity: normalizeText(item.severity, type === 'hard_failure' ? 'blocking' : 'attention'),
      title: normalizeText(item.title, '需要确认的问题'),
      impact: normalizeText(item.impact, '可能影响本轮判断'),
      userImpact: normalizeText(item.userImpact || item.impact, '可能影响本轮判断'),
      recommendedAction: normalizeText(item.recommendedAction, '建议确认'),
      availableActions: toArray(item.availableActions).length ? toArray(item.availableActions).map(issueAction) : actionsForIssue(type, item, resolutionState),
      status: resolutionState,
      resolutionState,
      relatedAssetIds: toArray(item.relatedAssetIds),
      blocking: Boolean(item.blocking ?? type === 'hard_failure'),
      worthRerun: Boolean(item.worthRerun ?? type === 'rerun_candidate'),
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
