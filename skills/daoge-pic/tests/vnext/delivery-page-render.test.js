const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource } = require('./source-text');


test('creator delivery is the unique registered delivery renderer', () => {
  const source = readFrontendSource();
  assert.match(source, /const viewRenderers = \{/);
  // A3 起了 PageFrame 包裹（宽度统一），断言随之放宽到「仍然唯一绑到 CreatorDelivery」，意图不变。
  assert.match(source, /deliveries: \(\) => page\('deliveries', <CreatorDelivery/);
  assert.match(source, /const renderActiveView = viewRenderers\[routeView\]/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /__legacy_deliveries__|DeliveryComposer/);
});
