const { ok, fail } = require('../response');
const { all, run, appendEvent, rowsToObjects } = require('../../db/repository');
const { addCursorClause, clampLimit, encodeCursor } = require('../pagination');

function routeIssues(ctx, req, res) {
  if (req.method === 'GET' && ctx.pathname === '/api/issues') {
    const clauses = ['project_id = ?'];
    const params = [ctx.projectId];
    if (ctx.url.searchParams.get('run_id')) {
      clauses.push('run_id = ?');
      params.push(ctx.url.searchParams.get('run_id'));
    }
    if (ctx.url.searchParams.get('status')) {
      clauses.push('status = ?');
      params.push(ctx.url.searchParams.get('status'));
    }
    if (ctx.url.searchParams.get('q')) {
      clauses.push('(title LIKE ? OR message LIKE ? OR recommended_action LIKE ? OR type LIKE ?)');
      const needle = `%${ctx.url.searchParams.get('q')}%`;
      params.push(needle, needle, needle, needle);
    }
    const filterWhere = clauses.join(' AND ');
    const filterParams = [...params];
    addCursorClause(clauses, params, ctx.url.searchParams.get('cursor'));
    const where = clauses.join(' AND ');
    const limit = clampLimit(ctx.url.searchParams.get('limit'), 50, 100);
    const rows = all(ctx.db, `SELECT * FROM issues WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`, [...params, limit + 1]);
    const items = rows.slice(0, limit);
    ok(res, {
      items: rowsToObjects(items),
      nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null,
      total: all(ctx.db, `SELECT count(*) AS total FROM issues WHERE ${filterWhere}`, filterParams)[0]?.total || 0,
    });
    return true;
  }
  const match = ctx.pathname.match(/^\/api\/issues\/([^/]+)\/resolve$/);
  if (req.method === 'POST' && match) {
    const result = run(ctx.db, `
      UPDATE issues SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now')
      WHERE project_id = ? AND id = ?
    `, [ctx.projectId, match[1]]);
    if (!result.changes) {
      fail(res, 404, 'ISSUE_NOT_FOUND', '没有找到这个问题。', '请刷新问题列表后重试');
      return true;
    }
    appendEvent(ctx.db, {
      projectId: ctx.projectId,
      eventType: 'issue_resolved',
      entityType: 'issue',
      entityId: match[1],
      message: '问题已处理',
    });
    ok(res, { id: match[1], status: 'resolved' });
    return true;
  }
  return false;
}

module.exports = { routeIssues };
