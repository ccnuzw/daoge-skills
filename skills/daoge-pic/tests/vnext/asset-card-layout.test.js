const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('asset cards keep preview controls separate from expanded actions and selection removal fits its rail', () => {
  const source = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  const styles = fs.readFileSync(path.join(skillRoot, 'web/src/styles.css'), 'utf8');
  const assetCard = source.slice(source.indexOf('function AssetCard('), source.indexOf('class WorkbenchErrorBoundary'));
  const previewEnd = assetCard.search(/\n    <\/div>\n    \{menuOpen && <div className="asset-action-menu"/);
  assert.ok(previewEnd > 0);
  assert.match(assetCard.slice(0, previewEnd), /className="asset-select-control"/);
  assert.match(assetCard.slice(0, previewEnd), /className="asset-card-tools"/);
  assert.doesNotMatch(assetCard.slice(0, previewEnd), /asset-action-menu/);
  assert.match(styles, /\.asset-select-control \{ top:8px; bottom:auto;/);
  assert.match(styles, /\.asset-action-menu \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.selection-strip-items article > button\.selection-remove \{ position:absolute; top:7px; right:7px;.*width:24px; height:24px;/);
});
