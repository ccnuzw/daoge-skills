const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource } = require('./source-text');


test('creator delivery is the unique registered delivery renderer', () => {
  const source = readFrontendSource();
  assert.match(source, /const viewRenderers = \{/);
  assert.match(source, /deliveries: \(\) => <CreatorDelivery/);
  assert.match(source, /const renderActiveView = viewRenderers\[routeView\]/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /__legacy_deliveries__|DeliveryComposer/);
});
