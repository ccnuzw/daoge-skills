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
