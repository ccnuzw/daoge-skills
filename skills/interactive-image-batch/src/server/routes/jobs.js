const { ok, fail, readJsonObjectBody } = require('../response');
const { all, get, createJob, rowsToObjects } = require('../../db/repository');
const { runJob, cancelJob } = require('../../domain/job_runner');
const { addCursorClause, clampLimit, encodeCursor } = require('../pagination');

async function routeJobs(ctx, req, res) {
  if (req.method === 'GET' && ctx.pathname === '/api/jobs') {
    const clauses = ['project_id = ?'];
    const params = [ctx.projectId];
    if (ctx.url.searchParams.get('status')) {
      clauses.push('status = ?');
      params.push(ctx.url.searchParams.get('status'));
    }
    addCursorClause(clauses, params, ctx.url.searchParams.get('cursor'));
    const where = clauses.join(' AND ');
    const limit = clampLimit(ctx.url.searchParams.get('limit'), 50, 100);
    const rows = all(ctx.db, `SELECT * FROM jobs WHERE ${where} ORDER BY updated_at DESC, id DESC LIMIT ?`, [...params, limit + 1]);
    const items = rows.slice(0, limit);
    ok(res, {
      items: rowsToObjects(items),
      nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null,
      total: all(ctx.db, `SELECT count(*) AS total FROM jobs WHERE ${where}`, params)[0]?.total || 0,
    });
    return true;
  }
  if (req.method === 'POST' && ctx.pathname === '/api/jobs/rerun') {
    const body = await readJsonObjectBody(req);
    const id = createJob(ctx.db, ctx.projectId, 'rerun', body);
    ok(res, runJob(ctx.db, ctx.projectId, id, { outputDir: ctx.outputDir }), 201);
    return true;
  }
  const match = ctx.pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && match) {
    const row = get(ctx.db, 'SELECT * FROM jobs WHERE project_id = ? AND id = ?', [ctx.projectId, match[1]]);
    if (!row) {
      fail(res, 404, 'JOB_NOT_FOUND', '没有找到这个任务。', '请刷新队列后重试');
      return true;
    }
    ok(res, rowsToObjects([row])[0]);
    return true;
  }
  const cancelMatch = ctx.pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
  if (req.method === 'POST' && cancelMatch) {
    const job = cancelJob(ctx.db, ctx.projectId, cancelMatch[1]);
    if (!job) {
      fail(res, 404, 'JOB_NOT_FOUND', '没有找到这个任务。', '请刷新队列后重试');
      return true;
    }
    ok(res, job);
    return true;
  }
  return false;
}

module.exports = { routeJobs };
