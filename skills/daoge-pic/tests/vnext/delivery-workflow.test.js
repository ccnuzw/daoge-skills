const test = require('node:test');
const assert = require('node:assert/strict');

test('delivery selection distinguishes project, selection, review, and ready states', async () => {
  const { deliverySelectionMessage, projectDeliverySelection } = await import('../../web/src/delivery-workflow.mjs');
  assert.equal(projectDeliverySelection(null, []).state, 'needs_project');
  assert.equal(projectDeliverySelection('project_a', []).state, 'needs_selection');
  const needsReview = projectDeliverySelection('project_a', [{ id: 'asset_a', deletedAt: null, review: { decision: 'review' } }]);
  assert.equal(needsReview.state, 'needs_review');
  assert.match(deliverySelectionMessage(needsReview), /未保留/);
  const ready = projectDeliverySelection('project_a', [{ id: 'asset_keep', deletedAt: null, review: { decision: 'keep' } }]);
  assert.equal(ready.state, 'ready');
  assert.deepEqual(ready.eligibleAssets.map((asset) => asset.id), ['asset_keep']);
});
