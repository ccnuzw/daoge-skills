const path = require('path');
const {
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  ensureV2Layout,
  summarizeCounts,
} = require('./workspace_v2_shared');

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

function decideAction(stage, runPlan = {}, executionManifest = {}, issueQueue = {}, assetLibrary = {}) {
  const counts = summarizeCounts(executionManifest, issueQueue, assetLibrary);
  if (stage.id === 'prepare') {
    if (runPlan.readiness?.canRun === false) {
      return {
        label: '先补准备',
        reply: '先补齐准备项',
        targetPage: 'prepare.html',
        reason: '还有开跑前必须处理的准备项',
      };
    }
    return {
      label: '确认开跑',
      reply: '继续，开始执行',
      targetPage: 'results.html',
      reason: '准备项已经齐全',
    };
  }
  if (Number(issueQueue.summary?.blocking || 0) > 0) {
    return {
      label: '先处理问题',
      reply: '先处理这些问题',
      targetPage: 'issues.html',
      reason: '当前有必须处理的问题',
    };
  }
  if (stage.id === 'record') {
    return {
      label: '看任务记录',
      reply: '打开任务记录',
      targetPage: 'record.html',
      reason: '本轮已经进入归档回看',
    };
  }
  if (counts.needsReview > 0) {
    return {
      label: '先筛结果',
      reply: '先让我筛结果',
      targetPage: 'results.html',
      reason: '已有可用结果，同时有少量内容建议复核',
    };
  }
  return {
    label: '先筛结果',
    reply: '先让我筛结果',
    targetPage: 'results.html',
    reason: '当前结果可以进入筛选',
  };
}

function buildDecision(stage, runPlan = {}, executionManifest = {}, issueQueue = {}, assetLibrary = {}) {
  const counts = summarizeCounts(executionManifest, issueQueue, assetLibrary);
  if (stage.id === 'prepare') {
    return {
      headline: runPlan.readiness?.headline || (stage.status === 'ready' ? '可以开跑' : '先补准备'),
      summary: runPlan.readiness?.summary || '请先确认开跑前准备是否齐全',
      blockingItems: toArray(runPlan.readiness?.blockingItems),
      attentionItems: toArray(runPlan.readiness?.attentionItems),
    };
  }
  if (Number(issueQueue.summary?.blocking || 0) > 0) {
    return {
      headline: '先处理关键问题',
      summary: `当前有 ${issueQueue.summary.blocking} 个必须处理的问题，建议先收口后再筛图。`,
      blockingItems: toArray(issueQueue.groups?.find?.((item) => item.id === 'must_handle')?.itemIds).map((id) => {
        const issue = toArray(issueQueue.items).find((item) => item.id === id);
        return issue?.title || '必须处理的问题';
      }),
      attentionItems: [`可筛选结果 ${counts.success} 个`, `建议复核 ${counts.needsReview} 个`],
    };
  }
  return {
    headline: counts.success > 0 ? '可以筛结果' : '还没有可筛选结果',
    summary: counts.success > 0
      ? `当前有 ${counts.success} 个可筛选结果，${counts.needsReview} 个建议复核，${counts.failed} 个失败。`
      : '本轮还没有生成可筛选结果。',
    blockingItems: [],
    attentionItems: [
      counts.needsReview ? `${counts.needsReview} 个结果建议人工确认` : null,
      counts.rerunCandidates ? `${counts.rerunCandidates} 个结果值得补跑` : null,
    ].filter(Boolean),
  };
}

function buildWorkspaceState(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const runPlan = readJsonIfExists(options.runPlanFile || path.join(outputDir, 'internal', 'run_plan.json')) || {};
  const executionManifest = readJsonIfExists(options.executionManifestFile || path.join(outputDir, 'internal', 'execution_manifest.json')) || {};
  const issueQueue = readJsonIfExists(options.issueQueueFile || path.join(outputDir, 'internal', 'issue_queue.json')) || {};
  const assetLibrary = readJsonIfExists(options.assetLibraryFile || path.join(outputDir, 'internal', 'asset_library.json')) || {};
  const task = runPlan.task || {
    id: 'portrait',
    title: '生图任务',
    summary: '生成一组可筛选的视觉结果',
  };
  const stage = decideStage(runPlan, executionManifest, issueQueue, assetLibrary);
  const primaryAction = decideAction(stage, runPlan, executionManifest, issueQueue, assetLibrary);
  const decision = buildDecision(stage, runPlan, executionManifest, issueQueue, assetLibrary);
  const counts = summarizeCounts(executionManifest, issueQueue, assetLibrary);

  const workspaceState = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    task: {
      id: normalizeText(task.id, 'portrait'),
      title: normalizeText(task.title || task.name, '生图任务'),
      summary: normalizeText(task.summary || task.plainSummary, '生成一组可筛选的视觉结果'),
    },
    stage,
    primaryAction,
    decision,
    replySuggestions: [
      primaryAction.reply,
      stage.id === 'prepare' ? '先让我看提示词' : '先让我看可筛选结果',
      '我想换一个任务方向',
    ],
    counts,
    assetSummary: {
      readyResults: counts.success,
      needsReview: counts.needsReview,
      issueAssets: counts.failed,
      selected: toArray(assetLibrary.groups?.find?.((item) => item.id === 'selected')?.assetIds).length,
      exportsPath: 'assets/exports',
    },
    issueSummary: issueQueue.summary || {
      blocking: 0,
      attention: 0,
      rerunCandidates: 0,
      ignored: 0,
      resolved: 0,
    },
    paths: {
      workspace: 'workspace/index.html',
      assets: 'assets',
      selected: 'assets/selected',
      exports: 'assets/exports',
    },
  };

  const outputFile = options.outputFile || path.join(outputDir, 'internal', 'workspace_state.json');
  writeJson(outputFile, workspaceState);
  return workspaceState;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args['output-dir'] || process.cwd();
  const workspaceState = buildWorkspaceState({
    outputDir,
    outputFile: args['output-file'],
    runPlanFile: args['run-plan'],
    executionManifestFile: args['execution-manifest'],
    issueQueueFile: args['issue-queue'],
    assetLibraryFile: args['asset-library'],
  });
  console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir), stage: workspaceState.stage.id }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { buildWorkspaceState, decideStage, decideAction, buildDecision };
