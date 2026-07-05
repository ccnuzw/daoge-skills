const path = require('path');
const {
  VIEW_IDS,
  parseArgs,
  readJsonIfExists,
  writeJson,
  toArray,
  ensureV2Layout,
  publicAsset,
} = require('../shared/workspace');

function pickAssets(assetLibrary, predicate) {
  return toArray(assetLibrary.assets).filter(predicate).map(publicAsset);
}

function issueGroups(issueQueue = {}) {
  const items = toArray(issueQueue.items);
  return toArray(issueQueue.groups).map((group) => ({
    id: group.id,
    title: group.title,
    items: toArray(group.itemIds).map((id) => items.find((item) => item.id === id)).filter(Boolean).map((item) => ({
      id: item.id,
      title: item.title,
      impact: item.impact,
      userImpact: item.userImpact || item.impact,
      recommendedAction: item.recommendedAction,
      availableActions: item.availableActions || [],
      resolutionState: item.resolutionState || item.status,
      status: item.status,
      relatedAssetIds: item.relatedAssetIds || [],
    })),
  }));
}

function baseView(pageId, workspaceState) {
  const titleMap = {
    index: '任务首页',
    prepare: '开跑前确认',
    results: '结果筛选',
    issues: '问题处理',
    record: '任务记录',
  };
  return {
    schemaVersion: 2,
    pageId,
    title: titleMap[pageId],
    task: workspaceState.task,
    stage: workspaceState.stage,
    decision: workspaceState.decision,
    nextBestStep: workspaceState.nextBestStep,
    primaryAction: workspaceState.primaryAction,
    secondaryActions: workspaceState.secondaryActions || [],
    replySuggestions: workspaceState.replySuggestions,
    counts: workspaceState.counts,
    nav: [
      { label: '任务', href: 'index.html', current: pageId === 'index' },
      { label: '准备', href: 'prepare.html', current: pageId === 'prepare' },
      { label: '结果', href: 'results.html', current: pageId === 'results' },
      { label: '问题', href: 'issues.html', current: pageId === 'issues' },
      { label: '记录', href: 'record.html', current: pageId === 'record' },
    ],
  };
}

