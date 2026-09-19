const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource } = require('./source-text');


test('creator delivery is the unique registered delivery renderer', () => {
  const source = readFrontendSource();
  assert.match(source, /const viewRenderers = \{/);
  // A3 起了 PageFrame 包裹（宽度统一），断言随之放宽到「仍然唯一绑到 CreatorDelivery」，意图不变。
  // 批 E（E1.6）迁移：入口变成 <DeliveriesView/>，组件用法在视图文件里。
  assert.match(readSource('web/src/views/deliveries.jsx'), /<CreatorDelivery/);
  assert.match(source, /const renderActiveView = viewRenderers\[routeView\]/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /__legacy_deliveries__|DeliveryComposer/);
});
