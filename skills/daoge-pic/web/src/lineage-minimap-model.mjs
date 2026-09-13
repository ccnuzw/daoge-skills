import { LINEAGE_NODE_RENDER_LIMIT } from './lineage-viewport-model.mjs';

export const MINIMAP_WIDTH = 210;
export const MINIMAP_HEIGHT = 134;

const WORLD_PADDING_X = 180;
const WORLD_PADDING_Y = 130;
const DEFAULT_BOUNDS = Object.freeze({ left: -500, top: -400, right: 500, bottom: 400 });

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function validItem(item) {
  return item && Number.isFinite(item.x) && Number.isFinite(item.y);
}

export function minimapBounds(items) {
  const values = Array.isArray(items) ? items.filter(validItem) : [];
  if (!values.length) return { ...DEFAULT_BOUNDS };
  return values.reduce((bounds, item) => {
    const width = Math.max(0, finite(item.width, 0));
    const height = Math.max(0, finite(item.height, 0));
    return {
      left: Math.min(bounds.left, item.x),
      top: Math.min(bounds.top, item.y),
      right: Math.max(bounds.right, item.x + width),
      bottom: Math.max(bounds.bottom, item.y + height)
    };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

export function createMinimapGeometry(items, width = MINIMAP_WIDTH, height = MINIMAP_HEIGHT) {
  const safeWidth = Math.max(1, finite(width, MINIMAP_WIDTH));
  const safeHeight = Math.max(1, finite(height, MINIMAP_HEIGHT));
  const bounds = minimapBounds(items);
  const worldWidth = Math.max(1, bounds.right - bounds.left + WORLD_PADDING_X * 2);
  const worldHeight = Math.max(1, bounds.bottom - bounds.top + WORLD_PADDING_Y * 2);
  const scale = Math.min(safeWidth / worldWidth, safeHeight / worldHeight);
  const contentWidth = worldWidth * scale;
  const contentHeight = worldHeight * scale;
  return {
    bounds,
    width: safeWidth,
    height: safeHeight,
    scale,
    offsetX: (safeWidth - contentWidth) / 2,
    offsetY: (safeHeight - contentHeight) / 2
  };
}

export function worldToMinimap(geometry, x, y) {
  return {
    x: geometry.offsetX + (finite(x, 0) - geometry.bounds.left + WORLD_PADDING_X) * geometry.scale,
    y: geometry.offsetY + (finite(y, 0) - geometry.bounds.top + WORLD_PADDING_Y) * geometry.scale
  };
}

export function minimapToWorld(geometry, x, y) {
  return {
    x: (finite(x, 0) - geometry.offsetX) / geometry.scale + geometry.bounds.left - WORLD_PADDING_X,
    y: (finite(y, 0) - geometry.offsetY) / geometry.scale + geometry.bounds.top - WORLD_PADDING_Y
  };
}

export function clampWorldPoint(geometry, point) {
  return {
    x: Math.min(geometry.bounds.right, Math.max(geometry.bounds.left, finite(point?.x, geometry.bounds.left))),
    y: Math.min(geometry.bounds.bottom, Math.max(geometry.bounds.top, finite(point?.y, geometry.bounds.top)))
  };
}
function minimapItemBounds(item) {
  const width = Math.max(0, finite(item.width, 0));
  const height = Math.max(0, finite(item.height, 0));
  return { x: finite(item.x, 0), y: finite(item.y, 0), width, height };
}

function aggregateMinimapItems(items, geometry, limit, selectedKeys, searchMatchKeys) {
  const maxItems = Math.max(1, Number.isSafeInteger(limit) ? limit : LINEAGE_NODE_RENDER_LIMIT);
  const pinned = items.filter((item) => item.kind === 'node' && (selectedKeys.has(item.key) || searchMatchKeys.has(item.key)));
  const needsAggregate = items.length > maxItems;
  const directLimit = needsAggregate && pinned.length >= maxItems ? Math.max(0, maxItems - 1) : Math.min(maxItems, pinned.length);
  const direct = pinned.slice(0, directLimit);
  const directKeys = new Set(direct.map((item) => item.key));
  const rest = items.filter((item) => !directKeys.has(item.key));
  const aggregateBudget = Math.max(0, maxItems - direct.length);
  if (!rest.length || !aggregateBudget) return direct;

  const columns = Math.max(1, Math.floor(Math.sqrt(aggregateBudget)));
  const rows = Math.max(1, Math.floor(aggregateBudget / columns));
  const cells = new Map();
  for (const item of rest) {
    const point = worldToMinimap(geometry, item.x, item.y);
    const column = Math.min(columns - 1, Math.max(0, Math.floor(point.x / Math.max(1, geometry.width) * columns)));
    const row = Math.min(rows - 1, Math.max(0, Math.floor(point.y / Math.max(1, geometry.height) * rows)));
    const cellKey = row + ':' + column;
    const cell = cells.get(cellKey) || { key: 'aggregate:' + cellKey, kind: 'aggregate', x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity, memberCount: 0, selected: false, searchHit: false, group: false };
    const bounds = minimapItemBounds(item);
    cell.x = Math.min(cell.x, bounds.x);
    cell.y = Math.min(cell.y, bounds.y);
    cell.right = Math.max(cell.right, bounds.x + bounds.width);
    cell.bottom = Math.max(cell.bottom, bounds.y + bounds.height);
    cell.memberCount += 1;
    cell.selected = cell.selected || selectedKeys.has(item.key);
    cell.searchHit = cell.searchHit || searchMatchKeys.has(item.key);
    cell.group = cell.group || item.kind === 'group';
    cells.set(cellKey, cell);
  }
  const aggregates = [...cells.values()].map((cell) => ({
    key: cell.key,
    kind: 'aggregate',
    x: cell.x,
    y: cell.y,
    width: Math.max(1, cell.right - cell.x),
    height: Math.max(1, cell.bottom - cell.y),
    memberCount: cell.memberCount,
    selected: cell.selected,
    searchHit: cell.searchHit,
    group: cell.group
  }));
  return [...direct, ...aggregates.slice(0, aggregateBudget)];
}

/**
 * Bounds minimap DOM work while retaining selected/search cues. Small graphs
 * remain one item per node/group; larger graphs use deterministic spatial
 * aggregate cells, without changing the world coordinate frame.
 */
export function createMinimapItems(nodes, geometry, { groups = [], selectedKeys = new Set(), searchMatchKeys = new Set(), limit = LINEAGE_NODE_RENDER_LIMIT } = {}) {
  const nodeItems = (Array.isArray(nodes) ? nodes : []).filter(validItem).map((node) => ({ ...node, kind: 'node', selected: selectedKeys.has(node.key), searchHit: searchMatchKeys.has(node.key) }));
  const groupItems = (Array.isArray(groups) ? groups : []).filter(validItem).map((group) => ({ ...group, kind: 'group', key: 'group-' + group.id, group: true }));
  const items = [...groupItems, ...nodeItems];
  if (items.length <= Math.max(1, Number.isSafeInteger(limit) ? limit : LINEAGE_NODE_RENDER_LIMIT)) return items;
  return aggregateMinimapItems(items, geometry, limit, selectedKeys, searchMatchKeys);
}

function clippedAxis(start, size, limit) {
  if (size >= limit) return { start: 0, size: limit };
  if (start < 0) return { start: 0, size: Math.max(4, Math.min(limit, start + size)) };
  if (start >= limit) return { start: Math.max(0, limit - 4), size: Math.min(4, limit) };
  return { start, size: Math.max(4, Math.min(limit - start, size)) };
}

export function viewportRectForMinimap(geometry, viewport, canvasSize) {
  const k = Math.max(0.05, finite(viewport?.k, 1));
  const world = worldToMinimap(geometry, -finite(viewport?.x, 0) / k, -finite(viewport?.y, 0) / k);
  const width = Math.max(1, finite(canvasSize?.width, 900)) / k * geometry.scale;
  const height = Math.max(1, finite(canvasSize?.height, 560)) / k * geometry.scale;
  const x = clippedAxis(world.x, width, geometry.width);
  const y = clippedAxis(world.y, height, geometry.height);
  return { x: x.start, y: y.start, width: x.size, height: y.size };
}
