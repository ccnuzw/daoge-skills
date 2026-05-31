const path = require('path');
const { fileExists } = require('./script_utils');
const { getWorkspaceDenseCopy } = require('./workspace_dense_copy');
const {
  buildPageEntries,
} = require('./workspace_page_registry');
const {
  getStageSectionKeysByLayer,
  getStageSectionSpecs,
} = require('./workspace_section_registry');

const PRIMARY_WORKBENCH_IDS = [
  'workspace-home',
  'prepare-workspace',
  'result-workspace',
  'exception-workspace',
];

const GOVERNANCE_SNAPSHOT_PAGES = [
  'workspace_home.html',
  'prepare_workspace.html',
  'result_workspace.html',
  'exception_workspace.html',
  'run_record.html',
  'storyboard_board.html',
  'review_board.html',
  'preflight_board.html',
  'prompt_preview.html',
  'assets_board.html',
  'run_overview.html',
  'rerun_board.html',
  'result_hub.html',
  'daoge_portal.html',
  'examples-catalog',
];

const PAGE_TOPLINK_PLANS = {
  'workspace_home.html': ['task-center', 'catalog', 'result-workspace'],
  'prepare_workspace.html': ['workspace-home', 'task-center', 'result-workspace', 'catalog'],
  'result_workspace.html': ['workspace-home', 'task-center', 'exception-workspace'],
  'exception_workspace.html': ['workspace-home', 'task-center', 'result-workspace'],
  'storyboard_board.html': ['workspace-home', 'task-center', 'result-workspace'],
  'run_record.html': ['workspace-home', 'task-center', 'result-workspace', 'exception-workspace'],
  'examples-catalog': ['task-center', 'workspace-home', 'prepare-workspace', 'result-workspace'],
  'review_board.html': ['result-workspace', 'workspace-home', 'task-center'],
  'preflight_board.html': ['prepare-workspace', 'workspace-home', 'task-center'],
  'prompt_preview.html': ['prepare-workspace', 'workspace-home', 'task-center'],
  'assets_board.html': ['prepare-workspace', 'workspace-home', 'task-center'],
  'run_overview.html': ['result-workspace', 'workspace-home', 'run-record'],
  'rerun_board.html': ['exception-workspace', 'result-workspace', 'workspace-home'],
};

const DISPLAY_GOVERNANCE_PAGE_BY_STAGE = {
  home: 'workspace_home.html',
  prepare: 'prepare_workspace.html',
  result: 'result_workspace.html',
  exception: 'exception_workspace.html',
};

const DISPLAY_GOVERNANCE_FALLBACK_BY_PAGE = {
  'run_record.html': 'workspace_home.html',
  'storyboard_board.html': 'result_workspace.html',
  'review_board.html': 'result_workspace.html',
  'preflight_board.html': 'prepare_workspace.html',
  'prompt_preview.html': 'prepare_workspace.html',
  'assets_board.html': 'prepare_workspace.html',
  'run_overview.html': 'result_workspace.html',
  'rerun_board.html': 'exception_workspace.html',
  'result_hub.html': 'result_workspace.html',
  'daoge_portal.html': 'workspace_home.html',
  'examples-catalog': 'workspace_home.html',
};

const BASE_NAVIGATION_GOVERNANCE = {
  topLinkIds: ['task-center', 'workspace-home', 'result-workspace'],
  progressTrackIds: PRIMARY_WORKBENCH_IDS.slice(),
  defaultVisibleGroups: ['entry', 'mainline'],
  defaultGeneratedGroups: ['entry', 'mainline', 'support'],
  defaultGeneratedMainlineGroups: ['entry', 'mainline'],
  defaultGeneratedSupportGroups: ['support'],
};

