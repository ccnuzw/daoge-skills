// 失败的文案与归因（方案 4.10）。
//
// 两条设计判断：
//  ① **失败是结果的一部分** —— 批次状态里就说「N 张没成 · K 张被挡」，检查器里说清「为什么」「怪谁」，
//     **不弹窗**（弹窗把一个结果变成了一次打断）；
//  ② **归因宁可说「原因没写明」，也不瞎猜** —— 错怪自己会白改一通描述，错怪系统会白等。
//
// 归因只看两类信号：状态本身（blocked 意味着有东西挡着）与错误摘要里的关键词。
// 这不是万无一失的分类器，所以「没写明」永远是合法答案。

/** 归因的标签：一句话说清「下一步怪谁」。 */
export const FAILURE_OWNER_LABELS = Object.freeze({
  me: '这批的请求要改',
  system: '等一等就能过',
  unknown: '原因没写明'
});

const SYSTEM_SIGNALS = Object.freeze([
  'rate limit', '429', 'timeout', 'timed out', 'network', 'connection',
  '502', '503', '504', 'server error', 'unavailable', 'overloaded', 'fetch failed'
]);
const MY_SIGNALS = Object.freeze([
  'moderation', 'content policy', 'policy', 'sensitive', 'review',
  '审核', '拦截', '违规', '敏感',
  'invalid', '参数', '尺寸', '不支持'
]);

/**
 * 单张的归因。
 * @param {any} [item]
 * @returns {{ owner: 'me'|'system'|'unknown', label: string, advice: string }}
 */
export function failureAttribution(item = {}) {
  const status = String(item?.status || '');
  const summary = String(item?.error?.summary || item?.error?.message || '').toLowerCase();
  if (status === 'blocked') {
    // 被挡：有东西挡着，等是等不过去的 —— 归「我的问题」。
    return { owner: 'me', label: FAILURE_OWNER_LABELS.me, advice: '内容被挡住了：多半是描述撞了线，改一改描述再试。' };
  }
  if (SYSTEM_SIGNALS.some((signal) => summary.includes(signal))) {
    return { owner: 'system', label: FAILURE_OWNER_LABELS.system, advice: '像是服务那边的问题，等一等再重试通常就好。' };
  }
  if (MY_SIGNALS.some((signal) => summary.includes(signal))) {
    return { owner: 'me', label: FAILURE_OWNER_LABELS.me, advice: '像是请求本身要调整：改一改描述或参数再试。' };
  }
  return { owner: 'unknown', label: FAILURE_OWNER_LABELS.unknown, advice: '错误摘要里没写明原因，可以重试一次看看。' };
}

/**
 * 批次状态的失败摘要：把「没成」与「被挡」分开说 —— 两者的下一步不同（4.10）。
 * @param {{ failed?: number, blocked?: number }} [counts]
 */
export function batchFailureSummary({ failed = 0, blocked = 0 } = {}) {
  const parts = [];
  if (Number(failed) > 0) parts.push(Number(failed) + ' 张没成');
  if (Number(blocked) > 0) parts.push(Number(blocked) + ' 张被挡');
  return parts.join(' · ');
}
