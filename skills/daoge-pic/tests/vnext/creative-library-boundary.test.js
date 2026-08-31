const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('creative library keeps project images separate and points to explicit shared assets', () => {
  const component = fs.readFileSync(path.join(skillRoot, 'web/src/creative-library.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const shared = fs.readFileSync(path.join(skillRoot, 'web/src/shared-assets.jsx'), 'utf8');
  assert.match(component, /taskTypes, styleKits, brandKits, sharedAssets/);
  assert.match(component, /assets: \[\]/);
  assert.match(component, /onOpenProjects/);
  assert.match(component, /onOpenSharedAssets/);
  assert.doesNotMatch(component, /onImport/);
  assert.doesNotMatch(component, /<form/);
  assert.doesNotMatch(component, /onCreate/);
  assert.match(shared, /共享到跨项目素材/);
  assert.doesNotMatch(main, /createLibraryResource/);
  assert.match(main, /const canImport = view === 'assets'/);
  assert.match(main, /<SharedAssets/);
});
