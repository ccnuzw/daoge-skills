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

/** `outcome_unknown` 专用：不是「你要改」，也不是「等等就好」，是要人去核实。 */
const VERIFY_OWNER_LABEL = '先确认这张出没出';

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
 * 哪些状态算「这一张有结果，但结果是坏消息」。
 *
 * 只有这些状态才值得说「怪谁 / 下一步怎么办」——在成功的那张图旁边写「等一等就能过」是噪音。
 * 这份清单是**唯一来源**：界面按它决定要不要渲染归因，守卫也按它断言，
 * 免得「哪几种算失败」在两个地方各写一遍、然后慢慢漂移。
 */
export const FAILURE_STATUSES = Object.freeze(['failed', 'blocked', 'retry_wait', 'outcome_unknown']);

/** 这张是不是「有结果的坏消息」。 */
export function isFailureStatus(status) {
  return FAILURE_STATUSES.includes(String(status || ''));
}

/**
 * 单张的归因。
 *
 * 覆盖四种「有结果的坏消息」。**每种都要显式作答**，不能让它们掉进兜底分支——
 * `retry_wait` 掉进去就会说成「原因没写明」，而它其实清清楚楚是系统在重试。
 *
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
  if (status === 'retry_wait') {
    // 系统正在自动重试：用户什么都不用做，**别催他去改描述**。
    return { owner: 'system', label: FAILURE_OWNER_LABELS.system, advice: '系统正在自动重试，不用改描述，等它自己来。' };
  }
  if (status === 'outcome_unknown') {
    // 请求发出去了、结果没收到：既不是「你要改」，也不是「等等就好」，
    // 而是**要人去核实一次**（方案 4.10 的两段式：先系统对账，对不出来才请人看）。
    // 所以文案是「先确认出没出」，而不是「结果未知」四个字。
    return { owner: 'unknown', label: VERIFY_OWNER_LABEL, advice: '这张请求发出去了但没收到结果：去服务商后台看一眼有没有出，回来告诉我们。' };
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
 * 界面用的那一个：**不在失败状态就返回 null**，调用方据此决定不渲染。
 *
 * 这样界面里不需要再写一遍「哪几种状态算失败」，也不可能出现
 * 「模型说这是失败、界面却没显示」或反过来的不一致。
 * @param {any} [item]
 */
export function failureAttributionLine(item = {}) {
  return isFailureStatus(item?.status) ? failureAttribution(item) : null;
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