const BASE_DISPLAY_GOVERNANCE = {
  showSummaryByDefault: false,
  surfaceRules: {
    progressWindowRadius: 1,
    routeMaxNextSteps: 1,
    workbenchMaxCards: 1,
  },
  sectionGroups: {
    default: {
      title: '先看这些',
      copy: '四个主页面都先只看这一层：阶段判断、主控动作、阶段接力和状态栈。',
      sectionKeys: ['flow', 'judgment', 'stageRelay', 'statusStack'],
      open: true,
      tone: 'default',
      audience: 'all',
    },
    content: {
      title: '当前工作区',
      copy: '这一层只放当前阶段真正要操作、浏览或判断的主要内容，不再和协同解释混在一起。',
      sectionKeys: ['content'],
      open: true,
      tone: 'support',
      audience: 'all',
    },
    support: {
      title: '按需补充',
      copy: getWorkspaceDenseCopy().supportGroupCopy,
      sectionKeys: ['assets'],
      open: false,
      tone: 'support',
      audience: 'all',
      summaryLabel: '展开按需补充',
    },
    advanced: {
      title: '进阶补充',
      copy: getWorkspaceDenseCopy().advancedGroupCopy,
      sectionKeys: ['timeline'],
      open: false,
      tone: 'advanced',
      audience: 'pro',
      summaryLabel: '展开进阶补充',
    },
  },
  order: ['default', 'content', 'support', 'advanced'],
  modeSwitch: {
    title: '工作台视图',
    defaultMode: 'newcomer',
    newcomerLabel: '简洁查看',
    proLabel: '进阶查看',
    copy: '默认先看简洁查看，只保留当前最重要的判断。想一次看到更多补充层，再切到进阶查看。',
  },
};

const DISPLAY_GOVERNANCE_BY_PAGE = {
  'workspace_home.html': {
    showSummaryByDefault: false,
    sectionGroups: {
      default: {
        copy: '首页先看当前判断和阶段接力，确认方向后马上进入当前工作区，不把第一屏留给过多解释层。',
        sectionKeys: ['judgment', 'stageRelay'],
      },
      content: {
        copy: '首页把当前任务真正要看的入口和内容提到前面，判断清楚后就直接进入执行区域。',
        sectionKeys: ['content'],
      },
      support: {
        copy: '首页把流程状态和状态栈后退成补充层，只有需要时再展开看全局脉络。',
        sectionKeys: ['flow', 'statusStack', 'assets'],
      },
    },
    modeSwitch: {
      copy: '默认先看简洁查看，只保留当前最重要的判断。想一次看到更多补充层，再切到进阶查看。',
    },
  },
  'prepare_workspace.html': {
    showSummaryByDefault: false,
    sectionGroups: {
      default: {
        copy: '准备页先看放行判断和阶段接力，确认这一步能不能继续后，就马上进入方向、素材和准备内容。',
        sectionKeys: ['judgment', 'stageRelay'],
      },
      content: {
        copy: '准备页把方向、放行和素材相关的真正工作内容提前，判断后直接进入当前工作区。',
        sectionKeys: ['content'],
      },
      support: {
        copy: '准备页把流程状态、状态栈和阶段交接后退成补充层，需要时再看完整准备脉络。',
        sectionKeys: ['flow', 'statusStack', 'transitions'],
      },
      advanced: {
        copy: '这里保留准备页的阶段回放，只有需要回看上下文时再展开。',
        sectionKeys: ['timeline'],
      },
    },
    modeSwitch: {
      copy: '先用简洁查看确认方向、放行和素材，只有在需要更细判断时再切到进阶查看。',
    },
  },
  'result_workspace.html': {
    showSummaryByDefault: false,
    sectionGroups: {
      default: {
        copy: '结果页先看主判断，再马上进入看图与取舍区域；阶段接力和状态信号后退，不挡第一屏执行。',
        sectionKeys: ['judgment'],
      },
      content: {
        copy: '结果页把看图、问题和结果判断相关的真正工作内容提前，判断后立刻进入筛图与收口。',
        sectionKeys: ['content'],
      },
      support: {
        copy: '结果页把阶段接力、状态栈和下一页交接收成补充层，完成筛图后再用它顺主链继续。',
        sectionKeys: ['stageRelay', 'statusStack', 'transitions'],
      },
      advanced: {
        copy: '这里保留结果页的协同提示、阶段回放和结构补充，只有需要深看时再展开。',
        sectionKeys: ['collaboration', 'timeline', 'advanced', 'summary'],
      },
    },
    modeSwitch: {
      copy: '先用简洁查看做筛图和下一步判断，想同时看更多补充结构时再切到进阶查看。',
    },
  },
  'exception_workspace.html': {
    showSummaryByDefault: false,
    sectionGroups: {
      default: {
        copy: '异常页先看主判断，再马上进入失败项与待复核区；阶段接力和状态信号后退，不挡问题处理入口。',
        sectionKeys: ['judgment'],
      },
      content: {
        copy: '异常页把失败项、待复核项和补跑候选提前，判断后立刻进入问题收口区。',
        sectionKeys: ['content'],
      },
      support: {
        copy: '异常页把阶段接力、状态栈和回主链交接收成补充层，处理完问题后再看怎么送回主链。',
        sectionKeys: ['stageRelay', 'statusStack', 'transitions'],
      },
      advanced: {
        copy: '这里保留异常页的协同提示、阶段回放和补充摘要，只有需要复盘问题来源时再展开。',
        sectionKeys: ['collaboration', 'timeline', 'summary'],
      },
    },
    modeSwitch: {
      copy: '先用简洁查看锁定最需要处理的问题，想继续看补充复核层时再切到进阶查看。',
    },
  },
};

