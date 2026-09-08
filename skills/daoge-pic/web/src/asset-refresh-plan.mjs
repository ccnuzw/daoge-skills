function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function pageOffset(page, pageSize) {
  return (positiveInteger(page, 1) - 1) * positiveInteger(pageSize, 24);
}

export function assetRefreshPath(route, pagination = null) {
  if (!['assets', 'trash', 'deliveries', 'lineage'].includes(route.view)) return null;
  const params = new URLSearchParams();
  params.set('scope', route.assetScope);
  if (route.projectId) params.set('projectId', route.projectId);
  if (route.assetScope === 'round') { if (!route.roundId) return null; params.set('roundId', route.roundId); }
  if (route.assetScope === 'task') { if (!route.taskId) return null; params.set('taskId', route.taskId); }
  if (route.assetScope === 'project') { if (!route.projectId) return null; }
  if (route.view === 'trash') params.set('deleted', 'only');
  if (route.view === 'lineage') params.set('limit', '500');
  if (pagination) {
    params.set('limit', String(positiveInteger(pagination.pageSize, 24)));
    params.set('offset', String(pageOffset(pagination.page, pagination.pageSize)));
    if (pagination.filter !== 'all') params.set('kind', pagination.filter);
  }
  return '/api/assets?' + params.toString();
}

export function assetRefreshRequests(route, pagination) {
  const path = assetRefreshPath(route, pagination);
  return path ? [path] : [];
}
