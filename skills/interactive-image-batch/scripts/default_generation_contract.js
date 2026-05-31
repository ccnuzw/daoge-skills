const DEFAULT_GENERATION_CONTRACT = {
  version: 1,
  defaultMode: 'mainline-only',
  targetMode: 'single-workbench-mainline',
  principle: '默认只生成单一主链工作台和少量必要入口；深看页、旧说明页、诊断归档和程序状态文件不进入普通用户默认阅读层。',
  defaultHtml: [
    { id: 'task-center', file: 'task_center.html', label: '任务总控', layer: 'entry', scope: 'run-root', purpose: '跨任务查看与回到最近一次任务。' },
    { id: 'workspace-home', file: 'workspace_home.html', label: '工作台首页', layer: 'mainline', scope: 'run-dir', purpose: '看当前阶段、推荐动作和四站接力。' },
    { id: 'prepare-workspace', file: 'prepare_workspace.html', label: '准备工作台', layer: 'mainline', scope: 'run-dir', purpose: '确认提示词、参数、素材和执行准备。' },
    { id: 'result-workspace', file: 'result_workspace.html', label: '结果工作台', layer: 'mainline', scope: 'run-dir', purpose: '筛图、看结果结构和决定下一步。' },
    { id: 'exception-workspace', file: 'exception_workspace.html', label: '异常工作台', layer: 'mainline', scope: 'run-dir', purpose: '集中处理失败、待复核和补救判断。' },
    { id: 'run-record', file: 'run_record.html', label: '任务档案页', layer: 'support', scope: 'run-dir', purpose: '作为唯一常驻补充页，回看本轮任务摘要。' },
  ],
  defaultFiles: [
    { id: 'readme', file: 'README.md', label: '目录入口说明', layer: 'filesystem', scope: 'run-dir', purpose: '只告诉用户先从哪里进入，不承载第二套看板说明。' },
  ],
  onDemandHtml: [
    { id: 'preflight-board', file: 'preflight_board.html', label: '预检页', layer: 'advanced', mode: 'prepare-details', purpose: '只在需要细看准备检查时生成。' },
    { id: 'prompt-preview', file: 'prompt_preview.html', label: '提示词预览页', layer: 'advanced', mode: 'prepare-details', purpose: '只在需要逐条检查提示词时生成。' },
    { id: 'assets-board', file: 'assets_board.html', label: '素材页', layer: 'advanced', mode: 'prepare-details', purpose: '只在需要细看素材绑定时生成。' },
    { id: 'storyboard-board', file: 'storyboard_board.html', label: '分镜整板页', layer: 'conditional', mode: 'result-details', purpose: '只在分镜任务且需要整板复看时生成。' },
    { id: 'review-board', file: 'review_board.html', label: '审阅看板', layer: 'advanced', mode: 'result-details', purpose: '只在需要深度筛图和人工复核时生成。' },
    { id: 'completion-board', file: 'completion_board.html', label: '完成摘要页', layer: 'advanced', mode: 'result-details', purpose: '只在需要独立完成摘要时生成。' },
    { id: 'run-overview', file: 'run_overview.html', label: '运行概览页', layer: 'advanced', mode: 'result-details', purpose: '只在需要技术性回看运行结构时生成。' },
    { id: 'rerun-board', file: 'rerun_board.html', label: '补跑页', layer: 'advanced', mode: 'result-details', purpose: '只在需要补跑失败项或局部修复时生成。' },
  ],
  maintenanceHtml: [
    { id: 'result-hub', file: 'result_hub.html', label: '旧结果说明页', layer: 'legacy', mode: 'legacy', purpose: '仅维护观察使用，不进入个人工作台正式链路。' },
    { id: 'portal-home', file: 'daoge_portal.html', label: '旧门户页', layer: 'legacy', mode: 'legacy', purpose: '仅迁移观察使用，不再作为默认入口。' },
  ],
  internalArtifacts: [
    { id: 'manifest', file: 'manifest.json', layer: 'internal', purpose: '运行记录，给程序和诊断使用。' },
    { id: 'workspace-state', file: 'workspace_state.json', layer: 'internal', purpose: '统一工作台状态模型。' },
    { id: 'workspace-live-state', file: 'workspace_live_state.json', layer: 'internal', purpose: '工作台实时状态源。' },
    { id: 'workspace-assets', file: 'workspace_assets.json', layer: 'internal', purpose: '资产索引与收编结果。' },
    { id: 'workspace-timeline', file: 'workspace_timeline.json', layer: 'internal', purpose: '阶段事件与时间线。' },
    { id: 'workbench-state', file: 'workbench_state.json', layer: 'internal', purpose: '兼容快照，不作为用户主阅读入口。' },
    { id: 'operations-report-json', file: 'operations_report.json', layer: 'internal', purpose: '诊断摘要。' },
    { id: 'selection-board-markdown', file: 'selection_board.md', layer: 'internal', purpose: '维护诊断说明，默认不生成。' },
    { id: 'operations-report-markdown', file: 'operations_report.md', layer: 'internal', purpose: '维护复盘文字版，默认不生成。' },
    { id: 'run-record-markdown', file: 'run_record.md', layer: 'internal', purpose: '归档伴随文件，默认不生成。' },
  ],
};

