// 「出完了叫我」的纯逻辑（方案 9.5）。
//
// 两条设计判断：
//   ① 只在用户**不在看**的时候标未读 —— 他正盯着页面时再提示一次是噪音；
//   ② 通知**只在已授权时**发，**绝不主动索要权限** —— 浏览器弹权限框是最惹人烦的交互之一，
//      要开通知应当由用户自己在浏览器设置或显式入口里决定。
// 无副作用、无 DOM —— 便于真跑单测（守卫见 tests/vnext/completion-notice.test.js）。

/** 哪些事件算「出图有进展」。 */
const COMPLETION_EVENT_PATTERN = /^(run\.|asset\.|round\.)/;

export function hasCompletionSignal(events = []) {
  const list = Array.isArray(events) ? events : [];
  return list.some((event) => COMPLETION_EVENT_PATTERN.test(String(event?.eventType || '')));
}

/** 该不该标未读：用户不在看 + 有进展，两个条件缺一不可。
 * @param {{ hidden?: boolean, hasSignal?: boolean }} [input] */
export function shouldMarkUnread({ hidden, hasSignal } = {}) {
  return Boolean(hidden) && Boolean(hasSignal);
}

/** 标题栏：有未读时加计数前缀，回到页面前一直挂着。 */
export function noticeTitle(baseTitle, unreadCount) {
  const count = Number.isInteger(unreadCount) && unreadCount > 0 ? unreadCount : 0;
  return count ? '(' + count + ') ' + String(baseTitle || '') : String(baseTitle || '');
}

/** 通知只在已授权时发——`default`（还没问过）与 `denied` 都按「不发」处理，且不主动去要。 */
export function shouldSendNotification(permission) {
  return permission === 'granted';
}

/** 通知正文：人话，不暴露任何工程词。 */
export function completionNotificationCopy(unreadCount) {
  const count = Number.isInteger(unreadCount) && unreadCount > 0 ? unreadCount : 0;
  if (count > 1) return '有 ' + count + ' 处出新图了';
  return '有新图了';
}
