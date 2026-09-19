const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 「就这么出」的守卫（方案 4.1 · 规格书 §2.3 · 施工单 Q1 / 决策 D1）。
 *
 * 「就这么出」是**更好的入口**，不是确认的快捷方式：确认必须仍由人走既有闸门
 * （cookie-only，且绑定 `planHash + expectedVersion + sessionId + conversationId`）。
 *
 * 所以这个模型只回答一件事：**此刻能不能开闸门、怎么开**。
 * 没有挑战、批次不在待确认、或调用方不是人——一律**不许进**，并给一句人话。
 */

async function model() {
  try {
    return await import('../../web/src/confirmation-entry-model.mjs');
  } catch (error) {
    assert.fail('确认入口模型尚未实现：web/src/confirmation-entry-model.mjs（' + error.code + '）');
  }
}

function entry(model) {
  if (typeof model.confirmationEntry !== 'function') assert.fail('确认入口尚未实现：confirmation-entry-model 的 confirmationEntry');
  return model.confirmationEntry;
}

test('有挑战且批次待确认时，只能走闸门（没有第二条路）', async () => {
  const confirmationEntry = entry(await model());
  const open = confirmationEntry({ hasChallenge: true, roundStatus: 'awaiting_confirmation' });
  assert.equal(open.open, true);
  assert.equal(open.via, 'gate', '唯一路径就是闸门');
});

test('没有挑战就明确说「还不能确认」，不许假装能确认', async () => {
  const confirmationEntry = entry(await model());
  const noChallenge = confirmationEntry({ hasChallenge: false, roundStatus: 'awaiting_confirmation' });
  assert.equal(noChallenge.open, false);
  assert.equal(typeof noChallenge.reason, 'string');
  assert.match(noChallenge.reason, /会话|挑战/, '要告诉人去哪把挑战要回来');
});

test('批次不在待确认时不给入口（已确认/草稿都不是此刻的事）', async () => {
  const confirmationEntry = entry(await model());
  for (const status of ['draft', 'active', 'completed']) {
    const result = confirmationEntry({ hasChallenge: true, roundStatus: status });
    assert.equal(result.open, false, status + ' 不该给确认入口');
    assert.equal(typeof result.reason, 'string');
  }
});