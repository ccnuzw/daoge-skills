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

export const SYSTEM_SIGNALS = Object.freeze([
  'rate limit', '429', 'timeout', 'timed out', 'network', 'connection',
  '502', '503', '504', 'server error', 'unavailable', 'overloaded', 'fetch failed',
  // 磁盘写不进去也是**系统的问题**（开放项 #26）：不写进来它就会掉进「原因没写明」，
  // 用户会白改一通描述。
  'enospc', 'no space left', 'disk full', 'not enough space'
]);
/** 磁盘满的专属签名（P4 要把它与「服务连不上」分开说：一个要清空间，一个只要等）。 */
export const DISK_SIGNALS = Object.freeze(['enospc', 'no space left', 'disk full', 'not enough space']);
export const MY_SIGNALS = Object.freeze([
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

/**
 * 生成服务整层故障的首屏级文案（方案 4.10 · 开放项 #26 / #28 · 施工单 P4）。
 *
 * 与单张归因同一条判据：**分清「我的问题」和「系统的问题」**，并且永远给下一步。
 *   - `all_providers_down`：系统的问题 → 让他等，并**明确说「别反复点重试」**
 *     （分不清的话，他会对着一个自己解决不了的问题反复点）；
 *   - `disk_full`：系统的问题，但要他动一下（清理空间）→ 说清动什么；
 *   - `not_configured`：不是故障，是还没配 → 指向「生成服务」。
 *
 * @param {{ kind?: string }} [input]
 */
export function providerOutageCopy(input = {}) {
  const kind = String(input.kind || '');
  if (kind === 'all_providers_down') return '生成服务现在都连不上。这是系统的问题，不是你的操作——等一会儿再试，别反复点重试。';
  if (kind === 'disk_full') return '磁盘空间满了，出图文件写不进去。先清理一点空间，再回来继续；这一批不用重试。';
  if (kind === 'not_configured') return '还没有可用的生成服务。先去「生成服务」里配好一个，再回来说一句。';
  return '生成服务暂时用不了。先别反复重试，等一会儿或去「生成服务」里看看。';
}

/**
 * 整层故障的**判定**（施工单 P4）：只看事实，不猜。
 *
 * 输入是服务端给的最近几次终态运行（`/api/providers.recentOutcomes`，只带结局与错误摘要）。
 * 判据：
 *   - 最近 N 次里**只要有一次成功或一次取消**，就不算「全挂」——成功说明服务活着，
 *     取消是用户自己的决定；
 *   - 全是失败且摘要都指向磁盘 → `disk_full`（要清空间）；
 *   - 全是失败且归因都是「系统的问题」 → `all_providers_down`（只要等）。
 * 分类复用 `failureAttribution`，所以关键词只有一份（本文件），不另立一套。
 */
export function providerOutageKind(input = {}) {
  const outcomes = Array.isArray(input.recentOutcomes) ? input.recentOutcomes.filter(Boolean) : [];
  const size = Math.max(2, Number.isFinite(input.minRuns) ? Number(input.minRuns) : 2);
  const window = outcomes.slice(0, size);
  if (window.length < size) return null;
  const failing = window.filter((outcome) => ['failed', 'partial'].includes(String(outcome?.status || '')));
  if (failing.length !== window.length) return null;
  const summaries = window.map((outcome) => String(outcome?.errorSummary || '').toLowerCase());
  if (summaries.every((summary) => DISK_SIGNALS.some((signal) => summary.includes(signal)))) return 'disk_full';
  const allSystem = window.every((outcome) => failureAttribution({ status: 'failed', error: { summary: String(outcome?.errorSummary || '') } }).owner === 'system');
  return allSystem ? 'all_providers_down' : null;
}
