const DEFAULT_GENERATION_CONTRACT = {
  version: 1,
  defaultMode: 'mainline-only',
  targetMode: 'single-workbench-mainline',
  principle: '默认只生成单一主链工作台和少量必要入口；深看页、诊断归档和程序状态文件不进入普通用户默认阅读层。',
  defaultHtml: [
    { id: 'workspace-index', file: 'workspace/index.html', label: '任务首页', layer: 'mainline', scope: 'run-dir', purpose: '看当前任务、阶段和主动作。' },
    { id: 'workspace-prepare', file: 'workspace/prepare.html', label: '准备页', layer: 'mainline', scope: 'run-dir', purpose: '确认开跑前准备。' },
    { id: 'workspace-results', file: 'workspace/results.html', label: '结果页', layer: 'mainline', scope: 'run-dir', purpose: '筛选结果、查看复核建议。' },
    { id: 'workspace-issues', file: 'workspace/issues.html', label: '问题页', layer: 'mainline', scope: 'run-dir', purpose: '处理必须处理、建议确认和值得补跑的事项。' },
    { id: 'workspace-record', file: 'workspace/record.html', label: '记录页', layer: 'support', scope: 'run-dir', purpose: '回看本轮摘要和资产位置。' },
  ],
  defaultFiles: [
    { id: 'readme', file: 'README.md', label: '目录入口说明', layer: 'filesystem', scope: 'run-dir', purpose: '只告诉用户先从哪里进入，不承载第二套看板说明。' },
  ],
  onDemandHtml: [
    { id: 'preflight-board', file: 'debug/preflight_board.html', label: '预检页', layer: 'advanced', mode: 'prepare-details', purpose: '只给维护者细看准备检查。' },
    { id: 'prompt-preview', file: 'debug/prompt_preview.html', label: '提示词预览页', layer: 'advanced', mode: 'prepare-details', purpose: '只给维护者逐条检查提示词。' },
    { id: 'assets-board', file: 'debug/assets_board.html', label: '素材页', layer: 'advanced', mode: 'prepare-details', purpose: '只给维护者细看素材绑定。' },
    { id: 'storyboard-board', file: 'debug/storyboard_board.html', label: '分镜整板补充页', layer: 'conditional', mode: 'result-details', purpose: '只在分镜任务且需要整板复看时作为维护页。' },
    { id: 'review-board', file: 'debug/review_board.html', label: '审阅看板', layer: 'advanced', mode: 'result-details', purpose: '只给维护者深度筛图。' },
    { id: 'completion-board', file: 'debug/completion_board.html', label: '完成摘要页', layer: 'advanced', mode: 'result-details', purpose: '只给维护者独立回看。' },
    { id: 'run-overview', file: 'debug/run_overview.html', label: '运行概览页', layer: 'advanced', mode: 'result-details', purpose: '只给维护者技术回看。' },
    { id: 'rerun-board', file: 'debug/rerun_board.html', label: '补跑页', layer: 'advanced', mode: 'result-details', purpose: '只给维护者补跑失败项或局部修复。' },
  ],
  removedHtml: [
    { id: 'removed-workspace-home', file: 'workspace_home.html', label: '退役首页', layer: 'removed', purpose: '旧用户入口，不再生成。' },
    { id: 'removed-prepare-workspace', file: 'prepare_workspace.html', label: '退役准备页', layer: 'removed', purpose: '旧用户入口，不再生成。' },
    { id: 'removed-result-workspace', file: 'result_workspace.html', label: '退役结果页', layer: 'removed', purpose: '旧用户入口，不再生成。' },
    { id: 'removed-exception-workspace', file: 'exception_workspace.html', label: '退役异常页', layer: 'removed', purpose: '旧用户入口，不再生成。' },
    { id: 'removed-run-record', file: 'run_record.html', label: '退役档案页', layer: 'removed', purpose: '旧用户入口，不再生成。' },
    { id: 'removed-review-board', file: 'review_board.html', label: '退役审阅页', layer: 'removed', purpose: '默认用户入口退役。' },
    { id: 'removed-completion-board', file: 'completion_board.html', label: '退役完成页', layer: 'removed', purpose: '默认用户入口退役。' },
    { id: 'removed-rerun-board', file: 'rerun_board.html', label: '退役补跑页', layer: 'removed', purpose: '默认用户入口退役。' },
    { id: 'removed-prompt-preview', file: 'prompt_preview.html', label: '退役提示词预览页', layer: 'removed', purpose: '默认用户入口退役。' },
    { id: 'removed-preflight-board', file: 'preflight_board.html', label: '退役预检页', layer: 'removed', purpose: '默认用户入口退役。' },
    { id: 'removed-assets-board', file: 'assets_board.html', label: '退役素材页', layer: 'removed', purpose: '默认用户入口退役。' },
    { id: 'removed-storyboard-board', file: 'storyboard_board.html', label: '退役分镜页', layer: 'removed', purpose: '默认用户入口退役。' },
    { id: 'removed-result-hub', file: 'result_hub.html', label: '退役结果入口清理目标', layer: 'removed', purpose: '不再属于产品入口，生成链路和渲染器已移除；仅用于清理同名残留。' },
    { id: 'removed-portal-home', file: 'daoge_portal.html', label: '退役门户入口清理目标', layer: 'removed', purpose: '不再属于产品入口，生成链路和渲染器已移除；仅用于清理同名残留。' },
  ],
  internalArtifacts: [
    { id: 'manifest', file: 'manifest.json', layer: 'internal', purpose: '运行记录，给程序和诊断使用。' },
    { id: 'workspace-state', file: 'workspace_state.json', layer: 'internal', purpose: '统一工作台状态模型。' },
    { id: 'workspace-live-state', file: 'workspace_live_state.json', layer: 'internal', purpose: '工作台实时状态源。' },
    { id: 'workspace-assets', file: 'workspace_assets.json', layer: 'internal', purpose: '资产索引与收编结果。' },
    { id: 'workspace-timeline', file: 'workspace_timeline.json', layer: 'internal', purpose: '阶段事件与时间线。' },
    { id: 'workbench-state', file: 'workbench_state.json', layer: 'internal', purpose: '派生工作台快照，不作为用户主阅读入口。' },
    { id: 'operations-report-json', file: 'operations_report.json', layer: 'internal', purpose: '诊断摘要。' },
    { id: 'selection-board-markdown', file: 'selection_board.md', layer: 'internal', purpose: '维护诊断说明，默认不生成。' },
    { id: 'operations-report-markdown', file: 'operations_report.md', layer: 'internal', purpose: '维护复盘文字版，默认不生成。' },
    { id: 'run-record-markdown', file: 'run_record.md', layer: 'internal', purpose: '归档伴随文件，默认不生成。' },
  ],
};