function buildViewModels(options = {}) {
  const outputDir = ensureV2Layout(options.outputDir || process.cwd());
  const workspaceState = readJsonIfExists(options.workspaceStateFile || path.join(outputDir, 'internal', 'workspace_state.json')) || {};
  const runPlan = readJsonIfExists(options.runPlanFile || path.join(outputDir, 'internal', 'run_plan.json')) || {};
  const issueQueue = readJsonIfExists(options.issueQueueFile || path.join(outputDir, 'internal', 'issue_queue.json')) || {};
  const assetLibrary = readJsonIfExists(options.assetLibraryFile || path.join(outputDir, 'internal', 'asset_library.json')) || {};
  const readyAssets = pickAssets(assetLibrary, (item) => item.kind === 'image_result' && item.usage?.canSelect);
  const reviewAssets = pickAssets(assetLibrary, (item) => item.kind === 'image_result' && item.usage?.needsReview);
  const issueAssets = pickAssets(assetLibrary, (item) => item.kind === 'issue_record' && item.usage?.hasIssue);
  const selectedAssets = pickAssets(assetLibrary, (item) => item.kind === 'selected_result');
  const exportAssets = pickAssets(assetLibrary, (item) => item.kind === 'export_image');

  const models = {
    index: {
      ...baseView('index', workspaceState),
      answerFocus: ['这是什么任务', '当前走到哪一步', '现在只做什么', '为什么先做这一步', '我可以回对话框说什么'],
      sections: [
        { title: '当前任务', body: workspaceState.task?.summary || '' },
        { title: '当前步骤', body: `${workspaceState.stage?.name || ''}：${workspaceState.decision?.headline || ''}` },
        { title: '现在只做', body: workspaceState.primaryAction?.label || '' },
        { title: '为什么', body: workspaceState.decision?.whyNow || workspaceState.primaryAction?.reason || '' },
      ],
    },
    prepare: {
      ...baseView('prepare', workspaceState),
      answerFocus: ['能不能开跑', '还缺什么', '哪些只是提醒', '当前素材是否够用', '主动作'],
      sections: [
        { title: '开跑状态', body: runPlan.readiness?.summary || '' },
        { title: '需要先处理', body: toArray(runPlan.readiness?.blockingItems).join('；') || '暂无' },
      ],
      readiness: {
        canRun: runPlan.readiness?.canRun !== false,
        blockingItems: toArray(runPlan.readiness?.blockingItems),
        attentionItems: toArray(runPlan.readiness?.attentionItems),
        materialNotes: toArray(runPlan.materials?.notes),
        promptCount: Number(runPlan.promptPlan?.promptCount || 0),
        batchCount: Number(runPlan.promptPlan?.batchCount || 0),
      },
    },
    results: {
      ...baseView('results', workspaceState),
      answerFocus: ['哪些结果可用', '哪些建议复核', '哪些失败', '是否值得补跑', '主动作'],
      sections: [
        { title: '可筛选结果', body: `${readyAssets.length} 个` },
        { title: '需要留意', body: `${reviewAssets.length + issueAssets.length} 个` },
      ],
      assets: {
        ready: readyAssets,
        review: reviewAssets,
        issues: issueAssets,
        selected: selectedAssets,
        exports: exportAssets,
      },
      worthRerunCount: Number(issueQueue.summary?.rerunCandidates || 0),
    },
    issues: {
      ...baseView('issues', workspaceState),
      answerFocus: ['哪些问题必须处理', '哪些建议确认', '哪些可以忽略', '哪些值得补跑', '处理完回哪里'],
      sections: [
        { title: '必须处理', body: `${Number(issueQueue.summary?.blocking || 0)} 个` },
        { title: '建议确认', body: `${Number(issueQueue.summary?.attention || 0)} 个` },
      ],
      issueGroups: issueGroups(issueQueue),
      returnTarget: workspaceState.primaryAction?.targetPage || 'results.html',
    },
    record: {
      ...baseView('record', workspaceState),
      answerFocus: ['这轮做了什么', '最终状态是什么', '资产在哪里', '下次如何继续'],
      sections: [
        { title: '本轮记录', body: `${workspaceState.task?.title || '当前任务'}：准备 ${runPlan.promptPlan?.promptCount || 0} 条，完成 ${workspaceState.counts?.total || 0} 个结果记录。` },
        { title: '当前位置', body: workspaceState.decision?.headline || '' },
      ],
      record: {
        did: `${workspaceState.task?.title || '当前任务'}：准备 ${runPlan.promptPlan?.promptCount || 0} 条，完成 ${workspaceState.counts?.total || 0} 个结果记录。`,
        finalStatus: workspaceState.decision?.headline || '',
        assetLocations: [
          { label: '结果', path: 'assets/results' },
          { label: '已选', path: 'assets/selected' },
          { label: '复核', path: 'assets/review' },
          { label: '交付', path: 'assets/exports' },
        ],
        continueText: toArray(workspaceState.replySuggestions)[0] || '',
      },
    },
  };

  VIEW_IDS.forEach((id) => {
    writeJson(path.join(outputDir, 'internal', 'view_models', `${id}.json`), models[id]);
  });
  return models;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outputDir = args['output-dir'] || process.cwd();
  const models = buildViewModels({
    outputDir,
    workspaceStateFile: args['workspace-state'],
    runPlanFile: args['run-plan'],
    issueQueueFile: args['issue-queue'],
    assetLibraryFile: args['asset-library'],
  });
  console.log(JSON.stringify({ ok: true, outputDir: path.resolve(outputDir), pages: Object.keys(models) }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(String(error.message || error));
    process.exit(1);
  }
}

module.exports = { buildViewModels };
