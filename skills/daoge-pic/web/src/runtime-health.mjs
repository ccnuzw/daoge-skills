const POOL_LABELS = { idle: '按需待命', starting: '正在启动', ready: '运行正常', degraded: '自动恢复中', failed: '需要重启', stopping: '正在停止' };

function safeDiagnosticText(value) {
  return String(value || '')
    .replace(/https?:\/\/[^\s]+/gi, '[redacted-url]')
    .replace(/\b(?:bearer|authorization|api[_ -]?key)\s*[:=]?\s*[^\s,;]+/gi, '[redacted-secret]')
    .replace(/[A-Za-z]:\\[^\r\n]+/g, '[redacted-path]')
    .replace(/\/(?:Users|home|tmp|var)\/[^\r\n]+/g, '[redacted-path]')
    .slice(0, 320);
}

export function runtimeHealthPresentation(runtime, recoveryPhase = 'ready') {
  if (recoveryPhase === 'stopping') return { tone: 'warning', title: '正在安全关闭后台任务', detail: 'Worker、HTTP 服务与本地数据库正在按顺序释放。', live: true };
  if (recoveryPhase === 'reconnecting') return { tone: 'warning', title: 'Studio 正在重连', detail: '保留当前页面状态；连接恢复后将刷新权威快照。', live: true };
  if (recoveryPhase === 'restored') return { tone: 'ready', title: 'Studio 已恢复', detail: '授权与页面上下文已复用，实时更新已重新连接。', live: true };
  const generation = runtime?.workerPool;
  const media = runtime?.mediaWorkerPool;
  if (generation?.state === 'failed' || media?.state === 'failed') return { tone: 'danger', title: '后台处理池需要重启', detail: [generation?.lastError, media?.lastError].filter(Boolean).map(safeDiagnosticText).join(' · ') || '子进程连续恢复失败；保存的运行和资产状态未丢失。', live: true };
  if (generation?.state === 'degraded' || media?.state === 'degraded') return { tone: 'warning', title: '后台处理池正在恢复', detail: '生成：' + (POOL_LABELS[generation?.state] || '未配置') + ' · 媒体：' + (POOL_LABELS[media?.state] || '未配置'), live: true };
  if (generation?.state === 'starting' || media?.state === 'starting') return { tone: 'working', title: '按需启动后台处理', detail: '仅在队列需要时创建 Worker，首次任务可能短暂等待。', live: true };
  return { tone: 'ready', title: 'Studio 运行正常', detail: '生成：' + (POOL_LABELS[generation?.state] || '未配置') + ' · 媒体：' + (POOL_LABELS[media?.state] || '按需待命'), live: false };
}

export function redactedRuntimeDiagnostic({ studio, provider, recoveryPhase, connectionError }) {
  const pool = (value) => value ? {
    state: value.state || 'unknown',
    targetSize: Number(value.targetSize) || 0,
    processCount: Number(value.processCount) || 0,
    readyCount: Number(value.readyCount) || 0,
    busyCount: Number(value.busyCount) || 0,
    queuedCount: Number(value.queuedCount) || 0,
    restartCount: Number(value.restartCount) || 0,
    lastError: value.lastError ? safeDiagnosticText(value.lastError) : null
  } : null;
  return {
    runtimeVersion: studio?.protocol?.runtimeVersion || null,
    protocolVersion: studio?.protocol?.version || null,
    daemonMode: studio?.runtime?.mode || null,
    recoveryPhase: recoveryPhase || 'ready',
    connected: !connectionError,
    providerConfigured: provider?.configured === true,
    generationWorkerPool: pool(studio?.runtime?.workerPool),
    mediaWorkerPool: pool(studio?.runtime?.mediaWorkerPool)
  };
}