function cloneGenerationItems(items = []) {
  return items.map((item) => ({ ...item }));
}

function splitOnDemandHtmlByMode(onDemandHtml = []) {
  const prepareDetailIds = new Set(['preflight-board', 'prompt-preview', 'assets-board']);
  const resultDetailIds = new Set(['review-board', 'completion-board', 'run-overview', 'rerun-board']);
  const storyboardDetailIds = new Set(['storyboard-board']);
  return {
    prepareDetailHtml: onDemandHtml.filter((item) => prepareDetailIds.has(item.id)),
    resultDetailHtml: onDemandHtml.filter((item) => resultDetailIds.has(item.id)),
    storyboardDetailHtml: onDemandHtml.filter((item) => storyboardDetailIds.has(item.id)),
  };
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
    };
  }
  if (normalized === 'prepare-details') {
    return {
      mode: 'prepare-details',
      prepareDetails: true,
      resultDetails: false,
      storyboardDetails: false,
    };
  }
  if (normalized === 'result-details') {
    return {
      mode: 'result-details',
      prepareDetails: false,
      resultDetails: true,
      storyboardDetails: true,
    };
  }
  return {
    mode: 'mainline-only',
    prepareDetails: false,
    resultDetails: false,
    storyboardDetails: false,
  };
}

