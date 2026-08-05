const { ok } = require('../response');
const { all, get, rowsToObjects } = require('../../db/repository');
const { addCursorClause, clampLimit, encodeCursor } = require('../pagination');

function routeRuns(ctx, req, res) {
  if (req.method === 'GET' && ctx.pathname === '/api/runs') {
    const clauses = ['project_id = ?'];
    const params = [ctx.projectId];
    if (ctx.url.searchParams.get('phase')) {
      clauses.push('phase = ?');
      params.push(ctx.url.searchParams.get('phase'));
    }
    addCursorClause(clauses, params, ctx.url.searchParams.get('cursor'));
    const where = clauses.join(' AND ');
    const limit = clampLimit(ctx.url.searchParams.get('limit'), 50, 100);
    const rows = all(ctx.db, `SELECT * FROM runs WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`, [...params, limit + 1]);
    const items = rows.slice(0, limit);
    ok(res, {
      items: rowsToObjects(items),
      nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null,
      total: all(ctx.db, `SELECT count(*) AS total FROM runs WHERE ${where}`, params)[0]?.total || 0,
    });
    return true;
  }
  if (req.method === 'GET' && ctx.pathname === '/api/prompts') {
    const clauses = ['project_id = ?'];
    const params = [ctx.projectId];
    if (ctx.url.searchParams.get('run_id')) {
      clauses.push('run_id = ?');
      params.push(ctx.url.searchParams.get('run_id'));
    }
    if (ctx.url.searchParams.get('q')) {
      clauses.push('(title LIKE ? OR prompt_text LIKE ? OR prompt_index LIKE ?)');
      const needle = `%${ctx.url.searchParams.get('q')}%`;
      params.push(needle, needle, needle);
    }
    addCursorClause(clauses, params, ctx.url.searchParams.get('cursor'));
    const where = clauses.join(' AND ');
    const limit = clampLimit(ctx.url.searchParams.get('limit'), 50, 100);
    const rows = all(ctx.db, `SELECT * FROM prompts WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`, [...params, limit + 1]);
    const items = rows.slice(0, limit);
    ok(res, {
      items: rowsToObjects(items),
      nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null,
      total: all(ctx.db, `SELECT count(*) AS total FROM prompts WHERE ${where}`, params)[0]?.total || 0,
    });
    return true;
  }
  const match = ctx.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const run = get(ctx.db, 'SELECT * FROM runs WHERE project_id = ? AND id = ?', [ctx.projectId, match[1]]);
    const items = all(ctx.db, 'SELECT * FROM run_items WHERE project_id = ? AND run_id = ? ORDER BY item_index', [ctx.projectId, match[1]]);
    const prompts = all(ctx.db, 'SELECT * FROM prompts WHERE project_id = ? AND run_id = ? ORDER BY prompt_index', [ctx.projectId, match[1]]);
    ok(res, { run, items: rowsToObjects(items), prompts: rowsToObjects(prompts) });
    return true;
  }
  return false;
}

module.exports = { routeRuns };
