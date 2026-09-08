const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skillRoot = path.resolve(__dirname, '../..');

test('creative library resources separate reusable methods from project image inventory', async () => {
  const { creativeLibraryResources, filterCreativeLibraryResources } = await import('../../web/src/creative-library-model.mjs');
  const resources = creativeLibraryResources({
    taskTypes: [{ id: 'tasktype_packshot', name: '电商主图', source: 'user', definition: { summary: '主图构图规则', fields: ['主体', '卖点'] } }],
    styleKits: [{ id: 'style_film', name: '暖色胶片', definition: { summary: '低饱和暖色' }, assetIds: ['shared_asset_1'] }],
    brandKits: [{ id: 'brand_acme', name: 'ACME 品牌', definition: { palette: ['green'] }, assetIds: [] }],
    assets: []
  });

  assert.deepEqual(resources.map((resource) => resource.kind), ['task', 'style', 'brand']);
  assert.deepEqual(resources.find((resource) => resource.id === 'style:style_film').assetIds, ['shared_asset_1']);
  assert.equal(resources.some((resource) => resource.kind === 'asset'), false);
  assert.deepEqual(filterCreativeLibraryResources(resources, { kind: 'task', query: '卖点' }).map((resource) => resource.id), ['task:tasktype_packshot']);
  const component = fs.readFileSync(path.join(skillRoot, 'web/src/creative-library.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const shared = fs.readFileSync(path.join(skillRoot, 'web/src/shared-assets.jsx'), 'utf8');
  assert.match(component, /creativeLibraryResources\(\{ taskTypes, styleKits, brandKits, assets: \[\] \}\)/);
  assert.match(component, /onOpenSharedAssets/);
  assert.match(main, /library: \(\) => <CreativeLibrary taskTypes=\{taskTypes\} styleKits=\{styleKits\} brandKits=\{brandKits\} sharedAssets=\{sharedAssets\}/);
  assert.match(main, /'shared-assets': \(\) => <SharedAssets assets=\{sharedAssets\}/);
  assert.match(shared, /共享素材/);
});