const NAVIGATION_GOVERNANCE_BY_PAGE = {
  'workspace_home.html': {
    topLinkIds: ['task-center', 'catalog', 'result-workspace'],
  },
  'prepare_workspace.html': {
    topLinkIds: ['workspace-home', 'task-center', 'result-workspace', 'catalog'],
  },
  'result_workspace.html': {
    topLinkIds: ['workspace-home', 'task-center', 'exception-workspace'],
  },
  'exception_workspace.html': {
    topLinkIds: ['workspace-home', 'task-center', 'result-workspace'],
  },
  'storyboard_board.html': {
    topLinkIds: ['workspace-home', 'task-center', 'result-workspace'],
  },
  'run_record.html': {
    topLinkIds: ['workspace-home', 'task-center', 'result-workspace', 'exception-workspace'],
  },
  'examples-catalog': {
    topLinkIds: ['task-center', 'workspace-home', 'prepare-workspace', 'result-workspace'],
  },
  'review_board.html': {
    topLinkIds: ['result-workspace', 'workspace-home', 'task-center'],
  },
  'preflight_board.html': {
    topLinkIds: ['prepare-workspace', 'workspace-home', 'task-center'],
  },
  'prompt_preview.html': {
    topLinkIds: ['prepare-workspace', 'workspace-home', 'task-center'],
  },
  'assets_board.html': {
    topLinkIds: ['prepare-workspace', 'workspace-home', 'task-center'],
  },
  'run_overview.html': {
    topLinkIds: ['result-workspace', 'workspace-home', 'run-record'],
  },
  'rerun_board.html': {
    topLinkIds: ['exception-workspace', 'result-workspace', 'workspace-home'],
  },
};

function getSectionSpecsSnapshot(stage) {
  const specs = getStageSectionSpecs(stage);
  return Object.fromEntries(specs.map((spec) => [spec.key, spec]));
}

function cloneDisplaySectionGroup(group = {}) {
  return {
    ...group,
    sectionKeys: Array.isArray(group.sectionKeys) ? group.sectionKeys.slice() : [],
  };
}

function resolveSectionKeysForGroup(stageKey, groupKey, baseGroup = {}, overrideGroup = {}) {
  const stageKeys = new Set(getStageSectionKeysByLayer(stageKey, groupKey));
  const stageAvailableKeys = new Set(
    getStageSectionSpecs(stageKey).map((spec) => spec.key)
  );
  if (Array.isArray(overrideGroup.sectionKeys)) {
    return overrideGroup.sectionKeys.filter((key) => stageAvailableKeys.has(key));
  }
  const preferredKeys = Array.isArray(overrideGroup.sectionKeys)
    ? overrideGroup.sectionKeys
    : (Array.isArray(baseGroup.sectionKeys) ? baseGroup.sectionKeys : []);
  return preferredKeys.filter((key) => stageKeys.has(key));
}

