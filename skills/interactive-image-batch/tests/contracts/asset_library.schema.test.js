const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAssetLibrary } = require('../../scripts/build_asset_library');
const path = require('path');
const { makeTempDir, writeJson } = require('../helpers/workspace_v2_test_utils');

test('asset_library contract exposes user asset directories and groups', () => {
  const outputDir = makeTempDir();
  writeJson(path.join(outputDir, 'internal', 'run_plan.json'), {
    materials: { inputs: [{ id: 'input_001', title: '任务说明', note: '说明' }] },
  });
  const library = buildAssetLibrary({ outputDir });
  assert.equal(library.schemaVersion, 2);
  ['inputs', 'references', 'masks', 'results', 'review', 'issues', 'selected', 'exports', 'archive'].forEach((key) => {
    assert.equal(typeof library.directories[key], 'string');
  });
  assert.equal(library.directories.results, 'assets/results');
  assert.equal(library.directories.selected, 'assets/selected');
  assert.equal(Array.isArray(library.groups), true);
  const asset = library.assets.find((item) => item.id === 'input_001');
  ['id', 'kind', 'userTitle', 'userStatus', 'userPurpose', 'userAction', 'lifecycleStatus', 'sourceReason', 'path', 'group', 'usage', 'relationships', 'source'].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(asset, key), true, key);
  });
  assert.equal(typeof asset.usage.canExport, 'boolean');
  assert.equal(asset.source.stage, 'prepare');
});
