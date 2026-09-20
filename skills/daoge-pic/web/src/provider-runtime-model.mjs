/**
 * provider 运行时状态的展示（方案 7.11.4 · 施工单 P3 · 决策 D2）。纯函数，可单测。
 *
 * 限流 / 内存退避这些**运行时事实**本来埋在二级设置页里。判据很简单：
 * 「服务正在慢下来」这件事，用户**不打开设置就该看得见**——至少别让他以为是自己点错了。
 *
 * D2 拍板：先放在**队列底栏的状态行**（与 agent 在场卡同处，零新入口）；
 * 将来若要独立系统面板再迁移。
 *
 * 限流 / 内存退避的两种写法，**同一判据**（`lastReason`）在同一处登记。
 *
 * 为什么要有短句：rail 状态卡的常显行只有 ~197px（≈14–15 个汉字），而下面那两条长句是 23–24 字，
 * 直接塞进常显行会被省略号截掉后半句——恰恰是「先看具体原因（限流/额度/磁盘）」那半句。
 * 短句常显、长句进明细，两处同一个 reason，不可能各说各话。
 */
const THROTTLE_COPY = {
  rate_limited: { headline: '生成服务在限流', notice: '生成服务在限流，先把出图放慢（不是你的操作问题）。' },
  memory_pressure: { headline: '内存吃紧', notice: '内存吃紧，先把出图放慢；等它缓过来会自动恢复。' },
  memory: { headline: '内存吃紧', notice: '内存吃紧，先把出图放慢；等它缓过来会自动恢复。' }
};

function throttleCopy(runtime) {
  const concurrency = runtime?.providerConcurrency;
  if (!concurrency || typeof concurrency !== 'object') return null;
  return THROTTLE_COPY[concurrency.lastReason] || null;
}

/** 明细里的整句（数据行、队列底栏用）。 */
export function providerRuntimeNotice(runtime) {
  return throttleCopy(runtime)?.notice || '';
}

/** 常显的短结论（rail 状态卡那一行用，≤14 字）。 */
export function providerRuntimeHeadline(runtime) {
  return throttleCopy(runtime)?.headline || '';
}

/** 状态行要不要显示（空串一律不显示，健康时不打扰）。 */
export function hasProviderRuntimeNotice(runtime) {
  return providerRuntimeNotice(runtime).length > 0;
}