function resolveDisplayGovernancePage(options = {}) {
  const currentPage = String(options.currentPage || '').trim();
  const stage = String(options.stage || '').trim();
  if (currentPage && DISPLAY_GOVERNANCE_BY_PAGE[currentPage]) return currentPage;
  if (currentPage && DISPLAY_GOVERNANCE_FALLBACK_BY_PAGE[currentPage]) {
    return DISPLAY_GOVERNANCE_FALLBACK_BY_PAGE[currentPage];
  }
  if (stage && DISPLAY_GOVERNANCE_PAGE_BY_STAGE[stage]) return DISPLAY_GOVERNANCE_PAGE_BY_STAGE[stage];
  return DISPLAY_GOVERNANCE_PAGE_BY_STAGE.home;
}

function getWorkbenchDisplayGovernance(options = {}) {
  const pageKey = resolveDisplayGovernancePage(options);
  const stageKey = String(options.stage || '').trim() || (
    pageKey === 'prepare_workspace.html' ? 'prepare'
      : pageKey === 'result_workspace.html' ? 'result'
      : pageKey === 'exception_workspace.html' ? 'exception'
      : 'home'
  );
  const override = DISPLAY_GOVERNANCE_BY_PAGE[pageKey] || {};
  const baseGroups = BASE_DISPLAY_GOVERNANCE.sectionGroups;
  const overrideGroups = override.sectionGroups || {};
  const defaultKeys = getStageSectionKeysByLayer(stageKey, 'default');
  const supportKeys = getStageSectionKeysByLayer(stageKey, 'support');
  const advancedKeys = getStageSectionKeysByLayer(stageKey, 'advanced');
  const sectionGroups = Object.fromEntries(
    Object.keys(baseGroups).map((key) => [
      key,
      {
        ...cloneDisplaySectionGroup(baseGroups[key]),
        ...(overrideGroups[key] || {}),
        sectionKeys: key === 'default'
          ? resolveSectionKeysForGroup(stageKey, 'default', baseGroups[key], overrideGroups[key] || {})
          : key === 'content'
            ? resolveSectionKeysForGroup(stageKey, 'content', baseGroups[key], overrideGroups[key] || {})
            : key === 'support'
              ? resolveSectionKeysForGroup(stageKey, 'support', baseGroups[key], overrideGroups[key] || {})
              : resolveSectionKeysForGroup(stageKey, 'advanced', baseGroups[key], overrideGroups[key] || {}),
      },
    ])
  );

  return {
    currentPage: pageKey,
    stage: stageKey,
    showSummaryByDefault: override.showSummaryByDefault ?? BASE_DISPLAY_GOVERNANCE.showSummaryByDefault,
    surfaceRules: {
      ...BASE_DISPLAY_GOVERNANCE.surfaceRules,
      ...(override.surfaceRules || {}),
    },
    sectionGroups,
    sectionRegistry: getSectionSpecsSnapshot(stageKey),
    order: Array.isArray(override.order) ? override.order.slice() : BASE_DISPLAY_GOVERNANCE.order.slice(),
    modeSwitch: {
      ...BASE_DISPLAY_GOVERNANCE.modeSwitch,
      ...(override.modeSwitch || {}),
    },
    defaultOpenSections: sectionGroups.default.sectionKeys.slice(),
    supportOpenSections: sectionGroups.support.sectionKeys.slice(),
    contentOpenSections: sectionGroups.content.sectionKeys.slice(),
    advancedOpenSections: sectionGroups.advanced.sectionKeys.slice(),
    contentAudience: String(sectionGroups.content.audience || 'all'),
    defaultAudience: String(sectionGroups.default.audience || 'all'),
    supportAudience: String(sectionGroups.support.audience || 'all'),
    advancedAudience: String(sectionGroups.advanced.audience || 'pro'),
  };
}

function buildGovernedPages(outputDir) {
  return buildPageEntries(outputDir).map((entry) => ({
    ...entry,
    exists: fileExists(entry.file),
    href: fileExists(entry.file) ? path.relative(outputDir, entry.file) : null,
    level: ['entry', 'mainline'].includes(entry.group)
      ? 'primary'
      : (['support', 'conditional', 'advanced'].includes(entry.group)
        ? 'secondary'
        : 'legacy'),
    defaultVisible: ['entry', 'mainline'].includes(entry.group),
  }));
}

function getWorkbenchPageMap(outputDir) {
  return new Map(buildGovernedPages(outputDir).map((entry) => [entry.id, entry]));
}

function getPrimaryWorkbenchIds() {
  return PRIMARY_WORKBENCH_IDS.slice();
}

