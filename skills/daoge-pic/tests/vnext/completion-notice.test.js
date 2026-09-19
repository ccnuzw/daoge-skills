const test = require('node:test');
const assert = require('node:assert/strict');

const { readSource } = require('./source-text');

/**
 * 「出完了叫我」的守卫（方案 9.5）。
 *
 * 这一项的价值全在两处克制上：
 *   - 只在用户**不在看**的时候标未读（盯着页面还提示是噪音）；
 *   - 通知**只在已授权时**发，**绝不主动索要权限**。
 * 守卫把这两条钉死——它们最容易被后来者"顺手改成更方便的样子"。
 */

test('标未读需要两个条件同时成立：用户不在看 + 出图有进展', async () => {
  const { shouldMarkUnread, hasCompletionSignal } = await import('../../web/src/completion-notice-model.mjs');
  assert.equal(shouldMarkUnread({ hidden: true, hasSignal: true }), true);
  assert.equal(shouldMarkUnread({ hidden: false, hasSignal: true }), false, '用户正在看时不标未读');
  assert.equal(shouldMarkUnread({ hidden: true, hasSignal: false }), false, '没有进展时不标未读');
  assert.equal(shouldMarkUnread({}), false);
  assert.equal(shouldMarkUnread(), false);

  // 「有进展」只看事件类型，不看内容（内容会变，类型稳定）。
  assert.equal(hasCompletionSignal([{ eventType: 'run.items_updated' }]), true);
  assert.equal(hasCompletionSignal([{ eventType: 'asset.created' }]), true);
  assert.equal(hasCompletionSignal([{ eventType: 'session.context_updated' }]), false);
  assert.equal(hasCompletionSignal([]), false);
  assert.equal(hasCompletionSignal(null), false);
});

test('标题栏计数：没有未读时不加前缀，有未读时加', async () => {
  const { noticeTitle } = await import('../../web/src/completion-notice-model.mjs');
  assert.equal(noticeTitle('DAOGE Pic', 0), 'DAOGE Pic');
  assert.equal(noticeTitle('DAOGE Pic', 1), '(1) DAOGE Pic');
  assert.equal(noticeTitle('DAOGE Pic', 3), '(3) DAOGE Pic');
  assert.equal(noticeTitle('DAOGE Pic', -1), 'DAOGE Pic', '非法计数按没有未读处理');
  assert.equal(noticeTitle('DAOGE Pic', undefined), 'DAOGE Pic');
});

test('通知只在已授权时发，且前端源码里不许主动索要权限', async () => {
  const { shouldSendNotification, completionNotificationCopy } = await import('../../web/src/completion-notice-model.mjs');
  assert.equal(shouldSendNotification('granted'), true);
  assert.equal(shouldSendNotification('default'), false, '还没问过 → 不发，也不要去问');
  assert.equal(shouldSendNotification('denied'), false, '明确拒绝过 → 永不打扰');
  assert.equal(shouldSendNotification(undefined), false);

  // 文案是人话，不带任何工程词。
  assert.match(completionNotificationCopy(1), /新图/);
  assert.match(completionNotificationCopy(3), /3/);
  assert.doesNotMatch(completionNotificationCopy(3), /run|批次|asset|status/i);

  // 硬断言：全前端不许出现 requestPermission —— 权限只能由用户自己决定。
  // 批 E（E1.6b）迁移：外壳 JSX 搬去 app/workbench-shell.jsx——源断言读「main + 壳」两处。
  const main = readSource('web/src/main.jsx') + '\n' + readSource('web/src/app/workbench-shell.jsx');
  assert.doesNotMatch(main, /Notification\.requestPermission/, '不许主动索要通知权限（方案 9.5：未授权则静默降级）');
});

test('接线到位：未读计数挂到事件流上，标题真的会变，回到页面会清零', () => {
  const main = readSource('web/src/main.jsx');
  // 纯逻辑放在模型里，但模型不接线等于没有——这一组断言的就是「接线」。
  assert.match(main, /completion-notice-model\.mjs/, 'main.jsx 必须用这个模型');
  assert.match(main, /noticeTitle\(/, '必须真的去改标题（否则用户切回来之前什么都不知道）');
  assert.match(main, /document\.title\s*=/, '必须有对 document.title 的赋值');
  assert.match(main, /visibilitychange/, '回到页面时要清未读（否则计数只增不减）');
});
