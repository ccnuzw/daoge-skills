import { mapWithConcurrency } from './bounded-concurrency.mjs';
import { assetRefreshPath } from './asset-refresh-plan.mjs';
import { DEFAULT_RUN_ITEM_FILTER, normalizeRunItemPage, serializeRunItemRequestQuery } from './run-item-pagination.mjs';

export const LINEAGE_ASSET_PAGE_SIZE = 500;
export const LINEAGE_RUN_ITEM_PAGE_SIZE = 100;
export const LINEAGE_REQUEST_CONCURRENCY = 4;
/**
 * 谱系大批量数据加载的进度。
 * @typedef {object} LineageCoverage
 * @property {number} loaded 已加载条数
 * @property {number} total 预计总条数
 * @property {boolean} loading 是否还在翻页
 */
/** @type {LineageCoverage} */
export const EMPTY_LINEAGE_RUN_ITEM_COVERAGE = Object.freeze({ loaded: 0, total: 0, loading: true });
const EMPTY = Object.freeze([]);

/**
 * @param {unknown} runs
 * @param {(path: string) => Promise<any>} requestJson
 * @param {() => void} [requireCurrent] 每批数据回来后校验这次加载还是不是最新的
 * @param {(payload: object) => void} [onPage] 每翻一页回调一次，让调用方能增量渲染
 */
export async function loadCompleteLineageRunItems(runs, requestJson, requireCurrent = () => undefined, onPage = () => undefined) {
  const items = [];
  let total = 0;
  let emitted = false;
  for (const run of Array.isArray(runs) ? runs : EMPTY) {
    if (!run?.id) continue;
    const runId = encodeURIComponent(run.id);
    const first = normalizeRunItemPage(await requestJson('/api/runs/' + runId + '/items?' + serializeRunItemRequestQuery({ page: 1, pageSize: LINEAGE_RUN_ITEM_PAGE_SIZE, filter: DEFAULT_RUN_ITEM_FILTER, sequence: null })), LINEAGE_RUN_ITEM_PAGE_SIZE);
    requireCurrent();
    items.push(...first.items);
    total += first.total;
    onPage({ runId: run.id, items: first.items, total, loading: true, replace: !emitted });
    emitted = true;
    if (first.totalPages <= 1) continue;
    const rest = await mapWithConcurrency(Array.from({ length: first.totalPages - 1 }, (_, index) => index + 2), (pageNumber) => requestJson('/api/runs/' + runId + '/items?' + serializeRunItemRequestQuery({ page: pageNumber, pageSize: LINEAGE_RUN_ITEM_PAGE_SIZE, filter: DEFAULT_RUN_ITEM_FILTER, sequence: null })), LINEAGE_REQUEST_CONCURRENCY);
    requireCurrent();
    for (const page of rest) {
      const normalized = normalizeRunItemPage(page, LINEAGE_RUN_ITEM_PAGE_SIZE);
      items.push(...normalized.items);
      onPage({ runId: run.id, items: normalized.items, total, loading: true, replace: false });
    }
  }
  return { items, total, loaded: items.length };
}

/** @param {unknown} route @param {(path: string) => Promise<any>} requestJson @param {() => void} [requireCurrent] @param {(payload: object) => void} [onPage] */
export async function loadCompleteLineageAssets(route, requestJson, requireCurrent = () => undefined, onPage = () => undefined) {
  const firstPath = assetRefreshPath(route, { page: 1, pageSize: LINEAGE_ASSET_PAGE_SIZE, filter: 'all' });
  if (!firstPath) return { assets: EMPTY, total: 0 };
  const first = await requestJson(firstPath);
  requireCurrent();
  const assets = first.assets || EMPTY;
  const total = Number.isInteger(first.total) ? first.total : assets.length;
  onPage({ assets, total, loading: true, replace: true });
  if (assets.length >= total) return { assets, total };
  const pageCount = Math.ceil(total / LINEAGE_ASSET_PAGE_SIZE);
  const rest = await mapWithConcurrency(Array.from({ length: pageCount - 1 }, (_, index) => index + 2), (pageNumber) => {
    const path = assetRefreshPath(route, { page: pageNumber, pageSize: LINEAGE_ASSET_PAGE_SIZE, filter: 'all' });
    return requestJson(path);
  }, LINEAGE_REQUEST_CONCURRENCY);
  requireCurrent();
  const normalizedRest = rest.map((page) => page.assets || EMPTY);
  normalizedRest.forEach((pageAssets) => onPage({ assets: pageAssets, total, loading: true, replace: false }));
  return { assets: assets.concat(...normalizedRest), total };
}
