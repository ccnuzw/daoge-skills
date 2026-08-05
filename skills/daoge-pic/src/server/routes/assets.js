const fs = require('fs');
const path = require('path');
const { ok, fail, readJsonObjectBody } = require('../response');
const { all, get, rowsToObjects, addTagToAsset, absoluteAssetPath } = require('../../db/repository');
const { addCursorClause, clampLimit, encodeCursor } = require('../pagination');

function assertInside(root, filePath) {
  const absoluteRoot = path.resolve(root);
  const absoluteFile = path.resolve(filePath);
  return absoluteFile === absoluteRoot || absoluteFile.startsWith(`${absoluteRoot}${path.sep}`);
}

function mimeForAssetPath(filePath, fallback = 'application/octet-stream') {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  const mimes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.json': 'application/json',
    '.html': 'text/html',
  };
  return mimes[ext] || fallback;
}

function downloadName(filePath) {
  return path.basename(String(filePath || 'asset')).replace(/["\r\n]/g, '_') || 'asset';
}

function sendAssetFile(ctx, res, asset, useThumb = false) {
  if (useThumb && asset.thumb_status !== 'ready') {
    fail(res, 404, 'THUMB_MISSING', '缩略图暂不可用。', '请稍后刷新，或打开详情查看文件状态');
    return;
  }
  const rel = useThumb ? asset.thumb_path : asset.path;
  const filePath = absoluteAssetPath(ctx.outputDir, rel);
  if (!filePath || !assertInside(ctx.outputDir, filePath)) {
    fail(res, 403, 'ASSET_PATH_BLOCKED', '资产路径不在当前项目内。', '请从资产库重新选择文件');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    fail(res, 404, 'ASSET_FILE_MISSING', '资产文件不存在。', '请刷新工作台或重新导入资产');
    return;
  }
  const contentType = useThumb ? mimeForAssetPath(asset.thumb_path) : 'application/octet-stream';
  if (useThumb && !String(contentType).startsWith('image/')) {
    fail(res, 404, 'THUMB_MISSING', '缩略图格式不可用。', '请刷新工作台或重新生成缩略图');
    return;
  }
  const headers = {
    'content-type': contentType,
    'content-length': fs.statSync(filePath).size,
    'cache-control': 'no-store',
  };
  if (!useThumb) {
    headers['content-disposition'] = `attachment; filename="${downloadName(asset.path)}"`;
    headers['x-content-type-options'] = 'nosniff';
  }
  res.writeHead(200, {
    ...headers,
  });
  fs.createReadStream(filePath).pipe(res);
}

function buildAssetWhere(ctx) {
  const clauses = ['assets.project_id = ?'];
  const params = [ctx.projectId];
  const q = ctx.url.searchParams;
  if (q.get('kind')) {
    clauses.push('assets.kind = ?');
    params.push(q.get('kind'));
  }
  if (q.get('status')) {
    clauses.push('assets.status = ?');
    params.push(q.get('status'));
  }
  if (q.get('run_id')) {
    clauses.push(`assets.id IN (
      SELECT run_assets.asset_id FROM run_assets
      WHERE run_assets.project_id = ? AND run_assets.run_id = ?
    )`);
    params.push(ctx.projectId);
    params.push(q.get('run_id'));
  }
  if (q.get('q')) {
    clauses.push('(assets.title LIKE ? OR assets.notes LIKE ? OR assets.path LIKE ?)');
    const needle = `%${q.get('q')}%`;
    params.push(needle, needle, needle);
  }
  if (q.get('tag')) {
    clauses.push(`assets.id IN (
      SELECT asset_tags.asset_id
      FROM asset_tags JOIN tags ON tags.id = asset_tags.tag_id
      WHERE asset_tags.project_id = ? AND tags.name = ?
    )`);
    params.push(ctx.projectId, q.get('tag'));
  }
  if (q.get('selected')) {
    clauses.push(`assets.id ${q.get('selected') === 'false' ? 'NOT ' : ''}IN (
      SELECT selections.asset_id FROM selections
      WHERE selections.project_id = ? AND selections.state = 'selected'
    )`);
    params.push(ctx.projectId);
  }
  const filterWhere = clauses.join(' AND ');
  const filterParams = [...params];
  addCursorClause(clauses, params, q.get('cursor'), 'assets');
  return { where: clauses.join(' AND '), params, filterWhere, filterParams };
}

function assetSelectionSelect() {
  return `
    assets.*,
    selections.id AS selection_id,
    selections.state AS selection_state,
    selections.reason AS selection_reason,
    selections.updated_at AS selected_at
  `;
}

function assetSelectionJoin() {
  return `
    LEFT JOIN selections
      ON selections.project_id = assets.project_id
      AND selections.asset_id = assets.id
  `;
}

async function routeAssets(ctx, req, res) {
  if (req.method === 'GET' && ctx.pathname === '/api/assets') {
    const { where, params, filterWhere, filterParams } = buildAssetWhere(ctx);
    const limit = clampLimit(ctx.url.searchParams.get('limit'), 50, 100);
    const rows = all(ctx.db, `
      SELECT ${assetSelectionSelect()}
      FROM assets
      ${assetSelectionJoin()}
      WHERE ${where}
      ORDER BY assets.updated_at DESC, assets.id DESC
      LIMIT ?
    `, [...params, limit + 1]);
    const items = rows.slice(0, limit);
    const total = get(ctx.db, `SELECT count(*) AS total FROM assets WHERE ${filterWhere}`, filterParams)?.total || 0;
    ok(res, { items: rowsToObjects(items), nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null, total });
    return true;
  }
  const fileMatch = ctx.pathname.match(/^\/api\/assets\/([^/]+)\/(file|thumb)$/);
  if (req.method === 'GET' && fileMatch) {
    const asset = get(ctx.db, 'SELECT * FROM assets WHERE project_id = ? AND id = ?', [ctx.projectId, fileMatch[1]]);
    if (!asset) {
      fail(res, 404, 'ASSET_NOT_FOUND', '没有找到这个资产。', '请刷新资产列表后重试');
      return true;
    }
    sendAssetFile(ctx, res, asset, fileMatch[2] === 'thumb');
    return true;
  }
  const tagMatch = ctx.pathname.match(/^\/api\/assets\/([^/]+)\/tags$/);
  if (req.method === 'POST' && tagMatch) {
    const asset = get(ctx.db, 'SELECT id FROM assets WHERE project_id = ? AND id = ?', [ctx.projectId, tagMatch[1]]);
    if (!asset) {
      fail(res, 404, 'ASSET_NOT_FOUND', '没有找到这个资产。', '请刷新资产列表后重试');
      return true;
    }
    const body = await readJsonObjectBody(req);
    const tagName = String(body.name || body.tag || '').trim();
    if (!tagName) {
      fail(res, 400, 'TAG_REQUIRED', '标签不能为空。', '请输入标签名称后重试');
      return true;
    }
    const tagId = addTagToAsset(ctx.db, ctx.projectId, tagMatch[1], tagName);
    ok(res, { tagId });
    return true;
  }
  const match = ctx.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const asset = get(ctx.db, `
      SELECT ${assetSelectionSelect()}
      FROM assets
      ${assetSelectionJoin()}
      WHERE assets.project_id = ? AND assets.id = ?
    `, [ctx.projectId, match[1]]);
    if (!asset) {
      fail(res, 404, 'ASSET_NOT_FOUND', '没有找到这个资产。', '请刷新资产列表后重试');
      return true;
    }
    const tags = all(ctx.db, `
      SELECT tags.* FROM tags
      JOIN asset_tags ON asset_tags.tag_id = tags.id
      WHERE asset_tags.project_id = ? AND asset_tags.asset_id = ?
      ORDER BY tags.name
    `, [ctx.projectId, match[1]]);
    const runAssets = all(ctx.db, `
      SELECT run_assets.*, runs.title AS run_title, runs.phase AS run_phase
      FROM run_assets
      JOIN runs ON runs.id = run_assets.run_id
      WHERE run_assets.project_id = ? AND run_assets.asset_id = ?
      ORDER BY run_assets.created_at DESC
    `, [ctx.projectId, match[1]]);
    const links = all(ctx.db, `
      SELECT * FROM asset_links
      WHERE project_id = ? AND (source_id = ? OR target_id = ?)
      ORDER BY created_at DESC
    `, [ctx.projectId, match[1], match[1]]);
    const prompt = runAssets[0]?.source_prompt_id
      ? get(ctx.db, 'SELECT * FROM prompts WHERE project_id = ? AND id = ?', [ctx.projectId, runAssets[0].source_prompt_id])
      : null;
    const runItem = runAssets[0]?.source_run_item_id
      ? get(ctx.db, 'SELECT * FROM run_items WHERE project_id = ? AND id = ?', [ctx.projectId, runAssets[0].source_run_item_id])
      : null;
    ok(res, {
      asset: rowsToObjects([asset])[0],
      tags,
      runs: rowsToObjects(runAssets),
      links: rowsToObjects(links),
      prompt: prompt ? rowsToObjects([prompt])[0] : null,
      runItem: runItem ? rowsToObjects([runItem])[0] : null,
    });
    return true;
  }
  return false;
}

module.exports = { routeAssets, assertInside };
