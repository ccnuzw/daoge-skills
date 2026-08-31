const test = require('node:test');
const assert = require('node:assert/strict');

test('creative library unifies resource types, filters safely, and excludes deleted assets', async () => {
  const { creativeLibraryResources, filterCreativeLibraryResources, assetLabel } = await import('../../web/src/creative-library-model.mjs');
  const resources = creativeLibraryResources({
    taskTypes: [{ id: 'portrait', name: '人物主视觉', source: 'official', definition: { summary: '人物海报', fields: ['subject'] } }],
    styleKits: [{ id: 'style-a', name: '雨夜胶片', definition: { summary: '红青夜景' }, assetIds: ['asset-a'] }],
    brandKits: [{ id: 'brand-a', name: '春季品牌', definition: { summary: '克制排版' }, assetIds: [] }],
    assets: [{ id: 'asset-a', kind: 'import', display: { label: '街头参考' } }, { id: 'asset-deleted', kind: 'import', deletedAt: '2026-01-01T00:00:00.000Z' }]
  });
  assert.deepEqual(resources.map((item) => item.kind), ['task', 'style', 'brand', 'asset']);
  assert.deepEqual(filterCreativeLibraryResources(resources, { kind: 'style' }).map((item) => item.title), ['雨夜胶片']);
  assert.deepEqual(filterCreativeLibraryResources(resources, { query: '参考' }).map((item) => item.title), ['街头参考']);
  assert.equal(assetLabel({ kind: 'generated' }), '生成结果');
});
