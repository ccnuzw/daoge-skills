/**
 * provider 运行时状态的展示（方案 7.11.4 · 施工单 P3 · 决策 D2）。纯函数，可单测。
 *
 * 限流 / 内存退避这些**运行时事实**本来埋在二级设置页里。判据很简单：
 * 「服务正在慢下来」这件事，用户**不打开设置就该看得见**——至少别让他以为是自己点错了。
 *
 * D2 拍板：先放在**队列底栏的状态行**（与 agent 在场卡同处，零新入口）；
 * 将来若要独立系统面板再迁移。
 */
export function providerRuntimeNotice(runtime) {
  const concurrency = runtime?.providerConcurrency;
  if (!concurrency || typeof concurrency !== 'object') return '';
  const reason = concurrency.lastReason;
  if (reason === 'rate_limited') return '生成服务在限流，先把出图放慢（不是你的操作问题）。';
  if (reason === 'memory_pressure' || reason === 'memory') return '内存吃紧，先把出图放慢；等它缓过来会自动恢复。';
  return '';
}

/** 状态行要不要显示（空串一律不显示，健康时不打扰）。 */
export function hasProviderRuntimeNotice(runtime) {
  return providerRuntimeNotice(runtime).length > 0;
}