export const ASSET_PAGE_SIZES = Object.freeze([16, 24, 32, 48, 64, 96]);
export const DEFAULT_ASSET_PAGE_SIZE = 24;

export function normalizeAssetPageSize(value) {
  const size = Number(value);
  return ASSET_PAGE_SIZES.includes(size) ? size : DEFAULT_ASSET_PAGE_SIZE;
}

export function assetPageCount(total, pageSize) {
  const count = Math.max(0, Number.isFinite(Number(total)) ? Math.floor(Number(total)) : 0);
  return Math.max(1, Math.ceil(count / normalizeAssetPageSize(pageSize)));
}

export function clampAssetPage(page, total, pageSize) {
  const normalized = Math.max(1, Number.isFinite(Number(page)) ? Math.floor(Number(page)) : 1);
  return Math.min(normalized, assetPageCount(total, pageSize));
}

export function assetPageOffset(page, pageSize) {
  const size = normalizeAssetPageSize(pageSize);
  return (Math.max(1, Number.isFinite(Number(page)) ? Math.floor(Number(page)) : 1) - 1) * size;
}