function getProgressVisibleIds() {
  return BASE_NAVIGATION_GOVERNANCE.progressTrackIds.slice();
}

function getTopLinkPlan(currentPage, options = {}) {
  const currentEntryLevel = String(options.currentEntryLevel || '').trim();
  const defaultPrimaryIds = currentEntryLevel === 'secondary' || currentEntryLevel === 'legacy'
    ? ['workspace-home', 'task-center', 'result-workspace']
    : BASE_NAVIGATION_GOVERNANCE.topLinkIds;
  return (NAVIGATION_GOVERNANCE_BY_PAGE[currentPage]?.topLinkIds || PAGE_TOPLINK_PLANS[currentPage] || defaultPrimaryIds).slice();
}

function getNavigationGovernance(currentPage, options = {}) {
  const currentEntryLevel = String(options.currentEntryLevel || '').trim();
  const artifactLayerProtocol = options.artifactLayerProtocol && typeof options.artifactLayerProtocol === 'object'
    ? options.artifactLayerProtocol
    : {};
  const defaultVisibleLayers = Array.isArray(artifactLayerProtocol.defaultVisibleLayers)
    ? artifactLayerProtocol.defaultVisibleLayers.slice()
    : [];
  const onDemandLayers = Array.isArray(artifactLayerProtocol.onDemandLayers)
    ? artifactLayerProtocol.onDemandLayers.slice()
    : [];
  const topLinkIds = getTopLinkPlan(currentPage, { currentEntryLevel });
  return {
    topLinkIds,
    progressTrackIds: BASE_NAVIGATION_GOVERNANCE.progressTrackIds.slice(),
    defaultVisibleGroups: BASE_NAVIGATION_GOVERNANCE.defaultVisibleGroups.slice(),
    defaultGeneratedGroups: BASE_NAVIGATION_GOVERNANCE.defaultGeneratedGroups.slice(),
    defaultGeneratedMainlineGroups: BASE_NAVIGATION_GOVERNANCE.defaultGeneratedMainlineGroups.slice(),
    defaultGeneratedSupportGroups: BASE_NAVIGATION_GOVERNANCE.defaultGeneratedSupportGroups.slice(),
    governanceReason: {
      defaultVisibleLayers,
      onDemandLayers,
      userFacingRule: String(artifactLayerProtocol.userFacingRule || '').trim() || '',
      summary: defaultVisibleLayers.length
        ? `默认先保留 ${defaultVisibleLayers.join(' / ')} 对应的入口层级，按需层继续后退。`
        : '默认先保留入口层和主链层，按需层继续后退。',
    },
  };
}

function buildOptionalSurfaceGovernance(pages = [], options = {}) {
  const hasStoryboard = Boolean(options.hasStoryboard);
  const optionalPageMode = String(options.optionalPageMode || '').trim().toLowerCase() || 'mainline-only';
  const artifactLayerProtocol = options.artifactLayerProtocol && typeof options.artifactLayerProtocol === 'object'
    ? options.artifactLayerProtocol
    : {};
  const protocolLayers = artifactLayerProtocol.layers && typeof artifactLayerProtocol.layers === 'object'
    ? artifactLayerProtocol.layers
    : {};
  const conditional = pages.filter((entry) => entry.group === 'conditional' && entry.exists);
  const advanced = pages.filter((entry) => entry.group === 'advanced' && entry.exists);

  const visibleConditionalIds = conditional.filter((entry) => {
    if (entry.id === 'storyboard') return hasStoryboard;
    return true;
  }).map((entry) => entry.id);

  const visibleAdvancedIds = advanced.filter((entry) => {
    if (optionalPageMode === 'all') return true;
    if (optionalPageMode === 'prepare-details') return ['preflight-board', 'prompt-preview', 'assets-board'].includes(entry.id);
    if (optionalPageMode === 'result-details') return ['review-board', 'completion-board', 'run-overview', 'rerun-board'].includes(entry.id);
    if (optionalPageMode === 'legacy') return false;
    return false;
  }).map((entry) => entry.id);

  return {
    mode: optionalPageMode,
    conditionalVisibleIds: visibleConditionalIds,
    advancedVisibleIds: visibleAdvancedIds,
    visibleIds: visibleConditionalIds.concat(visibleAdvancedIds),
    showStoryboardEntry: visibleConditionalIds.includes('storyboard'),
    showPrepareDetailEntry: visibleAdvancedIds.some((id) => ['preflight-board', 'prompt-preview', 'assets-board'].includes(id)),
    showResultDetailEntry: visibleAdvancedIds.some((id) => ['review-board', 'completion-board', 'run-overview'].includes(id)),
    showRerunEntry: visibleAdvancedIds.includes('rerun-board'),
    governanceReason: {
      conditionalLayerTitle: String(protocolLayers.conditional?.title || '').trim() || '条件页层',
      advancedLayerTitle: String(protocolLayers.advanced?.title || '').trim() || '进阶页层',
      conditionalHiddenReason: String(protocolLayers.conditional?.hiddenByDefaultReason || '').trim() || '',
      advancedHiddenReason: String(protocolLayers.advanced?.hiddenByDefaultReason || '').trim() || '',
      summary: optionalPageMode === 'all'
        ? '当前允许按需层全部展开，但仍建议先走主链。'
        : (optionalPageMode === 'mainline-only'
          ? '当前按需层默认继续后退，只有主链继续陪跑。'
          : '当前只针对指定的按需层展开对应细页。'),
    },
  };
}

