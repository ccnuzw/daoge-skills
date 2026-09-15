const test = require('node:test');
const assert = require('node:assert/strict');
const { readFrontendSource, readSource } = require('./source-text');


test('creator delivery keeps the normal path focused and exposes direct picture access', () => {
  const delivery = readFrontendSource();
  const main = readFrontendSource();
  assert.match(delivery, /挑选图片/);
  assert.match(delivery, /按草稿、准备、导出三个阶段完成交付/);
  assert.match(delivery, /创建唯一草稿/);
  assert.match(delivery, /下载、复制或打包/);
  assert.match(delivery, /<details className="creator-delivery-batches">/);
  assert.match(delivery, /deliveryFileUrl\(delivery\.id, item\.sequence, true\)/);
  assert.match(main, /const completeDelivery = async/);
  assert.match(main, /delivery-complete/);
  assert.match(main, /completion=\{deliveryCompletion\}/);
  assert.match(main, /batchBusy=\{batchBusy\}/);
  assert.match(main, /label="下载原图"/);
  assert.match(main, /复制图片/);
  assert.match(main, /assetOriginalUrl\(asset, true\)/);
  assert.match(main, /const markAsDeliverable = async/);
  assert.match(main, /onToggleSelect=\{markAsDeliverable\}/);
  assert.match(delivery, /打包下载/);
  assert.match(delivery, /creator-asset-archive-select/);
  assert.match(main, /projectArchiveUrl/);
  assert.match(main, /deliveryArchiveUrl/);
  assert.doesNotMatch(readSource('web/src/main.jsx'), /__legacy_deliveries__|DeliveryComposer/);
});
