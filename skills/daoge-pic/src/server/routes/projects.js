const { ok } = require('../response');
const { loadProjectSummary, rowsToObjects, all } = require('../../db/repository');
const { addCursorClause, clampLimit, encodeCursor } = require('../pagination');

function routeProjects(ctx, req, res) {
  if (req.method === 'GET' && ctx.pathname === '/api/project') {
    ok(res, loadProjectSummary(ctx.db, ctx.projectId));
    return true;
  }
  if (req.method === 'GET' && ctx.pathname === '/api/events') {
    const clauses = ['project_id = ?'];
    const params = [ctx.projectId];
    if (ctx.url.searchParams.get('run_id')) {
      clauses.push('run_id = ?');
      params.push(ctx.url.searchParams.get('run_id'));
    }
    addCursorClause(clauses, params, ctx.url.searchParams.get('cursor'));
    const where = clauses.join(' AND ');
    const limit = clampLimit(ctx.url.searchParams.get('limit'), 50, 100);
    const rows = all(ctx.db, `SELECT * FROM events WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`, [...params, limit + 1]);
    const items = rows.slice(0, limit);
    ok(res, {
      items: rowsToObjects(items),
      nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null,
      total: all(ctx.db, `SELECT count(*) AS total FROM events WHERE ${where}`, params)[0]?.total || 0,
    });
    return true;
  }
  return false;
}

module.exports = { routeProjects };
