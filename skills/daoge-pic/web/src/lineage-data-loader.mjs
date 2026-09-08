import { assetRefreshPath } from './asset-refresh-plan.mjs';
import { DEFAULT_RUN_ITEM_FILTER, normalizeRunItemPage, serializeRunItemRequestQuery } from './run-item-pagination.mjs';

export const LINEAGE_ASSET_PAGE_SIZE = 500;
export const LINEAGE_RUN_ITEM_PAGE_SIZE = 100;
export const EMPTY_LINEAGE_RUN_ITEM_COVERAGE = Object.freeze({ loaded: 0, total: 0 });
const EMPTY = Object.freeze([]);

export async function loadCompleteLineageRunItems(runs, requestJson, requireCurrent = () => undefined) {
  const items = [];
  let total = 0;
  for (const run of Array.isArray(runs) ? runs : EMPTY) {
    if (!run?.id) continue;
    const runId = encodeURIComponent(run.id);
    const first = normalizeRunItemPage(await requestJson('/api/runs/' + runId + '/items?' + serializeRunItemRequestQuery({ page: 1, pageSize: LINEAGE_RUN_ITEM_PAGE_SIZE, filter: DEFAULT_RUN_ITEM_FILTER, sequence: null })), LINEAGE_RUN_ITEM_PAGE_SIZE);
    requireCurrent();
    items.push(...first.items);
    total += first.total;
    if (first.totalPages <= 1) continue;
    const rest = await Promise.all(Array.from({ length: first.totalPages - 1 }, (_, index) => requestJson('/api/runs/' + runId + '/items?' + serializeRunItemRequestQuery({ page: index + 2, pageSize: LINEAGE_RUN_ITEM_PAGE_SIZE, filter: DEFAULT_RUN_ITEM_FILTER, sequence: null }))));
    requireCurrent();
    for (const page of rest) items.push(...normalizeRunItemPage(page, LINEAGE_RUN_ITEM_PAGE_SIZE).items);
  }
  return { items, total, loaded: items.length };
}

export async function loadCompleteLineageAssets(route, requestJson, requireCurrent = () => undefined) {
  const firstPath = assetRefreshPath(route, { page: 1, pageSize: LINEAGE_ASSET_PAGE_SIZE, filter: 'all' });
  if (!firstPath) return { assets: EMPTY, total: 0 };
  const first = await requestJson(firstPath);
  requireCurrent();
  const assets = first.assets || EMPTY;
  const total = Number.isInteger(first.total) ? first.total : assets.length;
  if (assets.length >= total) return { assets, total };
  const pageCount = Math.ceil(total / LINEAGE_ASSET_PAGE_SIZE);
  const rest = await Promise.all(Array.from({ length: pageCount - 1 }, (_, index) => {
    const path = assetRefreshPath(route, { page: index + 2, pageSize: LINEAGE_ASSET_PAGE_SIZE, filter: 'all' });
    return requestJson(path);
  }));
  requireCurrent();
  return { assets: assets.concat(...rest.flatMap((page) => page.assets || EMPTY)), total };
}
