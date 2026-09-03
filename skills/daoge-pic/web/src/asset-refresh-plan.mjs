import { assetPageOffset } from './asset-pagination.mjs';

export function assetRefreshPath(route, pagination = null) {
  if (!['assets', 'trash', 'deliveries'].includes(route.view)) return null;
  const params = new URLSearchParams();
  params.set('scope', route.assetScope);
  if (route.projectId) params.set('projectId', route.projectId);
  if (route.assetScope === 'round') { if (!route.roundId) return null; params.set('roundId', route.roundId); }
  if (route.assetScope === 'task') { if (!route.taskId) return null; params.set('taskId', route.taskId); }
  if (route.assetScope === 'project') { if (!route.projectId) return null; }
  if (route.view === 'trash') params.set('deleted', 'only');
  if (pagination) {
    params.set('limit', String(pagination.pageSize));
    params.set('offset', String(assetPageOffset(pagination.page, pagination.pageSize)));
    if (pagination.filter !== 'all') params.set('kind', pagination.filter);
  }
  return '/api/assets?' + params.toString();
}

export function assetRefreshRequests(route, pagination) {
  const path = assetRefreshPath(route, pagination);
  return path ? [path] : [];
}
