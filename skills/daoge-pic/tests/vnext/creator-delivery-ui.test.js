const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('creator delivery keeps the normal path focused and exposes direct picture access', () => {
  const delivery = fs.readFileSync(path.join(skillRoot, 'web/src/creator-delivery.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
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
  assert.doesNotMatch(main, /__legacy_deliveries__|DeliveryComposer/);
});
