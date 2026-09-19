/**
 * 「就这么出」的入口判定（方案 4.1 · 规格书 §2.3 · 施工单 Q1 / 决策 D1）。纯函数，可单测。
 *
 * 「就这么出」是**更好的入口，不是确认的快捷方式**：
 * 确认必须仍由人走既有闸门（cookie-only，且绑定 planHash + expectedVersion + sessionId + conversationId）。
 * 所以这里只回答一件事——**此刻能不能开闸门、开不了时怎么跟人说**。
 *
 * 「有没有挑战」是关键：挑战由会话发起（`confirmation-gate.ts` 的过期与版本绑定都在那儿），
 * 界面拿不到挑战时**绝不能假装能确认**（否则又是一颗「点了没用」的空壳按钮）。
 */
export function confirmationEntry(input = {}) {
  const status = String(input.roundStatus || '');
  if (status !== 'awaiting_confirmation') {
    const reason = status === 'draft'
      ? '这一批还在草稿：先让会话把计划写出来，再确认。'
      : ['active', 'completed'].includes(status)
        ? '这一批已经确认过了，不需要再确认。'
        : '这一批现在的状态还不能确认。';
    return { open: false, via: 'none', reason };
  }
  if (input.hasChallenge !== true) {
    return {
      open: false,
      via: 'none',
      reason: '计划在等确认，但会话还没发起确认挑战；请在会话里让 agent 发起，再回来点确认。'
    };
  }
  // 唯一路径：闸门。没有第二条。
  return { open: true, via: 'gate', reason: '' };
}