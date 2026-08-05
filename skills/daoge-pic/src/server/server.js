const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { fail, ok } = require('./response');
const { routeProjects } = require('./routes/projects');
const { routeRuns } = require('./routes/runs');
const { routeAssets } = require('./routes/assets');
const { routeIssues } = require('./routes/issues');
const { routeSelections } = require('./routes/selections');
const { routeJobs } = require('./routes/jobs');
const { routeExports } = require('./routes/exports');
const {
  initializeProject,
  syncWorkspaceToDb,
  projectIdFor,
  openProjectDatabase,
} = require('../db/repository');
const { projectDbPath } = require('../db/connection');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function skillRoot() {
  return path.resolve(__dirname, '..', '..');
}

function appRoot() {
  return path.join(skillRoot(), 'app');
}

function hasLegacyWorkspaceData(outputDir) {
  return [
    'debug/task_spec.normalized.json',
    'debug/prompts.generated.json',
    'internal/execution_manifest.json',
    'internal/issue_queue.json',
    'internal/asset_library.json',
    'internal/workspace_state.json',
  ].some((relative) => fs.existsSync(path.join(outputDir, relative)));
}

function ensureWorkbenchDatabase(outputDir) {
  const root = path.resolve(outputDir);
  if (fs.existsSync(projectDbPath(root))) {
    return { db: openProjectDatabase(root), projectId: projectIdFor(root), dbPath: projectDbPath(root), outputDir: root, imported: false };
  }
  if (hasLegacyWorkspaceData(root)) {
    return { ...syncWorkspaceToDb(root, { snapshotPrefix: 'import_legacy_workspace' }), imported: true };
  }
  return { ...initializeProject(root), imported: false };
}

function safeStaticPath(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const filePath = path.resolve(root, rel);
  const absoluteRoot = path.resolve(root);
  if (!(filePath === absoluteRoot || filePath.startsWith(`${absoluteRoot}${path.sep}`))) return null;
  return fs.existsSync(filePath) && fs.statSync(filePath).isDirectory() ? path.join(filePath, 'index.html') : filePath;
}

function serveStatic(res, root, pathname) {
  const filePath = safeStaticPath(root, pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(res, 404, 'NOT_FOUND', '没有找到这个页面或文件。', '请回到工作台首页');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME_TYPES[ext] || 'application/octet-stream',
    'content-length': fs.statSync(filePath).size,
    'cache-control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(ctx, req, res) {
  if (req.method === 'GET' && ctx.pathname === '/api/health') {
    ok(res, { status: 'ok', projectId: ctx.projectId, outputDir: ctx.outputDir });
    return;
  }
  const routes = [
    routeProjects,
    routeRuns,
    routeAssets,
    routeIssues,
    routeSelections,
    routeJobs,
    routeExports,
  ];
  for (const route of routes) {
    if (await route(ctx, req, res)) return;
  }
  fail(res, 404, 'API_NOT_FOUND', '没有这个 API。', '请检查工作台版本或刷新页面');
}

function createWorkbenchServer(options = {}) {
  const outputDir = path.resolve(options.outputDir || process.cwd());
  const state = ensureWorkbenchDatabase(outputDir);
  const root = options.appRoot || appRoot();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const ctx = {
      db: state.db,
      projectId: state.projectId,
      outputDir: state.outputDir,
      url,
      pathname: url.pathname,
    };
    try {
      if (url.pathname.startsWith('/api/')) {
        await handleApi(ctx, req, res);
        return;
      }
      serveStatic(res, root, url.pathname);
    } catch (error) {
      fail(
        res,
        error.statusCode || 500,
        error.code || 'SERVER_ERROR',
        error.message || '工作台服务出错。',
        error.nextAction || '请查看终端错误并重试'
      );
    }
  });
  return { server, ...state, appRoot: root };
}

function startWorkbenchServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const port = Number(options.port || 0);
  const state = createWorkbenchServer(options);
  return new Promise((resolve, reject) => {
    state.server.once('error', reject);
    state.server.listen(port, host, () => {
      const address = state.server.address();
      const url = `http://${host}:${address.port}/`;
      resolve({ ...state, host, port: address.port, url, appUrl: pathToFileURL(path.join(state.appRoot, 'index.html')).href });
    });
  });
}

module.exports = {
  appRoot,
  ensureWorkbenchDatabase,
  createWorkbenchServer,
  startWorkbenchServer,
  serveStatic,
  safeStaticPath,
};