function cloneGenerationItems(items = []) {
  return items.map((item) => ({ ...item }));
}

function resolveOptionalPageEmission(options = {}) {
  const mode = String(options.optionalPageMode || options.mode || '').trim().toLowerCase();
  const normalized = mode || 'mainline-only';
  if (normalized === 'all') {
    return {
      mode: 'all',
      prepareDetails: true,
      resultDetails: true,
      storyboardDetails: true,
      legacyPages: true,
    };
  }
  if (normalized === 'prepare-details') {
    return {
      mode: 'prepare-details',
      prepareDetails: true,
      resultDetails: false,
      storyboardDetails: false,
      legacyPages: false,
    };
  }
  if (normalized === 'result-details') {
    return {
      mode: 'result-details',
      prepareDetails: false,
      resultDetails: true,
      storyboardDetails: true,
      legacyPages: false,
    };
  }
  if (normalized === 'legacy') {
    return {
      mode: 'legacy',
      prepareDetails: false,
      resultDetails: false,
      storyboardDetails: false,
      legacyPages: true,
    };
  }
  return {
    mode: 'mainline-only',
    prepareDetails: false,
    resultDetails: false,
    storyboardDetails: false,
    legacyPages: false,
  };
}

function buildDefaultGenerationContract(resolved = {}) {
  const mode = String(resolved.mode || 'mainline-only').trim().toLowerCase() || 'mainline-only';
  const defaultHtml = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.defaultHtml);
  const defaultFiles = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.defaultFiles);
  const onDemandHtml = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.onDemandHtml);
  const maintenanceHtml = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.maintenanceHtml);
  const internalArtifacts = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.internalArtifacts);
  const prepareDetails = onDemandHtml.filter((item) => item.mode === 'prepare-details');
  const resultDetails = onDemandHtml.filter((item) => item.mode === 'result-details');
  const generatedByMode = {
    'mainline-only': defaultHtml,
    'prepare-details': defaultHtml.concat(prepareDetails),
    'result-details': defaultHtml.concat(resultDetails),
    legacy: defaultHtml.concat(maintenanceHtml),
    all: defaultHtml.concat(onDemandHtml, maintenanceHtml),
  };
  const hiddenByMode = {
    'mainline-only': onDemandHtml.concat(maintenanceHtml),
    'prepare-details': resultDetails.concat(maintenanceHtml),
    'result-details': prepareDetails.concat(maintenanceHtml),
    legacy: onDemandHtml,
    all: [],
  };
  const generatedHtml = cloneGenerationItems(generatedByMode[mode] || generatedByMode['mainline-only']);
  const hiddenHtml = cloneGenerationItems(hiddenByMode[mode] || hiddenByMode['mainline-only']);
  const defaultGenerationGuardrail = {
    userEntry: '任务总控 -> 工作台首页 -> 准备工作台 -> 结果工作台 -> 异常工作台',
    defaultVisibleRule: '普通用户默认只看主链工作台和任务档案页。',
    onDemandRule: '提示词预览、素材页、审阅看板、运行概览和补跑页必须按需开启，不作为默认入口。',
    legacyRule: '旧门户页和旧结果说明页只用于维护观察，不进入个人工作台正式链路。',
    internalRule: 'JSON、Markdown 归档和诊断文件只给程序或维护者使用，默认不展示给普通用户。',
  };
  return {
    ...DEFAULT_GENERATION_CONTRACT,
    defaultGenerationGuardrail,
    defaultHtml,
    defaultFiles,
    onDemandHtml,
    maintenanceHtml,
    internalArtifacts,
    currentMode: {
      mode,
      generatedHtml,
      hiddenHtml,
      generatedHtmlFiles: generatedHtml.map((item) => item.file),
      hiddenHtmlFiles: hiddenHtml.map((item) => item.file),
      userFocus: mode === 'mainline-only'
        ? '普通用户只沿任务总控和四站工作台继续，不需要默认打开深看页。'
        : (mode === 'all'
          ? '当前是完整展开模式，但仍以主链工作台作为判断中心。'
          : '当前只为指定深看场景展开对应补充页，主链仍是默认路径。'),
    },
    reductionRule: '默认生成先收成主链，新增页面必须先证明能帮助用户做判断，否则进入按需层或内部层。',
  };
}

