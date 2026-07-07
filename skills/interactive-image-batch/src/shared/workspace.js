const fs = require('fs');
const path = require('path');

const VIEW_IDS = ['index', 'prepare', 'results', 'issues', 'record'];
const STABLE_CLI_COMMANDS = ['prepare', 'execute', 'ingest', 'rerun', 'review'];
const V2_WORKSPACE_PAGE_FILES = {
  index: 'index.html',
  prepare: 'prepare.html',
  results: 'results.html',
  issues: 'issues.html',
  record: 'record.html',
};
const STABLE_USER_WORKSPACE_PATHS = [
  'workspace/index.html',
  'workspace/prepare.html',
  'workspace/results.html',
  'workspace/issues.html',
  'workspace/record.html',
];
const STABLE_DEBUG_PATHS = ['debug/prompts.generated.json'];
const RETIRED_WORKSPACE_PAGE_REPLACEMENTS = {
  'workspace_home.html': 'workspace/index.html',
  'prepare_workspace.html': 'workspace/prepare.html',
  'result_workspace.html': 'workspace/results.html',
  'exception_workspace.html': 'workspace/issues.html',
  'run_record.html': 'workspace/record.html',
};
const ISSUE_TYPES = ['hard_failure', 'needs_review', 'rerun_candidate', 'ignored', 'resolved'];
const RESULT_STATUSES = ['success', 'failed', 'needs_review', 'skipped'];
const ASSET_KINDS = [
  'input',
  'reference',
  'mask',
  'image_result',
  'issue_record',
  'selected_result',
  'export_image',
  'selection_placeholder',
  'export_report',
];
const LIFECYCLE_STATUSES = [
  'ready_for_run',
  'ready_for_review',
  'ready_for_selection',
  'needs_review',
  'needs_attention',
  'recommended_first_pass',
  'user_selected',
  'deliverable_candidate',
  'waiting_for_user_selection',
  'report_ready',
];
const RESOLUTION_STATES = ['open', 'ignored', 'resolved'];
const ISSUE_ACTION_IDS = [
  'review',
  'review_results',
  'handle_issue',
  'ignore_gap',
  'mark_resolved',
  'rerun_candidate',
  'restore_issue',
];
const ISSUE_GROUP_IDS = ['must_handle', 'needs_confirmation', 'worth_rerun', 'can_ignore', 'resolved'];
const USER_FORBIDDEN_TERMS = ['template', 'variant', 'manifest', 'registry', 'runtime', 'artifact', 'slot'];
const JSON_FILE_CACHE = new Map();