function buildWorkbenchEntryGovernance(currentPage, options = {}) {
  const issueCount = Number(options.issueCount || 0);
  const reviewCount = Number(options.reviewCount || 0);
  const hasRunRecord = Boolean(options.hasRunRecord);
  const showStoryboardEntry = Boolean(options.showStoryboardEntry);
  const homeRouteToException = Boolean(options.homeRouteToException);

  if (currentPage === 'workspace_home.html') {
    if (homeRouteToException) return ['result-workspace'];
    return ['prepare-workspace'];
  }

  if (currentPage === 'prepare_workspace.html') {
    return ['result-workspace', 'workspace-home'];
  }

  if (currentPage === 'result_workspace.html') {
    return [
      'exception-workspace',
      ...(showStoryboardEntry ? ['storyboard'] : []),
      ...(!issueCount && !reviewCount && hasRunRecord ? ['run-record'] : []),
    ];
  }

  if (currentPage === 'exception_workspace.html') {
    return [
      'result-workspace',
      ...(showStoryboardEntry ? ['storyboard'] : []),
    ];
  }

  if (currentPage === 'run_record.html') {
    if (homeRouteToException) return ['result-workspace'];
    if (hasRunRecord) return ['run-record'];
    return ['workspace-home'];
  }

  return [];
}

function classifyWorkbenchPage(outputDir, currentPage) {
  const pages = buildGovernedPages(outputDir);
  return pages.find((entry) => entry.href === currentPage || entry.file.endsWith(currentPage)) || null;
}