function summarizeOptionalPageEmission(options = {}) {
  const resolved = resolveOptionalPageEmission(options);
  const generationContract = buildDefaultGenerationContract(resolved);
  const layerSetMap = {
    'mainline-only': {
      visibleLayers: ['mainline', 'support'],
      generatedLayers: ['mainline', 'support'],
      hiddenLayers: ['conditional', 'advanced', 'legacy', 'internal'],
    },
    'prepare-details': {
      visibleLayers: ['mainline', 'support', 'advanced'],
      generatedLayers: ['mainline', 'support', 'advanced'],
      hiddenLayers: ['conditional', 'legacy', 'internal'],
    },
    'result-details': {
      visibleLayers: ['mainline', 'support', 'conditional', 'advanced'],
      generatedLayers: ['mainline', 'support', 'conditional', 'advanced'],
      hiddenLayers: ['legacy', 'internal'],
    },
    legacy: {
      visibleLayers: ['mainline', 'support', 'legacy'],
      generatedLayers: ['mainline', 'support', 'legacy'],
      hiddenLayers: ['conditional', 'advanced', 'internal'],
    },
    all: {
      visibleLayers: ['mainline', 'support', 'conditional', 'advanced', 'legacy'],
      generatedLayers: ['mainline', 'support', 'conditional', 'advanced', 'legacy'],
      hiddenLayers: ['internal'],
    },
  };
  const copyMap = {
    'mainline-only': '当前只生成主链工作台，进阶页面和旧入口说明页默认不生成。',
    'prepare-details': '当前额外生成准备补充页，方便继续深看预检、预览与准备判断。',
    'result-details': '当前额外生成结果补充页，方便继续深看审阅、补跑与结果摘要。',
    legacy: '当前额外生成旧入口说明页，主要用于迁移观察或维护回看。',
    all: '当前同时生成准备补充页、结果补充页和旧入口说明页，属于完整展开模式。',
  };
  const recommendedActionMap = {
    'mainline-only': '需要深看时，再开启对应补充页。',
    'prepare-details': '可直接复核准备补充页，确认后回主链继续。',
    'result-details': '可直接复核结果补充页，确认后回主链继续。',
    legacy: '旧入口说明页只在维护或迁移观察时打开。',
    all: '页面较多，仍以主链工作台为主。',
  };
  const currentFocusMap = {
    'mainline-only': '现在先顺着主链继续，不需要分心看进阶页面。',
    'prepare-details': '现在可以细看准备过程，确认后回主链继续。',
    'result-details': '现在可以细看结果审阅，确认后回主链继续。',
    legacy: '现在即使保留旧页，也只当维护观察入口。',
    all: '现在所有细页都可用，但仍建议先在主链工作台完成判断。',
  };
  const whyThisModeMap = {
    'mainline-only': '先把方向、进度和下一步判断收清，避免页面过多打断理解。',
    'prepare-details': '适合再确认预检、提示词预览或素材绑定时使用。',
    'result-details': '适合再确认图片、补跑建议或结果摘要时使用。',
    legacy: '旧页信息更杂，普通使用通常不需要依赖。',
    all: '完整展开适合集中复查，但更需要主链来收口。',
  };
  const deepDiveSuggestionMap = {
    'mainline-only': '想检查准备过程，就看准备补充页；想复核图片结果，就看结果补充页。',
    'prepare-details': '如果只是继续执行，回准备工作台看主动作即可。',
    'result-details': '如果只是继续筛图或处理异常，回结果工作台看主动作即可。',
    legacy: '除非在做迁移观察或维护，否则继续留在主链工作台即可。',
    all: '需要看准备就进准备补充页，需要看结果就进结果补充页，不必把所有页都逐个打开。',
  };
  const layerSets = layerSetMap[resolved.mode] || layerSetMap['mainline-only'];
  const resolvedLabel =
    resolved.mode === 'prepare-details' ? '准备补充页已展开'
      : resolved.mode === 'result-details' ? '结果补充页已展开'
        : resolved.mode === 'legacy' ? '旧入口说明页已展开'
          : resolved.mode === 'all' ? '完整展开模式'
            : '主链极简模式';
  return {
    ...resolved,
    label: resolvedLabel,
    copy: copyMap[resolved.mode] || copyMap['mainline-only'],
    recommendedAction: recommendedActionMap[resolved.mode] || recommendedActionMap['mainline-only'],
    currentFocus: currentFocusMap[resolved.mode] || currentFocusMap['mainline-only'],
    whyThisMode: whyThisModeMap[resolved.mode] || whyThisModeMap['mainline-only'],
    deepDiveSuggestion: deepDiveSuggestionMap[resolved.mode] || deepDiveSuggestionMap['mainline-only'],
    layerPolicy: {
      visibleLayers: layerSets.visibleLayers.slice(),
      generatedLayers: layerSets.generatedLayers.slice(),
      hiddenLayers: layerSets.hiddenLayers.slice(),
      summary: resolved.mode === 'mainline-only'
        ? '当前只保留主链层和补充层，按需层与旧说明层继续后退。'
        : (resolved.mode === 'all'
          ? '当前除了内部层外，其它页面层都允许展开。'
          : `当前会连带展开 ${layerSets.generatedLayers.filter((layer) => !['mainline', 'support'].includes(layer)).join(' / ')} 对应的页面层。`),
    },
    generationPolicy: {
      source: 'default-generation-contract',
      summary: resolved.mode === 'mainline-only'
        ? '默认按主链极简模式生成，只保留主链和核心补充入口。'
        : `当前生成策略来自 ${resolvedLabel}，会按模式补充对应页面层。`,
      contractVersion: generationContract.version,
      defaultMode: generationContract.defaultMode,
      targetMode: generationContract.targetMode,
      defaultHtmlFiles: generationContract.defaultHtml.map((item) => item.file),
      onDemandHtmlFiles: generationContract.onDemandHtml.map((item) => item.file),
      maintenanceHtmlFiles: generationContract.maintenanceHtml.map((item) => item.file),
      guardrail: generationContract.defaultGenerationGuardrail,
    },
    generationContract,
    availableModes: [
      { mode: 'mainline-only', label: '只保留主链', summary: copyMap['mainline-only'], generatedLayers: layerSetMap['mainline-only'].generatedLayers.slice() },
      { mode: 'prepare-details', label: '展开准备补充页', summary: copyMap['prepare-details'], generatedLayers: layerSetMap['prepare-details'].generatedLayers.slice() },
      { mode: 'result-details', label: '展开结果补充页', summary: copyMap['result-details'], generatedLayers: layerSetMap['result-details'].generatedLayers.slice() },
      { mode: 'legacy', label: '展开旧入口说明页', summary: copyMap.legacy, generatedLayers: layerSetMap.legacy.generatedLayers.slice() },
      { mode: 'all', label: '全部展开', summary: copyMap.all, generatedLayers: layerSetMap.all.generatedLayers.slice() },
    ],
  };
}

