const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('creator delivery is the unique registered delivery renderer', () => {
  const source = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(source, /const viewRenderers = \{/);
  assert.match(source, /deliveries: \(\) => <CreatorDelivery/);
  assert.match(source, /const renderActiveView = viewRenderers\[routeView\]/);
  assert.doesNotMatch(source, /__legacy_deliveries__|DeliveryComposer/);
});
