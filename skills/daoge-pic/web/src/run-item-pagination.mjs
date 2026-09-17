export const RUN_ITEM_PAGE_SIZES = Object.freeze([25, 50, 100]);
export const DEFAULT_RUN_ITEM_PAGE_SIZE = 50;
export const DEFAULT_RUN_ITEM_FILTER = 'all';

export const RUN_ITEM_FILTER_OPTIONS = Object.freeze([
  { id: 'all', label: '全部' },
  { id: 'active', label: '进行中' },
  { id: 'attention', label: '需处理' },
  { id: 'waiting', label: '等待' },
  { id: 'succeeded', label: '已完成' },
  { id: 'cancelled', label: '已取消' }
]);

const FILTER_STATUSES = Object.freeze({
  all: [],
  active: ['leased', 'requesting', 'receiving', 'persisting'],
  attention: ['failed', 'blocked', 'outcome_unknown'],
  waiting: ['pending', 'retry_wait', 'cancel_requested'],
  succeeded: ['succeeded'],
  cancelled: ['cancelled']
});

const ALL_STATUS_KEYS = Object.freeze(['pending', 'leased', 'requesting', 'receiving', 'persisting', 'succeeded', 'retry_wait', 'blocked', 'cancel_requested', 'cancelled', 'outcome_unknown', 'failed']);
const RETRYABLE_STATUSES = new Set(['failed', 'blocked', 'retry_wait']);

/**
 * 一页「单张出图」记录的集合。
 * @typedef {object} RunItemPage
 * @property {any[]} items
 * @property {number} page
 * @property {number} pageSize
 * @property {number} total 当前筛选条件下的总数
 * @property {number} totalPages
 * @property {number} allTotal 不筛选时的总数
 * @property {Record<string, number>} statusCounts
 */

// Object.freeze 会把字面量锁成 `readonly` 且字段类型收窄成字面量类型（page: 1 而不是 number），
// 直接拿它当 useState 初始值会让后续赋值全部报错。这里显式声明成可变结构再冻结。
/** @type {RunItemPage} */
export const EMPTY_RUN_ITEM_PAGE = Object.freeze({
  items: [],
  page: 1,
  pageSize: DEFAULT_RUN_ITEM_PAGE_SIZE,
  total: 0,
  totalPages: 1,
  allTotal: 0,
  statusCounts: Object.freeze(Object.fromEntries(ALL_STATUS_KEYS.map((status) => [status, 0])))
});

export function normalizeRunItemFilter(value) {
  return Object.hasOwn(FILTER_STATUSES, value) ? value : DEFAULT_RUN_ITEM_FILTER;
}

export function normalizeRunItemPageSize(value) {
  const size = Number(value);
  return RUN_ITEM_PAGE_SIZES.includes(size) ? size : DEFAULT_RUN_ITEM_PAGE_SIZE;
}

export function normalizeRunItemPageNumber(value) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export function normalizeRunItemSequence(value) {
  if (value === null || value === undefined || value === '') return null;
  const sequence = Number(value);
  return Number.isInteger(sequence) && sequence > 0 ? sequence : null;
}

export function runItemFilterStatuses(filter) {
  return FILTER_STATUSES[normalizeRunItemFilter(filter)];
}

export function runItemFilterCount(statusCounts, filter) {
  const counts = statusCounts && typeof statusCounts === 'object' ? statusCounts : {};
  const statuses = runItemFilterStatuses(filter);
  if (!statuses.length) return ALL_STATUS_KEYS.reduce((total, status) => total + Number(counts[status] || 0), 0);
  return statuses.reduce((total, status) => total + Number(counts[status] || 0), 0);
}

export function runItemProgress(statusCounts) {
  const counts = statusCounts && typeof statusCounts === 'object' ? statusCounts : {};
  return {
    succeeded: Number(counts.succeeded || 0),
    active: runItemFilterCount(counts, 'active'),
    waiting: runItemFilterCount(counts, 'waiting'),
    attention: runItemFilterCount(counts, 'attention'),
    cancelled: Number(counts.cancelled || 0)
  };
}

export function normalizeRunItemPage(payload, fallbackPageSize = DEFAULT_RUN_ITEM_PAGE_SIZE) {
  const value = payload && typeof payload === 'object' ? payload : {};
  const statusCountsSource = value.statusCounts && typeof value.statusCounts === 'object' ? value.statusCounts : {};
  const statusCounts = Object.fromEntries(ALL_STATUS_KEYS.map((status) => [status, Math.max(0, Number(statusCountsSource[status] || 0))]));
  const pageSize = normalizeRunItemPageSize(value.pageSize || fallbackPageSize);
  const total = Math.max(0, Number(value.total || 0));
  const allTotal = Math.max(0, Number(value.allTotal || 0));
  const totalPages = Math.max(1, Number.isInteger(Number(value.totalPages)) ? Number(value.totalPages) : Math.ceil(total / pageSize));
  return {
    items: Array.isArray(value.items) ? value.items : [],
    page: Math.min(normalizeRunItemPageNumber(value.page), totalPages),
    pageSize,
    total,
    totalPages,
    allTotal,
    statusCounts
  };
}

export function runItemPageBounds(page) {
  const value = normalizeRunItemPage(page);
  const start = value.total ? (value.page - 1) * value.pageSize + 1 : 0;
  const end = value.total ? Math.min(value.total, start + value.items.length - 1) : 0;
  return { start, end };
}

/**
 * @param {object} [request]
 * @param {unknown} [request.page]
 * @param {unknown} [request.pageSize]
 * @param {unknown} [request.filter]
 * @param {unknown} [request.sequence]
 */
export function serializeRunItemRequestQuery({ page, pageSize, filter, sequence } = {}) {
  const params = new URLSearchParams();
  params.set('page', String(normalizeRunItemPageNumber(page)));
  params.set('pageSize', String(normalizeRunItemPageSize(pageSize)));
  for (const status of runItemFilterStatuses(filter)) params.append('status', status);
  const normalizedSequence = normalizeRunItemSequence(sequence);
  if (normalizedSequence !== null) params.set('sequence', String(normalizedSequence));
  params.set('sort', 'sequence');
  return params.toString();
}

/**
 * 「还没出完」的项——画布上用它们立占位格（方案 4.9：让等待有形状，而不是只给一个进度数字）。
 * 判据**复用上面的状态分组**，不另写一份状态列表：
 * 进行中（leased/requesting/receiving/persisting）+ 等待（pending/retry_wait/cancel_requested）。
 * 终态一律不占位——包括 failed / blocked / outcome_unknown：它们已经「有结果」了，哪怕是坏结果。
 * @param {any[]} [items]
 */
export function pendingRunItems(items) {
  const pending = new Set([...FILTER_STATUSES.active, ...FILTER_STATUSES.waiting]);
  return (Array.isArray(items) ? items : []).filter((item) => pending.has(item?.status));
}

export function retryableRunItems(items) {
  return (Array.isArray(items) ? items : []).filter((item) => RETRYABLE_STATUSES.has(item?.status));
}

export function selectableRunItemIds(items, selectedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set();
  return retryableRunItems(items).filter((item) => selected.has(item.id)).map((item) => item.id);
}
