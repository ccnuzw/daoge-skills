/**
 * 失败「原因 → 建议」映射（方案 9.7 · 施工单 C2）。
 *
 * 4.10 定了失败**怎么说**（人话 + 下一步）；9.7 再往前一步：把它落成**机器可查**的一份表，
 * agent 接重试单时查表就行，不必每次重新判断。
 *
 * ⚠️ 关键词只有一份，且与前端 `failure-copy-model.mjs` 的判据**钉在一起**（守卫对拍）：
 * 两套关键词迟早互相打架，所以这里不新造词汇，只是把「原因 → 建议」这一层补上。
 * （跨模块系统无法真正共用，沿用项目既有的「两份 + 守卫」法，与 `purpose-labels` 同。）
 */

export type FailureOwner = 'me' | 'system' | 'unknown';

export interface FailureAdvice {
  owner: FailureOwner;
  advice: string;
}

/** 与前端 `failure-copy-model.mjs` 的 SYSTEM_SIGNALS 对拍（见守卫）。 */
export const SYSTEM_SIGNALS = [
  'rate limit', '429', 'timeout', 'timed out', 'network', 'connection',
  '502', '503', '504', 'server error', 'unavailable', 'overloaded', 'fetch failed',
  'enospc', 'no space left', 'disk full', 'not enough space'
] as const;

/** 与前端 `failure-copy-model.mjs` 的 MY_SIGNALS 对拍（见守卫）。 */
export const MY_SIGNALS = [
  'moderation', 'content policy', 'policy', 'sensitive', 'review',
  '审核', '拦截', '违规', '敏感',
  'invalid', '参数', '尺寸', '不支持'
] as const;

/** 磁盘满单独成类是**有用**的：它要清空间，而不是「等一等」。 */
export const DISK_SIGNALS = ['enospc', 'no space left', 'disk full', 'not enough space'] as const;
/** 额度问题也单独成类：它要充值，改描述没用。 */
const QUOTA_SIGNALS = ['quota', 'billing', 'insufficient', 'payment', '额度', '余额', '欠费'] as const;

function includesAny(summary: string, signals: readonly string[]): boolean {
  return signals.some((signal) => summary.includes(signal));
}

/**
 * 查表：给一条失败摘要，返回「这大概率是谁的问题 + 下一步做什么」。
 *
 * 顺序有意为之：**先看具体原因（额度 / 磁盘），再看大类（系统 / 我的）**——
 * 额度问题往往也报成 `blocked`，若先按大类走就会被说成「内容被挡」，
 * 把人引去改描述（白改一通）。
 */
export function failureAdvice(input: { status?: unknown; summary?: unknown } | null | undefined): FailureAdvice {
  const summary = String(input?.summary || '').toLowerCase();
  if (includesAny(summary, QUOTA_SIGNALS)) return { owner: 'me', advice: '额度不够：先去生成服务里充值或换一组配置，然后重试。' };
  if (includesAny(summary, DISK_SIGNALS)) return { owner: 'system', advice: '磁盘满了：先清理一点空间，再继续；这一批不用重试。' };
  if (includesAny(summary, MY_SIGNALS)) return { owner: 'me', advice: '像是请求本身要调整：改一改描述或参数再试。' };
  if (includesAny(summary, SYSTEM_SIGNALS)) return { owner: 'system', advice: '像是服务那边的问题：等一会儿再重试通常就好。' };
  return { owner: 'unknown', advice: '错误摘要里没写明原因，可以重试一次看看。' };
}