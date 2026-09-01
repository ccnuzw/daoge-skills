const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const skillRoot = path.resolve(__dirname, '../..');

test('CreatorDelivery phase presentation exposes one action and freezes after operation creation', async () => {
  const { deliveryCompletionPresentation } = await import('../../web/src/creator-delivery-model.mjs');
  assert.deepEqual(deliveryCompletionPresentation(null), { phase: 'draft', action: '创建草稿', step: 1, frozen: false, complete: false });
  assert.deepEqual(deliveryCompletionPresentation({ phase: 'prepare' }, true), { phase: 'prepare', action: '正在准备交付', step: 2, frozen: true, complete: false });
  assert.deepEqual(deliveryCompletionPresentation({ phase: 'export' }), { phase: 'export', action: '导出文件', step: 3, frozen: true, complete: false });
  assert.deepEqual(deliveryCompletionPresentation({ phase: 'complete' }), { phase: 'complete', action: '完成', step: 4, frozen: true, complete: true });
});

test('CreatorDelivery double-click guard admits one operation until it settles', async () => {
  const { createDeliveryInteractionGuard } = await import('../../web/src/creator-delivery-model.mjs');
  const guard = createDeliveryInteractionGuard();
  assert.equal(guard.begin(), true);
  assert.equal(guard.begin(), false);
  assert.equal(guard.isBusy(), true);
  guard.end();
  assert.equal(guard.begin(), true);
  guard.reset();
  assert.equal(guard.isBusy(), false);
});

test('cross-project delivery responses are rejected by project and epoch', async () => {
  const { isDeliveryOperationCurrent } = await import('../../web/src/creator-delivery-model.mjs');
  assert.equal(isDeliveryOperationCurrent({ activeProjectId: 'p1', projectId: 'p1', currentEpoch: 4, operationEpoch: 4 }), true);
  assert.equal(isDeliveryOperationCurrent({ activeProjectId: 'p2', projectId: 'p1', currentEpoch: 4, operationEpoch: 4 }), false);
  assert.equal(isDeliveryOperationCurrent({ activeProjectId: 'p1', projectId: 'p1', currentEpoch: 5, operationEpoch: 4 }), false);
});

test('batch busy holds an immutable user snapshot even if live controls change', async () => {
  const { createBatchOperationSnapshot, batchOperationSignature } = await import('../../web/src/creator-delivery-model.mjs');
  const selected = new Set(['delivery-b', 'delivery-a']);
  const snapshot = createBatchOperationSnapshot({ action: 'create', deliveryIds: selected, name: ' 用户发布 ' });
  selected.clear();
  assert.deepEqual(snapshot, { action: 'create', batchId: null, versionId: null, deliveryIds: ['delivery-a', 'delivery-b'], name: '用户发布' });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.deliveryIds), true);
  assert.equal(batchOperationSignature(snapshot), '{"action":"create","batchId":null,"versionId":null,"deliveryIds":["delivery-a","delivery-b"],"name":"用户发布"}');
});

test('batch snapshots exclude delivery ids that are not eligible in the active project', async () => {
  const { createBatchOperationSnapshot } = await import('../../web/src/creator-delivery-model.mjs');
  const snapshot = createBatchOperationSnapshot({ action: 'create', deliveryIds: new Set(['current-ready', 'other-project', 'current-draft']), eligibleDeliveryIds: new Set(['current-ready']), name: '当前项目' });
  assert.deepEqual(snapshot.deliveryIds, ['current-ready']);
});

test('CreatorDelivery source wires completion, frozen, batchBusy and disables real controls', () => {
  const source = fs.readFileSync(path.join(skillRoot, 'web/src/creator-delivery.jsx'), 'utf8');
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(main, /completion=\{deliveryCompletion\}/);
  assert.match(main, /batchBusy=\{batchBusy\}/);
  assert.match(main, /frozen=\{Boolean\(deliveryCompletion \|\| deliveryCreating\)\}/);
  assert.match(source, /const locked = frozen \|\| deliveryCreating/);
  assert.match(source, /disabled=\{locked\}/);
  assert.doesNotMatch(main, /__legacy_deliveries__|DeliveryComposer/);
});

test('changing the active project clears batch controls before a new submission', () => {
  const main = fs.readFileSync(path.join(skillRoot, 'web/src/main.jsx'), 'utf8');
  assert.match(main, /useEffect\(\(\) => \{\s*batchOperationRef\.current = null;\s*setBatchName\(''\);\s*setSelectedDeliveryIds\(new Set\(\)\);\s*\}, \[activeProjectId\]\)/);
  assert.match(main, /eligibleDeliveryIds, name: batchName/);
});