function buildGovernanceSnapshot(outputDir, options = {}) {
  const pages = buildGovernedPages(outputDir);
  const hasStoryboard = Boolean(options.hasStoryboard);
  const currentMode = String(options.currentMode || '').trim();
  const currentPage = String(options.currentPage || '').trim();
  const optionalPageMode = String(options.optionalPageMode || '').trim().toLowerCase() || 'mainline-only';
  const artifactLayerProtocol = options.artifactLayerProtocol && typeof options.artifactLayerProtocol === 'object'
    ? options.artifactLayerProtocol
    : {};
  const pagesById = new Map(pages.map((entry) => [entry.id, entry]));

  const mainline = pages.filter((entry) => entry.group === 'mainline' && PRIMARY_WORKBENCH_IDS.includes(entry.id));
  const support = pages.filter((entry) => entry.group === 'support' && entry.exists);
  const entry = pages.filter((entry) => entry.group === 'entry' && entry.exists);
  const conditional = pages.filter((entry) => entry.group === 'conditional').filter((entry) => {
    if (entry.id === 'storyboard') return hasStoryboard && entry.exists;
    return entry.exists;
  });
  const advanced = pages.filter((entry) => entry.group === 'advanced' && entry.exists);

  const currentEntry = currentPage ? classifyWorkbenchPage(outputDir, currentPage) : null;
  const currentLevel = currentEntry?.level || '';
  const navigation = getNavigationGovernance(currentPage, {
    currentEntryLevel: currentLevel,
    artifactLayerProtocol,
  });
  const optionalSurface = buildOptionalSurfaceGovernance(pages, {
    hasStoryboard,
    optionalPageMode,
    artifactLayerProtocol,
  });
  const workbenchEntryIds = buildWorkbenchEntryGovernance(currentPage, {
    issueCount: Number(options.issueCount || 0),
    reviewCount: Number(options.reviewCount || 0),
    hasPrepare: Boolean(options.hasPrepare),
    hasResult: Boolean(options.hasResult),
    hasRunRecord: Boolean(options.hasRunRecord),
    hasTaskCenter: Boolean(options.hasTaskCenter),
    showStoryboardEntry: optionalSurface.showStoryboardEntry,
    homeRouteToException: Boolean(options.homeRouteToException),
  });
  const topLinks = navigation.topLinkIds
    .map((id) => pagesById.get(id))
    .filter(Boolean)
    .filter((entry) => entry.exists);

  const progressTrack = navigation.progressTrackIds
    .map((id) => pagesById.get(id))
    .filter(Boolean)
    .filter((entry) => entry.exists);

  return {
    currentMode: currentMode || null,
    currentPage: currentPage || null,
    currentEntry: currentEntry
      ? {
        id: currentEntry.id,
        label: currentEntry.label,
        level: currentEntry.level,
        stage: currentEntry.stage,
      }
      : null,
    display: getWorkbenchDisplayGovernance({
      currentPage,
      stage: currentEntry?.stage,
    }),
    entry,
    mainline,
    support,
    conditional,
    advanced,
    legacy: pages.filter((entry) => entry.group === 'legacy'),
    defaultVisible: pages.filter((entry) => navigation.defaultVisibleGroups.includes(entry.group)),
    defaultGenerated: pages.filter((entry) => entry.generateByDefault && navigation.defaultGeneratedGroups.includes(entry.group)),
    defaultGeneratedMainline: pages.filter((entry) => entry.generateByDefault && navigation.defaultGeneratedMainlineGroups.includes(entry.group)),
    defaultGeneratedSupport: pages.filter((entry) => entry.generateByDefault && navigation.defaultGeneratedSupportGroups.includes(entry.group)),
    navigation,
    optionalSurface,
    workbenchEntryIds,
    topLinks,
    progressTrack,
    visibility: {
      showCatalog: Boolean(pagesById.get('catalog')?.exists),
      showPrepare: Boolean(pagesById.get('prepare-workspace')?.exists),
      showResult: Boolean(pagesById.get('result-workspace')?.exists),
      showException: Boolean(pagesById.get('exception-workspace')?.exists),
      showStoryboard: Boolean(pagesById.get('storyboard')?.exists && hasStoryboard),
    },
    governanceReason: {
      userFacingRule: String(artifactLayerProtocol.userFacingRule || '').trim() || '',
      navigationSummary: navigation.governanceReason?.summary || '',
      optionalSurfaceSummary: optionalSurface.governanceReason?.summary || '',
      workbenchEntryRule: currentPage === 'workspace_home.html'
        ? '首页只保留一条最值得继续的主链入口，避免再次分岔。'
        : '工作台入口只保留当前阶段真正相关的去向，不把按需层重新抬成主链。',
    },
  };
}

function buildGovernanceSnapshotMap(outputDir, options = {}) {
  return Object.fromEntries(
    GOVERNANCE_SNAPSHOT_PAGES.map((currentPage) => [
      currentPage,
      buildGovernanceSnapshot(outputDir, {
        ...options,
        currentPage,
      }),
    ])
  );
}

module.exports = {
  GOVERNANCE_SNAPSHOT_PAGES,
  PRIMARY_WORKBENCH_IDS,
  PAGE_TOPLINK_PLANS,
  buildGovernedPages,
  buildGovernanceSnapshot,
  buildGovernanceSnapshotMap,
  getWorkbenchPageMap,
  getWorkbenchDisplayGovernance,
  getPrimaryWorkbenchIds,
  getProgressVisibleIds,
  getNavigationGovernance,
  getTopLinkPlan,
  classifyWorkbenchPage,
};
