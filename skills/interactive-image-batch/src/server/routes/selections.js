const { ok, fail, readJsonObjectBody } = require('../response');
const { get, run, upsertSelection } = require('../../db/repository');

async function routeSelections(ctx, req, res) {
  if (req.method === 'POST' && ctx.pathname === '/api/selections') {
    const body = await readJsonObjectBody(req);
    const assetId = body.asset_id || body.assetId;
    if (!assetId) {
      fail(res, 400, 'ASSET_ID_REQUIRED', '缺少资产 id。', '请从资产列表选择一个资产后重试');
      return true;
    }
    const state = body.state || 'selected';
    if (!['selected', 'rejected', 'needs_review'].includes(state)) {
      fail(res, 400, 'SELECTION_STATE_INVALID', '选择状态不支持。', '请使用 selected、rejected 或 needs_review');
      return true;
    }
    const asset = get(ctx.db, 'SELECT id FROM assets WHERE project_id = ? AND id = ?', [ctx.projectId, assetId]);
    if (!asset) {
      fail(res, 404, 'ASSET_NOT_FOUND', '没有找到这个资产。', '请刷新资产列表后重试');
      return true;
    }
    const selectionId = upsertSelection(ctx.db, ctx.projectId, assetId, state, body.reason || null);
    ok(res, { id: selectionId, asset_id: assetId, state });
    return true;
  }
  const match = ctx.pathname.match(/^\/api\/selections\/([^/]+)$/);
  if (req.method === 'DELETE' && match) {
    run(ctx.db, 'DELETE FROM selections WHERE project_id = ? AND asset_id = ?', [ctx.projectId, match[1]]);
    ok(res, { asset_id: match[1], state: 'removed' });
    return true;
  }
  return false;
}

module.exports = { routeSelections };