function buildDefaultGenerationContract(resolved = {}) {
  const mode = String(resolved.mode || 'mainline-only').trim().toLowerCase() || 'mainline-only';
  const defaultHtml = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.defaultHtml);
  const defaultFiles = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.defaultFiles);
  const onDemandHtml = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.onDemandHtml);
  const removedHtml = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.removedHtml);
  const internalArtifacts = cloneGenerationItems(DEFAULT_GENERATION_CONTRACT.internalArtifacts);
  const {
    prepareDetailHtml,
    resultDetailHtml,
    storyboardDetailHtml,
  } = splitOnDemandHtmlByMode(onDemandHtml);
  const detailModeMatrix = [
    ...prepareDetailHtml.map((item) => ({ id: item.id, file: item.file, mode: 'prepare-details', alsoGeneratedIn: ['all'] })),
    ...resultDetailHtml.map((item) => ({ id: item.id, file: item.file, mode: 'result-details', alsoGeneratedIn: ['all'] })),
    ...storyboardDetailHtml.map((item) => ({ id: item.id, file: item.file, mode: 'result-details', alsoGeneratedIn: ['all'], conditional: 'storyboard' })),
  ];
  const generatedByMode = {
    'mainline-only': defaultHtml,
    'prepare-details': defaultHtml.concat(prepareDetailHtml),
    'result-details': defaultHtml.concat(resultDetailHtml, storyboardDetailHtml),
    all: defaultHtml.concat(onDemandHtml),
  };
  const hiddenByMode = {
    'mainline-only': onDemandHtml,
    'prepare-details': resultDetailHtml.concat(storyboardDetailHtml),
    'result-details': prepareDetailHtml,
    all: [],
  };
  const generatedHtml = cloneGenerationItems(generatedByMode[mode] || generatedByMode['mainline-only']);
  const hiddenHtml = cloneGenerationItems(hiddenByMode[mode] || hiddenByMode['mainline-only']);
  const defaultGenerationGuardrail = {
    userEntry: 'workspace/index.html -> 准备 -> 结果 -> 问题 -> 记录',
    defaultVisibleRule: '普通用户默认只看 workspace/ 五个 v2 页面。',
    onDemandRule: '提示词预览、素材页、审阅看板、运行概览和补跑页必须按需开启，不作为默认入口。',
    removedRule: '退役门户入口和退役结果入口不再生成；若目录中残留会被清理。',
    internalRule: 'JSON、Markdown 归档和诊断文件只给程序或维护者使用，默认不展示给普通用户。',
  };
  return {
    ...DEFAULT_GENERATION_CONTRACT,
    defaultGenerationGuardrail,
    defaultHtml,
    defaultFiles,
    onDemandHtml,
    prepareDetailHtml,
    resultDetailHtml,
    storyboardDetailHtml,
    detailModeMatrix,
    removedHtml,
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
      hiddenLayers: ['conditional', 'advanced', 'internal'],
    },
    'prepare-details': {
      visibleLayers: ['mainline', 'support', 'advanced'],
      generatedLayers: ['mainline', 'support', 'advanced'],
      hiddenLayers: ['conditional', 'internal'],
    },
    'result-details': {
      visibleLayers: ['mainline', 'support', 'conditional', 'advanced'],
      generatedLayers: ['mainline', 'support', 'conditional', 'advanced'],
      hiddenLayers: ['internal'],
    },
    all: {
      visibleLayers: ['mainline', 'support', 'conditional', 'advanced'],
      generatedLayers: ['mainline', 'support', 'conditional', 'advanced'],
      hiddenLayers: ['internal'],
    },
  };
  const copyMap = {
    'mainline-only': '当前只生成主链工作台，进阶页面默认不生成。',
    'prepare-details': '当前额外生成准备补充页，方便继续深看预检、预览与准备判断。',
    'result-details': '当前额外生成结果补充页，方便继续深看审阅、补跑与结果摘要。',
    all: '当前同时生成准备补充页和结果补充页，仍以主链工作台作为判断中心。',
  };
  const recommendedActionMap = {
    'mainline-only': '需要深看时，再开启对应补充页。',
    'prepare-details': '可直接复核准备补充页，确认后回主链继续。',
    'result-details': '可直接复核结果补充页，确认后回主链继续。',
    all: '页面较多，仍以主链工作台为主。',
  };
  const currentFocusMap = {
    'mainline-only': '现在先顺着主链继续，不需要分心看进阶页面。',
    'prepare-details': '现在可以细看准备过程，确认后回主链继续。',
    'result-details': '现在可以细看结果审阅，确认后回主链继续。',
    all: '现在所有深看细页都可用，但仍建议先在主链工作台完成判断。',
  };
  const whyThisModeMap = {
    'mainline-only': '先把方向、进度和下一步判断收清，避免页面过多打断理解。',
    'prepare-details': '适合再确认预检、提示词预览或素材绑定时使用。',
    'result-details': '适合再确认图片、补跑建议或结果摘要时使用。',
    all: '完整展开适合集中复查，但更需要主链来收口。',
  };
  const deepDiveSuggestionMap = {
    'mainline-only': '想检查准备过程，就看准备补充页；想复核图片结果，就看结果补充页。',
    'prepare-details': '如果只是继续执行，回准备工作台看主动作即可。',
    'result-details': '如果只是继续筛图或处理异常，回结果工作台看主动作即可。',
    all: '需要看准备就进准备补充页，需要看结果就进结果补充页，不必把所有页都逐个打开。',
  };
  const layerSets = layerSetMap[resolved.mode] || layerSetMap['mainline-only'];
  const resolvedLabel =
    resolved.mode === 'prepare-details' ? '准备补充页已展开'
      : resolved.mode === 'result-details' ? '结果补充页已展开'
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
        ? '当前只保留主链层和补充层，按需层继续后退。'
        : (resolved.mode === 'all'
          ? '当前允许展开准备/结果深看层。'
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
      removedHtmlFiles: generationContract.removedHtml.map((item) => item.file),
      guardrail: generationContract.defaultGenerationGuardrail,
    },
    generationContract,
    availableModes: [
      { mode: 'mainline-only', label: '只保留主链', summary: copyMap['mainline-only'], generatedLayers: layerSetMap['mainline-only'].generatedLayers.slice() },
      { mode: 'prepare-details', label: '展开准备补充页', summary: copyMap['prepare-details'], generatedLayers: layerSetMap['prepare-details'].generatedLayers.slice() },
      { mode: 'result-details', label: '展开结果补充页', summary: copyMap['result-details'], generatedLayers: layerSetMap['result-details'].generatedLayers.slice() },
      { mode: 'all', label: '全部展开', summary: copyMap.all, generatedLayers: layerSetMap.all.generatedLayers.slice() },
    ],
  };
}

