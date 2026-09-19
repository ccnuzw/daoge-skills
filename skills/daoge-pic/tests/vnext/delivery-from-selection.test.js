const test = require('node:test');
const assert = require('node:assert/strict');

const { projectDeliverySelection, deliverySelectionMessage } = require('../../web/src/delivery-workflow.mjs');

/**
 * 「拿出去」挂选中的守卫（方案 7.11.2 / 4.3 · 施工单 G4 / H1）。
 *
 * 交付是一个**动作**（挑完就地接那一下），不是「另开一个地方走流程」。所以发起
 * 必须**在选中已保留成果时才可用**，且不可用时给一句人话——绝不给一个点了没用的按钮。
 *
 * 这里锁的是「动作可否发起」的判定，复用既有的选片准入（`projectDeliverySelection`）。
 */

async function model() {
  const mod = await import('../../web/src/delivery-workflow.mjs');
  if (typeof mod.deliveryIntentFromSelection !== 'function') {
    assert.fail('交付动作模型尚未实现：delivery-workflow.mjs 的 deliveryIntentFromSelection');
  }
  return mod;
}

const keep = { id: 'asset_keep', review: { decision: 'keep' } };
const unkept = { id: 'asset_new', review: {} };

test('没有项目 / 没有选片时不可发起，且给的是人话', async () => {
  const { deliveryIntentFromSelection } = await model();
  const noProject = deliveryIntentFromSelection({ projectId: null, selection: projectDeliverySelection(null, [keep]) });
  assert.equal(noProject.canStart, false);
  assert.equal(noProject.copy, deliverySelectionMessage(projectDeliverySelection(null, [keep])));
  const noSelection = deliveryIntentFromSelection({ projectId: 'project_1', selection: projectDeliverySelection('project_1', []) });
  assert.equal(noSelection.canStart, false);
});

test('选片里含未保留成果时不可发起（先评审）', async () => {
  const { deliveryIntentFromSelection } = await model();
  const intent = deliveryIntentFromSelection({ projectId: 'project_1', selection: projectDeliverySelection('project_1', [keep, unkept]) });
  assert.equal(intent.canStart, false);
});

test('全是已保留成果时可发起，文案说清几张', async () => {
  const { deliveryIntentFromSelection } = await model();
  const intent = deliveryIntentFromSelection({ projectId: 'project_1', selection: projectDeliverySelection('project_1', [keep, { ...keep, id: 'asset_keep_2' }]) });
  assert.equal(intent.canStart, true);
  assert.match(intent.copy, /2/, '文案要带张数');
});