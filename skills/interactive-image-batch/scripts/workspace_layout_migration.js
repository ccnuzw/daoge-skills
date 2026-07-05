const fs = require('fs');
const path = require('path');

const WORKSPACE_FILES = [];

const INTERNAL_FILES = [
  'manifest.json',
  'batch_plan.json',
  'stage_plan.json',
  'job_state.json',
  'checkpoint.json',
  'workspace_state.json',
  'workspace_live_state.json',
  'workspace_assets.json',
  'workspace_timeline.json',
  'workbench_state.json',
  'runtime_state.json',
  'operations_report.json',
  'success.json',
  'failed.json',
  'skipped.json',
  'needs_review.json',
  'rerun_candidates.json',
  'prompts.generated.json',
  'task_spec.normalized.json',
  'prompt_strategy.enriched.json',
  'prompt_validation_report.json',
  'daoge_mode_detection.json',
  'reference_bindings.imported.json',
  'reference_asset_analysis.json',
  'storyboard_bundle.validation.json',
  'host_native_prompt_pack.json',
];

const DEBUG_FILES = [
  'selection_board.md',
  'operations_report.md',
  'contact_sheet_index.md',
  'run_record.md',
  'daoge_completion_report.md',
  'prompt_preview.md',
  'daoge_run_summary.md',
  'daoge_preflight_dashboard.md',
];

const HTML_LINK_ATTR_RE = /\b(href|src)="([^"]+)"/g;
const ROOT_LOCAL_HTML_RE = /^[^./?#][^?#/]*\.html(?:[?#].*)?$/i;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function isExternalReference(value) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(String(value || '').trim());
}

function splitUrlSuffix(value) {
  const text = String(value || '');
  const match = text.match(/^([^?#]*)([?#].*)?$/);
  return {
    pathname: match ? match[1] : text,
    suffix: match ? (match[2] || '') : '',
  };
}

function shouldStayInsideWorkspaceMirror(value) {
  return ROOT_LOCAL_HTML_RE.test(String(value || '').trim());
}

function rewriteWorkspaceMirrorReference(value) {
  const text = String(value || '').trim();
  if (!text || isExternalReference(text) || text.startsWith('/')) return value;
  if (shouldStayInsideWorkspaceMirror(text)) return text;
  const { pathname, suffix } = splitUrlSuffix(text);
  if (!pathname || pathname.startsWith('/')) return value;
  return `../${pathname}${suffix}`;
}

function rewriteWorkspaceMirrorHtml(html) {
  return String(html || '').replace(HTML_LINK_ATTR_RE, (full, attr, value) => {
    const rewritten = rewriteWorkspaceMirrorReference(value);
    return `${attr}="${rewritten}"`;
  });
}

function copyIfExists(outputDir, fileName, targetDir, layer) {
  const source = path.join(outputDir, fileName);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return null;
  ensureDir(targetDir);
  const target = path.join(targetDir, fileName);
  if (layer === 'workspace' && path.extname(fileName).toLowerCase() === '.html') {
    const html = fs.readFileSync(source, 'utf8');
    fs.writeFileSync(target, rewriteWorkspaceMirrorHtml(html));
  } else {
    fs.copyFileSync(source, target);
  }
  return {
    layer,
    file: fileName,
    source,
    mirror: target,
    layoutRole: layer === 'workspace' ? 'workspace-entry' : `${layer}-asset`,
  };
}

function syncWorkspaceLayout(outputDir, options = {}) {
  const root = path.resolve(outputDir);
  const workspaceDir = path.join(root, 'workspace');
  const internalDir = path.join(root, 'internal');
  const debugDir = path.join(root, 'debug');
  const entries = [
    ...WORKSPACE_FILES.map((file) => copyIfExists(root, file, workspaceDir, 'workspace')),
    ...INTERNAL_FILES.map((file) => copyIfExists(root, file, internalDir, 'internal')),
    ...DEBUG_FILES.map((file) => copyIfExists(root, file, debugDir, 'debug')),
  ].filter(Boolean);

  const manifest = {
    kind: 'daoge-workspace-layout-manifest',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'workspace-first',
    outputDir: root,
    principle: 'workspace/internal/debug 是正式分层输出；用户入口固定从 workspace/ 开始，内部状态固定从 internal/ 查看。',
    directories: {
      workspace: workspaceDir,
      internal: internalDir,
      debug: debugDir,
    },
    counts: {
      workspace: entries.filter((entry) => entry.layer === 'workspace').length,
      internal: entries.filter((entry) => entry.layer === 'internal').length,
      debug: entries.filter((entry) => entry.layer === 'debug').length,
      total: entries.length,
    },
    entries,
    source: options.source || 'unknown',
  };

  const manifestPath = path.join(root, 'workspace_layout_manifest.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifestPath, manifest };
}

function resolveWorkspaceMirrorPath(outputDir, fileName, layer = 'workspace') {
  const root = path.resolve(outputDir);
  const normalizedFile = String(fileName || '').trim();
  if (!normalizedFile) return null;
  return path.join(root, layer, normalizedFile);
}

function resolveRecommendedWorkspacePath(outputDir, fileName, layer = 'workspace') {
  const root = path.resolve(outputDir);
  const mirrorPath = resolveWorkspaceMirrorPath(root, fileName, layer);
  return {
    recommendedPath: mirrorPath && fs.existsSync(mirrorPath) ? mirrorPath : path.join(root, fileName),
    sourcePath: path.join(root, fileName),
    mirrorPath,
    mode: mirrorPath && fs.existsSync(mirrorPath) ? 'workspace-first' : 'source-pending',
  };
}

module.exports = {
  syncWorkspaceLayout,
  resolveWorkspaceMirrorPath,
  resolveRecommendedWorkspacePath,
  WORKSPACE_FILES,
  INTERNAL_FILES,
  DEBUG_FILES,
};