function buildOptionalPageDecision(options = {}) {
  const summary = summarizeOptionalPageEmission(options);
  const generatedLayers = new Set(
    Array.isArray(summary.layerPolicy?.generatedLayers)
      ? summary.layerPolicy.generatedLayers
      : []
  );
  const shouldGeneratePrepareDetails = summary.prepareDetails && generatedLayers.has('advanced');
  const shouldGenerateResultDetails = summary.resultDetails && generatedLayers.has('conditional');
  const shouldGenerateStoryboardDetails = summary.storyboardDetails && generatedLayers.has('conditional');
  const shouldGenerateLegacyPages = summary.legacyPages && generatedLayers.has('legacy');
  return {
    ...summary,
    shouldGeneratePrepareDetails,
    shouldGenerateResultDetails,
    shouldGenerateStoryboardDetails,
    shouldGenerateLegacyPages,
    shouldRefreshExpandedWorkspace:
      shouldGeneratePrepareDetails || shouldGenerateResultDetails || shouldGenerateLegacyPages,
  };
}

function pruneHiddenHtmlFiles(outputDir, optionalPageDecision, options = {}) {
  const fs = options.fs || require('fs');
  const path = options.path || require('path');
  const decision = optionalPageDecision && typeof optionalPageDecision === 'object'
    ? optionalPageDecision
    : buildOptionalPageDecision(optionalPageDecision || {});
  const hiddenFiles = decision.generationContract?.currentMode?.hiddenHtmlFiles
    || decision.generationPolicy?.hiddenHtmlFiles
    || [];
  const pruned = [];
  for (const file of hiddenFiles) {
    const fileName = String(file || '').trim();
    if (!fileName || path.basename(fileName) !== fileName || !fileName.endsWith('.html')) continue;
    const target = path.join(outputDir, fileName);
    if (!fs.existsSync(target)) continue;
    fs.unlinkSync(target);
    pruned.push(target);
  }
  return pruned;
}

module.exports = {
  DEFAULT_GENERATION_CONTRACT,
  buildOptionalPageDecision,
  buildDefaultGenerationContract,
  cloneGenerationItems,
  pruneHiddenHtmlFiles,
  resolveOptionalPageEmission,
  summarizeOptionalPageEmission,
};
