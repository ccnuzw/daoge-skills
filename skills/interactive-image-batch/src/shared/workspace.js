const fs = require('fs');
const path = require('path');

const VIEW_IDS = ['index', 'prepare', 'results', 'issues', 'record'];
const V2_WORKSPACE_PAGE_FILES = {
  index: 'index.html',
  prepare: 'prepare.html',
  results: 'results.html',
  issues: 'issues.html',
  record: 'record.html',
};
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

function ensureDir(dirPath) {
  fs.mkdirSync(path.resolve(dirPath), { recursive: true });
}

function readJsonIfExists(filePath) {
  if (!filePath) return null;
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) return null;
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
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
  const catalog = readJsonIfExists(catalogPath) || { tasks: [] };
  return Array.isArray(catalog.tasks) ? catalog.tasks : [];
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
  if (/oral|口播|讲解/.test(text)) return 'oralboard';
  if (/cinematic|storyboard|分镜|镜头|短片/.test(text)) return 'cinematic';
  if (/packaging|包装|礼盒|瓶|盒/.test(text)) return 'packaging';
  if (/ecommerce|电商|商品|详情页|主图/.test(text)) return 'ecommerce';
  if (/studio|棚拍|质感/.test(text)) return 'studio';
  return 'portrait';
}

function resolveTask(input = {}) {
  const tasks = loadTaskCatalog();
  const taskId = inferTaskId(input);
  const catalogTask = tasks.find((item) => item.id === taskId) || tasks[0] || {};
  return {
    id: catalogTask.id || taskId,
    title: normalizeText(input.title, catalogTask.name || '生图任务'),
    summary: normalizeText(input.summary || input.contentBrief, catalogTask.plainSummary || '生成一组可筛选的视觉结果'),
    name: catalogTask.name || normalizeText(input.title, '生图任务'),
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
  return {
    total: Number(counts.total || assets.filter((item) => item.kind === 'image_result').length || 0),
    success: Number(hasAssetLibrary ? assets.filter((item) => item.kind === 'image_result' && item.usage?.canSelect).length : (counts.success || 0)),
    failed: Number(hasIssueQueue ? issueItems.filter((item) => item.type === 'hard_failure').length : (counts.failed || 0)),
    needsReview: Number(hasIssueQueue ? issueItems.filter((item) => item.type === 'needs_review').length : (counts.needsReview || 0)),
    rerunCandidates: issueItems.filter((item) => item.type === 'rerun_candidate' && isOpen(item)).length,
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
  V2_WORKSPACE_PAGE_FILES,
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
  resultOutputPath,
  resultOutputExists,
  loadTaskCatalog,
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
