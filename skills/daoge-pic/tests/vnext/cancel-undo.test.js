const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * 「取消运行」5 秒撤销窗口的守卫（方案开放项 #21）。
 *
 * 关键不变式：**取消立刻生效、撤销只是窗口内的第二条路**。所以模型只算窗口，
 * 不延迟取消；窗口一过就彻底关掉（不给「还能撤销」的假象）。
 */

async function model() {
  return import('../../web/src/cancel-undo-model.mjs');
}

test('撤销窗口默认 5 秒，剩余秒数随时间收敛到 0', async () => {
  const { beginCancelUndo, cancelUndoRemainingSeconds, cancelUndoAvailable, CANCEL_UNDO_WINDOW_MS } = await model();
  assert.equal(CANCEL_UNDO_WINDOW_MS, 5000);
  const undo = beginCancelUndo({ runId: 'run_1', now: 1000 });
  assert.equal(undo.runId, 'run_1');
  assert.equal(undo.expiresAt, 6000);
  assert.equal(cancelUndoRemainingSeconds(undo, 1000), 5);
  assert.equal(cancelUndoRemainingSeconds(undo, 3500), 3, '向上取整到整秒');
  assert.equal(cancelUndoAvailable(undo, 5999), true);
  assert.equal(cancelUndoAvailable(undo, 6000), false, '到点即关，不给假象');
  assert.equal(cancelUndoRemainingSeconds(undo, 6001), 0);
});

test('没有窗口时不假装可以撤销', async () => {
  const { cancelUndoAvailable, cancelUndoRemainingSeconds, cancelUndoLabel } = await model();
  assert.equal(cancelUndoAvailable(null, 0), false);
  assert.equal(cancelUndoRemainingSeconds(null, 0), 0);
  assert.equal(cancelUndoLabel(null, 0), '');
});

test('窗口文案带上剩余秒数', async () => {
  const { beginCancelUndo, cancelUndoLabel } = await model();
  const undo = beginCancelUndo({ runId: 'run_2', now: 0, windowMs: 5000 });
  assert.match(cancelUndoLabel(undo, 0), /5 秒内可撤销/);
  assert.match(cancelUndoLabel(undo, 4500), /1 秒内可撤销/);
});