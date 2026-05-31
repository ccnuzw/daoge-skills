const path = require('path');

const PAGE_REGISTRY = [
  {
    id: 'catalog',
    label: '中文模板展示板',
    kind: 'entry',
    audience: 'starter',
    stage: 'starter',
    file: (outputDir) => path.join(__dirname, '..', 'references', 'examples', 'examples_catalog.html'),
    summary: '先选任务类型和推荐入口',
    group: 'entry',
    generateByDefault: true,
  },
  {
    id: 'task-center',
    label: '任务总控',
    kind: 'primary',
    audience: 'all',
    stage: 'hub',
    file: (outputDir) => path.join(path.dirname(outputDir), 'task_center.html'),
    summary: '跨任务选择与继续旧任务',
    group: 'entry',
    generateByDefault: true,
  },
  {
    id: 'workspace-home',
    label: '工作台首页',
    kind: 'primary',
    audience: 'all',
    stage: 'hub',
    file: (outputDir) => path.join(outputDir, 'workspace_home.html'),
    summary: '当前阶段、下一步与异常总控',
    group: 'mainline',
    generateByDefault: true,
  },
  {
    id: 'prepare-workspace',
    label: '准备工作台',
    kind: 'primary',
    audience: 'all',
    stage: 'prepare',
    file: (outputDir) => path.join(outputDir, 'prepare_workspace.html'),
    summary: '合并方向、放行和素材准备',
    group: 'mainline',
    generateByDefault: true,
  },
  {
    id: 'result-workspace',
    label: '结果工作台',
    kind: 'primary',
    audience: 'all',
    stage: 'result',
    file: (outputDir) => path.join(outputDir, 'result_workspace.html'),
    summary: '合并筛图、摘要和收口判断',
    group: 'mainline',
    generateByDefault: true,
  },
  {
    id: 'exception-workspace',
    label: '异常工作台',
    kind: 'primary',
    audience: 'all',
    stage: 'exception',
    file: (outputDir) => path.join(outputDir, 'exception_workspace.html'),
    summary: '只处理失败、待复核和补跑建议',
    group: 'mainline',
    generateByDefault: true,
  },
  {
    id: 'run-record',
    label: '任务档案',
    kind: 'primary',
    audience: 'all',
    stage: 'archive',
    file: (outputDir) => path.join(outputDir, 'run_record.html'),
    summary: '把运行记录翻译成人话说明',
    group: 'support',
    generateByDefault: true,
  },
  {
    id: 'storyboard',
    label: '分镜整板补充页',
    kind: 'conditional',
    audience: 'advanced',
    stage: 'result',
    file: (outputDir) => path.join(outputDir, 'storyboard_board.html'),
    summary: '分镜任务按需回看整板上下文，普通任务默认不进入',
    group: 'conditional',
    generateByDefault: false,
  },
  {
    id: 'review-board',
    label: '审阅看板',
    kind: 'secondary',
    audience: 'advanced',
    stage: 'review',
    file: (outputDir) => path.join(outputDir, 'review_board.html'),
    summary: '高级审阅与对比分析',
    group: 'advanced',
    generateByDefault: false,
  },
  {
    id: 'result-hub',
    label: '旧结果维护说明页',
    kind: 'legacy',
    audience: 'advanced',
    stage: 'legacy',
    file: (outputDir) => path.join(outputDir, 'result_hub.html'),
    summary: '旧结果维护说明页，后续不再面向普通用户',
    group: 'legacy',
    generateByDefault: false,
  },
  {
    id: 'completion-board',
    label: '完成摘要补充页',
    kind: 'secondary',
    audience: 'advanced',
    stage: 'summary',
    file: (outputDir) => path.join(outputDir, 'completion_board.html'),
    summary: '完成摘要与历史兼容说明',
    group: 'advanced',
    generateByDefault: false,
  },
  {
    id: 'preflight-board',
    label: '预检总览',
    kind: 'secondary',
    audience: 'advanced',
    stage: 'prepare',
    file: (outputDir) => path.join(outputDir, 'preflight_board.html'),
    summary: '旧预检视图，已被准备工作台吸收',
    group: 'advanced',
    generateByDefault: false,
  },
  {
    id: 'prompt-preview',
    label: '提示词预览页',
    kind: 'secondary',
    audience: 'advanced',
    stage: 'prepare',
    file: (outputDir) => path.join(outputDir, 'prompt_preview.html'),
    summary: '旧提示词预览视图，已降级为辅助页',
    group: 'advanced',
    generateByDefault: false,
  },
  {
    id: 'assets-board',
    label: '素材看板',
    kind: 'secondary',
    audience: 'advanced',
    stage: 'prepare',
    file: (outputDir) => path.join(outputDir, 'assets_board.html'),
    summary: '旧素材视图，已降级为辅助页',
    group: 'advanced',
    generateByDefault: false,
  },
  {
    id: 'run-overview',
    label: '运行概览',
    kind: 'secondary',
    audience: 'advanced',
    stage: 'summary',
    file: (outputDir) => path.join(outputDir, 'run_overview.html'),
    summary: '旧运行概览页，保留为辅助说明',
    group: 'advanced',
    generateByDefault: false,
  },
  {
    id: 'rerun-board',
    label: '补跑页',
    kind: 'secondary',
    audience: 'advanced',
    stage: 'exception',
    file: (outputDir) => path.join(outputDir, 'rerun_board.html'),
    summary: '高级补跑入口，普通用户默认不看',
    group: 'advanced',
    generateByDefault: false,
  },
  {
    id: 'portal-home',
    label: '旧入口维护说明页',
    kind: 'legacy',
    audience: 'advanced',
    stage: 'legacy',
    file: (outputDir) => path.join(outputDir, 'daoge_portal.html'),
    summary: '旧入口维护说明页，后续不再纳入主链',
    group: 'legacy',
    generateByDefault: false,
  },
];

function buildPageEntries(outputDir) {
  return PAGE_REGISTRY.map((entry) => ({
    ...entry,
    file: entry.file(outputDir),
  }));
}

function getPageEntry(outputDir, id) {
  return buildPageEntries(outputDir).find((entry) => entry.id === id) || null;
}

function getEntryPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.group === 'entry');
}

function getMainlinePageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.group === 'mainline');
}

function getSupportPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.group === 'support');
}

function getConditionalPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.group === 'conditional');
}

function getAdvancedPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.group === 'advanced');
}

function getPrimaryPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => ['entry', 'mainline', 'support'].includes(entry.group));
}

function getSecondaryPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => ['conditional', 'advanced'].includes(entry.group));
}

function getLegacyPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.group === 'legacy');
}

function getDefaultGeneratedPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.generateByDefault);
}

function getDefaultVisiblePageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => ['entry', 'mainline'].includes(entry.group));
}

function getDefaultGeneratedMainlinePageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.generateByDefault && ['entry', 'mainline'].includes(entry.group));
}

function getDefaultGeneratedSupportPageEntries(outputDir) {
  return buildPageEntries(outputDir).filter((entry) => entry.generateByDefault && entry.group === 'support');
}

module.exports = {
  PAGE_REGISTRY,
  buildPageEntries,
  getPageEntry,
  getEntryPageEntries,
  getMainlinePageEntries,
  getSupportPageEntries,
  getConditionalPageEntries,
  getAdvancedPageEntries,
  getPrimaryPageEntries,
  getSecondaryPageEntries,
  getLegacyPageEntries,
  getDefaultGeneratedPageEntries,
  getDefaultVisiblePageEntries,
  getDefaultGeneratedMainlinePageEntries,
  getDefaultGeneratedSupportPageEntries,
};