function buildOptionalPageDecision(options = {}) {
  const summary = summarizeOptionalPageEmission(options);
  const generatedHtmlFiles = new Set(summary.generationContract?.currentMode?.generatedHtmlFiles || []);
  const hasGeneratedFile = (items) => (Array.isArray(items) ? items : []).some((item) => generatedHtmlFiles.has(item.file));
  const shouldGeneratePrepareDetails = summary.prepareDetails && hasGeneratedFile(summary.generationContract?.prepareDetailHtml);
  const shouldGenerateResultDetails = summary.resultDetails && hasGeneratedFile(summary.generationContract?.resultDetailHtml);
  const shouldGenerateStoryboardDetails = summary.storyboardDetails && hasGeneratedFile(summary.generationContract?.storyboardDetailHtml);
  return {
    ...summary,
    shouldGeneratePrepareDetails,
    shouldGenerateResultDetails,
    shouldGenerateStoryboardDetails,
    shouldRefreshExpandedWorkspace:
      shouldGeneratePrepareDetails || shouldGenerateResultDetails,
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
    const targets = [
      path.join(outputDir, fileName),
      path.join(outputDir, 'workspace', fileName),
    ];
    for (const target of targets) {
      if (!fs.existsSync(target)) continue;
      fs.unlinkSync(target);
      pruned.push(target);
    }
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
