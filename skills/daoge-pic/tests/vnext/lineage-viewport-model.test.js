const assert = require('node:assert/strict');
const test = require('node:test');

test('lineage viewport model bounds DOM nodes while pinning selected and search matches', async () => {
  const { lineageViewportBounds, virtualizeLineageNodes } = await import('../../web/src/lineage-viewport-model.mjs');
  const nodes = Array.from({ length: 1000 }, (_, index) => ({ key: 'asset:' + index, x: index < 60 ? index % 10 * 80 : 1800 + index % 50 * 180, y: index < 60 ? Math.floor(index / 10) * 100 : Math.floor(index / 50) * 240, width: 160, height: 200 }));
  const viewportBounds = lineageViewportBounds({ x: 0, y: 0, k: 1 }, { width: 900, height: 560 }, 0);
  const result = virtualizeLineageNodes(nodes, { viewportBounds, selectedKeys: new Set(['asset:999']), searchMatchKeys: new Set(['asset:998']), limit: 24 });
  assert.equal(result.limited, true);
  assert.equal(result.nodes.length, 24);
  assert.equal(result.pinned, 2);
  assert.equal(result.nodes.some((node) => node.key === 'asset:999'), true);
  assert.equal(result.nodes.some((node) => node.key === 'asset:998'), true);
  assert.equal(result.culled, 976);
  assert.equal(result.nodes.every((node) => node.key === 'asset:999' || node.key === 'asset:998' || node.x < 900), true);
});

test('lineage viewport model leaves small graphs untouched', async () => {
  const { virtualizeLineageNodes } = await import('../../web/src/lineage-viewport-model.mjs');
  const nodes = [{ key: 'project:p', x: 0, y: 0, width: 100, height: 100 }];
  const result = virtualizeLineageNodes(nodes, { limit: 1 });
  assert.equal(result.limited, false);
  assert.strictEqual(result.nodes, nodes);
  assert.equal(result.culled, 0);
});

test('caps pinned selections so select-all cannot bypass the DOM budget', async () => {
  const { virtualizeLineageNodes } = await import('../../web/src/lineage-viewport-model.mjs');
  const nodes = Array.from({ length: 20 }, (_, index) => ({ key: 'asset:' + index, x: index * 2000, y: 0, width: 160, height: 200 }));
  const selectedKeys = new Set(nodes.map((node) => node.key));
  const result = virtualizeLineageNodes(nodes, { selectedKeys, limit: 5 });
  assert.equal(result.nodes.length, 5);
  assert.equal(result.pinned, 5);
  assert.equal(result.culled, 15);
  assert.equal(result.limited, true);
});