function ensureDir(dirPath) {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!filePath) return null;
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function readJsonIfExistsCached(filePath) {
  if (!filePath) return null;
  const absolutePath = path.resolve(filePath);
  if (JSON_FILE_CACHE.has(absolutePath)) return JSON_FILE_CACHE.get(absolutePath);
  const value = readJsonIfExists(absolutePath);
  if (value) JSON_FILE_CACHE.set(absolutePath, value);
  return value;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(filePath, value) {
  const absolutePath = path.resolve(filePath);
  ensureDir(path.dirname(absolutePath));
  const tempPath = path.join(
    path.dirname(absolutePath),
    `.${path.basename(absolutePath)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tempPath, absolutePath);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.results)) return value.results;
  return [];
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function validateEnumValue(name, value, supportedValues) {
  if (!supportedValues.includes(value)) {
    throw new Error(`${name} 不支持: ${value}. 支持: ${supportedValues.join(', ')}`);
  }
  return value;
}

function normalizeEnumValue(name, value, supportedValues, fallback) {
  return validateEnumValue(name, normalizeText(value, fallback), supportedValues);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
    args[key] = value;
    if (value !== 'true') i += 1;
  }
  return args;
}

function ensureV2Layout(outputDir) {
  const root = path.resolve(outputDir);
  const dirs = [
    'workspace',
    'assets/inputs',
    'assets/results',
    'assets/selected',
    'assets/review',
    'assets/issues',
    'assets/exports',
    'assets/exports/final_pack',
    'assets/exports/contact_sheet',
    'assets/exports/selected_images',
    'assets/references',
    'assets/references/人物参考',
    'assets/references/风格参考',
    'assets/references/场景参考',
    'assets/references/产品参考',
    'assets/masks',
    'assets/archive',
    'internal/view_models',
    'debug',
  ];
  dirs.forEach((dir) => ensureDir(path.join(root, dir)));
  return root;
}

function resolveV2WorkspacePage(outputDir, pageId) {
  const fileName = V2_WORKSPACE_PAGE_FILES[pageId];
  if (!fileName) throw new Error(`Unknown v2 workspace page: ${pageId}`);
  return path.join(path.resolve(outputDir), 'workspace', fileName);
}

function v2WorkspacePaths(outputDir) {
  return {
    workspaceIndex: resolveV2WorkspacePage(outputDir, 'index'),
    workspacePrepare: resolveV2WorkspacePage(outputDir, 'prepare'),
    workspaceResults: resolveV2WorkspacePage(outputDir, 'results'),
    workspaceIssues: resolveV2WorkspacePage(outputDir, 'issues'),
    workspaceRecord: resolveV2WorkspacePage(outputDir, 'record'),
  };
}

function normalizeRetiredWorkspacePageText(value) {
  let text = String(value ?? '');
  Object.entries(RETIRED_WORKSPACE_PAGE_REPLACEMENTS).forEach(([legacyName, v2Name]) => {
    text = text.split(legacyName).join(v2Name);
  });
  return text;
}

function normalizeRetiredWorkspacePageRefs(value) {
  if (typeof value === 'string') return normalizeRetiredWorkspacePageText(value);
  if (Array.isArray(value)) return value.map((item) => normalizeRetiredWorkspacePageRefs(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      normalizeRetiredWorkspacePageText(key),
      normalizeRetiredWorkspacePageRefs(item),
    ]));
  }
  return value;
}

function relativeToOutput(outputDir, filePath) {
  if (!filePath) return null;
  const relative = path.relative(path.resolve(outputDir), path.resolve(filePath));
  return relative.startsWith('..') ? path.resolve(filePath) : relative.split(path.sep).join('/');
}

function userFilePart(value, fallback = '未命名') {
  return normalizeText(value, fallback)
    .replace(/[\\/:*?"<>|]+/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 40) || fallback;
}

function numberedName(index, title, status, extension = '.png') {
  const numeric = Number.parseInt(String(index || '').replace(/\D/g, ''), 10);
  const prefix = String(Number.isFinite(numeric) && numeric > 0 ? numeric : 1).padStart(3, '0');
  return `${prefix}_${userFilePart(title, '生图结果')}_${userFilePart(status, '可筛选')}${extension}`;
}

function copyFileIfExists(source, target) {
  if (!source) return false;
  const absoluteSource = path.resolve(source);
  if (!fs.existsSync(absoluteSource) || !fs.statSync(absoluteSource).isFile()) return false;
  ensureDir(path.dirname(target));
  fs.copyFileSync(absoluteSource, target);
  return true;
}

function hardlinkOrCopyFileIfExists(source, target) {
  if (!source) return false;
  const absoluteSource = path.resolve(source);
  let sourceStat;
  try {
    sourceStat = fs.statSync(absoluteSource);
  } catch {
    return false;
  }
  if (!sourceStat.isFile()) return false;
  ensureDir(path.dirname(target));
  try {
    fs.linkSync(absoluteSource, target);
  } catch {
    let targetStat = null;
    try {
      targetStat = fs.statSync(target);
    } catch {
      targetStat = null;
    }
    if (targetStat && sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) {
      return true;
    }
    try {
      if (targetStat) fs.unlinkSync(target);
      fs.linkSync(absoluteSource, target);
      return true;
    } catch {
      // 跨设备硬链接或删除失败时，仍回退到复制以保持兼容。
    }
    fs.copyFileSync(absoluteSource, target);
  }
  return true;
}

function resultOutputPath(outputDir, result = {}) {
  const source = result.sourceOutput || result.output;
  if (!source) return null;
  return path.isAbsolute(source) ? source : path.join(path.resolve(outputDir), source);
}

function resultOutputExists(outputDir, result = {}) {
  const sourcePath = resultOutputPath(outputDir, result);
  return Boolean(sourcePath && fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile());
}

function loadTaskCatalog(skillRoot = path.resolve(__dirname, '..', '..')) {
  const catalogPath = path.join(skillRoot, 'references', 'task_catalog_zh.json');
  const catalog = readJsonIfExistsCached(catalogPath) || { tasks: [] };
  return Array.isArray(catalog.tasks) ? cloneJson(catalog.tasks) : [];
}

function loadTemplateRegistry(skillRoot = path.resolve(__dirname, '..', '..')) {
  const registryPath = path.join(skillRoot, 'references', 'template_registry_zh.json');
  const registry = readJsonIfExistsCached(registryPath) || { templates: [] };
  return Array.isArray(registry.templates) ? cloneJson(registry.templates) : [];
}

const TASK_ID_ALIASES = {
  poster: 'campaign-poster',
  campaign: 'campaign-poster',
  banner: 'campaign-poster',
  ecommerce: 'ecommerce',
  product: 'ecommerce',
  packaging: 'packaging',
  portrait: 'portrait',
  studio: 'studio',
  cinematic: 'cinematic',
  storyboard: 'cinematic',
  oralboard: 'oralboard',
  oral: 'oralboard',
  infographic: 'infographic-board',
  technical: 'technical-diagram',
  diagram: 'technical-diagram',
  map: 'map-route-board',
  ui: 'ui-mockup-board',
  academic: 'academic-figure-board',
  edit: 'image-edit',
  avatar: 'avatar-profile-pack',
  social: 'social-grid',
  typography: 'type-layout-poster',
};

const TASK_INTENT_RULES = [
  { id: 'oralboard', weight: 120, keywords: ['口播分镜', '财经口播', '主持人口播', '主理人口播', '演播厅分镜', '口播板'] },
  { id: 'cinematic', weight: 100, keywords: ['storyboard', '分镜', '镜头序列', '四格', '短片', '剧情画面', '广告镜头'] },
  { id: 'technical-diagram', weight: 95, keywords: ['技术流程图', '架构图', '流程图', 'flowchart', 'system architecture', 'sequence diagram', '拓扑图', 'er diagram', '状态机', '节点', '箭头方向'] },
  { id: 'ui-mockup-board', weight: 92, keywords: ['ui mockup', 'dashboard', '界面视觉稿', '界面稿', 'app dashboard', '底部导航', '课程卡片', 'landing page', 'web mockup'] },
  { id: 'academic-figure-board', weight: 90, keywords: ['graphical abstract', '论文图', '学术图', '机制图', 'research poster', 'scientific schematic', 'publication chart'] },
  { id: 'infographic-board', weight: 88, keywords: ['信息图', 'infographic', '对比图', '步骤图', '数据看板', '图例', 'kpi'] },
  { id: 'map-route-board', weight: 86, keywords: ['路线地图', '旅行路线', '导览图', 'city map', 'route map', '地图', 'itinerary map', 'food map'] },
  { id: 'image-edit', weight: 84, keywords: ['局部修改', '参考图风格迁移', '风格迁移', '修图', '改图', '换背景', '保留人物', '保留商品', 'edit'] },
  { id: 'type-layout-poster', weight: 82, keywords: ['字体排版海报', '双语排版', '文字海报', 'typography poster', 'type layout', '大标题区'] },
  { id: 'social-grid', weight: 80, keywords: ['九宫格', '社媒', '小红书', 'instagram', 'feed', '社交媒体'] },
  { id: 'avatar-profile-pack', weight: 78, keywords: ['头像', 'profile', 'avatar', '圆形裁切', '贴纸', '角色头像'] },
  { id: 'campaign-poster', weight: 76, keywords: ['campaign', '海报', 'poster', 'kv', '主视觉', 'cta', 'banner', '短视频封面', '标题安全区'] },
  { id: 'ecommerce', weight: 74, keywords: ['电商', '商品主图', '商品图', '详情页', '卖点图', '白底', '平台安全区', '货架', '转化图'] },
  { id: 'packaging', weight: 70, keywords: ['包装', '礼盒', '包装概念', '包装板', '纸袋', '标签', '外盒', '内盒', '套组', 'label design'] },
  { id: 'studio', weight: 55, keywords: ['棚拍', '摄影棚', '棚内', 'studio', '质感图'] },
  { id: 'portrait', weight: 50, keywords: ['人像', '肖像', '半身', 'portrait', '近景', '创始人介绍'] },
];

function normalizedTaskId(value) {
  const raw = normalizeText(value).toLowerCase();
  return TASK_ID_ALIASES[raw] || raw;
}

function keywordScore(text, keywords = [], baseWeight = 1) {
  return keywords.reduce((score, keyword) => {
    const term = String(keyword || '').trim().toLowerCase();
    if (!term) return score;
    return text.includes(term) ? score + baseWeight + Math.min(term.length, 12) : score;
  }, 0);
}

function inferTaskId(input = {}) {
  const text = [
    input.intent,
    input.taskId,
    input.contentBrief,
    input.outputMode,
    input.title,
    input.summary,
  ].filter(Boolean).join(' ').toLowerCase();
  const catalogIds = loadTaskCatalog().map((item) => item.id);
  const registryIds = loadTemplateRegistry().map((item) => item.id);
  const isKnownTaskId = (value) => value && (catalogIds.includes(value) || registryIds.includes(value));
  const explicitTaskId = normalizedTaskId(input.taskId);
  const explicitIntentId = normalizedTaskId(input.intent);
  if (isKnownTaskId(explicitTaskId)) return explicitTaskId;
  if (isKnownTaskId(explicitIntentId)) return explicitIntentId;
  if (/(棚拍|摄影棚|棚内)/.test(text) && /(人像|肖像|人物|女性|男性|创始人|模特)/.test(text)) return 'studio';
  if (/(人物|人像|肖像)/.test(text) && /海报/.test(text) && !/(商品|产品|campaign|cta|新品|banner|短视频|标题区|主标题)/.test(text)) return 'portrait';

  const scores = new Map();
  const addScore = (id, score) => {
    if (!id || !score) return;
    scores.set(id, (scores.get(id) || 0) + score);
  };
  TASK_INTENT_RULES.forEach((rule) => addScore(rule.id, keywordScore(text, rule.keywords, rule.weight)));
  loadTaskCatalog().forEach((task) => {
    addScore(task.id, keywordScore(text, [
      task.name,
      task.plainSummary,
      ...toArray(task.bestFor),
      ...toArray(task.userNeeds),
      ...toArray(task.intentKeywords),
    ], 30));
  });
  loadTemplateRegistry().forEach((template) => {
    addScore(template.id, keywordScore(text, [
      template.name,
      template.description,
      template.category,
      ...toArray(template.triggers),
    ], 18));
  });

  if (/(商品|产品|主图|详情页|卖点|白底|平台安全区)/.test(text) && !/(包装|礼盒|外盒|内盒|纸袋|标签)/.test(text)) {
    addScore('ecommerce', 90);
  }
  if (/(棚拍|摄影棚|棚内)/.test(text) && /(人像|肖像|人物|女性|男性|创始人|模特)/.test(text)) addScore('studio', 120);
  if (/(横图|banner|首发|购买按钮)/.test(text)) addScore('campaign-poster', 70);
  if (/(竖版|短视频封面|封面)/.test(text)) addScore('campaign-poster', 45);
  if (/(不要人物|无人物)/.test(text)) {
    scores.delete('portrait');
    scores.delete('studio');
  }

  const ranked = [...scores.entries()].filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]);
  if (ranked.length) {
    const id = ranked[0][0];
    if (id === 'oral-storyboard-board') return 'oralboard';
    if (id === 'cinematic-storyboard') return 'cinematic';
    if (id === 'ecommerce-clean' || id === 'detail-page-set') return 'ecommerce';
    if (id === 'brand-packaging-board') return 'packaging';
    if (id === 'portrait-kv') return 'portrait';
    if (id === 'studio-editorial') return 'studio';
    return id;
  }
  return 'portrait';
}

function resolveTask(input = {}) {
  const tasks = loadTaskCatalog();
  const taskId = inferTaskId(input);
  const catalogTask = tasks.find((item) => item.id === taskId) || {};
  const userTitle = normalizeText(input.title || input.contentBrief || input.summary);
  const fallbackTitle = normalizeText(userTitle, '生图任务');
  return {
    id: taskId,
    title: normalizeText(userTitle, catalogTask.name || fallbackTitle),
    summary: normalizeText(input.summary || input.contentBrief, catalogTask.plainSummary || '生成一组可筛选的视觉结果'),
    name: catalogTask.name || fallbackTitle,
    plainSummary: catalogTask.plainSummary || '',
    bestFor: toArray(catalogTask.bestFor),
    userNeeds: toArray(catalogTask.userNeeds),
    startCommand: catalogTask.startCommand || `--intent ${taskId}`,
  };
}

function normalizeResultStatus(item = {}) {
  if (item.skipped) return 'skipped';
  const raw = normalizeText(item.status || item.hostNativeStatus || (item.ok === false ? 'failed' : 'success')).toLowerCase();
  if (['failed', 'error', 'timeout'].includes(raw) || item.ok === false) return 'failed';
  if (['needs_review', 'review', 'manual_review'].includes(raw)) return 'needs_review';
  if (['skipped'].includes(raw)) return 'skipped';
  return 'success';
}

function classifyResultAvailability(outputDir, result = {}) {
  const status = normalizeEnumValue(
    'result.status',
    RESULT_STATUSES.includes(result.status) ? result.status : normalizeResultStatus(result),
    RESULT_STATUSES,
    'success'
  );
  const outputPath = resultOutputPath(outputDir, result);
  const hasOutputReference = Boolean(result.sourceOutput || result.output);
  const outputExists = resultOutputExists(outputDir, result);
  const failed = status === 'failed';
  const skipped = status === 'skipped';
  const needsReview = status === 'needs_review' && outputExists;
  const success = status === 'success' && outputExists;
  const requiresOutput = status === 'success' || status === 'needs_review';
  const missingOutput = requiresOutput && !outputExists;
  const available = success || needsReview;
  return {
    status,
    outputPath,
    hasOutputReference,
    outputExists,
    requiresOutput,
    available,
    success,
    failed,
    skipped,
    needsReview,
    missingOutput,
    hasIssue: failed || missingOutput,
    canSelect: success,
    canExport: success || needsReview,
    needsAttention: failed || missingOutput,
    canRerun: failed || missingOutput || Boolean(result.worthRerun || result.rerunReason),
  };
}

function flattenManifestResults(manifest = {}) {
  const batches = toArray(manifest.batches);
  const out = [];
  batches.forEach((batch) => {
    toArray(batch.results).forEach((item) => {
      out.push({
        ...item,
        batchNumber: item.batchNumber || batch.batchNumber || null,
      });
    });
  });
  return out;
}

function resultDisplayTitle(item = {}, index = 0, taskTitle = '生图结果') {
  const userLabel = normalizeText(item.userLabel);
  if (userLabel) return userLabel;
  const shot = normalizeText(item.shotLabel || item.shotTitle || item.scene);
  if (shot && /第\s*\d|镜头\s*\d/.test(shot)) return shot;
  const numeric = Number.parseInt(String(item.index || index + 1).replace(/\D/g, ''), 10);
  return `${taskTitle} ${String(Number.isFinite(numeric) ? numeric : index + 1).padStart(3, '0')}`;
}

function publicAsset(asset) {
  return {
    id: asset.id,
    kind: asset.kind,
    userTitle: asset.userTitle,
    userStatus: asset.userStatus,
    userPurpose: asset.userPurpose || '',
    userAction: asset.userAction || '',
    lifecycleStatus: asset.lifecycleStatus || '',
    sourceReason: asset.sourceReason || '',
    path: asset.path,
    previewPath: asset.previewPath || null,
    group: asset.group,
    usage: asset.usage || {},
    relationships: asset.relationships || {},
  };
}

function summarizeCounts(executionManifest = {}, issueQueue = {}, assetLibrary = {}) {
  const counts = executionManifest.counts || {};
  const issueItems = toArray(issueQueue.items);
  const assets = toArray(assetLibrary.assets);
  const hasAssetLibrary = assets.length > 0;
  const hasIssueQueue = issueItems.length > 0;
  const isOpen = (item) => normalizeText(item.resolutionState || item.status, 'open') === 'open';
  const assetCounts = assets.reduce((acc, item) => {
    if (item.kind === 'image_result') {
      acc.total += 1;
      if (item.usage?.canSelect) acc.success += 1;
    }
    return acc;
  }, { total: 0, success: 0 });
  const issueCounts = issueItems.reduce((acc, item) => {
    if (item.type === 'hard_failure') acc.failed += 1;
    if (item.type === 'needs_review') acc.needsReview += 1;
    if (item.type === 'rerun_candidate' && isOpen(item)) acc.rerunCandidates += 1;
    return acc;
  }, { failed: 0, needsReview: 0, rerunCandidates: 0 });
  return {
    total: Number(counts.total || assetCounts.total || 0),
    success: Number(hasAssetLibrary ? assetCounts.success : (counts.success || 0)),
    failed: Number(hasIssueQueue ? issueCounts.failed : (counts.failed || 0)),
    needsReview: Number(hasIssueQueue ? issueCounts.needsReview : (counts.needsReview || 0)),
    rerunCandidates: issueCounts.rerunCandidates,
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertNoUserFacingInternalTerms(text, label = '用户页面') {
  const lower = String(text || '').toLowerCase();
  const found = USER_FORBIDDEN_TERMS.filter((term) => lower.includes(term));
  if (found.length) {
    throw new Error(`${label} 出现工程术语: ${found.join(', ')}`);
  }
}

module.exports = {
  VIEW_IDS,
  STABLE_CLI_COMMANDS,
  V2_WORKSPACE_PAGE_FILES,
  STABLE_USER_WORKSPACE_PATHS,
  STABLE_DEBUG_PATHS,
  RETIRED_WORKSPACE_PAGE_REPLACEMENTS,
  ISSUE_TYPES,
  RESULT_STATUSES,
  ASSET_KINDS,
  LIFECYCLE_STATUSES,
  RESOLUTION_STATES,
  ISSUE_ACTION_IDS,
  ISSUE_GROUP_IDS,
  USER_FORBIDDEN_TERMS,
  ensureDir,
  readJson,
  readJsonIfExists,
  writeJson,
  toArray,
  normalizeText,
  validateEnumValue,
  normalizeEnumValue,
  parseArgs,
  ensureV2Layout,
  resolveV2WorkspacePage,
  v2WorkspacePaths,
  normalizeRetiredWorkspacePageText,
  normalizeRetiredWorkspacePageRefs,
  relativeToOutput,
  userFilePart,
  numberedName,
  copyFileIfExists,
  hardlinkOrCopyFileIfExists,
  resultOutputPath,
  resultOutputExists,
  loadTaskCatalog,
  loadTemplateRegistry,
  inferTaskId,
  resolveTask,
  normalizeResultStatus,
  classifyResultAvailability,
  flattenManifestResults,
  resultDisplayTitle,
  publicAsset,
  summarizeCounts,
  escapeHtml,
  assertNoUserFacingInternalTerms,
};
