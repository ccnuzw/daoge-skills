const test = require('node:test');
const assert = require('node:assert/strict');

async function loadModel() {
  return import('../../web/src/lineage-minimap-model.mjs');
}

test('lineage minimap keeps a centered, reversible world coordinate frame', async () => {
  const { createMinimapGeometry, minimapToWorld, worldToMinimap } = await loadModel();
  const geometry = createMinimapGeometry([
    { x: 0, y: 0, width: 240, height: 112 },
    { x: 2200, y: 420, width: 200, height: 200 }
  ]);
  assert.ok(geometry.offsetY > 0, 'wide graphs must be letterboxed inside the minimap');
  const worldPoint = { x: 2200, y: 420 };
  const minimapPoint = worldToMinimap(geometry, worldPoint.x, worldPoint.y);
  const roundTrip = minimapToWorld(geometry, minimapPoint.x, minimapPoint.y);
  assert.ok(Math.abs(roundTrip.x - worldPoint.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - worldPoint.y) < 1e-9);
});

test('lineage minimap viewport feedback stays inside the map', async () => {
  const { clampWorldPoint, createMinimapGeometry, minimapToWorld, viewportRectForMinimap } = await loadModel();
  const geometry = createMinimapGeometry([
    { x: 0, y: 0, width: 240, height: 112 },
    { x: 2200, y: 420, width: 200, height: 200 }
  ]);
  const clickedOutsideContent = clampWorldPoint(geometry, minimapToWorld(geometry, geometry.width / 2, geometry.height));
  assert.equal(clickedOutsideContent.y, geometry.bounds.bottom);
  const viewport = viewportRectForMinimap(geometry, { x: -2200, y: -420, k: 0.88 }, { width: 900, height: 560 });
  assert.ok(viewport.x >= 0 && viewport.y >= 0);
  assert.ok(viewport.x + viewport.width <= geometry.width);
  assert.ok(viewport.y + viewport.height <= geometry.height);
});

test('lineage minimap aggregates large filtered graphs without losing priority cues', async () => {
  const { createMinimapGeometry, createMinimapItems, minimapToWorld, worldToMinimap } = await loadModel();
  const nodes = Array.from({ length: 1200 }, (_, index) => ({ key: 'node:' + index, x: (index % 60) * 180, y: Math.floor(index / 60) * 150, width: 140, height: 96 }));
  const selectedKeys = new Set(['node:1199']);
  const searchMatchKeys = new Set(['node:1180']);
  const geometry = createMinimapGeometry(nodes);
  const items = createMinimapItems(nodes, geometry, { selectedKeys, searchMatchKeys, limit: 240 });
  assert.ok(items.length <= 240, 'large minimaps must stay within the shared render budget');
  assert.ok(items.some((item) => item.key === 'node:1199' && item.selected));
  assert.ok(items.some((item) => item.key === 'node:1180' && item.searchHit));
  assert.ok(items.some((item) => item.kind === 'aggregate' && item.memberCount > 1));
  const overflowItems = createMinimapItems(nodes, geometry, { selectedKeys: new Set(nodes.slice(0, 300).map((node) => node.key)), limit: 240 });
  assert.ok(overflowItems.some((item) => item.kind === 'aggregate' && item.selected), 'overflowed priority nodes must remain explicitly marked as aggregated');
  const worldPoint = { x: 10620, y: 2850 };
  const roundTrip = minimapToWorld(geometry, ...Object.values(worldToMinimap(geometry, worldPoint.x, worldPoint.y)));
  assert.ok(Math.abs(roundTrip.x - worldPoint.x) < 1e-9);
  assert.ok(Math.abs(roundTrip.y - worldPoint.y) < 1e-9);
});
