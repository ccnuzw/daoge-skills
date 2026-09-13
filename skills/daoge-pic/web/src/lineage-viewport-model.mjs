export const LINEAGE_NODE_RENDER_LIMIT = 240;
export const LINEAGE_VIEWPORT_MARGIN = 360;

function intersects(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

function distanceToViewport(node, viewport) {
  const nodeCenterX = node.x + node.width / 2;
  const nodeCenterY = node.y + node.height / 2;
  const viewportCenterX = viewport.x + viewport.width / 2;
  const viewportCenterY = viewport.y + viewport.height / 2;
  return Math.hypot(nodeCenterX - viewportCenterX, nodeCenterY - viewportCenterY);
}

export function lineageViewportBounds(viewport, canvasSize, margin = LINEAGE_VIEWPORT_MARGIN) {
  const scale = Number.isFinite(viewport?.k) && viewport.k > 0 ? viewport.k : 1;
  const width = Number.isFinite(canvasSize?.width) ? canvasSize.width : 900;
  const height = Number.isFinite(canvasSize?.height) ? canvasSize.height : 560;
  const x = Number.isFinite(viewport?.x) ? viewport.x : 0;
  const y = Number.isFinite(viewport?.y) ? viewport.y : 0;
  const safeMargin = Math.max(0, Number.isFinite(margin) ? margin : LINEAGE_VIEWPORT_MARGIN);
  return {
    x: -x / scale - safeMargin,
    y: -y / scale - safeMargin,
    width: width / scale + safeMargin * 2,
    height: height / scale + safeMargin * 2
  };
}

/**
 * Keeps the active/search nodes pinned, then renders only the nearest viewport
 * nodes up to a deterministic budget. Hidden nodes remain in the graph model
 * and minimap; this function only bounds React DOM work.
 */
export function virtualizeLineageNodes(nodes, { viewportBounds, selectedKeys = new Set(), searchMatchKeys = new Set(), limit = LINEAGE_NODE_RENDER_LIMIT } = {}) {
  const all = Array.isArray(nodes) ? nodes : [];
  const maxNodes = Math.max(1, Number.isSafeInteger(limit) ? limit : LINEAGE_NODE_RENDER_LIMIT);
  if (all.length <= maxNodes) return { nodes: all, culled: 0, pinned: 0, limited: false };
  const pinnedKeys = new Set();
  const candidates = [];
  for (const [index, node] of all.entries()) {
    if (pinnedKeys.size < maxNodes && selectedKeys.has(node.key)) pinnedKeys.add(node.key);
    else if (pinnedKeys.size < maxNodes && searchMatchKeys.has(node.key)) pinnedKeys.add(node.key);
    else if (viewportBounds && intersects(viewportBounds, node)) candidates.push({ node, index, distance: distanceToViewport(node, viewportBounds) });
  }
  candidates.sort((left, right) => left.distance - right.distance || left.index - right.index);
  const allowedCandidates = Math.max(0, maxNodes - pinnedKeys.size);
  const keptKeys = new Set(pinnedKeys);
  for (const candidate of candidates.slice(0, allowedCandidates)) keptKeys.add(candidate.node.key);
  const rendered = all.filter((node) => keptKeys.has(node.key));
  return { nodes: rendered, culled: Math.max(0, all.length - rendered.length), pinned: pinnedKeys.size, limited: true };
}
